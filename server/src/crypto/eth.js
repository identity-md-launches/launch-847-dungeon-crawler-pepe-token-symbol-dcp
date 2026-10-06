// Ethereum helpers: addresses, EIP-191 personal_sign recovery, ABI words, Merkle trees
// compatible with GameReserve (OpenZeppelin-style double-hashed leaves, sorted pairs).
import { keccak256 } from './keccak.js';
import { recover, publicKey, sign, bytesToBig, bigToBytes, N } from './secp256k1.js';

export const hex = (b) => '0x' + Buffer.from(b).toString('hex');
export const unhex = (h) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ''), 'hex'));
export const concat = (...arrs) => Uint8Array.from(arrs.flatMap((a) => [...a]));

export function toChecksum(addr) {
  const a = addr.toLowerCase().replace(/^0x/, '');
  const h = Buffer.from(keccak256(a)).toString('hex');
  return '0x' + [...a].map((c, i) => (parseInt(h[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}
export const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export const pubToAddress = (pub64) => toChecksum(hex(keccak256(pub64).slice(12)));
export const privToAddress = (priv) => pubToAddress(publicKey(priv));

export function hashPersonal(message) {
  const m = new TextEncoder().encode(message);
  return keccak256(concat(new TextEncoder().encode(`\x19Ethereum Signed Message:\n${m.length}`), m));
}

/** Recover the signer of an EIP-191 personal_sign signature (65 bytes hex). */
export function recoverPersonal(message, sigHex) {
  const sig = unhex(sigHex);
  if (sig.length !== 65) return null;
  const r = bytesToBig(sig.slice(0, 32));
  const s = bytesToBig(sig.slice(32, 64));
  if (s > N / 2n) return null; // reject malleable high-s
  let v = sig[64];
  if (v >= 27) v -= 27;
  const pub = recover(hashPersonal(message), r, s, v);
  return pub ? pubToAddress(pub) : null;
}

export function signPersonal(message, priv) {
  const { r, s, recId } = sign(hashPersonal(message), priv);
  return hex(concat(bigToBytes(r), bigToBytes(s), [27 + recId]));
}

export const word = (n) => bigToBytes(BigInt(n), 32);
export const addrWord = (a) => concat(new Uint8Array(12), unhex(a));

export function leafHash(index, account, amount) {
  return keccak256(keccak256(concat(word(index), addrWord(account), word(amount))));
}

function pairHash(a, b) {
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) < 0 ? keccak256(concat(a, b)) : keccak256(concat(b, a));
}

/** Build a Merkle tree; returns { root, proofs[i] } as hex. */
export function merkle(leaves) {
  if (leaves.length === 0) return { root: hex(new Uint8Array(32)), proofs: [] };
  const layers = [leaves];
  while (layers.at(-1).length > 1) {
    const prev = layers.at(-1), next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? pairHash(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  const proofs = leaves.map((_, idx) => {
    const p = [];
    let i = idx;
    for (let l = 0; l < layers.length - 1; l++) {
      const sib = i ^ 1;
      if (sib < layers[l].length) p.push(hex(layers[l][sib]));
      i >>= 1;
    }
    return p;
  });
  return { root: hex(layers.at(-1)[0]), proofs };
}

export function verifyProof(proof, root, leaf) {
  let h = leaf;
  for (const p of proof) h = pairHash(h, unhex(p));
  return hex(h) === root;
}

export { keccak256 };
