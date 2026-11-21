// Camera flights for the outside view (outside.ts): a path through keys, paced so the camera is slow in the cabin,
// faster outside, and slows down for turns. Kept apart so it can be checked without a browser (scripts/flight-check.ts).
import * as THREE from 'three';
const { clamp } = THREE.MathUtils;

export interface Key { p: THREE.Vector3; t: THREE.Vector3 }
/** Flight pacing: top speed (relative to the cabin's). */
const VMAX = 10;
/** Most the speed may change: (speed units)^2 per metre, i.e. a = ACCEL in m per unit^2. */
const ACCEL = 0.6;
/** Seconds per pacing unit: speed 1 (the cabin) is 1 / UNIT m/s, a turn costing 1 unit takes UNIT s. */
const UNIT = 0.3;
/** Seconds the camera takes to get going, and to come to rest. */
const RAMP = 0.9;

/** Pacing of the flights: grow (m of path per +1 speed outside), turn cost (units per radian of heading). */
export const PACE = {
  out: { grow: 3, turn: 3 },
  back: { grow: 3, turn: 3 },
  intro: { grow: 3, turn: 3 },
};

/**
 * One camera move: a Catmull-Rom path through the keys' positions and one through their aim points (same parameter,
 * so the heading turns as smoothly as the path bends; the aim is kept as a look direction, consecutive keys well under
 * 180 degrees apart), paced by arc length: speed 1 in the cabin, rising by 1 for every `grow` metres of path outside
 * the window up to VMAX, and `turnCost` units per radian the heading turns. The pacing sets the duration; one easing
 * over the whole move: no stop at the window.
 */
export class Flight {
  private pc: THREE.CatmullRomCurve3;
  private tc: THREE.CatmullRomCurve3;
  private tau: Float32Array;
  private len: number;
  private static N = 1500;
  constructor(keys: Key[], gate: THREE.Vector3, grow: number, inward: boolean, turnCost = 0) {
    this.pc = new THREE.CatmullRomCurve3(keys.map(k => k.p.clone()), false, 'catmullrom', 0.5);
    // aim as look directions, not points: the camera can pass its aim point without the heading flipping
    this.tc = new THREE.CatmullRomCurve3(keys.map(k => k.t.clone().sub(k.p).normalize()), false, 'catmullrom', 0.5);
    this.pc.arcLengthDivisions = Flight.N;
    const lengths = this.pc.getLengths(Flight.N);
    this.len = lengths[Flight.N];
    const wi = keys.findIndex(k => k.p.distanceToSquared(gate) < 1e-8);
    const sW = wi < 0 ? (inward ? this.len : 0) : lengths[Math.round(wi / (keys.length - 1) * Flight.N)];
    const N = Flight.N, tau = this.tau = new Float32Array(N + 1);
    const dirAt = (u: number) => this.tc.getPoint(this.pc.getUtoTmapping(u, u * this.len)).normalize();
    // speed limit per sample: by distance from the window, and by how fast the heading turns there (1 / turnCost rad
    // per unit at most)
    const ds = this.len / N, lim = new Float32Array(N + 1);
    let d0 = dirAt(0);
    for (let j = 1; j <= N; j++) {
      const d1 = dirAt(j / N), s = this.len * (j - 0.5) / N;
      const vd = Math.min(VMAX, 1 + Math.max(0, inward ? sW - s : s - sW) / grow);
      const turnRate = d0.angleTo(d1) / ds; // rad per metre
      lim[j] = turnCost > 0 && turnRate > 1e-6 ? Math.min(vd, 1 / (turnCost * turnRate)) : vd;
      d0 = d1;
    }
    lim[0] = lim[1];
    // a speed planner: forward and backward passes cap acceleration and braking at ACCEL, so the camera eases into
    // and out of slow stretches only as much as it has to
    const v = Float32Array.from(lim);
    for (let j = 1; j <= N; j++) v[j] = Math.min(v[j], Math.sqrt(v[j - 1] * v[j - 1] + 2 * ACCEL * ds));
    for (let j = N - 1; j >= 0; j--) v[j] = Math.min(v[j], Math.sqrt(v[j + 1] * v[j + 1] + 2 * ACCEL * ds));
    for (let j = 1; j <= N; j++) tau[j] = tau[j - 1] + 2 * ds / (v[j - 1] + v[j]);
  }
  /** How long the flight takes (s): set by the pacing, so speed and turn limits hold whatever the path. */
  get duration() { return this.tau[Flight.N] * UNIT; }

  /**
   * Progress (0..1 of the paced time) at time fraction k: the pacing at full rate in the middle, with a smooth start and
   * stop that take RAMP seconds each (not a share of the whole flight, which would crawl at both ends of a long one).
   */
  progress(k: number) {
    const T = this.duration, r = Math.min(RAMP, T / 3) / Math.max(T, 1e-6);
    // velocity: smoothstep up over [0, r], 1 in the middle, smoothstep down over [1 - r, 1]; position is its integral
    const up = (x: number) => { const u = clamp(x / r, 0, 1); return r * (u * u * u - u * u * u * u / 2); }; // ∫ smoothstep
    const total = 1 - r; // area under the velocity curve
    k = clamp(k, 0, 1);
    let a: number;
    if (k <= r) a = up(k);
    else if (k >= 1 - r) a = total - up(1 - k);
    else a = r / 2 + (k - r);
    return a / total;
  }

  /** Pose at progress p (0..1 of the paced time). */
  at(p: number, pos: THREE.Vector3, target: THREE.Vector3) {
    const N = Flight.N, tau = this.tau, want = clamp(p, 0, 1) * tau[N];
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tau[m] <= want) lo = m; else hi = m; }
    const f = tau[hi] > tau[lo] ? (want - tau[lo]) / (tau[hi] - tau[lo]) : 0;
    const u = clamp((lo + f) / N, 0, 1);
    const t = this.pc.getUtoTmapping(u, u * this.len);
    this.pc.getPoint(t, pos);
    this.tc.getPoint(t, target);
    target.normalize().multiplyScalar(4).add(pos);
  }
}
