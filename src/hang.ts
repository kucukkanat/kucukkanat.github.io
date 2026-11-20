// Hanging things inside the rolling cabin: rigid pendulums (Bell, Hanging_lamp, every SWING_*), the bell's clapper,
// and skinned ropes (ROPE_<name> with bones ROPE_<name>_0 … _N). See docs/SCENE_CONTRACT.md, "Physics round additions".
//
// The scene's world frame IS the cabin frame (the cabin never moves; the sky turns the other way). Every frame
// ShipMotion.gEff() gives the effective gravity there: g tilted by the ship's attitude minus the inertial acceleration
// of the point (roll/pitch about a centre above the gondola, heave, turbulence). Everything here is position-based
// (Verlet) at a fixed 120 Hz with ≤ 4 substeps per frame, allocation-free in the loop. Reduced motion: nothing moves.
import * as THREE from 'three';
import type { ShipMotion } from './ship';
import { reducedMotion } from './anim';

const H = 1 / 120;
const MAX_STEPS = 4;
const DOWN = new THREE.Vector3(0, -1, 0);
/** Air drag on rigid pendulums (1/s): a free swing settles over ~15 s. */
const AIR = 0.35;
const ROPE_AIR = 0.9;
const BELL_YOKE = 3.5;
const ROPE_ITER = 8;

// scratch (never allocated in the loop)
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qa = new THREE.Quaternion();

interface Plane { n: THREE.Vector3; d: number; }

interface Rigid {
  obj: THREE.Object3D;
  home: THREE.Quaternion;
  /** parent world rotation (parents are static), and its inverse */
  pq: THREE.Quaternion; pqi: THREE.Quaternion;
  pivot: THREE.Vector3;
  /** equivalent (compound) pendulum length */
  L: number;
  x: THREE.Vector3; xp: THREE.Vector3;
  g: THREE.Vector3;
  /** wind response (lamps catch a little draught, a bronze bell none) */
  windK: number;
  /** damping (1/s): air for free-hanging things; a bell's yoke has friction */
  air: number;
  plane: Plane | null; radius: number;
  /** current swing rotation (world) */
  q: THREE.Quaternion;
}

interface Clapper {
  obj: THREE.Object3D;
  home: THREE.Quaternion;
  /** clapper pivot relative to the bell pivot (rest, world) */
  rel: THREE.Vector3;
  L: number;
  /** half-angle of the cone the clapper can swing in before it hits the rim */
  limit: number;
  x: THREE.Vector3; xp: THREE.Vector3;
  /** the bell's rest world rotation (bell.parent world · bell.home) */
  bellRestQ: THREE.Quaternion; bellRestQi: THREE.Quaternion;
  lastStrike: number;
  quietUntil: number;
}

interface Rope {
  name: string;
  bones: THREE.Bone[];
  chain: boolean;
  n: number;
  x: Float32Array; xp: Float32Array; rest: Float32Array; len: Float32Array;
  pinnedEnd: boolean;
  restQ: THREE.Quaternion[];
  restDir: THREE.Vector3[];
  /** rotation of bone 0's parent (static) inverse; for non-chain rigs every bone's parent inverse */
  parentQi: THREE.Quaternion[];
  mid: THREE.Vector3;
  g: THREE.Vector3;
  plane: Plane | null;
  phase: number;
  wq: THREE.Quaternion[];
  /** a pinned end tied to a swinging block (SWING_*): it rides along with the block's swing */
  att0: Rigid | null; off0: THREE.Vector3;
  attEnd: Rigid | null; offEnd: THREE.Vector3;
}

export interface HangOptions {
  bell?: THREE.Object3D;
  clapper?: THREE.Object3D;
  lamp?: THREE.Object3D;
  /** the clapper struck the rim: gain 0..1 */
  strike?: (gain: number) => void;
}

export class Hanging {
  rigids: Rigid[] = [];
  ropes: Rope[] = [];
  clapper: Clapper | null = null;
  private bell: Rigid | null = null;
  private acc = 0;
  private time = 0;
  private wind = new THREE.Vector3();
  private stat = { sum: 0, max: 0, n: 0, steps: 0, t0: 0 };
  /** last reported stats window (ms per frame) */
  lastStats = { avg: 0, max: 0, frames: 0, steps: 0 };
  strikes = 0;

  constructor(private root: THREE.Object3D, private opts: HangOptions = {}) {
    root.updateWorldMatrix(true, true);
    const blockers = this.blockers();
    // the bell swings stiffly in its yoke (friction), so its free clapper knocks about inside it in rough air
    if (opts.bell) this.bell = this.addRigid(opts.bell, 0, BELL_YOKE, blockers);
    if (opts.lamp) this.addRigid(opts.lamp, 0.25, AIR, blockers);
    root.traverse(o => { if (/^SWING_/.test(o.name) && !(o as THREE.Bone).isBone) this.addRigid(o, 0.6, AIR, blockers); });
    if (this.bell && opts.clapper) this.addClapper(this.bell, opts.clapper);
    this.findRopes(blockers);
    for (const r of this.ropes) this.attachRope(r);
    // let everything find its equilibrium before the first frame (no start-up twitch)
    for (const r of this.ropes) { for (let i = 0; i < 360; i++) this.stepRope(r, 6); this.writeRope(r); }
  }

  get count() { return { rigid: this.rigids.length, ropes: this.ropes.length, bones: this.ropes.reduce((a, r) => a + r.n, 0), clapper: !!this.clapper }; }

  /** Ring the bell by hand: a push about its own swing axis (local X). The caller plays the sound. */
  ring(strength = 1) {
    const b = this.bell;
    if (!b || reducedMotion) return;
    // tangent = the bell's local +Z in the world
    _v.set(0, 0, 1).applyQuaternion(_q.copy(b.pq).multiply(b.home));
    _v.addScaledVector(_d.subVectors(b.x, b.pivot).normalize(), -_v.dot(_d)).normalize();
    b.xp.addScaledVector(_v, -1.9 * b.L * strength * H);
    if (this.clapper) this.clapper.quietUntil = this.time + 1.4;
  }

  update(dt: number, ship: ShipMotion) {
    if (reducedMotion || document.hidden) return;
    const t0 = performance.now();
    this.acc = Math.min(this.acc + dt, MAX_STEPS * H);
    let steps = 0;
    if (this.acc >= H) {
      // forcing for this frame (constant over its substeps)
      for (const r of this.rigids) ship.gEff(r.pivot, r.g);
      for (const r of this.ropes) ship.gEff(r.mid, r.g);
      // a draught through the open, leaky cabin while gusts blow: in from the windows (−Z), leaning with the gust
      const gw = ship.gust * ship.amp;
      this.wind.set(1.6 * ship.gustDir * gw, 0.15 * gw, 2.2 * gw);
      while (this.acc >= H) {
        this.acc -= H; this.time += H; steps++;
        for (const r of this.rigids) this.stepRigid(r);
        if (this.clapper && this.bell) this.stepClapper(this.clapper, this.bell);
        for (const r of this.ropes) this.stepRope(r, ROPE_AIR);
      }
      for (const r of this.rigids) this.writeRigid(r);
      if (this.clapper && this.bell) this.writeClapper(this.clapper, this.bell);
      for (const r of this.ropes) this.writeRope(r);
    }
    const ms = performance.now() - t0;
    const s = this.stat;
    s.sum += ms; s.n++; s.steps += steps; if (ms > s.max) s.max = ms;
    if (t0 - s.t0 > 3000) {
      s.t0 = t0;
      this.lastStats = { avg: s.sum / s.n, max: s.max, frames: s.n, steps: s.steps / s.n };
      s.sum = s.max = s.n = s.steps = 0;
    }
  }

  // ------------------------------------------------------------------ rigid pendulums
  private addRigid(obj: THREE.Object3D, windK: number, air: number, blockers: THREE.Object3D[]): Rigid {
    obj.updateWorldMatrix(true, true);
    const pivot = obj.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.isEmpty() ? pivot.clone().add(new THREE.Vector3(0, -0.2, 0)) : box.getCenter(new THREE.Vector3());
    const size = box.isEmpty() ? new THREE.Vector3(0.2, 0.2, 0.2) : box.getSize(new THREE.Vector3());
    const ud = obj.userData as { length?: number };
    const d = Math.max(0.04, typeof ud.length === 'number' && ud.length > 0 ? ud.length : c.distanceTo(pivot));
    // compound pendulum: L_eq = d + k²/d, radius of gyration k ≈ 0.3 × the object's size
    const k = 0.3 * Math.max(size.x, size.y, size.z);
    const L = d + (k * k) / d;
    const pq = obj.parent ? obj.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const x = pivot.clone().addScaledVector(DOWN, L);
    const radius = Math.max(size.x, size.z) / 2;
    const r: Rigid = {
      obj, home: obj.quaternion.clone(), pq, pqi: pq.clone().invert(), pivot, L, x, xp: x.clone(), g: new THREE.Vector3(0, -9.81, 0),
      windK, air, radius, plane: null, q: new THREE.Quaternion(),
    };
    // the wall behind: probe from the centre of mass; the bob (at L_eq along the hang line) keeps clear of it
    const probe = pivot.clone().addScaledVector(DOWN, Math.min(d, L));
    r.plane = wallPlane(probe, blockers, obj, [probe], radius * 0.8);
    if (r.plane) { // express it for the bob point (scaled along the hang line)
      const s = L / Math.max(d, 1e-3);
      const pn = r.plane.n.dot(pivot);
      r.plane.d = pn + (r.plane.d - pn) * s;
      r.plane.d = Math.min(r.plane.d, r.plane.n.dot(x) - 1e-4);
    }
    this.rigids.push(r);
    return r;
  }

  private stepRigid(r: Rigid) {
    // Verlet: x' = x + (x − xp)(1 − c·h) + a·h²; then back onto the sphere |x − pivot| = L (exact, no small-angle)
    _v.subVectors(r.x, r.xp).multiplyScalar(1 - r.air * H);
    r.xp.copy(r.x);
    r.x.add(_v).addScaledVector(r.g, H * H);
    if (r.windK) r.x.addScaledVector(this.wind, r.windK * H * H);
    _d.subVectors(r.x, r.pivot).normalize();
    r.x.copy(r.pivot).addScaledVector(_d, r.L);
    if (r.plane) {
      const s = r.plane.n.dot(r.x) - r.plane.d;
      if (s < 0) {
        r.x.addScaledVector(r.plane.n, -s);
        _d.subVectors(r.x, r.pivot).normalize();
        r.x.copy(r.pivot).addScaledVector(_d, r.L);
        // a dull knock: lose most of the velocity into the wall
        r.xp.lerp(r.x, 0.6);
      }
    }
  }

  private writeRigid(r: Rigid) {
    _d.subVectors(r.x, r.pivot).normalize();
    r.q.setFromUnitVectors(DOWN, _d);
    // local = P⁻¹ · q · P · home
    r.obj.quaternion.copy(r.pqi).multiply(r.q).multiply(r.pq).multiply(r.home);
  }

  // ------------------------------------------------------------------ clapper
  private addClapper(bell: Rigid, obj: THREE.Object3D) {
    obj.updateWorldMatrix(true, true);
    const pivot = obj.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(obj);
    const reach = box.isEmpty() ? 0.12 : Math.max(0.03, pivot.y - box.min.y);
    const L = Math.max(0.03, reach * 0.8);
    // rim clearance: the bell's inner radius near the clapper's ball
    const bb = new THREE.Box3();
    bell.obj.traverse(o => { if ((o as THREE.Mesh).isMesh && !isInside(o, obj)) bb.expandByObject(o); });
    const rim = bb.isEmpty() ? 0.06 : Math.min(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    const limit = THREE.MathUtils.clamp(Math.atan2(rim * 0.75, reach), 0.12, 0.5);
    const bellRestQ = bell.pq.clone().multiply(bell.home);
    const x = pivot.clone().addScaledVector(DOWN, L);
    this.clapper = {
      obj, home: obj.quaternion.clone(), rel: pivot.clone().sub(bell.pivot), L, limit, x, xp: x.clone(),
      bellRestQ, bellRestQi: bellRestQ.clone().invert(), lastStrike: -10, quietUntil: 0,
    };
  }

  private stepClapper(c: Clapper, b: Rigid) {
    // the bell's current swing rotation (from its bob) carries the clapper's pivot round with it
    _d.subVectors(b.x, b.pivot).normalize();
    _qa.setFromUnitVectors(DOWN, _d);
    const pivot = _w.copy(c.rel).applyQuaternion(_qa).add(b.pivot);
    _v.subVectors(c.x, c.xp).multiplyScalar(1 - 0.25 * H);
    c.xp.copy(c.x);
    c.x.add(_v).addScaledVector(b.g, H * H);
    _n.subVectors(c.x, pivot).normalize();
    // cone about the bell's axis (_d): beyond `limit` the ball hits the rim
    const cos = _n.dot(_d);
    if (cos < Math.cos(c.limit)) {
      // outward direction (perpendicular to the bell axis, toward the clapper)
      const out = _v.copy(_n).addScaledVector(_d, -cos);
      if (out.lengthSq() < 1e-10) out.set(1, 0, 0);
      out.normalize();
      const vOut = (c.x.x - c.xp.x) * out.x + (c.x.y - c.xp.y) * out.y + (c.x.z - c.xp.z) * out.z;
      // back onto the cone surface
      _n.copy(_d).multiplyScalar(Math.cos(c.limit)).addScaledVector(out, Math.sin(c.limit));
      c.x.copy(pivot).addScaledVector(_n, c.L);
      if (vOut > 0) {
        // bounce (restitution 0.35): the relative outward speed is reversed
        c.xp.copy(c.x).addScaledVector(out, vOut * 0.35);
        const speed = vOut / H; // m/s
        if (speed > 0.12 && this.time - c.lastStrike > 0.22 && this.time >= c.quietUntil) {
          c.lastStrike = this.time;
          this.strikes++;
          this.opts.strike?.(Math.min(1, (speed - 0.08) / 0.9));
        }
      }
    } else c.x.copy(pivot).addScaledVector(_n, c.L);
  }

  private writeClapper(c: Clapper, b: Rigid) {
    // world rotation wanted: swing(dc) · bellRest · home  → local (in the bell) = (b.q · bellRest)⁻¹ · swing · bellRest · home
    _d.subVectors(b.x, b.pivot).normalize();
    _qa.setFromUnitVectors(DOWN, _d);
    const pivot = _w.copy(c.rel).applyQuaternion(_qa).add(b.pivot);
    _n.subVectors(c.x, pivot).normalize();
    _q.setFromUnitVectors(DOWN, _n);
    _q2.copy(_qa).invert().multiply(_q);
    c.obj.quaternion.copy(c.bellRestQi).multiply(_q2).multiply(c.bellRestQ).multiply(c.home);
  }

  // ------------------------------------------------------------------ ropes
  private findRopes(blockers: THREE.Object3D[]) {
    const groups = new Map<string, THREE.Bone[]>();
    this.root.traverse(o => {
      const m = (o as THREE.Bone).isBone ? /^ROPE_(.+)_(\d+)$/.exec(o.name) : null;
      if (!m) return;
      const list = groups.get(m[1]) ?? [];
      list[Number(m[2])] = o as THREE.Bone;
      groups.set(m[1], list);
    });
    for (const [name, raw] of groups) {
      const bones = raw.filter(Boolean);
      if (bones.length < 2) continue;
      let pinnedEnd = false;
      const meshes: THREE.SkinnedMesh[] = [];
      this.root.traverse(o => {
        if (o.name === `ROPE_${name}` || o.name.startsWith(`ROPE_${name}.`) || o.name.startsWith(`ROPE_${name}_mesh`)) {
          if (Number((o.userData as { pinned_end?: unknown }).pinned_end) === 1 || (o.userData as { pinned_end?: unknown }).pinned_end === true) pinnedEnd = true;
        }
        const sm = o as THREE.SkinnedMesh;
        if (sm.isSkinnedMesh && sm.skeleton?.bones.includes(bones[0])) { meshes.push(sm); if (Number((sm.userData as { pinned_end?: unknown }).pinned_end) === 1) pinnedEnd = true; }
      });
      // a skinned mesh's bounds are its bind pose: never cull a swinging rope
      for (const m of meshes) m.frustumCulled = false;
      this.ropes.push(this.makeRope(name, bones, pinnedEnd, blockers, meshes));
    }
  }

  private makeRope(name: string, bones: THREE.Bone[], pinnedEnd: boolean, blockers: THREE.Object3D[], meshes: THREE.Object3D[]): Rope {
    const n = bones.length;
    const x = new Float32Array(n * 3), rest = new Float32Array(n * 3), len = new Float32Array(n - 1);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const p = bones[i].getWorldPosition(new THREE.Vector3());
      pts.push(p);
      x[i * 3] = p.x; x[i * 3 + 1] = p.y; x[i * 3 + 2] = p.z;
    }
    rest.set(x);
    for (let i = 0; i < n - 1; i++) len[i] = Math.max(1e-4, pts[i].distanceTo(pts[i + 1]));
    const restQ = bones.map(b => b.getWorldQuaternion(new THREE.Quaternion()));
    const restDir = bones.map((_, i) => (i < n - 1 ? pts[i + 1].clone().sub(pts[i]).normalize() : pts[i].clone().sub(pts[i - 1]).normalize()));
    const chain = bones.every((b, i) => i === 0 || b.parent === bones[i - 1]);
    const parentQi = bones.map(b => (b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion()));
    const mid = new THREE.Vector3();
    for (const p of pts) mid.add(p);
    mid.divideScalar(n);
    const hang = pts.slice(1, pinnedEnd ? n - 1 : n);
    const plane = hang.length ? wallPlane(mid, blockers, null, hang, 0.025, meshes) : null;
    return {
      name, bones, chain, n, x, xp: x.slice(), rest, len, pinnedEnd, restQ, restDir, parentQi, mid,
      g: new THREE.Vector3(0, -9.81, 0), plane, phase: Math.random() * 10, wq: bones.map(() => new THREE.Quaternion()),
      att0: null, off0: new THREE.Vector3(), attEnd: null, offEnd: new THREE.Vector3(),
    };
  }

  /** Tie a rope's pinned end to a block it hangs from: just below a SWING_ pivot (≤ 35 cm down, ≤ 10 cm aside). */
  private attachRope(r: Rope) {
    const find = (k: number) => {
      const p = new THREE.Vector3(r.rest[k], r.rest[k + 1], r.rest[k + 2]);
      for (const g of this.rigids) {
        if (!/^SWING_/.test(g.obj.name)) continue;
        const below = g.pivot.y - p.y, aside = Math.hypot(g.pivot.x - p.x, g.pivot.z - p.z);
        if (below > 0 && below < 0.35 && aside < 0.1) return { g, off: p.sub(g.pivot) };
      }
      return null;
    };
    const a = find(0);
    if (a) { r.att0 = a.g; r.off0.copy(a.off); }
    if (r.pinnedEnd) { const e = find((r.n - 1) * 3); if (e) { r.attEnd = e.g; r.offEnd.copy(e.off); } }
  }

  /** Where a pinned end is now: its rest point, or carried round by the block's current swing. */
  private pinAt(x: Float32Array, k: number, rest: Float32Array, g: Rigid | null, off: THREE.Vector3) {
    if (!g) { x[k] = rest[k]; x[k + 1] = rest[k + 1]; x[k + 2] = rest[k + 2]; return; }
    _d.subVectors(g.x, g.pivot).normalize();
    _q2.setFromUnitVectors(DOWN, _d);
    _w.copy(off).applyQuaternion(_q2).add(g.pivot);
    x[k] = _w.x; x[k + 1] = _w.y; x[k + 2] = _w.z;
  }

  private stepRope(r: Rope, air: number) {
    const { x, xp, n, rest, len } = r;
    const keep = 1 - air * H;
    const gx = r.g.x * H * H, gy = r.g.y * H * H, gz = r.g.z * H * H;
    const wx = this.wind.x * H * H, wy = this.wind.y * H * H, wz = this.wind.z * H * H;
    const t = this.time + r.phase;
    const last = r.pinnedEnd ? n - 1 : n;
    for (let i = 1; i < last; i++) {
      const k = i * 3;
      // the draught pushes the free end more, and flutters
      const f = (i / (n - 1)) * (0.75 + 0.45 * Math.sin(t * 6.3 + i * 0.9) + 0.25 * Math.sin(t * 11.7 + i * 2.1));
      const vx = (x[k] - xp[k]) * keep, vy = (x[k + 1] - xp[k + 1]) * keep, vz = (x[k + 2] - xp[k + 2]) * keep;
      xp[k] = x[k]; xp[k + 1] = x[k + 1]; xp[k + 2] = x[k + 2];
      x[k] += vx + gx + wx * f; x[k + 1] += vy + gy + wy * f; x[k + 2] += vz + gz + wz * f;
    }
    // pinned ends: fixed, or riding on the block they hang from
    this.pinAt(x, 0, rest, r.att0, r.off0);
    if (r.pinnedEnd) this.pinAt(x, (n - 1) * 3, rest, r.attEnd, r.offEnd);
    const pl = r.plane;
    for (let it = 0; it < ROPE_ITER; it++) {
      for (let i = 0; i < n - 1; i++) {
        const a = i * 3, b = a + 3;
        const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - len[i]) / d;
        const wa = i === 0 ? 0 : 1, wb = r.pinnedEnd && i + 1 === n - 1 ? 0 : 1;
        const ws = wa + wb;
        if (!ws) continue;
        const sa = (diff * wa) / ws, sb = (diff * wb) / ws;
        x[a] += dx * sa; x[a + 1] += dy * sa; x[a + 2] += dz * sa;
        x[b] -= dx * sb; x[b + 1] -= dy * sb; x[b + 2] -= dz * sb;
      }
      if (pl) for (let i = 1; i < last; i++) {
        const k = i * 3;
        const s = pl.n.x * x[k] + pl.n.y * x[k + 1] + pl.n.z * x[k + 2] - pl.d;
        if (s < 0) { x[k] -= pl.n.x * s; x[k + 1] -= pl.n.y * s; x[k + 2] -= pl.n.z * s; }
      }
    }
  }

  /** Each bone aims at the next particle: minimal rotation from its rest direction (no twist build-up). */
  private writeRope(r: Rope) {
    const { x, n, bones, restQ, restDir, wq } = r;
    for (let i = 0; i < n; i++) {
      const s = i < n - 1 ? i : n - 2;
      const a = s * 3;
      _d.set(x[a + 3] - x[a], x[a + 4] - x[a + 1], x[a + 5] - x[a + 2]).normalize();
      _q.setFromUnitVectors(restDir[i], _d);
      wq[i].copy(_q).multiply(restQ[i]);
      const b = bones[i];
      if (r.chain && i > 0) b.quaternion.copy(wq[i - 1]).invert().multiply(wq[i]);
      else {
        b.quaternion.copy(r.parentQi[i]).multiply(wq[i]);
        if (i > 0 && b.parent) { _v.set(x[i * 3], x[i * 3 + 1], x[i * 3 + 2]); b.position.copy(b.parent.worldToLocal(_v)); }
      }
    }
  }

  // ------------------------------------------------------------------ setup helpers
  /** Static cabin geometry a hanging thing can bump into (walls, posts); not other hanging things or hit boxes. */
  private blockers() {
    const out: THREE.Object3D[] = [];
    this.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || !m.visible) return;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) {
        if (/^(HIT_|ROPE_|SWING_|Bell|Hanging_lamp|VP_)/.test(p.name)) return;
      }
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every(x => !x.visible)) return;
      out.push(m);
    });
    return out;
  }
}

function isInside(o: THREE.Object3D, anc: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === anc) return true;
  return false;
}

/**
 * The wall behind a hanging thing: probe horizontally (±X, ±Z) from `from`; the nearest surface within 0.9 m becomes
 * a plane facing into the room. Shifted so that every rest point already satisfies it.
 */
const ray = new THREE.Raycaster();
function wallPlane(from: THREE.Vector3, blockers: THREE.Object3D[], self: THREE.Object3D | null, restPts: THREE.Vector3[], radius: number, skip: THREE.Object3D[] = []): Plane | null {
  if (!blockers.length) return null;
  let best: Plane | null = null, bestD = 0.9;
  const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  ray.far = bestD;
  for (const dir of dirs) {
    ray.set(from, dir);
    const hit = ray.intersectObjects(blockers, false).find(h => !(self && isInside(h.object, self)) && !skip.some(s => isInside(h.object, s)));
    if (hit && hit.distance < bestD) {
      bestD = hit.distance;
      const n = dir.clone().negate();
      best = { n, d: n.dot(hit.point) + radius };
    }
  }
  if (best) for (const p of restPts) best.d = Math.min(best.d, best.n.dot(p) - 1e-4);
  return best;
}

/**
 * Debug (?testrope=1): stand-in rigs until cabin.glb has its own — a free rope, a rope tied at both ends
 * (pinned_end) and a SWING_ block, all following the scene contract's naming.
 */
export function addTestRigs(scene: THREE.Scene) {
  const mat = new THREE.MeshStandardMaterial({ color: '#c9a777', roughness: 1 });
  const rope = (name: string, pts: THREE.Vector3[], pinnedEnd: boolean) => {
    const n = pts.length;
    const curve = new THREE.CatmullRomCurve3(pts);
    const segs = (n - 1) * 6;
    const geo = new THREE.TubeGeometry(curve, segs, 0.012, 6, false);
    const pos = geo.attributes.position;
    const idx: number[] = [], wts: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const u = Math.floor(i / 7) / segs;
      const s = Math.min(n - 1.0001, u * (n - 1));
      const b = Math.floor(s), f = s - b;
      idx.push(b, Math.min(n - 1, b + 1), 0, 0); wts.push(1 - f, f, 0, 0);
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    const bones: THREE.Bone[] = [];
    pts.forEach((p, i) => {
      const b = new THREE.Bone();
      b.name = `ROPE_${name}_${i}`;
      if (i === 0) b.position.copy(p); else { b.position.copy(p).sub(pts[i - 1]); bones[i - 1].add(b); }
      bones.push(b);
    });
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = `ROPE_${name}`;
    if (pinnedEnd) mesh.userData.pinned_end = 1;
    mesh.add(bones[0]);
    mesh.bind(new THREE.Skeleton(bones));
    scene.add(mesh);
  };
  const free: THREE.Vector3[] = [];
  for (let i = 0; i < 9; i++) free.push(new THREE.Vector3(1.35, 2.8 - i * 0.14, -1.55));
  rope('test_free', free, false);
  const span: THREE.Vector3[] = [];
  for (let i = 0; i < 10; i++) { const u = i / 9; span.push(new THREE.Vector3(-1.0 + u * 1.3, 2.75 - 0.3 * 4 * u * (1 - u), -1.2 - 0.2 * u)); }
  rope('test_span', span, true);
  const block = new THREE.Group();
  block.name = 'SWING_test_block';
  block.position.set(-0.55, 2.8, -0.5);
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.42, 5), mat);
  line.position.y = -0.21;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.06), new THREE.MeshStandardMaterial({ color: '#6b4126', roughness: 0.8 }));
  body.position.y = -0.48;
  block.add(line, body);
  block.userData.length = 0.48;
  scene.add(block);
}
