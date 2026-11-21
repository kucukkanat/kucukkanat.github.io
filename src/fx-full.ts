// Atmosphere, part two (full tier only): bloom, a painted colour grade and a vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { uNight, uStorm } from './lighting';
import { GLOW, CONTRAST, type Fx } from './fx';

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
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uNight, uStorm, uVignette: { value: 0.34 }, uContrast: { value: CONTRAST } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uNight; uniform float uStorm; uniform float uVignette; uniform float uContrast; varying vec2 vUv;
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
      // contrast around mid grey (linear 0.18): darks deeper, lights brighter, mid tones unchanged
      c.rgb = 0.18 * pow(max(c.rgb, vec3(1e-4)) / 0.18, vec3(uContrast));
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.95, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export function setupFullFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Fx {
  let cheap = false;
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
    render: (s, c) => {
      if (cheap) { renderer.render(s, c); return; }
      // lantern, screen and stars bloom more at night; the bright sunset sky only a little
      bloom.strength = (0.24 - 0.04 * uNight.value) * GLOW;
      bloom.threshold = 1.0;
      composer.render();
    },
    resize: (w, h) => { if (cheap) return; composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); },
    cheapen: () => { if (cheap) return; cheap = true; composer.dispose(); target.dispose(); },
    get cheap() { return cheap; },
  };
}
