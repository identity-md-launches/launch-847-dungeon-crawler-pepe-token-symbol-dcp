// Confirmation-depth indexer. Only logs at or below (head - confirmations) are applied, each
// exactly once (orders/rewards are keyed by id), so retries and restarts are idempotent.
// A reorg is detected by comparing the stored hash of the cursor block with the chain's; the
// indexer halts settlement on a deep reorg for reconciliation. Unconfirmed purchases are
// surfaced as "pending" for the UI but never credited.
import { tx, one, run, all, getMeta, setMeta } from '../db.js';

export class Indexer {
  constructor({ db, chain, confirmations = 12, onPurchase, onClaim, log = () => {} }) {
    Object.assign(this, { db, chain, confirmations, onPurchase, onClaim, log });
  }

  cursor() {
    return one(this.db, "SELECT block_number, block_hash FROM chain_cursor WHERE name = 'main'") ?? { block_number: -1, block_hash: null };
  }

  async poll() {
    if (getMeta(this.db, 'chainHalted')) throw new Error('DeepReorg: indexer halted pending canonical reconciliation');
    const head = await this.chain.getBlockNumber();
    const safe = head - this.confirmations;
    let cur = this.cursor();
    // Reorg check on the last applied block.
    if (cur.block_number >= 0) {
      const b = await this.chain.getBlock(cur.block_number);
      if (!b || b.hash !== cur.block_hash) {
        // Consumed items cannot be safely undone by rewinding a cursor alone.
        // Keep ownership evidence and stop settlement for explicit reconciliation.
        setMeta(this.db, 'chainHalted', { block: cur.block_number, at: Date.now() });
        throw new Error('DeepReorg: settlement halted; preserve purchases and claim proofs');
      }
    }
    if (safe > cur.block_number) {
      const from = cur.block_number + 1;
      const logs = await this.chain.getLogs(from, safe);
      const tip = await this.chain.getBlock(safe);
      tx(this.db, () => {
        for (const l of logs) this.apply(l);
        run(this.db, "INSERT INTO chain_cursor(name, block_number, block_hash) VALUES('main', ?, ?) ON CONFLICT(name) DO UPDATE SET block_number = excluded.block_number, block_hash = excluded.block_hash", safe, tip.hash);
        run(this.db, 'INSERT OR REPLACE INTO seen_blocks(number, hash) VALUES(?, ?)', safe, tip.hash);
      });
    }
    // Pending view (unconfirmed) for UI status only.
    const pendingLogs = head > Math.max(safe, cur.block_number) ? await this.chain.getLogs(Math.max(safe, cur.block_number) + 1, head) : [];
    const pendingOrders = new Set(pendingLogs.filter((l) => l.event === 'Purchase').map((l) => l.args.orderId));
    for (const o of all(this.db, "SELECT order_id FROM orders WHERE status IN ('created','pending')")) {
      const st = pendingOrders.has(o.order_id) ? 'pending' : 'created';
      run(this.db, 'UPDATE orders SET status = ?, updated_at = ? WHERE order_id = ? AND status IN (\'created\',\'pending\')', st, Date.now(), o.order_id);
    }
    return { head, safe };
  }

  async findCommonAncestor(n) {
    for (let k = n; k >= 0; k--) {
      const seen = one(this.db, 'SELECT hash FROM seen_blocks WHERE number = ?', k);
      if (!seen) continue;
      const b = await this.chain.getBlock(k);
      if (b && b.hash === seen.hash) return { number: k, hash: seen.hash };
    }
    return { number: -1, hash: null };
  }

  apply(l) {
    if (l.event === 'Purchase') this.onPurchase?.(l);
    if (l.event === 'Claimed') this.onClaim?.(l);
  }
}
