// Content authors. A content pack is pure data in the schema review.js enforces.
//
// LocalAuthor: a deterministic procedural author used offline and as the fallback when paid
//   work is unavailable or unaffordable. It recombines vocabulary into new effect atoms,
//   monsters, biomes, events and quests. Labelled as a local fixture, costs nothing.
// SwarmAuthor: the paid IMD swarm adapter. Its HTTP contract and payment authority are NOT
//   verified for this build, so it refuses to run unless explicitly provisioned (see
//   docs/launch-readiness.md). It never receives secrets or player-written text as
//   instructions; the brief it sends is built from structured game state only.
import { Rng } from '../game/rng.js';

const ADJ = ['Gristly', 'Weeping', 'Overcaffeinated', 'Notarised', 'Foreclosed', 'Chunky', 'Septic', 'Litigated', 'Fermented', 'Unlicensed', 'Gaslit', 'Haunted', 'Leaky', 'Boneless', 'Unionbusting', 'Microwaved'];
const NOUN = ['Lasagna Wraith', 'Tax Hound', 'Pustule Choir', 'Middle Manager', 'Septic Mermaid', 'Mortgage Golem', 'Clipboard Hydra', 'Discount Angel', 'Gym Bro Revenant', 'Karaoke Banshee', 'Parking Warden Ooze', 'Crypto Lich', 'Landlord Worm', 'Scented Candle Elemental'];
const QUIRK = ['smells like a wet dog that owes you money', 'won\'t stop talking about its podcast', 'has a restraining order against itself', 'is made of 60% regret by volume', 'keeps trying to sell you insurance', 'cries during the fight but hits harder', 'is visibly, alarmingly moist'];
const VERB = ['yeets', 'subpoenas', 'deep-fries', 'repossesses', 'body-slams', 'gaslights', 'unfriends', 'microwaves', 'evicts', 'spanks with a ledger'];
const KINDS = [
  ['damage', ['crit', 'chaos', 'fire', 'frost', 'void', 'bureaucracy'], [4, 8]],
  ['poison', ['poison', 'filth'], [2, 4]],
  ['bleed', ['bleed'], [2, 4]],
  ['burn', ['fire'], [2, 4]],
  ['heal', ['filth', 'shield'], [4, 7]],
  ['shield', ['shield', 'frost', 'bureaucracy'], [4, 7]],
  ['gold', ['gold', 'bureaucracy'], [4, 7]],
  ['minion', ['minion', 'curse'], [2, 3]],
  ['hype', ['hype', 'chaos'], [3, 5]],
  ['weaken', ['curse', 'frost'], [1, 3]],
  ['drain', ['void', 'curse'], [3, 5]],
];
const PLACES = ['Timeshare Presentation of the Damned', 'Haunted Carwash', 'Infinite Airport Layover', 'Water Park of Lost Bandaids', 'Bureau of Unclaimed Limbs', 'Strip-Mall Necropolis', 'Endless Baby Shower', 'Quarterly Review Dimension'];
const EVENTS = [
  ['Mandatory Fun Day', 'Taunting heals 1 HP. HR is watching.', { hypeMult: 1.5 }],
  ['Inflation Spike', 'Gold drops +25%, the IDSC has printed money again.', { goldMult: 1.25 }],
  ['Elite Job Fair', 'Elites everywhere, networking aggressively.', { eliteMult: 2.5 }],
  ['Quiet Quitting', 'Monsters have 15% less HP. They just don\'t care.', { enemyHp: 0.85 }],
];

export class LocalAuthor {
  constructor({ label = 'local-procedural-author' } = {}) { this.label = label; this.costImd = 0n; }
  async author({ cycleId, version, existing }) {
    const rng = Rng.from('author', cycleId, version);
    const used = new Set(existing.effects.map((e) => e.id));
    const effects = [];
    for (let i = 0; effects.length < 6 && i < 50; i++) {
      const [kind, tags, [lo, hi]] = rng.pick(KINDS);
      const id = `x${version}_${kind}_${rng.int(1e6).toString(36)}`;
      if (used.has(id)) continue;
      used.add(id);
      const tagSet = [rng.pick(tags)];
      if (rng.chance(0.3)) tagSet.push(rng.pick(['chaos', 'filth', 'hype', 'curse']));
      effects.push({ id, kind, base: rng.range(lo, hi), tags: [...new Set(tagSet)], text: `${rng.pick(VERB)} the enemy with ${rng.pick(ADJ).toLowerCase()} intent ({n})` });
    }
    const monsterBodies = Array.from({ length: 4 }, (_, i) => ({
      id: `m${version}_${i}_${rng.int(1e6).toString(36)}`, name: `${rng.pick(ADJ)} ${rng.pick(NOUN)}`, hp: rng.range(12, 28), atk: rng.range(3, 6), text: rng.pick(QUIRK),
    }));
    const place = rng.pick(PLACES);
    const biomes = [{ id: `b${version}_${rng.int(1e6).toString(36)}`, name: place, text: `Welcome to the ${place}. ${rng.pick(QUIRK).replace(/^is /, 'It is ').replace(/^(\w)/, (m) => m.toUpperCase())}.` }];
    const [en, et, emod] = rng.pick(EVENTS);
    const dailyEvents = [{ id: `e${version}_${rng.int(1e6).toString(36)}`, name: en, text: et, mod: emod }];
    const callbacks = [{ when: { kevin: 'enemy' }, line: `Kevin has started a support group for things you've killed. It meets in the ${place}.` }];
    return { id: `pack-${cycleId}`, version, author: this.label, effects, monsterBodies, biomes, dailyEvents, callbacks };
  }
}

export class SwarmAuthor {
  constructor({ endpoint, payment } = {}) { this.endpoint = endpoint; this.payment = payment; this.label = 'imd-swarm'; this.costImd = 0n; }
  async author() {
    if (!this.endpoint || !this.payment) throw new Error('NotProvisioned: IMD swarm work API and payment identity are not configured for this build');
    throw new Error('NotProvisioned: SwarmAuthor transport is intentionally unimplemented until the IMD work API is verified');
  }
}
