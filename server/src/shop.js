// In-game DCP purchases. Nothing sold here affects leaderboard power: cosmetics, vanity, an
// extra character slot, and a Revive that marks the run ineligible for leaderboard prizes.
import { createHash, randomBytes } from 'node:crypto';
import { one, run, tx } from './db.js';

const E18 = 10n ** 18n;
export const SKUS = [
  { sku: 1, id: 'hat_crown', name: 'Crown of Mild Disappointment (cosmetic)', price: 500n * E18, kind: 'cosmetic' },
  { sku: 2, id: 'plate_vexmire', name: 'Vexmire Sponsor Vanity Plate (cosmetic)', price: 750n * E18, kind: 'cosmetic' },
  { sku: 3, id: 'slot', name: 'Extra Character Slot', price: 1000n * E18, kind: 'slot' },
  { sku: 4, id: 'revive', name: 'Big Mother Revive (marks run leaderboard-ineligible)', price: 1500n * E18, kind: 'revive' },
  { sku: 5, id: 'emote_moon', name: 'Emote: Aggravated Mooning (cosmetic)', price: 300n * E18, kind: 'cosmetic' },
];
export const skuBy = (sku) => SKUS.find((s) => s.sku === Number(sku));

export function createOrder(db, accountId, sku) {
  const s = skuBy(sku);
  if (!s) throw new Error('unknown sku');
  const orderId = '0x' + createHash('sha256').update(`${accountId}|${sku}|${randomBytes(16).toString('hex')}`).digest('hex');
  run(db, 'INSERT INTO orders(order_id, account_id, sku, price, status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)', orderId, accountId, s.sku, s.price.toString(), 'created', Date.now(), Date.now());
  return { orderId, sku: s.sku, price: s.price.toString(), name: s.name };
}

/** Called by the indexer for confirmed Purchase logs. Idempotent per order id. */
export function creditPurchase(db, log) {
  const { orderId, sku, amount, buyer } = log.args;
  const o = one(db, 'SELECT * FROM orders WHERE order_id = ?', orderId);
  if (!o) {
    // Paid an order we never issued (or a forged id). Funds already split on-chain; record it.
    run(db, 'INSERT OR IGNORE INTO orders(order_id, account_id, sku, price, status, tx_hash, block_number, block_hash, paid, buyer, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      orderId, '', Number(sku), '0', 'orphaned', log.txHash, log.blockNumber, log.blockHash, BigInt(amount).toString(), buyer, Date.now(), Date.now());
    return 'orphaned';
  }
  if (o.status === 'credited' || o.status === 'underpaid') return o.status;
  const acct = one(db, 'SELECT wallet FROM accounts WHERE id = ?', o.account_id);
  const paid = BigInt(amount);
  const wrongBuyer = acct?.wallet && buyer && acct.wallet.toLowerCase() !== String(buyer).toLowerCase();
  const status = paid < BigInt(o.price) || Number(sku) !== o.sku ? 'underpaid' : 'credited';
  run(db, 'UPDATE orders SET status = ?, tx_hash = ?, block_number = ?, block_hash = ?, paid = ?, buyer = ?, updated_at = ? WHERE order_id = ?',
    status, log.txHash, log.blockNumber, log.blockHash, paid.toString(), buyer, Date.now(), orderId);
  if (status === 'credited') {
    // Gifts are allowed (someone else may pay your order); the item goes to the order's account.
    run(db, 'INSERT OR IGNORE INTO cosmetics(account_id, sku, order_id, created_at) VALUES(?, ?, ?, ?)', o.account_id, o.sku, orderId, Date.now());
    run(db, "INSERT INTO ledger(ts, kind, asset, amount, note) VALUES(?, 'shop_revenue', 'DCP', ?, ?)", Date.now(), paid.toString(), `order ${orderId}${wrongBuyer ? ' (gift)' : ''}`);
  }
  return status;
}

export function ownedSkus(db, accountId) {
  return db.prepare('SELECT sku, order_id FROM cosmetics WHERE account_id = ?').all(accountId);
}

export function consumeRevive(db, accountId) {
  return tx(db, () => {
    const r = one(db, "SELECT order_id FROM cosmetics WHERE account_id = ? AND sku = 4 AND order_id NOT LIKE 'used:%' LIMIT 1", accountId);
    if (!r) return false;
    run(db, 'UPDATE cosmetics SET order_id = ? WHERE order_id = ?', 'used:' + r.order_id, r.order_id);
    return true;
  });
}
