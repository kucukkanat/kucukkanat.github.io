import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Cabin } from './scene';
import { loadTexture } from './scene';
import { lerp } from './anim';
import { SIDE } from './look';
import { FULL } from './tier';

/** KTX2 bakes (scripts/ktx2.ts); phones use the half-resolution ones. */
const LM_SUNSET = FULL ? '/assets/lightmap_sunset.ktx2' : '/assets/lightmap_sunset_1k.ktx2';
const LM_NIGHT = FULL ? '/assets/lightmap_night.ktx2' : '/assets/lightmap_night_1k.ktx2';
let lmSunsetP: Promise<THREE.Texture | null> | null = null;
/** Mean brightness of each bake, measured at build time (a compressed texture can't be read back here). */
type LmMeta = Partial<Record<'sunset' | 'night', { mean?: number }>>;
let lmMetaP: Promise<LmMeta> | null = null;
const lmMeta = () => lmMetaP ??= fetch('/assets/lightmaps.json').then(r => r.json() as Promise<LmMeta>).catch((): LmMeta => ({}));
/** Start fetching the sunset lightmap before the cabin has arrived (main.ts calls this first thing). */
export function prefetchLightmap() { lmSunsetP ??= loadTexture(LM_SUNSET); void lmMeta(); }

/** Shared night uniform (0 = sunset, 1 = night). */
export const uNight = { value: 0 };
/** Shared storm uniform (0 = fair weather, 1 = storm) and lightning flash (0..1). */
export const uStorm = { value: 0 };
export const uFlash = { value: 0 };
/** Seconds, frozen under prefers-reduced-motion (static rain). */
export const uTime = { value: 0 };
/** Lantern position (world) for the painted night highlights on brass. */
export const uLanternPos = { value: new THREE.Vector3(-0.55, 1.05, -0.25) };
/** Painted highlight strength per baked material (brass catches the light, polished wood a little). */
const SHEEN: Record<string, number> = { Brass: 1, Gilt: 1.1, Mahogany: 0.2, Iron: 0.35, Glass: 0.5, Leather: 0.1, DarkWood: 0.05 };
/** Close-up detail: the material's own texture, sampled DETAIL_SCALE times finer, multiplied in (high-passed) and faded out
 *  with distance, so painted surfaces keep some grain up close instead of going soft. Strength per material. */
const DETAIL: Record<string, number> = { Planks: 0.32, WallPlanks: 0.3, DarkWood: 0.3, Mahogany: 0.24, Leather: 0.28, Cloth: 0.3, Brass: 0.14, Gilt: 0.14 };
const DETAIL_SCALE = 4.7;
/** Low-frequency brightness variation (fraction, ±) over large tiled surfaces, so the repeat of the texture doesn't show. */
const MACRO: Record<string, number> = { Planks: 0.13, WallPlanks: 0.12, DarkWood: 0.12, Mahogany: 0.07, Leather: 0.06 };
/** Whites and pale golds that must stay white in the warm, violet-shadowed bake (the cadet tunic and its insignia): how far they
 *  are pulled back to a neutral light. */
const LIFT: Record<string, number> = { TunicWhite: 0.85, TunicShade: 0.8, PaleGold: 0.6, BrightGold: 0.4 };
/** Rain slant on the window glass (horizontal drift per metre of fall; follows the ship's roll and the wind). */
export const uRainSlant = { value: 0 };

export interface Lighting {
  baked: boolean;
  setNight(k: number): void;
  setStorm(k: number): void;
  setFlash(k: number): void;
  /** Fetch the night lightmap (after the first frame). Idempotent; resolves when it is in use (or failed). */
  loadNight(): Promise<void>;
  lanternWorld: THREE.Vector3;
  /** Lantern flame flicker, 0 = steady (call every frame). */
  flicker(t: number, amount: number): void;
}

const SUN = new THREE.Color('#ffc796');
const MOON = new THREE.Color('#7f8fd0');

export async function setupLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cabin: Cabin | null): Promise<Lighting> {
  // Small generated environment for the dynamic (standard) materials.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.35;

  // The night lightmap is not needed for the first view: it streams in after the first frame (loadNight).
  const [lmSunset, meta] = await Promise.all([lmSunsetP ?? loadTexture(LM_SUNSET), lmMeta()]);
  const baked = !!lmSunset && !!cabin;
  // Anisotropic filtering: floors and walls are mostly seen at grazing angles, where plain mipmapping blurs them.
  const aniso = Math.min(FULL ? 16 : 4, renderer.capabilities.getMaxAnisotropy());
  const prepLM = (t: THREE.Texture | null) => { if (t) { t.flipY = false; t.channel = 1; t.anisotropy = aniso; t.needsUpdate = true; } return t; };
  const seenTex = new Set<THREE.Texture>();
  cabin?.root.traverse(o => {
    for (const m of ([] as THREE.Material[]).concat((o as THREE.Mesh).material ?? [])) {
      const t = (m as THREE.MeshStandardMaterial).map;
      if (t && !seenTex.has(t)) { seenTex.add(t); t.anisotropy = aniso; t.needsUpdate = true; }
    }
  });
  prepLM(lmSunset);

  // Lights for dynamic objects (and for everything when there is no bake).
  const hemi = new THREE.HemisphereLight('#ffe6d2', '#2a1a14', baked ? 0.6 : 0.9);
  const sun = new THREE.DirectionalLight(SUN, baked ? 2.2 : 2.0);
  sun.position.set(-1.5, 2.6, -5);
  sun.target.position.set(0.4, 0.6, 0.8);
  const fill = new THREE.PointLight('#ffb27a', baked ? 0.6 : 1.0, 7, 2);
  fill.position.set(0, 2.5, 0.5);
  const lanternWorld = new THREE.Vector3(-0.55, 1.05, -0.25);
  cabin?.get('Lantern_light')?.getWorldPosition(lanternWorld);
  uLanternPos.value.copy(lanternWorld);
  const lantern = new THREE.PointLight('#ffb55e', 0.4, 6, 2);
  lantern.position.copy(lanternWorld);
  // the same lift for the things on the side walls the bake doesn't cover (books, cartridges, logbook cards)
  const sideL = new THREE.PointLight('#ffd2a0', 1.6 * SIDE, 2.6, 2);
  sideL.position.set(-1.55, 1.55, -0.55);
  const sideR = sideL.clone();
  sideR.position.set(1.55, 1.55, -0.55);
  scene.add(hemi, sun, sun.target, fill, lantern);
  if (SIDE > 0) scene.add(sideL, sideR);
  // At night the handheld is lit by its own screen (a small cool light just above it) and its plastic keeps a
  // little of its colour, so it reads as the orange KANAT·1 instead of a brown lump.
  const screenGlow = new THREE.PointLight('#bcd0ff', 0, 0.9, 2);
  const screenNode = cabin?.get('Handheld_screen');
  if (screenNode) {
    screenNode.getWorldPosition(screenGlow.position);
    screenGlow.position.add(new THREE.Vector3(0, 0.16, 0.08));
    scene.add(screenGlow);
  }
  const plastics: THREE.MeshStandardMaterial[] = [];
  cabin?.get('Handheld')?.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]) {
      if ((m.name === 'OrangePlastic' || m.name === 'CreamPlastic') && !plastics.includes(m)) { m.emissive = m.color.clone(); m.emissiveIntensity = 0; plastics.push(m); }
    }
  });

  // Static meshes → unlit base colour × blended lightmap.
  const lantGlow: THREE.MeshStandardMaterial[] = [];
  const flames: THREE.Mesh[] = []; // the flame itself: hidden by day
  const GLASS_DAY = new THREE.Color('#9a958c'), glassNight = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  cabin?.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m.name === 'LanternGlow' && !lantGlow.includes(m as THREE.MeshStandardMaterial)) lantGlow.push(m as THREE.MeshStandardMaterial);
    if (mats.some(m => m.name === 'LanternFlame')) flames.push(mesh);
  });
  // Normalise bake exposure so a darker/brighter bake still reads well.
  const gains = {
    sunset: lmSunset ? clampGain(0.5 / meanLit(lmSunset, meta.sunset?.mean), 1, 2.6) : 1,
  };
  // Until the night bake arrives, night = the sunset bake, dimmed.
  const nightU: NightUniforms = { lightMapNight: { value: lmSunset }, uNightGain: { value: 0.25 / gains.sunset } };
  if (baked && cabin) {
    const statics = new Set<THREE.Mesh>();
    for (const s of cabin.all('STATIC_')) s.traverse(o => { if ((o as THREE.Mesh).isMesh) statics.add(o as THREE.Mesh); });
    const cache = new Map<THREE.Material, THREE.Material>();
    for (const mesh of statics) {
      if (!mesh.geometry.getAttribute('uv1')) { console.warn(`[lighting] ${mesh.name} has no second UV`); continue; }
      const conv = (m: THREE.Material) => {
        let out = cache.get(m);
        if (!out) { out = bakedMaterial(m as THREE.MeshStandardMaterial, lmSunset!, gains.sunset, nightU); cache.set(m, out); }
        return out;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
    }
  }

  // Window glass: slightly transparent, with rain streaks during a storm.
  const glassMat = rainGlassMaterial();
  cabin?.all('Window_glass').forEach(g => g.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = glassMat;
    mesh.renderOrder = 2;
  }));

  const STORM_SKY = new THREE.Color('#8a9ac0');
  const FLASH = new THREE.Color('#dfe8ff');
  let n = 0, st = 0, fl = 0;
  const apply = () => {
    uNight.value = n; uStorm.value = st; uFlash.value = fl;
    const dim = 1 - 0.65 * st;
    sun.intensity = lerp(baked ? 2.2 : 2.0, baked ? 0.25 : 0.35, n) * dim;
    sun.color.copy(SUN).lerp(MOON, n).lerp(STORM_SKY, st * 0.7);
    hemi.intensity = lerp(baked ? 0.6 : 0.9, baked ? 0.12 : 0.14, n) * (1 - 0.3 * st) + fl * 1.6;
    hemi.color.set('#ffe6d2').lerp(new THREE.Color('#5a6aa8'), n).lerp(STORM_SKY, st * 0.6).lerp(FLASH, fl);
    fill.intensity = lerp(baked ? 0.6 : 1.0, 0.1, n) * (1 - 0.5 * st) + fl * 2.5;
    fill.color.set('#ffb27a').lerp(FLASH, fl);
    lantern.intensity = (lerp(0, baked ? 2.0 : 2.4, n) + st * 0.5) * n; // dark by day
    lanternBase = lantern.intensity;
    scene.environmentIntensity = lerp(0.35, 0.05, n) * (1 - 0.4 * st);
    for (const m of lantGlow) {
      m.emissive?.set('#ffb055');
      m.emissiveIntensity = (lerp(0, 3.2, n) + st * 0.8) * n;
    }
    glowBase = (lerp(0, 3.2, n) + st * 0.8) * n;
    // unlit glass by day: plain smoky glass, not the warm amber of a lit lantern
    for (const m of lantGlow) {
      if (!glassNight.has(m)) glassNight.set(m, m.color.clone());
      m.color.copy(GLASS_DAY).lerp(glassNight.get(m)!, n);
    }
    for (const f of flames) f.visible = n > 0.05;
    screenGlow.intensity = 0.022 * n;
    for (const m of plastics) m.emissiveIntensity = 0.16 * n;
  };
  let lanternBase = 0, glowBase = 0;
  const flicker = (t: number, amount: number) => {
    // layered sines ≈ a guttering flame; gusts make it dip harder
    const f = 1 + amount * (0.45 * Math.sin(t * 11.3) + 0.3 * Math.sin(t * 23.9 + 1.1) + 0.25 * Math.sin(t * 41.7 + 2.3) - 0.35 * Math.max(0, Math.sin(t * 2.3)));
    lantern.intensity = lanternBase * f;
    for (const m of lantGlow) m.emissiveIntensity = glowBase * (0.85 + 0.15 * f);
  };
  const setNight = (k: number) => { n = k; apply(); };
  const setStorm = (k: number) => { st = k; apply(); };
  const setFlash = (k: number) => { fl = k; apply(); };
  setNight(0);

  let nightLoad: Promise<void> | null = null;
  const loadNight = () => nightLoad ??= loadTexture(LM_NIGHT).then(t => {
    if (!t || !lmSunset) return;
    prepLM(t);
    nightU.lightMapNight.value = t;
    nightU.uNightGain.value = clampGain(0.22 / meanLit(t, meta.night?.mean), 1, 5) / gains.sunset;
  });
  return { baked, setNight, setStorm, setFlash, loadNight, lanternWorld, flicker };
}

interface NightUniforms { lightMapNight: { value: THREE.Texture | null }; uNightGain: { value: number } }

/** Faintly tinted glass; during a storm, rain runs down it (world-space streaks, frozen under reduced motion). */
function rainGlassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uStorm, uTime, uFlash, uRainSlant },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform float uStorm; uniform float uTime; uniform float uFlash; uniform float uRainSlant;
      varying vec3 vWorld;
      float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 base = vec3(1.0, 0.886, 0.784);
        float a = 0.08;
        if (uStorm > 0.001) {
          float u = vWorld.x + vWorld.z * 0.35 + vWorld.y * uRainSlant;
          float lanes = u * 46.0;
          float id = floor(lanes);
          float h = hash(id);
          float lane = 1.0 - smoothstep(0.04, 0.16, abs(fract(lanes) - 0.5 + (h - 0.5) * 0.3));
          float y = fract(vWorld.y * (0.9 + h * 0.6) + uTime * (0.35 + h * 0.6) + h * 7.0);
          float streak = smoothstep(0.0, 0.015, y) * (1.0 - smoothstep(0.015, 0.22 + h * 0.2, y)) * step(0.45, h);
          vec2 cell = floor(vec2(u, vWorld.y) * 38.0);
          vec2 f = fract(vec2(u, vWorld.y) * 38.0) - 0.5;
          float drop = step(0.82, hash2(cell)) * (1.0 - smoothstep(0.08, 0.2, length(f)));
          float rain = lane * streak * 0.55 + drop * 0.35;
          base = mix(base, vec3(0.62, 0.68, 0.8), uStorm * 0.7);
          a = mix(a, 0.16, uStorm) + rain * uStorm;
          base = mix(base, vec3(0.92, 0.95, 1.0), clamp(rain * uStorm * 1.5, 0.0, 1.0));
        }
        base += uFlash * 0.3;
        gl_FragColor = vec4(base, a);
        #include <colorspace_fragment>
      }`,
  });
}

const clampGain = (g: number, a: number, b: number) => (Number.isFinite(g) ? Math.max(a, Math.min(b, g)) : a);

/** Mean luminance (0..1, sRGB-ish) of the non-empty texels of a lightmap atlas: the build-time value for a compressed
 *  (KTX2) bake, else measured from the image. */
function meanLit(tex: THREE.Texture, known?: number): number {
  if ((tex as THREE.CompressedTexture).isCompressedTexture) return known ?? 0.5;
  try {
    const img = tex.image as CanvasImageSource & { width: number; height: number };
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      if (l > 0.02) { sum += l; n++; }
    }
    return n ? sum / n : 0.5;
  } catch { return 0.5; }
}

function bakedMaterial(src: THREE.MeshStandardMaterial, sunset: THREE.Texture, sunsetGain: number, nightU: NightUniforms): THREE.Material {
  const mat = new THREE.MeshBasicMaterial({
    name: src.name,
    map: src.map ?? null,
    color: src.color?.clone() ?? new THREE.Color(1, 1, 1),
    lightMap: sunset,
    lightMapIntensity: Math.PI * sunsetGain,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side,
  });
  if (src.emissiveMap || (src.emissive && src.emissive.getHex() !== 0)) {
    // keep emissive props visible
    mat.color.add(src.emissive.clone().multiplyScalar(src.emissiveIntensity ?? 1));
  }
  // night texels are multiplied by uNightGain (relative to the sunset gain); the storm cools and dims the bake, lightning lifts it.
  const sheen = { value: SHEEN[src.name] ?? 0 };
  const lift = { value: LIFT[src.name] ?? 0 };
  const detail = { value: src.map ? DETAIL[src.name] ?? 0 : 0 };
  const macro = { value: src.map ? MACRO[src.name] ?? 0 : 0 };
  mat.onBeforeCompile = shader => {
    shader.uniforms.uSheen = sheen;
    shader.uniforms.uLift = lift;
    shader.uniforms.uDetail = detail;
    shader.uniforms.uMacro = macro;
    shader.uniforms.uLanternPos = uLanternPos;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPN;\nvarying vec3 vPW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPN = normalize(mat3(modelMatrix) * normal);\nvPW = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.uniforms.uNight = uNight;
    shader.uniforms.uStorm = uStorm;
    shader.uniforms.uFlash = uFlash;
    shader.uniforms.lightMapNight = nightU.lightMapNight;
    shader.uniforms.uNightGain = nightU.uNightGain;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lightmap_pars_fragment>', '#include <lightmap_pars_fragment>\nuniform sampler2D lightMapNight;\nuniform float uNight;\nuniform float uStorm;\nuniform float uFlash;\nuniform float uNightGain;\nuniform float uSheen;\nuniform float uLift;\nuniform vec3 uLanternPos;\nuniform float uDetail;\nuniform float uMacro;\nvarying vec3 vPN;\nvarying vec3 vPW;' + TEX_FNS)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
        if (uMacro > 0.0) {
          // broad, soft light/dark patches in texture space (a few tiles across): breaks up the visible repeat
          float m = vnoise(vMapUv * 0.43) * 0.65 + vnoise(vMapUv * 1.13 + 7.1) * 0.35;
          diffuseColor.rgb *= 1.0 + uMacro * (m - 0.5) * 2.0;
        }
        if (uDetail > 0.0) {
          // the texture itself, finer, divided by its own blurred average: only the grain is added, not a colour shift
          vec2 dUv = vMapUv * ${DETAIL_SCALE.toFixed(2)} + vec2(0.37, 0.11);
          float dFine = dot(texture2D(map, dUv).rgb, vec3(0.299, 0.587, 0.114));
          float dAvg = dot(texture2D(map, dUv, 5.0).rgb, vec3(0.299, 0.587, 0.114));
          float dTex = clamp(dFine / max(dAvg, 0.02), 0.55, 1.6);
          float near = 1.0 - smoothstep(0.7, 3.2, length(cameraPosition - vPW));
          diffuseColor.rgb *= mix(1.0, dTex, uDetail * near);
        }
        #endif`)
      .replace('#include <opaque_fragment>', `
        // side walls (bookcase, chest, rack, portrait) a little brighter so they hold their own against the windows
        outgoingLight *= 1.0 + ${SIDE.toFixed(3)} * smoothstep(1.0, 2.1, abs(vPW.x)) * (1.0 - 0.5 * uNight);
        if (uLift > 0.0) {
          // keep whites white: same brightness as the bake, most of its colour cast removed, never darker than a soft floor
          float lum = dot(reflectedLight.indirectDiffuse, vec3(0.34)) / max(dot(diffuseColor.rgb, vec3(0.34)), 0.04);
          vec3 neutral = diffuseColor.rgb * max(lum * 1.25, mix(0.5, 0.16, uNight));
          outgoingLight = mix(outgoingLight, neutral, uLift);
        }
        if (uSheen > 0.0) {
          // painted highlight: two soft-edged bands that slide over the metal as the camera moves
          vec3 pN = vPN / max(length(vPN), 1e-4);
          vec3 pV = normalize(cameraPosition - vPW);
          vec3 pL = normalize(mix(vec3(0.3, 0.42, -1.0), uLanternPos - vPW, uNight));
          float g = dot(reflect(-pV, pN), pL);
          float lit = clamp(dot(reflectedLight.indirectDiffuse, vec3(0.34)) / max(dot(diffuseColor.rgb, vec3(0.34)), 0.04), 0.0, 1.6);
          float hi = smoothstep(0.58, 0.74, g) * 0.7 + smoothstep(0.05, 0.45, g) * 0.22;
          float lo = smoothstep(0.05, -0.75, g);
          outgoingLight = outgoingLight * (1.0 - 0.28 * lo * min(uSheen, 1.0))
            + diffuseColor.rgb * hi * uSheen * lit
            + vec3(1.0, 0.92, 0.74) * smoothstep(0.86, 0.94, g) * uSheen * lit * 0.22;
        }
        #include <opaque_fragment>`)
      .replace(
        'vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );',
        `vec4 lightMapTexel = mix( texture2D( lightMap, vLightMapUv ), texture2D( lightMapNight, vLightMapUv ) * uNightGain + vec4(0.010, 0.013, 0.024, 0.0), uNight );
        lightMapTexel.rgb *= mix( vec3(1.0), vec3(0.40, 0.46, 0.60), uStorm );
        lightMapTexel.rgb += uFlash * vec3(0.30, 0.33, 0.42);`,
      );
  };
  mat.customProgramCacheKey = () => `baked-night-v6-${SIDE}`;
  return mat;
}

/** Value noise for the baked materials (macro variation). */
const TEX_FNS = /* glsl */`
float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x), mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;
