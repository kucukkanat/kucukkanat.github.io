// The library deck's web assets, after `Blender --background --factory-startup --python blender/library/build.py`:
//   room       blender/out/library/library_raw.glb -> public/assets/library.glb (2048 px) and library_lite.glb (512 px):
//              the baked meshes lose their normals (unlit, never read) and are welded, the porthole sky image the app
//              replaces is dropped, textures resized, meshopt geometry (the moved nodes are empties), KTX2 textures
//   lightmaps  public/assets/library_lightmap_<mode>.webp -> .ktx2 (2048) and _1k.ktx2; the mean brightness goes
//              to library_lightmaps.json, as for the cabin (a compressed texture can't be read back)
//   Librarian  art/library/librarian.glb, librarian_lite.glb, librarian.events.json (built in the Librarian
//              prototype repo: Meshy model, rig, clips) -> public/assets with KTX2 textures; phones: 1K, simplified
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
const tmp = join(root, 'blender', 'out', 'library', 'tmp');
const kb = (p: string) => `${(statSync(p).size / 1024).toFixed(0)} KB`;
mkdirSync(tmp, { recursive: true });

// ---------------------------------------------------------------- room
const raw = join(root, 'blender', 'out', 'library', 'library_raw.glb');
/** Lossless for how the app draws it: baked (unlit) meshes need no normals, and without them most vertices weld. */
async function slim(src: string, dst: string) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(src);
  const unlit = /^(STATIC_|VC_|Sky_backdrop|Window_glass)/;
  for (const node of doc.getRoot().listNodes()) {
    if (!unlit.test(node.getName())) continue;
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      const n = prim.getAttribute('NORMAL');
      if (n) prim.setAttribute('NORMAL', null);
      // the porthole sky is drawn from the cabin's sky textures (library/room.ts)
      if (node.getName().startsWith('Sky_backdrop')) prim.getMaterial()?.setBaseColorTexture(null).setEmissiveTexture(null);
    }
  }
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }));
  await io.write(dst, doc);
}

if (existsSync(raw)) {
  const slimmed = join(tmp, 'library_slim.glb');
  await slim(raw, slimmed);
  for (const [name, size] of [['library.glb', 2048], ['library_lite.glb', 512]] as const) {
    const a = join(tmp, name), dst = join(assets, name);
    await $`bunx gltf-transform resize ${slimmed} ${a} --width ${size} --height ${size}`.quiet();
    await $`bunx gltf-transform meshopt ${a} ${dst} --level high --quantize-position 14 --quantize-texcoord 13 --quantize-normal 10`.quiet();
    await ktx2GLB(dst);
    console.log(`${name}: ${kb(raw)} -> ${kb(dst)}`);
  }
} else console.log(`no ${raw}: run blender/library/build.py first`);

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
const metaPath = join(assets, 'library_lightmaps.json');
if (existsSync(metaPath)) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  for (const mode of ['sunset', 'night']) {
    const p = join(assets, `library_lightmap_${mode}.webp`);
    if (!existsSync(p)) continue;
    const src = readFileSync(p);
    writeFileSync(join(assets, `library_lightmap_${mode}.ktx2`), await encodeImage(src, 'color'));
    writeFileSync(join(assets, `library_lightmap_${mode}_1k.ktx2`),
      await encodeImage(await sharp(src).resize(1024, 1024, { kernel: 'lanczos3' }).png().toBuffer(), 'color'));
    meta[mode] = { ...meta[mode], mean: await meanLit(src), ktx2: `library_lightmap_${mode}.ktx2`, ktx2_1k: `library_lightmap_${mode}_1k.ktx2` };
    console.log(`library_lightmap_${mode}: ${kb(join(assets, `library_lightmap_${mode}.ktx2`))}`);
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 1));
}

// ---------------------------------------------------------------- the Librarian
const src = join(root, 'art', 'library');
for (const f of ['librarian.glb', 'librarian_lite.glb', 'librarian.events.json']) {
  const p = join(src, f);
  if (!existsSync(p)) { console.log(`no art/library/${f}`); continue; }
  copyFileSync(p, join(assets, f));
  if (f.endsWith('.glb')) {
    // the KTX2 encoder takes at most ~12.6 Mpx per image: 3072 px on desktop; phones get 1024 px and a lighter mesh
    // (simplified within a tight error, so the face, hands and silhouette keep their shape)
    const lite = f.includes('_lite'), px = lite ? 1024 : 3072, out = join(assets, f);
    await $`bunx gltf-transform resize ${out} ${out} --width ${px} --height ${px}`.quiet();
    if (lite) {
      await $`bunx gltf-transform simplify ${out} ${out} --ratio 0.5 --error 0.0008`.quiet();
      await $`bunx gltf-transform meshopt ${out} ${out} --level high`.quiet();
    }
    await ktx2GLB(join(assets, f));
    console.log(`${f}: ${kb(p)} -> ${kb(join(assets, f))}`);
  }
}
rmSync(tmp, { recursive: true, force: true });
