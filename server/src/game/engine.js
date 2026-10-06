// Authoritative game rules. Pure functions over a character object: the server loads the
// character, calls act(), and persists the result atomically. No network, no token logic,
// no AI calls — ordinary moves cost nothing but a database write.
import { Rng } from './rng.js';
import { generateFloor, unlocked } from './floor.js';
import { generateOffers, activeSynergies, composePower, validateCombo, powerScore, SCORE_MIN, SCORE_MAX } from './powers.js';

export const MAX_POWERS = 24;
export const MAX_ITEMS = 30;

export function newCharacter(content, seed, { id, name, classId, day, dailyEvent, startDepth = 1 }) {
  const cls = content.classById[classId] ?? content.classes[0];
  const ch = {
    id, name, classId: cls.id, className: cls.name, alive: true, level: 1, xp: 0,
    hp: cls.hp, maxHp: cls.hp, atk: cls.atk, def: cls.def, gold: 15, hype: 0, fame: 0,
    powers: [], curses: [], items: [], equipped: {}, potions: 2, secretKeys: 0,
    floor: startDepth, node: 0, visited: [0], flags: {}, questsDone: [], seenSigs: [],
    stats: { kills: 0, elites: 0, floorsCleared: 0, quests: 0, hypePeak: 0, bestDepth: startDepth, rooms: 0, deals: 0 },
    turn: 0, pending: null, log: [], createdDay: day, revived: false,
  };
  ch.map = generateFloor(content, seed, ch, ch.floor, dailyEvent);
  // Starting offer so even the first minute is a build decision, not a fixed kit.
  const rng = Rng.from(seed.toString('hex'), 'start');
  ch.pending = { kind: 'offer', reason: 'Starter perk from the IDSC Welcome Basket (contents may be alive)', offers: generateOffers(content, rng, ch, { count: 3 }) };
  ch.seenSigs.push(...ch.pending.offers.map((o) => o.sig));
  say(ch, `${content.npcs.steward.name} stamps your forehead: APPLICANT. "Welcome to ${content.world.name}, ${name}. Try not to die before your orientation video."`);
  return ch;
}

function say(ch, line) {
  ch.log.push(line);
  if (ch.log.length > 60) ch.log.splice(0, ch.log.length - 60);
}

const curseCount = (ch) => ch.curses.length;
const minionCount = (cb) => cb?.minions?.length ?? 0;

function syn(ctx, ch) {
  const out = {};
  for (const s of activeSynergies(ctx.content, ch)) Object.assign(out, s.effect);
  return out;
}

function totalAtk(ch, ctx) {
  let a = ch.atk + (ch.equipped.weapon?.atk ?? 0) + (ch.equipped.trinket?.atk ?? 0);
  const s = syn(ctx, ch);
  if (s.cursePower) a += curseCount(ch) * s.cursePower;
  if (s.goldDamage) a += Math.floor(ch.gold / s.goldDamage);
  return Math.max(1, a);
}
const totalDef = (ch) => Math.max(0, ch.def + (ch.equipped.armor?.def ?? 0) + (ch.equipped.trinket?.def ?? 0));
const allPowers = (ch) => ch.powers.concat(Object.values(ch.equipped).filter((i) => i?.power).map((i) => i.power));

// ----------------------------------------------------------------------------- effects

function magnitude(ctx, ch, cb, p) {
  const mod = ctx.content.modifierById[p.modifier] ?? {};
  let m = p.magnitude;
  if (mod.scale === 'gold') m *= 1 + ch.gold / 100;
  if (mod.scale === 'curses') m *= 1 + 0.35 * curseCount(ch);
  if (mod.scale === 'hype') m *= 1 + ch.hype / 40;
  if (mod.scale === 'minions') m *= 1 + 0.3 * minionCount(cb);
  if (mod.scale === 'depth') m *= 1 + ch.floor * 0.08;
  if (mod.lowHpMult && ch.hp <= ch.maxHp * 0.3) m *= mod.lowHpMult;
  if (mod.streak && cb) m *= 1 + 0.25 * (cb.streaks[p.id] ?? 0);
  const jealous = allPowers(ch).filter((q) => q.id !== p.id && ctx.content.drawbackById[q.drawback]?.jealous).length;
  m *= Math.max(0.5, 1 - 0.1 * jealous);
  return Math.max(1, Math.min(Math.round(m), 40 + ch.floor * 8));
}

function target(cb, rng, random) {
  const alive = cb.enemies.filter((e) => e.hp > 0);
  if (!alive.length) return null;
  return random ? rng.pick(alive) : alive[0];
}

function hurtEnemy(ctx, ch, cb, e, dmg, rng, label) {
  if (!e || e.hp <= 0) return 0;
  const s = syn(ctx, ch);
  if (s.burnBonus && e.burn > 0) dmg += s.burnBonus;
  e.hp -= dmg;
  ch.stats.damage = (ch.stats.damage ?? 0) + dmg;
  if (label) say(ch, label);
  if (e.hp <= 0) onEnemyDeath(ctx, ch, cb, e, rng);
  return dmg;
}

function hurtPlayer(ctx, ch, cb, dmg, source) {
  let d = Math.max(0, dmg);
  if (cb) {
    const absorbed = Math.min(cb.block, d);
    cb.block -= absorbed;
    d -= absorbed;
    if (absorbed > 0) cb.blockedHit = true;
  }
  ch.hp -= d;
  if (d > 0) say(ch, `${source} hits you for ${d}.${ch.hp <= 0 ? '' : ` (${ch.hp}/${ch.maxHp} HP)`}`);
  return d;
}

function applyPower(ctx, ch, cb, p, rng, depthOfEcho = 0) {
  const mod = ctx.content.modifierById[p.modifier] ?? {};
  const dbk = ctx.content.drawbackById[p.drawback] ?? {};
  const s = syn(ctx, ch);
  if (mod.delay && !depthOfEcho && cb) {
    cb.delayed.push({ powerId: p.id, at: cb.turn + mod.delay });
    say(ch, `⏳ ${p.name} is charging (${mod.delay} turns).`);
    return;
  }
  if (mod.hpCost) ch.hp = Math.max(1, ch.hp - mod.hpCost);
  if (mod.goldCost) {
    if (ch.gold < mod.goldCost) { say(ch, `${p.name} fizzles: your sponsor wants ${mod.goldCost} gold and you're broke.`); return; }
    ch.gold -= mod.goldCost;
  }
  if (dbk.hypeCost) ch.hype = Math.max(0, ch.hype - dbk.hypeCost);
  if (dbk.paperwork && cb) {
    cb.uses[p.id] = (cb.uses[p.id] ?? 0) + 1;
    if (cb.uses[p.id] % dbk.paperwork === 0) { cb.skipNext = true; say(ch, `📎 Form 66-Δ must be filed. You lose your next turn to paperwork.`); }
  }
  let n = magnitude(ctx, ch, cb, p);
  if (depthOfEcho) n = Math.max(1, Math.round(n / 2));
  const e = cb ? target(cb, rng, mod.random) : null;
  const tag = `✨ ${p.name}:`;
  switch (p.kind) {
    case 'damage': if (e) hurtEnemy(ctx, ch, cb, e, n, rng, `${tag} ${n} damage to ${e.name}.`); break;
    case 'poison': if (e) { e.poison += n; say(ch, `${tag} ${e.name} is poisoned (${e.poison}).`); } break;
    case 'bleed': if (e) { e.bleed += n * (s.bleedMult ?? 1); say(ch, `${tag} ${e.name} is bleeding (${e.bleed}).`); } break;
    case 'burn': if (e) { e.burn += n; say(ch, `${tag} ${e.name} is on fire (${e.burn}).`); } break;
    case 'heal': { const h = Math.round(n * healMult(ctx, ch)); ch.hp = Math.min(ch.maxHp, ch.hp + h); say(ch, `${tag} +${h} HP.`); break; }
    case 'shield': if (cb) { cb.block += n; say(ch, `${tag} +${n} block.`); } break;
    case 'gold': ch.gold += n; say(ch, `${tag} +${n} gold.`); break;
    case 'minion': if (cb) { cb.minions.push({ dmg: Math.round(n * (s.minionMult ?? 1)), hp: 6 + ch.floor }); say(ch, `${tag} a minion joins (${cb.minions.length} total).`); } break;
    case 'hype': gainHype(ctx, ch, n, tag); break;
    case 'stun': if (e) { e.stun += n + (s.stunBonus ?? 0); say(ch, `${tag} ${e.name} is stunned.`); } break;
    case 'weaken': if (e) { e.atk = Math.max(1, e.atk - n); say(ch, `${tag} ${e.name} ATK → ${e.atk}.`); } break;
    case 'reflect': if (cb) { cb.reflect += n; say(ch, `${tag} reflecting ${cb.reflect}.`); } break;
    case 'drain': if (e) { hurtEnemy(ctx, ch, cb, e, n, rng); const h = Math.round(n * (s.drainMult ?? 1) * healMult(ctx, ch)); ch.hp = Math.min(ch.maxHp, ch.hp + h); say(ch, `${tag} drained ${n}, healed ${h}.`); } break;
    case 'chaos': {
      let roll = rng.next();
      if (s.chaosAdv) roll = Math.max(roll, rng.next());
      if (roll < 0.72 && e) hurtEnemy(ctx, ch, cb, e, n, rng, `${tag} the coin loves you: ${n} to ${e.name}.`);
      else { const d = Math.max(1, Math.round(n / 3)); ch.hp = Math.max(1, ch.hp - d); say(ch, `${tag} the coin hates you: ${d} to yourself. The audience howls.`); gainHype(ctx, ch, 3); }
      break;
    }
    case 'extra_action': if (cb && !cb.extraUsed) { cb.extraUsed = true; cb.bonusAction = true; say(ch, `${tag} you get an extra action.`); } break;
    case 'crit_chance': if (cb) { cb.critBonus = Math.min(60, cb.critBonus + n); say(ch, `${tag} crit chance +${n}%.`); } break;
  }
  if (mod.chain && cb && e) {
    const nxt = cb.enemies.find((x) => x !== e && x.hp > 0);
    if (nxt && p.kind === 'damage') hurtEnemy(ctx, ch, cb, nxt, Math.round(n * 0.6), rng, `   ↳ splashes ${Math.round(n * 0.6)} onto ${nxt.name}.`);
    if (nxt && ['poison', 'bleed', 'burn'].includes(p.kind)) nxt[p.kind] += Math.round(n * 0.6);
  }
  if (mod.echo && !depthOfEcho && cb) cb.echo.push(p.id);
  if (mod.aggro && cb && rng.chance(0.2) && cb.enemies.length < 4) {
    const extra = makeMonster(ctx, rng, ch.floor, false);
    cb.enemies.push(extra);
    say(ch, `📢 The noise attracts another guest: ${extra.name}!`);
  }
  if (mod.streak && cb) cb.streaks[p.id] = (cb.streaks[p.id] ?? 0) + 1;
}

function healMult(ctx, ch) {
  return allPowers(ch).reduce((m, p) => m * (ctx.content.drawbackById[p.drawback]?.healMult ?? 1), 1);
}

function gainHype(ctx, ch, n, tag = '') {
  const mult = ctx.dailyEvent?.mod?.hypeMult ?? 1;
  const g = Math.round(n * mult);
  ch.hype = Math.min(99, ch.hype + g);
  ch.stats.hypePeak = Math.max(ch.stats.hypePeak, ch.hype);
  if (tag) say(ch, `${tag} +${g} Hype (${ch.hype}).`);
  if (ch.hype >= 30 && !ch.flags.firstViral) {
    ch.flags.firstViral = true;
    say(ch, `📺 Duke Brisket: "THIS CRAWLER IS TRENDING IN NINE DIMENSIONS!" A sponsor crate crashes through the ceiling.`);
    ch.potions += 1;
  }
}

function fire(ctx, ch, cb, trig, rng) {
  for (const p of allPowers(ch)) {
    if (p.trigger !== trig) continue;
    if (cb && cb.enemies.every((e) => e.hp <= 0) && !['heal', 'gold', 'hype'].includes(p.kind)) continue;
    applyPower(ctx, ch, cb, p, rng);
  }
}

// ----------------------------------------------------------------------------- monsters

export function makeMonster(ctx, rng, depth, elite) {
  const { content } = ctx;
  const body = rng.pick(content.monsterBodies);
  const affix = elite ? rng.pick(content.monsterAffixes.filter((a) => a.id !== 'none' && a.id !== 'tiny')) : rng.weighted(content.monsterAffixes, (a) => (a.id === 'none' ? 4 : 1));
  const behaviour = rng.pick(content.behaviours);
  const scale = 0.75 + (depth - 1) * 0.17;
  const hpMult = (ctx.dailyEvent?.mod?.enemyHp ?? 1) * (elite ? 1.9 : 1);
  const hp = Math.round(body.hp * affix.hp * scale * hpMult);
  return {
    name: `${elite ? '★ ' : ''}${affix.name ? affix.name + ' ' : ''}${body.name}`,
    body: body.id, affix: affix.id, behaviour, flavour: [body.text, affix.text].filter(Boolean).join('; '),
    hp, maxHp: hp, atk: Math.max(1, Math.round(body.atk * affix.atk * (0.6 + (depth - 1) * 0.11) * (elite ? 1.3 : 1))),
    poison: 0, bleed: 0, burn: 0, stun: 0, elite: !!elite, pack: body.pack ?? 'base',
  };
}

function startCombat(ctx, ch, rng, { elite = false, waves = 0, extraCount = 0, label = '' } = {}) {
  const n = Math.min(4, (elite ? 1 : 1 + (rng.chance(ch.floor < 2 ? 0 : Math.min(0.6, 0.04 + ch.floor * 0.04)) ? 1 : 0)) + extraCount);
  const enemies = Array.from({ length: n }, (_, i) => makeMonster(ctx, rng, ch.floor, elite && i === 0));
  if (ctx.dailyEvent?.mod?.kevinDay && rng.chance(0.4)) enemies.push({ ...makeMonster(ctx, rng, ch.floor, false), name: 'Kevin (Seasonal)', flavour: 'It\'s his day. Let him have this.' });
  const cb = { enemies, turn: 0, block: 0, minions: [], echo: [], delayed: [], streaks: {}, uses: {}, reflect: 0, critBonus: 0, skillCd: 0, extraUsed: false, elite, waves, enemySkipFirst: !!syn(ctx, ch).enemySkipFirst };
  for (let i = 0; i < (ch.flags.permMinion ?? 0); i++) cb.minions.push({ dmg: 2 + Math.floor(ch.floor / 3), hp: 6 + ch.floor });
  if (ch.stealth > 0) { ch.stealth -= 1; say(ch, '🥸 Your disguise works. The monsters wander off muttering about Darryl.'); return null; }
  ch.pending = { kind: 'combat', cb };
  say(ch, `${label}⚔️ ${enemies.map((e) => `${e.name} — ${e.flavour}`).join(' | ')}`);
  for (const p of allPowers(ch)) if (p.trigger === 'first_turn') applyPower(ctx, ch, cb, p, rng);
  checkCombatEnd(ctx, ch, cb, rng);
  return cb;
}

function onEnemyDeath(ctx, ch, cb, e, rng) {
  if (e.dead) return;
  e.dead = true;
  ch.stats.kills += 1;
  if (e.elite) ch.stats.elites += 1;
  say(ch, `💀 ${e.name} dies ${rng.pick(['horribly', 'loudly', 'wetly', 'with a fart', 'mid-sentence', 'while flipping you off', 'apologising to its mum'])}.`);
  const s = syn(ctx, ch);
  if (s.poisonSpread && e.poison > 0) {
    const nxt = cb.enemies.find((x) => x.hp > 0);
    if (nxt) { nxt.poison += e.poison; say(ch, `☣️ The poison moves house into ${nxt.name}.`); }
  }
  if (e.affix === 'cursed' && rng.chance(0.4)) addCurse(ctx, ch, rng);
  if (e.name.startsWith('Kevin')) { ch.flags.kevinDeaths = (ch.flags.kevinDeaths ?? 0) + 1; }
  fire(ctx, ch, cb, 'on_kill', rng);
}

function addCurse(ctx, ch, rng) {
  const curses = ['Itchy Soul', 'Haunted Molar', 'Sponsor Tattoo (Forehead)', 'Chronic Narration', 'Moist Aura', 'Tax Lien', 'Allergic to Stairs', 'Mild Lycanthropy (Hamster)', 'Gremlin Bladder'];
  const c = rng.pick(curses);
  ch.curses.push(c);
  say(ch, `🩸 Cursed: ${c}.`);
  fire(ctx, ch, ch.pending?.kind === 'combat' ? ch.pending.cb : null, 'on_curse', rng);
}

function enemyTurn(ctx, ch, cb, rng) {
  const s = syn(ctx, ch);
  const glow = allPowers(ch).reduce((a, p) => a + (ctx.content.drawbackById[p.drawback]?.enemyAtk ?? 0), 0);
  for (const e of cb.enemies) {
    if (e.hp <= 0) continue;
    for (const dot of ['poison', 'bleed', 'burn']) {
      if (e[dot] > 0 && e.hp > 0) {
        hurtEnemy(ctx, ch, cb, e, e[dot], rng);
        if (dot === 'bleed') e.bleed = Math.floor(e.bleed / 2); else if (dot === 'burn') e.burn = Math.max(0, e.burn - 1);
      }
    }
    if (e.hp <= 0) continue;
    if (cb.enemySkipFirst && cb.turn === 1) { say(ch, `📋 ${e.name} is stuck filling out a liability waiver.`); continue; }
    if (e.stun > 0) { e.stun -= 1; say(ch, `💫 ${e.name} is seeing stars.`); continue; }
    if (e.affix === 'unionized' && cb.turn % 4 === 0) { say(ch, `☕ ${e.name} takes its mandated break.`); continue; }
    if (e.affix === 'drunk' && rng.chance(0.35)) { say(ch, `🍺 ${e.name} swings at the wall and apologises.`); continue; }
    if (e.behaviour === 'coward' && e.hp < e.maxHp * 0.25 && rng.chance(0.5)) { e.hp = 0; e.dead = true; say(ch, `🏃 ${e.name} flees, sobbing. No loot for you.`); continue; }
    let atk = e.atk + glow;
    if (e.behaviour === 'berserk') { e.atk += 1; }
    if (e.behaviour === 'defensive' && rng.chance(0.3)) { const h = Math.round(e.maxHp * 0.12); e.hp = Math.min(e.maxHp, e.hp + h); say(ch, `🩹 ${e.name} licks its wounds (+${h}).`); continue; }
    if (e.behaviour === 'heckler' && rng.chance(0.4)) { const lost = Math.min(ch.hype, 3); ch.hype -= lost; say(ch, `🗯️ ${e.name} heckles: "${rng.pick(['Nice build, did your mum pick it?', 'You fight like a damp napkin.', 'Even Kevin is embarrassed for you.', 'Is that your face or did a mimic sneeze?'])}" (-${lost} Hype)`); }
    if (e.behaviour === 'summoner' && rng.chance(0.2) && cb.enemies.length < 4) { const m = makeMonster(ctx, rng, Math.max(1, ch.floor - 2), false); cb.enemies.push(m); say(ch, `📯 ${e.name} summons backup: ${m.name}.`); }
    const variance = rng.range(-1, 2);
    const dmg = Math.max(1, atk + variance - totalDef(ch));
    if (cb.reflect > 0) { const r = Math.min(cb.reflect, dmg); cb.reflect = 0; hurtEnemy(ctx, ch, cb, e, r, rng, `🪞 Reflected ${r} back into ${e.name}'s smug face.`); }
    const before = cb.block;
    const taken = hurtPlayer(ctx, ch, cb, dmg, e.name);
    if (before > 0 && cb.blockedHit) { cb.blockedHit = false; fire(ctx, ch, cb, 'on_block', rng); }
    if (taken > 0) {
      if (s.thorns) e.poison += s.thorns;
      if (e.behaviour === 'poisoner') { ch.hp -= 1; say(ch, `🤢 ${e.name}'s attack was also somehow venereal. -1 HP.`); }
      if (e.behaviour === 'thief' && ch.gold > 0) { const g = Math.min(ch.gold, 3 + ch.floor); ch.gold -= g; say(ch, `👛 ${e.name} pickpockets ${g} gold.`); }
      fire(ctx, ch, cb, 'on_damaged', rng);
    }
    // Minions soak hits sometimes.
    if (cb.minions.length && rng.chance(0.2)) {
      const m = cb.minions[0];
      m.hp -= atk;
      if (m.hp <= 0) { cb.minions.shift(); say(ch, '🪦 A minion dies screaming. You feel almost nothing.'); fire(ctx, ch, cb, 'minion_dies', rng); }
    }
    if (ch.hp <= 0) return;
  }
}

function endTurn(ctx, ch, cb, rng) {
  // Minions attack, delayed and echo effects resolve, enemies act.
  for (const m of cb.minions) { const e = target(cb, rng, false); if (e) hurtEnemy(ctx, ch, cb, e, m.dmg, rng); }
  const echoes = cb.echo.splice(0);
  for (const id of echoes) { const p = allPowers(ch).find((q) => q.id === id); if (p) applyPower(ctx, ch, cb, p, rng, 1); }
  const due = cb.delayed.filter((d) => d.at <= cb.turn);
  cb.delayed = cb.delayed.filter((d) => d.at > cb.turn);
  for (const d of due) { const p = allPowers(ch).find((q) => q.id === d.powerId); if (p) applyPower(ctx, ch, cb, p, rng, 2); }
  if (!checkCombatEnd(ctx, ch, cb, rng)) return;
  const keep = syn(ctx, ch).blockCarry;
  enemyTurn(ctx, ch, cb, rng);
  if (!keep) cb.block = 0;
  cb.extraUsed = false;
  cb.turn += 1;
  if (cb.skillCd > 0) cb.skillCd -= 1;
  if (ch.hp <= 0) return die(ctx, ch, rng);
  if (ch.hp <= ch.maxHp * 0.3) fire(ctx, ch, cb, 'low_hp', rng);
  if (cb.turn % 3 === 0) fire(ctx, ch, cb, 'every_third', rng);
  if (ch.hype > 20) fire(ctx, ch, cb, 'high_hype', rng);
  const floorHype = syn(ctx, ch).hypeFloor ?? 0;
  ch.hype = Math.max(floorHype, Math.min(ch.hype, ch.hype - (cb.turn % 4 === 0 ? 1 : 0)));
  checkCombatEnd(ctx, ch, cb, rng);
}

/** Returns true if combat continues. */
function checkCombatEnd(ctx, ch, cb, rng) {
  if (ch.pending?.kind !== 'combat') return false;
  if (cb.enemies.some((e) => e.hp > 0)) return true;
  // Victory.
  const goldMult = ctx.dailyEvent?.mod?.goldMult ?? 1;
  const xpMult = ctx.dailyEvent?.mod?.xpMult ?? 1;
  let gold = 0, xp = 0;
  for (const e of cb.enemies) {
    if (!e.dead) continue;
    gold += Math.round((3 + ch.floor * 2 + (e.affix === 'sponsored' ? 6 : 0) + (e.elite ? 12 : 0)) * goldMult);
    xp += Math.round((6 + ch.floor * 3) * (e.elite ? 3 : 1) * xpMult);
  }
  ch.gold += gold;
  say(ch, `🏆 Victory. +${gold} gold, +${xp} XP. Duke Brisket: "${rng.pick(['Adequate!', 'The audience is mildly aroused.', 'Somebody clip that.', 'I\'ve seen better from a corpse. Literally, last week.'])}"`);
  ch.pending = null;
  fire(ctx, ch, null, 'on_loot', rng);
  gainXp(ctx, ch, xp, rng);
  if (cb.waves > 0) { startCombat(ctx, ch, rng, { elite: cb.waves === 1, waves: cb.waves - 1, label: `🌀 Side-dungeon wave (${cb.waves} left)! ` }); return false; }
  if (cb.elite || cb.forcedOffer) {
    if (!ch.pending) offerPowers(ctx, ch, rng, 'Elite loot: a power ripped from its corpse', {});
    if (rng.chance(0.6)) dropItem(ctx, ch, rng, true);
  } else if (rng.chance(0.25)) dropItem(ctx, ch, rng, false);
  return false;
}

function gainXp(ctx, ch, xp, rng) {
  ch.xp += xp;
  while (ch.xp >= xpForLevel(ch.level)) {
    ch.xp -= xpForLevel(ch.level);
    ch.level += 1;
    ch.maxHp += 4;
    ch.hp = Math.min(ch.maxHp, ch.hp + 8);
    ch.atk += ch.level % 2 === 0 ? 1 : 0;
    say(ch, `⬆️ Level ${ch.level}! Phyllis Gnarr issues you a slightly larger name tag.`);
    if (!ch.pending) offerPowers(ctx, ch, rng, `Level ${ch.level} perk`, {});
    else (ch.queuedOffers = ch.queuedOffers ?? []).push(`Level ${ch.level} perk`);
  }
}
export const xpForLevel = (l) => 20 + l * 15;

function offerPowers(ctx, ch, rng, reason, opts) {
  const offers = generateOffers(ctx.content, rng, ch, { count: 3, popularity: ctx.popularity, ...opts });
  if (!offers.length) return;
  ch.seenSigs.push(...offers.map((o) => o.sig));
  if (ch.seenSigs.length > 400) ch.seenSigs.splice(0, ch.seenSigs.length - 400);
  ch.pending = { kind: 'offer', reason, offers };
}

function dropItem(ctx, ch, rng, good) {
  const { content } = ctx;
  const baseGroup = rng.pick(content.itemBases);
  const name = `${rng.pick(content.materials)} ${rng.pick(baseGroup.names)}`;
  const tier = Math.max(1, Math.round(ch.floor / 2 + (good ? 2 : 0) + (ctx.dailyEvent?.mod?.lootUp ?? 0)));
  const item = { id: `it_${ch.turn}_${rng.int(1e6).toString(36)}`, name, slot: baseGroup.slot, tier, atk: 0, def: 0, soulbound: false };
  if (item.slot === 'weapon') item.atk = rng.range(1, 2) + Math.floor(tier / 2);
  else if (item.slot === 'armor') item.def = rng.range(0, 1) + Math.floor(tier / 2);
  else { item.atk = rng.chance(0.5) ? 1 : 0; item.def = item.atk ? 0 : 1; }
  // Items carry an embedded composed power on good drops, so loot is mechanical, not a reroll.
  if (good || rng.chance(0.3)) {
    const offers = generateOffers(content, rng, ch, { count: 1, popularity: ctx.popularity });
    if (offers[0]) item.power = { ...offers[0], name: `${item.name}: ${offers[0].name}` };
  }
  if (ch.items.length >= MAX_ITEMS) { say(ch, `🎒 Inventory full. ${name} is left for the next idiot.`); return; }
  ch.items.push(item);
  say(ch, `🎁 Loot: ${name} (${item.slot}${item.atk ? ` +${item.atk} ATK` : ''}${item.def ? ` +${item.def} DEF` : ''})${item.power ? ` — ${item.power.text}` : ''}`);
}

function die(ctx, ch, rng) {
  ch.alive = false;
  ch.hp = 0;
  ch.pending = null;
  say(ch, `☠️ ${rng.pick(ctx.content.deathLines)}`);
  say(ch, `You died on floor ${ch.floor}. Banked rewards and account stash are safe. This character is retired to the Hall of Corpses.`);
}

// ----------------------------------------------------------------------------- rooms

function enterNode(ctx, ch, node, rng) {
  ch.stats.rooms += 1;
  for (const p of allPowers(ch)) {
    const d = ctx.content.drawbackById[p.drawback];
    if (d?.goldDrain) { ch.gold = Math.max(0, ch.gold - d.goldDrain); }
  }
  if (ctx.dailyEvent?.mod?.teleport && ch.stats.rooms % ctx.dailyEvent.mod.teleport === 0 && node.type !== 'stairs') {
    say(ch, '🌀 Gravity Audit! The floor drops you somewhere else.');
  }
  const cbacks = ctx.content.callbacks.filter((c) => Object.entries(c.when).every(([k, v]) => ch.flags[k] === v));
  if (cbacks.length && rng.chance(0.35)) say(ch, `🔁 ${rng.pick(cbacks).line}`);
  if (ch.flags.reginald !== 'pawned' && ch.flags.reginald !== 'sulking' && rng.chance(0.08)) {
    say(ch, `🎩 Sir Reginald: "${rng.pick(['In the Third Codpiece War we ate our own buttons. Count your blessings.', 'I sense danger. Or gas. Possibly both.', 'Do adjust me, I\'m chafing.', 'Your posture is a disgrace to the crotch.'])}"`);
  }
  switch (node.type) {
    case 'combat': startCombat(ctx, ch, rng); break;
    case 'elite': startCombat(ctx, ch, rng, { elite: true }); break;
    case 'side': say(ch, '🚪 A side-dungeon: three escalating waves, the last one elite.'); startCombat(ctx, ch, rng, { waves: 2 }); break;
    case 'shop': openShop(ctx, ch, rng); break;
    case 'sponsor': openSponsor(ctx, ch, rng); break;
    case 'quest': openQuest(ctx, ch, rng, node.quest); break;
    case 'rest': ch.pending = { kind: 'rest' }; say(ch, `🛏️ A rest site: a mattress of dubious provenance. ${ch.map.affliction}`); break;
    case 'treasure': say(ch, '💰 A treasure chest. It is (probably) not a mimic.'); if (rng.chance(0.15 + ch.floor * 0.01)) startCombat(ctx, ch, rng, { label: 'IT WAS A MIMIC. ' }); else { ch.gold += 10 + ch.floor * 3; dropItem(ctx, ch, rng, rng.chance(0.4)); } break;
    case 'trap': {
      const fast = allPowers(ch).some((p) => p.tags.includes('speed'));
      if (fast && rng.chance(0.6)) say(ch, '🪤 A trap! You dodge with the grace of a caffeinated frog.');
      else { const d = 3 + ch.floor; ch.hp -= d; say(ch, `🪤 ${rng.pick(['A spike trap', 'A falling piano', 'A trapdoor full of Legos', 'A swinging urinal cake'])} hits you for ${d}.`); gainHype(ctx, ch, 4, '📺'); if (ch.hp <= 0) die(ctx, ch, rng); }
      break;
    }
    case 'shrine': ch.pending = { kind: 'shrine', options: shrineOptions(ctx, ch, rng) }; say(ch, `⛩️ A shrine to ${rng.pick(['the God of Drainage', 'Saint Kevin the Repeatedly Murdered', 'the Department of Spectacle', 'an Unpaid Intern Deity'])}. It wants something.`); break;
    case 'secret': say(ch, '🗝️ A secret room! Duke Brisket is genuinely surprised.'); if (ch.secretKeys > 0 && node.requires === 'secret') ch.secretKeys -= 1; ch.gold += 20 + ch.floor * 4; offerPowers(ctx, ch, rng, 'Secret room cache', {}); ch.fame += 25; break;
    case 'stairs': ch.pending = { kind: 'stairs' }; say(ch, '🪜 Stairs down. Descending ends this floor.'); break;
  }
}

function openShop(ctx, ch, rng) {
  const discount = ch.flags.mama === 'paid' ? 0.8 : 1;
  const stock = [
    { id: 'potion', name: 'Healing Potion (Tastes Like Feet)', price: Math.round(12 * discount) },
    { id: 'uncurse', name: 'Curse Removal (No Questions)', price: Math.round(25 * discount) },
    { id: 'key', name: 'Suspicious Skeleton Key', price: Math.round(30 * discount) },
    { id: 'perk', name: 'Mystery Perk (No Refunds)', price: Math.round((35 + ch.floor * 4) * discount) },
  ];
  if (ch.flags.reginald === 'pawned') stock.push({ id: 'reginald', name: 'Sir Reginald Dongwhistle (Used)', price: 300 });
  ch.pending = { kind: 'shop', stock };
  say(ch, `🛒 Mama Grub: "${rng.pick(['What\'re you buyin\', sugar-tits?', 'Touch nothing. Buy everything.', 'Prices went up. Why? Vibes.'])}"`);
}

function openSponsor(ctx, ch, rng) {
  const sp = rng.pick(ctx.content.sponsors.filter((s) => ch.flags.sponsorHate !== s.id));
  const styleTag = { heal: 'filth', gold: 'gold', speed: 'speed', shield: 'shield', damage: 'crit', hype: 'hype', fire: 'fire' }[sp.style] ?? 'chaos';
  const offers = generateOffers(ctx.content, rng, ch, { count: 1, focusTag: styleTag, popularity: ctx.popularity });
  const deal = offers[0];
  if (!deal) { say(ch, `${sp.name}'s booth is closed for a "brand safety review".`); return; }
  const predatory = rng.pick([{ id: 'maxhp', text: 'They take 5 max HP as a "service fee".' }, { id: 'curse', text: 'Their logo is branded on your soul (gain a curse).' }, { id: 'gold', text: `They garnish ${10 + ch.floor * 2} gold now.` }]);
  ch.pending = { kind: 'sponsor', sponsor: sp.id, sponsorName: sp.name, deal, predatory };
  say(ch, `📣 ${sp.name}: ${sp.pitch}`);
}

function openQuest(ctx, ch, rng, questId) {
  const q = ctx.content.questById[questId] ?? rng.pick(ctx.content.quests);
  const sp = rng.pick(ctx.content.sponsors);
  const cults = rng.shuffle(ctx.content.cultNames);
  const fill = {
    npc: ctx.content.npcs[q.giver]?.name ?? 'someone', monster: makeMonster(ctx, rng, ch.floor, false).name,
    item: `${rng.pick(ctx.content.materials)} ${rng.pick(rng.pick(ctx.content.itemBases).names)}`,
    place: rng.pick(ctx.content.biomes).name, sponsor: sp.name, sponsorId: sp.id, sponsorStyle: sp.style,
    cultA: cults[0], cultB: cults[1], deadName: rng.pick(ctx.content.deadNames), kevinDeaths: ch.flags.kevinDeaths ?? 0,
  };
  const t = (s) => s.replace(/\{(\w+)\}/g, (_, k) => String(fill[k] ?? k));
  ch.pending = { kind: 'quest', questId: q.id, title: q.title, intro: t(q.intro), fill, choices: q.choices.map((c) => ({ id: c.id, text: t(c.text) })) };
  say(ch, `📜 ${q.title}: ${t(q.intro)}`);
}

function shrineOptions(ctx, ch, rng) {
  const opts = [
    { id: 'blood', text: 'Bleed on it (-6 max HP) for a power of your choice of three' },
    { id: 'tithe', text: `Tithe ${15 + ch.floor * 3} gold to remove a curse and gain fame` },
    { id: 'pray', text: 'Pray (50%: +1 ATK permanently, 50%: a curse and +10 Hype)' },
  ];
  if (ch.powers.length >= 4) opts.push({ id: 'transmute', text: 'Sacrifice your weakest power to reroll it into one of three (never the same one)' });
  return opts;
}

// ----------------------------------------------------------------------------- act()

export class GameError extends Error {}
const need = (cond, msg) => { if (!cond) throw new GameError(msg); };

/**
 * Apply one player action. Mutates and returns `ch`. Throws GameError on illegal moves.
 * ctx: { content, seed: Buffer, dailyEvent, popularity: Map, maxDepth }
 */
export function act(ctx, ch, action) {
  need(ch.alive, 'This character is dead. Start a new one.');
  const rng = Rng.from(ctx.seed.toString('hex'), 'act', ch.turn, action.type, action.to ?? action.index ?? action.choice ?? '');
  ch.turn += 1;
  const p = ch.pending;
  const events = [];
  switch (action.type) {
    case 'move': {
      need(!p, 'Finish what you\'re doing first.');
      const here = ch.map.nodes[ch.node];
      const to = ch.map.nodes[action.to];
      need(to && here.next.includes(to.id), 'You can\'t get there from here.');
      need(unlocked(to, ch), 'That secret door is still locked. Something about you isn\'t worthy yet.');
      ch.node = to.id;
      ch.visited.push(to.id);
      enterNode(ctx, ch, to, rng);
      break;
    }
    case 'attack': case 'skill': case 'taunt': case 'defend': case 'flee': case 'potion': {
      if (action.type === 'potion' && p?.kind !== 'combat') { usePotion(ctx, ch); break; }
      need(p?.kind === 'combat', 'There is nothing to fight. You swing at the air. The air wins.');
      combatAction(ctx, ch, p.cb, action.type, rng);
      break;
    }
    case 'choose': {
      need(p?.kind === 'offer', 'No perk on offer.');
      const o = p.offers[action.index];
      need(o, 'Pick one of the offered perks.');
      if (ch.powers.length >= MAX_POWERS) {
        need(Number.isInteger(action.replace) && ch.powers[action.replace], 'Power slots full: choose a power to replace, or skip.');
        const [gone] = ch.powers.splice(action.replace, 1);
        say(ch, `♻️ ${gone.name} is evicted from your soul. It leaves a passive-aggressive note.`);
      }
      ch.powers.push(o);
      const db = ctx.content.drawbackById[o.drawback] ?? {};
      if (db.maxHp) { ch.maxHp = Math.max(10, ch.maxHp + db.maxHp); ch.hp = Math.min(ch.hp, ch.maxHp); }
      if (db.def) ch.def += db.def;
      say(ch, `🧬 Acquired: ${o.name} (${o.rarity}) — ${o.text}`);
      for (const s of activeSynergies(ctx.content, ch)) if (!ch.flags['syn_' + s.id]) { ch.flags['syn_' + s.id] = true; say(ch, `🔗 SYNERGY UNLOCKED — ${s.text}`); }
      events.push({ type: 'pick', effect: o.effect, sig: o.sig });
      ch.pending = null;
      nextQueued(ctx, ch, rng);
      break;
    }
    case 'skip': {
      need(p?.kind === 'offer', 'Nothing to skip.');
      ch.gold += 8;
      say(ch, '🙅 You decline. Phyllis Gnarr gives you 8 gold for "returning unused perks".');
      ch.pending = null;
      nextQueued(ctx, ch, rng);
      break;
    }
    case 'quest': {
      need(p?.kind === 'quest', 'No quest here.');
      resolveQuest(ctx, ch, p, action.choice, rng);
      break;
    }
    case 'buy': {
      need(p?.kind === 'shop', 'No shop here.');
      const it = p.stock.find((s) => s.id === action.choice);
      need(it, 'Mama Grub doesn\'t sell that. Not to you.');
      need(ch.gold >= it.price, 'You can\'t afford it. Mama Grub laughs until she coughs up a tooth.');
      ch.gold -= it.price;
      fire(ctx, ch, null, 'gold_spent', rng);
      if (it.id === 'potion') ch.potions += 1;
      if (it.id === 'uncurse') { const c = ch.curses.shift(); say(ch, c ? `🧼 ${c} removed.` : '🧼 You had no curse. No refunds.'); }
      if (it.id === 'key') ch.secretKeys += 1;
      if (it.id === 'perk') { offerPowers(ctx, ch, rng, 'Mama Grub\'s Mystery Perk', {}); }
      if (it.id === 'reginald') { ch.flags.reginald = 'redeemed'; ch.atk += 2; say(ch, '🎩 Sir Reginald: "I KNEW you\'d come back. I\'m still furious. Onward!" (+2 ATK)'); }
      if (it.id !== 'perk') say(ch, `🛍️ Bought ${it.name}.`);
      p.stock = p.stock.filter((s) => s.id !== it.id || it.id === 'potion');
      break;
    }
    case 'sponsor': {
      need(p?.kind === 'sponsor', 'No sponsor here.');
      if (action.choice === 'accept') {
        need(ch.powers.length < MAX_POWERS, 'Power slots full: sponsors only sign Crawlers with room for their brand.');
        ch.powers.push(p.deal);
        ch.stats.deals += 1;
        if (p.predatory.id === 'maxhp') { ch.maxHp = Math.max(10, ch.maxHp - 5); ch.hp = Math.min(ch.hp, ch.maxHp); }
        if (p.predatory.id === 'gold') ch.gold = Math.max(0, ch.gold - (10 + ch.floor * 2));
        say(ch, `✍️ Signed with ${p.sponsorName}: ${p.deal.text} ${p.predatory.text}`);
        if (p.predatory.id === 'curse') addCurse(ctx, ch, rng);
        events.push({ type: 'pick', effect: p.deal.effect, sig: p.deal.sig });
        ch.pending = null;
        fire(ctx, ch, null, 'on_deal', rng);
      } else {
        say(ch, `🚪 You walk away. ${p.sponsorName} will remember this in their quarterly report.`);
        ch.pending = null;
      }
      break;
    }
    case 'rest': {
      need(p?.kind === 'rest', 'No rest site here.');
      if (action.choice === 'train') { ch.atk += 1; say(ch, '🏋️ You train with a mop handle. +1 ATK.'); }
      else { const h = Math.round(ch.maxHp * 0.35 * (ctx.dailyEvent?.mod?.restMult ?? 1) * healMult(ctx, ch)); ch.hp = Math.min(ch.maxHp, ch.hp + h); say(ch, `😴 You sleep. Something licks your face. +${h} HP.`); }
      ch.pending = null;
      fire(ctx, ch, null, 'on_rest', rng);
      break;
    }
    case 'shrine': {
      need(p?.kind === 'shrine', 'No shrine here.');
      resolveShrine(ctx, ch, p, action.choice, rng);
      break;
    }
    case 'leave': {
      need(p && ['shop', 'shrine', 'rest'].includes(p.kind), 'You can\'t leave this.');
      ch.pending = null;
      break;
    }
    case 'descend': {
      need(p?.kind === 'stairs', 'Find the stairs first.');
      need(ch.floor < ctx.maxDepth, `The IDSC has not opened floor ${ch.floor + 1} yet. Come back tomorrow, or explore Overtime Zones on this floor.`);
      ch.floor += 1;
      ch.stats.floorsCleared += 1;
      ch.stats.bestDepth = Math.max(ch.stats.bestDepth, ch.floor);
      ch.fame += 100 + ch.floor * 10;
      ch.node = 0;
      ch.visited = [0];
      ch.pending = null;
      ch.map = generateFloor(ctx.content, ctx.seed, ch, ch.floor, ctx.dailyEvent);
      say(ch, `🔻 Floor ${ch.floor}: ${ch.map.biomeName}. ${ch.map.biomeText}`);
      events.push({ type: 'depth', depth: ch.floor });
      fire(ctx, ch, null, 'floor_start', rng);
      if (ch.flags.reginald === 'sulking' && rng.chance(0.5)) { ch.flags.reginald = 'forgiven'; ch.atk += 1; say(ch, '🎩 Sir Reginald clears his throat. "I forgive you. Barely." (+1 ATK back)'); }
      break;
    }
    case 'overtime': {
      need(p?.kind === 'stairs' && ch.floor >= ctx.maxDepth, 'Overtime Zones open only at the depth gate.');
      ch.node = 0;
      ch.visited = [0];
      ch.pending = null;
      ch.overtime = (ch.overtime ?? 0) + 1;
      ch.map = generateFloor(ctx.content, ctx.seed, { ...ch, flags: { ...ch.flags, ot: ch.overtime } }, ch.floor, ctx.dailyEvent);
      say(ch, `⏱️ Overtime Zone #${ch.overtime}: ${ch.map.biomeName}. Same depth, fresh layout, union rates do not apply.`);
      break;
    }
    case 'equip': {
      need(!p || p.kind !== 'combat', 'No outfit changes mid-fight.');
      const it = ch.items.find((i) => i.id === action.choice);
      need(it, 'You don\'t own that.');
      const prev = ch.equipped[it.slot];
      ch.equipped[it.slot] = it;
      ch.items = ch.items.filter((i) => i.id !== it.id);
      if (prev) ch.items.push(prev);
      say(ch, `🧥 Equipped ${it.name}.`);
      break;
    }
    case 'discard': {
      const before = ch.items.length;
      ch.items = ch.items.filter((i) => i.id !== action.choice);
      need(ch.items.length < before, 'You don\'t own that.');
      ch.gold += 3;
      say(ch, '🗑️ Sold to a passing rat for 3 gold.');
      break;
    }
    default:
      throw new GameError('Unknown action.');
  }
  if (ch.hp <= 0 && ch.alive) die(ctx, ch, rng);
  return { ch, events };
}

function nextQueued(ctx, ch, rng) {
  if (ch.queuedOffers?.length && !ch.pending) offerPowers(ctx, ch, rng, ch.queuedOffers.shift(), {});
}

function usePotion(ctx, ch) {
  need(ch.potions > 0, 'Out of potions.');
  ch.potions -= 1;
  const h = Math.round((12 + ch.floor * 2) * healMult(ctx, ch));
  ch.hp = Math.min(ch.maxHp, ch.hp + h);
  say(ch, `🧪 You chug a potion. It tastes like feet. +${h} HP.`);
}

function combatAction(ctx, ch, cb, type, rng) {
  if (cb.skipNext) { cb.skipNext = false; say(ch, '📎 You spend the turn filing paperwork.'); return endTurn(ctx, ch, cb, rng); }
  const s = syn(ctx, ch);
  const e = target(cb, rng, false);
  if (!e) return checkCombatEnd(ctx, ch, cb, rng);
  switch (type) {
    case 'attack': {
      const critChance = 0.08 + cb.critBonus / 100 + (ch.powers.some((p) => p.tags.includes('crit')) ? 0.05 : 0);
      const crit = rng.chance(critChance);
      let dmg = totalAtk(ch, ctx) + rng.range(-1, 2);
      if (crit) dmg = Math.round(dmg * (s.critMult ?? 2));
      hurtEnemy(ctx, ch, cb, e, dmg, rng, `🗡️ You ${crit ? 'CRIT' : 'hit'} ${e.name} for ${dmg}.${crit ? ' Right in the dignity.' : ''}`);
      fire(ctx, ch, cb, 'on_hit', rng);
      if (crit) fire(ctx, ch, cb, 'on_crit', rng);
      break;
    }
    case 'skill': {
      need(cb.skillCd === 0, `Skill on cooldown (${cb.skillCd}).`);
      cb.skillCd = 3;
      const dmg = Math.round(totalAtk(ch, ctx) * 1.6);
      hurtEnemy(ctx, ch, cb, e, dmg, rng, `💥 Signature move! ${dmg} to ${e.name}.`);
      fire(ctx, ch, cb, 'on_skill', rng);
      break;
    }
    case 'taunt': {
      const cost = allPowers(ch).reduce((a, p) => a + (ctx.content.drawbackById[p.drawback]?.tauntCost ?? 0), 0);
      if (cost) { ch.hp = Math.max(1, ch.hp - cost); say(ch, `🤬 Your cursed potty mouth insults a passing god. -${cost} HP.`); }
      say(ch, `🗣️ "${rng.pick(['Your mum filed you under "miscellaneous expenses".', 'I\'ve had scarier bowel movements.', 'Come here and let me rearrange your face into something less offensive.', 'I\'m going to wear your skin to brunch.', 'You look like a thumb that gained sentience and immediately regretted it.'])}"`);
      gainHype(ctx, ch, 4, '📺');
      fire(ctx, ch, cb, 'on_taunt', rng);
      break;
    }
    case 'defend': {
      const b = 3 + totalDef(ch) * 2;
      cb.block += b;
      say(ch, `🛡️ You brace (+${b} block).`);
      break;
    }
    case 'flee': {
      need(!allPowers(ch).some((p) => ctx.content.drawbackById[p.drawback]?.noFlee), 'Cowardice has been revoked for you.');
      need(!cb.elite, 'Elites lock the doors. Fight or die.');
      if (rng.chance(0.55)) {
        say(ch, '🏃 You flee, screaming. The audience boos. Duke Brisket calls you "a wet fart in human form".');
        ch.pending = null;
        ch.hype = Math.max(0, ch.hype - 5);
        fire(ctx, ch, null, 'on_flee', rng);
        return;
      }
      say(ch, '🏃 You try to flee and slip on something. Something organic.');
      break;
    }
    case 'potion': usePotion(ctx, ch); break;
  }
  if (s.freeAction && !cb.extraUsed && rng.chance(s.freeAction)) { cb.extraUsed = true; say(ch, '⚡ Zoomies! Free action.'); return checkCombatEnd(ctx, ch, cb, rng); }
  if (cb.bonusAction) { cb.bonusAction = false; return checkCombatEnd(ctx, ch, cb, rng); }
  endTurn(ctx, ch, cb, rng);
}

function resolveQuest(ctx, ch, p, choiceId, rng) {
  const q = ctx.content.questById[p.questId];
  const c = q.choices.find((x) => x.id === choiceId);
  need(c, 'Pick one of the options.');
  if (c.cost?.gold) need(ch.gold >= c.cost.gold, 'You can\'t afford that option.');
  if (c.cost?.gold) ch.gold -= c.cost.gold;
  const fill = (v) => (typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => String(p.fill[k] ?? k)) : v);
  for (const [k, v] of Object.entries(c.set ?? {})) ch.flags[k] = fill(v);
  if (c.incr) ch.flags[c.incr] = (ch.flags[c.incr] ?? 0) + 1;
  const r = c.reward ?? {};
  ch.pending = null;
  if (r.gold) ch.gold += r.gold;
  if (r.def) ch.def += r.def;
  if (r.atk) ch.atk = Math.max(1, ch.atk + r.atk);
  if (r.maxHp) { ch.maxHp = Math.max(10, ch.maxHp + r.maxHp); ch.hp = Math.min(ch.hp, ch.maxHp); }
  if (r.heal) ch.hp = Math.min(ch.maxHp, ch.hp + r.heal);
  if (r.hype) gainHype(ctx, ch, r.hype, '📺');
  if (r.secret) { ch.secretKeys += 1; say(ch, '🗝️ You receive a secret key.'); }
  if (r.stealth) ch.stealth = (ch.stealth ?? 0) + r.stealth;
  if (r.xp) gainXp(ctx, ch, r.xp, rng);
  if (r.discount) say(ch, '🏷️ Mama Grub discount unlocked for this season.');
  ch.questsDone.push(q.id);
  ch.stats.quests += 1;
  ch.fame += 30;
  say(ch, `✅ ${q.title}: you chose "${c.text}".`);
  if (c.curse) addCurse(ctx, ch, rng);
  if (ch.hp <= 0) return;
  if (r.minion) ch.flags.permMinion = (ch.flags.permMinion ?? 0) + r.minion;
  if (r.power) {
    const tagMap = { heal: 'filth', speed: 'speed', damage: 'crit' };
    const tag = r.power === 'random' ? null : (tagMap[fill(r.power)] ?? fill(r.power));
    offerPowers(ctx, ch, rng, `${q.title} reward`, { focusTag: tag });
  }
  if (c.fight) startCombat(ctx, ch, rng, { elite: c.fight === 'elite', label: '📜 ' });
  if (ch.pending?.kind === 'combat' && c.fight === 'elite') ch.pending.cb.forcedOffer = true;
}

function resolveShrine(ctx, ch, p, choice, rng) {
  need(p.options.some((o) => o.id === choice), 'The shrine doesn\'t offer that.');
  ch.pending = null;
  if (choice === 'blood') { ch.maxHp = Math.max(10, ch.maxHp - 6); ch.hp = Math.min(ch.hp, ch.maxHp); offerPowers(ctx, ch, rng, 'Blood shrine boon', {}); }
  if (choice === 'tithe') {
    const cost = 15 + ch.floor * 3;
    need(ch.gold >= cost, 'Not enough gold. The shrine sighs.');
    ch.gold -= cost; ch.curses.shift(); ch.fame += 15;
    fire(ctx, ch, null, 'gold_spent', rng);
    say(ch, '🙏 Tithe accepted. You feel 3% less damned.');
  }
  if (choice === 'pray') { if (rng.chance(0.5)) { ch.atk += 1; say(ch, '🙏 A divine slap. +1 ATK.'); } else { addCurse(ctx, ch, rng); gainHype(ctx, ch, 10, '📺'); } }
  if (choice === 'transmute') {
    need(ch.powers.length >= 4, 'You need at least four powers.');
    const rel = (q) => q.magnitude / (ctx.content.effectById[q.effect]?.base ?? 5);
    let wi = 0;
    ch.powers.forEach((q, i) => { if (rel(q) < rel(ch.powers[wi])) wi = i; });
    const [gone] = ch.powers.splice(wi, 1);
    say(ch, `♻️ ${gone.name} dissolves into a smell.`);
    offerPowers(ctx, ch, rng, 'Transmutation', {});
    if (ch.pending) ch.pending.offers = ch.pending.offers.filter((o) => o.sig !== gone.sig);
  }
}

/** Fame used for leaderboards: server-computed only. */
export function fameOf(ch) {
  return ch.fame + ch.stats.kills * 5 + ch.stats.elites * 25 + ch.stats.hypePeak * 2;
}

export { validateCombo, powerScore, SCORE_MIN, SCORE_MAX, composePower };
