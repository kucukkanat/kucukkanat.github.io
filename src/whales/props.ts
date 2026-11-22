// Procedural low-poly props for the whale ecosystems: vertex-coloured geometry, base at y = 0, about one unit tall
// (the ecosystem scales them). Every call with a different rng state gives a different individual.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RNG } from './rng';
import type { Biome, TreeKind, ShrubKind, RockKind, LandmarkKind, CritterKind } from './biomes';

/** Lantern glass: this exact (linear) colour glows at night in both renderers. */
export const LAMP = new THREE.Color().setRGB(1.0, 0.694, 0.214);
const col = (h: string | THREE.Color) => (typeof h === 'string' ? new THREE.Color(h) : h);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

interface PartOpts {
  /** Colour at the top of the part (default: the base colour). */
  top?: string | THREE.Color;
  p?: [number, number, number]; r?: [number, number, number]; s?: number | [number, number, number];
  /** Noise displacement along the normal, as a fraction of the part's size. */
  wob?: number; seed?: number;
  /** Darkening at the bottom (ambient occlusion), 0..1. */
  ao?: number;
}

export class GB {
  private parts: THREE.BufferGeometry[] = [];
  add(src: THREE.BufferGeometry, base: string | THREE.Color, o: PartOpts = {}) {
    const g = src.index ? src.toNonIndexed() : src.clone();
    g.deleteAttribute('uv');
    const pos = g.attributes.position as THREE.BufferAttribute, nrm = g.attributes.normal as THREE.BufferAttribute;
    if (o.wob) {
      g.computeBoundingSphere(); const k = o.wob * g.boundingSphere!.radius, sd = o.seed ?? 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + sd) * 43758.5453; const n = (h - Math.floor(h)) * 2 - 1;
        pos.setXYZ(i, x + nrm.getX(i) * n * k, y + nrm.getY(i) * n * k, z + nrm.getZ(i) * n * k);
      }
    }
    const s = o.s ?? 1;
    _s.set(...(typeof s === 'number' ? [s, s, s] as const : s));
    _m.compose(_p.set(...(o.p ?? [0, 0, 0])), _q.setFromEuler(_e.set(...(o.r ?? [0, 0, 0]))), _s);
    g.applyMatrix4(_m);
    g.computeBoundingBox(); const y0 = g.boundingBox!.min.y, h = Math.max(1e-6, g.boundingBox!.max.y - y0);
    const c0 = col(base), c1 = col(o.top ?? base), ao = o.ao ?? 0.25;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - y0) / h, k = 1 - ao * (1 - t);
      colors[i * 3] = (c0.r + (c1.r - c0.r) * t) * k; colors[i * 3 + 1] = (c0.g + (c1.g - c0.g) * t) * k; colors[i * 3 + 2] = (c0.b + (c1.b - c0.b) * t) * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(g);
    return this;
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ── primitives (base at y = 0)
const ico = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg).translate(0, h / 2, 0);
const cyl = (rTop: number, rBot: number, h: number, seg = 6) => new THREE.CylinderGeometry(rTop, rBot, h, seg).translate(0, h / 2, 0);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
const dome = (r: number, seg = 8) => new THREE.SphereGeometry(r, seg, Math.max(3, seg >> 1), 0, Math.PI * 2, 0, Math.PI / 2);
const TAU = Math.PI * 2;

// ── trees
function roundTree(rng: RNG, fol: string[], trunk: string) {
  const b = new GB(); const th = rng.range(0.32, 0.46);
  b.add(cyl(0.035, 0.06, th + 0.1, 5), trunk, { r: [rng.bell() * 0.08, 0, rng.bell() * 0.08] });
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU, d = i ? rng.range(0.08, 0.2) : 0, r = rng.range(0.17, 0.27) * (i ? 0.85 : 1.1);
    const c = col(rng.pick(fol));
    b.add(ico(r, 1), c.clone().multiplyScalar(0.72), { top: c.clone().lerp(new THREE.Color(1, 1, 1), 0.12),
      p: [Math.cos(a) * d, th + rng.range(0.12, 0.3), Math.sin(a) * d], s: [1, rng.range(0.78, 0.95), 1], wob: 0.1, seed: rng.f() * 9, ao: 0.1 });
  }
  return b.build();
}
function conifer(rng: RNG, fol: string[], trunk: string, snow = false) {
  const b = new GB(); const tiers = rng.int(3, 4);
  b.add(cyl(0.03, 0.05, 0.3, 5), trunk);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers, r = 0.26 * (1 - t * 0.62), h = 0.36 - t * 0.06, c = col(rng.pick(fol));
    b.add(cone(r, h, 7), c.clone().multiplyScalar(0.85), { top: snow ? '#f4f9fc' : c.clone().lerp(new THREE.Color(1, 1, 0.8), 0.18), p: [0, 0.16 + t * 0.62, 0], r: [0, rng.f() * TAU, 0], ao: 0.05 });
  }
  return b.build();
}
function palm(rng: RNG, fol: string[], trunk: string) {
  const b = new GB(); const lean = rng.range(0.1, 0.32), dir = rng.f() * TAU, segs = 4; let x = 0, z = 0, y = 0;
  for (let i = 0; i < segs; i++) {
    const a = lean * (i + 1) / segs, h = 0.22;
    b.add(cyl(0.028 - i * 0.003, 0.036 - i * 0.003, h + 0.02, 5), trunk, { p: [x, y, z], r: [Math.sin(dir) * a, 0, -Math.cos(dir) * a], ao: 0.1 });
    x += Math.cos(dir) * Math.sin(a) * h; z += Math.sin(dir) * Math.sin(a) * h; y += Math.cos(a) * h;
  }
  const n = rng.int(6, 8);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + rng.f() * 0.3, c = col(rng.pick(fol)), droop = rng.range(0.45, 0.8);
    const leaf = new THREE.ConeGeometry(0.07, 0.5, 4).scale(1, 1, 0.18).translate(0, 0.25, 0);
    b.add(leaf, c.clone().multiplyScalar(0.8), { top: c, p: [x, y, z], r: [0, -a, -(Math.PI / 2 - droop * 0.4) - droop * 0.35], ao: 0 });
  }
  b.add(ico(0.045, 0), '#6a4a2a', { p: [x, y - 0.03, z] });
  return b.build();
}
function jungleTree(rng: RNG, fol: string[], trunk: string) {
  const b = new GB(); const h = rng.range(0.62, 0.8);
  b.add(cyl(0.035, 0.07, h, 6), trunk, { r: [rng.bell() * 0.06, 0, rng.bell() * 0.06] });
  for (let i = 0; i < 3; i++) b.add(cone(0.035, 0.2, 4), trunk, { p: [0, 0, 0], r: [0.9, i * TAU / 3, 0], s: [1, 1, 0.5] });
  const n = rng.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = rng.f() * TAU, d = i ? rng.range(0.12, 0.26) : 0, c = col(rng.pick(fol));
    b.add(ico(rng.range(0.2, 0.28), 1), c.clone().multiplyScalar(0.65), { top: c, p: [Math.cos(a) * d, h + rng.range(-0.02, 0.1), Math.sin(a) * d], s: [1.15, 0.5, 1.15], wob: 0.12, seed: rng.f() * 9, ao: 0.1 });
  }
  for (let i = 0; i < 3; i++) { const a = rng.f() * TAU; b.add(cyl(0.006, 0.006, rng.range(0.2, 0.4), 3), '#3f7a2e', { p: [Math.cos(a) * 0.2, h - 0.38, Math.sin(a) * 0.2] }); }
  return b.build();
}
function mushroomTree(rng: RNG, caps: string[], stem: string) {
  const b = new GB(); const h = rng.range(0.5, 0.85), r = rng.range(0.24, 0.36), c = col(rng.pick(caps));
  b.add(cyl(0.05, 0.085, h, 7), stem, { top: '#fff8ee', r: [rng.bell() * 0.07, 0, rng.bell() * 0.07], ao: 0.3 });
  b.add(dome(r, 9), c.clone().multiplyScalar(0.75), { top: c.clone().lerp(new THREE.Color(1, 1, 1), 0.25), p: [0, h - 0.04, 0], s: [1, rng.range(0.55, 0.85), 1], ao: 0.05 });
  b.add(new THREE.CircleGeometry(r * 0.96, 9).rotateX(Math.PI / 2), '#f6e8d8', { p: [0, h - 0.035, 0], ao: 0 });
  for (let i = 0, n = rng.int(4, 7); i < n; i++) {
    const a = rng.f() * TAU, d = rng.range(0.25, 0.8) * r, y = Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) * r * 0.68;
    b.add(ico(rng.range(0.025, 0.05), 0), '#fff6e8', { p: [Math.cos(a) * d, h - 0.04 + y, Math.sin(a) * d], s: [1, 0.4, 1], ao: 0 });
  }
  if (rng.chance(0.5)) { const a = rng.f() * TAU; b.add(dome(r * 0.4, 7), c, { p: [Math.cos(a) * 0.16, h * 0.38, Math.sin(a) * 0.16], s: [1, 0.7, 1] }); }
  return b.build();
}
function coralTree(rng: RNG, cols: string[]) {
  const b = new GB(); const c = col(rng.pick(cols));
  const branch = (x: number, y: number, z: number, rx: number, rz: number, len: number, r: number, depth: number) => {
    b.add(cyl(r * 0.72, r, len, 5), c.clone().multiplyScalar(0.7), { top: c, p: [x, y, z], r: [rx, 0, rz], ao: 0.1 });
    const dx = -Math.sin(rz) * len, dy = Math.cos(rx) * Math.cos(rz) * len, dz = Math.sin(rx) * len;
    if (depth <= 0) { b.add(ico(r * 1.05, 0), c.clone().lerp(new THREE.Color(1, 1, 1), 0.35), { p: [x + dx, y + dy, z + dz], ao: 0 }); return; }
    for (let i = 0, n = rng.int(2, 3); i < n; i++)
      branch(x + dx, y + dy, z + dz, rx + rng.bell() * 0.9, rz + rng.bell() * 0.9, len * 0.72, r * 0.7, depth - 1);
  };
  branch(0, 0, 0, rng.bell() * 0.15, rng.bell() * 0.15, 0.3, 0.055, 2);
  return b.build();
}
function cactus(rng: RNG, cols: string[]) {
  const b = new GB(); const c = col(rng.pick(cols)), h = rng.range(0.5, 0.8);
  b.add(cyl(0.07, 0.08, h, 7), c.clone().multiplyScalar(0.75), { top: c }); b.add(ico(0.07, 1), c, { p: [0, h, 0] });
  for (let i = 0, n = rng.int(1, 3); i < n; i++) {
    const a = rng.f() * TAU, y = rng.range(0.25, 0.5) * h, l = rng.range(0.12, 0.2), up = rng.range(0.15, 0.3);
    b.add(cyl(0.045, 0.045, l, 6), c, { p: [Math.cos(a) * 0.05, y, Math.sin(a) * 0.05], r: [Math.sin(a) * 1.57, 0, -Math.cos(a) * 1.57] });
    b.add(cyl(0.04, 0.045, up, 6), c, { p: [Math.cos(a) * (0.05 + l), y - 0.02, Math.sin(a) * (0.05 + l)] });
    b.add(ico(0.04, 0), c, { p: [Math.cos(a) * (0.05 + l), y + up - 0.02, Math.sin(a) * (0.05 + l)] });
  }
  if (rng.chance(0.4)) b.add(ico(0.03, 0), '#ff6a8a', { p: [0, h + 0.07, 0] });
  return b.build();
}
function deadTree(rng: RNG, trunk: string) {
  const b = new GB();
  const branch = (x: number, y: number, z: number, rx: number, rz: number, len: number, r: number, depth: number) => {
    b.add(cyl(r * 0.6, r, len, 4), trunk, { p: [x, y, z], r: [rx, 0, rz], ao: 0.15 });
    if (depth <= 0) return;
    const dx = -Math.sin(rz) * len, dy = Math.cos(rx) * Math.cos(rz) * len, dz = Math.sin(rx) * len;
    for (let i = 0, n = rng.int(2, 3); i < n; i++) branch(x + dx, y + dy, z + dz, rx + rng.bell() * 1.1, rz + rng.bell() * 1.1, len * 0.66, r * 0.6, depth - 1);
  };
  branch(0, 0, 0, rng.bell() * 0.1, rng.bell() * 0.1, 0.36, 0.045, 2);
  return b.build();
}
function willow(rng: RNG, fol: string[], trunk: string) {
  const b = new GB(); const h = rng.range(0.5, 0.65);
  b.add(cyl(0.04, 0.075, h, 6), trunk, { r: [rng.bell() * 0.12, 0, rng.bell() * 0.12] });
  const c0 = col(rng.pick(fol));
  b.add(ico(0.26, 1), c0.clone().multiplyScalar(0.7), { top: c0, p: [0, h + 0.08, 0], s: [1.2, 0.6, 1.2], wob: 0.1, seed: rng.f() * 9 });
  for (let i = 0, n = rng.int(9, 13); i < n; i++) {
    const a = i / n * TAU + rng.f() * 0.3, d = rng.range(0.2, 0.3), l = rng.range(0.25, 0.48), c = col(rng.pick(fol));
    b.add(cone(0.035, l, 4), c, { top: c.clone().multiplyScalar(0.7), p: [Math.cos(a) * d, h + 0.08, Math.sin(a) * d], r: [Math.PI, 0, 0], s: [1, 1, 0.5], ao: 0 });
  }
  return b.build();
}

export function makeTree(kind: TreeKind, rng: RNG, fol: string[], trunk: string, snow = false): THREE.BufferGeometry {
  switch (kind) {
    case 'conifer': return conifer(rng, fol, trunk, snow);
    case 'palm': return palm(rng, fol, trunk);
    case 'jungle': return jungleTree(rng, fol, trunk);
    case 'mushroom': return mushroomTree(rng, fol, trunk);
    case 'coral': return coralTree(rng, fol);
    case 'cactus': return cactus(rng, fol);
    case 'dead': return deadTree(rng, trunk);
    case 'willow': return willow(rng, fol, trunk);
    default: return roundTree(rng, fol, trunk);
  }
}

// ── undergrowth (about 0.2 units tall)
export function makeShrub(kind: ShrubKind, rng: RNG, cols: string[]): THREE.BufferGeometry {
  const b = new GB(); const c = col(rng.pick(cols));
  if (kind === 'fern' || kind === 'agave') {
    const n = rng.int(5, 8), stiff = kind === 'agave';
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + rng.f() * 0.4, l = rng.range(0.16, 0.26);
      b.add(new THREE.ConeGeometry(stiff ? 0.035 : 0.045, l, 3).scale(1, 1, 0.25).translate(0, l / 2, 0), c.clone().multiplyScalar(0.7),
        { top: stiff ? c.clone().lerp(new THREE.Color(1, 1, 1), 0.2) : c, r: [0, -a, -(stiff ? 0.7 : 1.05) + rng.bell() * 0.15], ao: 0 });
    }
  } else if (kind === 'reed') {
    for (let i = 0, n = rng.int(4, 7); i < n; i++) {
      const h = rng.range(0.2, 0.36), x = rng.bell() * 0.05, z = rng.bell() * 0.05;
      b.add(cone(0.008, h, 3), c.clone().multiplyScalar(0.7), { top: c, p: [x, 0, z], r: [rng.bell() * 0.12, 0, rng.bell() * 0.12], ao: 0 });
      if (rng.chance(0.5)) b.add(cyl(0.013, 0.013, 0.05, 4), '#6a4a2e', { p: [x, h * 0.78, z] });
    }
  } else if (kind === 'shroomlet') {
    for (let i = 0, n = rng.int(2, 4); i < n; i++) {
      const h = rng.range(0.06, 0.14), x = rng.bell() * 0.07, z = rng.bell() * 0.07, cc = col(rng.pick(cols));
      b.add(cyl(0.012, 0.016, h, 4), '#f6ecdc', { p: [x, 0, z] });
      b.add(dome(rng.range(0.035, 0.06), 6), cc.clone().multiplyScalar(0.8), { top: cc, p: [x, h - 0.01, z], s: [1, 0.7, 1], ao: 0 });
    }
  } else if (kind === 'anemone') {
    b.add(cyl(0.05, 0.06, 0.07, 6), c.clone().multiplyScalar(0.6));
    for (let i = 0, n = rng.int(7, 10); i < n; i++) {
      const a = i / n * TAU;
      b.add(cone(0.012, rng.range(0.1, 0.16), 3), c, { top: c.clone().lerp(new THREE.Color(1, 1, 1), 0.4), p: [Math.cos(a) * 0.035, 0.06, Math.sin(a) * 0.035], r: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], ao: 0 });
    }
  } else {
    for (let i = 0, n = rng.int(2, 3); i < n; i++) {
      const cc = col(rng.pick(cols));
      b.add(ico(rng.range(0.07, 0.11), 1), cc.clone().multiplyScalar(0.7), { top: cc, p: [rng.bell() * 0.07, 0.06, rng.bell() * 0.07], s: [1, 0.8, 1], wob: 0.12, seed: rng.f() * 9, ao: 0.1 });
    }
  }
  return b.build();
}

export function makeGrass(rng: RNG, cols: string[]): THREE.BufferGeometry {
  const b = new GB();
  for (let i = 0, n = rng.int(4, 6); i < n; i++) {
    const c = col(rng.pick(cols)), h = rng.range(0.07, 0.14);
    b.add(new THREE.ConeGeometry(0.014, h, 3).scale(1, 1, 0.3).translate(0, h / 2, 0), c.clone().multiplyScalar(0.72), { top: c.clone().lerp(new THREE.Color(1, 1, 0.8), 0.15),
      p: [rng.bell() * 0.04, 0, rng.bell() * 0.04], r: [rng.bell() * 0.3, rng.f() * TAU, rng.bell() * 0.3], ao: 0 });
  }
  return b.build();
}
export function makeFlower(rng: RNG, cols: string[]): THREE.BufferGeometry {
  const b = new GB();
  for (let i = 0, n = rng.int(2, 4); i < n; i++) {
    const h = rng.range(0.06, 0.11), x = rng.bell() * 0.05, z = rng.bell() * 0.05;
    b.add(cyl(0.004, 0.004, h, 3), '#4a8a34', { p: [x, 0, z] });
    b.add(ico(0.02, 0), rng.pick(cols), { p: [x, h, z], s: [1, 0.6, 1], ao: 0 });
  }
  return b.build();
}

// ── rocks (about 0.3 units)
export function makeRock(kind: RockKind, rng: RNG, cols: [string, string], snow = false): THREE.BufferGeometry {
  const b = new GB();
  if (kind === 'crystal') {
    for (let i = 0, n = rng.int(3, 5); i < n; i++) {
      const h = rng.range(0.16, 0.42), r = rng.range(0.03, 0.06), a = rng.f() * TAU, t = i ? rng.range(0.2, 0.6) : 0;
      b.add(cyl(r * 0.25, r, h, 5), cols[0], { top: cols[1], p: [Math.cos(a) * 0.04 * i, 0, Math.sin(a) * 0.04 * i], r: [Math.sin(a) * t, 0, -Math.cos(a) * t], ao: 0.1 });
    }
  } else if (kind === 'basalt') {
    for (let i = 0, n = rng.int(4, 7); i < n; i++) {
      const a = rng.f() * TAU, d = i ? rng.range(0.06, 0.14) : 0;
      b.add(cyl(0.055, 0.055, rng.range(0.12, 0.42), 6), cols[1], { top: cols[0], p: [Math.cos(a) * d, 0, Math.sin(a) * d], ao: 0.3 });
    }
  } else if (kind === 'shard') {
    for (let i = 0, n = rng.int(2, 3); i < n; i++)
      b.add(cone(rng.range(0.05, 0.09), rng.range(0.25, 0.5), 4), cols[0], { top: cols[1], p: [rng.bell() * 0.08, 0, rng.bell() * 0.08], r: [rng.bell() * 0.4, rng.f() * TAU, rng.bell() * 0.4], ao: 0.1 });
  } else {
    for (let i = 0, n = rng.int(1, 3); i < n; i++) {
      const r = rng.range(0.1, 0.17) * (i ? 0.65 : 1);
      b.add(ico(r, 1), cols[1], { top: snow ? '#f2f7fa' : cols[0], p: [i ? rng.bell() * 0.16 : 0, r * 0.45, i ? rng.bell() * 0.16 : 0],
        s: [rng.range(0.9, 1.3), rng.range(0.6, 0.9), rng.range(0.9, 1.2)], r: [0, rng.f() * TAU, 0], wob: 0.16, seed: rng.f() * 9, ao: 0.2 });
    }
  }
  return b.build();
}
export function makeBoulder(rng: RNG, cols: [string, string]): THREE.BufferGeometry {
  // centred on the origin: it rolls
  return new GB().add(ico(0.5, 1), cols[1], { top: cols[0], wob: 0.14, seed: rng.f() * 9, ao: 0.25 }).build();
}

// ── landmarks (about one unit across). `smoke`: where chimney smoke rises from (local).
export interface Landmark { geo: THREE.BufferGeometry; radius: number; smoke?: THREE.Vector3; lamp?: boolean }
export function makeLandmark(kind: LandmarkKind, rng: RNG, bio: Biome): Landmark {
  const b = new GB(); const [s0, s1] = bio.stone, wood = bio.wood, roof = bio.roof;
  switch (kind) {
    case 'hut': {
      b.add(box(0.5, 0.3, 0.42), wood, { top: col(wood).multiplyScalar(1.15) });
      b.add(new THREE.ConeGeometry(0.42, 0.3, 4).rotateY(Math.PI / 4).scale(1, 1, 0.86).translate(0, 0.45, 0), roof, { top: col(roof).multiplyScalar(1.2), ao: 0.1 });
      b.add(box(0.1, 0.17, 0.02), '#3a2a1e', { p: [0.08, 0, 0.212] });
      b.add(box(0.09, 0.09, 0.02), LAMP, { p: [-0.12, 0.12, 0.212], ao: 0 });
      b.add(box(0.08, 0.26, 0.08), s1, { top: s0, p: [-0.14, 0.34, -0.08] });
      return { geo: b.build(), radius: 0.42, smoke: new THREE.Vector3(-0.14, 0.62, -0.08), lamp: true };
    }
    case 'igloo': {
      b.add(dome(0.34, 10), '#d6e6f0', { top: '#ffffff', ao: 0.2 });
      b.add(cyl(0.13, 0.13, 0.24, 8).rotateX(Math.PI / 2).translate(0, 0.02, 0.34), '#e2eef6', { ao: 0.2 });
      b.add(new THREE.CircleGeometry(0.09, 8), LAMP, { p: [0, 0.09, 0.461], ao: 0 });
      return { geo: b.build(), radius: 0.45, lamp: true };
    }
    case 'pyramid': {
      const n = 5;
      for (let i = 0; i < n; i++) { const w = 0.9 * (1 - i / n * 0.86); b.add(box(w, 0.1, w), s1, { top: s0, p: [0, i * 0.1, 0], ao: 0.3 }); }
      b.add(box(0.16, 0.1, 0.16), s0, { p: [0, n * 0.1, 0] }); b.add(box(0.16, 0.02, 0.62), s1, { p: [0, 0.25, 0.2], r: [0.72, 0, 0] });
      return { geo: b.build(), radius: 0.62 };
    }
    case 'torii': {
      const red = '#d2402e';
      for (const sx of [-1, 1]) b.add(cyl(0.028, 0.034, 0.62, 6), red, { p: [sx * 0.24, 0, 0], r: [0, 0, sx * 0.04] });
      b.add(box(0.74, 0.05, 0.07), '#2a2226', { p: [0, 0.62, 0] }); b.add(box(0.66, 0.04, 0.05), red, { p: [0, 0.57, 0] });
      b.add(box(0.56, 0.035, 0.04), red, { p: [0, 0.46, 0] });
      return { geo: b.build(), radius: 0.36 };
    }
    case 'arch': {
      const segs = 9;
      for (let i = 0; i <= segs; i++) {
        const a = i / segs * Math.PI, r = 0.36;
        b.add(ico(rng.range(0.085, 0.12), 1), s1, { top: s0, p: [Math.cos(a) * r, Math.sin(a) * r * 1.15 + 0.03, rng.bell() * 0.02], wob: 0.16, seed: rng.f() * 9, ao: 0.15 });
      }
      return { geo: b.build(), radius: 0.48 };
    }
    case 'colonnade': {
      const n = rng.int(5, 7);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU, x = Math.cos(a) * 0.36, z = Math.sin(a) * 0.36, broken = rng.chance(0.35), h = broken ? rng.range(0.15, 0.35) : 0.52;
        b.add(cyl(0.05, 0.055, 0.04, 8), s1, { p: [x, 0, z] });
        b.add(cyl(0.036, 0.042, h, 8), s1, { top: s0, p: [x, 0.04, z], r: broken ? [rng.bell() * 0.08, 0, rng.bell() * 0.08] : [0, 0, 0] });
        if (!broken) b.add(box(0.11, 0.035, 0.11), s0, { p: [x, 0.56, z] });
      }
      b.add(cyl(0.04, 0.04, 0.4, 8).rotateZ(Math.PI / 2).translate(0.05, 0.04, 0.08), s1, { r: [0, rng.f() * TAU, 0] });
      b.add(cyl(0.44, 0.46, 0.03, 12), s1, { top: s0 });
      return { geo: b.build(), radius: 0.5 };
    }
    case 'tower': {
      b.add(cyl(0.16, 0.2, 0.7, 8), s1, { top: s0, ao: 0.3 });
      for (let i = 0; i < 6; i++) if (rng.chance(0.75)) { const a = i / 6 * TAU; b.add(box(0.07, 0.09, 0.05), s0, { p: [Math.cos(a) * 0.15, 0.7, Math.sin(a) * 0.15], r: [0, -a + Math.PI / 2, 0] }); }
      b.add(box(0.06, 0.1, 0.02), LAMP, { p: [0, 0.45, 0.172], ao: 0 });
      b.add(box(0.09, 0.16, 0.02), '#2e2622', { p: [0, 0, 0.196] });
      return { geo: b.build(), radius: 0.3, lamp: true };
    }
    case 'stilt': {
      for (const [x, z] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.16], [0.2, 0.16]]) b.add(cyl(0.018, 0.02, 0.3, 4), wood, { p: [x, 0, z] });
      b.add(box(0.54, 0.03, 0.44), wood, { p: [0, 0.28, 0] }); b.add(box(0.38, 0.2, 0.3), col(wood).multiplyScalar(1.2), { p: [-0.04, 0.31, 0] });
      b.add(new THREE.ConeGeometry(0.36, 0.22, 4).rotateY(Math.PI / 4).scale(1, 1, 0.82).translate(-0.04, 0.62, 0), roof, { ao: 0.1 });
      b.add(box(0.07, 0.08, 0.02), LAMP, { p: [-0.04, 0.38, 0.152], ao: 0 });
      return { geo: b.build(), radius: 0.42, smoke: new THREE.Vector3(-0.04, 0.74, 0), lamp: true };
    }
    case 'tent': {
      b.add(new THREE.ConeGeometry(0.3, 0.42, 6).translate(0, 0.21, 0), '#e8dcc0', { top: roof, ao: 0.15 });
      b.add(new THREE.ConeGeometry(0.2, 0.3, 5).translate(0.42, 0.15, 0.1), roof, { top: '#f0e6cc', ao: 0.15 });
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; b.add(ico(0.03, 0), s1, { p: [-0.3 + Math.cos(a) * 0.08, 0.015, 0.3 + Math.sin(a) * 0.08] }); }
      b.add(cone(0.035, 0.09, 4), LAMP, { p: [-0.3, 0.01, 0.3], ao: 0 });
      return { geo: b.build(), radius: 0.55, smoke: new THREE.Vector3(-0.3, 0.12, 0.3), lamp: true };
    }
    case 'lighthouse': {
      b.add(cyl(0.11, 0.17, 0.72, 10), '#f4f0e6', { ao: 0.2 });
      b.add(cyl(0.135, 0.15, 0.14, 10), '#d8402e', { p: [0, 0.26, 0] });
      b.add(cyl(0.15, 0.15, 0.03, 10), '#3a3e48', { p: [0, 0.72, 0] });
      b.add(cyl(0.085, 0.085, 0.12, 8), LAMP, { p: [0, 0.75, 0], ao: 0 });
      b.add(cone(0.12, 0.12, 8), '#d8402e', { p: [0, 0.87, 0] });
      return { geo: b.build(), radius: 0.3, lamp: true };
    }
    case 'statue': {
      b.add(box(0.36, 0.1, 0.36), s1, { top: s0 });
      b.add(ico(0.2, 1), s1, { top: s0, p: [0, 0.36, 0], s: [0.95, 1.3, 1.0], wob: 0.05, seed: 3, ao: 0.2 });
      b.add(box(0.07, 0.14, 0.07), s0, { p: [0, 0.3, 0.19] }); b.add(box(0.26, 0.035, 0.05), s1, { p: [0, 0.46, 0.17] });
      b.add(box(0.2, 0.03, 0.04), s1, { p: [0, 0.22, 0.18] });
      return { geo: b.build(), radius: 0.34 };
    }
    case 'giantTree': {
      const fol = bio.trees[0].foliage, trunk = bio.trees[0].trunk;
      b.add(cyl(0.09, 0.2, 0.75, 8), trunk, { top: col(trunk).multiplyScalar(1.2), ao: 0.3 });
      for (let i = 0; i < 5; i++) b.add(cone(0.07, 0.3, 4), trunk, { r: [1.15, i * TAU / 5, 0], s: [1, 1, 0.6] });
      for (let i = 0; i < 9; i++) {
        const a = rng.f() * TAU, d = i ? rng.range(0.15, 0.45) : 0, c = col(rng.pick(fol));
        b.add(ico(rng.range(0.25, 0.36), 1), c.clone().multiplyScalar(0.68), { top: c, p: [Math.cos(a) * d, 0.82 + rng.range(-0.05, 0.3), Math.sin(a) * d], s: [1, 0.8, 1], wob: 0.1, seed: rng.f() * 9, ao: 0.1 });
      }
      b.add(box(0.07, 0.1, 0.02), LAMP, { p: [0, 0.18, 0.165], ao: 0 });
      return { geo: b.build(), radius: 0.4, lamp: true };
    }
    case 'stoneCircle': {
      const n = rng.int(6, 9);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU;
        b.add(box(0.09, rng.range(0.22, 0.4), 0.06), s1, { top: s0, p: [Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36], r: [rng.bell() * 0.1, -a + Math.PI / 2, rng.bell() * 0.1], ao: 0.3 });
      }
      b.add(box(0.2, 0.08, 0.14), s0, { p: [0, 0, 0] });
      return { geo: b.build(), radius: 0.46 };
    }
    case 'wreck': {
      const hullC = col(wood).multiplyScalar(0.8);
      b.add(new THREE.SphereGeometry(0.3, 8, 5, 0, TAU, Math.PI / 2, Math.PI / 2).scale(1.7, 0.75, 0.6).translate(0, 0.2, 0), hullC, { top: wood, r: [0.25, rng.f() * TAU, 0.2], ao: 0.3 });
      b.add(cyl(0.02, 0.026, 0.62, 5), wood, { p: [0.05, 0.1, 0], r: [0.25, 0, 0.3] });
      b.add(box(0.3, 0.014, 0.02), wood, { p: [-0.07, 0.56, 0.12], r: [0.25, 0, 0.3] });
      return { geo: b.build(), radius: 0.5 };
    }
    default: { // forge
      b.add(box(0.44, 0.26, 0.38), s1, { top: s0 });
      b.add(cyl(0.07, 0.11, 0.5, 6), s1, { top: s0, p: [0.1, 0.26, -0.06] });
      b.add(box(0.14, 0.12, 0.02), LAMP, { p: [-0.06, 0.03, 0.192], ao: 0 });
      b.add(box(0.2, 0.07, 0.12), '#2a2628', { p: [0.42, 0, 0.1] });
      return { geo: b.build(), radius: 0.42, smoke: new THREE.Vector3(0.1, 0.78, -0.06), lamp: true };
    }
  }
}

// ── loose things
export function makeLanternPost(wood: string): THREE.BufferGeometry {
  return new GB().add(cyl(0.012, 0.016, 0.42, 5), wood).add(box(0.15, 0.014, 0.014), wood, { p: [0.06, 0.41, 0] }).build();
}
/** Hangs from its origin (the pivot is at y = 0, the lamp below). */
export function makeLantern(): THREE.BufferGeometry {
  return new GB().add(cyl(0.003, 0.003, 0.06, 3), '#2a2420', { p: [0, -0.06, 0] })
    .add(box(0.05, 0.065, 0.05), LAMP, { p: [0, -0.125, 0], ao: 0 })
    .add(cone(0.045, 0.03, 4), '#3a2a22', { p: [0, -0.06, 0] }).add(box(0.056, 0.01, 0.056), '#3a2a22', { p: [0, -0.13, 0] }).build();
}
export function makeBoat(wood: string, sail: string | null): THREE.BufferGeometry {
  const b = new GB();
  b.add(new THREE.SphereGeometry(0.1, 7, 4, 0, TAU, Math.PI / 2, Math.PI / 2).scale(1, 0.6, 2.2).translate(0, 0.045, 0), col(wood).multiplyScalar(0.8), { top: wood, ao: 0.1 });
  b.add(box(0.14, 0.008, 0.03), wood, { p: [0, 0.03, 0] });
  if (sail) {
    b.add(cyl(0.006, 0.006, 0.26, 4), wood, { p: [0, 0.02, 0.02] });
    const tri = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.07, 0.02), new THREE.Vector3(0, 0.27, 0.02), new THREE.Vector3(0, 0.07, -0.15)]);
    tri.setIndex([0, 1, 2, 2, 1, 0]); tri.computeVertexNormals();
    b.add(tri, sail, { ao: 0 });
  }
  return b.build();
}
export function makeLily(rng: RNG, flower: string | null): THREE.BufferGeometry {
  const b = new GB();
  b.add(new THREE.CircleGeometry(0.06, 7, 0.4, TAU - 0.8).rotateX(-Math.PI / 2), '#4a8a3a', { p: [0, 0.004, 0], r: [0, rng.f() * TAU, 0], ao: 0 });
  if (flower) b.add(ico(0.02, 0), flower, { p: [0, 0.018, 0], s: [1, 0.7, 1], ao: 0 });
  return b.build();
}

// ── fauna (facing +Z, feet at y = 0, about 0.25 units long)
export function makeCritter(kind: CritterKind, c0: string, c1: string): THREE.BufferGeometry {
  const b = new GB();
  const legs = (xs: number, zs: number[], h: number, r = 0.012) => { for (const z of zs) for (const sx of [-1, 1]) b.add(cyl(r, r * 0.8, h, 4), col(c0).multiplyScalar(0.75), { p: [sx * xs, 0, z] }); };
  switch (kind) {
    case 'penguin':
      b.add(ico(0.06, 1), c0, { p: [0, 0.075, 0], s: [0.85, 1.25, 0.8] }); b.add(ico(0.045, 1), c1, { p: [0, 0.07, 0.022], s: [0.75, 1.15, 0.6], ao: 0 });
      b.add(ico(0.036, 1), c0, { p: [0, 0.165, 0.005] }); b.add(cone(0.012, 0.03, 4), '#f0a030', { p: [0, 0.16, 0.035], r: [Math.PI / 2, 0, 0] });
      for (const sx of [-1, 1]) b.add(box(0.012, 0.07, 0.03), c0, { p: [sx * 0.055, 0.05, 0], r: [0, 0, sx * -0.25] });
      break;
    case 'crab':
      b.add(ico(0.05, 1), c0, { top: c1, p: [0, 0.035, 0], s: [1.3, 0.5, 0.95] });
      for (const sx of [-1, 1]) { b.add(ico(0.022, 0), c1, { p: [sx * 0.07, 0.05, 0.05] }); for (let i = 0; i < 3; i++) b.add(cyl(0.005, 0.004, 0.06, 3), c0, { p: [sx * 0.05, 0.02, -0.03 + i * 0.025], r: [0, 0, sx * -1.0] }); }
      break;
    case 'frog': case 'salamander': {
      const long = kind === 'salamander';
      b.add(ico(0.045, 1), c0, { top: c1, p: [0, 0.035, 0], s: [0.9, 0.6, long ? 2.0 : 1.2] }); b.add(ico(0.03, 1), c0, { p: [0, 0.045, long ? 0.09 : 0.05], s: [1, 0.7, 1] });
      if (long) b.add(cone(0.02, 0.12, 4), c0, { top: c1, p: [0, 0.03, -0.08], r: [-Math.PI / 2, 0, 0] });
      for (const sx of [-1, 1]) { b.add(ico(0.012, 0), '#f8f4e0', { p: [sx * 0.02, 0.07, long ? 0.1 : 0.06] }); b.add(box(0.02, 0.012, 0.05), c0, { p: [sx * 0.045, 0, -0.03] }); }
      break;
    }
    case 'camel':
      b.add(ico(0.08, 1), c0, { p: [0, 0.2, 0], s: [0.7, 0.75, 1.4] }); b.add(ico(0.045, 1), c1, { p: [0, 0.275, -0.01], s: [0.7, 0.9, 0.9] });
      b.add(cyl(0.022, 0.03, 0.15, 5), c0, { p: [0, 0.2, 0.09], r: [0.5, 0, 0] }); b.add(ico(0.032, 1), c0, { p: [0, 0.345, 0.185], s: [0.8, 0.8, 1.4] });
      legs(0.035, [-0.07, 0.07], 0.16, 0.013);
      break;
    default: { // deer, fox, capybara, goat
      const h = kind === 'capybara' ? 0.07 : kind === 'fox' ? 0.08 : 0.13, len = kind === 'capybara' ? 1.5 : 1.35, fat = kind === 'capybara' ? 1.0 : 0.72;
      b.add(ico(0.06, 1), c0, { top: col(c0).multiplyScalar(1.1), p: [0, h + 0.045, 0], s: [fat, 0.8, len] });
      b.add(ico(0.03, 1), c1, { p: [0, h + 0.03, 0.01], s: [fat * 0.9, 0.5, len * 1.6], ao: 0 });
      const hy = kind === 'capybara' ? h + 0.07 : h + 0.12, hz = 0.1;
      if (kind !== 'capybara') b.add(cyl(0.018, 0.024, 0.09, 5), c0, { p: [0, h + 0.05, 0.06], r: [0.55, 0, 0] });
      b.add(ico(0.03, 1), c0, { p: [0, hy, hz], s: [0.85, 0.85, 1.3] }); b.add(ico(0.012, 0), '#2a2220', { p: [0, hy - 0.005, hz + 0.038] });
      for (const sx of [-1, 1]) b.add(cone(0.01, 0.03, 3), c0, { p: [sx * 0.018, hy + 0.02, hz - 0.012] });
      if (kind === 'deer') for (const sx of [-1, 1]) { b.add(cyl(0.004, 0.005, 0.07, 3), '#e8dcc0', { p: [sx * 0.012, hy + 0.025, hz - 0.015], r: [-0.2, 0, sx * -0.5] }); b.add(cyl(0.003, 0.004, 0.035, 3), '#e8dcc0', { p: [sx * 0.035, hy + 0.07, hz - 0.03], r: [0.4, 0, sx * 0.3] }); }
      if (kind === 'goat') for (const sx of [-1, 1]) b.add(cone(0.007, 0.045, 3), '#5a5048', { p: [sx * 0.014, hy + 0.02, hz - 0.02], r: [-0.6, 0, 0] });
      if (kind === 'fox') b.add(cone(0.028, 0.13, 5), c0, { top: c1, p: [0, h + 0.045, -0.07], r: [-1.9, 0, 0] });
      else b.add(ico(0.014, 0), c1, { p: [0, h + 0.06, -0.085] });
      legs(0.026, [-0.05, 0.05], h, 0.01);
    }
  }
  return b.build();
}
export function makeFish(c: string): THREE.BufferGeometry {
  const b = new GB();
  b.add(ico(0.05, 1), col(c).multiplyScalar(0.75), { top: c, s: [0.4, 0.6, 1.5], ao: 0.1 });
  b.add(new THREE.ConeGeometry(0.04, 0.06, 3).scale(0.2, 1, 1).rotateX(Math.PI / 2).translate(0, 0, -0.09), c, { ao: 0 });
  return b.build();
}
