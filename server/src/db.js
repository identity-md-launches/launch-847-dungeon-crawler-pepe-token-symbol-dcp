// Durable state: SQLite (node:sqlite, WAL). One file holds game state, economy ledgers, the
// indexer cursor, content versions, swarm memory and ops history, so a backup is one file
// and a restore is one copy. Production may swap in Postgres behind the same functions.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, wallet TEXT UNIQUE, recovery_hash TEXT,
  actions INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, display_name TEXT
);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, wallet TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, address TEXT NOT NULL, issued_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, state TEXT NOT NULL, rev INTEGER NOT NULL, alive INTEGER NOT NULL,
  fame INTEGER NOT NULL DEFAULT 0, best_depth INTEGER NOT NULL DEFAULT 1, season INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, leaderboard_ok INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS characters_account ON characters(account_id);
CREATE TABLE IF NOT EXISTS action_log (
  account_id TEXT NOT NULL, action_id TEXT NOT NULL, char_id TEXT NOT NULL, rev_after INTEGER NOT NULL,
  response TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (account_id, action_id)
);
CREATE TABLE IF NOT EXISTS daily_fame (day INTEGER NOT NULL, account_id TEXT NOT NULL, fame INTEGER NOT NULL, PRIMARY KEY (day, account_id));
CREATE TABLE IF NOT EXISTS picks (effect_id TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cosmetics (account_id TEXT NOT NULL, sku INTEGER NOT NULL, order_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS milestones (account_id TEXT NOT NULL, season INTEGER NOT NULL, key TEXT NOT NULL, amount TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (account_id, season, key));
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, kind TEXT NOT NULL, amount TEXT NOT NULL,
  epoch INTEGER, leaf_index INTEGER, wallet TEXT, proof TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL, ref TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS epochs (
  epoch INTEGER PRIMARY KEY, seed TEXT, seed_hash TEXT, anchor_block INTEGER, randomness TEXT, root TEXT,
  total TEXT, status TEXT NOT NULL, snapshot TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, sku INTEGER NOT NULL, price TEXT NOT NULL, status TEXT NOT NULL,
  tx_hash TEXT, block_number INTEGER, block_hash TEXT, paid TEXT, buyer TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chain_cursor (name TEXT PRIMARY KEY, block_number INTEGER NOT NULL, block_hash TEXT);
CREATE TABLE IF NOT EXISTS seen_blocks (number INTEGER PRIMARY KEY, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS content_packs (
  id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, review TEXT, test TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS content_versions (
  version INTEGER PRIMARY KEY, packs TEXT NOT NULL, status TEXT NOT NULL, activate_at INTEGER NOT NULL, created_at INTEGER NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS swarm_memory (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rules (version INTEGER PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ops_cycles (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  detail TEXT, started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  invoice_id TEXT PRIMARY KEY, cycle_id TEXT NOT NULL, payee TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL,
  tx_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL, note TEXT);
CREATE TABLE IF NOT EXISTS outages (id INTEGER PRIMARY KEY AUTOINCREMENT, component TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS signals (account_id TEXT NOT NULL, signal TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (account_id, signal));
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction (BEGIN IMMEDIATE serialises writers). */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const one = (db, sql, ...args) => db.prepare(sql).get(...args);
export const all = (db, sql, ...args) => db.prepare(sql).all(...args);
export const run = (db, sql, ...args) => db.prepare(sql).run(...args);

export function getMeta(db, key, dflt = null) {
  const r = one(db, 'SELECT value FROM meta WHERE key = ?', key);
  return r ? JSON.parse(r.value) : dflt;
}
export function setMeta(db, key, value) {
  run(db, 'INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

/** Online backup to a file (consistent snapshot). */
export function backupTo(db, file) {
  mkdirSync(dirname(file), { recursive: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}
