// The captain on his throne behind the chart table. cabin.glb carries only the empty `Captain` (floor centre of the
// throne, facing, scale); the model (/assets/captain.glb, ~0.5 MB) is fetched alongside the cabin and added after the first frame and is lit by the
// app's lights like the other non-baked props. Its baked shadow is already in the lightmaps.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadGLB, type Cabin } from './scene';

/** Put the captain on his anchor. `pending` is the download main.ts started alongside the cabin. */
export async function loadCaptain(cabin: Cabin, pending?: Promise<GLTF | null>): Promise<THREE.Object3D | null> {
  const anchor = cabin.get('Captain');
  if (!anchor) return null;
  const gltf = await (pending ?? loadGLB('/assets/captain.glb'));
  if (!gltf) return null;
  const model = gltf.scene;
  model.name = 'Captain_model';
  // sit the lowest point on the anchor (the bake does the same)
  const box = new THREE.Box3().setFromObject(model);
  model.position.y -= box.min.y;
  model.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.raycast = () => { /* the captain never steals a click from the table or the wheel */ };
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
      mat.envMapIntensity = 0.6;
    }
  });
  anchor.add(model);
  return model;
}
