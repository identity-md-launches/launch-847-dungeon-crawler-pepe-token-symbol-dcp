// Bot policies used by the variety simulation and load tests. Each archetype plays differently
// (greedy, cautious, chaotic, sponsor-addict, quester...) so measurements reflect real choice
// diversity rather than one scripted path.
import { Rng } from '../game/rng.js';
import { activeSynergies } from '../game/powers.js';

export const ARCHETYPES = ['greedy', 'cautious', 'chaotic', 'sellout', 'quester', 'synergist', 'speedrunner', 'hoarder'];

export function chooseAction(ch, content, archetype, rng) {
  const p = ch.pending;
  if (!p) {
    const here = ch.map.nodes[ch.node];
    const opts = here.next.map((i) => ch.map.nodes[i]).filter((n) => !n.hidden || unlockedLike(n, ch));
    const pref = {
      greedy: ['treasure', 'elite', 'secret', 'side'], cautious: ['rest', 'shop', 'combat'], chaotic: [],
      sellout: ['sponsor', 'shop'], quester: ['quest', 'secret'], synergist: ['shrine', 'elite', 'secret'],
      speedrunner: ['stairs', 'combat'], hoarder: ['treasure', 'shop', 'secret'],
    }[archetype] ?? [];
    const scored = opts.map((n) => ({ n, w: pref.includes(n.type) ? 4 - pref.indexOf(n.type) * 0.5 : 1 }));
    return { type: 'move', to: rng.weighted(scored, (x) => x.w).n.id };
  }
  switch (p.kind) {
    case 'combat': {
      const cb = p.cb;
      if (ch.hp < ch.maxHp * 0.3 && ch.potions > 0) return { type: 'potion' };
      if (archetype === 'cautious' && ch.hp < ch.maxHp * 0.5 && !cb.elite && rng.chance(0.3)) return { type: 'flee' };
      if (archetype === 'chaotic' && rng.chance(0.25)) return { type: 'taunt' };
      if (ch.hp < ch.maxHp * 0.4 && rng.chance(0.3)) return { type: 'defend' };
      if (cb.skillCd === 0) return { type: 'skill' };
      return { type: archetype === 'sellout' && rng.chance(0.15) ? 'taunt' : 'attack' };
    }
    case 'offer': {
      if (archetype === 'chaotic') return ch.powers.length >= 24 ? { type: 'skip' } : { type: 'choose', index: rng.int(p.offers.length) };
      // Score offers by synergy with current build, rarity and drawback tolerance.
      const tags = {};
      for (const q of ch.powers) for (const t of q.tags) tags[t] = (tags[t] ?? 0) + 1;
      const rar = { Common: 1, Rare: 1.4, Epic: 1.8, Unhinged: 2.3 };
      const scored = p.offers.map((o, i) => {
        // Normalise by the atom's base so percentage effects don't look 'bigger' than damage.
        let s = (o.magnitude / (content.effectById[o.effect]?.base ?? 5)) * rar[o.rarity];
        if (archetype === 'synergist') s += o.tags.reduce((a, t) => a + (tags[t] ?? 0), 0);
        if (archetype === 'cautious' && o.drawback !== 'none') s *= 0.5;
        if (archetype === 'hoarder' && o.kind === 'gold') s *= 2;
        return { i, s: s * (0.6 + rng.next() * 0.8) };
      });
      scored.sort((a, b) => b.s - a.s);
      if (ch.powers.length >= 24) {
        const rel = (q) => q.magnitude / (content.effectById[q.effect]?.base ?? 5);
        let weakest = 0;
        ch.powers.forEach((q, i) => { if (rel(q) < rel(ch.powers[weakest])) weakest = i; });
        return { type: 'choose', index: scored[0].i, replace: weakest };
      }
      return { type: 'choose', index: scored[0].i };
    }
    case 'quest': return { type: 'quest', choice: rng.pick(p.choices).id };
    case 'shop': {
      const want = ch.curses.length ? 'uncurse' : ch.potions < 2 ? 'potion' : archetype === 'hoarder' ? null : 'perk';
      const it = p.stock.find((s) => s.id === want);
      if (it && ch.gold >= it.price && !p.bought) { p.bought = true; return { type: 'buy', choice: it.id }; }
      return { type: 'leave' };
    }
    case 'sponsor': return { type: 'sponsor', choice: ch.powers.length < 24 && (archetype === 'sellout' || (archetype !== 'cautious' && rng.chance(0.4))) ? 'accept' : 'decline' };
    case 'rest': return { type: 'rest', choice: ch.hp < ch.maxHp * 0.7 ? 'heal' : 'train' };
    case 'shrine': {
      const ids = p.options.map((o) => o.id);
      if (archetype === 'synergist' && ids.includes('transmute') && rng.chance(0.5)) return { type: 'shrine', choice: 'transmute' };
      if (ch.curses.length && ch.gold >= 15 + ch.floor * 3) return { type: 'shrine', choice: 'tithe' };
      return { type: 'shrine', choice: rng.pick(['pray', 'blood', 'pray']) === 'blood' && ch.maxHp > 30 ? 'blood' : 'pray' };
    }
    case 'stairs': return { type: 'descend' };
    default: return { type: 'leave' };
  }
}

function unlockedLike(n, ch) {
  const [k, v] = n.requires.split(':');
  if (k === 'secret') return ch.secretKeys > 0;
  if (k === 'tag') return ch.powers.some((p) => p.tags.includes(v));
  if (k === 'hype') return ch.hype >= Number(v);
  if (k === 'gold') return ch.gold >= Number(v);
  return false;
}

export function buildSummary(ch, content) {
  return {
    tags: (() => { const t = {}; for (const p of ch.powers) for (const x of p.tags) t[x] = (t[x] ?? 0) + 1; return t; })(),
    synergies: activeSynergies(content, ch).map((s) => s.id),
  };
}

export { Rng };
