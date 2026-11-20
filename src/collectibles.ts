import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Content, Item } from './types';
import type { Cabin } from './scene';
import { anchorFrame, ensureUV } from './scene';
import * as C from './content';
import { cartridgeLabel, spineLabel, memcardLabel, labelTexture, softDot } from './labels';
import { damp, tween, ease, reducedMotion } from './anim';

export type TplKind = 'cartridge' | 'book' | 'notebook' | 'memcard' | 'island';
export type Place = 'chest' | 'shelf' | 'rack' | 'table';

export interface Collectible {
  item: Item;
  kind: TplKind;
  place: Place;
  obj: THREE.Object3D;
  holder: THREE.Object3D;
  home: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  hover: number; hoverT: number;
  pull: number; pullT: number;
  pulse: number;
  glow: boolean;
  tintMats: THREE.MeshStandardMaterial[];
  halo?: THREE.Sprite;
  /** true while play.ts owns the transform */
  detached: boolean;
}

const HOVER: Record<TplKind, THREE.Vector3> = {
  cartridge: new THREE.Vector3(0, 0.025, 0.004),
  book: new THREE.Vector3(0, 0.004, 0.025),
  notebook: new THREE.Vector3(0, 0.004, 0.025),
  memcard: new THREE.Vector3(0, 0, 0.018),
  island: new THREE.Vector3(0, 0.02, 0),
};
const PULL: Record<TplKind, THREE.Vector3> = {
  cartridge: new THREE.Vector3(0, 0.1, 0.07),
  book: new THREE.Vector3(0, 0.01, 0.11),
  notebook: new THREE.Vector3(0, 0.01, 0.09),
  memcard: new THREE.Vector3(0, 0.012, 0.075),
  island: new THREE.Vector3(0, 0.035, 0),
};
const PULL_TILT: Record<TplKind, number> = { cartridge: -0.28, book: 0, notebook: 0, memcard: 0, island: 0 };

export class Collectibles {
  list: Collectible[] = [];
  byId = new Map<string, Collectible>();
  pickables: THREE.Object3D[] = [];
  route?: { mesh: THREE.InstancedMesh; total: number };
  private tpl!: Record<TplKind, THREE.Object3D>;
  private labelJobs: (() => Promise<void>)[] = [];
  /** Swap the procedural labels for label art (call after the first frame). */
  async loadLabelArt() {
    const jobs = this.labelJobs.splice(0);
    await Promise.all(jobs.map(j => j().catch(() => {})));
  }
  private haloTex = softDot(128, 'rgba(255,200,120,0.9)', 'rgba(255,170,80,0)');

  constructor(private scene: THREE.Scene, private cabin: Cabin) {}

  async build(content: Content, gltf: GLTF | null) {
    this.tpl = templates(gltf);
    const jobs: Promise<void>[] = [];

    // Chest rows
    (['games', 'ai', 'tools'] as const).forEach((g, gi) => {
      const holder = this.holder(`SLOT_cart_${g}`, new THREE.Vector3(-2.62, 0.72, -0.25 + gi * 0.12));
      // spread each row over the drawer's width (0.63 m between the first and last slot) instead of packing it left
      const row = C.cartridges(content, g);
      const step = row.length > 1 ? Math.min(0.105, Math.max(0.07, 0.63 / (row.length - 1))) : 0;
      const start = (0.63 - step * (row.length - 1)) / 2;
      row.forEach((item, i) => {
        jobs.push(this.add(item, 'cartridge', 'chest', holder, new THREE.Vector3(start + i * step, 0, 0)));
      });
    });
    // Shelf rows
    for (const [slot, list, kind] of [['SLOT_books', C.books(content), 'book'], ['SLOT_notebooks', C.notebooks(content), 'notebook']] as const) {
      const holder = this.holder(slot, new THREE.Vector3(-2.75, slot === 'SLOT_books' ? 1.62 : 1.25, -0.4), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)));
      const thick = size(this.tpl[kind]).x || (kind === 'book' ? 0.035 : 0.02);
      let x = 0;
      list.forEach(item => {
        jobs.push(this.add(item, kind, 'shelf', holder, new THREE.Vector3(x + thick / 2, 0, 0)));
        x += thick + 0.005;
      });
    }
    // Rack grid, newest first
    {
      const holder = this.holder('SLOT_cards', new THREE.Vector3(2.85, 1.9, -0.25), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0)));
      C.memoryCards(content).forEach((item, i) => {
        jobs.push(this.add(item, 'memcard', 'rack', holder, new THREE.Vector3((i % 4) * 0.13, -Math.floor(i / 4) * 0.15, 0)));
      });
    }
    // Map islands
    {
      const holder = this.holder('SLOT_map', new THREE.Vector3(0, 0.86, -0.2));
      const pts: THREE.Vector3[] = [];
      C.islands(content).forEach(item => {
        const p = new THREE.Vector3((item.map!.x - 0.5) * 1.2, 0.012, (0.5 - item.map!.y) * 0.8);
        pts.push(p.clone().setY(0.003));
        jobs.push(this.add(item, 'island', 'table', holder, p));
      });
      if (pts.length > 1) this.buildRoute(holder, pts);
    }
    await Promise.all(jobs);
  }

  private holder(name: string, fallback: THREE.Vector3, q?: THREE.Quaternion) {
    const h = anchorFrame(this.cabin.get(name), fallback, q);
    if (!this.cabin.get(name)) console.warn(`[collectibles] missing ${name}`);
    this.scene.add(h);
    return h;
  }

  private async add(item: Item, kind: TplKind, place: Place, holder: THREE.Object3D, pos: THREE.Vector3) {
    const obj = this.tpl[kind].clone(true);
    obj.position.copy(pos);
    obj.quaternion.identity();
    obj.name = `item_${item.id}`;
    holder.add(obj);
    const c: Collectible = {
      item, kind, place, obj, holder, home: pos.clone(), homeQuat: new THREE.Quaternion(),
      hover: 0, hoverT: 0, pull: 0, pullT: 0, pulse: 0, glow: !!item.current, tintMats: [], detached: false,
    };
    const labelFallback = kind === 'cartridge' ? cartridgeLabel : kind === 'memcard' ? memcardLabel : spineLabel;
    const tasks: Promise<void>[] = [];
    obj.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.userData.collectible = c;
      this.pickables.push(mesh);
      const conv = (m: THREE.Material) => {
        const n = m.name.replace(/\.\d+$/, '');
        if (n === 'Plastic' || n === 'Cover' || n === 'Rock') {
          const mm = (m as THREE.MeshStandardMaterial).clone();
          if (n !== 'Rock') mm.color.set(item.colour);
          else mm.color.lerp(new THREE.Color(item.colour), 0.35);
          c.tintMats.push(mm);
          return mm;
        }
        if (n === 'Label' || n === 'SpineLabel') {
          ensureUV(mesh);
          const mm = (m as THREE.MeshStandardMaterial).clone();
          mm.color.set('#ffffff');
          mm.roughness = 0.7; mm.metalness = 0;
          // spines use spine art; cartridges/cards may use generated label art
          const useArt = n === 'Label';
          mm.map = labelFallback(item);
          mm.needsUpdate = true;
          // label art streams in after the first frame (loadLabelArt); the procedural label shows until then
          if (useArt && item.label) this.labelJobs.push(() => labelTexture(item, () => mm.map!).then(t => {
            if (t === mm.map) return;
            const old = mm.map; mm.map = t; mm.needsUpdate = true; old?.dispose();
          }));
          return mm;
        }
        return m;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    });
    if (c.glow) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex, transparent: true, depthWrite: false, opacity: 0.5, blending: THREE.AdditiveBlending }));
      const s = size(obj);
      halo.scale.setScalar(Math.max(s.x, s.y, s.z) * 2.2);
      halo.position.copy(pos).add(new THREE.Vector3(0, s.y / 2, kind === 'memcard' ? -0.01 : 0));
      halo.renderOrder = 1;
      holder.add(halo);
      c.halo = halo;
    }
    this.list.push(c);
    this.byId.set(item.id, c);
    await Promise.all(tasks);
  }

  private buildRoute(holder: THREE.Object3D, pts: THREE.Vector3[]) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    const step = 0.026;
    const n = Math.floor(len / step);
    const geo = new THREE.PlaneGeometry(0.014, 0.0045).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: '#6b2f1a', transparent: true, opacity: 0.85, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const p = curve.getPointAt(u), tng = curve.getTangentAt(u);
      q.setFromAxisAngle(up, Math.atan2(-tng.z, tng.x));
      m.compose(p, q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    }
    mesh.count = n;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    holder.add(mesh);
    this.route = { mesh, total: n };
  }

  /** Animate the dotted career route in (called when the table view opens). */
  revealRoute() {
    const r = this.route;
    if (!r) return;
    if (reducedMotion) { r.mesh.count = r.total; return; }
    tween(2.2, k => { r.mesh.count = Math.max(1, Math.round(r.total * k)); }, { ease: ease.inOutCubic, key: 'route' });
  }
  hideRoute() { if (this.route && !reducedMotion) this.route.mesh.count = 0; }

  setHover(c: Collectible | null) {
    for (const x of this.list) x.hoverT = x === c ? 1 : 0;
  }
  setPulled(c: Collectible | null) {
    for (const x of this.list) x.pullT = x === c ? 1 : 0;
  }
  /** Brief highlight pulse (e.g. card ↔ island of the same job). */
  pulseJob(job: string | undefined) {
    if (!job) return;
    for (const x of this.list) if (x.item.job === job) x.pulse = 1;
  }
  sameJob(c: Collectible, kind: TplKind): Collectible | undefined {
    return this.list.find(x => x.kind === kind && x.item.job && x.item.job === c.item.job);
  }

  worldCenter(c: Collectible, out = new THREE.Vector3()) {
    return new THREE.Box3().setFromObject(c.obj).getCenter(out);
  }

  update(t: number, dt: number, camPos?: THREE.Vector3) {
    const tmp = new THREE.Vector3(), toCam = new THREE.Vector3();
    for (const c of this.list) {
      c.hover = damp(c.hover, c.hoverT, 12, dt);
      c.pull = damp(c.pull, c.pullT, 7, dt);
      c.pulse = Math.max(0, c.pulse - dt * 0.5);
      if (!c.detached) {
        tmp.copy(c.home).addScaledVector(HOVER[c.kind], c.hover * (1 - c.pull)).addScaledVector(PULL[c.kind], c.pull);
        if (camPos && c.kind === 'cartridge' && c.pull > 0.001) {
          // present the pulled cartridge a little toward the viewer
          toCam.copy(camPos); c.holder.worldToLocal(toCam);
          toCam.sub(c.home).normalize();
          tmp.addScaledVector(toCam, 0.09 * c.pull);
        }
        if (c.kind === 'island') tmp.y += Math.sin(t * 1.3 + c.home.x * 9) * 0.004;
        c.obj.position.copy(tmp);
        c.obj.rotation.set(PULL_TILT[c.kind] * c.pull, 0, 0);
        if (c.kind === 'island') c.obj.scale.setScalar(1 + c.hover * 0.2 + c.pull * 0.25 + Math.sin(c.pulse * 12) * c.pulse * 0.2);
      }
      const glowK = (c.glow ? 0.25 + 0.15 * Math.sin(t * 2) : 0) + c.pulse * 0.8 + c.hover * 0.12;
      for (const m of c.tintMats) {
        m.emissive.set(c.item.colour);
        m.emissiveIntensity = glowK;
      }
      if (c.halo) (c.halo.material as THREE.SpriteMaterial).opacity = 0.35 + 0.2 * Math.sin(t * 2);
    }
  }
}

function size(o: THREE.Object3D) {
  return new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
}

/** Templates from collectibles.glb, or simple procedural stand-ins with the same material names. */
function templates(gltf: GLTF | null): Record<TplKind, THREE.Object3D> {
  const names: Record<TplKind, string> = { cartridge: 'TPL_cartridge', book: 'TPL_book', notebook: 'TPL_notebook', memcard: 'TPL_memcard', island: 'TPL_island' };
  const out = {} as Record<TplKind, THREE.Object3D>;
  for (const k of Object.keys(names) as TplKind[]) {
    const o = gltf?.scene.getObjectByName(names[k]);
    if (o) {
      const c = o.clone(true);
      c.position.set(0, 0, 0); c.quaternion.identity();
      out[k] = c;
    } else out[k] = procedural(k);
  }
  return out;
}

function glbUV(g: THREE.BufferGeometry) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return g;
}

function std(name: string, color: string, rough = 0.6, metal = 0) {
  return new THREE.MeshStandardMaterial({ name, color, roughness: rough, metalness: metal });
}

function procedural(k: TplKind): THREE.Object3D {
  const g = new THREE.Group();
  g.name = `TPL_${k}`;
  const box = (w: number, h: number, d: number, mat: THREE.Material, y = h / 2, z = 0, x = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); g.add(m); return m;
  };
  const plane = (w: number, h: number, mat: THREE.Material, pos: THREE.Vector3, rotY = 0) => {
    const m = new THREE.Mesh(glbUV(new THREE.PlaneGeometry(w, h)), mat);
    m.position.copy(pos); m.rotation.y = rotY; g.add(m); return m;
  };
  if (k === 'cartridge') {
    box(0.06, 0.075, 0.012, std('Plastic', '#888', 0.55));
    plane(0.046, 0.05, std('Label', '#fff', 0.7), new THREE.Vector3(0, 0.043, 0.0062));
  } else if (k === 'book' || k === 'notebook') {
    const [w, h, d] = k === 'book' ? [0.035, 0.24, 0.17] : [0.02, 0.21, 0.15];
    box(w, h, d, std('Cover', '#844', 0.8), h / 2, -d / 2);
    box(w * 0.8, h * 0.96, d * 0.97, std('Pages', '#efe3c8', 0.9), h / 2, -d / 2 - 0.003);
    plane(w * 0.96, h * 0.96, std('SpineLabel', '#fff', 0.8), new THREE.Vector3(0, h / 2, 0.0006));
  } else if (k === 'memcard') {
    box(0.1, 0.12, 0.008, std('Plastic', '#666', 0.5));
    plane(0.084, 0.07, std('Label', '#fff', 0.7), new THREE.Vector3(0, 0.072, 0.0042));
    for (let i = 0; i < 8; i++) box(0.007, 0.018, 0.001, std('Contacts', '#d8b04a', 0.3, 1), 0.016, 0.0042, -0.035 + i * 0.01);
  } else {
    const rock = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.05, 6), std('Rock', '#8a7060', 1));
    rock.rotation.x = Math.PI; rock.position.y = 0.025; g.add(rock);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.03, 0.008, 6), std('Grass', '#7aa25a', 1));
    grass.position.y = 0.052; g.add(grass);
  }
  return g;
}
