// Web copy of the captain: art/models/captain.glb → public/assets/captain.glb.
// Half the triangles, colour map 1024 px, normal map 512 px, roughness/metal map 256 px (the painted look barely
// shows them), WebP, meshopt. Run after replacing the source model: bun scripts/build-captain.ts
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { join } from 'node:path';
import { statSync } from 'node:fs';

const root = join(import.meta.dir, '..');
const src = join(root, 'art/models/captain.glb'), dst = join(root, 'public/assets/captain.glb');
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const mat = doc.getRoot().listMaterials()[0];
const sizes = new Map([[mat.getBaseColorTexture(), 1024], [mat.getNormalTexture(), 512], [mat.getMetallicRoughnessTexture(), 256]]);
for (const [tex, px] of sizes) {
  if (!tex) continue;
  const img = await sharp(Buffer.from(tex.getImage()!)).resize(px, px, { kernel: 'lanczos3' }).webp({ quality: px > 512 ? 82 : 75 }).toBuffer();
  tex.setImage(new Uint8Array(img)).setMimeType('image/webp');
}
await doc.transform(
  dedup(), weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.01 }),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(dst, doc);
console.log(`captain.glb: ${(statSync(dst).size / 1024).toFixed(0)} KB`);
