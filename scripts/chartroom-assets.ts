// The chart room's web assets (Ugurcan's room), after `Blender --background --factory-startup --python blender/chartroom/build.py`:
//   room       blender/out/chartroom/chartroom_raw.glb -> public/assets/chartroom.glb (2048 px) and chartroom_lite.glb (512 px):
//              baked meshes lose their normals, the sky images the app replaces are dropped, meshopt, KTX2 textures
//   lightmaps  public/assets/chartroom_lightmap_<mode>.webp -> .ktx2 (2048) and _1k.ktx2, mean brightness -> chartroom_lightmaps.json
//   Ugurcan    art/chartroom/ugurcan.glb (Meshy: image to 3D, rig, animation clips; see docs/ART.md) -> ugurcan.glb
//              (2048 px) and ugurcan_lite.glb (1024 px, simplified)
// Safe to re-run.
import { $ } from 'bun';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld } from '@gltf-transform/functions';
import { encodeImage, ktx2GLB } from './ktx2';

const root = join(import.meta.dir, '..');
const assets = join(root, 'public', 'assets');
const tmp = join(root, 'blender', 'out', 'chartroom', 'tmp');
const kb = (p: string) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
mkdirSync(tmp, { recursive: true });

// ---------------------------------------------------------------- room
const raw = join(root, 'blender', 'out', 'chartroom', 'chartroom_raw.glb');
async function slim(src: string, dst: string) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(src);
  const unlit = /^(STATIC_|Sky_backdrop|Skylight_sky|Window_glass|Skylight_glass)/;
  for (const node of doc.getRoot().listNodes()) {
    if (!unlit.test(node.getName())) continue;
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      if (prim.getAttribute('NORMAL')) prim.setAttribute('NORMAL', null);
      if (/^(Sky_backdrop|Skylight_sky)/.test(node.getName())) prim.getMaterial()?.setBaseColorTexture(null).setEmissiveTexture(null);
    }
  }
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }));
  await io.write(dst, doc);
}

if (existsSync(raw)) {
  const slimmed = join(tmp, 'chartroom_slim.glb');
  await slim(raw, slimmed);
  for (const [name, size] of [['chartroom.glb', 2048], ['chartroom_lite.glb', 512]] as const) {
    const a = join(tmp, name), dst = join(assets, name);
    await $`bunx gltf-transform resize ${slimmed} ${a} --width ${size} --height ${size}`.quiet();
    await $`bunx gltf-transform meshopt ${a} ${dst} --level high --quantize-position 14 --quantize-texcoord 13 --quantize-normal 10`.quiet();
    await ktx2GLB(dst);
    console.log(`${name}: ${kb(raw)} -> ${kb(dst)}`);
  }
} else console.log(`no ${raw}: run blender/chartroom/build.py first`);

// ---------------------------------------------------------------- lightmaps
async function meanLit(src: Buffer) {
  const d = await sharp(src).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 3) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    if (l > 0.02) { sum += l; n++; }
  }
  return n ? +(sum / n).toFixed(4) : 0.5;
}
const metaPath = join(assets, 'chartroom_lightmaps.json');
if (existsSync(metaPath)) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  for (const mode of ['sunset', 'night']) {
    const p = join(assets, `chartroom_lightmap_${mode}.webp`);
    if (!existsSync(p)) continue;
    const src = readFileSync(p);
    writeFileSync(join(assets, `chartroom_lightmap_${mode}.ktx2`), await encodeImage(src, 'color'));
    writeFileSync(join(assets, `chartroom_lightmap_${mode}_1k.ktx2`),
      await encodeImage(await sharp(src).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer(), 'color'));
    meta[mode] = { ...meta[mode], mean: await meanLit(src), ktx2: `chartroom_lightmap_${mode}.ktx2`, ktx2_1k: `chartroom_lightmap_${mode}_1k.ktx2` };
    console.log(`chartroom_lightmap_${mode}: ${kb(join(assets, `chartroom_lightmap_${mode}.ktx2`))}`);
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
}

// ---------------------------------------------------------------- Ugurcan
const model = join(root, 'art', 'chartroom', 'ugurcan.glb');
if (existsSync(model)) {
  for (const [name, px, lite] of [['ugurcan.glb', 2048, false], ['ugurcan_lite.glb', 1024, true]] as const) {
    const out = join(assets, name);
    copyFileSync(model, out);
    await $`bunx gltf-transform resize ${out} ${out} --width ${px} --height ${px}`.quiet();
    if (lite) await $`bunx gltf-transform simplify ${out} ${out} --ratio 0.5 --error 0.0008`.quiet();
    await $`bunx gltf-transform meshopt ${out} ${out} --level high`.quiet();
    await ktx2GLB(out);
    console.log(`${name}: ${kb(model)} -> ${kb(out)}`);
  }
} else console.log('no art/chartroom/ugurcan.glb');
rmSync(tmp, { recursive: true, force: true });
