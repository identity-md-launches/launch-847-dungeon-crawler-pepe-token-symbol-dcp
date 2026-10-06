// Keccak-256 (the pre-NIST padding Ethereum uses). Dependency-free, 32-bit lane halves.
const RC = [
  [0x00000001, 0x00000000], [0x00008082, 0x00000000], [0x0000808a, 0x80000000], [0x80008000, 0x80000000],
  [0x0000808b, 0x00000000], [0x80000001, 0x00000000], [0x80008081, 0x80000000], [0x00008009, 0x80000000],
  [0x0000008a, 0x00000000], [0x00000088, 0x00000000], [0x80008009, 0x00000000], [0x8000000a, 0x00000000],
  [0x8000808b, 0x00000000], [0x0000008b, 0x80000000], [0x00008089, 0x80000000], [0x00008003, 0x80000000],
  [0x00008002, 0x80000000], [0x00000080, 0x80000000], [0x0000800a, 0x00000000], [0x8000000a, 0x80000000],
  [0x80008081, 0x80000000], [0x00008080, 0x80000000], [0x80000001, 0x00000000], [0x80008008, 0x80000000],
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

function f1600(lo, hi) {
  const cLo = new Uint32Array(5), cHi = new Uint32Array(5);
  const bLo = new Uint32Array(25), bHi = new Uint32Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      cLo[x] = lo[x] ^ lo[x + 5] ^ lo[x + 10] ^ lo[x + 15] ^ lo[x + 20];
      cHi[x] = hi[x] ^ hi[x + 5] ^ hi[x + 10] ^ hi[x + 15] ^ hi[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const nLo = cLo[(x + 1) % 5], nHi = cHi[(x + 1) % 5];
      const dLo = cLo[(x + 4) % 5] ^ ((nLo << 1) | (nHi >>> 31));
      const dHi = cHi[(x + 4) % 5] ^ ((nHi << 1) | (nLo >>> 31));
      for (let y = 0; y < 25; y += 5) { lo[y + x] ^= dLo; hi[y + x] ^= dHi; }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const r = ROT[i];
        let l = lo[i], h = hi[i];
        if (r >= 32) { const t = l; l = h; h = t; }
        const s = r % 32;
        const rl = s ? (l << s) | (h >>> (32 - s)) : l;
        const rh = s ? (h << s) | (l >>> (32 - s)) : h;
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        bLo[j] = rl; bHi[j] = rh;
      }
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        lo[y + x] = bLo[y + x] ^ (~bLo[y + ((x + 1) % 5)] & bLo[y + ((x + 2) % 5)]);
        hi[y + x] = bHi[y + x] ^ (~bHi[y + ((x + 1) % 5)] & bHi[y + ((x + 2) % 5)]);
      }
    }
    lo[0] ^= RC[round][0];
    hi[0] ^= RC[round][1];
  }
}

/** @param {Uint8Array|string} input bytes, or a utf8 string */
export function keccak256(input) {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const lo = new Uint32Array(25), hi = new Uint32Array(25);
  const padLen = rate - (data.length % rate);
  const msg = new Uint8Array(data.length + padLen);
  msg.set(data);
  msg[data.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const view = new DataView(msg.buffer);
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      lo[i] ^= view.getUint32(off + i * 8, true);
      hi[i] ^= view.getUint32(off + i * 8 + 4, true);
    }
    f1600(lo, hi);
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) {
    ov.setUint32(i * 8, lo[i], true);
    ov.setUint32(i * 8 + 4, hi[i], true);
  }
  return out;
}
