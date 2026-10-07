import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, advance, E18 } from './helpers.mjs';
import { createGuest } from '../server/src/auth.js';
import { privToAddress } from '../server/src/crypto/eth.js';
import { all, one, run } from '../server/src/db.js';
import { advanceEpochs, defaultEconomyConfig, recordDepth, liabilities } from '../server/src/economy.js';

function backlog(t) {
  const app = makeApp(); t.after(() => app.db.close());
  const cfg = { ...defaultEconomyConfig(), minAccountAgeMs: 0, minActions: 0, challengeMs: 3600_000 };
  const go = (e) => advanceEpochs(app.db, app.chain, cfg, { currentEpoch: e, dayOf: x => x - 1, now: app.now() });
  const ids = [200n, 201n].map(key => {
    const g = createGuest(app.db);
    run(app.db, 'UPDATE accounts SET wallet = ?, actions = 300 WHERE id = ?', privToAddress(key), g.accountId);
    return g.accountId;
  });
  run(app.db, 'INSERT INTO daily_fame(day, account_id, fame) VALUES(1, ?, 900), (1, ?, 300), (2, ?, 100)', ids[0], ids[1], ids[1]);
  recordDepth(app.db, ids[0], 1, 5);
  return { app, go };
}

for (const lostResponse of [false, true]) test(`epoch backlog preserves ordering after ${lostResponse ? 'lost successful response' : 'transient failure'}`, async t => {
  const { app, go } = backlog(t);
  await go(1); advance(app, 3 * 86400_000);
  const original = app.chain.postRoot.bind(app.chain);
  let failed = false;
  app.chain.postRoot = async (...args) => {
    if (!failed) { failed = true; if (lostResponse) await original(...args); throw new Error('receipt timeout'); }
    return original(...args);
  };
  await go(4);
  assert.equal(one(app.db, 'SELECT status FROM epochs WHERE epoch = 3').status, 'committed');
  await go(4); advance(app, 2 * 3600_000); await go(4);
  assert.deepEqual(all(app.db, 'SELECT status FROM epochs WHERE epoch IN (2,3)').map(r => r.status), ['final', 'final']);
  assert.equal(liabilities(app.db).rooted, '0');
  assert.equal(one(app.db, 'SELECT count(*) n FROM outages').n, 1);
  assert.equal(app.chain.reserveOutstanding().toString(), liabilities(app.db).claimable);
});

test('malformed API input is a client error without internal stack logging', async t => {
  const logs = []; const app = makeApp({ log: x => logs.push(x) });
  const server = await app.listen(0, '127.0.0.1');
  t.after(() => { server.closeAllConnections(); server.close(); app.db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const guest = createGuest(app.db);
  const headers = { authorization: `Bearer ${guest.token}`, 'content-type': 'application/json' };
  for (const [path, value] of [
    ['/api/auth/nonce?address=notanaddress'], ['/api/auth/nonce'],
    ['/api/orders', {sku:99}], ['/api/demo/pay', {}],
    ...['orders','characters','act','auth/recover','demo/advance','demo/pay','auth/verify'].map(p => ['/api/' + p, null]),
  ]) {
    const response = await fetch(base + path, value === undefined ? {} : { method:'POST', headers, body:JSON.stringify(value) });
    assert.equal(response.status, 400, path);
    assert.doesNotMatch((await response.json()).error, /TypeError|Cannot read|internal error/);
  }
  assert.deepEqual(logs, []);
});

test('previously superseded absent root reoffers every prize once under normal caps', async t => {
  const { app, go } = backlog(t);
  await go(1); advance(app, 3 * 86400_000); await go(4);
  // Emulate the old keeper's dead epoch 2 after epoch 3 overtook it.
  const round = app.chain.round(2);
  app.chain.reserve.outstanding -= round.total;
  round.root = null; round.total = 0n; round.postedAt = 0;
  run(app.db, "UPDATE epochs SET status = 'drawn' WHERE epoch = 2");
  await go(4);
  assert.equal(one(app.db, 'SELECT status FROM epochs WHERE epoch = 2').status, 'expired');
  const recovered = all(app.db, "SELECT * FROM rewards WHERE status = 'pending'");
  assert.equal(recovered.reduce((sum, r) => sum + BigInt(r.amount), 0n), 875n * E18);
  assert.ok(recovered.some(r => r.kind === 'top'));
  advance(app, 2 * 86400_000); await go(6);
  advance(app, 2 * 3600_000); await go(6); await go(6);
  for (const r of recovered) {
    const paid = one(app.db, 'SELECT * FROM rewards WHERE id = ?', r.id);
    assert.equal(paid.status, 'claimable'); assert.equal(paid.epoch, 5);
    assert.equal(paid.amount, r.amount);
  }
  assert.equal(liabilities(app.db).rooted, '0');
  assert.equal(app.chain.reserveOutstanding().toString(), liabilities(app.db).claimable);
  assert.equal(one(app.db, 'SELECT count(*) n FROM outages').n, 0);
});
