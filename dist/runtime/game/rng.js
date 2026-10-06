// Browser practice ONLY. Non-cryptographic randomness; never used by the server or prizes.
function hash(text) {
  let h = 2166136261;
  for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
export class Rng {
  constructor(seed) { this.state = hash(seed) || 1; }
  static from(...parts) { return new Rng(parts.join('|')); }
  next() { let t = this.state += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  int(n) { return Math.floor(this.next() * n); }
  range(lo, hi) { return lo + this.int(hi - lo + 1); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[this.int(arr.length)]; }
  weighted(items, w = (x) => x.weight ?? 1) {
    const total = items.reduce((n, x) => n + Math.max(0, w(x)), 0);
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, w(it)); if (r <= 0) return it; }
    return items.at(-1);
  }
  shuffle(arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
}
export const historyHash = (flags) => hash(JSON.stringify(Object.entries(flags ?? {}).sort())).toString(16);
