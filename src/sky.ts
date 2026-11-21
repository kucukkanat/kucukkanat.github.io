// The sky outside the stern windows: a painted backdrop, then depth layers in front of it —
// big near islands, mid islands, far hazy silhouettes, banks of cloud between them, balloons, airships, birds.
// Everything fades toward the backdrop's own colour with distance (aerial perspective), so the layers separate
// and the far ones melt into the painting. One shared shader state follows sunset / night / storm.
//
// Models: /assets/sky.glb (both tiers) and /assets/sky_full.glb (full tier only, loaded here).
// They carry painted vertex colours (sRGB bytes; alpha 0 = glows at night) and no normals: shaded flat here.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadTexture, loadGLB } from './scene';
import { uNight, uStorm, uFlash } from './lighting';
import { softDot } from './labels';
import { damp, tween, reducedMotion } from './anim';
import { FULL } from './tier';

export interface Sky {
  group: THREE.Group;
  update(t: number, dt: number): void;
  /** Wheel → swing the view outside. */
  setYaw(rad: number): void;
  /** Ship motion: the outside world's rotation as seen from the cabin, and the ship's heave (m). */
  setShip(q: THREE.Quaternion, heave: number): void;
  /** Night backdrop (after the first frame). Idempotent. */
  loadNight(): Promise<void>;
  /** Storm backdrop (after the first frame). Idempotent; gradient fallback when missing. */
  loadStorm(): Promise<void>;
  /** Islands, balloons, airships and clouds from sky.glb (after the first frame); procedural ones if it is missing.
   *  On the full tier this also fetches sky_full.glb. */
  addModels(gltf: GLTF | null): void;
}

// ───────────────────────────────────────────────────────────────── tunables
/** Backdrop cylinder radius around the anchor (m). */
const R = 22;
const ARC = 3.2, BACKDROP_Y = 1.5, BACKDROP_H = R * 1.3;
/** Where the painted sun sits on sky_sunset.jpg (u from the left, v from the bottom). */
const SUN_UV: [number, number] = [0.655, 0.416];
/** Distance from the camera (m) where the haze starts / is complete, and how much of it is ever applied. */
const HAZE_NEAR = 11, HAZE_FAR = 34, HAZE_MAX = 0.9;
/** Direction the warm light comes from (world space; the painted sun is low on the right). */
const SUN_DIR = new THREE.Vector3(0.88, 0.46, 0.1).normalize();
/** Sideways wander of the whole view (m): near things slide more than far ones → parallax. */
const WANDER = 1.2;
/** Where the overview camera sits relative to the sky anchor (used only to size parallax). */
const CAM_Z = 8.35;
const COLORS = {
  litSun: '#fff0d2', litSunGain: 1.45, shadeSun: '#8f7fc4', bounce: '#5a2f2c',
  litNight: '#6f86c2', shadeNight: '#262a52', litStorm: '#aeb8c8', shadeStorm: '#687080',
  glow: '#ffb45e',
  cloudLit: '#fff0cf', cloudMid: '#f6b08e', cloudShade: '#a87aa6',
  cloudLitNight: '#5a6490', cloudMidNight: '#262c52', cloudShadeNight: '#141832',
  cloudLitStorm: '#7e8a94', cloudMidStorm: '#4a535f', cloudShadeStorm: '#2a303a',
  bird: '#3a2a3e',
};

type Motion = 'island' | 'balloon' | 'airship';
interface Place {
  proto: string; kind: Motion; full?: boolean;
  /** Anchor-relative position (m): −z is away from the cabin, the backdrop is at z ≈ −R. */
  x: number; y: number; z: number; s: number; rot?: number;
  /** island: sway (m); balloon / airship: loop radii (m), period (s) and start angle (rad). */
  sway?: number; rx?: number; rz?: number; period?: number; a0?: number;
}
/** The composition. Lite draws the entries without `full`. */
const LAYOUT: Place[] = [
  // near: two big islands (the citadel fills most of a left pane, the town sits right of centre)
  { proto: 'SKY_island_5', kind: 'island', x: -3.5, y: 0.0, z: -4.7, s: 0.7, rot: 0.15, sway: 0.25 },
  { proto: 'SKY_island_6', kind: 'island', x: 2.7, y: -0.3, z: -6.9, s: 0.5, rot: -0.2, sway: 0.22 },
  { proto: 'SKY_rocks_1', kind: 'island', full: true, x: -1.5, y: 1.75, z: -4.0, s: 0.5, rot: 0.6, sway: 0.3 },
  // mid
  { proto: 'SKY_island_3', kind: 'island', x: -1.5, y: 2.0, z: -12.6, s: 1.0, rot: 0.5, sway: 0.18 },
  { proto: 'SKY_island_2', kind: 'island', x: 6.6, y: 1.1, z: -12.6, s: 1.2, rot: -0.9, sway: 0.18 },
  { proto: 'SKY_island_4', kind: 'island', x: -2.9, y: -1.0, z: -9.2, s: 1.1, rot: 1.1, sway: 0.18 },
  { proto: 'SKY_island_7', kind: 'island', full: true, x: 0.45, y: -1.5, z: -9.0, s: 0.8, rot: -0.4, sway: 0.18 },
  { proto: 'SKY_island_1', kind: 'island', full: true, x: 1.25, y: 3.3, z: -15.6, s: 1.0, rot: 0.3, sway: 0.15 },
  // far silhouettes (small, mostly haze)
  { proto: 'SKY_island_5', kind: 'island', x: 3.5, y: 1.2, z: -20.4, s: 0.8, rot: 2.0, sway: 0.1 },
  { proto: 'SKY_island_3', kind: 'island', x: -5.8, y: 2.6, z: -19.0, s: 0.9, rot: 1.2, sway: 0.1 },
  { proto: 'SKY_island_6', kind: 'island', full: true, x: -9.2, y: 0.4, z: -17.0, s: 0.7, rot: 0.4, sway: 0.1 },
  { proto: 'SKY_island_1', kind: 'island', full: true, x: 6.7, y: 4.2, z: -20.9, s: 0.9, rot: -1.0, sway: 0.1 },
  // life: balloons and airships on slow loops (x/y/z = loop centre)
  { proto: 'SKY_balloon_1', kind: 'balloon', x: 0.3, y: 0.6, z: -7.5, s: 1.1, rx: 2.6, rz: 1.4, period: 260, a0: 1.93 },
  { proto: 'SKY_balloon_2', kind: 'balloon', x: 4.5, y: 3.0, z: -11.0, s: 0.9, rx: 2.0, rz: 1.4, period: 340, a0: 2.6 },
  { proto: 'SKY_balloon_3', kind: 'balloon', full: true, x: -6.5, y: 2.6, z: -14.5, s: 0.8, rx: 2.2, rz: 1.6, period: 300, a0: 2.0 },
  { proto: 'SKY_balloon_4', kind: 'balloon', full: true, x: -1.0, y: 3.4, z: -18.5, s: 1.3, rx: 3.5, rz: 1.5, period: 420, a0: 2.4 },
  { proto: 'SKY_airship', kind: 'airship', x: 1.0, y: 2.45, z: -10.0, s: 0.9, rx: 6.0, rz: 2.0, period: 200, a0: 0.75 },
  { proto: 'SKY_airship_2', kind: 'airship', full: true, x: -2.0, y: 3.9, z: -16.5, s: 1.1, rx: 8.0, rz: 2.5, period: -320, a0: 2.4 },
];
/** Cloud cards: [x, y, z, width, height, atlas cell (0 heaped, 1 long, 2 cumulus, 3 streak), drift m/s, opacity, lite?]. */
const CLOUDS: [number, number, number, number, number, number, number, number, boolean][] = [
  // in front of everything, just above the sill
  [-3.0, -1.5, -2.0, 7.5, 2.6, 1, 0.10, 0.95, true],
  [3.6, -1.6, -2.4, 7.0, 2.6, 0, 0.09, 0.95, true],
  // between the near and the mid islands
  [-5.5, -0.9, -10.3, 10, 3.6, 0, 0.06, 0.95, true],
  [4.5, -1.1, -10.6, 11, 3.6, 1, 0.055, 0.95, true],
  [0.0, -1.3, -10.0, 9, 3.2, 0, 0.065, 0.9, false],
  // between the mid islands and the far silhouettes
  [-2.0, -1.0, -15.9, 14, 4.6, 0, 0.035, 0.95, true],
  [8.5, -1.2, -16.2, 13, 4.2, 1, 0.03, 0.95, true],
  [-11.0, -1.2, -16.4, 13, 4.4, 0, 0.032, 0.95, false],
  // behind the far silhouettes
  [3.0, -0.9, -23.0, 18, 6.0, 0, 0.02, 0.9, true],
  [-10.0, -1.1, -23.5, 18, 5.5, 1, 0.018, 0.9, false],
  // loose cumulus and high streaks
  [-8.5, 3.6, -15.0, 5.0, 2.4, 2, 0.045, 0.85, false],
  [9.0, 5.0, -18.0, 6.0, 2.8, 2, 0.03, 0.85, false],
  [2.0, 4.6, -9.0, 7.0, 1.8, 3, 0.07, 0.7, false],
  [-4.0, 5.6, -14.0, 9.0, 2.2, 3, 0.04, 0.7, true],
];

// ───────────────────────────────────────────────────────────────── shader chunks
/** Colour of the painted backdrop behind a point (blurred), as seen from the camera: the haze colour. */
const HAZE_VERT = /* glsl */`
  uniform sampler2D tSunset; uniform sampler2D tNight; uniform sampler2D tStorm;
  uniform float uNight; uniform float uStorm; uniform float uFlash;
  uniform float uHasSunset; uniform float uHasNight; uniform float uHasStorm; uniform float uYaw;
  uniform mat4 uSkyInv; uniform vec3 uHaze; // near, far, max
  vec3 gradSunset(float y) {
    vec3 c = mix(vec3(1.0, 0.80, 0.52), vec3(0.96, 0.62, 0.58), smoothstep(0.25, 0.5, y));
    return mix(c, vec3(0.55, 0.47, 0.75), smoothstep(0.5, 0.95, y));
  }
  vec3 gradNight(float y) {
    vec3 c = mix(vec3(0.33, 0.27, 0.45), vec3(0.12, 0.14, 0.30), smoothstep(0.25, 0.6, y));
    return mix(c, vec3(0.04, 0.05, 0.13), smoothstep(0.6, 1.0, y));
  }
  vec3 gradStorm(float y) {
    vec3 c = mix(vec3(0.36, 0.38, 0.44), vec3(0.22, 0.24, 0.31), smoothstep(0.2, 0.6, y));
    return mix(c, vec3(0.12, 0.13, 0.18), smoothstep(0.6, 1.0, y));
  }
  vec3 skyHaze(vec3 world) {
    vec3 p = (uSkyInv * vec4(world, 1.0)).xyz;
    vec3 o = (uSkyInv * vec4(cameraPosition, 1.0)).xyz;
    vec3 d = p - o;
    float a = max(dot(d.xz, d.xz), 1e-5), b = dot(o.xz, d.xz), c = dot(o.xz, o.xz) - ${(R * R).toFixed(1)};
    float t = (-b + sqrt(max(b * b - a * c, 0.0))) / a;
    vec3 h = o + d * t;
    vec2 uv = vec2(1.0 - (atan(-h.x, -h.z) + ${(ARC / 2).toFixed(3)}) / ${ARC.toFixed(3)} + uYaw,
                   clamp((h.y - ${BACKDROP_Y.toFixed(2)}) / ${BACKDROP_H.toFixed(2)} + 0.5, 0.02, 0.98));
    const float LOD = 4.5;
    vec3 s0 = uHasSunset > 0.5 ? textureLod(tSunset, uv, LOD).rgb : gradSunset(uv.y);
    vec3 s1 = uHasNight > 0.5 ? textureLod(tNight, uv, LOD).rgb : gradNight(uv.y);
    vec3 s2 = uHasStorm > 0.5 ? textureLod(tStorm, uv, LOD).rgb : gradStorm(uv.y);
    vec3 col = mix(mix(s0, s1, uNight), s2 * mix(1.0, 0.45, uNight), uStorm);
    return col + uFlash * vec3(0.75, 0.8, 0.95) * 0.45;
  }
  float hazeAmount(float dist) {
    float k = mix(0.06, uHaze.z, smoothstep(uHaze.x, uHaze.y, dist));
    return clamp(k + uStorm * (0.22 + 0.3 * k), 0.0, 0.97);   // a storm thickens the air
  }`;

let sunsetP: Promise<THREE.Texture | null> | null = null;
/** Start fetching the sunset backdrop before the cabin has arrived (main.ts calls this first thing). */
export function prefetchSky() { sunsetP ??= loadTexture('/assets/sky_sunset.jpg'); }

export async function setupSky(scene: THREE.Scene, anchor: THREE.Vector3): Promise<Sky> {
  const group = new THREE.Group();
  group.name = 'Sky';
  group.position.copy(anchor);
  scene.add(group);

  // Only the sunset backdrop is needed for the first view; night and storm stream in later.
  const sunsetTex = await (sunsetP ?? loadTexture('/assets/sky_sunset.jpg'));
  const prep = (t: THREE.Texture | null) => { if (t) { t.wrapS = THREE.MirroredRepeatWrapping; t.needsUpdate = true; } return t; };
  prep(sunsetTex);
  const lin = (hex: string, gain = 1) => new THREE.Color(hex).multiplyScalar(gain);
  // One set of uniform objects shared by every sky material.
  const U = {
    uNight, uStorm, uFlash,
    tSunset: { value: sunsetTex },
    tNight: { value: sunsetTex },
    tStorm: { value: sunsetTex },
    uHasSunset: { value: sunsetTex ? 1 : 0 },
    uHasNight: { value: 0 },
    uHasStorm: { value: 0 },
    uYaw: { value: 0 },
    uSun: { value: new THREE.Vector2(...SUN_UV) },
    uSkyInv: { value: new THREE.Matrix4() },
    uHaze: { value: new THREE.Vector3(HAZE_NEAR, HAZE_FAR, HAZE_MAX) },
    uSunDir: { value: SUN_DIR },
    uSkyT: { value: 0 },
    uWander: { value: 0 },
    uFade: { value: 0 },
    uViewH: { value: 800 },
    uLitSun: { value: lin(COLORS.litSun, COLORS.litSunGain) }, uShadeSun: { value: lin(COLORS.shadeSun) },
    uBounce: { value: lin(COLORS.bounce) },
    uLitNight: { value: lin(COLORS.litNight) }, uShadeNight: { value: lin(COLORS.shadeNight) },
    uLitStorm: { value: lin(COLORS.litStorm) }, uShadeStorm: { value: lin(COLORS.shadeStorm) },
    uGlowCol: { value: lin(COLORS.glow) },
    uBird: { value: lin(COLORS.bird) },
    uCloud: { value: [COLORS.cloudShade, COLORS.cloudMid, COLORS.cloudLit, COLORS.cloudShadeNight, COLORS.cloudMidNight,
      COLORS.cloudLitNight, COLORS.cloudShadeStorm, COLORS.cloudMidStorm, COLORS.cloudLitStorm].map(h => lin(h)) },
    tClouds: { value: null as THREE.Texture | null },
  };

  // Curved backdrop: a cylinder arc around the anchor, seen from inside.
  const geo = new THREE.CylinderGeometry(R, R, BACKDROP_H, 48, 1, true, Math.PI - ARC / 2, ARC);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: U,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tSunset; uniform sampler2D tNight; uniform sampler2D tStorm;
      uniform float uNight; uniform float uStorm; uniform float uFlash;
      uniform float uHasSunset; uniform float uHasNight; uniform float uHasStorm; uniform float uYaw;
      uniform vec2 uSun;
      varying vec2 vUv;
      vec3 gradSunset(float y) {
        vec3 c = mix(vec3(1.0, 0.80, 0.52), vec3(0.96, 0.62, 0.58), smoothstep(0.25, 0.5, y));
        c = mix(c, vec3(0.55, 0.47, 0.75), smoothstep(0.5, 0.95, y));
        return c;
      }
      vec3 gradNight(float y) {
        vec3 c = mix(vec3(0.33, 0.27, 0.45), vec3(0.12, 0.14, 0.30), smoothstep(0.25, 0.6, y));
        return mix(c, vec3(0.04, 0.05, 0.13), smoothstep(0.6, 1.0, y));
      }
      vec3 gradStorm(float y) {
        vec3 c = mix(vec3(0.36, 0.38, 0.44), vec3(0.22, 0.24, 0.31), smoothstep(0.2, 0.6, y));
        return mix(c, vec3(0.12, 0.13, 0.18), smoothstep(0.6, 1.0, y));
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 uv = vec2(1.0 - vUv.x + uYaw, vUv.y);
        vec3 a = uHasSunset > 0.5 ? texture2D(tSunset, uv).rgb : gradSunset(uv.y);
        // the low sun: a brighter disc and a soft glow over the painted one (the texture repeats mirrored)
        vec2 sd = (vec2(abs(mod(uv.x + 1.0, 2.0) - 1.0), uv.y) - uSun) * vec2(${(R * ARC / BACKDROP_H).toFixed(3)}, 1.0);
        float sr = length(sd);
        a += vec3(1.0, 0.93, 0.74) * 0.5 * smoothstep(0.032, 0.022, sr)
           + vec3(1.0, 0.78, 0.46) * (0.34 * exp(-sr * sr / 0.018) + 0.12 * exp(-sr / 0.22));
        vec3 b = uHasNight > 0.5 ? texture2D(tNight, uv).rgb : gradNight(uv.y);
        if (uHasNight < 0.5) {
          vec2 g = floor(uv * vec2(420.0, 160.0));
          float s = step(0.996, hash(g)) * smoothstep(0.45, 0.8, uv.y);
          b += vec3(s);
        }
        vec3 c = mix(a, b, uNight);
        vec3 s = uHasStorm > 0.5 ? texture2D(tStorm, uv).rgb : gradStorm(uv.y);
        s *= mix(1.0, 0.45, uNight);
        c = mix(c, s, uStorm);
        c += uFlash * vec3(0.75, 0.8, 0.95) * (0.4 + 0.6 * uv.y);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  // textures are sRGB; the shader samples linear values, output converts back.
  const backdrop = new THREE.Mesh(geo, mat);
  backdrop.position.y = BACKDROP_Y;
  backdrop.renderOrder = -10;
  backdrop.frustumCulled = false;
  group.add(backdrop);

  // ── painted low-poly models: flat shading from derivatives, warm light / violet shadow, haze, night lights
  const paintMat = new THREE.ShaderMaterial({
    uniforms: U,
    fog: false,
    vertexShader: /* glsl */`
      attribute vec4 color;
      ${HAZE_VERT}
      varying vec3 vView; varying vec4 vCol; varying vec3 vHaze; varying float vHazeK;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        vView = mv.xyz;
        vCol = color;
        vHaze = skyHaze(wp.xyz);
        vHazeK = hazeAmount(length(mv.xyz));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight; uniform float uStorm; uniform float uFlash; uniform float uFade;
      uniform vec3 uSunDir; uniform vec3 uLitSun; uniform vec3 uShadeSun; uniform vec3 uBounce;
      uniform vec3 uLitNight; uniform vec3 uShadeNight; uniform vec3 uLitStorm; uniform vec3 uShadeStorm; uniform vec3 uGlowCol;
      varying vec3 vView; varying vec4 vCol; varying vec3 vHaze; varying float vHazeK;
      void main() {
        vec3 nx = cross(dFdx(vView), dFdy(vView));
        vec3 n = nx / max(length(nx), 1e-9); // degenerate triangles must not turn into NaN (bloom would spread it)
        vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float up = dot(n, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
        float lit = smoothstep(-0.2, 0.6, dot(n, L));
        vec3 alb = pow(max(vCol.rgb, vec3(0.0)), vec3(2.2));
        float dim = mix(1.0, 0.5, uNight);
        vec3 litC = mix(mix(uLitSun, uLitNight, uNight), uLitStorm * dim, uStorm);
        vec3 shC = mix(mix(uShadeSun, uShadeNight, uNight), uShadeStorm * dim, uStorm);
        // warm light side, cool violet shadow side, a little rose bounce from the cloud sea on undersides
        vec3 c = alb * (mix(shC, litC, lit) + uBounce * max(-up, 0.0) * (1.0 - uNight) * (1.0 - uStorm));
        c += alb * uFlash * 0.7;
        // windows, lamps and burners: warm at dusk, glowing at night and in a storm
        float glow = 1.0 - vCol.a;
        float on = max(uNight, uStorm * 0.7);
        c = mix(c, uGlowCol * (0.85 + 1.9 * on), glow);
        c = mix(c, vHaze, vHazeK * (1.0 - 0.55 * glow * on));
        c = mix(vHaze, c, uFade);   // arriving after the first frame: they come out of the haze
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  // ── cloud cards: one mesh, drift + wrap in the vertex shader, sorted far → near once
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: U,
    fog: false,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec2 aOff; attribute vec4 aDrift; // speed, span, phase, opacity
      uniform float uSkyT; uniform float uWander;
      ${HAZE_VERT}
      varying vec2 vUv; varying float vA; varying vec3 vHaze; varying float vHazeK;
      void main() {
        float u = fract(uSkyT * aDrift.x / aDrift.y + aDrift.z);
        vec3 p = vec3((u - 0.5) * aDrift.y + aOff.x + uWander * (1.0 - (${CAM_Z.toFixed(2)} - position.z) / 30.0),
                      position.y + aOff.y, position.z);
        vUv = uv;
        vA = aDrift.w * smoothstep(0.0, 0.08, u) * smoothstep(1.0, 0.92, u);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * wp;
        vHaze = skyHaze(wp.xyz);
        vHazeK = hazeAmount(length(mv.xyz));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tClouds; uniform vec3 uCloud[9];
      uniform float uNight; uniform float uStorm; uniform float uFlash; uniform float uFade;
      varying vec2 vUv; varying float vA; varying vec3 vHaze; varying float vHazeK;
      vec3 ramp(vec3 lo, vec3 mid, vec3 hi, float s) { return s < 0.5 ? mix(lo, mid, s * 2.0) : mix(mid, hi, s * 2.0 - 1.0); }
      void main() {
        vec4 tx = texture2D(tClouds, vUv);
        float a = tx.a * vA * uFade;
        if (a < 0.004) discard;
        float s = tx.r;
        vec3 c = ramp(uCloud[0], uCloud[1], uCloud[2], s);
        c = mix(c, ramp(uCloud[3], uCloud[4], uCloud[5], s), uNight);
        c = mix(c, ramp(uCloud[6], uCloud[7], uCloud[8], s) * mix(1.0, 0.5, uNight), uStorm);
        c += uFlash * vec3(0.5, 0.54, 0.62) * (0.3 + 0.7 * s);
        // far banks take the colour of the painting behind them, keeping a little of their own light
        c = mix(c, vHaze * (0.84 + 0.34 * s), vHazeK * 0.65);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });

  // ── birds: one tiny mesh, wings flap in the vertex shader
  const birdMat = new THREE.ShaderMaterial({
    uniforms: U,
    fog: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute vec2 aBird; // wing tip (0 | 1), phase
      uniform float uSkyT;
      ${HAZE_VERT}
      varying vec3 vHaze; varying float vHazeK;
      void main() {
        vec3 p = position;
        p.y += aBird.x * sin(uSkyT * 6.5 + aBird.y) * 0.1 + sin(uSkyT * 0.8 + aBird.y) * 0.06;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * wp;
        vHaze = skyHaze(wp.xyz);
        vHazeK = hazeAmount(length(mv.xyz));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uBird; uniform float uNight; uniform float uFade;
      varying vec3 vHaze; varying float vHazeK;
      void main() {
        if (uFade < 0.5) discard;
        gl_FragColor = vec4(mix(uBird * (1.0 - 0.6 * uNight), vHaze, max(vHazeK, 0.25)), 1.0);
        #include <colorspace_fragment>
      }`,
  });

  // ── night lights (full tier): soft additive dots at the lamps / burners / windows listed in the GLB extras
  const glowMat = new THREE.ShaderMaterial({
    uniforms: U,
    fog: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aSize;
      uniform float uViewH; uniform float uStorm; uniform vec3 uHaze;
      varying float vK;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = length(mv.xyz);
        vK = 1.0 - 0.6 * smoothstep(uHaze.x, uHaze.y, d);
        gl_PointSize = min(aSize * length(modelMatrix[0].xyz) * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1), 96.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uGlowCol; uniform float uNight; uniform float uStorm; uniform float uFade;
      varying float vK;
      void main() {
        vec2 q = gl_PointCoord * 2.0 - 1.0;
        float a = max(exp(-dot(q, q) * 5.0) - 0.007, 0.0) * 0.8;
        float on = 0.08 + 0.92 * max(uNight, uStorm * 0.6);
        gl_FragColor = vec4(uGlowCol * a * on * vK * uFade, 1.0);
        #include <colorspace_fragment>
      }`,
  });

  // ── placed things
  interface Proto { geo: THREE.BufferGeometry; pos: THREE.Vector3; scale: THREE.Vector3; glow: THREE.BufferGeometry | null; }
  interface Mover { o: THREE.Object3D; p: Place; par: number; ph: number; }
  const movers: Mover[] = [];
  const placed = new Set<string>();
  let birds: THREE.Object3D | null = null;
  let lastT = 0;

  const readProtos = (gltf: GLTF, into: Map<string, Proto>) => {
    gltf.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !/^SKY_(island|balloon|airship|rocks)/.test(o.name)) return;
      let glow: THREE.BufferGeometry | null = null;
      const pts = (o.userData as { glow?: number[][] }).glow;
      if (FULL && pts?.length) {
        glow = new THREE.BufferGeometry();
        glow.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(g => [g[0], g[1], g[2]]), 3));
        glow.setAttribute('aSize', new THREE.Float32BufferAttribute(pts.map(g => g[3]), 1));
      }
      into.set(o.name, { geo: m.geometry, pos: o.position.clone(), scale: o.scale.clone(), glow });
    });
  };

  /** Pose every drifting thing for time t (no allocations). */
  const pose = (t: number) => {
    const w = WANDER * (0.7 * Math.sin(t * 0.045) + 0.3 * Math.sin(t * 0.11 + 1.3));
    U.uWander.value = w;
    U.uSkyT.value = t;
    for (let i = 0; i < movers.length; i++) {
      const { o, p, par, ph } = movers[i];
      if (p.kind === 'island') {
        const a = p.sway ?? 0;
        o.position.set(p.x + w * par + a * Math.sin(t * 0.07 + ph), p.y + a * 0.5 * Math.sin(t * 0.11 + ph * 1.7), p.z);
        o.rotation.y = (p.rot ?? 0) + 0.12 * Math.sin(t * 0.05 + ph * 2.3);
      } else {
        const ang = (p.a0 ?? 0) + t * (Math.PI * 2) / (p.period ?? 240);
        const cs = Math.cos(ang), sn = Math.sin(ang), rx = p.rx ?? 3, rz = p.rz ?? 1.5;
        o.position.set(p.x + w * par + rx * cs, p.y + 0.22 * Math.sin(t * 0.23 + ph), p.z + rz * sn);
        if (p.kind === 'airship') {
          const dir = (p.period ?? 1) < 0 ? -1 : 1;   // nose (+X) along the direction of travel
          o.rotation.y = Math.atan2(-rz * cs * dir, -rx * sn * dir);
          o.rotation.z = 0.03 * Math.sin(t * 0.31 + ph);
        } else {
          o.rotation.y = (p.rot ?? 0) + t * 0.02;
          o.rotation.z = 0.035 * Math.sin(t * 0.19 + ph);
        }
      }
    }
    if (birds) {
      const ang = 0.6 + t * (Math.PI * 2) / 95;
      birds.position.set(1.5 + 4.5 * Math.cos(ang) + w * 0.6, 2.2 + 0.4 * Math.sin(t * 0.13), -5.5 + 2.0 * Math.sin(ang));
      birds.rotation.y = Math.atan2(-2.0 * Math.cos(ang), -4.5 * Math.sin(ang));
    }
  };

  const place = (protos: Map<string, Proto>) => {
    LAYOUT.forEach((p, i) => {
      const key = `${i}`;
      if (placed.has(key) || (p.full && !FULL)) return;
      const proto = protos.get(p.proto);
      if (!proto) return;
      placed.add(key);
      const holder = new THREE.Group();
      holder.name = p.proto;
      const mesh = new THREE.Mesh(proto.geo, paintMat);
      mesh.position.copy(proto.pos);
      mesh.scale.copy(proto.scale);
      holder.add(mesh);
      if (proto.glow) {
        const pts = new THREE.Points(proto.glow, glowMat);
        pts.renderOrder = -4;
        holder.add(pts);
      }
      holder.scale.setScalar(p.s);
      group.add(holder);
      movers.push({ o: holder, p, par: 1 - (CAM_Z - p.z) / 30, ph: i * 1.618 });
    });
    pose(lastT);
  };

  const buildClouds = (atlas: THREE.Texture | null) => {
    const cards = CLOUDS.filter(c => FULL || c[8]).sort((a, b) => a[2] - b[2]);   // far first: blends correctly
    const n = cards.length;
    const pos = new Float32Array(n * 12), off = new Float32Array(n * 8), uv = new Float32Array(n * 8), drift = new Float32Array(n * 16);
    const idx = new Uint16Array(n * 6);
    cards.forEach(([x, y, z, w, h, cell, speed, opacity], i) => {
      const span = 2 * (0.42 * (CAM_Z - z) + w / 2 + 2.5);     // wraps outside the windows' view
      const phase = x / span + 0.5;
      const col = cell % 2, row = cell >> 1, flip = i % 3 === 1;
      for (let k = 0; k < 4; k++) {
        const cx = k === 0 || k === 3 ? -1 : 1, cy = k < 2 ? -1 : 1;
        pos.set([0, y, z], (i * 4 + k) * 3);
        off.set([cx * w / 2, cy * h / 2], (i * 4 + k) * 2);
        const uu = (flip ? -cx : cx) * 0.5 + 0.5, vv = 1 - (cy * 0.5 + 0.5);
        uv.set(atlas ? [(col + uu) / 2, (row + vv) / 2] : [uu, vv], (i * 4 + k) * 2);
        drift.set([speed, span, phase, opacity], (i * 4 + k) * 4);
      }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(off, 2));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aDrift', new THREE.BufferAttribute(drift, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (atlas) { atlas.colorSpace = THREE.NoColorSpace; atlas.needsUpdate = true; }   // R = shade (data), A = coverage
    U.tClouds.value = atlas ?? softDot(128, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
    const m = new THREE.Mesh(g, cloudMat);
    m.name = 'SkyClouds';
    m.frustumCulled = false;
    m.renderOrder = -5;
    group.add(m);
  };

  const buildBirds = () => {
    const n = FULL ? 9 : 6;
    const pos: number[] = [], ab: number[] = [], idx: number[] = [];
    for (let i = 0; i < n; i++) {
      // a loose V behind the leader, heading +X
      const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
      const bx = -row * 0.34 + Math.sin(i * 12.9) * 0.1, by = Math.sin(i * 7.3) * 0.12, bz = side * row * 0.3;
      const ph = i * 2.4;
      pos.push(bx + 0.07, by, bz, bx - 0.07, by, bz, bx - 0.02, by + 0.02, bz - 0.19, bx - 0.02, by + 0.02, bz + 0.19);
      ab.push(0, ph, 0, ph, 1, ph, 1, ph);
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aBird', new THREE.Float32BufferAttribute(ab, 2));
    g.setIndex(idx);
    birds = new THREE.Mesh(g, birdMat);
    birds.name = 'SkyBirds';
    birds.frustumCulled = false;
    birds.scale.setScalar(0.8);
    group.add(birds);
  };

  let started = false;
  const addModels = (skyGltf: GLTF | null) => {
    if (started) return;
    started = true;
    const protos = new Map<string, Proto>();
    let atlas: THREE.Texture | null = null;
    if (skyGltf) {
      readProtos(skyGltf, protos);
      const cm = skyGltf.scene.getObjectByName('SKY_clouds') as THREE.Mesh | undefined;
      atlas = (cm?.material as THREE.MeshStandardMaterial | undefined)?.map ?? null;
    }
    if (protos.size) place(protos);
    else proceduralFallback(group);
    buildClouds(atlas);
    buildBirds();
    pose(lastT);
    // they arrive after the first frame: fade in (models emerge from the haze colour, clouds by alpha)
    void tween(1.8, k => { U.uFade.value = k; });
    if (FULL && protos.size) {
      void loadGLB('/assets/sky_full.glb').then(g => {
        if (!g) return;
        readProtos(g, protos);
        place(protos);
      });
    }
  };

  let yaw = 0, yawTarget = 0;
  // the ship rolls/pitches about its middle; the outside world turns the other way around that point
  const pivot = new THREE.Vector3(0, 1.4, 0);
  const shipQ = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  let heave = 0;
  const place0 = () => {
    yawQ.setFromAxisAngle(yAxis, yaw);
    group.quaternion.copy(shipQ).multiply(yawQ);
    group.position.copy(anchor).sub(pivot).applyQuaternion(shipQ).add(pivot);
    group.position.y -= heave;
    group.updateMatrix();
    U.uSkyInv.value.copy(group.matrix).invert();
  };
  const viewH = () => { U.uViewH.value = innerHeight * Math.min(devicePixelRatio || 1, 2); };
  viewH();
  addEventListener('resize', viewH, { passive: true });
  const update = (t: number, dt: number) => {
    yaw = damp(yaw, yawTarget, 3, dt);
    place0();
    U.uYaw.value = -yaw / ARC * 0.5;
    if (reducedMotion) return;     // no drifting
    lastT = t;
    pose(t);
  };
  let nightLoad: Promise<void> | null = null, stormLoad: Promise<void> | null = null;
  const loadNight = () => nightLoad ??= loadTexture('/assets/sky_night.jpg').then(t => {
    if (!prep(t)) return;
    U.tNight.value = t; U.uHasNight.value = 1;
  });
  const loadStorm = () => stormLoad ??= loadTexture('/assets/sky_storm.jpg').then(t => {
    if (!prep(t)) return;
    U.tStorm.value = t; U.uHasStorm.value = 1;
  });
  const setShip = (q: THREE.Quaternion, h: number) => { shipQ.copy(q); heave = h; place0(); };
  place0();
  return { group, update, setYaw: r => { yawTarget = r; }, setShip, loadNight, loadStorm, addModels };
}

/** sky.glb missing: a few plain islands so the windows are not empty. */
function proceduralFallback(group: THREE.Group) {
  const rock = new THREE.MeshStandardMaterial({ color: '#8a6170', roughness: 1, flatShading: true });
  const grass = new THREE.MeshStandardMaterial({ color: '#86a86a', roughness: 1, flatShading: true });
  const spots: [number, number, number, number][] = [[-3.2, -0.6, -6, 1.4], [3.4, 0.5, -9, 1.2], [-0.5, 1.6, -13, 1.8], [6.5, 2.2, -14, 1.3]];
  for (const [x, y, z, r] of spots) {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, r * 2.2, 7), rock);
    cone.rotation.x = Math.PI; cone.position.y = -r * 1.1;
    g.add(cone, new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 0.95, 0.18, 7), grass));
    g.position.set(x, y, z);
    group.add(g);
  }
}
