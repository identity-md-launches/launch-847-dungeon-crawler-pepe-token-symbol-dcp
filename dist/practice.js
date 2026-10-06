// Separate, editable browser-only practice ledger. Never imported by the backend.
// Build copies the accepted engine verbatim; only its RNG is replaced for practice.
import { newCharacter, act } from './runtime/game/engine.js';
export { unlocked } from './runtime/game/floor.js';
import { buildContent } from './runtime/game/content.js';

export const PRACTICE_KEY = 'dcp.practice.v1';
export function practiceApi(storage = localStorage) {
  const content = buildContent();
  const load = () => {
    const raw = storage.getItem(PRACTICE_KEY);
    if (!raw) return { version: 1, characters: [], day: 0, receipts: {} };
    try { const d = JSON.parse(raw); if (d.version !== 1 || !Array.isArray(d.characters) || !d.receipts) throw Error(); return d; }
    catch { throw new Error('Practice save cannot be read. Export browser storage before clearing it; server saves are separate.'); }
  };
  const save = (d) => { try { storage.setItem(PRACTICE_KEY, JSON.stringify(d)); } catch { throw new Error('Practice save failed. Free browser storage and retry. This move was not saved.'); } };
  return async (path, { method = 'GET', body = undefined } = {}) => {
    const d = load();
    const url = new URL(path, 'https://practice.invalid');
    const event = content.dailyEvents[d.day % content.dailyEvents.length];
    const list = () => d.characters.map(({ character: c }) => ({ ...c, depth: c.stats.bestDepth, build: [...new Set(c.powers.flatMap((p) => p.tags))] }));
    if (url.pathname === '/api/config') return { app: 'practice-1', practice: true, demo: false, chain: 'practice', chainId: 0, classes: content.classes, world: content.world, skus: [] };
    if (url.pathname === '/api/world') return { season: { id: 1 }, day: d.day, depthGate: 3 + d.day * 2, event };
    if (url.pathname === '/api/me') return { account: { id: 'practice', wallet: null }, characters: list(), owned: [], slots: 8 };
    if (url.pathname === '/api/leaderboard') return { season: 1, day: d.day, top: list().sort((a,b) => b.fame-a.fame), daily: [] };
    if (url.pathname === '/api/characters' && method === 'POST') {
      if (!/^[\p{L}\p{N} _'-]{2,20}$/u.test(body.name ?? '')) throw Error('Use 2–20 letters, numbers, spaces, _ apostrophe or hyphen.');
      if (d.characters.filter((c) => c.character.alive).length >= 8) throw Error('All 8 practice slots are occupied. Continue an existing Crawler.');
      const id = crypto.randomUUID();
      const seed = crypto.randomUUID();
      const entry = { seed, rev: 0, character: newCharacter(content, seed, { ...body, id, day: d.day, dailyEvent: event }) };
      d.characters.push(entry); save(d); return structuredClone(entry);
    }
    const entry = d.characters.find((x) => x.character.id === (body?.charId ?? url.searchParams.get('id')));
    if (url.pathname === '/api/character') { if (!entry) throw Error('Practice Crawler not found. Choose another Crawler.'); return structuredClone(entry); }
    if (url.pathname === '/api/act' && method === 'POST') {
      if (!entry) throw Error('Practice Crawler not found.');
      const fingerprint = JSON.stringify(body);
      const receipt = d.receipts[body.actionId];
      if (receipt) { if (receipt.request !== fingerprint) throw Error('Action ID already used.'); return structuredClone(receipt.response); }
      if (body.rev !== entry.rev) { const error = Object.assign(new Error('Practice synced from another tab. Retry your move.'), { status: 409, data: { current: structuredClone(entry) } }); throw error; }
      if (body.action.type === 'revive') throw Error('Revives require the integrated demo.');
      act({ content, seed: entry.seed, dailyEvent: event, popularity: new Map(), maxDepth: 3 + 2 * d.day }, entry.character, body.action);
      entry.rev++;
      const response = structuredClone(entry);
      d.receipts[body.actionId] = { request: fingerprint, response };
      const keys = Object.keys(d.receipts); if (keys.length > 10) delete d.receipts[keys[0]];
      save(d); return response;
    }
    throw Error('This feature needs the local integrated server. Practice cannot buy, claim or connect wallets.');
  };
}
