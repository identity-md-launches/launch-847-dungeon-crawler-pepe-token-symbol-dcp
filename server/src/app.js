// Wires the services together and exposes the HTTP API + static frontend.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative, extname, sep } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { openDb, one, all, run, getMeta, setMeta } from './db.js';
import { GameService, GameError } from './game/service.js';
import { createGuest, sessionFrom, logout, recover, issueNonce, verifySignIn, recordSignal, siweMessage } from './auth.js';
import { SKUS, skuBy, createOrder, creditPurchase, ownedSkus } from './shop.js';
import { rewardsFor, markClaimed, defaultEconomyConfig } from './economy.js';
import { Indexer } from './chain/indexer.js';
import { SimChain } from './chain/sim.js';
import { Keeper } from './ops/keeper.js';
import { statusReport } from './ops/status.js';
import { defaultBudgetConfig, rollback } from './ops/pipeline.js';
import { calldata } from './crypto/abi.js';
import { privToAddress } from './crypto/eth.js';

export const APP_VERSION = '0.1.0';
const E18 = 10n ** 18n;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/** Token bucket per key. Ordinary play is ~1 action/sec; bots hammering get 429s. */
class RateLimiter {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.b = new Map(); }
  take(key, now = Date.now()) {
    const s = this.b.get(key) ?? { t: this.burst, at: now };
    s.t = Math.min(this.burst, s.t + ((now - s.at) / 1000) * this.rate);
    s.at = now;
    if (s.t < 1) { this.b.set(key, s); return false; }
    s.t -= 1; this.b.set(key, s);
    if (this.b.size > 50_000) this.b.clear();
    return true;
  }
}

export function createApp(cfg) {
  if (!cfg.demo || (cfg.chain && cfg.chain.kind !== 'sim') || cfg.contracts || cfg.paidAuthor) {
    throw new Error('BUILD-AND-REVIEW only: use the labelled local simulation; real payments and launch are disabled');
  }
  const db = cfg.db ?? openDb(cfg.dbPath);
  let secret = cfg.secret;
  if (!secret) {
    // Demo only: persist a generated secret in the DB so restarts keep the same worlds.
    if (!cfg.demo) throw new Error('DCP_SECRET_FILE is required outside demo mode');
    secret = getMeta(db, 'demoSecret') ?? randomBytes(32).toString('hex');
    setMeta(db, 'demoSecret', secret);
  }
  const clockOffset = () => (cfg.demo ? getMeta(db, 'demoClockOffset', 0) : 0);
  const now = () => Date.now() + clockOffset();
  const game = new GameService({ db, secret, dayMs: cfg.dayMs ?? 86400_000, now });
  const chain = cfg.chain ?? new SimChain({ db, now, challengeSecs: Math.floor((cfg.econ?.challengeMs ?? 86400_000) / 1000) });
  const econCfg = { ...defaultEconomyConfig(), ...(cfg.econ ?? {}) };
  const budgetCfg = { ...defaultBudgetConfig(), ...(cfg.budget ?? {}) };
  const indexer = new Indexer({ db, chain, confirmations: cfg.confirmations ?? 12, onPurchase: (l) => creditPurchase(db, l), onClaim: (l) => markClaimed(db, l), log: cfg.log });
  const keeper = new Keeper({ db, chain, game, indexer, econCfg, budgetCfg, backupDir: cfg.backupDir, log: cfg.log ?? (() => {}), contentActivateAhead: !cfg.demo, paidAuthor: cfg.paidAuthor ?? null });
  const actLimiter = new RateLimiter(cfg.actionsPerSec ?? 6, 20);
  const authLimiter = new RateLimiter(0.5, 10);
  const webRoot = cfg.webRoot;
  const authCfg = { domain: cfg.domain, uri: cfg.origin, chainId: cfg.chainId ?? chain.chainId };

  // Demo-only simulated wallet address per account (the key is never used to sign anything real).
  const demoWallet = (accountId) => privToAddress((BigInt('0x' + createHash('sha256').update(`${secret}|demo-wallet|${accountId}`).digest('hex')) % (2n ** 255n)) + 1n);

  async function body(req) {
    let size = 0;
    const chunks = [];
    for await (const c of req) { size += c.length; if (size > 16_384) throw new HttpError(413, 'body too large'); chunks.push(c); }
    if (!chunks.length) return {};
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'JSON object required');
    return value;
  }
  const auth = (req) => {
    const h = req.headers.authorization ?? '';
    const s = sessionFrom(db, h.startsWith('Bearer ') ? h.slice(7) : null);
    if (!s) throw new HttpError(401, 'sign in first');
    return s;
  };
  const ipOf = (req) => (cfg.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';
  const big = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

  const routes = {
    'GET /api/config': () => ({
      app: APP_VERSION, chainId: authCfg.chainId, chain: chain.kind, demo: !!cfg.demo, domain: authCfg.domain, uri: authCfg.uri,
      contracts: cfg.contracts ?? null,
      classes: game.registry.active().classes.map(({ id, name, hp, atk, def, tags, blurb }) => ({ id, name, hp, atk, def, tags, blurb })),
      skus: SKUS.map((s) => ({ sku: s.sku, name: s.name, price: s.price.toString(), kind: s.kind })),
      world: game.registry.active().world,
    }),
    'POST /api/auth/guest': (req) => {
      if (!authLimiter.take('guest:' + ipOf(req))) throw new HttpError(429, 'slow down');
      const g = createGuest(db);
      recordSignal(db, g.accountId, ipOf(req), req.headers['user-agent'], secret);
      return g;
    },
    'POST /api/auth/recover': async (req) => {
      if (!authLimiter.take('rec:' + ipOf(req))) throw new HttpError(429, 'slow down');
      const r = recover(db, (await body(req)).code);
      if (!r) throw new HttpError(404, 'unknown recovery code');
      return r;
    },
    'GET /api/auth/nonce': (req, url) => {
      if (!authLimiter.take('nonce:' + ipOf(req))) throw new HttpError(429, 'slow down');
      const address = url.searchParams.get('address');
      if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? '')) throw new HttpError(400, 'valid wallet address required');
      const nonce = issueNonce(db, address);
      const issuedAt = new Date().toISOString();
      const expirationTime = new Date(Date.now() + 5 * 60_000).toISOString();
      return { nonce, message: siweMessage({ domain: authCfg.domain, uri: authCfg.uri, address, chainId: authCfg.chainId, nonce, issuedAt, expirationTime }) };
    },
    'POST /api/auth/verify': async (req) => {
      if (!authLimiter.take('verify:' + ipOf(req))) throw new HttpError(429, 'slow down');
      const b = await body(req);
      if (typeof b.message !== 'string' || typeof b.signature !== 'string') throw new HttpError(400, 'message and signature required');
      const h = req.headers.authorization ?? '';
      const cur = sessionFrom(db, h.startsWith('Bearer ') ? h.slice(7) : null);
      try {
        const r = verifySignIn(db, authCfg, { message: b.message, signature: b.signature, currentAccountId: cur?.account_id });
        recordSignal(db, r.accountId, ipOf(req), req.headers['user-agent'], secret);
        return r;
      } catch (e) { throw new HttpError(401, e.message); }
    },
    'POST /api/auth/logout': (req) => { logout(db, (req.headers.authorization ?? '').slice(7)); return { ok: true }; },
    'GET /api/me': (req) => {
      const s = auth(req);
      const a = one(db, 'SELECT id, wallet, created_at, actions FROM accounts WHERE id = ?', s.account_id);
      return { account: a, sessionWallet: s.wallet, slots: game.slots(a.id), owned: ownedSkus(db, a.id), characters: game.list(a.id) };
    },
    'POST /api/characters': async (req) => { const s = auth(req); return game.createCharacter(s.account_id, await body(req)); },
    'GET /api/character': (req, url) => { const s = auth(req); const { row, ch } = game.load(s.account_id, url.searchParams.get('id')); return { character: ch, rev: row.rev }; },
    'POST /api/act': async (req) => {
      const s = auth(req);
      if (!actLimiter.take(s.account_id)) throw new HttpError(429, 'Too fast. Even the Toad Monk needs to breathe.');
      return game.act(s.account_id, await body(req));
    },
    'GET /api/world': () => ({ day: game.day(), depthGate: game.maxDepth(), event: game.dailyEvent(), season: game.season(), contentVersion: game.registry.activeVersion() }),
    'GET /api/leaderboard': () => game.leaderboard(),
    'GET /api/rewards': (req) => {
      const s = auth(req);
      const rewards = rewardsFor(db, s.account_id);
      const claimable = rewards.filter((r) => r.status === 'claimable' && r.proof);
      const tx = claimable.length && cfg.contracts?.reserve ? {
        to: cfg.contracts.reserve,
        data: calldata('claimMany((uint256,uint256,address,uint256,bytes32[])[])', [{ tuple: ['uint256', 'uint256', 'address', 'uint256', 'bytes32[]'], array: true }],
          [claimable.map((r) => [BigInt(r.epoch), BigInt(r.leaf_index), r.wallet, BigInt(r.amount), r.proof])]),
      } : null;
      return { rewards, claimTx: tx };
    },
    'POST /api/orders': async (req) => {
      const s = auth(req);
      const b = await body(req);
      if (!['number', 'string'].includes(typeof b.sku) || !skuBy(b.sku)) throw new HttpError(400, 'unknown sku');
      const o = createOrder(db, s.account_id, b.sku);
      const c = cfg.contracts;
      const txs = c?.shop ? {
        approve: { to: c.dcp, data: calldata('approve(address,uint256)', ['address', 'uint256'], [c.shop, BigInt(o.price)]) },
        purchase: { to: c.shop, data: calldata('purchase(bytes32,uint256,uint256)', ['bytes32', 'uint256', 'uint256'], [o.orderId, BigInt(o.sku), BigInt(o.price)]) },
      } : null;
      return { order: o, txs, note: 'Approve exactly the price, then purchase. Items are credited after the purchase is final onchain.' };
    },
    'GET /api/orders': (req) => { const s = auth(req); return all(db, 'SELECT order_id, sku, price, status, tx_hash, created_at FROM orders WHERE account_id = ? ORDER BY created_at DESC LIMIT 50', s.account_id); },
    'GET /api/status': () => big(statusReport({ db, chain, game, budgetCfg, appVersion: APP_VERSION })),

    // ---------------- demo-only helpers (LOCAL SIMULATION; disabled unless DCP_DEMO=1 with SimChain)
    'POST /api/demo/link-wallet': (req) => {
      demoOnly();
      const s = auth(req);
      const w = demoWallet(s.account_id);
      run(db, 'UPDATE accounts SET wallet = coalesce(wallet, ?) WHERE id = ?', w, s.account_id);
      if (chain.balanceOf('DCP', w) === 0n) chain.credit('DCP', w, 5_000n * E18);
      return { wallet: w, dcp: chain.balanceOf('DCP', w).toString(), note: 'Simulated wallet with 5,000 test DCP. Not a real address you control.' };
    },
    'POST /api/demo/pay': async (req) => {
      demoOnly();
      const s = auth(req);
      const { orderId } = await body(req);
      if (typeof orderId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(orderId)) throw new HttpError(400, 'valid orderId required');
      const o = one(db, 'SELECT * FROM orders WHERE order_id = ? AND account_id = ?', orderId, s.account_id);
      if (!o) throw new HttpError(404, 'no such order');
      const w = one(db, 'SELECT wallet FROM accounts WHERE id = ?', s.account_id).wallet;
      if (!w) throw new HttpError(400, 'link the demo wallet first');
      await chain.purchase(w, orderId, o.sku, BigInt(o.price));
      chain.mine(1);
      await indexer.poll();
      return { ok: true, note: `submitted; credited after ${indexer.confirmations} confirmations` };
    },
    'POST /api/demo/claim': async (req) => {
      demoOnly();
      const s = auth(req);
      const out = [];
      for (const r of rewardsFor(db, s.account_id).filter((x) => x.status === 'claimable')) {
        try { await chain.claim(r.epoch, r.leaf_index, r.wallet, BigInt(r.amount), r.proof); out.push({ id: r.id, ok: true }); } catch (e) { out.push({ id: r.id, ok: false, error: e.message }); }
      }
      chain.mine(indexer.confirmations + 1);
      await indexer.poll();
      return { results: out };
    },
    'POST /api/demo/advance': async (req) => {
      demoOnly();
      const { hours = 24 } = await body(req);
      if (!Number.isFinite(hours) || hours < 1 || hours > 72) throw new HttpError(400, 'hours must be a number from 1 to 72');
      setMeta(db, 'demoClockOffset', clockOffset() + Math.min(72, Math.max(1, Number(hours))) * 3600_000);
      for (let i = 0; i < 5; i++) chain.trade(i % 2 === 0, (20_000n + BigInt(i) * 3_000n) * E18);
      chain.mine(indexer.confirmations + 2);
      const results = await keeper.tick(now());
      chain.mine(indexer.confirmations + 2);
      await keeper.tick(now());
      return { now: new Date(now()).toISOString(), results };
    },
    'POST /api/demo/tick': async () => { demoOnly(); chain.mine(indexer.confirmations + 1); return { results: await keeper.tick(now()) }; },
  };
  function demoOnly() { if (!cfg.demo || chain.kind !== 'sim') throw new HttpError(404, 'not found'); }

  function serveStatic(req, res, url) {
    if (!webRoot) return false;
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = resolve(webRoot, '.' + p);
    const rel = relative(resolve(webRoot), file);
    if (rel === '..' || rel.startsWith('..' + sep)) return false;
    if (!existsSync(file) || !statSync(file).isFile()) return false;
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': p.endsWith('.html') ? 'no-cache' : 'public, max-age=300', ...SECURITY_HEADERS });
    res.end(readFileSync(file));
    return true;
  }

  const handler = async (req, res) => {
    try {
    const url = new URL(req.url, 'http://local');
    const key = `${req.method} ${url.pathname}`;
    const route = routes[key];
    if (!route) {
      if (req.method === 'GET' && serveStatic(req, res, url)) return;
      return send(res, 404, { error: 'not found' });
    }
    try {
      const out = await route(req, url);
      send(res, 200, out);
    } catch (e) {
      if (e instanceof GameError) return send(res, e.status ?? 400, { error: e.message, current: e.current });
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      cfg.log?.(`500 ${key}: ${e.stack ?? e.message}`);
      send(res, 500, { error: 'internal error' });
    }
    } catch { if (!res.headersSent) send(res, 400, { error: 'invalid request' }); else res.end(); }
  };

  return { db, game, chain, keeper, indexer, handler, now, listen: (port, host) => new Promise((r) => { const srv = createServer(handler); srv.listen(port, host, () => r(srv)); }), rollback: (v, m) => rollback(db, v, m) };
}

const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
}
