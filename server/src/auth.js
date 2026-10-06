// Accounts and sign-in.
// - Guests can play immediately (try before spending; no wallet, no IMD NFT).
// - A guest gets a one-time recovery code for cross-device play without a wallet.
// - Wallet sign-in is EIP-4361 (SIWE)-style: the server issues a single-use nonce bound to the
//   address; the signed message must carry our domain, URI, chain id, nonce, and an expiry.
//   Connecting a wallet is NOT authentication — only a verified signature is.
// - Sessions are random bearer tokens stored hashed; a session is bound to the wallet that
//   signed, so switching accounts in the wallet requires signing again.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { one, run, tx } from './db.js';
import { recoverPersonal, isAddress, toChecksum } from './crypto/eth.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const SESSION_MS = 30 * 24 * 3600_000;
const NONCE_MS = 10 * 60_000;

export function createGuest(db) {
  const id = 'acct_' + randomUUID();
  const recovery = randomBytes(12).toString('base64url');
  run(db, 'INSERT INTO accounts(id, created_at, recovery_hash) VALUES(?, ?, ?)', id, Date.now(), sha(recovery));
  return { accountId: id, token: newSession(db, id, null), recovery };
}

export function newSession(db, accountId, wallet) {
  const token = randomBytes(32).toString('base64url');
  run(db, 'INSERT INTO sessions(token_hash, account_id, wallet, created_at, expires_at) VALUES(?, ?, ?, ?, ?)', sha(token), accountId, wallet, Date.now(), Date.now() + SESSION_MS);
  return token;
}

export function sessionFrom(db, token) {
  if (!token) return null;
  const s = one(db, 'SELECT * FROM sessions WHERE token_hash = ?', sha(token));
  if (!s || s.expires_at < Date.now()) return null;
  return s;
}

export function logout(db, token) {
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

export function recover(db, code) {
  const a = one(db, 'SELECT id, wallet FROM accounts WHERE recovery_hash = ?', sha(String(code ?? '')));
  if (!a) return null;
  return { accountId: a.id, token: newSession(db, a.id, a.wallet) };
}

export function issueNonce(db, address) {
  if (!isAddress(address)) throw new Error('bad address');
  const nonce = randomBytes(12).toString('hex');
  run(db, 'INSERT INTO nonces(nonce, address, issued_at) VALUES(?, ?, ?)', nonce, toChecksum(address), Date.now());
  return nonce;
}

export function siweMessage({ domain, uri, address, chainId, nonce, issuedAt, expirationTime }) {
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n` +
    `Sign in to Dungeon Crawler Pepe. This signature costs no gas and grants no token approval.\n\n` +
    `URI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
}

export function parseSiwe(msg) {
  const lines = String(msg).split('\n');
  const m = /^(.+) wants you to sign in with your Ethereum account:$/.exec(lines[0] ?? '');
  if (!m) return null;
  const field = (k) => lines.find((l) => l.startsWith(k + ': '))?.slice(k.length + 2);
  return { domain: m[1], address: lines[1], uri: field('URI'), version: field('Version'), chainId: Number(field('Chain ID')), nonce: field('Nonce'), issuedAt: field('Issued At'), expirationTime: field('Expiration Time') };
}

/**
 * Verify a signed sign-in message. On success links the wallet to the current guest account
 * (if the wallet is new) or signs into the wallet's existing account.
 */
export function verifySignIn(db, cfg, { message, signature, currentAccountId }) {
  const p = parseSiwe(message);
  if (!p) throw new Error('malformed message');
  if (p.domain !== cfg.domain || p.uri !== cfg.uri) throw new Error('wrong domain');
  if (p.chainId !== cfg.chainId) throw new Error(`wrong network: expected chain ${cfg.chainId}`);
  if (p.version !== '1') throw new Error('bad version');
  const exp = Date.parse(p.expirationTime);
  const issued = Date.parse(p.issuedAt);
  if (!Number.isFinite(exp) || !Number.isFinite(issued) || issued > Date.now() + 30_000 ||
      issued > exp || exp < Date.now() || exp - issued > NONCE_MS) throw new Error('expired message');
  if (message !== siweMessage(p)) throw new Error('noncanonical message');
  const signer = recoverPersonal(message, signature);
  if (!signer || signer !== toChecksum(p.address)) throw new Error('signature does not match address');
  return tx(db, () => {
    const n = one(db, 'SELECT * FROM nonces WHERE nonce = ?', p.nonce);
    if (!n || n.used || n.address !== signer || Date.now() - n.issued_at > NONCE_MS) throw new Error('nonce invalid or already used');
    run(db, 'UPDATE nonces SET used = 1 WHERE nonce = ?', p.nonce);
    let acct = one(db, 'SELECT id FROM accounts WHERE wallet = ?', signer);
    if (!acct) {
      const cur = currentAccountId && one(db, 'SELECT id, wallet FROM accounts WHERE id = ?', currentAccountId);
      if (cur && !cur.wallet) {
        run(db, 'UPDATE accounts SET wallet = ? WHERE id = ?', signer, cur.id);
        acct = { id: cur.id };
      } else {
        const id = 'acct_' + randomUUID();
        run(db, 'INSERT INTO accounts(id, created_at, wallet) VALUES(?, ?, ?)', id, Date.now(), signer);
        acct = { id };
      }
    }
    return { accountId: acct.id, wallet: signer, token: newSession(db, acct.id, signer) };
  });
}

/** Retention: delete only rows the checks above already reject (same wall clock, same bounds). */
export function pruneAuth(db, now = Date.now()) {
  run(db, 'DELETE FROM sessions WHERE expires_at < ?', now);
  run(db, 'DELETE FROM nonces WHERE issued_at < ?', now - NONCE_MS);
}

/** Coarse anti-farming signal: hashed /24 (or /48) network + user agent. Never stored raw. */
export function recordSignal(db, accountId, ip, ua, salt) {
  const net = String(ip ?? '').includes(':') ? String(ip).split(':').slice(0, 3).join(':') : String(ip ?? '').split('.').slice(0, 3).join('.');
  const sig = sha(`${salt}|${net}|${ua ?? ''}`).slice(0, 24);
  run(db, 'INSERT OR IGNORE INTO signals(account_id, signal, ts) VALUES(?, ?, ?)', accountId, sig, Date.now());
}
