import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
mkdirSync('docs/abi', { recursive: true });
for (const name of ['DCPToken', 'GameReserve', 'GameShop', 'OpsTreasury', 'VRFPrizeSource']) {
  const artifact = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`));
  writeFileSync(`docs/abi/${name}.json`, JSON.stringify(artifact.abi, null, 2) + '\n');
}
console.log('Exported five contract ABIs.');
