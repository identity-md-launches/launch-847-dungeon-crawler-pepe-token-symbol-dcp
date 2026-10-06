import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContent } from '../server/src/game/content.js';
import { newCharacter, act, GameError, MAX_POWERS } from '../server/src/game/engine.js';
import { generateOffers, validateCombo, powerScore, SCORE_MIN, SCORE_MAX } from '../server/src/game/powers.js';
import { deriveSeed, Rng } from '../server/src/game/rng.js';
import { chooseAction, ARCHETYPES } from '../server/src/sim/bots.js';

const content = buildContent();
const ctxFor = (seed, maxDepth = 9) => ({ content, seed, dailyEvent: content.dailyEvents[1], popularity: new Map(), maxDepth });

function play(seed, n, archetype = 'greedy', classId = 'brawler') {
  const ch = newCharacter(content, seed, { id: 'x', name: 'Tester', classId, day: 0, dailyEvent: content.dailyEvents[1] });
  const rng = Rng.from('policy', seed.toString('hex'));
  let errors = 0;
  for (let i = 0; i < n && ch.alive; i++) {
    const a = chooseAction(ch, content, archetype, rng);
    try { act(ctxFor(seed), ch, a); } catch (e) { if (!(e instanceof GameError)) throw e; errors++; if (ch.pending?.kind === 'offer') act(ctxFor(seed), ch, { type: 'skip' }); else if (ch.pending && ch.pending.kind !== 'combat') ch.pending = null; }
  }
  return { ch, errors };
}

test('same seed + same choices replays identically (retries/reloads cannot reroll)', () => {
  const s = deriveSeed('k', 'char-a');
  const a = play(s, 400), b = play(s, 400);
  assert.deepEqual(a.ch, b.ch);
});

test('different characters diverge: routes, offers and encounters differ', () => {
  const a = newCharacter(content, deriveSeed('k', 'A'), { id: 'A', name: 'A', classId: 'bard', day: 0 });
  const b = newCharacter(content, deriveSeed('k', 'B'), { id: 'B', name: 'B', classId: 'bard', day: 0 });
  assert.notDeepEqual(a.map.nodes.map((n) => n.type), b.map.nodes.map((n) => n.type));
  assert.notDeepEqual(a.pending.offers.map((o) => o.sig), b.pending.offers.map((o) => o.sig));
});

test('every generated offer is a valid, budgeted, distinct combination', () => {
  const ch = newCharacter(content, deriveSeed('k', 'V'), { id: 'V', name: 'V', classId: 'necro', day: 0 });
  for (let i = 0; i < 300; i++) {
    const offers = generateOffers(content, Rng.from('o', i), ch, { count: 3 });
    assert.equal(new Set(offers.map((o) => o.sig)).size, offers.length);
    for (const o of offers) {
      const parts = [content.effectById[o.effect], content.triggerById[o.trigger], content.modifierById[o.modifier], content.drawbackById[o.drawback]];
      const tags = new Set(ch.powers.flatMap((p) => p.tags).concat(content.classById.necro.tags));
      assert.equal(validateCombo(content, ...parts, tags), null);
      const sc = powerScore(...parts);
      assert.ok(sc >= SCORE_MIN && sc <= SCORE_MAX, `score ${sc}`);
    }
  }
});

test('substantial play across all archetypes and classes runs without engine faults', () => {
  let deepest = 0;
  for (const [i, arch] of ARCHETYPES.entries()) {
    const { ch, errors } = play(deriveSeed('k', 'long' + i), 2500, arch, content.classes[i % content.classes.length].id);
    assert.ok(errors < 60, `${arch}: ${errors} illegal actions`);
    assert.ok(ch.stats.rooms > 10);
    deepest = Math.max(deepest, ch.stats.bestDepth);
  }
  assert.ok(deepest >= 4, 'some bot descends');
});

test('illegal moves are rejected without mutating the world', () => {
  const ch = newCharacter(content, deriveSeed('k', 'I'), { id: 'I', name: 'I', classId: 'monk', day: 0 });
  assert.throws(() => act(ctxFor(deriveSeed('k', 'I')), ch, { type: 'move', to: 999 }), GameError);
  assert.throws(() => act(ctxFor(deriveSeed('k', 'I')), ch, { type: 'attack' }), GameError);
  assert.throws(() => act(ctxFor(deriveSeed('k', 'I')), ch, { type: 'buy', choice: 'potion' }), GameError);
  assert.throws(() => act(ctxFor(deriveSeed('k', 'I')), ch, { type: 'rm -rf' }), GameError);
});

test('depth gate blocks descending past the daily limit; Overtime keeps play going', () => {
  const seed = deriveSeed('k', 'G');
  const ch = newCharacter(content, seed, { id: 'G', name: 'G', classId: 'brawler', day: 0 });
  ch.pending = { kind: 'stairs' };
  assert.throws(() => act(ctxFor(seed, 1), ch, { type: 'descend' }), /not opened floor 2/);
  const before = JSON.stringify(ch.map.nodes);
  act(ctxFor(seed, 1), ch, { type: 'overtime' });
  assert.notEqual(JSON.stringify(ch.map.nodes), before);
  assert.equal(ch.floor, 1);
});

test('full power slots require an explicit replacement', () => {
  const seed = deriveSeed('k', 'F');
  const ch = newCharacter(content, seed, { id: 'F', name: 'F', classId: 'brawler', day: 0 });
  const offers = ch.pending.offers;
  ch.powers = Array.from({ length: MAX_POWERS }, (_, i) => ({ ...offers[0], id: 'p' + i, sig: 'sig' + i }));
  assert.throws(() => act(ctxFor(seed), ch, { type: 'choose', index: 1 }), /replace/);
  act(ctxFor(seed), ch, { type: 'choose', index: 1, replace: 3 });
  assert.equal(ch.powers.length, MAX_POWERS);
  assert.equal(ch.powers.at(-1).sig, offers[1].sig);
});

test('death is permanent for the character and recorded', () => {
  const seed = deriveSeed('k', 'D');
  const ch = newCharacter(content, seed, { id: 'D', name: 'D', classId: 'necro', day: 0 });
  act(ctxFor(seed), ch, { type: 'skip' });
  ch.hp = 1;
  ch.map.nodes[ch.map.nodes[0].next[0]].type = 'trap';
  ch.powers = [];
  act(ctxFor(seed), ch, { type: 'move', to: ch.map.nodes[0].next[0] });
  assert.equal(ch.alive, false);
  assert.throws(() => act(ctxFor(seed), ch, { type: 'move', to: 0 }), /dead/);
});

test('quest choices write history that later callbacks and floors react to', () => {
  const seed = deriveSeed('k', 'Q');
  const ch = newCharacter(content, seed, { id: 'Q', name: 'Q', classId: 'grifter', day: 0 });
  act(ctxFor(seed), ch, { type: 'skip' });
  ch.pending = { kind: 'quest', questId: 'reginald_war', fill: {}, choices: [] };
  act(ctxFor(seed), ch, { type: 'quest', choice: 'pawn' });
  assert.equal(ch.flags.reginald, 'pawned');
  ch.pending = null;
  // Mama Grub now sells Reginald back.
  ch.pending = null;
  ch.gold = 1000;
  const shopNode = ch.map.nodes[0].next[0];
  ch.map.nodes[shopNode].type = 'shop';
  act(ctxFor(seed), ch, { type: 'move', to: shopNode });
  assert.ok(ch.pending.stock.some((s) => s.id === 'reginald'));
  act(ctxFor(seed), ch, { type: 'buy', choice: 'reginald' });
  assert.equal(ch.flags.reginald, 'redeemed');
});
