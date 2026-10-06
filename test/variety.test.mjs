// 100+ players over several days: measures repetition, duplicate upgrades, build diversity
// and dominant strategies, and checks the anti-convergence steering actually helps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { runSimulation } from '../server/src/sim/simulate.js';

test('120 players × 4 days: no convergence', () => {
  const r = runSimulation({ players: 120, days: 4 });
  const off = runSimulation({ players: 120, days: 4, steering: false });
  if (process.env.DCP_WRITE_EVIDENCE) {
    mkdirSync('docs/evidence', { recursive: true });
    writeFileSync('docs/evidence/variety-simulation.json', JSON.stringify({ steeringOn: r, steeringOff: off }, null, 2) + '\n');
  }
  assert.ok(r.actions > 100_000, 'substantial play volume');
  assert.ok(r.errors / r.actions < 0.01, `illegal action rate ${r.errors}/${r.actions}`);
  assert.ok(r.meanPairwiseJaccard < 0.05, `players share few upgrades (jaccard ${r.meanPairwiseJaccard})`);
  assert.ok(r.offerRepeatRate < 0.03, `offers rarely repeat for a player (${r.offerRepeatRate})`);
  assert.ok(r.distinctPowerSignatures > 3000, `breadth ${r.distinctPowerSignatures}`);
  assert.ok(r.dominantTagEntropyBits >= 3.2, `build diversity ${r.dominantTagEntropyBits} bits`);
  assert.ok(r.maxEffectPickShare < 0.08, `no effect dominates (${r.maxEffectPickShare})`);
  assert.ok(r.layoutDuplicateRate < 0.1, `floor layouts unique (${r.layoutDuplicateRate})`);
  assert.ok(r.topBracketMaxArchetypeShare <= 0.5, `no single dominant strategy (${r.topBracketMaxArchetypeShare})`);
  assert.ok(r.distinctSynergyCombos >= 60, `synergy combos ${r.distinctSynergyCombos}`);
  assert.ok(r.dominantTagEntropyBits > off.dominantTagEntropyBits, 'popularity steering increases build diversity');
});
