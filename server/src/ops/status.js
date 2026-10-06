// Public operating status: version/history, runway, spend, reserves, liabilities, liquidity,
// outages. Everything here is safe to publish (no secrets, no per-player data).
import { all, getMeta } from '../db.js';
import { contentHistory, runway, ensureRules } from './pipeline.js';
import { recentOutages } from './keeper.js';
import { liabilities } from '../economy.js';

export function statusReport({ db, chain, game, budgetCfg, appVersion }) {
  const spend = all(db, "SELECT kind, asset, sum(CAST(amount AS REAL)) / 1e18 total, count(*) n FROM ledger WHERE ts > ? GROUP BY kind, asset", Date.now() - 7 * 86400_000);
  const epochs = all(db, 'SELECT epoch, status, total, root, randomness FROM epochs ORDER BY epoch DESC LIMIT 7');
  const payments = all(db, 'SELECT invoice_id, status, amount, attempts FROM payments ORDER BY created_at DESC LIMIT 10');
  const rules = ensureRules(db);
  return {
    app: { version: appVersion, chain: chain.kind, chainId: chain.chainId, labelled: chain.kind === 'sim' ? 'LOCAL SIMULATION — test fixtures, no real assets' : null },
    season: game.season(), day: game.day(), depthGate: game.maxDepth(), dailyEvent: game.dailyEvent(),
    content: { active: game.registry.activeVersion(), history: contentHistory(db) },
    rules: { version: rules.version, priorities: rules.priorities },
    runway: runway(chain.imdBalance(), budgetCfg),
    treasury: { imd: chain.imdBalance().toString(), dcp: chain.balanceOf('DCP', chain.addr.treasury).toString() },
    reserve: { balance: chain.balanceOf('DCP', chain.addr.reserve).toString(), outstanding: chain.reserveOutstanding().toString(), epochCap: chain.epochCap().toString() },
    playerLiabilities: liabilities(db),
    liquidity: chain.liquidity(),
    spend7d: spend,
    payments,
    epochs,
    keeper: (() => { const tick = getMeta(db, 'lastTick'); return tick && { at: tick.at, results: tick.results.map(({ name, ok }) => ({ name, ok })) }; })(),
    settlementHalted: !!getMeta(db, 'chainHalted'),
    outages: recentOutages(db).map(({ component, started_at, ended_at }) => ({ component, started_at, ended_at, note: 'See private operator diagnostics' })),
    disclaimers: [
      'No yield, returns or perpetual service are promised. Prizes are small, capped, and may stop.',
      'Final contract claims with published proofs can be paid by GameReserve without an operator. Pending off-chain awards still depend on settlement and proof publication.',
    ],
  };
}
