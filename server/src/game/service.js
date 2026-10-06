// Game service: persistence, concurrency and idempotency around the pure engine.
// Every action carries (characterId, rev, actionId). A retried actionId returns the stored
// response; a stale rev gets 409 with the current state. Writes are single transactions.
import { all, one, run, tx, getMeta, setMeta } from '../db.js';
import { buildContent } from './content.js';
import { newCharacter, act, fameOf, GameError } from './engine.js';
import { generateFloor } from './floor.js';
import { deriveSeed, Rng } from './rng.js';
import { popularityFrom } from './powers.js';
import { recordDepth } from '../economy.js';
import { ownedSkus, consumeRevive } from '../shop.js';

export class ContentRegistry {
  constructor(db) {
    this.db = db;
    this.cache = new Map();
    if (!one(db, 'SELECT 1 FROM content_versions WHERE version = 1')) {
      run(db, 'INSERT INTO content_versions(version, packs, status, activate_at, created_at, note) VALUES(1, ?, ?, 0, ?, ?)', '[]', 'published', Date.now(), 'base pack');
    }
  }
  get(version) {
    if (this.cache.has(version)) return this.cache.get(version);
    const row = one(this.db, 'SELECT * FROM content_versions WHERE version = ?', version);
    if (!row) return this.active();
    const ids = JSON.parse(row.packs);
    const packs = ids.map((id) => JSON.parse(one(this.db, 'SELECT body FROM content_packs WHERE id = ?', id).body));
    const c = buildContent(packs, version);
    this.cache.set(version, c);
    return c;
  }
  activeVersion(now = Date.now()) {
    return one(this.db, "SELECT max(version) v FROM content_versions WHERE status = 'published' AND activate_at <= ?", now).v ?? 1;
  }
  active(now = Date.now()) { return this.get(this.activeVersion(now)); }
  status(version) { return one(this.db, 'SELECT status FROM content_versions WHERE version = ?', version)?.status ?? 'missing'; }
}

const NAME_RE = /^[A-Za-z0-9 _'\-]{2,20}$/;

export class GameService {
  constructor({ db, secret, dayMs = 86400_000, now = () => Date.now() }) {
    this.db = db;
    this.secret = secret;
    this.dayMs = dayMs;
    this.now = now;
    this.registry = new ContentRegistry(db);
    if (!getMeta(db, 'season')) setMeta(db, 'season', { id: 1, startMs: now() - (now() % dayMs) });
    this.popCache = { at: 0, map: new Map() };
  }

  season() { return getMeta(this.db, 'season'); }
  day(t = this.now()) { return Math.max(0, Math.floor((t - this.season().startMs) / this.dayMs)); }
  maxDepth(t = this.now()) { return 3 + 2 * this.day(t); }
  dailyEvent(t = this.now()) {
    const c = this.registry.active(t);
    const rng = Rng.from(this.secret, 'event', this.season().id, this.day(t));
    return rng.pick(c.dailyEvents);
  }
  seedFor(charId) { return deriveSeed(this.secret, 'char', charId); }
  popularity() {
    if (this.now() - this.popCache.at > 60_000) {
      const counts = new Map(all(this.db, 'SELECT effect_id, n FROM picks').map((r) => [r.effect_id, r.n]));
      this.popCache = { at: this.now(), map: popularityFrom(this.registry.active(), counts) };
    }
    return this.popCache.map;
  }

  slots(accountId) { return 1 + ownedSkus(this.db, accountId).filter((s) => s.sku === 3).length; }

  createCharacter(accountId, { name, classId }) {
    if (!NAME_RE.test(String(name ?? ''))) throw new GameError('Name: 2-20 letters, numbers, spaces, _ \' -');
    if (/https?:|www\.|\.com|0x[0-9a-f]{6}/i.test(name)) throw new GameError('No links or addresses in names.');
    const alive = one(this.db, 'SELECT count(*) n FROM characters WHERE account_id = ? AND alive = 1', accountId).n;
    if (alive >= this.slots(accountId)) throw new GameError('All character slots are occupied by living idiots.');
    const best = one(this.db, 'SELECT max(best_depth) d FROM characters WHERE account_id = ? AND season = ?', accountId, this.season().id).d ?? 1;
    const startDepth = Math.max(1, Math.min(this.maxDepth(), Math.floor(best / 2)));
    const content = this.registry.active();
    const id = 'ch_' + accountId.slice(5, 13) + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const ch = newCharacter(content, this.seedFor(id), { id, name, classId, day: this.day(), dailyEvent: this.dailyEvent(), startDepth });
    if (startDepth > 1) ch.log.push(`🛗 Elevator Pass: your previous best lets this Crawler start on floor ${startDepth}.`);
    run(this.db, 'INSERT INTO characters(id, account_id, state, rev, alive, fame, best_depth, season, created_at, updated_at) VALUES(?, ?, ?, 0, 1, 0, ?, ?, ?, ?)',
      id, accountId, JSON.stringify(ch), startDepth, this.season().id, this.now(), this.now());
    return { character: ch, rev: 0 };
  }

  load(accountId, charId) {
    const row = one(this.db, 'SELECT * FROM characters WHERE id = ? AND account_id = ?', charId, accountId);
    if (!row) throw new GameError('No such character.');
    return { row, ch: JSON.parse(row.state) };
  }

  list(accountId) {
    return all(this.db, 'SELECT id, rev, alive, fame, best_depth, state FROM characters WHERE account_id = ? ORDER BY created_at DESC LIMIT 20', accountId)
      .map((r) => { const s = JSON.parse(r.state); return { id: r.id, rev: r.rev, alive: !!r.alive, fame: r.fame, bestDepth: r.best_depth, name: s.name, className: s.className, floor: s.floor, level: s.level }; });
  }

  /** Apply an action with idempotency + optimistic concurrency. */
  act(accountId, { charId, rev, actionId, action }) {
    if (typeof actionId !== 'string' || actionId.length < 8 || actionId.length > 64) throw new GameError('actionId required');
    return tx(this.db, () => {
      const prior = one(this.db, 'SELECT response FROM action_log WHERE account_id = ? AND action_id = ?', accountId, actionId);
      if (prior) return { ...JSON.parse(prior.response), replayed: true };
      const { row, ch } = this.load(accountId, charId);
      if (row.rev !== rev) { const e = new GameError('Stale state: another device or tab moved first.'); e.status = 409; e.current = { character: ch, rev: row.rev }; throw e; }
      const t = this.now();
      if (action?.type === 'revive') return this.revive(accountId, row, ch, actionId);
      const fameBefore = fameOf(ch);
      // Content pinning: finish the current floor on the version it was generated with,
      // unless that version was marked unsafe, in which case regenerate on the active one.
      let floorVersion = ch.map.contentVersion;
      if (this.registry.status(floorVersion) === 'unsafe') {
        const c = this.registry.active(t);
        ch.map = generateFloor(c, this.seedFor(ch.id), ch, ch.floor, this.dailyEvent(t));
        ch.node = 0; ch.visited = [0];
        if (ch.pending?.kind !== 'combat') ch.pending = null;
        ch.log.push('🧯 The IDSC recalled this floor for "content safety". You\'ve been relocated. Your stuff came with you.');
        floorVersion = c.version;
      }
      const generating = action?.type === 'descend' || action?.type === 'overtime';
      const content = generating ? this.registry.active(t) : this.registry.get(floorVersion);
      const ctx = { content, seed: this.seedFor(ch.id), dailyEvent: this.dailyEvent(t), popularity: this.popularity(), maxDepth: this.maxDepth(t) };
      const { events } = act(ctx, ch, action ?? {});
      const fame = fameOf(ch);
      const newRev = row.rev + 1;
      run(this.db, 'UPDATE characters SET state = ?, rev = ?, alive = ?, fame = ?, best_depth = max(best_depth, ?), updated_at = ? WHERE id = ?',
        JSON.stringify(ch), newRev, ch.alive ? 1 : 0, fame, ch.stats.bestDepth, t, ch.id);
      run(this.db, 'UPDATE accounts SET actions = actions + 1 WHERE id = ?', accountId);
      if (fame > fameBefore && row.leaderboard_ok) {
        run(this.db, 'INSERT INTO daily_fame(day, account_id, fame) VALUES(?, ?, ?) ON CONFLICT(day, account_id) DO UPDATE SET fame = fame + excluded.fame', this.day(t), accountId, fame - fameBefore);
      }
      for (const e of events) {
        if (e.type === 'pick') run(this.db, 'INSERT INTO picks(effect_id, n) VALUES(?, 1) ON CONFLICT(effect_id) DO UPDATE SET n = n + 1', e.effect);
        if (e.type === 'depth' && row.leaderboard_ok) recordDepth(this.db, accountId, this.season().id, e.depth);
      }
      const response = { character: ch, rev: newRev };
      run(this.db, 'INSERT INTO action_log(account_id, action_id, char_id, rev_after, response, created_at) VALUES(?, ?, ?, ?, ?, ?)', accountId, actionId, ch.id, newRev, JSON.stringify(response), t);
      return response;
    });
  }

  revive(accountId, row, ch, actionId) {
    if (ch.alive) throw new GameError('Not dead. Yet.');
    if (!consumeRevive(this.db, accountId)) throw new GameError('No Big Mother Revive owned.');
    ch.alive = true;
    ch.hp = Math.ceil(ch.maxHp / 2);
    ch.revived = true;
    ch.log.push('💸 Big Mother Afterlife Insurance revives you. Your deductible is your dignity. This run no longer counts for leaderboard prizes.');
    const newRev = row.rev + 1;
    run(this.db, 'UPDATE characters SET state = ?, rev = ?, alive = 1, leaderboard_ok = 0, updated_at = ? WHERE id = ?', JSON.stringify(ch), newRev, this.now(), ch.id);
    const response = { character: ch, rev: newRev };
    run(this.db, 'INSERT INTO action_log(account_id, action_id, char_id, rev_after, response, created_at) VALUES(?, ?, ?, ?, ?, ?)', accountId, actionId, ch.id, newRev, JSON.stringify(response), this.now());
    return response;
  }

  leaderboard(limit = 25) {
    const season = this.season().id;
    const top = all(this.db, `SELECT c.id, c.fame, c.best_depth, c.alive, c.state, a.display_name FROM characters c JOIN accounts a ON a.id = c.account_id
      WHERE c.season = ? AND c.leaderboard_ok = 1 ORDER BY c.fame DESC LIMIT ?`, season, limit)
      .map((r) => { const s = JSON.parse(r.state); return { name: s.name, className: s.className, fame: r.fame, depth: r.best_depth, alive: !!r.alive, level: s.level, build: [...new Set(s.powers.flatMap((p) => p.tags))].slice(0, 4) }; });
    const daily = all(this.db, 'SELECT account_id, fame FROM daily_fame WHERE day = ? ORDER BY fame DESC LIMIT ?', this.day(), limit)
      .map((r, i) => ({ rank: i + 1, account: r.account_id.slice(0, 13), fame: r.fame }));
    return { season, day: this.day(), top, daily };
  }

  pruneActionLog(olderThanMs = 7 * 86400_000) {
    run(this.db, 'DELETE FROM action_log WHERE created_at < ?', this.now() - olderThanMs);
  }
}

export { GameError };
