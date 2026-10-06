import { readFileSync } from 'node:fs';
const gate = JSON.parse(readFileSync(new URL('../deploy/launch-gates.json', import.meta.url)));
console.log('BUILD-AND-REVIEW: production is disabled.');
for (const item of gate.blockingIntegrations) console.log(`OPEN: ${item}`);
// This order intentionally cannot be converted into a launch by editing a JSON boolean.
process.exitCode = 2;
