// Per-character floor generation: a layered route graph whose size, node mix, biome,
// affliction, quests and secrets depend on the character's seed, depth, the shared daily
// event and the character's history flags.
import { Rng, historyHash } from './rng.js';

const NODE_WEIGHTS = { combat: 10, elite: 2, shop: 1.5, sponsor: 1.5, quest: 2, rest: 1.5, treasure: 1.5, trap: 1.5, shrine: 1.2, side: 0.8 };

export function generateFloor(content, seed, ch, depth, dailyEvent) {
  const rng = Rng.from(seed.toString('hex'), 'floor', depth, ch.deaths ?? 0, historyHash(ch.flags), content.version);
  const biome = rng.pick(content.biomes);
  const affliction = rng.pick(content.afflictions);
  const layers = Math.min(14, 5 + Math.floor(depth / 2) + rng.int(3));
  const mods = dailyEvent?.mod ?? {};
  const weights = { ...NODE_WEIGHTS };
  if (mods.sponsorMult) weights.sponsor *= mods.sponsorMult;
  if (mods.combatMult) weights.combat *= mods.combatMult;
  if (mods.eliteMult) weights.elite *= mods.eliteMult;
  const types = Object.entries(weights).map(([type, weight]) => ({ type, weight }));

  const nodes = [{ id: 0, layer: 0, type: 'entrance', next: [] }];
  let prev = [0];
  for (let L = 1; L <= layers; L++) {
    const width = rng.range(2, 4);
    const cur = [];
    for (let i = 0; i < width; i++) {
      const id = nodes.length;
      let type = rng.weighted(types).type;
      if (L === 1 && type === 'elite') type = 'combat';
      nodes.push({ id, layer: L, type, next: [] });
      cur.push(id);
    }
    for (const p of prev) {
      const k = rng.range(1, Math.min(2, cur.length));
      for (const t of rng.shuffle(cur).slice(0, k)) if (!nodes[p].next.includes(t)) nodes[p].next.push(t);
    }
    for (const c of cur) if (!prev.some((p) => nodes[p].next.includes(c))) nodes[rng.pick(prev)].next.push(c);
    prev = cur;
  }
  const stairs = nodes.length;
  nodes.push({ id: stairs, layer: layers + 1, type: 'stairs', next: [] });
  for (const p of prev) nodes[p].next.push(stairs);

  // Secrets: hidden off-route rooms unlocked by history (quests, items, synergies).
  const secretCount = 1 + rng.int(2) + (ch.flags?.form27 === 'complied' ? 1 : 0);
  for (let s = 0; s < secretCount; s++) {
    const host = rng.pick(nodes.slice(1, stairs));
    const id = nodes.length;
    const requires = rng.pick(['secret', 'tag:' + rng.pick(content.tags), 'hype:15', 'gold:40']);
    nodes.push({ id, layer: host.layer, type: 'secret', next: [...host.next], hidden: true, requires });
    host.next.push(id);
  }
  // Quest assignment: pick a quest the character hasn't resolved yet when possible.
  const done = new Set(ch.questsDone ?? []);
  for (const n of nodes) {
    if (n.type !== 'quest') continue;
    const fresh = content.quests.filter((q) => !done.has(q.id));
    n.quest = (fresh.length ? rng.pick(fresh) : rng.pick(content.quests)).id;
  }
  return { depth, biome: biome.id, biomeName: biome.name, biomeText: biome.text, affliction, nodes, contentVersion: content.version };
}

export function visibleNodes(floor, ch) {
  return floor.nodes.filter((n) => !n.hidden || unlocked(n, ch));
}

export function unlocked(node, ch) {
  if (!node.hidden) return true;
  const [k, v] = node.requires.split(':');
  if (k === 'secret') return (ch.secretKeys ?? 0) > 0;
  if (k === 'tag') return ch.powers.some((p) => p.tags.includes(v));
  if (k === 'hype') return ch.hype >= Number(v);
  if (k === 'gold') return ch.gold >= Number(v);
  return false;
}
