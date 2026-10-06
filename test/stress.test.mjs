import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stress, scenarios } from '../scripts/economy-stress.mjs';
test('stress scenarios conserve funds, protect claims and stop unfunded operation', () => {
  for (const cfg of Object.values(scenarios)) {
    const r = stress(cfg);
    assert.ok(r.conservation);
    assert.ok(r.treasuryMilliImd >= 0);
    assert.ok(r.reserveDcp >= r.immutablePlayerClaimsDcp);
  }
  assert.equal(stress(scenarios.unfundedBootstrap).dormantAtDay, 0);
  assert.equal(stress(scenarios.depletedReserve).prizesDcp, 0);
  assert.ok(stress(scenarios.shallowLiquidity).failedConversions > 0);
  assert.ok(stress(scenarios.risingCosts4x).dormantAtDay < stress().dormantAtDay);
});
