// Shared look and particle plumbing for the generated parts of a whale: the environment uniforms every custom
// material reads (so the viewer and the airship world can light them their own way), soft point puffs (mist,
// spray, smoke, rain, cloud, sparks) and ribbons (waterfalls, vapour trails).
import * as THREE from 'three';

export interface WhaleEnv {
  uSun: { value: THREE.Vector3 };       // direction to the sun, world space
  uSunCol: { value: THREE.Color }; uSky: { value: THREE.Color }; uGround: { value: THREE.Color };
  uHaze: { value: THREE.Color }; uHazeK: { value: number };
  uNight: { value: number }; uStorm: { value: number }; uTime: { value: number };
  /** Overall opacity (first appearance, LOD cross-fade). */
  uFade: { value: number };
}

export function makeEnv(): WhaleEnv {
  return {
    uSun: { value: new THREE.Vector3(0.45, 0.8, 0.3).normalize() },
    uSunCol: { value: new THREE.Color(1.0, 0.94, 0.84) }, uSky: { value: new THREE.Color(0.62, 0.74, 0.92) },
    uGround: { value: new THREE.Color(0.5, 0.44, 0.4) }, uHaze: { value: new THREE.Color(0.9, 0.82, 0.74) }, uHazeK: { value: 0 },
    uNight: { value: 0 }, uStorm: { value: 0 }, uTime: { value: 0 }, uFade: { value: 1 },
  };
}

export const ENV_PARS = /* glsl */`
  uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGround; uniform vec3 uHaze;
  uniform float uHazeK; uniform float uNight; uniform float uStorm; uniform float uTime; uniform float uFade;
  vec3 envLight(vec3 n) { return mix(uGround, uSky, n.y * 0.5 + 0.5) + uSunCol * max(dot(n, uSun), 0.0); }
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y); }
  float bayer(vec2 p) { vec2 q = floor(mod(p, 4.0)); float i = q.x + q.y * 4.0;
    return fract((mod(i * 5.0, 16.0) * 0.5 + mod(floor(i / 4.0) * 11.0 + q.x * 7.0, 16.0) * 0.5) / 16.0 + 0.03); }
`;
export const ENV_OUT = /* glsl */`
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

// ───────────────────────────────────────────────────────── puffs
export interface PuffOpts {
  life?: number; size?: number; grow?: number; color?: THREE.Color; alpha?: number; drag?: number; gravity?: number;
  /** 0 = lit by the environment, 1 = self-lit (sparks, lava spray). */
  glow?: number;
}

/** A pool of soft, per-particle sized and faded points, simulated in the whale's motion space. */
export class Puffs {
  readonly pts: THREE.Points;
  private pos: Float32Array; private vel: Float32Array; private col: Float32Array; private aux: Float32Array;
  private life: Float32Array; private max: Float32Array; private size: Float32Array; private grow: Float32Array;
  private drag: Float32Array; private grav: Float32Array; private alpha: Float32Array;
  private cursor = 0; live = 0;
  constructor(readonly N: number, env: WhaleEnv, additive = false) {
    this.pos = new Float32Array(N * 3).fill(-1e5); this.vel = new Float32Array(N * 3); this.col = new Float32Array(N * 4);
    this.aux = new Float32Array(N * 2);
    this.life = new Float32Array(N); this.max = new Float32Array(N).fill(1); this.size = new Float32Array(N); this.grow = new Float32Array(N);
    this.drag = new Float32Array(N); this.grav = new Float32Array(N); this.alpha = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aux', new THREE.BufferAttribute(this.aux, 2).setUsage(THREE.DynamicDrawUsage));
    const uPx = { value: 400 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...env, uPx },
      vertexShader: /* glsl */`
        attribute vec4 color; attribute vec2 aux; uniform float uPx; varying vec4 vC; varying float vGlow;
        void main() { vC = color; vGlow = aux.y; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aux.x * uPx / max(-mv.z, 1e-3), 256.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`
        ${ENV_PARS} varying vec4 vC; varying float vGlow;
        void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
          float a = vC.a * (1.0 - r) * (1.0 - r * 0.5) * uFade;
          vec3 lit = vC.rgb * (mix(uGround, uSky, 0.75) + uSunCol * 0.55);
          vec3 c = mix(lit, vC.rgb * 1.6, vGlow); c = mix(c, uHaze, uHazeK * (1.0 - vGlow * 0.6));
          gl_FragColor = vec4(c, a); ${ENV_OUT} }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(geo, mat); this.pts.frustumCulled = false; this.pts.renderOrder = 3;
    this.pts.userData.ecoCustom = true;
    const sz = new THREE.Vector2();
    this.pts.onBeforeRender = (renderer, _s, camera) => {
      renderer.getDrawingBufferSize(sz); uPx.value = sz.y * 0.5 * (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    };
  }
  emit(px: number, py: number, pz: number, vx: number, vy: number, vz: number, o: PuffOpts) {
    let i = this.cursor;
    for (let n = 0; n < 8 && this.life[i] > 0; n++) i = (i + 1) % this.N;   // prefer a free slot, else overwrite
    this.cursor = (i + 1) % this.N;
    const p = i * 3;
    this.pos[p] = px; this.pos[p + 1] = py; this.pos[p + 2] = pz; this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = this.max[i] = o.life ?? 1; this.size[i] = o.size ?? 0.2; this.grow[i] = o.grow ?? 0;
    this.drag[i] = o.drag ?? 1; this.grav[i] = o.gravity ?? 0; this.alpha[i] = o.alpha ?? 0.6;
    const c = o.color; this.col[i * 4] = c ? c.r : 1; this.col[i * 4 + 1] = c ? c.g : 1; this.col[i * 4 + 2] = c ? c.b : 1; this.col[i * 4 + 3] = 0;
    this.aux[i * 2] = this.size[i]; this.aux[i * 2 + 1] = o.glow ?? 0;
  }
  step(dt: number, wx = 0, wy = 0, wz = 0) {
    let live = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      const p = i * 3; this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[p + 1] = -1e5; this.col[i * 4 + 3] = 0; continue; }
      live++;
      const d = 1 - Math.exp(-this.drag[i] * dt);
      this.vel[p] += (wx - this.vel[p]) * d; this.vel[p + 1] += (wy - this.vel[p + 1]) * d + this.grav[i] * dt; this.vel[p + 2] += (wz - this.vel[p + 2]) * d;
      this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
      const t = 1 - this.life[i] / this.max[i];
      this.col[i * 4 + 3] = this.alpha[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      this.aux[i * 2] = this.size[i] * (1 + this.grow[i] * t);
    }
    this.live = live;
    const a = this.pts.geometry.attributes;
    a.position.needsUpdate = true; a.color.needsUpdate = true; a.aux.needsUpdate = true;
  }
  setVisible(on: boolean) { this.pts.visible = on; }
}

// ───────────────────────────────────────────────────────── ribbons
export interface RibbonOpts {
  nodes: number; interval: number; width: number; widen: number; gravity: number; drag: number;
  color: THREE.Color; glow?: number; opacity?: number; streaks?: number;
}

/** A trail of nodes shed from a moving emitter, drawn as two crossed strips. Simulated in the motion space. */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  readonly pos: Float32Array; readonly vel: Float32Array;
  private vpos: Float32Array; private acc = 0; private started = false;
  /** 0..1: how much is flowing (width and opacity). */
  flow = 1;
  readonly uOpacity = { value: 1 };
  constructor(readonly o: RibbonOpts, env: WhaleEnv) {
    const K = o.nodes;
    this.pos = new Float32Array(K * 3); this.vel = new Float32Array(K * 3);
    this.vpos = new Float32Array(K * 4 * 3);
    const uv = new Float32Array(K * 4 * 2), idx: number[] = [];
    for (let s = 0; s < 2; s++) for (let i = 0; i < K; i++) {
      const b = (s * K + i) * 2;
      uv.set([0, i / (K - 1), 1, i / (K - 1)], b * 2);
      if (i < K - 1) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.vpos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...env, uCol: { value: o.color }, uGlow: { value: o.glow ?? 0 }, uOpacity: this.uOpacity, uStreak: { value: o.streaks ?? 1 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        ${ENV_PARS} uniform vec3 uCol; uniform float uGlow; uniform float uOpacity; uniform float uStreak; varying vec2 vUv;
        void main() {
          float e = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float s = vnoise(vec2(vUv.x * 7.0, vUv.y * 9.0 - uTime * 2.2)) * 0.6 + vnoise(vec2(vUv.x * 19.0, vUv.y * 22.0 - uTime * 3.6)) * 0.4;
          s = mix(1.0, s, uStreak);
          float a = smoothstep(0.0, 0.5, e) * (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.04, vUv.y) * (0.45 + 0.75 * s) * uOpacity * uFade;
          vec3 light = mix(uGround, uSky, 0.8) + uSunCol * 0.6;
          vec3 c = mix(uCol, vec3(1.0), clamp(vUv.y * 0.8 + s * 0.45 - 0.1, 0.0, 1.0) * (1.0 - uGlow * 0.7)) * light;
          c = mix(c, uCol * (1.2 + s) * 1.5, clamp(uGlow, 0.0, 1.0));
          c = mix(c, uHaze, uHazeK * (1.0 - 0.6 * clamp(uGlow, 0.0, 1.0)));
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0)); ${ENV_OUT} }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.mesh.userData.ecoCustom = true;
  }
  reset() { this.started = false; }
  /**
   * Move the trail (`air`: the velocity drag pulls towards). `e` is the emitter and `ev` the velocity new water leaves with (motion space, scaled by `k`);
   * `constrain` may push a node (index) out of solid things.
   */
  step(dt: number, e: THREE.Vector3, ev: THREE.Vector3, k: number, air: THREE.Vector3, constrain?: (pos: Float32Array, vel: Float32Array, o: number) => void) {
    const K = this.o.nodes, P = this.pos, V = this.vel;
    if (!this.started) {
      this.started = true; this.acc = 0;
      for (let i = 0; i < K; i++) { const t = i * this.o.interval; P[i * 3] = e.x + ev.x * t; P[i * 3 + 1] = e.y + ev.y * t + 0.5 * this.o.gravity * k * t * t; P[i * 3 + 2] = e.z + ev.z * t; V[i * 3] = ev.x; V[i * 3 + 1] = ev.y + this.o.gravity * k * t; V[i * 3 + 2] = ev.z; }
    }
    this.acc += dt;
    while (this.acc >= this.o.interval) {
      this.acc -= this.o.interval;
      P.copyWithin(3, 0, (K - 1) * 3); V.copyWithin(3, 0, (K - 1) * 3);
    }
    P[0] = e.x; P[1] = e.y; P[2] = e.z; V[0] = ev.x; V[1] = ev.y; V[2] = ev.z;
    const d = 1 - Math.exp(-this.o.drag * dt), g = this.o.gravity * k * dt;
    for (let i = 1; i < K; i++) {
      const o = i * 3;
      V[o] += (air.x - V[o]) * d; V[o + 1] += (air.y - V[o + 1]) * d + g; V[o + 2] += (air.z - V[o + 2]) * d;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      constrain?.(P, V, o);
    }
    // two crossed strips
    const vp = this.vpos, w0 = this.o.width * k * (0.35 + 0.65 * this.flow);
    for (let i = 0; i < K; i++) {
      const a = Math.max(0, i - 1) * 3, b = Math.min(K - 1, i + 1) * 3, o = i * 3;
      let tx = P[a] - P[b], ty = P[a + 1] - P[b + 1], tz = P[a + 2] - P[b + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // side 1 = t x ref, side 2 = t x side 1
      let s1x: number, s1y: number, s1z: number;
      if (Math.abs(ty) < 0.9) { s1x = -tz; s1y = 0; s1z = tx; } else { s1x = 0; s1y = tz; s1z = -ty; }
      const sl = Math.hypot(s1x, s1y, s1z) || 1; s1x /= sl; s1y /= sl; s1z /= sl;
      const s2x = ty * s1z - tz * s1y, s2y = tz * s1x - tx * s1z, s2z = tx * s1y - ty * s1x;
      const w = w0 * (1 + this.o.widen * i / (K - 1)) * 0.5;
      const v0 = i * 6, v1 = (K + i) * 6;
      vp[v0] = P[o] - s1x * w; vp[v0 + 1] = P[o + 1] - s1y * w; vp[v0 + 2] = P[o + 2] - s1z * w;
      vp[v0 + 3] = P[o] + s1x * w; vp[v0 + 4] = P[o + 1] + s1y * w; vp[v0 + 5] = P[o + 2] + s1z * w;
      vp[v1] = P[o] - s2x * w; vp[v1 + 1] = P[o + 1] - s2y * w; vp[v1 + 2] = P[o + 2] - s2z * w;
      vp[v1 + 3] = P[o] + s2x * w; vp[v1 + 4] = P[o + 1] + s2y * w; vp[v1 + 5] = P[o + 2] + s2z * w;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.uOpacity.value = (this.o.opacity ?? 1) * (0.25 + 0.75 * this.flow);
  }
}
