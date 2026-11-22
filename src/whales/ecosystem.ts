// The ecosystem a whale carries, grown at runtime from its genome: terrain shaped over the whale's own back, lakes
// with outlets, landmarks, trees, undergrowth, rocks and loose things - and how all of it answers the whale's motion.
//
//   detail 'full'  : instanced props with per-plant springs, swinging lanterns, rolling boulders, floating boats,
//                    live lakes, fauna (viewer; the whales nearest the camera in the airship world)
//   detail 'cheap' : the same island (same seed, thinner planting) merged into one skinned mesh, lakes that only
//                    tilt, a few birds (far whales, phones)
import * as THREE from 'three';
import { RNG, fbm } from './rng';
import type { Genome } from './genome';
import type { Biome } from './biomes';
import { Back, SkinRig, gridSample, mulAffine } from './back';
import { Lake, type LakeSpec } from './water';
import { Puffs, Ribbon, type WhaleEnv } from './effects';
import { makeTree, makeShrub, makeGrass, makeFlower, makeRock, makeBoulder, makeLandmark, makeLanternPost, makeLantern, makeBoat, makeLily } from './props';
import { Fauna } from './fauna';

const { clamp, smoothstep, lerp } = THREE.MathUtils;
const TAU = Math.PI * 2;

export interface IslandInfo { center: [number, number, number]; halfLength: number; halfWidth: number; top: number }

/** What the whale tells its ecosystem every frame (all in the whale's own frame unless noted). */
export interface EcoCtx {
  dt: number; time: number;
  /** World scale of the whale, and its object -> motion-space matrix. */
  k: number; M: THREE.Matrix4;
  /** The whale's rotation in the motion space. */
  q: THREE.Quaternion;
  /** Velocity in the motion space. */
  vel: THREE.Vector3;
  /** Linear acceleration over the reference acceleration (about -1..1 in ordinary manoeuvres). */
  sig: THREE.Vector3;
  /** Unit gravity. */
  g: THREE.Vector3;
  /** Angular velocity and acceleration (rad/s, rad/s^2), and the reference acceleration in whale metres. */
  w: THREE.Vector3; wd: THREE.Vector3; aRef: number;
  night: number; storm: number;
  /** A fright this frame (0..1) and where it came from. */
  startle: number; startleFrom: THREE.Vector3 | null;
  /** Something watching from nearby (the airship, the camera), or null. */
  visitor: THREE.Vector3 | null;
  /** Shed biome particles (leaves, petals, snow) at a motion-space point. */
  burst(p: THREE.Vector3, n: number): void;
}

type Kind = 'rigid' | 'tree' | 'sway' | 'lamp' | 'float';
interface Inst {
  geo: string; kind: Kind; x: number; y: number; z: number; rot: number; s: number; sy: number; tint: THREE.Color | null;
  /** Height (lever arm, crown), keep-probability in the cheap build, lake index for floaters. */
  h: number; keep: number; lake?: number;
}
interface Group {
  mesh: THREE.InstancedMesh; kind: Kind; n: number;
  pos: Float32Array; rs: Float32Array; idx: Uint16Array; w: Float32Array; st: Float32Array; par: Float32Array; lake: Int16Array;
}
interface Boulder { home: THREE.Vector3; p: THREE.Vector3; v: THREE.Vector3; r: number; q: THREE.Quaternion; fall: number; wait: number; grow: number }
interface Fall { lake: Lake; o: number; ribbon: Ribbon; mistAcc: number }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _mat = new THREE.Matrix4(), _mi = new THREE.Matrix4();
const _B = new Float32Array(16), _c9 = new Float32Array(9);

export class Ecosystem {
  /** Lives under the whale object (terrain, props, lakes). */
  readonly group = new THREE.Group();
  /** Lives in the motion space (birds, waterfalls). Add with the whale's other effects. */
  readonly fx = new THREE.Group();
  /** Opaque, vertex-coloured meshes the host may re-shade (the airship world paints them). */
  readonly solids: THREE.Mesh[] = [];
  readonly rig: SkinRig; readonly back: Back; readonly U: number; readonly bio: Biome;
  readonly lakes: Lake[] = []; readonly lakeSpecs: LakeSpec[] = [];
  readonly cx: number; readonly cz: number; readonly hl: number; readonly hw: number; top = 0;
  readonly stats = { triangles: 0, trees: 0, props: 0, lakes: 0, waterfalls: 0, animals: 0 };
  /** Terrain height (NaN off the island) and footprint radius (1 = the edge), on the Back grid. */
  private H: Float32Array; private RN: Float32Array;
  private groups: Group[] = []; private boulders: Boulder[] = []; private boulderMesh: THREE.InstancedMesh | null = null;
  private falls: Fall[] = []; private fauna: Fauna | null = null;
  private smokes: { p: THREE.Vector3; idx: number }[] = [];
  private lakeIdx: Uint16Array; private lakeW: Float32Array; private lakeB: Float32Array;
  private soft = { x: 0, z: 0, vx: 0, vz: 0 };
  private edge: [number, number, number];
  private smokeAcc = 0; private cloudAcc = 0; private flyAcc = 0; private cloudPos = new THREE.Vector3(); private cloudInit = false;
  private treeTops: THREE.Vector3[] = [];
  readonly full: boolean;

  constructor(body: THREE.SkinnedMesh, obj: THREE.Object3D, island: IslandInfo, readonly genome: Genome, readonly L: number,
    private env: WhaleEnv, private puffs: Puffs, private glow: Puffs, opts: { detail: 'cheap' | 'full'; toon: boolean; material: (toon: boolean) => THREE.Material }) {
    this.full = opts.detail === 'full';
    const bio = this.bio = genome.biome; const U = this.U = L / 14;
    const rng = new RNG(genome.ecoSeed);
    this.cx = 0; this.cz = island.center[2]; this.hl = island.halfLength; this.hw = island.halfWidth;
    const nz = this.full ? 104 : 56, nx = this.full ? 46 : 26;
    this.rig = new SkinRig(body, obj);
    const back = this.back = new Back(body, obj, { x0: -this.hw * 1.32, x1: this.hw * 1.32, z0: this.cz - this.hl * 1.12, z1: this.cz + this.hl * 1.12, nx, nz });
    this.edge = [rng.f() * TAU, rng.f() * TAU, rng.f() * TAU];
    const N = nx * nz; this.H = new Float32Array(N).fill(NaN); this.RN = new Float32Array(N).fill(9);

    // ── plan: hills, lakes, landmarks
    const eco = rng.fork('plan');
    const hills: { x: number; z: number; r: number; h: number }[] = [];
    for (let i = 0, n = eco.int(bio.hills[0], bio.hills[1]); i < n; i++)
      hills.push({ x: eco.range(-0.45, 0.45) * this.hw, z: this.cz + eco.range(-0.7, 0.7) * this.hl, r: eco.range(0.45, 0.8) * this.hw, h: eco.range(0.22, 0.5) * U * bio.relief });
    const lakePlan: { x: number; z: number; r: number; side: number; two: boolean }[] = [];
    for (let i = 0, n = eco.int(bio.lakes[0], bio.lakes[1]), tries = 0; i < n && tries < 60; tries++) {
      const r = eco.range(0.34, 0.52) * this.hw * (n > 2 ? 0.85 : 1), side = eco.chance(0.5) ? 1 : -1;
      const x = side * eco.range(0.05, 0.36) * this.hw, z = this.cz + eco.range(-0.62, 0.62) * this.hl;
      if (lakePlan.some(l => Math.hypot(l.x - x, l.z - z) < l.r + r + 0.3 * this.hw)) continue;
      lakePlan.push({ x, z, r, side, two: eco.chance(0.25) && Math.abs(x) < 0.15 * this.hw }); i++;
    }
    if (bio.crater && lakePlan.length) {
      const l = lakePlan[0]; l.x *= 0.4; l.r *= 0.85;
      hills.unshift({ x: l.x, z: l.z, r: l.r * 2.6, h: 0.75 * U * bio.relief });
    }

    // ── terrain heights
    const plateau = new Float32Array(nz), span = Math.max(2, Math.round(nz / 9));
    for (let j = 0; j < nz; j++) {
      let s = 0, c = 0;
      for (let q = -span; q <= span; q++) { const t = back.topY[clamp(j + q, 0, nz - 1)]; if (Number.isFinite(t)) { s += t; c++; } }
      plateau[j] = c ? s / c : NaN;
    }
    const thick = 0.02 * L, seed = genome.ecoSeed % 1000;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = back.x0 + i * back.dx, z = back.z0 + j * back.dz, skin = back.y[k];
      const rn = this.rnAt(x, z); this.RN[k] = rn;
      if (!Number.isFinite(skin) || !Number.isFinite(plateau[j]) || rn > 1.1) continue;
      if (rn >= 1) { this.H[k] = skin - 0.012 * L * smoothstep(rn, 1, 1.06); continue; }
      const t = 1 - rn, rise = smoothstep(t, 0, 0.36);
      let flat = plateau[j] + thick - 0.72 * (plateau[j] - skin);
      for (const h of hills) flat += h.h * Math.exp(-((x - h.x) ** 2 + (z - h.z) ** 2) / (h.r * h.r));
      flat += (fbm(x / (0.9 * U), z / (0.9 * U), seed) - 0.5) * 0.3 * U * bio.relief + (fbm(x / (0.22 * U), z / (0.22 * U), seed + 9) - 0.5) * 0.05 * U;
      const base = skin + 0.006 * L * smoothstep(t, 0, 0.05);
      this.H[k] = base + Math.max(0, flat - base) * rise;
    }
    // ── lakes: level the ground around each, carve the basin and an outlet channel to the island's edge
    const chan = new Uint8Array(N);
    lakePlan.forEach((lp, li) => {
      const r = lp.r; let level = gridSample(this.H, back, lp.x, lp.z) - 0.03 * U, maxSkin = -Infinity;
      for (let a = 0; a < 12; a++) for (const d of [0.4, 0.9]) {
        const s = back.y[back.node(lp.x + Math.cos(a / 12 * TAU) * r * d, lp.z + Math.sin(a / 12 * TAU) * r * d)]; if (Number.isFinite(s)) maxSkin = Math.max(maxSkin, s);
      }
      const want = (bio.liquid === 'ice' ? 0.16 : 0.34) * r;
      if (level - maxSkin - 0.012 * L < want) level = maxSkin + 0.012 * L + want;
      const depth = want, rimH = 0.13 * r + 0.02 * U, sill = 0.05 * r;
      const sides = lp.two ? [1, -1] : [lp.side];
      const outlets: LakeSpec['outlets'] = [];
      for (const side of sides) {
        let lipX = lp.x + side * r;
        while (Math.abs(lipX) < this.hw * 1.3 && this.rnAt(lipX, lp.z) < 0.99) lipX += side * back.dx * 0.5;
        outlets.push({ dx: side, dz: 0, lipX, lipZ: lp.z });
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; if (!(this.RN[k] < 1)) continue;
        const x = back.x0 + i * back.dx, z = back.z0 + j * back.dz, d = Math.hypot(x - lp.x, z - lp.z);
        if (d < r * 1.75) {
          const target = d < r ? level - depth * (1 - (d / r) ** 2) : level + rimH * smoothstep(d, r, r * 1.35);
          const wgt = 1 - smoothstep(d, r * 1.3, r * 1.75);
          // don't lift the island's own rim into a wall: fade the levelling out towards the edge
          const edgeK = smoothstep(1 - this.RN[k], 0, 0.14);
          this.H[k] = lerp(this.H[k], Math.max(target, back.y[k] + 0.004 * L), wgt * (d < r ? 1 : edgeK));
        }
        for (const o of outlets) {
          const along = (x - lp.x) * o.dx, off = Math.abs(z - lp.z);
          if (along > r * 0.82 && off < r * 0.34) {
            const cw = 1 - smoothstep(off, r * 0.1, r * 0.34), run = (along - r * 0.82) / Math.max(1e-3, Math.abs(o.lipX - lp.x) - r * 0.82);
            const bedY = level - sill - run * 0.1 * r;
            if (this.H[k] > bedY) this.H[k] = Math.max(lerp(this.H[k], bedY, cw), back.y[k] + 0.003 * L);
            if (cw > 0.3) chan[k] = 1;
          }
        }
      }
      this.lakeSpecs.push({ x: lp.x, y: level, z: lp.z, r, depth, kind: bio.liquid, shallow: bio.water.shallow, deep: bio.water.deep, foam: bio.water.foam, glow: bio.water.glow ?? 0, outlets });
      void li;
    });

    // ── terrain mesh (skinned to the body's skeleton)
    const vid = new Int32Array(N).fill(-1); const P: number[] = [], SI: number[] = [], SW: number[] = [], grid: number[] = [];
    for (let k = 0; k < N; k++) {
      if (!Number.isFinite(this.H[k])) continue;
      vid[k] = grid.length; grid.push(k);
      P.push(back.x0 + (k % nx) * back.dx, this.H[k], back.z0 + Math.floor(k / nx) * back.dz);
      for (let c = 0; c < 4; c++) { SI.push(back.idx[k * 4 + c]); SW.push(back.w[k * 4 + c]); }
    }
    const index: number[] = [];
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = vid[j * nx + i], b = vid[j * nx + i + 1], c = vid[(j + 1) * nx + i], d = vid[(j + 1) * nx + i + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      index.push(a, c, b, b, c, d);
    }
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); tgeo.setIndex(index); tgeo.computeVertexNormals();
    const nrm = tgeo.attributes.normal, colors = new Float32Array(grid.length * 3);
    const cG0 = new THREE.Color(bio.ground[0]), cG1 = new THREE.Color(bio.ground[1]), cC0 = new THREE.Color(bio.cliff[0]), cC1 = new THREE.Color(bio.cliff[1]);
    const cShore = new THREE.Color(bio.shore), cMoss = new THREE.Color(bio.moss), cSnow = new THREE.Color('#f6fafc'), col = new THREE.Color();
    let top = -Infinity, hi = -Infinity, lo = Infinity;
    for (const k of grid) if (this.RN[k] < 0.8) { hi = Math.max(hi, this.H[k]); lo = Math.min(lo, this.H[k]); }
    grid.forEach((k, vi) => {
      const x = P[vi * 3], y = P[vi * 3 + 1], z = P[vi * 3 + 2], ny = nrm.getY(vi), rn = this.RN[k];
      top = Math.max(top, y);
      col.copy(cG0).lerp(cG1, fbm(x / (0.5 * U), z / (0.5 * U), seed + 3));
      col.lerp(cMoss, smoothstep(rn, 0.8, 0.98) * 0.8);
      if (bio.snow) col.lerp(cSnow, clamp(bio.snow * (0.75 + (y - lo) / Math.max(1e-3, hi - lo) * 0.5), 0, 1));
      const steep = 1 - smoothstep(ny, 0.6, 0.86);
      col.lerp(_tmpC.copy(cC0).lerp(cC1, fbm(x / (0.2 * U), y / (0.08 * U), seed + 5)), steep * (rn < 0.98 ? 1 : 0.4));
      for (const l of this.lakeSpecs) {
        const d = Math.hypot(x - l.x, z - l.z);
        if (d < l.r * 1.45) {
          col.lerp(cShore, 1 - smoothstep(d, l.r * 1.05, l.r * 1.45));
          if (y < l.y) col.multiplyScalar(lerp(1, bio.liquid === 'lava' ? 0.35 : 0.62, smoothstep(l.y - y, 0, l.depth)));
          if (bio.liquid === 'lava') col.lerp(_tmpC.setRGB(0.5, 0.1, 0.02), (1 - smoothstep(d, l.r * 0.9, l.r * 1.3)) * 0.5);
        }
      }
      if (chan[k]) col.lerp(cShore, 0.7);
      colors.set([col.r, col.g, col.b], vi * 3);
    });
    this.top = top;
    tgeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tgeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); tgeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));

    // ── planting
    const list: Inst[] = []; const geos = new Map<string, THREE.BufferGeometry>();
    const occ: { x: number; z: number; r: number }[] = [];
    const prng = rng.fork('plant'), grng = rng.fork('geo');
    const free = (x: number, z: number, r: number) => occ.every(o => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);
    const dry = (x: number, z: number, margin: number) => this.lakeSpecs.every(l => Math.hypot(x - l.x, z - l.z) > l.r * margin
      && l.outlets.every(o => !((x - l.x) * o.dx > 0 && Math.abs(z - l.z) < l.r * 0.42)));
    const slope = (x: number, z: number) => {
      const e = back.dx * 1.2;
      return Math.hypot(this.groundY(x + e, z) - this.groundY(x - e, z), this.groundY(x, z + e) - this.groundY(x, z - e)) / (2 * e);
    };
    const sample = (n: number, rad: number, o: { rMax?: number; rMin?: number; lake?: number; maxSlope?: number; block?: boolean } = {}) => {
      const out: [number, number][] = [];
      for (let t = 0; out.length < n && t < n * 14; t++) {
        const x = prng.range(-1, 1) * this.hw * 1.05, z = this.cz + prng.range(-1, 1) * this.hl * 1.02, rn = this.rnAt(x, z);
        if (rn > (o.rMax ?? 0.88) || rn < (o.rMin ?? 0) || !dry(x, z, o.lake ?? 1.18) || !Number.isFinite(this.groundY(x, z))) continue;
        if (slope(x, z) > (o.maxSlope ?? 0.9) || (rad > 0 && !free(x, z, rad))) continue;
        if (o.block !== false && rad > 0) occ.push({ x, z, r: rad });
        out.push([x, z]);
      }
      return out;
    };
    const tintOf = (amount: number) => { const v = 1 + prng.bell() * amount; return new THREE.Color(v * (1 + prng.bell() * amount * 0.5), v, v * (1 + prng.bell() * amount * 0.5)); };
    const add = (geo: string, kind: Kind, x: number, z: number, s: number, o: Partial<Inst> = {}) => {
      const it: Inst = { geo, kind, x, y: this.groundY(x, z), z, rot: prng.f() * TAU, s, sy: s * (1 + prng.bell() * 0.12), tint: null, h: s, keep: prng.f(), ...o };
      list.push(it); return it;
    };
    const dens = bio.density, area = (this.hl * this.hw) / (2.6 * U * U);   // ~1 for a blue whale's island

    // landmarks first: they claim the best ground
    const marks = prng.shuffle(bio.landmarks).slice(0, prng.int(1, Math.min(3, bio.landmarks.length)));
    marks.forEach((kind, i) => {
      const lm = makeLandmark(kind, grng, bio); const s = U * prng.range(0.62, 0.8) * (kind === 'giantTree' ? 1.7 : 1);
      const spot = sample(1, lm.radius * s, { rMax: 0.72, maxSlope: 0.55 })[0]; if (!spot) return;
      geos.set(`lm${i}`, lm.geo);
      const it = add(`lm${i}`, 'rigid', spot[0], spot[1], s, { keep: 0, sy: s });
      it.y -= 0.03 * s;
      if (lm.smoke) this.smokes.push({ p: lm.smoke.clone().multiplyScalar(s).applyAxisAngle(_v.set(0, 1, 0), it.rot).add(_v2.set(it.x, it.y, it.z)), idx: 0 });
    });
    const boulderSpots = this.full && bio.boulders ? sample(bio.boulders, 0.13 * U, { rMax: 0.72, maxSlope: 0.6 }) : [];
    // trees
    const wsum = bio.trees.reduce((a, t) => a + t.w, 0);
    bio.trees.forEach((tr, ti) => { for (let v = 0; v < 3; v++) geos.set(`t${ti}_${v}`, makeTree(tr.kind, grng, tr.foliage, tr.trunk, tr.snow)); });
    const nTrees = Math.round(52 * dens.trees * area);
    for (const [x, z] of sample(nTrees, 0.1 * U, { rMax: 0.88, maxSlope: 1.2 })) {
      let pick = prng.f() * wsum, ti = 0; while (ti < bio.trees.length - 1 && (pick -= bio.trees[ti].w) > 0) ti++;
      const s = U * prng.range(0.4, 0.66) * (bio.trees[ti].scale ?? 1);
      const it = add(`t${ti}_${prng.int(0, 2)}`, 'tree', x, z, s, { tint: tintOf(0.1), keep: prng.f() * 2.2 });
      it.y -= 0.02 * s; this.treeTops.push(new THREE.Vector3(x, it.y + s * 0.8, z)); this.stats.trees++;
    }
    // rocks, rim-biased
    bio.rocks.forEach((rk, ri) => { for (let v = 0; v < 2; v++) geos.set(`r${ri}_${v}`, makeRock(rk.kind, grng, rk.colors, !!bio.snow)); });
    for (const [x, z] of sample(Math.round(13 * dens.rocks * area), 0.1 * U, { rMax: 0.96, rMin: 0.45, maxSlope: 2.5, lake: 1.08 }))
      add(`r${prng.int(0, bio.rocks.length - 1)}_${prng.int(0, 1)}`, 'rigid', x, z, U * prng.range(0.6, 1.5), { tint: tintOf(0.08), keep: prng.f() * 1.6 }).y -= 0.03 * U;
    // shrubs
    const ssum = bio.shrubs.reduce((a, t) => a + t.w, 0);
    bio.shrubs.forEach((sh, si) => { for (let v = 0; v < 2; v++) geos.set(`s${si}_${v}`, makeShrub(sh.kind, grng, sh.colors)); });
    for (const [x, z] of sample(Math.round(46 * dens.shrubs * area), 0.07 * U, { rMax: 0.93, lake: 1.04, maxSlope: 1.4 })) {
      let pick = prng.f() * ssum, si = 0; while (si < bio.shrubs.length - 1 && (pick -= bio.shrubs[si].w) > 0) si++;
      add(`s${si}_${prng.int(0, 1)}`, 'sway', x, z, U * prng.range(0.8, 1.4), { tint: tintOf(0.12), keep: prng.f() * 3.3, h: 0.2 * U });
    }
    // lanterns: a post (rigid) and the lamp that swings from it
    if (bio.lanterns) {
      geos.set('post', makeLanternPost(bio.wood)); geos.set('lamp', makeLantern());
      for (const [x, z] of sample(bio.lanterns + prng.int(0, 2), 0.1 * U, { rMax: 0.8, maxSlope: 0.6 })) {
        const s = U * 1.15, post = add('post', 'rigid', x, z, s, { keep: 0, sy: s });
        add('lamp', 'lamp', x + Math.cos(post.rot) * 0.125 * s, z - Math.sin(post.rot) * 0.125 * s, s, { rot: post.rot, keep: 0, sy: s }).y = post.y + 0.405 * s;
      }
    }
    if (this.full) {
      for (let v = 0; v < 2; v++) { geos.set(`g${v}`, makeGrass(grng, bio.grass)); geos.set(`f${v}`, makeFlower(grng, bio.flowers)); }
      for (const [x, z] of sample(Math.round(520 * dens.grass * area), 0, { rMax: 0.95, lake: 1.03, maxSlope: 1.2 }))
        add(`g${prng.int(0, 1)}`, 'sway', x, z, U * prng.range(0.8, 1.5), { tint: tintOf(0.14), h: 0.1 * U });
      for (const [x, z] of sample(Math.round(110 * dens.flowers * area), 0, { rMax: 0.92, lake: 1.05, maxSlope: 1 }))
        add(`f${prng.int(0, 1)}`, 'sway', x, z, U * prng.range(0.9, 1.4), { h: 0.1 * U });
    }
    // things afloat
    this.lakeSpecs.forEach((l, li) => {
      if (l.kind === 'lava') return;
      const afloat = (geo: string, s: number, rad: number) => {
        const a = prng.f() * TAU, d = Math.sqrt(prng.f()) * l.r * rad;
        list.push({ geo, kind: 'float', x: Math.cos(a) * d, y: 0, z: Math.sin(a) * d, rot: prng.f() * TAU, s, sy: s, tint: null, h: 0, keep: geo === 'boat' ? 0 : 9, lake: li });
      };
      if (bio.boats > li && l.r > 0.3 * U && l.kind === 'water') { geos.set('boat', makeBoat(bio.wood, prng.chance(0.6) ? '#f4ead8' : null)); afloat('boat', U * 0.9, 0.45); }
      if (bio.lilies && l.kind === 'water') {
        for (let v = 0; v < 2; v++) geos.set(`lily${v}`, makeLily(grng, v ? bio.flowers[0] : null));
        for (let i = 0, n = Math.round(bio.lilies * (l.r / (0.45 * U)) ** 2); i < n; i++) afloat(`lily${prng.int(0, 1)}`, U * prng.range(0.7, 1.3), 0.82);
      }
    });

    // ── lakes
    const bedAt = (x: number, z: number) => { const y = this.groundY(x, z); return Number.isFinite(y) ? y : 1e3; };
    this.lakeIdx = new Uint16Array(this.lakeSpecs.length * 4); this.lakeW = new Float32Array(this.lakeSpecs.length * 4); this.lakeB = new Float32Array(this.lakeSpecs.length * 16);
    this.lakeSpecs.forEach((spec, li) => {
      const lake = new Lake(spec, bedAt, env, this.full ? 30 : 10, this.full);
      this.lakes.push(lake); this.group.add(lake.mesh);
      const node = back.node(spec.x, spec.z);
      for (let c = 0; c < 4; c++) { this.lakeIdx[li * 4 + c] = back.idx[node * 4 + c]; this.lakeW[li * 4 + c] = back.w[node * 4 + c]; }
      spec.outlets.forEach((_, o) => {
        const lava = spec.kind === 'lava'; if (spec.kind === 'ice') return;
        const ribbon = new Ribbon({ nodes: this.full ? 24 : 12, interval: this.full ? 0.055 : 0.11, width: spec.r * 0.55, widen: 1.3, gravity: lava ? -2.4 : -4.2, drag: lava ? 1.4 : 0.9,
          color: new THREE.Color(lava ? spec.shallow : spec.shallow).lerp(new THREE.Color('#ffffff'), lava ? 0 : 0.35), glow: lava ? 1 : 0, opacity: lava ? 1 : 0.9 }, env);
        this.falls.push({ lake, o, ribbon, mistAcc: 0 }); this.fx.add(ribbon.mesh);
      });
    });
    this.stats.lakes = this.lakes.length; this.stats.waterfalls = this.falls.length;

    // ── build the meshes
    const material = opts.material(opts.toon);
    if (this.full) {
      const terrain = new THREE.SkinnedMesh(tgeo, material); terrain.name = 'Eco_Terrain';
      terrain.bind(this.rig.skeleton(), new THREE.Matrix4()); terrain.frustumCulled = false;
      this.group.add(terrain); this.solids.push(terrain);
      const by = new Map<string, Inst[]>();
      for (const it of list) { const a = by.get(it.geo + '|' + it.kind); if (a) a.push(it); else by.set(it.geo + '|' + it.kind, [it]); }
      for (const [key, items] of by) {
        const geo = geos.get(key.split('|')[0])!; const n = items.length, kind = items[0].kind;
        const mesh = new THREE.InstancedMesh(geo, material, n); mesh.name = `Eco_${key}`; mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const G: Group = { mesh, kind, n, pos: new Float32Array(n * 3), rs: new Float32Array(n * 9), idx: new Uint16Array(n * 4), w: new Float32Array(n * 4),
          st: new Float32Array(n * 4), par: new Float32Array(n * 4), lake: new Int16Array(n).fill(-1) };
        items.forEach((it, i) => {
          G.pos.set([it.x, it.y, it.z], i * 3);
          const c = Math.cos(it.rot), s = Math.sin(it.rot);
          G.rs.set([c * it.s, 0, -s * it.s, 0, it.sy, 0, s * it.s, 0, c * it.s], i * 9);
          const node = kind === 'float' ? 0 : back.node(it.x, it.z);
          for (let q = 0; q < 4; q++) { G.idx[i * 4 + q] = back.idx[node * 4 + q]; G.w[i * 4 + q] = back.w[node * 4 + q]; }
          // spring: height, stiffness (taller = slower), damping, phase
          const w2 = kind === 'lamp' ? 42 : 30 / Math.max(0.35, it.h / (0.65 * U)) * prng.range(0.75, 1.3);
          G.par.set([it.h, w2, 2 * (kind === 'lamp' ? 0.05 : prng.range(0.16, 0.3)) * Math.sqrt(w2), prng.f() * TAU], i * 4);
          if (it.lake !== undefined) { G.lake[i] = it.lake; G.st[i * 4 + 3] = it.rot; }
          if (it.tint) mesh.setColorAt(i, it.tint);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.groups.push(G); this.group.add(mesh); this.solids.push(mesh);
        this.stats.triangles += (geo.attributes.position.count / 3) * n;
      }
      this.stats.props = list.length;
      // loose boulders
      if (bio.boulders) {
        const spots = boulderSpots;
        if (spots.length) {
          const bm = this.boulderMesh = new THREE.InstancedMesh(makeBoulder(grng, bio.rocks[0].colors), material, spots.length);
          bm.frustumCulled = false; bm.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(bm); this.solids.push(bm);
          for (const [x, z] of spots) {
            const r = U * prng.range(0.09, 0.15), home = new THREE.Vector3(x, this.groundY(x, z) + r * 0.8, z);
            this.boulders.push({ home, p: home.clone(), v: new THREE.Vector3(), r, q: new THREE.Quaternion(), fall: 0, wait: 0, grow: 1 });
          }
        }
      }
      this.fauna = new Fauna(this, material, rng.fork('fauna'), true);
    } else {
      // one skinned mesh: terrain + the props that survive the thinning
      const parts: { geo: THREE.BufferGeometry; m: THREE.Matrix4 | null; tint: THREE.Color | null; node: number }[] = [{ geo: tgeo, m: null, tint: null, node: -1 }];
      for (const it of list) {
        if (it.keep > 1 || it.kind === 'float' && it.geo !== 'boat') continue;
        let x = it.x, y = it.y, z = it.z;
        if (it.kind === 'float') { const l = this.lakeSpecs[it.lake!]; x += l.x; z += l.z; y = l.y; }
        parts.push({ geo: geos.get(it.geo)!, tint: it.tint, node: back.node(x, z),
          m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_v.set(0, 1, 0), it.rot), new THREE.Vector3(it.s, it.sy, it.s)) });
      }
      let nv = 0; for (const p of parts) nv += p.geo.attributes.position.count;
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), colr = new Float32Array(nv * 3), si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
      const idx: number[] = []; let o = 0; const nm = new THREE.Matrix3();
      for (const p of parts) {
        const g = p.geo, gp = g.attributes.position, gn = g.attributes.normal, gc = g.attributes.color, n = gp.count;
        if (p.m) nm.getNormalMatrix(p.m);
        for (let i = 0; i < n; i++) {
          _v.fromBufferAttribute(gp, i); _v2.fromBufferAttribute(gn, i);
          if (p.m) { _v.applyMatrix4(p.m); _v2.applyMatrix3(nm).normalize(); }
          pos.set([_v.x, _v.y, _v.z], (o + i) * 3); nor.set([_v2.x, _v2.y, _v2.z], (o + i) * 3);
          const t = p.tint;
          colr.set([gc.getX(i) * (t ? t.r : 1), gc.getY(i) * (t ? t.g : 1), gc.getZ(i) * (t ? t.b : 1)], (o + i) * 3);
          if (p.node < 0) { for (let c = 0; c < 4; c++) { si[(o + i) * 4 + c] = SI[i * 4 + c]; sw[(o + i) * 4 + c] = SW[i * 4 + c]; } }
          else for (let c = 0; c < 4; c++) { si[(o + i) * 4 + c] = back.idx[p.node * 4 + c]; sw[(o + i) * 4 + c] = back.w[p.node * 4 + c]; }
        }
        if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + o); else for (let i = 0; i < n; i++) idx.push(o + i);
        o += n;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      mg.setAttribute('color', new THREE.BufferAttribute(colr, 3)); mg.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); mg.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      mg.setIndex(idx);
      const mesh = new THREE.SkinnedMesh(mg, material); mesh.name = 'Eco_Island';
      mesh.bind(this.rig.skeleton(), new THREE.Matrix4()); mesh.frustumCulled = false;
      this.group.add(mesh); this.solids.push(mesh);
      this.stats.triangles = idx.length / 3; this.stats.props = parts.length - 1;
      for (const g of geos.values()) g.dispose();
      this.fauna = new Fauna(this, material, rng.fork('fauna'), false);
    }
    this.stats.triangles = Math.round(this.stats.triangles + (this.full ? index.length / 3 : 0));
    if (this.fauna) { this.stats.animals = this.fauna.count; for (const m of this.fauna.solids) this.solids.push(m); }
    this.group.name = 'Ecosystem';
  }

  // ───────────────────────────────────────────────────────── queries (whale rest space)
  /** Footprint radius: < 1 on the island. */
  rnAt(x: number, z: number) {
    const u = (z - this.cz) / this.hl, v = (x - this.cx) / this.hw, phi = Math.atan2(v, u), e = this.edge;
    const edge = 0.95 + 0.06 * Math.sin(phi * 3 + e[0]) + 0.045 * Math.sin(phi * 5 + e[1]) + 0.03 * Math.sin(phi * 9 + e[2]);
    return (Math.abs(u) ** 2.5 + Math.abs(v) ** 2.5) ** 0.4 / edge;
  }
  groundY(x: number, z: number) { return gridSample(this.H, this.back, x, z); }
  /** Dry, walkable ground? */
  walkable(x: number, z: number, lakeMargin = 1.1) {
    return this.rnAt(x, z) < 0.86 && this.lakeSpecs.every(l => (l.kind === 'ice' && lakeMargin < 2) || Math.hypot(x - l.x, z - l.z) > l.r * lakeMargin);
  }
  /** The skin matrix that carries the point (x, z) of the back -> out[0..16). */
  skinAt(x: number, z: number, out: Float32Array) { const n = this.back.node(x, z); this.rig.blend(this.back.idx, this.back.w, n * 4, out, 0); }
  lakeMatrix(li: number) { return this.lakeB.subarray(li * 16, li * 16 + 16); }
  get roosts() { return this.treeTops; }

  // ───────────────────────────────────────────────────────── per frame
  update(c: EcoCtx) {
    const { dt, time, k } = c, U = this.U;
    this.rig.update();
    const wind = 0.035 + c.storm * 0.26;
    // lakes: carried by the skin; the surface answers gravity and acceleration in the whale's frame
    for (let li = 0; li < this.lakes.length; li++) {
      const lake = this.lakes[li], s = lake.spec;
      this.rig.blend(this.lakeIdx, this.lakeW, li * 4, this.lakeB, li * 16);
      _mat.fromArray(this.lakeB, li * 16).multiply(_mi.makeTranslation(s.x, s.y, s.z));
      lake.mesh.matrix.copy(_mat); lake.mesh.matrixWorldNeedsUpdate = true;
      this.pointSig(c, s.x, s.y, s.z, _v);
      const gy = Math.max(0.35, -c.g.y);
      lake.step(dt, c.g.x / gy * 0.42 - _v.x * 0.5, c.g.z / gy * 0.42 - _v.z * 0.5, Math.max(c.storm, this.genome.cloud ? 0.35 : 0) * (this.rainOn(s.x, s.z) ? 1 : 0.15), time);
      if (c.startle > 0.3 && this.full) lake.impulse((Math.random() - 0.5) * s.r, (Math.random() - 0.5) * s.r, s.r * c.startle, s.r * 0.25);
      for (const sp of lake.spills) if (Math.random() < sp.amount * dt * 40) {
        this.toSpace(c, li, sp.x, lake.heightAt(sp.x * 0.9, sp.z * 0.9), sp.z, _v);
        _v2.set(sp.dx, 0.8, sp.dz).multiplyScalar(U * 1.6 * k * (0.5 + Math.random())).transformDirection(c.M).multiplyScalar(U * 1.6 * k).add(c.vel);
        const lava = s.kind === 'lava';
        this.puffs.emit(_v.x, _v.y, _v.z, _v2.x, _v2.y, _v2.z, { life: 0.9, size: s.r * 0.35 * k, grow: 1.5, alpha: 0.55, gravity: -4 * U * k, drag: 0.8,
          color: _tmpC.set(lava ? s.shallow : s.foam), glow: lava ? 1 : 0 });
      }
    }
    if (this.full) this.updateProps(c, wind);
    this.updateFalls(c);
    this.updateWeather(c);
    this.fauna?.update(c);
  }

  /** Is the rain cloud over this point? (always, in a storm) */
  private rainOn(x: number, z: number) { return this.env.uStorm.value > 0.35 || Math.hypot(x, z - this.cz) < this.hl; }

  /** Acceleration signal felt at a point of the whale (adds the swing of the whale's own rotation). */
  private pointSig(c: EcoCtx, x: number, y: number, z: number, out: THREE.Vector3) {
    const w = c.w, wd = c.wd;
    // wd x r + w x (w x r)
    const ax = wd.y * z - wd.z * y, ay = wd.z * x - wd.x * z, az = wd.x * y - wd.y * x;
    const wr = w.x * x + w.y * y + w.z * z, ww = w.x * w.x + w.y * w.y + w.z * w.z;
    return out.set(c.sig.x + (ax + w.x * wr - x * ww) / c.aRef, c.sig.y + (ay + w.y * wr - y * ww) / c.aRef, c.sig.z + (az + w.z * wr - z * ww) / c.aRef);
  }
  /** Lake-frame point -> motion space. */
  private toSpace(c: EcoCtx, li: number, x: number, y: number, z: number, out: THREE.Vector3) {
    const s = this.lakeSpecs[li];
    return out.set(s.x + x, s.y + y, s.z + z).applyMatrix4(_mat.fromArray(this.lakeB, li * 16)).applyMatrix4(c.M);
  }

  private updateProps(c: EcoCtx, wind: number) {
    const { dt, time } = c, U = this.U;
    // undergrowth shares one soft spring (plus its own gusts)
    this.pointSig(c, 0, this.top, this.cz, _v);
    const S = this.soft, tx = clamp(-_v.x * 0.9 + c.g.x * 0.5, -0.8, 0.8), tz = clamp(-_v.z * 0.9 + c.g.z * 0.5, -0.8, 0.8);
    S.vx += (70 * (tx - S.x) - 4.2 * S.vx) * dt; S.vz += (70 * (tz - S.z) - 4.2 * S.vz) * dt; S.x += S.vx * dt; S.z += S.vz * dt;
    for (const G of this.groups) {
      const out = G.mesh.instanceMatrix.array as Float32Array, { pos, rs, st, par } = G;
      for (let i = 0; i < G.n; i++) {
        const p = i * 3, r = i * 9, s = i * 4;
        if (G.kind === 'float') { this.updateFloat(G, i, c, out); continue; }
        this.rig.blend(G.idx, G.w, s, _B, 0);
        if (G.kind === 'rigid') { mulAffine(_B, 0, rs, r, pos[p], pos[p + 1], pos[p + 2], out, i * 16); continue; }
        const ph = par[s + 3];
        const gx = wind * (Math.sin(time * 1.7 + ph + pos[p + 2] * 1.3 / U) + 0.5 * Math.sin(time * 3.3 + ph * 2.1));
        const gz = wind * (Math.cos(time * 1.3 + ph * 1.7 + pos[p] * 1.1 / U) + 0.5 * Math.sin(time * 2.9 + ph));
        let lx: number, lz: number;
        if (G.kind === 'sway') { lx = S.x * 0.9 + gx * 2.2; lz = S.z * 0.9 + gz * 2.2; }
        else {
          // each tree / lantern: its own under-damped spring, driven by what its spot on the whale feels
          this.pointSig(c, pos[p], pos[p + 1] + par[s], pos[p + 2], _v);
          const lamp = G.kind === 'lamp', gain = lamp ? 1.1 : 0.62;
          const tX = clamp(-_v.x * gain + c.g.x * (lamp ? 0.95 : 0.42) + gx, -1, 1), tZ = clamp(-_v.z * gain + c.g.z * (lamp ? 0.95 : 0.42) + gz, -1, 1);
          st[s + 2] += (par[s + 1] * (tX - st[s]) - par[s + 2] * st[s + 2]) * dt; st[s + 3] += (par[s + 1] * (tZ - st[s + 1]) - par[s + 2] * st[s + 3]) * dt;
          st[s] = clamp(st[s] + st[s + 2] * dt, -0.9, 0.9); st[s + 1] = clamp(st[s + 1] + st[s + 3] * dt, -0.9, 0.9);
          lx = st[s]; lz = st[s + 1];
          if (!lamp && Math.abs(st[s + 2]) + Math.abs(st[s + 3]) > 2.2 && Math.random() < dt * 5) {
            _v.set(pos[p] + lx * par[s], pos[p + 1] + par[s] * 0.8, pos[p + 2] + lz * par[s]).applyMatrix4(c.M); c.burst(_v, 2);
          }
          if (lamp) {
            // a pendulum: rotate about z by lx, about x by -lz
            const ca = Math.cos(lx), sa = Math.sin(lx), cb = Math.cos(-lz), sb = Math.sin(-lz);
            for (let j = 0; j < 3; j++) {
              const x = rs[r + j * 3], y = rs[r + j * 3 + 1], z = rs[r + j * 3 + 2], y1 = y * cb - z * sb, z1 = y * sb + z * cb;
              _c9[j * 3] = x * ca - y1 * sa; _c9[j * 3 + 1] = x * sa + y1 * ca; _c9[j * 3 + 2] = z1;
            }
            mulAffine(_B, 0, _c9, 0, pos[p], pos[p + 1], pos[p + 2], out, i * 16); continue;
          }
        }
        // lean: shear by height, keeping the length
        const ky = 1 / Math.sqrt(1 + lx * lx + lz * lz);
        for (let j = 0; j < 3; j++) {
          const x = rs[r + j * 3], y = rs[r + j * 3 + 1], z = rs[r + j * 3 + 2];
          _c9[j * 3] = x + lx * y * ky; _c9[j * 3 + 1] = y * ky; _c9[j * 3 + 2] = z + lz * y * ky;
        }
        mulAffine(_B, 0, _c9, 0, pos[p], pos[p + 1], pos[p + 2], out, i * 16);
      }
      G.mesh.instanceMatrix.needsUpdate = true;
    }
    this.updateBoulders(c);
  }

  /** Boats and lily pads ride the lake surface and slide down its slope. */
  private updateFloat(G: Group, i: number, c: EcoCtx, out: Float32Array) {
    const li = G.lake[i], lake = this.lakes[li], s = lake.spec, p = i * 3, st = G.st, o = i * 4, dt = c.dt, boat = G.mesh.name.includes('boat');
    if (!lake.frozen) {
      const e = lake.cell, x = G.pos[p], z = G.pos[p + 2];
      const hx = (lake.heightAt(x + e, z) - lake.heightAt(x - e, z)) / (2 * e), hz = (lake.heightAt(x, z + e) - lake.heightAt(x, z - e)) / (2 * e);
      const a = 2.2 * this.U;
      st[o] += (-hx * a - st[o] * 1.4) * dt; st[o + 1] += (-hz * a - st[o + 1] * 1.4) * dt;
      G.pos[p] += st[o] * dt; G.pos[p + 2] += st[o + 1] * dt;
      const d = Math.hypot(G.pos[p], G.pos[p + 2]), lim = s.r * (boat ? 0.6 : 0.84);
      if (d > lim) { G.pos[p] *= lim / d; G.pos[p + 2] *= lim / d; st[o] *= -0.3; st[o + 1] *= -0.3; }
      if (boat) st[o + 3] += (Math.atan2(st[o], st[o + 1]) - st[o + 3]) * Math.min(1, Math.hypot(st[o], st[o + 1]) * 6 / this.U) * dt * 0.8;
      st[o + 2] = hx; G.par[o] = hz;
    }
    const x = G.pos[p], z = G.pos[p + 2], y = lake.heightAt(x, z) + (boat ? 0.004 * this.U : 0);
    // basis: up = the surface normal, heading around it
    const hx = st[o + 2], hz = G.par[o], il = 1 / Math.hypot(hx, 1, hz), ux = -hx * il, uy = il, uz = -hz * il;
    const cs = Math.cos(st[o + 3]), sn = Math.sin(st[o + 3]);
    let fx = sn, fy = 0, fz = cs; const dot = fx * ux + fz * uz; fx -= ux * dot; fy -= uy * dot; fz -= uz * dot;
    const fl = 1 / Math.hypot(fx, fy, fz); fx *= fl; fy *= fl; fz *= fl;
    const rx = uy * fz - uz * fy, ry = uz * fx - ux * fz, rz = ux * fy - uy * fx, sc = G.rs[i * 9 + 4];
    _c9.set([rx * sc, ry * sc, rz * sc, ux * sc, uy * sc, uz * sc, fx * sc, fy * sc, fz * sc]);
    mulAffine(this.lakeB, li * 16, _c9, 0, s.x + x, s.y + y, s.z + z, out, i * 16);
  }

  /** Loose boulders roll downhill (and off the edge) when the whale tips or surges. */
  private updateBoulders(c: EcoCtx) {
    const bm = this.boulderMesh; if (!bm) return;
    const { dt } = c, U = this.U, out = bm.instanceMatrix.array as Float32Array, G = 9 * U;
    this.boulders.forEach((b, i) => {
      if (b.fall > 0) {
        // over the edge: fall away in the whale's frame, then come back
        b.fall -= dt; b.v.addScaledVector(c.g, G * 1.5 * dt); b.v.x -= c.sig.x * G * dt; b.v.z -= c.sig.z * G * dt; b.p.addScaledVector(b.v, dt);
        if (b.fall <= 0) { b.wait = 6 + Math.random() * 8; b.grow = 0; b.p.copy(b.home); b.v.set(0, 0, 0); }
      } else if (b.wait > 0) { b.wait -= dt; } else {
        b.grow = Math.min(1, b.grow + dt * 1.5);
        const e = this.back.dx, x = b.p.x, z = b.p.z;
        const sx = (this.groundY(x + e, z) - this.groundY(x - e, z)) / (2 * e), sz = (this.groundY(x, z + e) - this.groundY(x, z - e)) / (2 * e);
        this.pointSig(c, x, b.p.y, z, _v);
        // along-ground pull: the ground's slope, the whale's tilt and its acceleration
        let ax = (-sx + c.g.x * 1.3 - _v.x * 0.9) * G, az = (-sz + c.g.z * 1.3 - _v.z * 0.9) * G;
        const sp = Math.hypot(b.v.x, b.v.z), pull = Math.hypot(ax, az);
        if (sp < 0.02 * U && pull < 0.33 * G) { ax = az = 0; b.v.set(0, 0, 0); }    // static friction
        b.v.x += ax * dt; b.v.z += az * dt; b.v.multiplyScalar(Math.exp(-0.9 * dt));
        const nx = x + b.v.x * dt, nz = z + b.v.z * dt;
        if (!this.lakeSpecs.every(l => Math.hypot(nx - l.x, nz - l.z) > l.r * 1.0 + b.r)) { b.v.multiplyScalar(-0.4); }
        else { b.p.x = nx; b.p.z = nz; }
        const gy = this.groundY(b.p.x, b.p.z);
        if (this.rnAt(b.p.x, b.p.z) > 0.99 || !Number.isFinite(gy)) { b.fall = 3; b.v.y = 0; }
        else b.p.y = gy + b.r * 0.8;
        if (sp > 1e-4) { _v.set(b.v.z, 0, -b.v.x).normalize(); b.q.premultiply(_q.setFromAxisAngle(_v, sp * dt / b.r)); }
      }
      this.skinAt(b.fall > 0 ? b.home.x : b.p.x, b.fall > 0 ? b.home.z : b.p.z, _B);
      const sc = b.r * 2 * b.grow * (b.wait > 0 ? 0 : 1);
      _mat.makeRotationFromQuaternion(b.q); const e = _mat.elements;
      _c9.set([e[0] * sc, e[1] * sc, e[2] * sc, e[4] * sc, e[5] * sc, e[6] * sc, e[8] * sc, e[9] * sc, e[10] * sc]);
      mulAffine(_B, 0, _c9, 0, b.p.x, b.p.y, b.p.z, out, i * 16);
    });
    bm.instanceMatrix.needsUpdate = true;
  }

  /** Waterfalls: a stream leaves each outlet, runs down its channel, over the edge, down the whale's flank and off. */
  private updateFalls(c: EcoCtx) {
    if (!this.falls.length) return;
    const { dt, k } = c, U = this.U, back = this.back;
    _mi.copy(c.M).invert(); _q.copy(c.q);
    const qi = _q.clone().invert();
    for (const f of this.falls) {
      const lake = f.lake, s = lake.spec, out = s.outlets[f.o], li = this.lakes.indexOf(lake), lava = s.kind === 'lava';
      const flow = lake.flow[f.o]; f.ribbon.flow = clamp(flow, 0, 1.3);
      const ex = out.dx * s.r * 0.95, ez = out.dz * s.r * 0.95, speed = U * (lava ? 0.7 : 1.25) * (0.6 + 0.5 * Math.min(1.2, flow));
      this.toSpace(c, li, ex, lake.heightAt(ex, ez), ez, _v);
      _v2.set(out.dx, 0, out.dz).applyQuaternion(_q).multiplyScalar(speed * k).add(c.vel);
      const vel = c.vel, rnAt = (x: number, z: number) => this.rnAt(x, z);
      // the whale drags the air around it along, so the falls drop down its side rather than streaming away behind
      _air.copy(vel).multiplyScalar(0.92);
      f.ribbon.step(dt, _v, _v2, k, _air, (P, V, o) => {
        // collide in the whale's frame: the channel bed while on the island, then the flank
        _v3.set(P[o], P[o + 1], P[o + 2]).applyMatrix4(_mi);
        const lv = _tmpV.set(V[o] - vel.x, V[o + 1] - vel.y, V[o + 2] - vel.z).divideScalar(k).applyQuaternion(qi);
        let hit = false;
        if (rnAt(_v3.x, _v3.z) < 1) {
          const gy = this.groundY(_v3.x, _v3.z) + 0.012 * U;
          if (_v3.y < gy) { _v3.y = gy; lv.x = out.dx * speed; lv.z = out.dz * speed * 0.2; lv.y = Math.max(lv.y, -0.2 * speed); hit = true; }
        } else {
          const j = back.row(_v3.z), W = back.halfW[j] * 1.03, yc = back.eqY[j], Ht = Math.max(0.05, back.topY[j] - yc) * 1.03;
          if (_v3.y > yc - Ht * 0.15) {
            const nx = _v3.x / W, ny = Math.max(-0.2, (_v3.y - yc) / Ht), e = nx * nx + ny * ny;
            if (e < 1) {
              const sc = 1 / Math.sqrt(Math.max(e, 1e-4)); _v3.x = nx * sc * W; _v3.y = yc + ny * sc * Ht;
              // slide: drop the velocity into the body
              let gx = nx / W, gyn = ny / Ht; const gl = Math.hypot(gx, gyn) || 1; gx /= gl; gyn /= gl;
              const vn = lv.x * gx + lv.y * gyn; if (vn < 0) { lv.x -= vn * gx; lv.y -= vn * gyn; }
              lv.multiplyScalar(Math.exp(-1.5 * dt)); hit = true;
            }
          }
        }
        if (hit) {
          _v3.applyMatrix4(c.M); P[o] = _v3.x; P[o + 1] = _v3.y; P[o + 2] = _v3.z;
          lv.applyQuaternion(_q).multiplyScalar(k); V[o] = lv.x + vel.x; V[o + 1] = lv.y + vel.y; V[o + 2] = lv.z + vel.z;
        }
      });
      // spray where the stream breaks up
      f.mistAcc += dt * (this.full ? 26 : 7) * Math.min(1.2, flow);
      const K = f.ribbon.o.nodes, P = f.ribbon.pos, V = f.ribbon.vel;
      while (f.mistAcc >= 1) {
        f.mistAcc -= 1;
        const n = Math.floor(K * (0.45 + Math.random() * 0.5)) * 3, j = U * k * 0.5;
        this.puffs.emit(P[n], P[n + 1], P[n + 2], V[n] * 0.8 + (Math.random() - 0.5) * j, V[n + 1] * 0.6, V[n + 2] * 0.8 + (Math.random() - 0.5) * j,
          { life: 1.1 + Math.random() * 0.8, size: s.r * (0.3 + Math.random() * 0.35) * k, grow: 2.2, alpha: lava ? 0.5 : 0.3, drag: 1.3, gravity: (lava ? 0.6 : -1.2) * U * k,
            color: _tmpC.set(lava ? '#ff7a1a' : s.foam), glow: lava ? 1 : 0 });
      }
    }
  }

  /** Chimney smoke, the island's own rain cloud, and fireflies at night. */
  private updateWeather(c: EcoCtx) {
    const { dt, k } = c, U = this.U;
    if (this.full && this.smokes.length) {
      this.smokeAcc += dt * 7;
      while (this.smokeAcc >= 1) {
        this.smokeAcc -= 1;
        for (const s of this.smokes) {
          this.skinAt(s.p.x, s.p.z, _B);
          _v.copy(s.p).applyMatrix4(_mat.fromArray(_B)).applyMatrix4(c.M);
          _v2.set((Math.random() - 0.5) * 0.1, 0.42, (Math.random() - 0.5) * 0.1).multiplyScalar(U * k).transformDirection(c.M).multiplyScalar(0.42 * U * k).add(c.vel);
          this.puffs.emit(_v.x, _v.y, _v.z, _v2.x, _v2.y, _v2.z, { life: 2.6, size: 0.07 * U * k, grow: 3.5, alpha: 0.32, drag: 0.7, gravity: 0.25 * U * k,
            color: _tmpC.setRGB(0.62, 0.6, 0.6).lerp(_tmpC2.setRGB(1, 0.55, 0.25), c.night * 0.25) });
        }
      }
    }
    const rain = Math.max(c.storm, this.genome.cloud ? 0.55 : 0);
    if (rain > 0.3) {
      // the cloud trails the island on a soft leash
      _v.set(0, this.top + 1.5 * U, this.cz).applyMatrix4(c.M);
      if (!this.cloudInit) { this.cloudPos.copy(_v); this.cloudInit = true; }
      this.cloudPos.lerp(_v, 1 - Math.exp(-dt * 1.6));
      const dark = lerp(0.95, 0.42, c.storm) * lerp(1, 0.45, c.night), snow = this.bio.liquid === 'ice';
      this.cloudAcc += dt * (this.full ? 16 : 6) * rain;
      while (this.cloudAcc >= 1) {
        this.cloudAcc -= 1;
        _v2.set((Math.random() - 0.5) * this.hw * 2.2, (Math.random() - 0.5) * 0.35 * U, (Math.random() - 0.5) * this.hl * 1.5).multiplyScalar(k).transformDirection(c.M)
          .multiplyScalar(Math.hypot(this.hw, this.hl) * k * Math.random() * 0.8).add(this.cloudPos);
        this.puffs.emit(_v2.x, _v2.y, _v2.z, c.vel.x, c.vel.y, c.vel.z, { life: 2.8, size: (0.75 + Math.random() * 0.6) * U * k, grow: 0.5, alpha: 0.42, drag: 0.25, color: _tmpC.setRGB(dark, dark, dark * 1.04) });
        if (this.full || Math.random() < 0.5) for (let i = 0; i < 3; i++) {
          _v3.copy(_v2); _v3.x += (Math.random() - 0.5) * U * k; _v3.z += (Math.random() - 0.5) * U * k;
          this.puffs.emit(_v3.x, _v3.y - 0.2 * U * k, _v3.z, c.vel.x, c.vel.y - (snow ? 0.7 : 3.2) * U * k, c.vel.z,
            { life: snow ? 1.9 : 0.5, size: (snow ? 0.045 : 0.03) * U * k, alpha: snow ? 0.9 : 0.6, drag: snow ? 0.8 : 0, gravity: (snow ? -0.3 : -5) * U * k, color: _tmpC.set(snow ? '#ffffff' : '#cfe6f6') });
        }
      }
    } else this.cloudInit = false;
    if (this.bio.nightFlies && c.night > 0.45) {
      this.flyAcc += dt * (this.full ? 14 : 4) * c.night;
      while (this.flyAcc >= 1) {
        this.flyAcc -= 1;
        const x = (Math.random() * 2 - 1) * this.hw * 0.9, z = this.cz + (Math.random() * 2 - 1) * this.hl * 0.9, y = this.groundY(x, z);
        if (!Number.isFinite(y)) continue;
        _v.set(x, y + (0.1 + Math.random() * 0.7) * U, z).applyMatrix4(c.M);
        this.glow.emit(_v.x, _v.y, _v.z, c.vel.x + (Math.random() - 0.5) * 0.3 * U * k, c.vel.y + (Math.random() - 0.3) * 0.2 * U * k, c.vel.z + (Math.random() - 0.5) * 0.3 * U * k,
          { life: 2.5 + Math.random() * 2, size: 0.05 * U * k, alpha: 0.9, drag: 0, color: _tmpC.set(this.bio.nightFlies), glow: 1 });
      }
    }
  }

  /** After a teleport: forget the trails. */
  resetMotion() { for (const f of this.falls) f.ribbon.reset(); this.cloudInit = false; this.fauna?.reset(); }

  dispose() {
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
    this.fx.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
}

const _tmpC = new THREE.Color(), _tmpC2 = new THREE.Color(), _tmpV = new THREE.Vector3(), _air = new THREE.Vector3();
