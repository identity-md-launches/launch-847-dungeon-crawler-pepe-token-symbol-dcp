// Dependency-free static export. Only the public allowlist can enter the browser artifact.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = resolve(root, 'dist');
mkdirSync(target, { recursive: true });
const files = ['index.html', 'app.js', 'wallet.js', 'style.css', 'favicon.svg', 'manifest.webmanifest', 'dungeon.svg', 'practice.js'];
const manifest = { mode: 'build-and-review', api: '/api', practice: 'opt-in; device-only saves; no assets or authority', files: {} };
for (const file of files) {
  let data = readFileSync(join(root, 'web', file));
  if (file === 'practice.js') data = Buffer.from(data.toString().replaceAll('../server/src/', './runtime/'));
  writeFileSync(join(target, file), data);
  manifest.files[file] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
for (const file of ['game/engine.js', 'game/floor.js', 'game/powers.js', 'game/content.js', 'game/rng.js', 'content/base.js']) {
  const source = file === 'game/rng.js' ? join(root, 'web/practice-rng.js') : join(root, 'server/src', file);
  const data = readFileSync(source);
  const name = 'runtime/' + file;
  mkdirSync(join(target, name, '..'), { recursive: true });
  writeFileSync(join(target, name), data);
  manifest.files[name] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
writeFileSync(join(target, 'build.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Static export: ${Object.keys(manifest.files).length} public files in dist/ (browser practice available; integrated mode uses /api).`);
