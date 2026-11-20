import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export type ViewName = 'overview' | 'chest' | 'table' | 'rack' | 'shelf' | 'handheld' | 'screen' | 'portrait' | 'letter' | 'clock';
export const VIEWS: ViewName[] = ['overview', 'chest', 'table', 'rack', 'shelf', 'handheld', 'screen', 'portrait', 'letter', 'clock'];
/** Polish-round viewpoints: optional in the GLB (props.ts derives them from the props when missing). */
const OPTIONAL_VIEWS = new Set<ViewName>(['portrait', 'letter', 'clock']);
/** Polish-round hit volumes: optional, never get a pulsing hotspot. */
export const EGG_HITS = ['letter', 'portrait', 'bottle', 'tengwar', 'slate', 'bell'] as const;
export type EggId = typeof EGG_HITS[number];

export interface Viewpoint { pos: THREE.Vector3; target: THREE.Vector3; }

export interface Cabin {
  root: THREE.Object3D;
  get(name: string): THREE.Object3D | undefined;
  /** All nodes whose name starts with prefix. */
  all(prefix: string): THREE.Object3D[];
  views: Record<ViewName, Viewpoint>;
  hits: Map<string, THREE.Object3D>;
  /** Hit volumes of the polish-round props (letter, portrait, bottle, …); only those present in the GLB. */
  eggHits: Map<string, THREE.Object3D>;
  /** Which optional viewpoints came from the GLB. */
  authored: Set<ViewName>;
}

export function makeManager(onProgress: (p: number) => void) {
  const m = new THREE.LoadingManager();
  m.onProgress = (_url, loaded, total) => onProgress(total ? loaded / total : 0);
  return m;
}

export async function loadGLB(url: string, manager?: THREE.LoadingManager): Promise<GLTF | null> {
  const loader = new GLTFLoader(manager);
  loader.setMeshoptDecoder(MeshoptDecoder);
  try {
    return await loader.loadAsync(url);
  } catch (e) {
    console.warn(`[scene] ${url} not available`, e);
    return null;
  }
}

export async function loadTexture(url: string, srgb = true): Promise<THREE.Texture | null> {
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  } catch {
    return null;
  }
}

const FALLBACK_VIEWS: Record<ViewName, [number[], number[]]> = {
  overview: [[0, 1.65, 2.3], [0, 1.15, -1.5]],
  chest: [[-1.6, 1.3, 0.6], [-2.5, 0.75, 0]],
  table: [[0, 1.9, 0.75], [0, 0.85, -0.25]],
  rack: [[1.6, 1.55, 0.2], [2.9, 1.5, 0]],
  shelf: [[-1.5, 1.6, 0.2], [-2.9, 1.6, 0]],
  handheld: [[0, 1.25, 0.6], [0, 0.88, 0.1]],
  screen: [[0, 1.02, 0.3], [0, 0.9, 0.1]],
  portrait: [[1.5, 2.0, -0.5], [2.45, 2.3, -1.6]],
  letter: [[0.3, 1.35, 0.6], [0.28, 0.86, 0.15]],
  clock: [[2.1, 2.1, 0.6], [2.9, 2.2, 0.6]],
};

export function indexCabin(root: THREE.Object3D): Cabin {
  root.updateMatrixWorld(true);
  const byName = new Map<string, THREE.Object3D>();
  root.traverse(o => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const get = (n: string) => byName.get(n);
  const all = (prefix: string) => [...byName.entries()].filter(([n]) => n.startsWith(prefix)).map(([, o]) => o);

  const views = {} as Record<ViewName, Viewpoint>;
  const authored = new Set<ViewName>();
  for (const v of VIEWS) {
    const p = get(`VP_${v}`), t = get(`VP_${v}_T`);
    const pos = p ? p.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(...FALLBACK_VIEWS[v][0]);
    const target = t ? t.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(...FALLBACK_VIEWS[v][1]);
    if (p && t) authored.add(v);
    else if (!OPTIONAL_VIEWS.has(v)) console.warn(`[scene] missing VP_${v}`);
    views[v] = { pos, target };
  }

  const register = (h: string, o: THREE.Object3D) => {
    o.traverse(m => {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh) {
        // Invisible but raycastable.
        mesh.material = new THREE.MeshBasicMaterial({ visible: false });
        mesh.userData.hit = h;
      }
    });
    o.userData.hit = h;
  };
  const hits = new Map<string, THREE.Object3D>();
  for (const h of ['chest', 'table', 'rack', 'shelf', 'handheld', 'lantern', 'wheel']) {
    const o = get(`HIT_${h}`);
    if (!o) { console.warn(`[scene] missing HIT_${h}`); continue; }
    register(h, o);
    hits.set(h, o);
  }
  const eggHits = new Map<string, THREE.Object3D>();
  for (const h of EGG_HITS) {
    const o = get(`HIT_${h}`);
    if (!o) continue;
    register(h, o);
    eggHits.set(h, o);
  }
  return { root, get, all, views, hits, eggHits, authored };
}

/** World transform of an anchor without its scale (empties often carry display scale). */
export function anchorFrame(o: THREE.Object3D | undefined, fallbackPos: THREE.Vector3, fallbackQuat = new THREE.Quaternion()): THREE.Object3D {
  const holder = new THREE.Object3D();
  if (o) {
    o.updateWorldMatrix(true, false);
    const s = new THREE.Vector3();
    o.matrixWorld.decompose(holder.position, holder.quaternion, s);
  } else {
    holder.position.copy(fallbackPos);
    holder.quaternion.copy(fallbackQuat);
  }
  holder.name = `${o?.name ?? 'anchor'}_holder`;
  return holder;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse(c => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat?.dispose();
    }
  });
}

/** If a mesh's first UV set is degenerate (all one point) but a second set exists, use the second. */
export function ensureUV(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const uv1 = g.getAttribute('uv1') as THREE.BufferAttribute | undefined;
  if (!uv1 || g.userData.uvChecked) return;
  g.userData.uvChecked = true;
  let degenerate = !uv;
  if (uv) {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i));
      minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i));
    }
    degenerate = (maxU - minU) < 1e-4 || (maxV - minV) < 1e-4;
  }
  if (degenerate) g.setAttribute('uv', uv1.clone());
}
