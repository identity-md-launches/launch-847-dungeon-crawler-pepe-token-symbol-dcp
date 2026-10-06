// Dependency-free static export. Only the public allowlist can enter the browser artifact.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(root, 'dist');
mkdirSync(target, { recursive: true });
const files = ['index.html', 'app.js', 'wallet.js', 'style.css', 'favicon.svg', 'manifest.webmanifest'];
const manifest = { mode: 'local-simulation', api: '/api', files: {} };
for (const file of files) {
  const data = readFileSync(join(root, 'web', file));
  writeFileSync(join(target, file), data);
  manifest.files[file] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
writeFileSync(join(target, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Static export: ${files.length} public files in dist/ (requires the local /api backend).`);
