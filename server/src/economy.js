// Player rewards: off-chain liabilities that become onchain claims through GameReserve.
//
// - Milestones: small fixed DCP for the first time an account reaches a depth in a season.
// - Daily leaderboard: fixed small prizes for the top fame gains, plus a weighted random draw
//   whose randomness comes from GameReserve's commit-reveal (not from the server alone).
// - Anti-farming: rewards need a linked wallet, account age, real play, and are capped per
//   account per epoch. Accounts sharing a device/network signal split ONE account's cap, so
//   this is a heuristic cap, not proof of one human or complete Sybil resistance.
// - Budget: never more than min(onchain epochCap, configured prize budget). Milestones are
//   paid first; overflow stays pending for later epochs rather than being dropped.
// Player liabilities live only in `rewards` rows and the reserve's `outstanding`; nothing in
// the ops treasury can pay or touch them, and ops budgets never read from them.
import { randomBytes } from 'node:crypto';
import { all, one, run, tx } from './db.js';
import { keccak256, hex, unhex, leafHash, merkle, concat, word } from './crypto/eth.js';

const E18 = 10n ** 18n;
export const MILESTONES = { 3: 25n, 5: 50n, 8: 100n, 12: 200n, 16: 400n, 20: 800n, 30: 1500n };
export const TOP_PRIZES = [500n, 300n, 200n, 100n, 100n, 100n, 100n, 100n, 100n, 100n];
export const DRAW_WINNERS = 10;
export const DRAW_PRIZE = 50n;

export function defaultEconomyConfig() {
  return {
    minAccountAgeMs: 24 * 3600_000,
    minActions: 200,
    perAccountEpochCap: 2000n * E18,
    maxEpochPrizes: 20_000n * E18,
    challengeMs: 24 * 3600_000,
  };
}

export function recordDepth(db, accountId, season, depth) {
  for (const [d, amt] of Object.entries(MILESTONES)) {
    if (depth < Number(d)) continue;
    const key = `depth${d}`;
    const ins = run(db, 'INSERT OR IGNORE INTO milestones(account_id, season, key, amount, created_at) VALUES(?, ?, ?, ?, ?)', accountId, season, key, (amt * E18).toString(), Date.now());
    if (ins.changes) {
      run(db, 'INSERT OR IGNORE INTO rewards(account_id, kind, amount, status, created_at, ref) VALUES(?, ?, ?, ?, ?, ?)', accountId, 'milestone', (amt * E18).toString(), 'pending', Date.now(), `ms:${accountId}:${season}:${key}`);
    }
  }
}

export function eligible(db, cfg, accountId, now = Date.now()) {
  const a = one(db, 'SELECT * FROM accounts WHERE id = ?', accountId);
  if (!a) return { ok: false, why: 'no account' };
  if (!a.wallet) return { ok: false, why: 'link a wallet to receive token prizes' };
  if (a.flagged) return { ok: false, why: 'account under automated review' };
  if (now - a.created_at < cfg.minAccountAgeMs) return { ok: false, why: 'account too new' };
  if (a.actions < cfg.minActions) return { ok: false, why: `play ${cfg.minActions - a.actions} more actions` };
  return { ok: true, wallet: a.wallet };
}

/** Group eligible accounts by shared signals (hashed /24 + UA). Returns accountId -> clusterId. */
function clusters(db, ids) {
  const parent = new Map(ids.map((i) => [i, i]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const bySignal = new Map();
  for (const r of all(db, 'SELECT account_id, signal FROM signals')) {
    if (!parent.has(r.account_id)) continue;
    if (!bySignal.has(r.signal)) bySignal.set(r.signal, []);
    bySignal.get(r.signal).push(r.account_id);
  }
  for (const group of bySignal.values()) for (let i = 1; i < group.length; i++) parent.set(find(group[i]), find(group[0]));
  return new Map(ids.map((i) => [i, find(i)]));
}

function drawIndex(randomness, i, total) {
  const h = keccak256(concat(unhex(randomness), word(i)));
  return BigInt(hex(h)) % total;
}

/**
 * Deterministically compute the leaves for an epoch. Pure given (db snapshot, randomness),
 * and the inputs are stored in the epoch snapshot so anyone can recompute the draw.
 */
export function computeEpoch(db, cfg, { epoch, day, randomness, budget, now = Date.now() }) {
  const pending = all(db, "SELECT * FROM rewards WHERE status = 'pending' ORDER BY id");
  const fame = all(db, 'SELECT d.account_id, d.fame FROM daily_fame d WHERE d.day = ? AND d.fame > 0 ORDER BY d.fame DESC, d.account_id', day);
  const elig = new Map();
  const check = (id) => { if (!elig.has(id)) elig.set(id, eligible(db, cfg, id, now)); return elig.get(id); };
  const ids = [...new Set([...pending.map((r) => r.account_id), ...fame.map((f) => f.account_id)])].filter((id) => check(id).ok);
  const cluster = clusters(db, ids);
  const clusterSpent = new Map();
  let spent = 0n;
  const leaves = [];
  const add = (accountId, amount, kind, ref, rewardId = null) => {
    const c = cluster.get(accountId);
    const used = clusterSpent.get(c) ?? 0n;
    const room = cfg.perAccountEpochCap - used;
    // Never discard the unpaid remainder of an earned or recovered reward.
    if (room <= 0n || spent + amount > budget || (rewardId && amount > room)) return false;
    const amt = amount <= room ? amount : room;
    clusterSpent.set(c, used + amt);
    spent += amt;
    leaves.push({ accountId, wallet: check(accountId).wallet, amount: amt, kind, ref, rewardId });
    return true;
  };
  // 1) earned milestones and recovered prizes (oldest first)
  for (const r of pending) if (check(r.account_id).ok) add(r.account_id, BigInt(r.amount), r.kind, r.ref, r.id);
  // 2) top daily fame gains (leaderboard-eligible characters only; revived runs excluded upstream)
  const eligFame = fame.filter((f) => check(f.account_id).ok);
  const top = eligFame.slice(0, TOP_PRIZES.length);
  top.forEach((f, i) => add(f.account_id, TOP_PRIZES[i] * E18, 'top', `top:${epoch}:${i}`));
  // 3) weighted random draw among the rest, weight = floor(sqrt(fame))
  const pool = eligFame.slice(TOP_PRIZES.length).map((f) => ({ id: f.account_id, w: BigInt(Math.max(1, Math.floor(Math.sqrt(f.fame)))) }));
  const winners = [];
  for (let i = 0; i < DRAW_WINNERS && pool.length; i++) {
    const total = pool.reduce((s, p) => s + p.w, 0n);
    let r = drawIndex(randomness, i, total);
    let k = 0;
    while (r >= pool[k].w) { r -= pool[k].w; k++; }
    const [w] = pool.splice(k, 1);
    winners.push(w.id);
    add(w.id, DRAW_PRIZE * E18, 'draw', `draw:${epoch}:${i}`);
  }
  const snapshot = { epoch, day, randomness, budget: budget.toString(), top: top.map((f) => [f.account_id, f.fame]), pool: eligFame.slice(TOP_PRIZES.length).map((f) => [f.account_id, f.fame]), winners };
  return { leaves, total: spent, snapshot };
}

export function buildTree(leaves) {
  const hashes = leaves.map((l, i) => leafHash(i, l.wallet, l.amount));
  return merkle(hashes);
}

/**
 * Advance the epoch state machine as far as possible. Safe to call repeatedly (keeper tick);
 * every step is guarded by the stored status and by the contract's own checks.
 */
export async function advanceEpochs(db, chain, cfg, { currentEpoch, dayOf, now = Date.now(), log = () => {} }) {
  // Commit seeds two epochs ahead (generate ahead so a missed tick never blocks a round).
  for (const e of [currentEpoch + 1, currentEpoch + 2]) {
    if (one(db, 'SELECT 1 FROM epochs WHERE epoch = ?', e)) continue;
    const seed = hex(randomBytes(32));
    const seedHash = hex(keccak256(unhex(seed)));
    // Durable intent BEFORE contacting the chain: a lost response must not lose the seed.
    run(db, 'INSERT INTO epochs(epoch, seed, seed_hash, status, updated_at) VALUES(?, ?, ?, ?, ?)', e, seed, seedHash, 'prepared', now);
  }
  for (const ep of all(db, "SELECT * FROM epochs WHERE status = 'prepared' ORDER BY epoch")) {
    const r = await chain.roundState(ep.epoch);
    if (!r.seedHash) {
      if (ep.epoch <= currentEpoch) { run(db, "UPDATE epochs SET status = 'expired' WHERE epoch = ?", ep.epoch); continue; }
      await chain.commitSeed(ep.epoch, ep.seed_hash, currentEpoch);
    } else if (r.seedHash !== ep.seed_hash) throw new Error('Committed seed mismatch');
    run(db, "UPDATE epochs SET status = 'committed', updated_at = ? WHERE epoch = ?", now, ep.epoch);
  }
  const open = all(db, "SELECT * FROM epochs WHERE epoch < ? AND status NOT IN ('final','expired') ORDER BY epoch", currentEpoch);
  for (const ep of open) {
    try {
      if (ep.status === 'committed') {
        const state = await chain.roundState(ep.epoch);
        const ab = state.anchorBlock || await chain.anchor(ep.epoch);
        run(db, "UPDATE epochs SET status = 'anchored', anchor_block = ?, updated_at = ? WHERE epoch = ?", ab, now, ep.epoch);
        ep.status = 'anchored';
      }
      if (ep.status === 'anchored') {
        try {
          const state = await chain.roundState(ep.epoch);
          const rnd = state.randomness || await chain.revealSeed(ep.epoch, ep.seed);
          run(db, "UPDATE epochs SET status = 'revealed', randomness = ?, updated_at = ? WHERE epoch = ?", rnd, now, ep.epoch);
          ep.status = 'revealed'; ep.randomness = rnd;
        } catch (e) {
          if (/RevealExpired/.test(e.message)) { run(db, "UPDATE epochs SET status = 'expired', updated_at = ? WHERE epoch = ?", now, ep.epoch); log(`epoch ${ep.epoch}: reveal expired; rewards roll forward`); continue; }
          throw e;
        }
      }
      if (ep.status === 'revealed') {
        const budget = [chain.epochCap(), cfg.maxEpochPrizes].reduce((a, b) => (a < b ? a : b));
        const { leaves, total, snapshot } = computeEpoch(db, cfg, { epoch: ep.epoch, day: dayOf(ep.epoch), randomness: ep.randomness, budget, now });
        const tree = buildTree(leaves);
        tx(db, () => {
          leaves.forEach((l, i) => {
            if (l.rewardId) run(db, "UPDATE rewards SET status = 'rooted', epoch = ?, leaf_index = ?, wallet = ?, proof = ?, amount = ? WHERE id = ? AND status = 'pending'", ep.epoch, i, l.wallet, JSON.stringify(tree.proofs[i]), l.amount.toString(), l.rewardId);
            else run(db, 'INSERT OR IGNORE INTO rewards(account_id, kind, amount, epoch, leaf_index, wallet, proof, status, created_at, ref) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', l.accountId, l.kind, l.amount.toString(), ep.epoch, i, l.wallet, JSON.stringify(tree.proofs[i]), 'rooted', now, l.ref);
          });
          run(db, "UPDATE epochs SET status = 'drawn', root = ?, total = ?, snapshot = ?, updated_at = ? WHERE epoch = ?", tree.root, total.toString(), JSON.stringify(snapshot), now, ep.epoch);
        });
        ep.status = 'drawn'; ep.root = tree.root; ep.total = total.toString();
        log(`epoch ${ep.epoch}: ${leaves.length} leaves, total ${total / E18} DCP`);
      }
      if (ep.status === 'drawn') {
        const state = await chain.roundState(ep.epoch);
        if (state.root && (state.root !== ep.root || state.total !== BigInt(ep.total))) throw new Error('Posted root mismatch');
        // Old versions could post a later round after a transient failure. Only
        // recover an absent root after confirming the monotonic on-chain cursor.
        if (!state.root && ep.epoch <= await chain.lastPostedEpoch()) {
          tx(db, () => {
            run(db, "UPDATE rewards SET status = 'pending', epoch = NULL, leaf_index = NULL, wallet = NULL, proof = NULL WHERE epoch = ? AND status = 'rooted'", ep.epoch);
            run(db, "UPDATE epochs SET status = 'expired', updated_at = ? WHERE epoch = ?", now, ep.epoch);
          });
          log(`epoch ${ep.epoch}: superseded absent root; all prizes roll forward`);
          continue;
        }
        if (BigInt(ep.total) > 0n && !state.root) await chain.postRoot(ep.epoch, ep.root, BigInt(ep.total));
        run(db, "UPDATE epochs SET status = 'posted', updated_at = ? WHERE epoch = ?", now, ep.epoch);
        ep.status = 'posted';
        ep.updated_at = now;
      }
      if (ep.status === 'posted' && now - ep.updated_at >= cfg.challengeMs) {
        const state = await chain.roundState(ep.epoch);
        if (state.vetoed) {
          // A vetoed root pays nothing: earned milestones return to pending for a later root;
          // that epoch's top/draw leaves are void rather than liabilities forever.
          tx(db, () => {
            run(db, "UPDATE rewards SET status = 'pending', epoch = NULL, leaf_index = NULL, wallet = NULL, proof = NULL WHERE epoch = ? AND status = 'rooted' AND kind = 'milestone'", ep.epoch);
            run(db, "UPDATE rewards SET status = 'vetoed' WHERE epoch = ? AND status = 'rooted'", ep.epoch);
            run(db, "UPDATE epochs SET status = 'vetoed' WHERE epoch = ?", ep.epoch);
          });
          continue;
        }
        if (BigInt(ep.total) > 0n && (!state.root || now / 1000 < state.postedAt + cfg.challengeMs / 1000)) continue;
        run(db, "UPDATE rewards SET status = 'claimable' WHERE epoch = ? AND status = 'rooted'", ep.epoch);
        run(db, "UPDATE epochs SET status = 'final', updated_at = ? WHERE epoch = ?", now, ep.epoch);
      }
    } catch (e) {
      log(`epoch ${ep.epoch}: ${e.message} (will retry)`);
      run(db, "INSERT INTO outages(component, started_at, ended_at, note) VALUES('epoch', ?, ?, ?)", now, now, `epoch ${ep.epoch}: ${e.message}`);
      // No later root may overtake an unresolved earlier round. A lost receipt
      // is reconciled from roundState on the next tick before posting continues.
      break;
    }
  }
}

export function markClaimed(db, log) {
  run(db, "UPDATE rewards SET status = 'claimed' WHERE epoch = ? AND leaf_index = ? AND status IN ('rooted','claimable')", Number(log.args.epoch), Number(log.args.index));
}

export function rewardsFor(db, accountId) {
  return all(db, 'SELECT id, kind, amount, epoch, leaf_index, wallet, proof, status, created_at FROM rewards WHERE account_id = ? ORDER BY id DESC LIMIT 100', accountId)
    .map((r) => ({ ...r, proof: r.proof ? JSON.parse(r.proof) : null }));
}

/** Total player liabilities by state (shown on the status page; never spendable by ops). */
export function liabilities(db) {
  const rows = all(db, "SELECT status, amount FROM rewards WHERE status IN ('pending','rooted','claimable')");
  const out = { pending: 0n, rooted: 0n, claimable: 0n };
  for (const r of rows) out[r.status] += BigInt(r.amount);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toString()]));
}
