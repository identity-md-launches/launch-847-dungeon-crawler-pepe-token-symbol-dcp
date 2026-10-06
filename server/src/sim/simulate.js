// Multi-day, multi-player variety simulation. Plays the real engine with diverse bot policies
// and measures convergence: duplicate upgrades across players, repeated offers, build
// diversity, layout uniqueness and dominant strategies.
import { createHash } from 'node:crypto';
import { buildContent } from '../game/content.js';
import { newCharacter, act, fameOf, GameError } from '../game/engine.js';
import { deriveSeed, Rng } from '../game/rng.js';
import { dominantTag, popularityFrom } from '../game/powers.js';
import { chooseAction, ARCHETYPES } from './bots.js';

export const depthGate = (day) => 3 + 2 * day;

export function runSimulation({ players = 120, days = 4, actionsPerDay = [150, 700], secret = 'sim-secret', steering = true, content = buildContent(), seedTag = 'v1' } = {}) {
  const picks = new Map(); // effectId -> count (population popularity)
  let totalPicks = 0;
  const popularity = () => (steering ? popularityFrom(content, picks) : new Map());
  const accounts = Array.from({ length: players }, (_, i) => ({
    id: `acct${i}`, archetype: ARCHETYPES[i % ARCHETYPES.length], chars: [], allSigs: new Set(), offersSeen: 0, offersRepeated: 0, seenEver: new Set(),
  }));
  const layoutHashes = new Map();
  let errors = 0, actions = 0, deaths = 0;
  for (let day = 0; day < days; day++) {
    const dailyEvent = content.dailyEvents[day % content.dailyEvents.length];
    const pop = popularity();
    for (const a of accounts) {
      const rng = Rng.from(seedTag, a.id, day, 'session');
      const budget = rng.range(actionsPerDay[0], actionsPerDay[1]);
      let ch = a.chars.at(-1);
      for (let k = 0; k < budget; k++) {
        if (!ch || !ch.alive) {
          const cid = `${a.id}-c${a.chars.length}`;
          const seed = deriveSeed(secret, cid);
          ch = newCharacter(content, seed, { id: cid, name: cid, classId: content.classes[(a.chars.length + Number(a.id.slice(4))) % content.classes.length].id, day, dailyEvent });
          ch._seed = seed;
          a.chars.push(ch);
          trackOffers(a, ch);
        }
        const ctx = { content, seed: ch._seed, dailyEvent, popularity: pop, maxDepth: depthGate(day) };
        if (ch.pending?.kind === 'stairs' && ch.floor >= ctx.maxDepth) {
          // At the gate: Overtime Zones keep play going without advancing depth.
          try { act(ctx, ch, { type: 'overtime' }); } catch { break; }
          continue;
        }
        const action = chooseAction(ch, content, a.archetype, rng);
        const prevFloor = ch.floor;
        try {
          const { events } = act(ctx, ch, action);
          actions++;
          for (const e of events) if (e.type === 'pick') { picks.set(e.effect, (picks.get(e.effect) ?? 0) + 1); totalPicks++; a.allSigs.add(e.sig); }
        } catch (e) {
          if (!(e instanceof GameError)) throw e;
          errors++;
          if (ch.pending?.kind === 'combat') { try { act(ctx, ch, { type: 'attack' }); } catch { /* ignore */ } }
          else if (ch.pending) { try { act(ctx, ch, { type: ch.pending.kind === 'offer' ? 'skip' : 'leave' }); } catch { ch.pending = null; } }
        }
        trackOffers(a, ch);
        if (ch.floor !== prevFloor || k === 0) {
          const h = createHash('sha1').update(JSON.stringify([ch.map.biome, ch.map.nodes.map((n) => n.type + n.next.length)])).digest('hex');
          const key = `${ch.floor}:${h}`;
          layoutHashes.set(key, (layoutHashes.get(key) ?? 0) + 1);
        }
        if (!ch.alive) deaths++;
      }
    }
  }
  return measure({ accounts, content, layoutHashes, errors, actions, deaths, picks, totalPicks, players, days, steering });
}

function trackOffers(a, ch) {
  const p = ch.pending;
  if (p?.kind !== 'offer' || p._tracked) return;
  p._tracked = true;
  for (const o of p.offers) {
    a.offersSeen++;
    if (a.seenEver.has(o.sig)) a.offersRepeated++;
    a.seenEver.add(o.sig);
  }
}

function entropy(counts) {
  const tot = counts.reduce((s, x) => s + x, 0);
  if (!tot) return 0;
  return -counts.reduce((s, x) => (x ? s + (x / tot) * Math.log2(x / tot) : s), 0);
}

function measure({ accounts, content, layoutHashes, errors, actions, deaths, picks, totalPicks, players, days, steering }) {
  // Pairwise Jaccard similarity of acquired power signatures (sampled pairs).
  let jSum = 0, jN = 0;
  for (let i = 0; i < accounts.length; i++) {
    for (let j = i + 1; j < accounts.length; j += 3) {
      const A = accounts[i].allSigs, B = accounts[j].allSigs;
      if (!A.size || !B.size) continue;
      let inter = 0;
      for (const x of A) if (B.has(x)) inter++;
      jSum += inter / (A.size + B.size - inter);
      jN++;
    }
  }
  const sigOwners = new Map();
  for (const a of accounts) for (const s of a.allSigs) sigOwners.set(s, (sigOwners.get(s) ?? 0) + 1);
  const totalOwned = [...sigOwners.values()].reduce((s, x) => s + x, 0);
  const sharedOwned = [...sigOwners.values()].filter((x) => x > 1).reduce((s, x) => s + x, 0);

  const finals = accounts.map((a) => a.chars.reduce((best, c) => (fameOf(c) > fameOf(best) ? c : best), a.chars[0]));
  const domTags = {};
  const synergySets = new Set();
  for (const c of finals) {
    const t = dominantTag(c);
    domTags[t] = (domTags[t] ?? 0) + 1;
    synergySets.add(Object.keys(c.flags).filter((k) => k.startsWith('syn_')).sort().join(','));
  }
  const domCounts = Object.values(domTags);
  const byArch = {};
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i], c = finals[i];
    const r = (byArch[a.archetype] ??= { n: 0, fame: 0, depth: 0, deaths: 0 });
    r.n++; r.fame += fameOf(c); r.depth += Math.max(...a.chars.map((x) => x.stats.bestDepth)); r.deaths += a.chars.filter((x) => !x.alive).length;
  }
  for (const r of Object.values(byArch)) { r.fame = Math.round(r.fame / r.n); r.depth = +(r.depth / r.n).toFixed(2); r.deaths = +(r.deaths / r.n).toFixed(2); }
  const top = finals.map((c, i) => ({ c, a: accounts[i].archetype })).sort((x, y) => fameOf(y.c) - fameOf(x.c)).slice(0, Math.max(10, Math.floor(players / 10)));
  const topArch = {};
  for (const t of top) topArch[t.a] = (topArch[t.a] ?? 0) + 1;
  const topShare = Math.max(...Object.values(topArch)) / top.length;
  const layoutDup = [...layoutHashes.values()].filter((x) => x > 1).reduce((s, x) => s + x, 0) / Math.max(1, [...layoutHashes.values()].reduce((s, x) => s + x, 0));
  const effectShares = [...picks.values()].map((v) => v / Math.max(1, totalPicks));

  return {
    config: { players, days, steering, contentVersion: content.version, packs: content.packs.map((p) => p.id) },
    actions, errors, deaths,
    distinctPowerSignatures: sigOwners.size,
    meanPowersPerAccount: +(totalOwned / players).toFixed(2),
    sharedSignatureRate: +(sharedOwned / Math.max(1, totalOwned)).toFixed(4),
    meanPairwiseJaccard: +(jSum / Math.max(1, jN)).toFixed(4),
    offerRepeatRate: +(accounts.reduce((s, a) => s + a.offersRepeated, 0) / Math.max(1, accounts.reduce((s, a) => s + a.offersSeen, 0))).toFixed(4),
    dominantTagEntropyBits: +entropy(domCounts).toFixed(3),
    dominantTagMaxBits: +Math.log2(content.tags.length).toFixed(3),
    dominantTags: domTags,
    distinctSynergyCombos: synergySets.size,
    maxEffectPickShare: +Math.max(...effectShares).toFixed(4),
    layoutDuplicateRate: +layoutDup.toFixed(4),
    topBracketMaxArchetypeShare: +topShare.toFixed(3),
    archetypes: byArch,
  };
}
