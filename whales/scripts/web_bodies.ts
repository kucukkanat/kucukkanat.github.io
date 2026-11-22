// Body-only web copies for the procedural ecosystems: strips the baked island / water / falls meshes, the eco_* clips
// and the tree / lake bone tracks from the web GLBs, keeping the body mesh, its textures (KTX2 passthrough), the
// skeleton and the swim clips.
//   bun whales/scripts/web_bodies.ts
// Reads public/assets/whales/<sp>_{A,B,lite}.glb (or whales/out/web-full when present), writes
// public/assets/whales/<sp>_{A,B,lite}.glb in place and refreshes the sizes in manifest.json.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dir, '..', '..', 'public', 'assets', 'whales');
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const f of readdirSync(dir).filter(f => f.endsWith('.glb'))) {
  const path = join(dir, f);
  const doc = await io.read(path);
  const root = doc.getRoot();
  let dropped = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (mesh && !mesh.getName().startsWith('Whale_Body') && !node.getName().startsWith('Whale_Body')) { node.setMesh(null); node.setSkin(null); dropped++; }
  }
  for (const anim of root.listAnimations()) {
    if (anim.getName().startsWith('eco_')) { anim.dispose(); continue; }
    for (const ch of anim.listChannels()) {
      const n = ch.getTargetNode()?.getName() ?? '';
      if (/^(tree_|water_)/.test(n)) { ch.getSampler()?.dispose(); ch.dispose(); }
    }
  }
  const used = new Set(root.listMeshes().flatMap(m => m.listPrimitives().map(pr => pr.getMaterial())));
  for (const mat of root.listMaterials()) if (!used.has(mat)) mat.dispose();
  await doc.transform(prune({ keepLeaves: true, keepExtras: true }));
  await io.write(path, doc);
  console.log(`${f}: dropped ${dropped} meshes -> ${(statSync(path).size / 1024).toFixed(0)} KB`);
}

const mpath = join(dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(mpath, 'utf8')) as { key: string; files: Record<string, string>; sizes: Record<string, number> }[];
for (const e of manifest) for (const k of Object.keys(e.files))
  e.sizes[k] = +(statSync(join(dir, `${e.key}_${k}.glb`)).size / 1048576).toFixed(2);
writeFileSync(mpath, JSON.stringify(manifest, null, 1) + '\n');
