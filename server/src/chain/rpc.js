// RpcChain: JSON-RPC adapter for the deployed contracts (anvil/fork now, mainnet at launch).
// Same interface as SimChain. Synchronous getters read a snapshot refreshed by the keeper.
//
// Authority separation: the keeper signer can only do what GameReserve's poster role and
// permissionless functions allow (commit/anchor/reveal/post, harvest, recycle, top-up). The
// payment signer is a different key that can only call OpsTreasury.payWork within onchain
// caps. Keys are read from files outside the repo (see deploy/), never from source or env
// dumps, and are never logged. Gas is capped: if the network is pricier than maxFeeGwei the
// transaction is deferred, not sent.
import { readFileSync } from 'node:fs';
import { keccak256, hex, unhex, concat, privToAddress } from '../crypto/eth.js';
import { sign } from '../crypto/secp256k1.js';
import { calldata, decodeWords, wordToAddress, wordToBytes32, topic } from '../crypto/abi.js';

// ---------------------------------------------------------------- RLP / tx signing
function rlpBytes(b) {
  if (b.length === 1 && b[0] < 0x80) return b;
  return concat(rlpLen(b.length, 0x80), b);
}
function rlpLen(n, off) {
  if (n < 56) return Uint8Array.from([off + n]);
  const l = unhex(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, '0'));
  return Uint8Array.from([off + 55 + l.length, ...l]);
}
function rlp(x) {
  if (Array.isArray(x)) { const body = concat(...x.map(rlp)); return concat(rlpLen(body.length, 0xc0), body); }
  return rlpBytes(x);
}
const qty = (n) => { n = BigInt(n); if (n === 0n) return new Uint8Array(0); const h = n.toString(16); return unhex(h.length % 2 ? '0' + h : h); };

export function signTx1559(tx, priv) {
  const fields = [qty(tx.chainId), qty(tx.nonce), qty(tx.maxPriorityFeePerGas), qty(tx.maxFeePerGas), qty(tx.gas), unhex(tx.to), qty(tx.value ?? 0), unhex(tx.data ?? '0x'), []];
  const digest = keccak256(concat([2], rlp(fields)));
  const { r, s, recId } = sign(digest, priv);
  return hex(concat([2], rlp([...fields, qty(recId), qty(r), qty(s)])));
}

export class Signer {
  constructor(keyFile) {
    const k = readFileSync(keyFile, 'utf8').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error(`key file ${keyFile} malformed`);
    const priv = BigInt(k);
    this.address = privToAddress(priv);
    this.signTx = (tx) => signTx1559(tx, priv); // closure: key never exposed as a property
  }
}

// ---------------------------------------------------------------- adapter
const T_PURCHASE = topic('Purchase(address,bytes32,uint256,uint256)');
const T_CLAIMED = topic('Claimed(uint256,uint256,address,uint256)');

export class RpcChain {
  constructor({ rpcUrl, chainId, addresses, keeper, payment, maxFeeGwei = 30, confirmTimeoutMs = 120_000, fetchImpl = fetch }) {
    Object.assign(this, { rpcUrl, chainId, keeper, payment, maxFeeGwei, confirmTimeoutMs, fetchImpl });
    this.kind = 'rpc';
    this.canPay = !!payment; // false in the web/keeper processes: payments go via the isolated payer
    this.addr = addresses; // { dcp, imd, reserve, treasury, shop }
    this.snap = { imd: 0n, dcpReserve: 0n, dcpTreasury: 0n, outstanding: 0n, epochCap: 0n, at: 0 };
    this.id = 1;
  }

  async rpc(method, params) {
    const res = await this.fetchImpl(this.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: this.id++, method, params }) });
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  }
  async call(to, data) { return this.rpc('eth_call', [{ to, data }, 'latest']); }
  async word(to, sig, types = [], vals = []) { return decodeWords(await this.call(to, calldata(sig, types, vals)))[0]; }

  async refresh() {
    const bal = (who) => this.word(this.addr.dcp, 'balanceOf(address)', ['address'], [who]);
    const [imd, dr, dt, out, cap] = await Promise.all([
      this.word(this.addr.imd, 'balanceOf(address)', ['address'], [this.addr.treasury]), bal(this.addr.reserve), bal(this.addr.treasury),
      this.word(this.addr.reserve, 'outstanding()'), this.word(this.addr.reserve, 'epochCap()'),
    ]);
    this.snap = { imd, dcpReserve: dr, dcpTreasury: dt, outstanding: out, epochCap: cap, at: Date.now() };
  }
  imdBalance() { return this.snap.imd; }
  balanceOf(asset, who) { return asset === 'DCP' && who === this.addr.reserve ? this.snap.dcpReserve : asset === 'DCP' && who === this.addr.treasury ? this.snap.dcpTreasury : 0n; }
  reserveOutstanding() { return this.snap.outstanding; }
  epochCap() { return this.snap.epochCap; }
  liquidity() { return { note: 'pool depth is read from the IMD factory once its interface is verified at launch' }; }

  async getBlockNumber() { return Number(await this.rpc('eth_blockNumber', [])); }
  async getBlock(n) { const b = await this.rpc('eth_getBlockByNumber', ['0x' + n.toString(16), false]); return b && { number: Number(b.number), hash: b.hash, parent: b.parentHash, time: Number(b.timestamp) }; }
  async getLogs(from, to) {
    const logs = await this.rpc('eth_getLogs', [{ fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), address: [this.addr.shop, this.addr.reserve], topics: [[T_PURCHASE, T_CLAIMED]] }]);
    return logs.filter((l) => !l.removed).map((l) => {
      const d = decodeWords(l.data);
      const base = { blockNumber: Number(l.blockNumber), blockHash: l.blockHash, txHash: l.transactionHash, logIndex: Number(l.logIndex) };
      if (l.topics[0] === T_PURCHASE) return { ...base, event: 'Purchase', args: { buyer: wordToAddress(BigInt(l.topics[1])), orderId: l.topics[2], sku: d[0], amount: d[1] } };
      return { ...base, event: 'Claimed', args: { epoch: BigInt(l.topics[1]), index: BigInt(l.topics[2]), account: wordToAddress(BigInt(l.topics[3])), amount: d[0] } };
    });
  }

  async send(signer, to, data) {
    if (!signer) throw new Error('NotProvisioned: signer key not configured');
    const [nonce, block, tip] = await Promise.all([
      this.rpc('eth_getTransactionCount', [signer.address, 'pending']), this.rpc('eth_getBlockByNumber', ['latest', false]), this.rpc('eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00'),
    ]);
    const base = BigInt(block.baseFeePerGas ?? 0);
    const maxFee = base * 2n + BigInt(tip);
    if (maxFee > BigInt(this.maxFeeGwei) * 10n ** 9n) throw new Error(`GasTooHigh: ${maxFee} wei > cap; deferred`);
    const gas = BigInt(await this.rpc('eth_estimateGas', [{ from: signer.address, to, data }])) * 12n / 10n;
    const raw = signer.signTx({ chainId: this.chainId, nonce: BigInt(nonce), maxPriorityFeePerGas: BigInt(tip), maxFeePerGas: maxFee, gas, to, data });
    const txHash = await this.rpc('eth_sendRawTransaction', [raw]);
    const t0 = Date.now();
    for (;;) {
      const rc = await this.rpc('eth_getTransactionReceipt', [txHash]);
      if (rc) { if (rc.status !== '0x1') throw new Error(`reverted: ${txHash}`); return { txHash, blockNumber: Number(rc.blockNumber) }; }
      if (Date.now() - t0 > this.confirmTimeoutMs) throw new Error(`receipt timeout ${txHash} (will be reconciled, not resent)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // GameReserve (keeper = poster role; anchor is permissionless)
  async commitSeed(e, seedHash) { await this.send(this.keeper, this.addr.reserve, calldata('commitSeed(uint256,bytes32)', ['uint256', 'bytes32'], [e, seedHash])); }
  async anchor(e) { const r = await this.send(this.keeper, this.addr.reserve, calldata('anchor(uint256)', ['uint256'], [e])); return r.blockNumber; }
  async revealSeed(e, seed) {
    await this.send(this.keeper, this.addr.reserve, calldata('revealSeed(uint256,bytes32)', ['uint256', 'bytes32'], [e, seed]));
    const words = decodeWords(await this.call(this.addr.reserve, calldata('rounds(uint256)', ['uint256'], [e])));
    return wordToBytes32(words[2]);
  }
  async postRoot(e, root, total) { await this.send(this.keeper, this.addr.reserve, calldata('postRoot(uint256,bytes32,uint256)', ['uint256', 'bytes32', 'uint256'], [e, root, total])); }
  async lastPostedEpoch() { return Number(await this.word(this.addr.reserve, 'lastPostedEpoch()')); }
  async roundState(e) {
    const w = decodeWords(await this.call(this.addr.reserve, calldata('rounds(uint256)', ['uint256'], [e])));
    const hash = (i) => w[i] === 0n ? null : wordToBytes32(w[i]);
    return { seedHash: hash(0), anchorBlock: Number(w[1]), randomness: hash(2), root: hash(3), total: w[4], claimed: w[5], postedAt: Number(w[6]), vetoed: w[7] !== 0n };
  }

  // OpsTreasury
  async harvest() {
    const before = [this.snap.dcpTreasury, this.snap.imd];
    await this.send(this.keeper, this.addr.treasury, calldata('harvest()', [], []));
    await this.refresh();
    return { dcp: this.snap.dcpTreasury - before[0], imd: this.snap.imd - before[1] };
  }
  async payWork(payee, amount, invoiceId) {
    const id = /^0x[0-9a-f]{64}$/i.test(invoiceId) ? invoiceId : hex(keccak256(invoiceId));
    return this.send(this.payment, this.addr.treasury, calldata('payWork(address,uint256,bytes32)', ['address', 'uint256', 'bytes32'], [payee, amount, id]));
  }
  async invoicePaid(invoiceId) {
    const id = /^0x[0-9a-f]{64}$/i.test(invoiceId) ? invoiceId : hex(keccak256(invoiceId));
    return (await this.word(this.addr.treasury, 'invoicePaid(bytes32)', ['bytes32'], [id])) !== 0n;
  }
}
