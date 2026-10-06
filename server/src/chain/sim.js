// SimChain: an in-process, LABELLED TEST FIXTURE chain used by the offline demo and tests.
// It models blocks/reorgs and the observable behaviour of DCPToken, GameReserve, OpsTreasury,
// GameShop and the IMD factory closely enough to exercise the backend (indexer confirmations,
// reorg handling, epoch posting caps, claims, payment caps, fee harvests). The real contract
// semantics are proven by the Foundry tests in contracts/test; this is not a substitute.
import { createHash, randomBytes } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { getMeta, setMeta } from '../db.js';
import { keccak256, hex, unhex, leafHash, verifyProof } from '../crypto/eth.js';

const E18 = 10n ** 18n;
const h32 = (...p) => '0x' + createHash('sha256').update(p.join('|')).digest('hex');

export class SimChain {
  constructor({ db = null, reserveDcp = 700_000_000n * E18, epochBps = 10n, epochAbsCap = 2_000_000n * E18, challengeSecs = 86400, now = () => Date.now() } = {}) {
    this.now = now;
    this.kind = 'sim';
    this.chainId = 31337;
    this.blocks = [{ number: 0, hash: h32('genesis'), parent: '0x0', time: Math.floor(now() / 1000), logs: [] }];
    this.pendingLogs = [];
    this.bal = { DCP: new Map(), IMD: new Map(), ETH: new Map() };
    this.addr = { reserve: '0xreserve', treasury: '0xtreasury', shop: '0xshop', factory: '0xfactory', dead: '0x000000000000000000000000000000000000dEaD' };
    this.credit('DCP', this.addr.reserve, reserveDcp);
    this.reserve = { outstanding: 0n, rounds: new Map(), lastPosted: 0, epochBps, epochAbsCap, challengeSecs, poster: 'keeper', claimed: new Set() };
    this.treasury = { frozen: false, invoices: new Set(), paidInEpoch: new Map(), payPerEpoch: 1000n * E18, payPerPayment: 250n * E18, essentialFloor: 500n * E18, lowRunway: 3000n * E18, payees: new Set(['imd-paid-work']) };
    this.factory = { accruedDcp: 0n, accruedImd: 0n, poolDcp: 200_000_000n * E18, poolImd: 0n, virtualImd: 2_000_000n * E18 };
    this.shopOrders = new Set();
    this.failNext = 0; // inject RPC failures
    this.db = db;
    const saved = db && getMeta(db, 'simChain');
    if (saved) Object.assign(this, deserialize(Buffer.from(saved, 'base64')));
  }

  persist() {
    if (!this.db) return;
    const state = Object.fromEntries(['blocks', 'pendingLogs', 'bal', 'addr', 'reserve', 'treasury', 'factory', 'shopOrders']
      .map((key) => [key, this[key]]));
    setMeta(this.db, 'simChain', serialize(state).toString('base64'));
  }

  // ------------------------------------------------------------ balances
  balanceOf(asset, who) { return this.bal[asset].get(who) ?? 0n; }
  credit(asset, who, n) { this.bal[asset].set(who, this.balanceOf(asset, who) + n); this.persist(); }
  debit(asset, who, n) {
    const b = this.balanceOf(asset, who);
    if (b < n) throw new Error(`insufficient ${asset}`);
    this.bal[asset].set(who, b - n);
  }

  // ------------------------------------------------------------ blocks / RPC-like reads
  maybeFail() { if (this.failNext > 0) { this.failNext--; throw new Error('simulated RPC outage'); } }
  async getBlockNumber() { this.maybeFail(); return this.blocks.at(-1).number; }
  async getBlock(n) { this.maybeFail(); const b = this.blocks[n]; return b ? { number: b.number, hash: b.hash, parent: b.parent, time: b.time } : null; }
  async getLogs(from, to) {
    this.maybeFail();
    return this.blocks.slice(from, to + 1).flatMap((b) => b.logs.map((l, i) => ({ ...l, blockNumber: b.number, blockHash: b.hash, logIndex: i })));
  }
  mine(count = 1) {
    for (let i = 0; i < count; i++) {
      const parent = this.blocks.at(-1);
      const number = parent.number + 1;
      const b = { number, parent: parent.hash, hash: h32('block', number, parent.hash, randomBytes(8).toString('hex')), time: Math.floor(this.now() / 1000), logs: this.pendingLogs.splice(0) };
      this.blocks.push(b);
    }
    this.persist();
    return this.blocks.at(-1).number;
  }
  /** Replace the last `depth` blocks; their logs are dropped (txs "never happened"). */
  reorg(depth, { keepLogs = false } = {}) {
    const dropped = this.blocks.splice(this.blocks.length - depth, depth);
    if (keepLogs) this.pendingLogs.push(...dropped.flatMap((b) => b.logs));
    this.mine(depth);
    return dropped.flatMap((b) => b.logs);
  }
  emit(event, args) {
    this.pendingLogs.push({ event, args, txHash: h32('tx', event, JSON.stringify(args, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), randomBytes(4).toString('hex')) });
  }

  // ------------------------------------------------------------ IMD factory model (fees)
  /** A market trade (test traffic). 1.25% fee: 1.00% to requester, 0.25% to IMD. */
  trade(buyDcp, amountIn) {
    const req = amountIn / 100n;
    if (buyDcp) this.factory.accruedImd += req; else this.factory.accruedDcp += req;
    this.persist();
  }
  async harvest() {
    const d = this.factory.accruedDcp, i = this.factory.accruedImd;
    this.factory.accruedDcp = 0n; this.factory.accruedImd = 0n;
    this.credit('DCP', this.addr.treasury, d);
    this.credit('IMD', this.addr.treasury, i);
    this.emit('Harvested', { dcp: d, imd: i });
    this.mine();
    return { dcp: d, imd: i };
  }
  liquidity() {
    const y = this.factory.poolImd + this.factory.virtualImd;
    return { poolDcp: this.factory.poolDcp, poolImd: this.factory.poolImd, virtualImd: this.factory.virtualImd, priceImdPerDcp: Number(y) / Number(this.factory.poolDcp) };
  }

  // ------------------------------------------------------------ GameShop
  async purchase(buyer, orderId, sku, amount) {
    const orderKey = `${buyer.toLowerCase()}:${orderId}`;
    if (this.shopOrders.has(orderKey)) throw new Error('DuplicateOrder');
    this.debit('DCP', buyer, amount);
    this.shopOrders.add(orderKey);
    const burn = (amount * 3000n) / 10000n, toReserve = (amount * 5000n) / 10000n;
    this.credit('DCP', this.addr.dead, burn);
    this.credit('DCP', this.addr.reserve, toReserve);
    this.credit('DCP', this.addr.treasury, amount - burn - toReserve);
    this.emit('Purchase', { buyer, orderId, sku, amount });
    this.persist();
  }

  /** Real chains refresh a cached snapshot here; the simulation is always current. */
  async refresh() {}
  reserveOutstanding() { return this.reserve.outstanding; }

  // ------------------------------------------------------------ GameReserve model
  freeBalance() { const b = this.balanceOf('DCP', this.addr.reserve); return b > this.reserve.outstanding ? b - this.reserve.outstanding : 0n; }
  epochCap() { const c = (this.freeBalance() * this.reserve.epochBps) / 10000n; return c < this.reserve.epochAbsCap ? c : this.reserve.epochAbsCap; }
  round(e) { if (!this.reserve.rounds.has(e)) this.reserve.rounds.set(e, { claimed: 0n }); return this.reserve.rounds.get(e); }
  async roundState(e) { return { ...this.round(e) }; }
  async commitSeed(e, seedHash, currentEpoch) {
    this.maybeFail();
    if (e <= currentEpoch) throw new Error('BadEpoch');
    const r = this.round(e);
    if (r.seedHash) throw new Error('AlreadySet');
    r.seedHash = seedHash;
    this.emit('SeedCommitted', { epoch: e, seedHash });
    this.mine();
  }
  async anchor(e) {
    this.maybeFail();
    const r = this.round(e);
    if (!r.seedHash) throw new Error('NotReady');
    if (r.anchorBlock) throw new Error('AlreadySet');
    r.anchorBlock = this.mine();
    this.mine();
    return r.anchorBlock;
  }
  async revealSeed(e, seed) {
    this.maybeFail();
    const r = this.round(e);
    if (!r.anchorBlock) throw new Error('NotReady');
    if (r.randomness) throw new Error('AlreadySet');
    if (hex(keccak256(unhex(seed))) !== r.seedHash) throw new Error('BadSeed');
    const bh = this.blocks[r.anchorBlock + 1]?.hash;
    if (!bh) throw new Error('NotReady');
    r.randomness = hex(keccak256(new Uint8Array([...unhex(seed), ...unhex(bh)])));
    this.emit('SeedRevealed', { epoch: e, seed, randomness: r.randomness });
    this.mine();
    return r.randomness;
  }
  async postRoot(e, root, total) {
    this.maybeFail();
    const r = this.round(e);
    if (!r.randomness) throw new Error('NotReady');
    if (e <= this.reserve.lastPosted) throw new Error('BadEpoch');
    if (total > this.epochCap()) throw new Error('OverCap');
    Object.assign(r, { root, total, postedAt: Math.floor(this.now() / 1000) });
    this.reserve.outstanding += total;
    this.reserve.lastPosted = e;
    this.emit('RootPosted', { epoch: e, root, total });
    this.mine();
  }
  async claim(e, index, account, amount, proof) {
    const r = this.round(e);
    if (!r.root) throw new Error('NotReady');
    if (Math.floor(this.now() / 1000) < r.postedAt + this.reserve.challengeSecs) throw new Error('InWindow');
    const key = `${e}:${index}`;
    if (this.reserve.claimed.has(key)) throw new Error('AlreadyClaimed');
    if (!verifyProof(proof, r.root, leafHash(index, account, amount))) throw new Error('BadProof');
    if (r.claimed + amount > r.total) throw new Error('OverCap');
    this.reserve.claimed.add(key);
    r.claimed += amount;
    this.reserve.outstanding -= amount;
    this.debit('DCP', this.addr.reserve, amount);
    this.credit('DCP', account, amount);
    this.emit('Claimed', { epoch: e, index, account, amount });
    this.mine();
  }
  isClaimed(e, index) { return this.reserve.claimed.has(`${e}:${index}`); }

  // ------------------------------------------------------------ OpsTreasury model
  imdBalance() { return this.balanceOf('IMD', this.addr.treasury); }
  async payWork(payee, amount, invoiceId) {
    this.maybeFail();
    const t = this.treasury;
    if (t.frozen) throw new Error('IsFrozen');
    if (!t.payees.has(payee)) throw new Error('NotPayee');
    if (t.invoices.has(invoiceId)) throw new Error('DuplicateInvoice');
    if (amount > t.payPerPayment) throw new Error('OverCap');
    const bal = this.imdBalance();
    if (bal < t.essentialFloor + amount) throw new Error('BelowFloor');
    const cap = bal < t.lowRunway ? t.payPerEpoch / 2n : t.payPerEpoch;
    const ep = Math.floor(this.now() / 86400000);
    const spent = t.paidInEpoch.get(ep) ?? 0n;
    if (spent + amount > cap) throw new Error('OverCap');
    t.invoices.add(invoiceId);
    t.paidInEpoch.set(ep, spent + amount);
    this.debit('IMD', this.addr.treasury, amount);
    this.credit('IMD', payee, amount);
    this.emit('WorkPaid', { invoiceId, payee, amount });
    this.mine();
    return { txHash: h32('pay', invoiceId) };
  }
  invoicePaid(invoiceId) { return this.treasury.invoices.has(invoiceId); }
}

export { E18 };
