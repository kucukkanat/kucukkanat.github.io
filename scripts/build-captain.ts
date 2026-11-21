// Web copy of the captain: art/models/captain.glb → public/assets/captain.glb.
// Full mesh (simplifying it spoiled the face and hands), every map 1024 px WebP q80, meshopt. Run after replacing the source model: bun scripts/build-captain.ts
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { join } from 'node:path';
import { statSync } from 'node:fs';

const root = join(import.meta.dir, '..');
const src = join(root, 'art/models/captain.glb'), dst = join(root, 'public/assets/captain.glb');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const mat = doc.getRoot().listMaterials()[0];
const sizes = new Map([[mat.getBaseColorTexture(), 1024], [mat.getNormalTexture(), 1024], [mat.getMetallicRoughnessTexture(), 1024]]);
for (const [tex, px] of sizes) {
  if (!tex) continue;
  const img = await sharp(Buffer.from(tex.getImage()!)).resize(px, px, { kernel: 'lanczos3' }).webp({ quality: 80 }).toBuffer();
  tex.setImage(new Uint8Array(img)).setMimeType('image/webp');
}
await doc.transform(
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(dst, doc);
console.log(`captain.glb: ${(statSync(dst).size / 1024).toFixed(0)} KB`);
