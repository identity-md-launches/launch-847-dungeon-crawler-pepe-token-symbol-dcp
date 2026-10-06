#!/usr/bin/env node
// Entry point. Configuration comes from environment variables (see README and deploy/env.example).
//
//   DCP_DEMO=1 node server/src/main.js          offline demo: simulated chain, test fixtures
//   DCP_ROLE=web|keeper|payer|all               split processes so keys live only where needed
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createApp } from './app.js';
import { RpcChain, Signer } from './chain/rpc.js';
import { processQueuedPayments } from './ops/pipeline.js';

const env = process.env;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const demo = env.DCP_DEMO === '1';
const role = env.DCP_ROLE ?? 'all';
const port = Number(env.PORT ?? 8787);
const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

function config() {
  const cfg = {
    demo,
    log,
    dbPath: env.DCP_DB ?? join(root, 'data', demo ? 'demo.sqlite' : 'dcp.sqlite'),
    backupDir: env.DCP_BACKUP_DIR ?? join(root, 'data', 'backups'),
    webRoot: env.DCP_WEB_ROOT ?? join(root, 'web'),
    domain: env.DCP_DOMAIN ?? `localhost:${port}`,
    origin: env.DCP_ORIGIN ?? `http://localhost:${port}`,
    trustProxy: env.DCP_TRUST_PROXY === '1',
  };
  if (demo) {
    return {
      ...cfg,
      confirmations: 3,
      econ: { minAccountAgeMs: 0, minActions: 30, challengeMs: 3600_000 },
      contracts: null,
    };
  }
  // Production / fork: everything sensitive comes from files mounted by the deployment.
  if (!env.DCP_SECRET_FILE) throw new Error('DCP_SECRET_FILE is required (game RNG secret, 32+ random bytes)');
  cfg.secret = readFileSync(env.DCP_SECRET_FILE, 'utf8').trim();
  if (cfg.secret.length < 32) throw new Error('game secret too short');
  const contracts = JSON.parse(readFileSync(env.DCP_CONTRACTS_FILE ?? join(root, 'deploy', 'contracts.json'), 'utf8'));
  cfg.contracts = contracts;
  cfg.chainId = Number(env.DCP_CHAIN_ID ?? contracts.chainId ?? 1);
  cfg.confirmations = Number(env.DCP_CONFIRMATIONS ?? 64);
  cfg.chain = new RpcChain({
    rpcUrl: env.DCP_RPC_URL ?? (() => { throw new Error('DCP_RPC_URL required'); })(),
    chainId: cfg.chainId,
    addresses: contracts,
    keeper: (role === 'keeper' || role === 'all') && env.DCP_KEEPER_KEY_FILE ? new Signer(env.DCP_KEEPER_KEY_FILE) : null,
    payment: (role === 'payer' || role === 'all') && env.DCP_PAYMENT_KEY_FILE ? new Signer(env.DCP_PAYMENT_KEY_FILE) : null,
    maxFeeGwei: Number(env.DCP_MAX_FEE_GWEI ?? 30),
  });
  return cfg;
}

const app = createApp(config());
const tickMs = Number(env.DCP_TICK_MS ?? (demo ? 15_000 : 60_000));

if (role === 'web' || role === 'all') {
  await app.listen(port, env.HOST ?? '127.0.0.1');
  log(`Dungeon Crawler Pepe ${demo ? '(DEMO — simulated chain, test fixtures) ' : ''}listening on http://${env.HOST ?? '127.0.0.1'}:${port}`);
}
if (role === 'keeper' || role === 'all') {
  const loop = async () => {
    try { await app.keeper.tick(app.now()); } catch (e) { log(`keeper tick error: ${e.message}`); }
    setTimeout(loop, tickMs);
  };
  setTimeout(loop, demo ? 1000 : 5000);
  log(`keeper running every ${tickMs / 1000}s`);
}
if (role === 'payer') {
  const loop = async () => {
    try { await app.chain.refresh(); const r = await processQueuedPayments(app.db, app.chain); if (r.length) log(`payer: ${JSON.stringify(r)}`); } catch (e) { log(`payer error: ${e.message}`); }
    setTimeout(loop, tickMs);
  };
  loop();
  log('isolated payer running');
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log(`${sig}: closing database`); try { app.db.close(); } catch { /* already closed */ } process.exit(0); });
