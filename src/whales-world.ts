// Sky whales in the airship's world (its own chunk, loaded in idle time after the first view; never on the critical
// path). Six whales (two on the lite tier) wander:
//   * outside the stern windows - inside sky.group at diorama scale, weaving between the island layers;
//   * around the galleon in the Outside view / at the helm - giant (3-6x the ship), and now and then one turns to
//     swim alongside when you fly near.
// They are shaded like the sky's painted models (warm light, violet shadow, the backdrop's haze, sunset / night /
// storm from the same uniforms), react to their own turns, climbs and dives (SkyWhale), and can be clicked.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkyWhale, loadManifest, type WhaleEntry } from './whales/sky-whale';
import { HAZE_VERT, type Sky } from './sky';
import { loadGLB } from './scene';
import { FULL } from './tier';
import { uStorm } from './lighting';
import { reducedMotion, tween } from './anim';

const { clamp, lerp } = THREE.MathUtils;

/** What the world needs from outside.ts (kept structural so this chunk doesn't import it). */
export interface OutsideLike {
  worldGroup: THREE.Group;
  shipState: { pos: THREE.Vector3; yaw: number; speed: number };
  mode: 'inside' | 'orbit';
  isOutside: boolean;
}

export interface WhalesWorld {
  update(t: number, dt: number, camera: THREE.Camera): void;
  /** The camera crossed the stern window (outside = the Outside view's world, null = back in the cabin). */
  setOutside(o: OutsideLike | null): void;
  /** Hit proxies of the whales seen through the windows. */
  pickables(): THREE.Object3D[];
  /** Raycast the outside whales; returns the species key. */
  pickOutside(camera: THREE.Camera, ndc: THREE.Vector2): string | null;
  showCard(key: string): void;
  closeCard(): boolean;
  /** Nearest whale (for sound): distance in its world's units / its length, and pan (-1 left .. 1 right). */
  nearest(camera: THREE.Camera): { key: string; rel: number; pan: number } | null;
  readonly keys: string[];
  /** Debug: stop steering/animating (positions can then be set by hand). */
  paused: boolean;
}

// ───────────────────────────────────────────────────────── tunables
/** Window view: whale scale (glTF metres → sky-group metres) and the box they wander in (sky-group space). */
const WIN = { k: 0.55, x: 11, yLo: -1.0, yHi: 4.0, zNear: -7.6, zFar: -19.5, speed: 0.085, turn: 0.22 };
/** Outside: giant scale, wander ring around the ship (m), respawn distance, escort. */
const OUT = { k: 8, rMin: 160, rMax: 480, yLo: -50, yHi: 120, respawn: 1200, speed: 0.095, turn: 0.11 };
/** The ship faster than this (m/s) counts as under way: whales then come to escort it. */
const ESCORT_SPEED = 8;
/** Full-detail LOD within this many whale-lengths of the camera (lite beyond). */
const NEAR_LEN = 1.7;

// ───────────────────────────────────────────────────────── painted, skinned material
const WHALE_VERT = /* glsl */`
  #include <common>
  #include <skinning_pars_vertex>
  uniform vec4 uMapXf; uniform vec4 uAlphaXf; uniform float uHazeMode; uniform float uOutHaze;
  ${HAZE_VERT}
  varying vec2 vUvMap; varying vec2 vUvA; varying vec3 vNrm; varying vec3 vCol; varying vec3 vHaze; varying float vHazeK; varying float vLamp;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vec4 mv = viewMatrix * wp;
    vNrm = normalize(normalMatrix * objectNormal);
    vUvMap = uv * uMapXf.xy + uMapXf.zw;
    vUvA = uv * uAlphaXf.xy + uAlphaXf.zw;
    #ifdef USE_COLOR
      vCol = color.rgb;
      // lantern windows are painted one exact warm colour in the generator (props.lantern): they glow at night
      vLamp = step(length(color.rgb - vec3(1.0, 0.694, 0.214)), 0.03);
    #else
      vCol = vec3(1.0); vLamp = 0.0;
    #endif
    float d = length(mv.xyz);
    if (uHazeMode < 0.5) { vHaze = skyHaze(wp.xyz); vHazeK = hazeAmount(d); }
    else {
      vHaze = mix(mix(vec3(0.93, 0.6, 0.52), vec3(0.06, 0.08, 0.2), uNight), vec3(0.45, 0.5, 0.6), uStorm * 0.7);
      vHazeK = smoothstep(uOutHaze * 0.11, uOutHaze, d) * 0.9;
    }
    gl_Position = projectionMatrix * mv;
  }`;

const WHALE_FRAG = /* glsl */`
  uniform float uNight; uniform float uStorm; uniform float uFlash; uniform float uFadeIn; uniform float uOpacity;
  uniform float uHazeMode; uniform vec3 uSunDir; uniform vec3 uOutSun;
  uniform vec3 uLitSun; uniform vec3 uShadeSun; uniform vec3 uBounce;
  uniform vec3 uLitNight; uniform vec3 uShadeNight; uniform vec3 uLitStorm; uniform vec3 uShadeStorm;
  #ifdef HAS_MAP
    uniform sampler2D map;
  #endif
  #ifdef HAS_ALPHAMAP
    uniform sampler2D alphaMap;
  #endif
  varying vec2 vUvMap; varying vec2 vUvA; varying vec3 vNrm; varying vec3 vCol; varying vec3 vHaze; varying float vHazeK; varying float vLamp;
  void main() {
    vec3 n = normalize(vNrm);
    if (!gl_FrontFacing) n = -n;
    vec3 sunW = uHazeMode < 0.5 ? uSunDir : uOutSun;
    vec3 L = normalize((viewMatrix * vec4(sunW, 0.0)).xyz);
    float up = dot(n, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
    float lit = smoothstep(-0.25, 0.65, dot(n, L));
    vec3 alb = vCol; float a = uOpacity;
    #ifdef HAS_MAP
      vec4 tx = texture2D(map, vUvMap); alb *= tx.rgb; a *= tx.a;
    #endif
    #ifdef HAS_ALPHAMAP
      a *= texture2D(alphaMap, vUvA).g;
    #endif
    float dim = mix(1.0, 0.5, uNight);
    vec3 litC = mix(mix(uLitSun, uLitNight, uNight), uLitStorm * dim, uStorm);
    vec3 shC = mix(mix(uShadeSun, uShadeNight, uNight), uShadeStorm * dim, uStorm);
    vec3 c = alb * (mix(shC, litC, lit) + uBounce * max(-up, 0.0) * (1.0 - uNight) * (1.0 - uStorm));
    c += alb * uFlash * 0.7;
    float on = max(uNight, uStorm * 0.7);
    c = mix(c, vec3(1.0, 0.72, 0.38) * (0.85 + 1.9 * on), vLamp);
    // a thin rim of backdrop light, so the silhouette reads against the painting
    float rim = pow(1.0 - abs(n.z), 3.0);
    c += vHaze * rim * 0.18;
    c = mix(c, vHaze, vHazeK * (1.0 - 0.55 * vLamp * on));
    c = mix(vHaze, c, uFadeIn);
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }`;

interface WorldUniforms { uHazeMode: { value: number }; uOutSun: { value: THREE.Vector3 }; uOutHaze: { value: number } }

function texXf(t: THREE.Texture | null | undefined) {
  return new THREE.Vector4(t?.repeat.x ?? 1, t?.repeat.y ?? 1, t?.offset.x ?? 0, t?.offset.y ?? 0);
}

/** Swap every material of a whale for the painted sky shader. Returns a per-frame uniform sync. */
function paintWhale(w: SkyWhale, sky: Sky, wu: WorldUniforms, fade: { value: number }): () => void {
  const syncs: (() => void)[] = [];
  w.object.traverse(o => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const role = (src.userData?.role as string | undefined) ?? (mesh.name.includes('Falls') ? 'waterfall' : '');
    const map = src.map ?? null, alphaMap = src.alphaMap ?? null;
    const transparent = src.transparent || role === 'water' || role === 'waterfall';
    const U = sky.uniforms;
    const uMapXf = { value: texXf(map) }, uAlphaXf = { value: texXf(alphaMap) };
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        ...U, ...wu, uFadeIn: fade, uOpacity: { value: role === 'water' ? 0.85 : 1 },
        map: { value: map }, alphaMap: { value: alphaMap }, uMapXf, uAlphaXf,
      },
      defines: { ...(map ? { HAS_MAP: '' } : {}), ...(alphaMap ? { HAS_ALPHAMAP: '' } : {}) },
      vertexShader: WHALE_VERT, fragmentShader: WHALE_FRAG,
      vertexColors: !!src.vertexColors,
      transparent, depthWrite: !transparent, side: src.side, fog: false,
    });
    mesh.material = mat;
    if (map || alphaMap) syncs.push(() => { uMapXf.value.copy(texXf(map)); uAlphaXf.value.copy(texXf(alphaMap)); });
  });
  return () => { for (const s of syncs) s(); };
}

// ───────────────────────────────────────────────────────── steering
interface Region { kind: 'window' | 'outside' }

class Brain {
  readonly pos = new THREE.Vector3();
  heading = Math.random() * Math.PI * 2; pitch = 0; roll = 0; yawRate = 0; speed = 0;
  readonly target = new THREE.Vector3();
  escortUntil = 0;
  escortSide = 1;
  constructor(public readonly len: number, public readonly region: Region) {}

  apply(o: THREE.Object3D) {
    o.position.copy(this.pos);
    o.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
  }
  get fwd() {
    return new THREE.Vector3(Math.sin(this.heading) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.heading) * Math.cos(this.pitch));
  }

  /** Steer toward the target (plus a push away from obstacles), with banked, rate-limited turns. */
  step(dt: number, cruise: number, maxTurn: number, avoid: THREE.Vector3) {
    const to = this.target.clone().sub(this.pos);
    const dist = to.length();
    const want = to.normalize().add(avoid).normalize();
    const hWant = Math.atan2(want.x, want.z);
    let dh = hWant - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const rateT = clamp(dh * 0.6, -maxTurn, maxTurn);
    this.yawRate += (rateT - this.yawRate) * (1 - Math.exp(-dt * 0.9));
    this.heading += this.yawRate * dt;
    const pWant = clamp(Math.asin(clamp(want.y, -1, 1)), -0.32, 0.32);
    this.pitch += (pWant - this.pitch) * (1 - Math.exp(-dt * 0.7));
    this.speed += (cruise - this.speed) * (1 - Math.exp(-dt * 0.5));
    const rollT = -clamp(this.yawRate * this.speed / this.len * 2.2, -0.5, 0.5);
    this.roll += (rollT - this.roll) * (1 - Math.exp(-dt * 1.5));
    this.pos.addScaledVector(this.fwd, this.speed * dt);
    return dist;
  }
}

// ───────────────────────────────────────────────────────── one whale (two LODs, two worlds)
interface Whale {
  entry: WhaleEntry;
  lite: SkyWhale | null; full: SkyWhale | null; fullLoading: boolean;
  active: SkyWhale | null;
  win: Brain; out: Brain | null;
  fade: { value: number };
  syncs: Map<SkyWhale, () => void>;
  proxies: Map<SkyWhale, THREE.Mesh>;
  len: number;
}

function proxyFor(w: SkyWhale, key: string) {
  const box = new THREE.Box3().setFromObject(w.object, true);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const m = new THREE.Mesh(new THREE.BoxGeometry(size.x * 0.8, size.y * 0.9, size.z * 0.9), new THREE.MeshBasicMaterial({ visible: false }));
  m.position.copy(c);
  m.userData.whale = key;
  m.name = `WhaleHit_${key}`;
  w.object.add(m);
  return m;
}

// ───────────────────────────────────────────────────────── card
const CARD_CSS = `
.whale-card { position: fixed; z-index: 12; left: 50%; bottom: calc(76px + var(--safe-b, 0px)); transform: translate(-50%, 12px);
  width: min(380px, calc(100vw - 32px)); padding: 16px 18px 14px; border-radius: 16px; color: var(--ink);
  background: var(--glass-strong); border: 1px solid var(--line); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 14px 40px rgba(20, 8, 4, .45); opacity: 0; transition: opacity .25s ease, transform .25s ease; }
.whale-card.open { opacity: 1; transform: translate(-50%, 0); }
.whale-card[hidden] { display: none; }
.whale-card .meta { font-size: .74rem; letter-spacing: .1em; text-transform: uppercase; color: var(--brass); margin: 0 0 6px; }
.whale-card h2 { font-family: var(--display); font-weight: 700; font-size: 1.35rem; line-height: 1.1; margin: 0 30px 2px 0; }
.whale-card .sub { margin: 0 0 8px; color: var(--ink-dim); font-size: .9rem; }
.whale-card p.fact { margin: 0 0 12px; font-size: .92rem; line-height: 1.45; }
.whale-card .x { position: absolute; top: 10px; right: 10px; width: 30px; height: 30px; padding: 0; display: grid; place-items: center; }
.whale-card .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
@media (prefers-reduced-motion: reduce) { .whale-card { transition: none; } }`;

function makeCard() {
  const st = document.createElement('style'); st.textContent = CARD_CSS; document.head.append(st);
  const el = document.createElement('div');
  el.className = 'whale-card'; el.hidden = true;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false');
  document.body.append(el);
  return el;
}

// ───────────────────────────────────────────────────────── setup
export async function setupWhales(sky: Sky, scene: THREE.Scene): Promise<WhalesWorld | null> {
  let manifest = await loadManifest();
  if (!manifest.length) return null;
  // the lite tier keeps the phone budget: two whales, light models only, no particles
  if (!FULL) manifest = [...manifest].sort(() => Math.random() - 0.5).slice(0, 2);
  const wu: WorldUniforms = { uHazeMode: { value: 0 }, uOutSun: { value: new THREE.Vector3(0.3, 0.35, -1).normalize() }, uOutHaze: { value: 1100 } };
  const winGroup = new THREE.Group(); winGroup.name = 'Whales';
  sky.group.add(winGroup);
  const outAbs = new THREE.Group(); outAbs.name = 'WhalesOutside';   // absolute space of the outside world
  let outside: OutsideLike | null = null;
  const whales: Whale[] = [];
  const card = makeCard();
  let cardKey: string | null = null;

  const newSky = (gltf: GLTF) => new SkyWhale(gltf, { particles: FULL, spouts: FULL, space: winGroup, reactionGain: 1.2 });

  // spread the starting positions across the window box, alternating near/far lanes
  const seedWin = (b: Brain, i: number, n: number) => {
    const f = (i + 0.5) / n;
    b.pos.set(lerp(-WIN.x * 0.8, WIN.x * 0.8, f), lerp(WIN.yLo + 0.5, WIN.yHi - 0.6, (i * 0.37) % 1), i % 2 ? WIN.zFar + 2 : -11.5);
    b.heading = (i % 2 ? 1 : -1) * Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    pickWinTarget(b);
  };
  const pickWinTarget = (b: Brain) => {
    const crossing = Math.random() < 0.3;   // now and then a whale passes close to the windows
    const yHi = lerp(WIN.yHi, 1.6, uStorm.value);  // storms push them down
    b.target.set((Math.random() * 2 - 1) * WIN.x, lerp(WIN.yLo, yHi, Math.random()),
      crossing ? lerp(WIN.zNear, WIN.zNear - 1.5, Math.random()) : lerp(-10.5, WIN.zFar, Math.random()));
  };
  const avoidWin = (b: Brain) => {
    const v = new THREE.Vector3();
    for (const ob of sky.obstacles()) {
      const d = b.pos.distanceTo(ob.pos), reach = ob.r + b.len * 0.6;
      if (d < reach * 1.6) v.add(b.pos.clone().sub(ob.pos).normalize().multiplyScalar((reach * 1.6 - d) / reach * 1.4));
    }
    // soft walls of the box
    if (b.pos.z > WIN.zNear) v.z -= (b.pos.z - WIN.zNear) * 1.5;
    if (b.pos.z < WIN.zFar) v.z += (WIN.zFar - b.pos.z) * 0.8;
    if (Math.abs(b.pos.x) > WIN.x) v.x -= Math.sign(b.pos.x) * (Math.abs(b.pos.x) - WIN.x) * 0.8;
    if (b.pos.y > WIN.yHi) v.y -= (b.pos.y - WIN.yHi) * 1.2;
    if (b.pos.y < WIN.yLo) v.y += (WIN.yLo - b.pos.y) * 1.2;
    return v;
  };

  // ── outside world
  const ship = () => outside!.shipState;
  const shipFwd = () => new THREE.Vector3(Math.sin(ship().yaw), 0, Math.cos(ship().yaw));
  const placeOut = (b: Brain, ahead: boolean) => {
    const s = ship();
    const a = ship().yaw + (ahead ? (Math.random() - 0.5) * 1.4 : Math.random() * Math.PI * 2);
    const r = ahead ? lerp(650, 900, Math.random()) : lerp(OUT.rMin, OUT.rMax, Math.random());
    b.pos.set(s.pos.x + Math.sin(a) * r, clamp(s.pos.y + (Math.random() - 0.4) * 80, OUT.yLo, OUT.yHi), s.pos.z + Math.cos(a) * r);
    b.heading = a + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
    pickOutTarget(b);
  };
  const pickOutTarget = (b: Brain) => {
    const s = ship();
    const a = Math.random() * Math.PI * 2, r = lerp(OUT.rMin, OUT.rMax, Math.random());
    const yHi = lerp(OUT.yHi, 30, uStorm.value);
    b.target.set(s.pos.x + Math.sin(a) * r, clamp(s.pos.y + (Math.random() - 0.5) * 120, OUT.yLo, yHi), s.pos.z + Math.cos(a) * r);
  };
  let nextEscort = 12;

  // ── LOD management
  const setActive = (w: Whale, next: SkyWhale) => {
    const prev = w.active;
    if (prev === next) return;
    const parent = outside ? outAbs : winGroup;
    if (prev) {
      prev.object.removeFromParent(); prev.removeEffectsFrom(prev.object.parent ?? parent);
      if (prev.particles) prev.particles.pts.removeFromParent();
      prev.spout.pts.removeFromParent();
      next.cruise.time = prev.cruise.time;
    }
    w.active = next;
    next.setSpace(outside ? outAbs : winGroup);
    next.setScale(outside ? OUT.k : WIN.k);
    parent.add(next.object); next.addEffectsTo(parent);
    next.setParticlesVisible(!outside && FULL);
    next.spout.pts.visible = FULL;   // spouts are a full-tier effect: don't draw empty emitters on phones
    (outside ? w.out! : w.win).apply(next.object);
    next.resetMotion();
  };
  const ensureFull = (w: Whale) => {
    if (!FULL || w.full || w.fullLoading || !w.entry.files.A) return;
    w.fullLoading = true;
    void loadGLB(w.entry.files.A).then(g => {
      if (!g) return;
      const sw = newSky(g);
      w.syncs.set(sw, paintWhale(sw, sky, wu, w.fade));
      w.proxies.set(sw, proxyFor(sw, w.entry.key));
      w.full = sw;
    });
  };

  // ── load the light versions one by one (the first whale appears as soon as it arrives)
  const loadLite = async (entry: WhaleEntry, i: number, n: number) => {
    const url = entry.files.lite ?? entry.files.A; if (!url) return;
    const g = await loadGLB(url); if (!g) return;
    const sw = newSky(g);
    const fade = { value: 0 };
    const len = (sw.info.length || 12);
    const w: Whale = {
      entry, lite: sw, full: null, fullLoading: false, active: null,
      win: new Brain(len * WIN.k, { kind: 'window' }), out: null, fade,
      syncs: new Map([[sw, paintWhale(sw, sky, wu, fade)]]), proxies: new Map([[sw, proxyFor(sw, entry.key)]]), len,
    };
    seedWin(w.win, i, n);
    if (outside) { w.out = new Brain(len * OUT.k, { kind: 'outside' }); placeOut(w.out, false); }
    whales.push(w);
    setActive(w, sw);
    void tween(reducedMotion ? 0 : 2.2, k => { fade.value = k; });
  };
  void (async () => { for (let i = 0; i < manifest.length; i++) await loadLite(manifest[i], i, manifest.length); })();

  // ── card
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const closeCard = () => {
    if (card.hidden) return false;
    card.classList.remove('open'); cardKey = null;
    setTimeout(() => { if (!cardKey) card.hidden = true; }, 260);
    return true;
  };
  const showCard = (key: string) => {
    const w = whales.find(x => x.entry.key === key); if (!w) return;
    const e = w.entry; cardKey = key;
    card.setAttribute('aria-label', `${e.name}: ${e.biomeLabel}`);
    card.innerHTML = `<button type="button" class="btn x" aria-label="Close">✕</button>
      <p class="meta"><span class="swatch" style="background:${esc(e.color)}"></span>Sky whale</p>
      <h2>${esc(e.name)}</h2><p class="sub">${esc(e.biomeLabel)}</p><p class="fact">${esc(e.fact)}</p>
      <a class="btn primary" href="/whales/?whale=${encodeURIComponent(e.key)}" target="_blank" rel="noopener">Watch it in the whale viewer ↗</a>`;
    card.querySelector('.x')!.addEventListener('click', () => closeCard());
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('open'));
    (card.querySelector('.btn.primary') as HTMLElement).focus({ preventScroll: true });
  };
  addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Escape' && closeCard()) e.stopPropagation(); }, true);

  // ── per frame
  const camPos = new THREE.Vector3(), wp = new THREE.Vector3(), tmp = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  let paused = false;
  return {
    get keys() { return whales.map(w => w.entry.key); },
    get paused() { return paused; },
    set paused(v: boolean) { paused = v; },
    update(t, dt, camera) {
      if (!whales.length || reducedMotion || paused) return;
      camera.getWorldPosition(camPos);
      const storm = uStorm.value;
      const out = !!outside;
      if (out) {
        // absolute space: the outside world places everything relative to the ship
        outAbs.position.copy(ship().pos).multiplyScalar(-1);
        const helm = ship().speed > ESCORT_SPEED; // under way: a whale may come to swim alongside
        nextEscort -= dt;
        if (helm && nextEscort <= 0) {
          // the nearest whale that isn't already escorting comes to swim alongside for a while
          let best: Whale | null = null, bd = 650;
          for (const w of whales) { if (!w.out) continue; const d = w.out.pos.distanceTo(ship().pos); if (d < bd && w.out.escortUntil < t) { bd = d; best = w; } }
          if (best) { best.out!.escortUntil = t + 25 + Math.random() * 15; best.out!.escortSide = Math.random() < 0.5 ? 1 : -1; }
          nextEscort = 30 + Math.random() * 20;
        }
      }
      for (const w of whales) {
        const b = out ? w.out : w.win;
        if (!b || !w.active) continue;
        let cruise: number, turn: number, avoid: THREE.Vector3;
        if (!out) {
          cruise = w.len * WIN.k * WIN.speed * (1 - 0.25 * storm);
          turn = WIN.turn;
          avoid = avoidWin(b);
          if (b.pos.distanceTo(b.target) < b.len * 1.5) pickWinTarget(b);
        } else {
          const s = ship();
          turn = OUT.turn;
          avoid = new THREE.Vector3();
          // keep clear of the ship's hull
          const toShip = b.pos.clone().sub(s.pos); const ds = toShip.length(), clear = b.len * 0.6 + 45;
          if (ds < clear * 1.5) avoid.add(toShip.normalize().multiplyScalar((clear * 1.5 - ds) / clear * 1.5));
          if (b.escortUntil > t && ship().speed > ESCORT_SPEED) {
            // swim alongside: a point off the bow quarter, a little below - where the helm camera sees it
            const f = shipFwd(), right = new THREE.Vector3(f.z, 0, -f.x);
            b.target.copy(s.pos).addScaledVector(right, b.escortSide * (b.len * 0.5 + 55)).addScaledVector(f, 90).y -= 14;
            const lag = b.pos.distanceTo(b.target);
            cruise = Math.max(s.speed, 6) * (1 + clamp(lag / 400, 0, 1.2));
            turn = OUT.turn * 2.2;
          } else {
            cruise = w.len * OUT.k * OUT.speed * (1 - 0.2 * storm);
            if (b.pos.distanceTo(b.target) < b.len * 1.2) pickOutTarget(b);
            if (b.pos.distanceTo(s.pos) > OUT.respawn) { placeOut(b, true); w.active.resetMotion(); }
          }
        }
        b.step(dt, cruise, turn, avoid);
        b.apply(w.active.object);
        // LOD: full detail when near the camera (loaded on demand), lite otherwise
        w.active.object.getWorldPosition(wp);
        const rel = wp.distanceTo(camPos) / (w.len * w.active.scale);
        if (rel < NEAR_LEN) ensureFull(w);
        const want = w.full && rel < NEAR_LEN ? w.full : w.full && rel > NEAR_LEN * 1.2 ? w.lite! : w.active;
        if (want !== w.active) setActive(w, want);
        w.active.update(dt, !out || rel < 25);
        w.syncs.get(w.active)?.();
      }
    },
    setOutside(o) {
      outside = o && o.isOutside ? o : null;
      wu.uHazeMode.value = outside ? 1 : 0;
      if (outside) {
        if (!outAbs.parent) outside.worldGroup.add(outAbs);
        nextEscort = 10;
        for (const w of whales) {
          if (!w.out) { w.out = new Brain(w.len * OUT.k, { kind: 'outside' }); placeOut(w.out, false); }
          const a = w.active; w.active = null; if (a) { a.object.removeFromParent(); a.particles?.pts.removeFromParent(); a.spout.pts.removeFromParent(); }
          setActive(w, a ?? w.lite!);
        }
      } else {
        for (const w of whales) {
          const a = w.active; w.active = null; if (a) { a.object.removeFromParent(); a.spout.pts.removeFromParent(); }
          setActive(w, a ?? w.lite!);
        }
      }
    },
    pickables() {
      if (outside) return [];
      return whales.flatMap(w => (w.active ? [w.proxies.get(w.active)!] : []));
    },
    pickOutside(camera, ndc) {
      if (!outside) return null;
      ray.setFromCamera(ndc, camera);
      const hits = ray.intersectObjects(whales.flatMap(w => (w.active ? [w.proxies.get(w.active)!] : [])), false);
      return (hits[0]?.object.userData.whale as string | undefined) ?? null;
    },
    showCard, closeCard,
    nearest(camera) {
      let best: { key: string; rel: number; pan: number } | null = null;
      camera.getWorldPosition(camPos);
      for (const w of whales) {
        if (!w.active) continue;
        w.active.object.getWorldPosition(wp);
        const rel = wp.distanceTo(camPos) / (w.len * w.active.scale);
        if (!best || rel < best.rel) {
          tmp.copy(wp).applyMatrix4(camera.matrixWorldInverse);
          best = { key: w.entry.key, rel, pan: clamp(tmp.x / Math.max(-tmp.z, 1e-3), -1, 1) };
        }
      }
      return best;
    },
  };
}
