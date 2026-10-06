// Reproducible offline evidence; results are implementer checks, never an independent audit.
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSimulation } from '../server/src/sim/simulate.js';
import { createApp } from '../server/src/app.js';
import { one, all, setMeta, getMeta } from '../server/src/db.js';
import { stress, scenarios } from './economy-stress.mjs';

mkdirSync('docs/evidence', { recursive: true });
const output = (name, value) => writeFileSync(`docs/evidence/${name}.json`, JSON.stringify(value, null, 2) + '\n');
output('variety-simulation', { steeringOn: runSimulation({ players: 120, days: 4 }), steeringOff: runSimulation({ players: 120, days: 4, steering: false }) });
output('economy-stress', { label: 'Illustrative assumptions, not quotes or forecast', scenarios: Object.fromEntries(Object.entries(scenarios).map(([name, options]) => [name, { assumptions: options, result: stress(options) }])) });
const dir = mkdtempSync(join(tmpdir(), 'dcp-evidence-'));
try {
  const config = { demo: true, dbPath: join(dir, 'demo.sqlite'), confirmations: 3, domain: 'localhost', origin: 'http://localhost' };
  let app = createApp(config);
  await app.keeper.tick();
  app.db.close();
  app = createApp(config); // actual durable restart between unattended cycles
  setMeta(app.db, 'demoClockOffset', 7 * 86400_000);
  app.chain.mine(5);
  await app.keeper.tick(app.now());
  output('unattended-cycles', { label: 'LOCAL TEST FIXTURE; no paid work',
    cycles: all(app.db, 'SELECT id, stage, status, attempts FROM ops_cycles'),
    versions: all(app.db, 'SELECT version, status, packs FROM content_versions'),
    payments: one(app.db, 'SELECT count(*) n FROM payments').n,
    rulesVersion: one(app.db, 'SELECT max(version) v FROM rules').v,
    keeper: getMeta(app.db, 'lastTick') });
  app.db.close();
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log('Variety, stress and two-cycle evidence written to docs/evidence/.');
