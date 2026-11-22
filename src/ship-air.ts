// Things the air moves on the galleon (ship-rig.ts drives them): the flags and pennants as cloth (Verlet point masses
// held by their edges, pinned at the hoist), and the lookout kite on a springy line from the main top.
//
// Everything is simulated in the ship model's own space (+X bow, +Y up, metres). The ship itself never moves on
// screen (the world turns and slides past it, outside.ts), so the air and the ship's own motion come in as:
//   wind      apparent wind = the true wind (a breeze with gusts, fixed in the world) − the ship's velocity
//   gravity   world down, which leans as the ship rolls and pitches
//   inertia   the world's rotation since the last frame turns free things with it (they lag the ship's turns),
//             and the ship's acceleration pushes them aft / down when it speeds up or climbs
//
// The web model's positions are quantised (normalised int16): cloth gets a float copy before it is moved.

import * as THREE from 'three';

const { clamp } = THREE.MathUtils;

export interface AirInput {
  dt: number;
  t: number;
  /** The outside world's rotation in the scene (outside.ts world.quaternion). */
  worldQ: THREE.Quaternion;
  /** Ship speed ahead (m/s) and climb rate (m/s). */
  speed: number;
  climb: number;
}

/** Give a mesh float positions (the web model's are normalised int16), keeping the values. */
export function floatPositions(mesh: THREE.Mesh) {
  mesh.geometry = mesh.geometry.clone();
  const src = mesh.geometry.attributes.position as THREE.BufferAttribute;
  if (src.array instanceof Float32Array && !src.normalized) return src;
  const a = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) { a[i * 3] = src.getX(i); a[i * 3 + 1] = src.getY(i); a[i * 3 + 2] = src.getZ(i); }
  const attr = new THREE.BufferAttribute(a, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.setAttribute('position', attr);
  return attr;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();

/** World-frame quantities turned into the ship's space, once per frame. */
export class AirFrame {
  readonly wind = new THREE.Vector3();     // apparent wind (m/s)
  readonly down = new THREE.Vector3(0, -1, 0);
  readonly accel = new THREE.Vector3();    // ship acceleration (m/s²)
  readonly turn = new THREE.Quaternion();  // how the free air turned (ship space) since the last frame
  readonly side = new THREE.Vector3();     // across the wind, horizontal
  gust = 1;
  t = 0;
  private prevQ: THREE.Quaternion | null = null;
  private prevVel = new THREE.Vector3();
  private shipQ = new THREE.Quaternion();
  private shipQi = new THREE.Quaternion();

  constructor(private root: THREE.Object3D) {}

  update(c: AirInput) {
    this.t = c.t;
    this.root.getWorldQuaternion(this.shipQ);
    this.shipQi.copy(this.shipQ).invert();
    const toShip = (v: THREE.Vector3) => v.applyQuaternion(c.worldQ).applyQuaternion(this.shipQi);
    // a breeze from the world's north-west, in slow gusts
    this.gust = 1 + 0.35 * Math.sin(c.t * 0.37) * Math.sin(c.t * 0.13 + 1) + 0.15 * Math.sin(c.t * 1.7);
    const trueWind = toShip(v1.set(4.4, 0, 2.2).multiplyScalar(this.gust));
    const vel = v2.set(c.speed, c.climb, 0);
    this.wind.copy(trueWind).sub(vel);
    toShip(this.down.set(0, -1, 0));
    this.accel.copy(vel).sub(this.prevVel).divideScalar(Math.max(c.dt, 1e-3));
    this.accel.clampLength(0, 30);
    this.prevVel.copy(vel);
    // the world's turn since the last frame, seen from the ship
    if (this.prevQ) {
      const dq = new THREE.Quaternion().copy(c.worldQ).multiply(this.prevQ.clone().invert());
      this.turn.copy(this.shipQi).multiply(dq).multiply(this.shipQ);
    } else this.turn.identity();
    this.prevQ = (this.prevQ ?? new THREE.Quaternion()).copy(c.worldQ);
    this.side.crossVectors(this.wind, this.down);
    if (this.side.lengthSq() < 1e-6) this.side.set(0, 0, 1); else this.side.normalize();
  }
}

/** A flag or pennant: point masses joined along the mesh's edges, pinned at the hoist. */
export class FlagCloth {
  private n: number;
  private p: Float32Array;     // positions (ship space)
  private o: Float32Array;     // previous positions
  private rest: Float32Array;  // mesh-local rest positions
  private pin: Uint8Array;
  private hoistD: Float32Array; // distance from the hoist (m), for the gust wave
  private edges: Uint32Array;
  private len: Float32Array;
  private pos: THREE.BufferAttribute;
  private started = false;

  constructor(private mesh: THREE.Mesh, private root: THREE.Object3D) {
    this.pos = floatPositions(mesh);
    const n = this.n = this.pos.count;
    this.rest = Float32Array.from(this.pos.array as Float32Array);
    this.p = new Float32Array(n * 3); this.o = new Float32Array(n * 3);
    this.pin = new Uint8Array(n); this.hoistD = new Float32Array(n);
    // the hoist is the cloth's +X end (airship/rig.py: flags stream aft from their staff)
    let maxX = -Infinity, minX = Infinity;
    for (let i = 0; i < n; i++) { maxX = Math.max(maxX, this.rest[i * 3]); minX = Math.min(minX, this.rest[i * 3]); }
    const span = Math.max(maxX - minX, 1e-6);
    for (let i = 0; i < n; i++) if (this.rest[i * 3] > maxX - span * 0.02) this.pin[i] = 1;
    // edges from the triangles (structural + the triangles' diagonals), deduplicated
    const idx = mesh.geometry.index;
    const tri = idx ? (idx.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
    const set = new Set<number>();
    const pairs: number[] = [];
    const add = (a: number, b: number) => { const k = a < b ? a * n + b : b * n + a; if (!set.has(k)) { set.add(k); pairs.push(a, b); } };
    for (let i = 0; i + 2 < tri.length; i += 3) { add(tri[i], tri[i + 1]); add(tri[i + 1], tri[i + 2]); add(tri[i + 2], tri[i]); }
    this.edges = Uint32Array.from(pairs);
    this.len = new Float32Array(pairs.length / 2);
    // scale to metres: distances measured in ship space once placed
    mesh.updateWorldMatrix(true, false);
    const toShip = this.meshToShip(m1);
    const P = (i: number, out: THREE.Vector3) => out.fromArray(this.rest, i * 3).applyMatrix4(toShip);
    for (let e = 0; e < this.len.length; e++) this.len[e] = P(this.edges[e * 2], v1).distanceTo(P(this.edges[e * 2 + 1], v2));
    const sx = new THREE.Vector3().setFromMatrixScale(toShip).x; // mesh units → metres
    for (let i = 0; i < n; i++) this.hoistD[i] = (maxX - this.rest[i * 3]) * sx;
  }

  private meshToShip(out: THREE.Matrix4) {
    return out.copy(m2.copy(this.root.matrixWorld).invert()).multiply(this.mesh.matrixWorld);
  }

  update(dt: number, air: AirFrame) {
    this.mesh.updateWorldMatrix(true, false);
    const toShip = this.meshToShip(m1);
    const n = this.n, p = this.p, o = this.o;
    if (!this.started) {
      this.started = true;
      for (let i = 0; i < n; i++) { v1.fromArray(this.rest, i * 3).applyMatrix4(toShip); v1.toArray(p, i * 3); v1.toArray(o, i * 3); }
    }
    const W = air.wind, ws = W.length();
    const steps = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / steps;
    // inertia: free points stay where the air was while the ship turns under them
    for (let i = 0; i < n; i++) if (!this.pin[i]) {
      v1.fromArray(p, i * 3).applyQuaternion(air.turn).toArray(p, i * 3);
      v1.fromArray(o, i * 3).applyQuaternion(air.turn).toArray(o, i * 3);
    }
    const g = 9.8, drag = 0.3, flutter = 0.06 * ws * air.gust, speedK = clamp(ws / 24, 0, 1);
    const freq = 3 + 9 * speedK;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < n; i++) {
        const k = i * 3;
        if (this.pin[i]) { v1.fromArray(this.rest, k).applyMatrix4(toShip); p[k] = o[k] = v1.x; p[k + 1] = o[k + 1] = v1.y; p[k + 2] = o[k + 2] = v1.z; continue; }
        const vx = (p[k] - o[k]) / h, vy = (p[k + 1] - o[k + 1]) / h, vz = (p[k + 2] - o[k + 2]) / h;
        // air drag toward the apparent wind (quadratic), a travelling flutter across it, gravity, the ship's push
        const rx = W.x - vx, ry = W.y - vy, rz = W.z - vz, rs = Math.hypot(rx, ry, rz);
        const d = this.hoistD[i];
        const wave = Math.sin(d * 2.2 - air.t * freq + i * 0.13) * flutter * Math.min(1, d * 0.7)
          + Math.sin(d * 1.1 - air.t * freq * 0.53) * flutter * 0.5 * Math.min(1, d * 0.5);
        const ax = drag * rs * rx + air.side.x * wave + air.down.x * g - air.accel.x;
        const ay = drag * rs * ry + air.side.y * wave + air.down.y * g - air.accel.y;
        const az = drag * rs * rz + air.side.z * wave + air.down.z * g - air.accel.z;
        const damp = 0.996;
        const nx = p[k] + (p[k] - o[k]) * damp + ax * h * h;
        const ny = p[k + 1] + (p[k + 1] - o[k + 1]) * damp + ay * h * h;
        const nz = p[k + 2] + (p[k + 2] - o[k + 2]) * damp + az * h * h;
        o[k] = p[k]; o[k + 1] = p[k + 1]; o[k + 2] = p[k + 2];
        p[k] = nx; p[k + 1] = ny; p[k + 2] = nz;
      }
      // keep the cloth's edges at their length
      for (let it = 0; it < 6; it++) {
        for (let e = 0; e < this.len.length; e++) {
          const a = this.edges[e * 2] * 3, b = this.edges[e * 2 + 1] * 3;
          const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
          const dl = Math.hypot(dx, dy, dz) || 1e-6, diff = (dl - this.len[e]) / dl;
          const pa = this.pin[a / 3], pb = this.pin[b / 3];
          if (pa && pb) continue;
          const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
          p[a] += dx * diff * wa; p[a + 1] += dy * diff * wa; p[a + 2] += dz * diff * wa;
          p[b] -= dx * diff * wb; p[b + 1] -= dy * diff * wb; p[b + 2] -= dz * diff * wb;
        }
      }
    }
    // back into the mesh's own space
    const toMesh = m2.copy(toShip).invert();
    const arr = this.pos.array as Float32Array;
    for (let i = 0; i < n; i++) v1.fromArray(p, i * 3).applyMatrix4(toMesh).toArray(arr, i * 3);
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.geometry.computeBoundingSphere();
  }
}

/** The lookout kite: a light wing on a line from the main top. The line is a spring that only pulls. */
export class Kite {
  private p = new THREE.Vector3();  // kite position, relative to the line's anchor, ship space
  private v = new THREE.Vector3();
  private L: number;
  private q0: THREE.Quaternion;
  private d0: THREE.Vector3;        // the modelled line direction (rig space)
  private line: THREE.Line;
  private linePts: Float32Array;
  private rigQ = new THREE.Quaternion();

  constructor(private rig: THREE.Object3D, private kite: THREE.Object3D, private root: THREE.Object3D) {
    this.q0 = kite.quaternion.clone();
    this.d0 = kite.position.clone().normalize();
    this.L = kite.position.length();
    // the modelled line is a fixed curve: replace it with one that follows the kite
    const old = rig.getObjectByName('Kite_line') as THREE.Mesh | undefined;
    if (old) old.visible = false; // (its material is white × vertex colour: the new line gets the rope's tone itself)
    const color = new THREE.Color(0x4a3424);
    const N = 24;
    this.linePts = new Float32Array((N + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePts, 3).setUsage(THREE.DynamicDrawUsage));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    this.line.frustumCulled = false;
    this.line.name = 'Kite_line_live';
    rig.add(this.line);
    // start where the model put it
    rig.updateWorldMatrix(true, false);
    this.toShipDir(this.p.copy(kite.position));
  }

  private toShipDir(v: THREE.Vector3) {
    // rig space → ship space (directions / offsets: rotation only)
    this.rig.getWorldQuaternion(this.rigQ);
    return v.applyQuaternion(this.rigQ).applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion()).invert());
  }
  private toRigDir(v: THREE.Vector3) {
    this.rig.getWorldQuaternion(this.rigQ);
    return v.applyQuaternion(this.root.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(this.rigQ.invert());
  }

  update(dt: number, air: AirFrame) {
    // the ship turns under the kite: it lags, and the line pulls it round
    this.p.applyQuaternion(air.turn); this.v.applyQuaternion(air.turn);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    const LD = 1.7, aero = 0.11, g = 3.2, k = 400, c = 20; // the line: stretches ~2% under a full pull, no bounce
    const rel = new THREE.Vector3(), lift = new THREE.Vector3(), acc = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let s = 0; s < steps; s++) {
      // apparent wind on the kite, with a little turbulence so it dances
      const t = air.t + s * h;
      rel.copy(air.wind).sub(this.v);
      const ws = rel.length();
      rel.addScaledVector(air.side, Math.sin(t * 0.9) * 0.18 * ws + Math.sin(t * 2.3) * 0.06 * ws);
      rel.y += Math.sin(t * 0.7 + 1) * 0.12 * ws;
      const wsr = rel.length() || 1e-3;
      // drag along the wind, lift across it (upward): together they hold the kite at a steady angle
      lift.copy(air.down).negate().addScaledVector(rel, air.down.dot(rel) / (wsr * wsr)).normalize();
      acc.copy(rel).multiplyScalar(aero * wsr).addScaledVector(lift, aero * wsr * wsr * LD);
      acc.addScaledVector(air.down, g).sub(air.accel);
      // the line: a stiff spring that only pulls, damped along its length
      const len = this.p.length();
      nrm.copy(this.p).divideScalar(len || 1);
      if (len > this.L) acc.addScaledVector(nrm, -k * (len - this.L) - c * Math.max(0, this.v.dot(nrm)));
      this.v.addScaledVector(acc, h).multiplyScalar(Math.exp(-0.35 * h));
      this.p.addScaledVector(this.v, h);
      // never longer than the line can stretch, never down into the rigging
      const l2 = this.p.length();
      if (l2 > this.L * 1.06) { this.p.multiplyScalar(this.L * 1.06 / l2); const vn = this.v.dot(nrm); if (vn > 0) this.v.addScaledVector(nrm, -vn); }
      const up = -this.p.dot(air.down);
      if (up < 1.5) { this.p.addScaledVector(air.down, up - 1.5); const vd = this.v.dot(air.down); if (vd > 0) this.v.addScaledVector(air.down, -vd); }
    }
    // place the kite (rig space), turned so it sits on its line as modelled, rocking a little in the gusts
    const pr = this.toRigDir(v1.copy(this.p));
    this.kite.position.copy(pr);
    const d = v2.copy(pr).normalize();
    const R = new THREE.Quaternion().setFromUnitVectors(this.d0, d);
    const rock = new THREE.Quaternion().setFromAxisAngle(d, Math.sin(air.t * 1.3) * 0.18 + Math.sin(air.t * 3.1) * 0.05);
    this.kite.quaternion.copy(rock).multiply(R).multiply(this.q0);
    // the line: straight when it is pulled tight, sagging when the kite comes in
    const tight = clamp(this.p.length() / this.L, 0, 1);
    const sag = this.L * (0.015 + 0.25 * (1 - tight));
    const downR = this.toRigDir(v3.copy(air.down));
    const N = this.linePts.length / 3 - 1;
    for (let i = 0; i <= N; i++) {
      const u = i / N, b = 4 * u * (1 - u) * sag;
      this.linePts[i * 3] = pr.x * u + downR.x * b;
      this.linePts[i * 3 + 1] = pr.y * u + downR.y * b;
      this.linePts[i * 3 + 2] = pr.z * u + downR.z * b;
    }
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
