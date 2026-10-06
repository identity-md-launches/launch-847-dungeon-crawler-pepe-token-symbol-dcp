// Unattended content cycle with durable stages: author → review → test → publish.
// Each stage persists its output before the next starts, so a crash or restart resumes at the
// failed stage instead of redoing (or re-paying for) earlier ones. Creation, independent
// review, testing and publication are separate functions with separate inputs.
import { all, one, run, tx } from '../db.js';
import { buildContent } from '../game/content.js';
import { runSimulation } from '../sim/simulate.js';
import { reviewPack } from './review.js';
import { LocalAuthor } from './author.js';

const E18 = 10n ** 18n;
export const MAX_ATTEMPTS = 3;
export const PAYMENT_WAIT_MS = 6 * 3600_000; // then fall back to the free author

// ------------------------------------------------------------------ budget policy

export function defaultBudgetConfig() {
  return {
    paidCycleCostImd: E18 / 2n, // observed 2026-10-06 public API unit price; re-quote before launch
    essentialDailyImd: 40n * E18, // conservative SIMULATION assumption, not a hosting/gas quote
    healthyDays: 60,
    lowDays: 21,
    payee: 'imd-paid-work',
    cycleEveryMs: { healthy: 86400_000, low: 3 * 86400_000, critical: Infinity },
  };
}

/** Runway tier from the treasury's IMD balance. Essential operation outranks content and prizes. */
export function runway(imdBalance, cfg) {
  const daily = cfg.essentialDailyImd + cfg.paidCycleCostImd;
  const days = Number(imdBalance / (daily || 1n));
  const essentialDays = Number(imdBalance / (cfg.essentialDailyImd || 1n));
  const tier = days >= cfg.healthyDays ? 'healthy' : days >= cfg.lowDays ? 'low' : 'critical';
  return { imd: imdBalance.toString(), days, essentialDays, tier, paidContentAllowed: tier !== 'critical' };
}

// ------------------------------------------------------------------ swarm memory / rules

export function remember(db, key, value) {
  run(db, 'INSERT INTO swarm_memory(key, value, updated_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, JSON.stringify(value), Date.now());
}
export function recall(db, key, dflt = null) {
  const r = one(db, 'SELECT value FROM swarm_memory WHERE key = ?', key);
  return r ? JSON.parse(r.value) : dflt;
}

export const RULES_V1 = {
  version: 1,
  content: {
    stages: ['author', 'review', 'test', 'publish'],
    reviewerMustDifferFromAuthor: true,
    generateAheadMs: 'until next day boundary',
    maxPacksPerDay: 1,
    rollback: 'mark version rolled_back (stop new floors) or unsafe (regenerate active floors)',
    neverExecutes: 'packs are data; engine interprets whitelisted effect kinds only',
  },
  finance: {
    authority: 'onchain timelocked parameters only; content pipeline cannot change them',
    payments: 'OpsTreasury.payWork by isolated paymentSigner, allowlisted payee, unique invoice, epoch caps',
    retries: MAX_ATTEMPTS,
  },
  priorities: ['player claims', 'essential operation', 'gameplay', 'content', 'prizes from reserve (independent of ops budget)'],
};

export function ensureRules(db) {
  if (!one(db, 'SELECT 1 FROM rules WHERE version = 1')) run(db, 'INSERT INTO rules(version, body, created_at) VALUES(1, ?, ?)', JSON.stringify(RULES_V1), Date.now());
  return JSON.parse(one(db, 'SELECT body FROM rules ORDER BY version DESC LIMIT 1').body);
}

// ------------------------------------------------------------------ payments

/** Queue + send a payment exactly once per invoice. Returns final status. */
export async function payInvoice(db, chain, { invoiceId, cycleId, payee, amount }) {
  run(db, 'INSERT OR IGNORE INTO payments(invoice_id, cycle_id, payee, amount, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)', invoiceId, cycleId, payee, amount.toString(), 'queued', Date.now(), Date.now());
  const p = one(db, 'SELECT * FROM payments WHERE invoice_id = ?', invoiceId);
  if (p.cycle_id !== cycleId || p.payee !== payee || p.amount !== amount.toString()) throw new Error('InvoiceConflict');
  if (p.status === 'confirmed' || p.status === 'deferred' || p.status === 'failed') return p.status;
  // External payer mode: this process holds no payment key; the isolated payer process sends it.
  if (chain.canPay === false) return 'queued';
  // Crash-safety: if a previous attempt reached the chain, don't send again.
  if (await chain.invoicePaid(invoiceId)) {
    run(db, "UPDATE payments SET status = 'confirmed', updated_at = ? WHERE invoice_id = ?", Date.now(), invoiceId);
    return 'confirmed';
  }
  if (p.attempts >= MAX_ATTEMPTS) {
    run(db, "UPDATE payments SET status = 'failed', updated_at = ? WHERE invoice_id = ?", Date.now(), invoiceId);
    return 'failed';
  }
  run(db, "UPDATE payments SET attempts = attempts + 1, status = 'sending', updated_at = ? WHERE invoice_id = ?", Date.now(), invoiceId);
  try {
    const r = await chain.payWork(payee, amount, invoiceId);
    tx(db, () => {
      run(db, "UPDATE payments SET status = 'confirmed', tx_hash = ?, updated_at = ? WHERE invoice_id = ?", r.txHash, Date.now(), invoiceId);
      run(db, "INSERT INTO ledger(ts, kind, asset, amount, note) VALUES(?, 'paid_work', 'IMD', ?, ?)", Date.now(), amount.toString(), invoiceId);
    });
    return 'confirmed';
  } catch (e) {
    // Cap/floor/freeze refusals are policy, not transient: defer and use the free fallback.
    const policy = /BelowFloor|OverCap|IsFrozen|NotPayee|DuplicateInvoice/.test(e.message);
    run(db, 'UPDATE payments SET status = ?, error = ?, updated_at = ? WHERE invoice_id = ?', policy ? 'deferred' : 'queued', e.message, Date.now(), invoiceId);
    return policy ? 'deferred' : 'retry';
  }
}

// ------------------------------------------------------------------ the cycle

/**
 * Run (or resume) one content cycle. `paidAuthor` is used only when runway allows and payment
 * succeeds; otherwise the free LocalAuthor fallback keeps content flowing.
 */
export async function runContentCycle(db, { registry, chain, cycleId, budgetCfg = defaultBudgetConfig(), paidAuthor = null, fallbackAuthor = new LocalAuthor(), activateAt = Date.now(), testPlayers = 24, log = () => {} }) {
  let cyc = one(db, 'SELECT * FROM ops_cycles WHERE id = ?', cycleId);
  if (!cyc) {
    run(db, 'INSERT INTO ops_cycles(id, kind, stage, status, started_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)', cycleId, 'content', 'author', 'running', Date.now(), Date.now());
    cyc = one(db, 'SELECT * FROM ops_cycles WHERE id = ?', cycleId);
  }
  if (cyc.status === 'done' || cyc.status === 'rejected') return cyc;
  if (cyc.attempts >= MAX_ATTEMPTS) {
    run(db, "UPDATE ops_cycles SET status = 'failed', updated_at = ? WHERE id = ?", Date.now(), cycleId);
    return one(db, 'SELECT * FROM ops_cycles WHERE id = ?', cycleId);
  }
  run(db, 'UPDATE ops_cycles SET attempts = attempts + 1, status = ?, updated_at = ? WHERE id = ?', 'running', Date.now(), cycleId);
  const setStage = (stage, detail) => run(db, 'UPDATE ops_cycles SET stage = ?, detail = ?, updated_at = ? WHERE id = ?', stage, JSON.stringify(detail ?? {}), Date.now(), cycleId);
  const packId = `pack-${cycleId}`;
  try {
    const base = registry.active();
    const nextVersion = (one(db, 'SELECT max(version) v FROM content_versions').v ?? 1) + 1;

    if (cyc.stage === 'author') {
      const rw = runway(chain.imdBalance(), budgetCfg);
      let author = fallbackAuthor, paid = 'not-attempted';
      if (paidAuthor && rw.paidContentAllowed) {
        paid = await payInvoice(db, chain, { invoiceId: `inv:${cycleId}`, cycleId, payee: budgetCfg.payee, amount: budgetCfg.paidCycleCostImd });
        if (paid === 'confirmed') author = paidAuthor;
        else if ((paid === 'queued' || paid === 'retry') && Date.now() - cyc.started_at < PAYMENT_WAIT_MS) {
          run(db, "UPDATE ops_cycles SET status = 'waiting', attempts = attempts - 1, detail = ?, updated_at = ? WHERE id = ?", JSON.stringify({ waitingFor: `inv:${cycleId}` }), Date.now(), cycleId);
          return one(db, 'SELECT * FROM ops_cycles WHERE id = ?', cycleId);
        }
      }
      let pack;
      try {
        pack = await author.author({ cycleId, version: nextVersion, existing: base, memory: recall(db, 'rejections', []) });
      } catch (e) {
        log(`author ${author.label} failed (${e.message}); using fallback`);
        pack = await fallbackAuthor.author({ cycleId, version: nextVersion, existing: base });
        author = fallbackAuthor;
      }
      pack.id = packId;
      run(db, 'INSERT OR REPLACE INTO content_packs(id, cycle_id, body, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)', packId, cycleId, JSON.stringify(pack), 'drafted', Date.now(), Date.now());
      setStage('review', { author: author.label, paid, runway: rw });
      cyc.stage = 'review';
    }

    const pack = JSON.parse(one(db, 'SELECT body FROM content_packs WHERE id = ?', packId).body);

    if (cyc.stage === 'review') {
      const verdict = reviewPack(pack, base, base.tags);
      run(db, 'UPDATE content_packs SET status = ?, review = ?, updated_at = ? WHERE id = ?', verdict.ok ? 'reviewed' : 'rejected', JSON.stringify(verdict), Date.now(), packId);
      if (!verdict.ok) {
        const rej = recall(db, 'rejections', []);
        remember(db, 'rejections', rej.concat(verdict.problems).slice(-50));
        run(db, "UPDATE ops_cycles SET stage = 'review', status = 'rejected', detail = ?, updated_at = ? WHERE id = ?", JSON.stringify(verdict), Date.now(), cycleId);
        log(`cycle ${cycleId}: pack rejected by review: ${verdict.problems.slice(0, 3).join('; ')}`);
        return one(db, 'SELECT * FROM ops_cycles WHERE id = ?', cycleId);
      }
      setStage('test', verdict);
      cyc.stage = 'test';
    }

    if (cyc.stage === 'test') {
      const prevPacks = JSON.parse(one(db, 'SELECT packs FROM content_versions WHERE version = ?', base.version).packs)
        .map((id) => JSON.parse(one(db, 'SELECT body FROM content_packs WHERE id = ?', id).body));
      const candidate = buildContent([...prevPacks, pack], nextVersion);
      const sim = runSimulation({ players: testPlayers, days: 1, actionsPerDay: [120, 260], content: candidate, seedTag: cycleId });
      const newIds = new Set((pack.effects ?? []).map((e) => e.id));
      const failures = [];
      if (sim.errors > sim.actions * 0.02) failures.push(`illegal-action rate ${sim.errors}/${sim.actions}`);
      if (sim.maxEffectPickShare > 0.15) failures.push(`dominant effect share ${sim.maxEffectPickShare}`);
      if (sim.deaths > testPlayers * 4) failures.push(`death spike ${sim.deaths}`);
      const result = { ok: failures.length === 0, failures, sim: { actions: sim.actions, errors: sim.errors, deaths: sim.deaths, maxEffectPickShare: sim.maxEffectPickShare, newEffects: newIds.size } };
      run(db, 'UPDATE content_packs SET status = ?, test = ?, updated_at = ? WHERE id = ?', result.ok ? 'tested' : 'rejected', JSON.stringify(result), Date.now(), packId);
      if (!result.ok) {
        run(db, "UPDATE ops_cycles SET status = 'rejected', detail = ?, updated_at = ? WHERE id = ?", JSON.stringify(result), Date.now(), cycleId);
        return one(db, 'SELECT * FROM ops_cycles WHERE id = ?', cycleId);
      }
      setStage('publish', result);
      cyc.stage = 'publish';
    }

    if (cyc.stage === 'publish') {
      tx(db, () => {
        const already = one(db, "SELECT version FROM content_versions WHERE packs LIKE ?", `%"${packId}"%`);
        if (!already) {
          const latest = one(db, "SELECT packs FROM content_versions WHERE status = 'published' ORDER BY version DESC LIMIT 1");
          const packs = JSON.parse(latest?.packs ?? '[]').concat(packId);
          const v = (one(db, 'SELECT max(version) v FROM content_versions').v ?? 1) + 1;
          run(db, 'INSERT INTO content_versions(version, packs, status, activate_at, created_at, note) VALUES(?, ?, ?, ?, ?, ?)', v, JSON.stringify(packs), 'published', activateAt, Date.now(), `cycle ${cycleId}`);
          run(db, "UPDATE content_packs SET status = 'published', updated_at = ? WHERE id = ?", Date.now(), packId);
        }
        run(db, "UPDATE ops_cycles SET stage = 'done', status = 'done', updated_at = ? WHERE id = ?", Date.now(), cycleId);
      });
      remember(db, 'lastCycle', { cycleId, at: Date.now() });
      log(`cycle ${cycleId}: published`);
    }
  } catch (e) {
    run(db, "UPDATE ops_cycles SET status = 'error', detail = ?, updated_at = ? WHERE id = ?", JSON.stringify({ error: e.message }), Date.now(), cycleId);
    run(db, "INSERT INTO outages(component, started_at, ended_at, note) VALUES('content', ?, ?, ?)", Date.now(), Date.now(), `cycle ${cycleId}: ${e.message}`);
    log(`cycle ${cycleId}: error ${e.message} (resumable)`);
  }
  return one(db, 'SELECT * FROM ops_cycles WHERE id = ?', cycleId);
}

/** Isolated payer process: sends queued payments with the payment key only it holds. */
export async function processQueuedPayments(db, chain) {
  const out = [];
  for (const p of all(db, "SELECT * FROM payments WHERE status IN ('queued','sending') ORDER BY created_at LIMIT 20")) {
    out.push({ invoice: p.invoice_id, status: await payInvoice(db, chain, { invoiceId: p.invoice_id, cycleId: p.cycle_id, payee: p.payee, amount: BigInt(p.amount) }) });
  }
  return out;
}

export function rollback(db, version, mode = 'rolled_back') {
  if (version === 1) throw new Error('base content cannot be rolled back');
  if (!['rolled_back', 'unsafe'].includes(mode)) throw new Error('mode');
  run(db, 'UPDATE content_versions SET status = ?, note = coalesce(note, \'\') || ? WHERE version = ?', mode, ` [${mode} ${new Date().toISOString()}]`, version);
}

export function contentHistory(db) {
  return all(db, 'SELECT version, packs, status, activate_at, created_at, note FROM content_versions ORDER BY version DESC LIMIT 30')
    .map((r) => ({ ...r, packs: JSON.parse(r.packs) }));
}
