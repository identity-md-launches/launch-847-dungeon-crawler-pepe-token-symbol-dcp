// Minimal secp256k1: public-key recovery (signature verification) and RFC 6979 signing.
// Verification only touches public data. Signing is used by tests, bots and the isolated
// keeper signer process; it is not constant-time, so run it only in that isolated process.
import { createHmac } from 'node:crypto';

export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
];

const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
function inv(a, m = P) {
  let [x, y, u, v] = [0n, 1n, m, mod(a, m)];
  while (v) { const q = u / v; [x, y] = [y, x - q * y]; [u, v] = [v, u - q * v]; }
  return mod(x, m);
}
function powmod(b, e, m) { let r = 1n; b = mod(b, m); while (e) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }

// Jacobian point ops; null = infinity.
function dbl(p) {
  if (!p) return null;
  const [X, Y, Z] = p;
  if (Y === 0n) return null;
  const S = mod(4n * X * Y * Y), M = mod(3n * X * X);
  const X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * Y ** 4n), mod(2n * Y * Z)];
}
function add(p, q) {
  if (!p) return q; if (!q) return p;
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  const Z1Z1 = mod(Z1 * Z1), Z2Z2 = mod(Z2 * Z2);
  const U1 = mod(X1 * Z2Z2), U2 = mod(X2 * Z1Z1);
  const S1 = mod(Y1 * Z2 * Z2Z2), S2 = mod(Y2 * Z1 * Z1Z1);
  if (U1 === U2) return S1 === S2 ? dbl(p) : null;
  const H = mod(U2 - U1), R = mod(S2 - S1);
  const H2 = mod(H * H), H3 = mod(H * H2);
  const X3 = mod(R * R - H3 - 2n * U1 * H2);
  return [X3, mod(R * (U1 * H2 - X3) - S1 * H3), mod(H * Z1 * Z2)];
}
function mul(pt, k) {
  let r = null, a = [pt[0], pt[1], 1n];
  while (k > 0n) { if (k & 1n) r = add(r, a); a = dbl(a); k >>= 1n; }
  return r;
}
function affine(p) {
  if (!p) return null;
  const zi = inv(p[2]);
  return [mod(p[0] * zi * zi), mod(p[1] * zi * zi * zi)];
}

export const bytesToBig = (b) => BigInt('0x' + (Buffer.from(b).toString('hex') || '0'));
export const bigToBytes = (n, len = 32) => Uint8Array.from(Buffer.from(n.toString(16).padStart(len * 2, '0'), 'hex'));

export function publicKey(priv) {
  const pt = affine(mul(G, priv));
  return Uint8Array.from([...bigToBytes(pt[0]), ...bigToBytes(pt[1])]); // 64 bytes, uncompressed w/o prefix
}

/** Returns the 64-byte public key that produced (r,s) over hash, or null. */
export function recover(hash32, r, s, recId) {
  if (r <= 0n || r >= N || s <= 0n || s >= N || recId < 0 || recId > 1) return null;
  const x = r;
  const alpha = mod(x * x * x + 7n);
  const beta = powmod(alpha, (P + 1n) / 4n, P);
  if (mod(beta * beta) !== alpha) return null;
  const y = (beta & 1n) === BigInt(recId) ? beta : P - beta;
  const e = mod(bytesToBig(hash32), N);
  const ri = inv(r, N);
  const Q = affine(add(mul([x, y], mod(s * ri, N)), mul(G, mod(-e * ri, N))));
  if (!Q) return null;
  return Uint8Array.from([...bigToBytes(Q[0]), ...bigToBytes(Q[1])]);
}

function rfc6979k(priv, hash32) {
  const x = bigToBytes(priv), h = bigToBytes(mod(bytesToBig(hash32), N));
  let V = Buffer.alloc(32, 1), K = Buffer.alloc(32, 0);
  const hm = (k, ...d) => createHmac('sha256', k).update(Buffer.concat(d.map((z) => Buffer.from(z)))).digest();
  K = hm(K, V, [0], x, h); V = hm(K, V);
  K = hm(K, V, [1], x, h); V = hm(K, V);
  for (;;) {
    V = hm(K, V);
    const k = bytesToBig(V);
    if (k > 0n && k < N) return k;
    K = hm(K, V, [0]); V = hm(K, V);
  }
}

/** Low-s signature. Returns { r, s, recId }. */
export function sign(hash32, priv) {
  const k = rfc6979k(priv, hash32);
  const R = affine(mul(G, k));
  const r = mod(R[0], N);
  let s = mod(inv(k, N) * (bytesToBig(hash32) + r * priv), N);
  let recId = Number(R[1] & 1n);
  if (s > N / 2n) { s = N - s; recId ^= 1; }
  return { r, s, recId };
}
