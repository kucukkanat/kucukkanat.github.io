// A lake on a whale's back: a height-field water surface that stays level while the whale tilts under it, sloshes
// when the whale accelerates, ripples from rain, fish and waterfalls, spills over its rim and drains / refills.
// Simulated in the lake's own frame (origin at the rest water level over the lake's centre, axes = the whale's).
import * as THREE from 'three';
import { ENV_PARS, ENV_OUT, type WhaleEnv } from './effects';
import type { LiquidKind } from './biomes';

export interface LakeSpec {
  /** Centre in whale rest space; y is the rest water level. */
  x: number; y: number; z: number; r: number; depth: number;
  kind: LiquidKind; shallow: string; deep: string; foam: string; glow: number;
  /** Outlets on the rim: direction (unit, lake frame) and where the stream leaves the island. */
  outlets: { dx: number; dz: number; lipX: number; lipZ: number }[];
}

const WATER_VERT = /* glsl */`
  attribute float aBed; attribute float aFoam;
  varying vec3 vW; varying vec3 vN; varying float vDepth; varying vec2 vP; varying float vFoam;
  void main() {
    vDepth = position.y - aBed; vP = position.xz; vFoam = aFoam;
    vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const WATER_FRAG = /* glsl */`
  ${ENV_PARS}
  uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoamCol; uniform float uDepthK; uniform float uGlow; uniform float uKind; uniform float uR;
  varying vec3 vW; varying vec3 vN; varying float vDepth; varying vec2 vP; varying float vFoam;
  void main() {
    if (vDepth < 0.0 || dot(vP, vP) > uR * uR * 1.4) discard;
    vec3 n = normalize(vN); vec3 V = normalize(cameraPosition - vW);
    vec2 q = vP / uR;
    vec3 c; float a;
    if (uKind > 1.5) {
      // lava: a dark crust drifting over the glow, brightest in the cracks and at the shore
      float t = uTime * 0.12;
      float crust = vnoise(q * 5.0 + vec2(t, -t * 0.7)) * 0.6 + vnoise(q * 13.0 - vec2(t * 1.6, t)) * 0.4;
      float hot = smoothstep(0.42, 0.62, crust) + (1.0 - smoothstep(0.0, 0.25 * uR, vDepth)) * 0.7 + vFoam * 2.0;
      c = mix(vec3(0.07, 0.03, 0.03), mix(uDeep, uShallow, clamp(hot, 0.0, 1.0)) * (1.0 + uGlow), clamp(hot, 0.05, 1.0));
      c = mix(c, uHaze, uHazeK * 0.4); a = 1.0;
    } else if (uKind > 0.5) {
      // ice: frosted, cracked, with a hard glint
      float crack = (1.0 - smoothstep(0.0, 0.035, abs(vnoise(q * 4.0) - 0.5))) + (1.0 - smoothstep(0.0, 0.02, abs(vnoise(q * 9.0 + 7.0) - 0.5))) * 0.6;
      float frost = vnoise(q * 22.0) * 0.25;
      vec3 alb = mix(uDeep, uShallow, 0.55 + frost + (1.0 - smoothstep(0.0, 0.3 * uR, vDepth)) * 0.4) + crack * 0.25;
      vec3 H = normalize(uSun + V);
      c = alb * envLight(n) * 0.8 + uSunCol * pow(max(dot(n, H), 0.0), 60.0) * 0.6;
      float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
      c = mix(c, mix(uHaze, uSky, 0.6), fr * 0.4);
      c = mix(c, uHaze, uHazeK); a = 0.96;
    } else {
      float k = 1.0 - exp(-vDepth * uDepthK);
      // light dancing on the bed in the shallows
      float caus = vnoise(q * 9.0 + uTime * 0.35) * vnoise(q * 14.0 - uTime * 0.28);
      vec3 body = mix(uShallow * (1.0 + caus * 1.4 * (1.0 - k)), uDeep, k);
      vec3 lit = body * (mix(uGround, uSky, 0.85) + uSunCol * (0.35 + 0.65 * max(dot(n, uSun), 0.0)));
      lit += uShallow * uGlow * (0.25 + uNight) * (1.0 - k * 0.5);
      float fr = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
      vec3 R = reflect(-V, n);
      vec3 sky = mix(uHaze, uSky, clamp(R.y * 1.4, 0.0, 1.0));
      vec3 H = normalize(uSun + V);
      float spec = pow(max(dot(n, H), 0.0), 220.0) * 2.5 + pow(max(dot(n, H), 0.0), 40.0) * 0.18;
      c = mix(lit, sky, fr * 0.55) + uSunCol * spec * (1.0 - uStorm * 0.7);
      // foam: where the water is thin over the shore, and on the crests of sloshing waves
      float lap = vnoise(q * 26.0 + vec2(uTime * 0.6, -uTime * 0.4));
      float shore = 1.0 - smoothstep(0.0, 0.05 * uR, vDepth - 0.012 * uR * sin(uTime * 1.3 + q.x * 9.0 + q.y * 7.0));
      float foam = clamp(shore * (0.35 + 0.65 * lap) + vFoam * (0.4 + lap), 0.0, 1.0);
      c = mix(c, uFoamCol * (mix(uGround, uSky, 0.9) + uSunCol * 0.7), foam);
      c = mix(c, uHaze, uHazeK);
      a = clamp(mix(0.5, 0.95, k) + fr * 0.4 + foam, 0.0, 1.0) * smoothstep(0.0, 0.012 * uR, vDepth);
    }
    gl_FragColor = vec4(c, a * uFade);
    ${ENV_OUT}
  }`;

export class Lake {
  readonly mesh: THREE.Mesh;
  readonly N: number; readonly half: number; readonly cell: number;
  private h: Float32Array; private v: Float32Array; private wet: Uint8Array; private bed: Float32Array;
  private pos: Float32Array; private nrm: Float32Array; private foam: Float32Array;
  /** Surface slope (rise per unit along x / z) and its rate: the level plane a tilted, accelerating lake settles to. */
  sx = 0; sz = 0; private vsx = 0; private vsz = 0;
  /** Water level relative to the rest level (drops when the lake spills, recovers slowly). */
  level = 0;
  /** Flow leaving through each outlet, 0..1.5. */
  readonly flow: number[];
  /** Spill events this step: lake-frame position on the rim, outward direction and strength. */
  readonly spills: { x: number; z: number; dx: number; dz: number; amount: number }[] = [];
  private rim: Float32Array;
  private readonly live: boolean;

  /**
   * @param bedAt terrain height at a point of the whale's rest space
   * @param n     grid nodes per side; `live: false` keeps only the tilting plane (far whales)
   */
  constructor(readonly spec: LakeSpec, bedAt: (x: number, z: number) => number, env: WhaleEnv, n: number, live: boolean) {
    this.N = n; this.live = live; this.half = spec.r * 1.3; this.cell = this.half * 2 / (n - 1);
    const M = n * n;
    this.h = new Float32Array(M); this.v = new Float32Array(M); this.wet = new Uint8Array(M); this.bed = new Float32Array(M);
    this.pos = new Float32Array(M * 3); this.nrm = new Float32Array(M * 3); this.foam = new Float32Array(M);
    const idx: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = -this.half + i * this.cell, z = -this.half + j * this.cell;
      this.bed[k] = bedAt(spec.x + x, spec.z + z) - spec.y;
      this.wet[k] = this.bed[k] < 0 && Math.hypot(x, z) < spec.r * 1.12 ? 1 : 0;
      this.pos[k * 3] = x; this.pos[k * 3 + 2] = z; this.nrm[k * 3 + 1] = 1;
      if (i < n - 1 && j < n - 1) idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
    }
    this.rim = new Float32Array(16);
    for (let a = 0; a < 16; a++) {
      const an = a / 16 * Math.PI * 2;
      // the bank's height; an outlet's own sector never "spills" (that water is the waterfall)
      const out = spec.outlets.some(o => Math.cos(an) * o.dx + Math.sin(an) * o.dz > 0.8);
      this.rim[a] = out ? 1e3 : Math.max(spec.r * 0.1, bedAt(spec.x + Math.cos(an) * spec.r * 1.22, spec.z + Math.sin(an) * spec.r * 1.22) - spec.y);
    }
    this.flow = spec.outlets.map(() => 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aBed', new THREE.BufferAttribute(this.bed, 1));
    geo.setAttribute('aFoam', new THREE.BufferAttribute(this.foam, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...env, uShallow: { value: new THREE.Color(spec.shallow) }, uDeep: { value: new THREE.Color(spec.deep) },
        uFoamCol: { value: new THREE.Color(spec.foam) }, uDepthK: { value: 3.2 / Math.max(spec.depth, 1e-3) }, uGlow: { value: spec.glow },
        uKind: { value: spec.kind === 'lava' ? 2 : spec.kind === 'ice' ? 1 : 0 }, uR: { value: spec.r },
      },
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: spec.kind !== 'lava', depthWrite: spec.kind === 'lava',
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.renderOrder = 1;
    this.mesh.userData.ecoCustom = true;
    this.write();
  }

  get frozen() { return this.spec.kind === 'ice'; }

  /** A splash / ripple at a lake-frame point. */
  impulse(x: number, z: number, amount: number, radius = this.spec.r * 0.18) {
    if (!this.live || this.frozen) return;
    const n = this.N, ci = (x + this.half) / this.cell, cj = (z + this.half) / this.cell, rr = Math.max(1.2, radius / this.cell);
    for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(n - 1, Math.ceil(cj + rr)); j++)
      for (let i = Math.max(0, Math.floor(ci - rr)); i <= Math.min(n - 1, Math.ceil(ci + rr)); i++) {
        const d = Math.hypot(i - ci, j - cj) / rr; if (d >= 1) continue;
        this.v[j * n + i] -= amount * (1 - d * d);
      }
  }

  /** Surface height (lake frame) at a lake-frame point. */
  heightAt(x: number, z: number) {
    const n = this.N, fi = Math.max(0, Math.min(n - 1.001, (x + this.half) / this.cell)), fj = Math.max(0, Math.min(n - 1.001, (z + this.half) / this.cell));
    const i = Math.floor(fi), j = Math.floor(fj), tx = fi - i, tz = fj - j, k = j * n + i, h = this.h;
    return this.level + this.sx * x + this.sz * z + (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) + (h[k + n] * (1 - tx) + h[k + n + 1] * tx) * tz;
  }

  /**
   * @param gx,gz the slope the surface wants: the horizontal part of (gravity - acceleration) in the lake frame,
   *              per unit of its vertical part
   * @param rain  0..1 (drops falling on the surface)
   */
  step(dt: number, gx: number, gz: number, rain: number, time: number) {
    this.spills.length = 0;
    const r = this.spec.r, lava = this.spec.kind === 'lava';
    if (this.frozen) return;
    // the level plane: an under-damped spring towards the effective horizon (slosh), slower and heavier for lava
    const w2 = lava ? 14 : 34, zeta = lava ? 0.5 : 0.16, c = 2 * zeta * Math.sqrt(w2);
    const tx = Math.max(-0.42, Math.min(0.42, gx)), tz = Math.max(-0.42, Math.min(0.42, gz));
    const ax = w2 * (tx - this.sx) - c * this.vsx, az = w2 * (tz - this.sz) - c * this.vsz;
    this.vsx += ax * dt; this.vsz += az * dt; this.sx += this.vsx * dt; this.sz += this.vsz * dt;
    const n = this.N, h = this.h, v = this.v, wet = this.wet;
    if (this.live) {
      // sloshing throws chop against the shore the water is running up
      const sl = Math.hypot(this.vsx, this.vsz);
      if (sl > 0.12) {
        const ux = this.vsx / sl, uz = this.vsz / sl, m = Math.min(1.5, sl) * r * 0.55 * dt * (lava ? 0.3 : 1);
        for (let q = 0; q < 3; q++) {
          const a = Math.atan2(uz, ux) + (Math.random() - 0.5) * 1.6;
          this.impulse(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, -m * 9, r * 0.22);
        }
      }
      if (rain > 0.02 && Math.random() < rain * 40 * dt) {
        const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * r * 0.9;
        this.impulse(Math.cos(a) * d, Math.sin(a) * d, r * 0.1, r * 0.09);
      }
      // wave equation with reflecting shores
      const sub = Math.max(1, Math.ceil(dt * (n - 1) * (lava ? 0.5 : 1.4) / 0.6)), sdt = dt / sub;
      const c2 = ((lava ? 0.5 : 1.4) * (n - 1)) ** 2, damp = Math.exp(-(lava ? 2.4 : 0.9) * sdt);
      for (let s = 0; s < sub; s++) {
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const k = j * n + i; if (!wet[k]) continue;
          const c0 = h[k];
          const l = i > 0 && wet[k - 1] ? h[k - 1] : c0, rr = i < n - 1 && wet[k + 1] ? h[k + 1] : c0;
          const u = j > 0 && wet[k - n] ? h[k - n] : c0, d = j < n - 1 && wet[k + n] ? h[k + n] : c0;
          v[k] = (v[k] + c2 * (l + rr + u + d - 4 * c0) * sdt) * damp;
        }
        for (let k = 0; k < n * n; k++) if (wet[k]) h[k] += v[k] * sdt;
      }
    }
    // spill over the rim, drain through the outlets, refill from the spring (and the rain)
    let lost = 0;
    for (let a = 0; a < 16; a++) {
      const an = a / 16 * Math.PI * 2, cx = Math.cos(an), cz = Math.sin(an);
      const over = this.level + (this.sx * cx + this.sz * cz) * r * 1.1 - this.rim[a];
      if (over > 0) {
        const amount = Math.min(1, over / (r * 0.12));
        lost += amount; this.spills.push({ x: cx * r * 1.15, z: cz * r * 1.15, dx: cx, dz: cz, amount });
      }
    }
    for (let o = 0; o < this.flow.length; o++) {
      const out = this.spec.outlets[o];
      const head = this.level + (this.sx * out.dx + this.sz * out.dz) * r + r * 0.06;   // water over the sill
      const target = Math.max(0, Math.min(1.5, head / (r * 0.06)));
      this.flow[o] += (target - this.flow[o]) * (1 - Math.exp(-dt * 4));
    }
    this.level -= lost * r * 0.05 * dt;
    this.level += ((0 - this.level) * (0.05 + rain * 0.4)) * dt;
    this.level = Math.max(-this.spec.depth * 0.6, this.level);
    void time;
    this.write();
  }

  private write() {
    const n = this.N, h = this.h, pos = this.pos, nrm = this.nrm, c = this.cell, foam = this.foam, v = this.v;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = pos[k * 3], z = pos[k * 3 + 2];
      pos[k * 3 + 1] = this.level + this.sx * x + this.sz * z + h[k];
      const hx = (h[i < n - 1 ? k + 1 : k] - h[i > 0 ? k - 1 : k]) / (2 * c) + this.sx, hz = (h[j < n - 1 ? k + n : k] - h[j > 0 ? k - n : k]) / (2 * c) + this.sz;
      const il = 1 / Math.hypot(hx, 1, hz);
      nrm[k * 3] = -hx * il; nrm[k * 3 + 1] = il; nrm[k * 3 + 2] = -hz * il;
      foam[k] = Math.min(1, Math.max(0, Math.abs(v[k]) / (this.spec.r * 1.2) - 0.25) + Math.max(0, Math.abs(h[k]) / (this.spec.r * 0.06) - 1) * 0.3);
    }
    const a = this.mesh.geometry.attributes;
    a.position.needsUpdate = true; a.normal.needsUpdate = true; a.aFoam.needsUpdate = true;
  }
}
