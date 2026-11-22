// After `bun run blender` (and airship/ exports): meshopt-compress cabin.glb (keeps node names, empties and both UV
// sets), then turn the textures of every model into KTX2 (scripts/ktx2.ts) and write the KTX2 lightmaps and sky
// backdrops. Safe to re-run: already-compressed files and KTX2 textures are skipped.
import { $ } from 'bun';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ktx2GLB } from './ktx2';

const dir = join(import.meta.dir, '..', 'public', 'assets');
// Only cabin.glb: the app re-poses template and sky nodes, which would drop meshopt's dequantization transform.
for (const f of ['cabin.glb']) {
  const p = join(dir, f);
  if (readFileSync(p).includes('EXT_meshopt_compression')) { console.log(`${f}: already compressed`); continue; }
  const before = statSync(p).size;
  // level high (filters) + explicit quantisation: about 10% smaller over the wire than level medium, visually identical.
  // 13-bit UVs keep the lightmap atlas (2048 px) accurate to a quarter texel.
  await $`bunx gltf-transform meshopt ${p} ${p} --level high --quantize-position 14 --quantize-texcoord 13 --quantize-normal 10`.quiet();
  console.log(`${f}: ${(before / 1024).toFixed(0)} KB → ${(statSync(p).size / 1024).toFixed(0)} KB`);
}
// KTX2 textures (maps of 512 px and up; smaller ones stay WebP). captain.glb comes from scripts/build-captain.ts.
for (const f of ['cabin.glb', 'galleon.glb', 'galleon_lite.glb', 'sky.glb', 'sky_full.glb', 'collectibles.glb', 'captain.glb']) {
  const p = join(dir, f);
  if (existsSync(p)) await ktx2GLB(p);
}
// lightmaps (2k + 1k for phones) and sky backdrops
await $`bun ${join(import.meta.dir, 'ktx2.ts')}`;
