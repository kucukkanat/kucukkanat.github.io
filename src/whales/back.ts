// Reading the whale's body: a height map of its back (where the island grows), which bones move each spot, and the
// per-frame skin matrices that carry generated things along with the swimming body.
// Everything here is in the whale object's rest space: nose +Z, up +Y, the whale's left +X, glTF metres.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();

/** Per-frame skin matrices in object space: B_i = inv(object) * bone_i * restInverse_i. */
export class SkinRig {
  readonly bones: THREE.Bone[];
  /** inv(bone rest world) * object rest world, per bone. */
  readonly restInv: THREE.Matrix4[];
  readonly mats: Float32Array;
  constructor(readonly body: THREE.SkinnedMesh, readonly obj: THREE.Object3D) {
    obj.updateMatrixWorld(true);
    this.bones = body.skeleton.bones;
    this.restInv = this.bones.map(b => new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(obj.matrixWorld));
    this.mats = new Float32Array(this.bones.length * 16);
    this.update();
  }
  /** A skeleton over the same bones for meshes authored in object rest space (bind matrix = identity). */
  skeleton() { return new THREE.Skeleton(this.bones, this.restInv.map(m => m.clone())); }
  /** Call after the mixer and `obj.updateMatrixWorld(true)`. */
  update() {
    _inv.copy(this.obj.matrixWorld).invert();
    for (let i = 0; i < this.bones.length; i++) {
      _m.multiplyMatrices(_inv, this.bones[i].matrixWorld).multiply(this.restInv[i]);
      this.mats.set(_m.elements, i * 16);
    }
  }
  /** Weighted blend of four bone matrices -> out[off .. off + 16). */
  blend(idx: ArrayLike<number>, w: ArrayLike<number>, io: number, out: Float32Array, off = 0) {
    const m = this.mats;
    const a = idx[io] * 16, b = idx[io + 1] * 16, c = idx[io + 2] * 16, d = idx[io + 3] * 16;
    const wa = w[io], wb = w[io + 1], wc = w[io + 2], wd = w[io + 3];
    for (let k = 0; k < 16; k++) out[off + k] = m[a + k] * wa + m[b + k] * wb + m[c + k] * wc + m[d + k] * wd;
  }
}

/** out = B * [cols | t] where the right side is an affine transform given as 3 columns (9) and a translation. */
export function mulAffine(B: Float32Array, bo: number, c: ArrayLike<number>, co: number, tx: number, ty: number, tz: number, out: Float32Array | number[], oo: number) {
  const b0 = B[bo], b1 = B[bo + 1], b2 = B[bo + 2], b4 = B[bo + 4], b5 = B[bo + 5], b6 = B[bo + 6], b8 = B[bo + 8], b9 = B[bo + 9], b10 = B[bo + 10];
  for (let j = 0; j < 3; j++) {
    const x = c[co + j * 3], y = c[co + j * 3 + 1], z = c[co + j * 3 + 2];
    out[oo + j * 4] = b0 * x + b4 * y + b8 * z; out[oo + j * 4 + 1] = b1 * x + b5 * y + b9 * z; out[oo + j * 4 + 2] = b2 * x + b6 * y + b10 * z; out[oo + j * 4 + 3] = 0;
  }
  out[oo + 12] = b0 * tx + b4 * ty + b8 * tz + B[bo + 12]; out[oo + 13] = b1 * tx + b5 * ty + b9 * tz + B[bo + 13];
  out[oo + 14] = b2 * tx + b6 * ty + b10 * tz + B[bo + 14]; out[oo + 15] = 1;
}

export interface BackRect { x0: number; x1: number; z0: number; z1: number; nx: number; nz: number }

export class Back {
  readonly nx: number; readonly nz: number; readonly x0: number; readonly z0: number; readonly dx: number; readonly dz: number;
  /** Skin height per grid node (NaN off the body). */
  readonly y: Float32Array;
  /** Bone indices / weights per grid node. */
  readonly idx: Uint16Array; readonly w: Float32Array;
  /** Per row (z): body half-width, the height of its widest point and the height on the centreline. */
  readonly halfW: Float32Array; readonly eqY: Float32Array; readonly topY: Float32Array;

  constructor(body: THREE.SkinnedMesh, obj: THREE.Object3D, r: BackRect) {
    this.nx = r.nx; this.nz = r.nz; this.x0 = r.x0; this.z0 = r.z0;
    this.dx = (r.x1 - r.x0) / (r.nx - 1); this.dz = (r.z1 - r.z0) / (r.nz - 1);
    const N = r.nx * r.nz;
    this.y = new Float32Array(N).fill(NaN); this.idx = new Uint16Array(N * 4); this.w = new Float32Array(N * 4);
    this.halfW = new Float32Array(r.nz); this.eqY = new Float32Array(r.nz).fill(NaN); this.topY = new Float32Array(r.nz).fill(NaN);
    const vert = new Int32Array(N).fill(-1);

    // rest positions in object space
    obj.updateMatrixWorld(true); body.skeleton.update();
    const g = body.geometry, pos = g.attributes.position, n = pos.count;
    const P = new Float32Array(n * 3), v = new THREE.Vector3();
    const toObj = new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(body.matrixWorld);
    for (let i = 0; i < n; i++) { body.getVertexPosition(i, v).applyMatrix4(toObj); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
    // rasterise the upward-facing triangles, keeping the highest surface
    const index = g.index!; const tris = index.count / 3;
    for (let t = 0; t < tris; t++) {
      const a = index.getX(t * 3), b = index.getX(t * 3 + 1), c = index.getX(t * 3 + 2);
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);   // y of (b-a) x (c-a)
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-12 || ny <= 0) continue;
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - r.x0) / this.dx)), i1 = Math.min(r.nx - 1, Math.floor((Math.max(ax, bx, cx) - r.x0) / this.dx));
      const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - r.z0) / this.dz)), j1 = Math.min(r.nz - 1, Math.floor((Math.max(az, bz, cz) - r.z0) / this.dz));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = r.x0 + i * this.dx, pz = r.z0 + j * this.dz;
        const wa = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, wb = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, wc = 1 - wa - wb;
        if (wa < -1e-4 || wb < -1e-4 || wc < -1e-4) continue;
        const yy = wa * ay + wb * by + wc * cy, k = j * r.nx + i;
        if (!(yy <= this.y[k])) { this.y[k] = yy; vert[k] = wa >= wb && wa >= wc ? a : wb >= wc ? b : c; }
      }
    }
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    for (let k = 0; k < N; k++) {
      const vi = vert[k]; if (vi < 0) { this.w[k * 4] = 1; continue; }
      let s = 0;
      for (let c = 0; c < 4; c++) { this.idx[k * 4 + c] = si.getComponent(vi, c); const ww = sw.getComponent(vi, c); this.w[k * 4 + c] = ww; s += ww; }
      if (s > 0) for (let c = 0; c < 4; c++) this.w[k * 4 + c] /= s; else this.w[k * 4] = 1;
    }
    const mid = Math.round((0 - r.x0) / this.dx);
    // per row: walk out from the centreline until the surface ends or drops away (the flank; skips the flippers)
    for (let j = 0; j < r.nz; j++) {
      this.topY[j] = this.y[j * r.nx + mid];
      let wSum = 0, ySum = 0;
      for (const dir of [-1, 1]) {
        let i = mid, last = this.topY[j];
        for (;;) {
          const ni = i + dir; if (ni < 0 || ni >= r.nx) break;
          const yy = this.y[j * r.nx + ni];
          if (!Number.isFinite(yy) || (last - yy) / this.dx > 5) break;
          i = ni; last = yy;
        }
        wSum += Math.abs(r.x0 + i * this.dx) + this.dx * 0.5; ySum += last;
      }
      this.halfW[j] = wSum / 2; this.eqY[j] = Number.isFinite(ySum) ? ySum / 2 - this.dx : NaN;
    }
  }
  node(x: number, z: number) {
    const i = Math.max(0, Math.min(this.nx - 1, Math.round((x - this.x0) / this.dx))), j = Math.max(0, Math.min(this.nz - 1, Math.round((z - this.z0) / this.dz)));
    return j * this.nx + i;
  }
  row(z: number) { return Math.max(0, Math.min(this.nz - 1, Math.round((z - this.z0) / this.dz))); }
}

/** Bilinear lookup in a grid laid out like a Back (NaN-safe: falls back to the nearest node). */
export function gridSample(a: Float32Array, b: Back, x: number, z: number) {
  const fx = Math.max(0, Math.min(b.nx - 1.001, (x - b.x0) / b.dx)), fz = Math.max(0, Math.min(b.nz - 1.001, (z - b.z0) / b.dz));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * b.nx + i;
  const v00 = a[k], v10 = a[k + 1], v01 = a[k + b.nx], v11 = a[k + b.nx + 1];
  const r = (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
  return Number.isFinite(r) ? r : a[b.node(x, z)];
}
