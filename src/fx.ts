// Atmosphere. Light shafts from the stern windows on both tiers (cheap additive sheets); bloom, a painted colour
// grade and a vignette on the full tier only (tier.ts). The lite tier renders straight to the canvas as before.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FULL } from './tier';
import { uNight, uStorm, uTime, uFlash } from './lighting';

// Window layout (docs/SCENE_CONTRACT.md, blender/kit/layout.py): posts on an arc of radius 3.6 around (0, *, 1).
const ARC_R = 3.6, ARC_CZ = 1.0, SILL = 0.95, TOP = 2.55;
const WIN_EDGES = [-30, -18, -6, 6, 18, 30];
/** Direction the low sun travels (same as the bake rig in blender/kit/lights.py). */
const SUN_DIR = new THREE.Vector3(-0.3, -0.42, 1.0).normalize();
const SHAFT_LEN = 3.4;

const arc = (aDeg: number, y: number) => {
  const a = THREE.MathUtils.degToRad(aDeg);
  return new THREE.Vector3(ARC_R * Math.sin(a), y, ARC_CZ - ARC_R * Math.cos(a));
};

/** Soft sheets of warm light slanting in through each window pane. Fades out at night and in a storm. */
export function setupShafts(scene: THREE.Scene): THREE.Mesh {
  const pos: number[] = [], uv: number[] = [], seed: number[] = [], idx: number[] = [];
  let n = 0;
  const sheet = (a: THREE.Vector3, b: THREE.Vector3, s: number) => {
    const a2 = a.clone().addScaledVector(SUN_DIR, SHAFT_LEN), b2 = b.clone().addScaledVector(SUN_DIR, SHAFT_LEN);
    for (const [p, u, v] of [[a, 0, 0], [b, 1, 0], [b2, 1, 1], [a2, 0, 1]] as const) { pos.push(p.x, p.y, p.z); uv.push(u, v); seed.push(s); }
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    n += 4;
  };
  for (let k = 0; k < WIN_EDGES.length - 1; k++) {
    const a0 = WIN_EDGES[k] + 1.2, a1 = WIN_EDGES[k + 1] - 1.2;
    // three slanted sheets per pane at different heights: together they read as a volume from any angle
    for (const [f, s] of [[0.92, 0.1], [0.62, 0.45], [0.3, 0.8]] as const) {
      const y = SILL + (TOP - SILL) * f;
      sheet(arc(a0, y), arc(a1, y), k * 1.7 + s);
    }
    // and two upright ones through the pane
    for (const f of [0.3, 0.7]) {
      const a = a0 + (a1 - a0) * f;
      sheet(arc(a, SILL + 0.1), arc(a, TOP - 0.05), k * 2.3 + f);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uNight, uStorm, uTime, uFlash, uGain: { value: FULL ? 0.12 : 0.09 } },
    vertexShader: /* glsl */`
      attribute float aSeed; varying vec2 vUv; varying float vSeed; varying float vDist;
      void main() { vUv = uv; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uNight; uniform float uStorm; uniform float uTime; uniform float uFlash; uniform float uGain;
      varying vec2 vUv; varying float vSeed; varying float vDist;
      float hash(float n) { return fract(sin(n * 91.7) * 43758.5453); }
      float streaks(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
      void main() {
        float across = sin(3.14159 * clamp(vUv.x, 0.0, 1.0));
        float along = smoothstep(0.0, 0.3, vUv.y) * pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.6);
        float s = 0.55 + 0.45 * streaks(vUv.x * 9.0 + vSeed * 13.0 + sin(uTime * 0.07 + vSeed) * 0.6);
        float a = across * across * along * s * uGain * (1.0 - uNight) * (1.0 - 0.85 * uStorm)
          * smoothstep(0.7, 2.6, vDist); // no haze when the camera stands in a shaft
        vec3 col = mix(vec3(1.0, 0.66, 0.36), vec3(1.0, 0.82, 0.6), vUv.y);
        gl_FragColor = vec4(col * a + vec3(0.6, 0.7, 1.0) * uFlash * along * across * 0.05, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'LightShafts';
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/** Before the bloom: no NaN, no negatives, no runaway highlights (one bad pixel would smear over the whole frame). */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 v = vec3(c.r == c.r ? c.r : 0.0, c.g == c.g ? c.g : 0.0, c.b == c.b ? c.b : 0.0);
      gl_FragColor = vec4(clamp(v, 0.0, 12.0), 1.0);
    }`,
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uNight, uStorm, uVignette: { value: 0.34 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uNight; uniform float uStorm; uniform float uVignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb = max(c.rgb, vec3(0.0));
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      // painted split tone: shadows lean violet, lights lean gold (cooler at night / in a storm)
      vec3 shadow = mix(vec3(0.94, 0.9, 1.1), vec3(0.9, 0.96, 1.14), max(uNight, uStorm));
      vec3 light = mix(vec3(1.06, 1.0, 0.9), vec3(1.0, 1.0, 1.0), max(uNight, uStorm));
      c.rgb *= mix(shadow, light, smoothstep(0.02, 0.55, l));
      // a little more colour, like gouache
      c.rgb = mix(vec3(l), c.rgb, 1.12);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.95, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export interface Fx {
  /** Render the main view (replaces renderer.render(scene, camera)). */
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  resize(w: number, h: number): void;
}

export function setupFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Fx {
  if (!FULL) return { render: (s, c) => renderer.render(s, c), resize: () => { /* canvas only */ } };
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SanitizeShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());
  return {
    render: () => {
      // lantern, screen and stars bloom more at night; the bright sunset sky only a little
      bloom.strength = 0.24 - 0.04 * uNight.value;
      bloom.threshold = 1.0;
      composer.render();
    },
    resize: (w, h) => { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
  };
}
