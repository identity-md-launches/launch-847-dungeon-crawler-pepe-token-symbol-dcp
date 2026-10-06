// Power composer: effect × trigger × modifier × drawback, validated and budgeted.
// The space is combinatorial (30×20×15×11 base atoms ≈ 99k signatures before magnitude,
// plus every published swarm pack), and offers are steered by each player's tags and history
// and away from what the population is already picking — so builds diverge instead of
// converging on one ladder.

export const EFFECT_KINDS = new Set([
  'damage', 'poison', 'bleed', 'burn', 'heal', 'shield', 'gold', 'minion', 'hype', 'stun',
  'weaken', 'reflect', 'drain', 'chaos', 'extra_action', 'crit_chance',
]);

export const signature = (p) => `${p.effect}:${p.trigger}:${p.modifier}:${p.drawback}`;

/** Returns null if the combination is valid, else a reason string. */
export function validateCombo(content, effect, trigger, modifier, drawback, ownedTags) {
  if (!EFFECT_KINDS.has(effect.kind)) return 'unknown effect kind';
  if (trigger.needs === 'can_flee' && drawback.noFlee) return 'flee trigger with no-flee drawback';
  if (trigger.id === 'on_flee' && ownedTags.has('noflee')) return 'already cannot flee';
  if (modifier.delay && (trigger.id === 'on_kill' || trigger.id === 'on_flee')) return 'delayed effect after combat ends';
  if (modifier.echo && effect.kind === 'extra_action') return 'echoing extra actions loops';
  if (effect.kind === 'extra_action' && ['on_hit', 'on_skill', 'on_damaged', 'on_block', 'on_crit'].includes(trigger.id)) return 'extra-action feedback loop';
  if (modifier.chain && ['heal', 'shield', 'gold', 'hype', 'extra_action', 'crit_chance', 'minion'].includes(effect.kind)) return 'chain on self effect';
  if (modifier.random && ['heal', 'shield', 'gold', 'hype', 'extra_action', 'crit_chance'].includes(effect.kind)) return 'random target on self effect';
  if (modifier.scale === 'minions' && effect.kind === 'minion') return 'self-scaling minions';
  if (drawback.hypeCost && effect.kind === 'hype') return 'hype refunds itself';
  if (trigger.needsTag && !ownedTags.has(trigger.needsTag) && !(effect.tags ?? []).includes(trigger.needsTag)) return 'trigger needs ' + trigger.needsTag;
  return null;
}

/** Power budget: keeps every combo inside reward bounds while breadth stays unbounded. */
export function powerScore(effect, trigger, modifier, drawback) {
  return effect.base * trigger.power * modifier.mult - effect.base * drawback.offset;
}
export const SCORE_MIN = 1.5;
export const SCORE_MAX = 14;

const RARITY = [
  { name: 'Common', mag: 1.0, w: 60 },
  { name: 'Rare', mag: 1.35, w: 28 },
  { name: 'Epic', mag: 1.7, w: 10 },
  { name: 'Unhinged', mag: 2.1, w: 2 },
];

const NAME_A = ['Unholy', 'Moist', 'Tactical', 'Litigious', 'Spiteful', 'Bootleg', 'Sacred', 'Feral', 'Corporate', 'Haunted', 'Sticky', 'Disrespectful', 'Premium', 'Cursed', 'Overdue', 'Thicc', 'Bureaucratic', 'Petty'];
const NAME_B = { damage: 'Smackdown', poison: 'Miasma', bleed: 'Gash', burn: 'Arson', heal: 'Snack', shield: 'Bulwark', gold: 'Grift', minion: 'Entourage', hype: 'Spectacle', stun: 'Bonk', weaken: 'Hex', reflect: 'Uno Reverse', drain: 'Slurp', chaos: 'Coinflip', extra_action: 'Zoomies', crit_chance: 'Groin Sense' };

export function composePower(content, rng, { effect, trigger, modifier, drawback }, depth) {
  const rarity = rng.weighted(RARITY, (r) => r.w);
  const magnitude = Math.max(1, Math.round(effect.base * modifier.mult * rarity.mag * (1 + depth * 0.06)));
  const nameA = rng.pick(NAME_A);
  const name = `${nameA} ${NAME_B[effect.kind]}${trigger.id === 'on_kill' ? ' of the Recently Deceased' : ''}`;
  const tags = [...new Set([...(effect.tags ?? []), ...(drawback.id === 'noflee' ? ['noflee'] : [])])];
  return {
    id: `${signature({ effect: effect.id, trigger: trigger.id, modifier: modifier.id, drawback: drawback.id })}#${rng.int(1e9).toString(36)}`,
    sig: signature({ effect: effect.id, trigger: trigger.id, modifier: modifier.id, drawback: drawback.id }),
    effect: effect.id, kind: effect.kind, trigger: trigger.id, modifier: modifier.id, drawback: drawback.id,
    pack: effect.pack ?? 'base', rarity: rarity.name, magnitude, name, tags,
    text: `${trigger.text} ${effect.text.replace('{n}', magnitude)}${modifier.text ? ', ' + modifier.text : ''}.${drawback.text ? ' ' + drawback.text : ''}`,
  };
}

/**
 * Build `count` distinct, valid power offers for a character.
 * @param popularity Map of population pick shares, keyed by effect id and 'tag:<tag>' (anti-convergence)
 * @param focusTag optional tag to bias toward (quest/sponsor rewards)
 */
export function generateOffers(content, rng, ch, { count = 3, popularity = new Map(), focusTag = null } = {}) {
  const owned = new Set(ch.powers.map((p) => p.sig));
  const seen = new Set(ch.seenSigs ?? []);
  const ownedTags = new Set(ch.powers.flatMap((p) => p.tags).concat(content.classById[ch.classId]?.tags ?? []));
  const tagCounts = {};
  for (const p of ch.powers) for (const t of p.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  const uniform = 1 / content.effects.length;
  const uniformTag = 1 / content.tags.length;
  const offers = [];
  const usedEffects = new Set();
  let guard = 0;
  while (offers.length < count && guard++ < 400) {
    const slot = offers.length;
    // Slot 0 leans into the build (synergy), slot 1 is exotic, slot 2 is a wildcard.
    const effect = rng.weighted(content.effects, (e) => {
      if (usedEffects.has(e.id)) return 0;
      const eTags = e.tags ?? [];
      const affinity = eTags.reduce((s, t) => s + (tagCounts[t] ?? 0) + (ownedTags.has(t) ? 1 : 0), 0);
      let w = slot === 0 ? 1 + affinity * 2 : slot === 1 ? (affinity === 0 ? 3 : 0.5) : 1;
      if (focusTag) w *= eTags.includes(focusTag) ? 6 : 0.4;
      const share = popularity.get(e.id) ?? uniform;
      w *= Math.min(2, Math.max(0.25, uniform / Math.max(share, 1e-6))); // under-picked effects float up
      for (const t of eTags) {
        const ts = popularity.get('tag:' + t);
        if (ts !== undefined) w *= Math.min(1.6, Math.max(0.4, uniformTag / Math.max(ts, 1e-6)));
      }
      if (e.pack && e.pack !== 'base') w *= 1.5; // freshly published content gets airtime
      return w;
    });
    const trigger = rng.weighted(content.triggers);
    const modifier = rng.weighted(content.modifiers);
    const drawback = rng.weighted(content.drawbacks);
    if (validateCombo(content, effect, trigger, modifier, drawback, ownedTags)) continue;
    const score = powerScore(effect, trigger, modifier, drawback);
    if (score < SCORE_MIN || score > SCORE_MAX) continue;
    const sig = signature({ effect: effect.id, trigger: trigger.id, modifier: modifier.id, drawback: drawback.id });
    if (owned.has(sig)) continue;
    if (seen.has(sig) && guard < 300) continue; // don't re-offer what this player already saw
    usedEffects.add(effect.id);
    offers.push(composePower(content, rng, { effect, trigger, modifier, drawback }, ch.floor));
  }
  return offers;
}

export function activeSynergies(content, ch) {
  const counts = {};
  for (const p of ch.powers) for (const t of p.tags) counts[t] = (counts[t] ?? 0) + 1;
  for (const t of content.classById[ch.classId]?.tags ?? []) counts[t] = (counts[t] ?? 0) + 1;
  return content.synergies.filter((s) => (counts[s.tag] ?? 0) >= s.at);
}

/** Population pick counts → popularity map consumed by generateOffers. */
export function popularityFrom(content, effectCounts) {
  const total = [...effectCounts.values()].reduce((a, b) => a + b, 0);
  const m = new Map();
  if (total < 50) return m;
  const tagCounts = {};
  let tagTotal = 0;
  for (const [id, n] of effectCounts) {
    m.set(id, n / total);
    for (const t of content.effectById[id]?.tags ?? []) { tagCounts[t] = (tagCounts[t] ?? 0) + n; tagTotal += n; }
  }
  for (const [t, n] of Object.entries(tagCounts)) m.set('tag:' + t, n / tagTotal);
  return m;
}

export function dominantTag(ch) {
  const counts = {};
  for (const p of ch.powers) for (const t of p.tags) if (t !== 'noflee') counts[t] = (counts[t] ?? 0) + 1;
  let best = 'none', n = 0;
  for (const [t, c] of Object.entries(counts)) if (c > n || (c === n && t < best)) { best = t; n = c; }
  return best;
}
