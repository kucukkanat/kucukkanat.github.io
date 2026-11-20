// Meshopt-compress the exported .glb files in place (keeps node names, empties and both UV sets).
// Runs after `bun run blender`. Safe to re-run: already-compressed files are skipped.
import { $ } from 'bun';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dir, '..', 'public', 'assets');
// Only cabin.glb: the app re-poses template and sky nodes, which would drop meshopt's dequantization transform.
for (const f of ['cabin.glb']) {
  const p = join(dir, f);
  if (readFileSync(p).includes('EXT_meshopt_compression')) { console.log(`${f}: already compressed`); continue; }
  const before = statSync(p).size;
  await $`bunx gltf-transform meshopt ${p} ${p} --level medium`.quiet();
  console.log(`${f}: ${(before / 1024).toFixed(0)} KB → ${(statSync(p).size / 1024).toFixed(0)} KB`);
}
