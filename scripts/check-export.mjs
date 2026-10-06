// Verify the exact export bytes and local module graph without network or dependencies.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const manifest=JSON.parse(readFileSync(join(root,'build.json'),'utf8'));
const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[relative(root,p)];});
assert.deepEqual(walk(root).sort(),[...Object.keys(manifest.files),'build.json'].sort());
for(const [name,entry] of Object.entries(manifest.files)){
  const bytes=readFileSync(join(root,name));
  assert.equal(bytes.length,entry.bytes,name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,name);
  if(!/\.(js|html)$/.test(name))continue;
  const text=bytes.toString();
  const refs=name.endsWith('.js')?[...text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map(x=>x[1]):[...text.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map(x=>x[1]);
  for(const ref of refs){
    assert.ok(!/^(?:[a-z]+:|\/)/i.test(ref),`Non-relative reference in ${name}: ${ref}`);
    const target=resolve(root,dirname(name),ref);
    assert.ok(target.startsWith(root),`Path escapes export: ${ref}`);
    assert.ok(statSync(target).isFile(),`Missing asset: ${target}`);
  }
}
console.log(`PASS: ${Object.keys(manifest.files).length} runtime files, hashes and relative imports; no extra packaged files.`);
