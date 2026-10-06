// Assembles the active ContentSet from the base pack plus reviewed, published swarm packs.
// A ContentSet is immutable and identified by its version; characters pin the version their
// current floor was generated with, so publishing or rolling back never breaks a live encounter.
import * as base from '../content/base.js';

const LISTS = ['effects', 'triggers', 'modifiers', 'drawbacks', 'monsterBodies', 'monsterAffixes', 'biomes', 'quests', 'callbacks', 'dailyEvents', 'afflictions'];

export function buildContent(packs = [], version = 1) {
  const c = {
    version,
    world: base.WORLD,
    classes: base.CLASSES,
    tags: base.TAGS,
    effects: base.EFFECTS.map((x) => ({ ...x, pack: 'base' })),
    triggers: base.TRIGGERS,
    modifiers: base.MODIFIERS,
    drawbacks: base.DRAWBACKS,
    synergies: base.SYNERGIES,
    monsterBodies: base.MONSTER_BODIES,
    monsterAffixes: base.MONSTER_AFFIXES,
    behaviours: base.BEHAVIOURS,
    biomes: base.BIOMES,
    afflictions: base.AFFLICTIONS,
    sponsors: base.SPONSORS,
    npcs: base.NPCS,
    quests: base.QUESTS,
    callbacks: base.CALLBACKS,
    dailyEvents: base.DAILY_EVENTS,
    itemBases: base.ITEM_BASES,
    materials: base.MATERIALS,
    deathLines: base.DEATH_LINES,
    cultNames: base.CULT_NAMES,
    deadNames: base.DEAD_NAMES,
    packs: [{ id: 'base', version: base.PACK_VERSION }],
  };
  for (const pack of packs) {
    for (const key of LISTS) {
      if (!Array.isArray(pack[key])) continue;
      const ids = new Set(c[key].map((x) => x.id ?? JSON.stringify(x)));
      const add = pack[key].filter((x) => !ids.has(x.id ?? JSON.stringify(x))).map((x) => (typeof x === 'object' ? { ...x, pack: pack.id } : x));
      c[key] = c[key].concat(add);
    }
    c.packs.push({ id: pack.id, version: pack.version });
  }
  c.classById = Object.fromEntries(c.classes.map((x) => [x.id, x]));
  c.effectById = Object.fromEntries(c.effects.map((x) => [x.id, x]));
  c.triggerById = Object.fromEntries(c.triggers.map((x) => [x.id, x]));
  c.modifierById = Object.fromEntries(c.modifiers.map((x) => [x.id, x]));
  c.drawbackById = Object.fromEntries(c.drawbacks.map((x) => [x.id, x]));
  c.questById = Object.fromEntries(c.quests.map((x) => [x.id, x]));
  return Object.freeze(c);
}
