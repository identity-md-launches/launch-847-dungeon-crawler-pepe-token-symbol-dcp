// The keeper: one tick drives every scheduled transition. Contracts cannot wake themselves,
// so this process (run by an isolated operator, see deploy/) pokes them. Every task is
// idempotent, failures are recorded as outages and never stop the other tasks, and nothing
// here can move player funds: claims go from GameReserve straight to players.
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { all, one, run, backupTo, getMeta, setMeta } from '../db.js';
import { advanceEpochs } from '../economy.js';
import { runContentCycle, runway, defaultBudgetConfig, ensureRules } from './pipeline.js';

export class Keeper {
  constructor({ db, chain, game, indexer, econCfg, budgetCfg = defaultBudgetConfig(), paidAuthor = null, backupDir = null, backupEveryMs = 6 * 3600_000, keepBackups = 12, log = () => {}, contentActivateAhead = true }) {
    Object.assign(this, { db, chain, game, indexer, econCfg, budgetCfg, paidAuthor, backupDir, backupEveryMs, keepBackups, log, contentActivateAhead });
    ensureRules(db);
  }

  /** Contract epoch for a timestamp: day index + 1, matching GameReserve.currentEpoch(). */
  epochAt(t) { return this.game.day(t) + 1; }

  async task(name, fn) {
    try {
      await fn();
      return { name, ok: true };
    } catch (e) {
      run(this.db, 'INSERT INTO outages(component, started_at, ended_at, note) VALUES(?, ?, ?, ?)', name, Date.now(), Date.now(), String(e.message).slice(0, 300));
      this.log(`[keeper] ${name} failed: ${e.message}`);
      return { name, ok: false, error: e.message };
    }
  }

  async tick(now = this.game.now()) {
    const results = [];
    results.push(await this.task('chain-refresh', () => this.chain.refresh()));
    results.push(await this.task('indexer', () => this.indexer.poll()));
    const epoch = this.epochAt(now);
    results.push(await this.task('epochs', () => advanceEpochs(this.db, this.chain, this.econCfg, { currentEpoch: epoch, dayOf: (e) => e - 1, now, log: this.log })));
    results.push(await this.task('harvest', async () => {
      const last = getMeta(this.db, 'lastHarvestEpoch', 0);
      if (last >= epoch) return;
      const r = await this.chain.harvest();
      run(this.db, "INSERT INTO ledger(ts, kind, asset, amount, note) VALUES(?, 'fee_income', 'DCP', ?, 'harvest'), (?, 'fee_income', 'IMD', ?, 'harvest')", now, r.dcp.toString(), now, r.imd.toString());
      setMeta(this.db, 'lastHarvestEpoch', epoch);
    }));
    results.push(await this.task('content', async () => {
      const rw = runway(this.chain.imdBalance(), this.budgetCfg);
      const every = this.budgetCfg.cycleEveryMs[rw.tier];
      const lastAt = getMeta(this.db, 'lastContentCycleAt', 0);
      const pending = one(this.db, "SELECT id FROM ops_cycles WHERE kind = 'content' AND status IN ('running','error','waiting') ORDER BY started_at DESC LIMIT 1");
      // Even with no budget the free fallback author still runs (slower cadence), so content
      // keeps evolving; paid work stops first.
      const cadence = Number.isFinite(every) ? every : this.budgetCfg.cycleEveryMs.low * 2;
      if (!pending && now - lastAt < cadence) return;
      const cycleId = pending?.id ?? `c${epoch}-${now.toString(36)}`;
      const nextDay = this.game.season().startMs + (this.game.day(now) + 1) * this.game.dayMs;
      const cyc = await runContentCycle(this.db, {
        registry: this.game.registry, chain: this.chain, cycleId, budgetCfg: this.budgetCfg,
        paidAuthor: rw.paidContentAllowed ? this.paidAuthor : null,
        activateAt: this.contentActivateAhead ? nextDay : now, log: this.log,
      });
      if (['done', 'rejected', 'failed'].includes(cyc.status)) setMeta(this.db, 'lastContentCycleAt', now);
      if (cyc.status === 'error') throw new Error(`content cycle ${cycleId} errored; will resume`);
    }));
    results.push(await this.task('backup', async () => {
      if (!this.backupDir) return;
      const last = getMeta(this.db, 'lastBackupAt', 0);
      if (now - last < this.backupEveryMs) return;
      const file = join(this.backupDir, `dcp-${new Date(now).toISOString().replace(/[:.]/g, '-')}.sqlite`);
      backupTo(this.db, file);
      setMeta(this.db, 'lastBackupAt', now);
      const files = readdirSync(this.backupDir).filter((f) => f.endsWith('.sqlite')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - this.keepBackups))) rmSync(join(this.backupDir, f));
    }));
    results.push(await this.task('housekeeping', () => this.game.pruneActionLog()));
    setMeta(this.db, 'lastTick', { at: now, results });
    return results;
  }
}

export function recentOutages(db, limit = 20) {
  return all(db, 'SELECT component, started_at, ended_at, note FROM outages ORDER BY id DESC LIMIT ?', limit);
}
