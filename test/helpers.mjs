// Shared fixtures for the Node test suites. Everything runs offline against SimChain.
import { createApp } from '../server/src/app.js';
import { openDb, setMeta, getMeta } from '../server/src/db.js';
import { createHash } from 'node:crypto';

export const E18 = 10n ** 18n;

export function makeApp(over = {}) {
  const db = over.db ?? openDb(over.dbPath ?? ':memory:');
  return createApp({
    demo: true,
    db,
    domain: 'test.local',
    origin: 'https://test.local',
    confirmations: 3,
    econ: { minAccountAgeMs: 0, minActions: 5, challengeMs: 3600_000 },
    log: () => {},
    ...over,
  });
}

export function advance(app, ms) {
  setMeta(app.db, 'demoClockOffset', getMeta(app.db, 'demoClockOffset', 0) + ms);
}

export const id = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 24);

/** Play `n` actions with a simple policy through the service (persists every step). */
export function playThroughService(app, accountId, charId, n, { policy } = {}) {
  let { rev, ch } = (() => { const r = app.game.load(accountId, charId); return { rev: r.row.rev, ch: r.ch }; })();
  for (let i = 0; i < n && ch.alive; i++) {
    const a = (policy ?? simplePolicy)(ch, i);
    try {
      const r = app.game.act(accountId, { charId, rev, actionId: `t-${charId}-${i}-${rev}`, action: a });
      rev = r.rev; ch = r.character;
    } catch (e) {
      if (e.status === 409) { rev = e.current.rev; ch = e.current.character; continue; }
      // illegal move: fall back to something always legal
      const fb = ch.pending?.kind === 'combat' ? { type: 'attack' } : ch.pending?.kind === 'offer' ? { type: 'skip' } : ch.pending ? { type: 'leave' } : null;
      if (!fb) throw e;
      try { const r = app.game.act(accountId, { charId, rev, actionId: `fb-${charId}-${i}-${rev}`, action: fb }); rev = r.rev; ch = r.character; } catch { /* keep going */ }
    }
  }
  return { rev, ch };
}

export function simplePolicy(ch, i) {
  const p = ch.pending;
  if (!p) { const here = ch.map.nodes[ch.node]; const opts = here.next.filter((x) => !ch.map.nodes[x].hidden); return { type: 'move', to: (opts.length ? opts : here.next)[i % (opts.length || here.next.length)] }; }
  switch (p.kind) {
    case 'combat': return ch.hp < ch.maxHp * 0.3 && ch.potions ? { type: 'potion' } : p.cb.skillCd === 0 ? { type: 'skill' } : { type: 'attack' };
    case 'offer': return ch.powers.length >= 24 ? { type: 'skip' } : { type: 'choose', index: i % p.offers.length };
    case 'quest': return { type: 'quest', choice: p.choices[i % p.choices.length].id };
    case 'sponsor': return { type: 'sponsor', choice: 'decline' };
    case 'rest': return { type: 'rest', choice: 'heal' };
    case 'shrine': return { type: 'leave' };
    case 'shop': return { type: 'leave' };
    case 'stairs': return { type: 'descend' };
    default: return { type: 'leave' };
  }
}
