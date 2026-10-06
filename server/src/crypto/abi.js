// Minimal Solidity ABI encoder/decoder for the calls this project makes (static words,
// bytes32[], dynamic arrays of tuples). Selectors are keccak256 of the canonical signature.
import { keccak256 } from './keccak.js';

const W = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0');
export const selector = (sig) => Buffer.from(keccak256(sig)).toString('hex').slice(0, 8);
export const topic = (sig) => '0x' + Buffer.from(keccak256(sig)).toString('hex');

function encStatic(type, v) {
  if (type === 'address') return W(BigInt(v));
  if (type === 'bool') return W(v ? 1 : 0);
  if (type === 'bytes32') return String(v).replace(/^0x/, '').padStart(64, '0');
  if (/^u?int\d*$/.test(type)) return W(v);
  throw new Error('unsupported static type ' + type);
}
const isDynamic = (t) => t.endsWith('[]') || (Array.isArray(t) && t.some(isDynamic));

/** types: strings like 'uint256','address','bytes32[]', or arrays of types for tuples; tuple arrays as {tuple:[...], array:true} */
export function encode(types, values) {
  const head = [], tail = [];
  let tailLen = 0;
  const headSize = types.length * 32;
  types.forEach((t, i) => {
    const v = values[i];
    if (typeof t === 'object' && t.array) {
      head.push(W(headSize + tailLen));
      const elems = v.map((x) => encode(t.tuple, x));
      const offsets = [];
      let off = v.length * 32;
      for (const e of elems) { offsets.push(W(off)); off += e.length / 2; }
      const body = W(v.length) + offsets.join('') + elems.join('');
      tail.push(body); tailLen += body.length / 2;
    } else if (typeof t === 'string' && t.endsWith('[]')) {
      head.push(W(headSize + tailLen));
      const base = t.slice(0, -2);
      const body = W(v.length) + v.map((x) => encStatic(base, x)).join('');
      tail.push(body); tailLen += body.length / 2;
    } else {
      head.push(encStatic(t, v));
    }
  });
  return head.join('') + tail.join('');
}

export function calldata(sig, types, values) {
  return '0x' + selector(sig) + encode(types, values);
}

export function decodeWords(hex) {
  const h = hex.replace(/^0x/, '');
  const out = [];
  for (let i = 0; i < h.length; i += 64) out.push(BigInt('0x' + h.slice(i, i + 64)));
  return out;
}
export const wordToAddress = (w) => '0x' + w.toString(16).padStart(40, '0').slice(-40);
export const wordToBytes32 = (w) => '0x' + w.toString(16).padStart(64, '0');
