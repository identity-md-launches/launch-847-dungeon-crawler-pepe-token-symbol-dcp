// Deterministic, unpredictable-to-players randomness. Every roll is derived from
// HMAC(serverSecret, characterId) and a context string that includes the character's own
// history, so (a) the same situation replays identically (retries are idempotent and
// rerolling by reloading is impossible) and (b) different players / choices diverge.
// Valuable token prizes never use this: they use GameReserve's commit-reveal randomness.
import { createHmac, createHash } from 'node:crypto';

export function deriveSeed(secret, ...parts) {
  return createHmac('sha256', secret).update(parts.join('|')).digest();
}

export class Rng {
  constructor(seedBytes) {
    const b = Buffer.from(seedBytes);
    this.a = b.readUInt32LE(0) | 0; this.b = b.readUInt32LE(4) | 0;
    this.c = b.readUInt32LE(8) | 0; this.d = b.readUInt32LE(12) | 0;
    for (let i = 0; i < 12; i++) this.next();
  }
  static from(...parts) {
    return new Rng(createHash('sha256').update(parts.join('|')).digest());
  }
  next() { // sfc32
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  int(n) { return Math.floor(this.next() * n); }
  range(lo, hi) { return lo + this.int(hi - lo + 1); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  weighted(items, w = (x) => x.weight ?? 1) {
    let total = 0;
    for (const it of items) total += Math.max(0, w(it));
    if (total <= 0) return items[this.int(items.length)];
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, w(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

export const historyHash = (flags) =>
  createHash('sha256').update(JSON.stringify(Object.entries(flags ?? {}).sort())).digest('hex').slice(0, 16);
