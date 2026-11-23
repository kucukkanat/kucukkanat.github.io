// The library deck's room (blender/library/build.py → public/assets/library.glb), lit like the cabin (lighting.ts):
// baked meshes become unlit MeshBasicMaterial × lightmap (uv1), mixed between the sunset and night bakes by the
// cabin's own uNight (the lantern), dimmed and cooled by uStorm and lifted by lightning (uFlash). The book runs
// (VC_*) carry the sunset light as COLOR_0 = L / scale, tinted for night.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadTexture } from '../scene';
import { uNight, uStorm, uFlash, uTime } from './time';
import { uBob } from './sway';

type Mode = 'sunset' | 'night';
type LightmapMeta = Record<Mode, { scale: number; books: number[] }>;
export interface Room {
  root: THREE.Object3D;
  get(name: string): THREE.Object3D | undefined;
  /** Per-frame: book tint, porthole sky, lantern glass. */
  update(): void;
}

export async function loadRoom(gltf: GLTF, full: boolean): Promise<Room> {
  const meta = await fetch('/assets/library_lightmaps.json').then(r => r.json() as Promise<LightmapMeta>);
  const [lmSunset, lmNight, skySunset, skyNight] = await Promise.all([
    // literal paths: the build gives them content-hashed names (scripts/hash-assets.ts)
    loadTexture(full ? '/assets/library_lightmap_sunset.ktx2' : '/assets/library_lightmap_sunset_1k.ktx2'),
    loadTexture(full ? '/assets/library_lightmap_night.ktx2' : '/assets/library_lightmap_night_1k.ktx2'),
    loadTexture('/assets/sky_sunset.ktx2'),
    loadTexture('/assets/sky_night.ktx2'),
  ]);
  if (!lmSunset || !lmNight) throw new Error('library lightmaps missing');
  for (const t of [lmSunset, lmNight]) { t.flipY = false; t.channel = 1; t.anisotropy = full ? 8 : 4; }
  const scale = meta.sunset.scale;

  const lmUniforms = { lightMapNight: { value: lmNight }, uNight, uStorm, uFlash, uTime };
  const blend = (mat: THREE.MeshBasicMaterial, flicker: boolean) => {
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, lmUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lightmap_pars_fragment>', `#include <lightmap_pars_fragment>
          uniform sampler2D lightMapNight; uniform float uNight; uniform float uStorm; uniform float uFlash; uniform float uTime;`)
        .replace('vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );', `
          vec4 lightMapTexel = mix( texture2D( lightMap, vLightMapUv ), texture2D( lightMapNight, vLightMapUv ), uNight );
          ${flicker ? 'lightMapTexel.rgb *= 1.0 + uNight * 0.06 * (sin(uTime * 11.0) * 0.5 + sin(uTime * 17.3 + 1.3) * 0.5);' : ''}
          // the storm: greyer, dimmer daylight; lightning through the portholes lifts the whole room for a moment
          lightMapTexel.rgb = mix( lightMapTexel.rgb, vec3(dot(lightMapTexel.rgb, vec3(0.33))) * vec3(0.86, 0.9, 1.0), uStorm * 0.45 * (1.0 - uNight) );
          lightMapTexel.rgb *= (1.0 - 0.25 * uStorm) + uFlash * 0.6;`);
    };
    mat.customProgramCacheKey = () => `deck-lm${flicker ? 'f' : ''}`;
  };

  const books: THREE.MeshBasicMaterial[] = [];
  const glows: THREE.MeshBasicMaterial[] = [];
  const skies: THREE.ShaderMaterial[] = [];
  const cache = new Map<string, THREE.Material>();
  gltf.scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = m.material as THREE.MeshStandardMaterial;
    const top = topName(m);
    if (top.startsWith('STATIC_')) {
      const key = `lm:${src.name}`;
      if (!cache.has(key)) {
        const mat = new THREE.MeshBasicMaterial({ name: src.name, map: src.map, color: src.color, lightMap: lmSunset,
          lightMapIntensity: Math.PI * scale /* stored = L / scale; Basic divides the lightmap by PI */,
          transparent: src.transparent, opacity: src.opacity });
        blend(mat, true);
        if (/Lantern(Glow|Flame)/.test(src.name)) glows.push(mat);
        cache.set(key, mat);
      }
      m.material = cache.get(key)!;
    } else if (top.startsWith('VC_')) {
      const key = `vc:${src.name}`;
      if (!cache.has(key)) {
        const mat = new THREE.MeshBasicMaterial({ name: src.name, map: src.map, color: src.color.clone().multiplyScalar(scale), vertexColors: true });
        mat.userData.base = mat.color.clone();
        books.push(mat);
        cache.set(key, mat);
      }
      m.material = cache.get(key)!;
    } else if (top.startsWith('Sky_backdrop') && skySunset && skyNight) {
      const mat = skyMaterial(skySunset, skyNight);
      skies.push(mat);
      m.material = mat;
    } else if (top === 'Window_glass') {
      m.material = new THREE.MeshBasicMaterial({ color: '#ffd8b8', transparent: true, opacity: 0.12, depthWrite: false });
    }
    // everything else (topic books, the ladder, the desk's lit props) keeps its standard material, lit by roomLights
  });
  for (const g of glows) g.userData.base = g.color.clone();

  const tintOf = (mode: Mode) => {
    const [r, g, b] = meta[mode].books;
    const l = (r + g + b) / 3;
    return new THREE.Color(r, g, b).lerp(new THREE.Color(l, l, l), 0.65);
  };
  const tSunset = tintOf('sunset'), tNight = tintOf('night');
  const tmp = new THREE.Color();
  const byName = new Map<string, THREE.Object3D>();
  gltf.scene.traverse(o => { if (o.name) byName.set(o.name, o); });
  return {
    root: gltf.scene, get: n => byName.get(n),
    update() {
      tmp.copy(tSunset).lerp(tNight, uNight.value).multiplyScalar((1 - 0.25 * uStorm.value) + uFlash.value * 0.6);
      for (const m of books) m.color.copy(m.userData.base as THREE.Color).multiply(tmp);
      for (const s of skies) {
        const k = uNight.value > 0.5 ? 1 : 1 - uNight.value * 1.4;
        (s.uniforms.uTint.value as THREE.Color).setScalar(k * (1 - 0.35 * uStorm.value) + uFlash.value);
      }
      const fl = 1 + 0.12 * Math.sin(uTime.value * 11) * Math.sin(uTime.value * 4.3 + 0.7);
      for (const g of glows) g.color.copy(g.userData.base as THREE.Color).multiplyScalar((1 + 1.6 * uNight.value) * fl);
    },
  };
}

/** The sky outside the portholes: the cabin's painted sky (sunset or night), rising and falling with the ship's
 *  roll, with two layers of cloud wisps streaming past. */
function skyMaterial(sunset: THREE.Texture, night: THREE.Texture) {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { mapSunset: { value: sunset }, mapNight: { value: night }, uTint: { value: new THREE.Color(1, 1, 1) }, uNight, uStorm, uTime, uBob },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D mapSunset; uniform sampler2D mapNight; uniform vec3 uTint;
      uniform float uNight; uniform float uStorm; uniform float uTime; uniform float uBob; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec2 uv = vUv; uv.y = clamp(uv.y + uBob, 0.0, 1.0);
        vec3 sky = (uNight > 0.5 ? texture2D(mapNight, uv) : texture2D(mapSunset, uv)).rgb * uTint;
        float far = fbm(vec2(uv.x * 2.2 + uTime * 0.012, uv.y * 5.0));
        float near = fbm(vec2(uv.x * 1.3 + uTime * 0.045, uv.y * 3.2 + 7.0));
        float band = smoothstep(0.75, 0.15, uv.y);
        float m1 = smoothstep(0.55, 0.78, far) * band * (0.45 + 0.4 * uStorm);
        float m2 = smoothstep(0.6, 0.82, near) * smoothstep(0.6, 0.0, uv.y) * 0.7;
        vec3 lit = mix(vec3(1.0, 0.72, 0.55), vec3(0.22, 0.27, 0.42), uNight);
        vec3 shade = mix(vec3(0.62, 0.4, 0.45), vec3(0.08, 0.1, 0.18), uNight);
        sky = mix(sky, mix(shade, lit, far), m1);
        sky = mix(sky, mix(shade, lit, near * 1.1), m2);
        sky = mix(sky, vec3(dot(sky, vec3(0.33))) * vec3(0.8, 0.86, 1.0), uStorm * 0.7);
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function topName(o: THREE.Object3D): string {
  let p: THREE.Object3D | null = o;
  while (p) { if (/^(STATIC_|VC_|Sky_backdrop|Window_glass)/.test(p.name)) return p.name; p = p.parent; }
  return o.name;
}

/** Dynamic lights for the moving things (the Librarian, a fetched book, the ladder), matched to the bake. */
export function roomLights(parent: THREE.Object3D) {
  const hemi = new THREE.HemisphereLight('#ffcfa0', '#4a3a55', 1.0);
  const sun = new THREE.DirectionalLight('#ffb070', 1.6);
  sun.position.set(4, 1.6, 1.2);
  const lantern = new THREE.PointLight('#ff9a4a', 2.2, 4, 1.6);
  lantern.position.set(-0.15, 0.95, 0.57);
  const hang = new THREE.PointLight('#ffa050', 3.0, 5, 1.6);
  hang.position.set(0.35, 2.67, 0.6);
  hang.name = 'HangingLanternLight';
  parent.add(hemi, sun, lantern, hang);
  const S = { hemiSky: new THREE.Color('#ffcfa0'), hemiGround: new THREE.Color('#4a3a55'), hemi: 1.0, sun: new THREE.Color('#ffb070'), sunI: 1.6, lantern: 2.2, hang: 3.0 };
  const N = { hemiSky: new THREE.Color('#3a4a7a'), hemiGround: new THREE.Color('#1a1420'), hemi: 0.35, sun: new THREE.Color('#9fb6ff'), sunI: 0.15, lantern: 3.6, hang: 5.0 };
  return {
    hang,
    update() {
      const n = uNight.value, st = uStorm.value;
      hemi.color.lerpColors(S.hemiSky, N.hemiSky, n);
      hemi.groundColor.lerpColors(S.hemiGround, N.hemiGround, n);
      hemi.intensity = THREE.MathUtils.lerp(S.hemi, N.hemi, n) * (1 - 0.3 * st) + uFlash.value;
      sun.color.lerpColors(S.sun, N.sun, n);
      sun.intensity = THREE.MathUtils.lerp(S.sunI, N.sunI, n) * (1 - 0.6 * st) + uFlash.value * 2;
      const fl = 1 + 0.15 * n * Math.sin(uTime.value * 9.7) * Math.sin(uTime.value * 3.1 + 0.4);
      lantern.intensity = THREE.MathUtils.lerp(S.lantern, N.lantern, n) * fl;
      hang.intensity = THREE.MathUtils.lerp(S.hang, N.hang, n) * fl;
    },
  };
}
