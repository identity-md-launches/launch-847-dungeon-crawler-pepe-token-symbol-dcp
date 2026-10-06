// Safe snapshot/restore automation. Restore always creates a NEW file; never overwrites a DB.
import { copyFileSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, backupTo } from '../server/src/db.js';
const [action, sourceArg, targetArg] = process.argv.slice(2);
if (!['backup', 'restore', 'check'].includes(action) || !sourceArg || (action !== 'check' && !targetArg)) {
  throw new Error('Usage: node scripts/recover.mjs backup|restore SOURCE NEW_TARGET; or check SOURCE');
}
const source = resolve(sourceArg);
if (!existsSync(source)) throw new Error('Source database does not exist');
function check(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Database integrity check failed');
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name = 'characters'").get()) throw new Error('Not a DCP save');
  } finally { db.close(); }
}
check(source);
if (action === 'check') console.log('DCP database integrity: ok');
else {
  const target = resolve(targetArg);
  if (existsSync(target)) throw new Error('Refusing to overwrite an existing database');
  mkdirSync(dirname(target), { recursive: true });
  if (action === 'backup') {
    const db = openDb(source);
    try { backupTo(db, target); } finally { db.close(); }
  } else {
    // Only use a completed VACUUM INTO snapshot, never copy a live WAL database.
    if (existsSync(source + '-wal')) throw new Error('Restore requires a completed snapshot, not a live WAL database');
    copyFileSync(source, target, constants.COPYFILE_EXCL);
  }
  check(target);
  console.log(`${action}: verified ${target}`);
}
