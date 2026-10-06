// Independent review of a content pack. Written separately from the author and run as its
// own stage: anything the author (local or swarm) produces is untrusted data. Rejects on:
//  - schema: only known lists/fields; effect kinds from the engine whitelist; bounded numbers
//  - safety: links, code, markup, wallet/addresses, secrets-like strings, prompt-injection
//    phrasing, hateful slurs, sexual content involving minors, real-person targeting
//  - balance: magnitudes and event modifiers inside fixed bounds
//  - size and duplication limits
import { EFFECT_KINDS } from '../game/powers.js';

const MAX_TEXT = 220;
const BAD_PATTERNS = [
  [/https?:\/\/|www\.|\.(com|io|xyz|net|org)\b/i, 'link'],
  [/<\s*\/?\s*[a-z]+[^>]*>|javascript:|on\w+\s*=/i, 'markup/script'],
  [/\b(eval|require|import|function|=>|process\.|child_process|fetch\()\b/, 'code'],
  [/0x[0-9a-fA-F]{20,}/, 'address/hex blob'],
  [/\b(private key|seed phrase|mnemonic|api[_ -]?key|password|bearer)\b/i, 'secret-like'],
  [/\b(ignore (all|previous|prior)|system prompt|you are now|disregard|developer mode|transfer (the )?(funds|tokens)|send .* (eth|imd|dcp))\b/i, 'instruction/injection'],
  [/\b(child|minor|underage|kid)s?\b.*\b(sex|nude|naked|erotic)/i, 'sexual content involving minors'],
  [/\b(n[i1]gg|f[a@]gg?ot|k[i1]ke|tr[a@]nny|sp[i1]c|ch[i1]nk)/i, 'slur'],
];
const ALLOWED_KEYS = new Set(['id', 'version', 'author', 'effects', 'monsterBodies', 'biomes', 'dailyEvents', 'callbacks', 'quests', 'monsterAffixes', 'afflictions']);
const MOD_BOUNDS = { goldMult: [0.7, 1.5], xpMult: [0.8, 1.5], hypeMult: [0.5, 2.5], eliteMult: [0.5, 3], combatMult: [0.5, 1.5], enemyHp: [0.8, 1.3], restMult: [0.5, 2], sponsorMult: [0.5, 2.5], lootUp: [0, 1] };
const BASE_BOUNDS = { damage: [2, 9], poison: [1, 5], bleed: [1, 5], burn: [1, 5], heal: [2, 8], shield: [2, 8], gold: [2, 8], minion: [1, 4], hype: [1, 6], stun: [1, 1], weaken: [1, 3], reflect: [1, 4], drain: [2, 6], chaos: [4, 9], extra_action: [1, 1], crit_chance: [5, 12] };

function textOk(s, where, problems) {
  if (typeof s !== 'string' || !s.trim()) return problems.push(`${where}: missing text`);
  if (s.length > MAX_TEXT) problems.push(`${where}: text too long`);
  for (const [re, why] of BAD_PATTERNS) if (re.test(s)) problems.push(`${where}: ${why}`);
}
const idOk = (id) => typeof id === 'string' && /^[a-z0-9_\-]{2,48}$/i.test(id);

export function reviewPack(pack, existing, tags) {
  const problems = [];
  if (!pack || typeof pack !== 'object') return { ok: false, problems: ['not an object'] };
  for (const k of Object.keys(pack)) if (!ALLOWED_KEYS.has(k)) problems.push(`unknown key ${k}`);
  if (!idOk(pack.id)) problems.push('bad pack id');
  const size = JSON.stringify(pack).length;
  if (size > 50_000) problems.push('pack too large');
  const existingIds = new Set([...existing.effects, ...existing.monsterBodies, ...existing.biomes, ...existing.dailyEvents].map((x) => x.id));
  const seen = new Set();
  const uniq = (id, where) => { if (!idOk(id)) problems.push(`${where}: bad id`); if (existingIds.has(id) || seen.has(id)) problems.push(`${where}: duplicate id ${id}`); seen.add(id); };
  for (const e of pack.effects ?? []) {
    uniq(e.id, `effect ${e.id}`);
    if (!EFFECT_KINDS.has(e.kind)) problems.push(`effect ${e.id}: kind ${e.kind} not allowed`);
    const [lo, hi] = BASE_BOUNDS[e.kind] ?? [0, 0];
    if (!(Number.isInteger(e.base) && e.base >= lo && e.base <= hi)) problems.push(`effect ${e.id}: base out of bounds`);
    if (!Array.isArray(e.tags) || !e.tags.length || e.tags.some((t) => !tags.includes(t))) problems.push(`effect ${e.id}: bad tags`);
    textOk(e.text, `effect ${e.id}`, problems);
    if (!String(e.text).includes('{n}')) problems.push(`effect ${e.id}: text must show magnitude {n}`);
  }
  for (const m of pack.monsterBodies ?? []) {
    uniq(m.id, `monster ${m.id}`);
    if (!(m.hp >= 8 && m.hp <= 32 && m.atk >= 2 && m.atk <= 7)) problems.push(`monster ${m.id}: stats out of bounds`);
    textOk(m.name, `monster ${m.id} name`, problems);
    textOk(m.text, `monster ${m.id}`, problems);
  }
  for (const b of pack.biomes ?? []) { uniq(b.id, `biome ${b.id}`); textOk(b.name, `biome ${b.id} name`, problems); textOk(b.text, `biome ${b.id}`, problems); }
  for (const ev of pack.dailyEvents ?? []) {
    uniq(ev.id, `event ${ev.id}`);
    textOk(ev.name, `event ${ev.id} name`, problems);
    textOk(ev.text, `event ${ev.id}`, problems);
    for (const [k, v] of Object.entries(ev.mod ?? {})) {
      const b = MOD_BOUNDS[k];
      if (!b || typeof v !== 'number' || v < b[0] || v > b[1]) problems.push(`event ${ev.id}: modifier ${k} out of bounds`);
    }
  }
  for (const c of pack.callbacks ?? []) {
    textOk(c.line, 'callback', problems);
    if (!c.when || typeof c.when !== 'object' || Object.keys(c.when).length === 0) problems.push('callback: missing condition');
  }
  if ((pack.quests ?? []).length) problems.push('quests: swarm-authored quests require the v2 quest schema (not enabled in this build)');
  const counts = (pack.effects?.length ?? 0) + (pack.monsterBodies?.length ?? 0) + (pack.biomes?.length ?? 0) + (pack.dailyEvents?.length ?? 0);
  if (counts === 0) problems.push('empty pack');
  if ((pack.effects?.length ?? 0) > 12) problems.push('too many effects in one pack');
  return { ok: problems.length === 0, problems };
}
