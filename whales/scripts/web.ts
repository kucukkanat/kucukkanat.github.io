// Web copies of the whales for the site: Blender export (no Draco) -> resample clips -> meshopt -> KTX2 textures
// (scripts/ktx2.ts: 2k colour ETC1S, normals UASTC; maps under 512 px stay WebP).
//   bun whales/scripts/web.ts [species...]
// Writes public/assets/whales/<sp>_A.glb (world near + viewer), <sp>_B.glb (viewer), <sp>_lite.glb (world far + phones)
// and public/assets/whales/manifest.json.
import { $ } from 'bun';
import { mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ktx2GLB } from '../../scripts/ktx2';

const root = join(import.meta.dir, '..', '..');
const BL = '/Applications/Blender.app/Contents/MacOS/Blender';
const out = join(root, 'public', 'assets', 'whales');
const tmp = join(root, 'whales', 'out', 'web-tmp');
mkdirSync(out, { recursive: true }); mkdirSync(tmp, { recursive: true });
const ALL = ['blue', 'sperm', 'beluga', 'humpback', 'bowhead', 'minke'];
const species = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

for (const sp of species) {
  for (const [style, mode, name] of [['A', 'full', `${sp}_A`], ['A', 'lite', `${sp}_lite`], ['B', 'full', `${sp}_B`]] as const) {
    const raw = join(tmp, `${name}.glb`), rs = join(tmp, `${name}_rs.glb`), dst = join(out, `${name}.glb`);
    await $`${BL} -b ${join(root, 'whales/out/blend', `${sp}_${style}.blend`)} --python ${join(root, 'whales/scripts/export_web.py')} -- ${raw} ${mode}`.quiet();
    await $`bunx gltf-transform resample ${raw} ${rs}`.quiet();
    await $`bunx gltf-transform meshopt ${rs} ${dst} --level high --quantize-position 14 --quantize-texcoord 12 --quantize-normal 10`.quiet();
    await ktx2GLB(dst);
    console.log(`${name}.glb  ${(statSync(dst).size / 1024).toFixed(0)} KB`);
  }
}
rmSync(tmp, { recursive: true, force: true });
await $`python3 ${join(root, 'whales/scripts/make_manifest.py')}`;
