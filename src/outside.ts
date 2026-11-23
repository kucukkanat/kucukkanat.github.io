// Outside the ship. The cabin sits inside the sky galleon (the ship's Cabin_anchor is put on the cabin's origin),
// so the camera can leave and enter through the middle stern window without a cut:
//   opening shot  → the galleon from astern, in through the window, a turn over the chart table, the landing view;
//   "Outside"     → the same way out, then an orbit view of the ship; the visitor can steer and throttle it at any time.
// The ship itself never moves: flying turns and slides the outside world (and tilts world + camera for the bank),
// which leaves the baked cabin where it is.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CameraRig } from './camera';
import { reducedMotion } from './anim';
import { FULL } from './tier';
import { loadGLB } from './scene';
import { uNight, uStorm } from './lighting';
import { ShipRig } from './ship-rig';
import { Flight, PACE, type Key } from './flight';
import { Waypoints } from './stations';
import { Input } from './input';
import { coach, dismissCoach } from './coach';

import { INTRO_KEY as KEY } from './intro-flag';
const HOLD = (() => { const v = new URLSearchParams(location.search).get('introT'); return v === null || !Number.isFinite(+v) ? null : +v; })();
const { clamp, lerp } = THREE.MathUtils;

export type OutsideMode = 'inside' | 'orbit';

export interface OutsideHooks {
  /** Where the HUD goes. */
  root: HTMLElement;
  /** The camera crossed the window: true = now outside (hide the window sky, the cabin UI), false = back inside. */
  crossed(outside: boolean): void;
  /** Mode changed (for announcements / sound). */
  mode?(m: OutsideMode): void;
  /** A tap / click on the outside view that was not a drag (normalised device coordinates). */
  click?(ndc: THREE.Vector2): void;
  /** The cabin's window sky (sky.ts): shown inside, hidden outside, crossfaded with the outside world at the window. */
  windowSky?: THREE.Object3D;
  /** The mix changed: 1 = all window sky (cabin), 0 = all outside world. For things that fade with it (light shafts). */
  mix?(k: number): void;
}

/** Orbit poses of the stations round the ship (yaw 0 = off the bow, +π/2 = off the port side; no yaw: keep it). */
const STATIONS = {
  bow: { yaw: 0.45, pitch: 0.1, dist: 38 },
  port: { yaw: Math.PI / 2, pitch: 0.08, dist: 40 },
  starboard: { yaw: -Math.PI / 2, pitch: 0.08, dist: 40 },
  above: { yaw: undefined, pitch: 0.95, dist: 58 },
} as const;

const STATION_LABELS = [{ id: 'bow', label: 'Bow' }, { id: 'port', label: 'Port' }, { id: 'starboard', label: 'Starboard' }, { id: 'above', label: 'Above' }];

// Path through the middle stern window, in cabin coordinates (windows face -Z, the bow is toward +Z).
const WINDOW = new THREE.Vector3(0, 1.8, -2.62);
const ASTERN = new THREE.Vector3(0, 1.86, -7.5);
/** The crossfade runs from this far inside the window (m) to this far outside it. */
const FADE_IN = 0.5, FADE_OUT = 0.7;
/** While crossfading, the window sky covers only what is farther than this (m): the outside world, not the hull. */
const FADE_DEPTH = 120;


/** Sunset sky all around with a sea of cloud below. */
function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { uNight, uStorm },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir; uniform float uNight; uniform float uStorm;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(vec3(1.0, 0.72, 0.42), vec3(0.98, 0.5, 0.45), smoothstep(0.0, 0.22, h));
        col = mix(col, vec3(0.55, 0.38, 0.62), smoothstep(0.18, 0.6, h));
        col = mix(col, vec3(0.3, 0.26, 0.5), smoothstep(0.55, 1.0, h));
        vec3 sun = normalize(vec3(0.3, 0.14, -1.0));
        float sd = max(dot(d, sun), 0.0);
        col += vec3(1.0, 0.75, 0.45) * (pow(sd, 6.0) * 0.35 + pow(sd, 60.0) * 0.6 + smoothstep(0.9993, 0.9996, sd) * 1.2);
        // bands of high cloud all the way round (no seam: sampled on the direction, not on an angle)
        float c = fbm(vec2(d.x, d.z) / max(h + 0.25, 0.08) * 1.6 + vec2(3.1, 0.0));
        c = smoothstep(0.5, 0.72, c) * smoothstep(-0.02, 0.1, h) * (1.0 - smoothstep(0.3, 0.6, h));
        col = mix(col, vec3(1.0, 0.78, 0.66), c * 0.5);
        float f = fbm(vec2(d.x, d.z) / max(-h, 0.04) * 0.5);
        vec3 floorC = mix(vec3(0.72, 0.5, 0.56), vec3(1.0, 0.8, 0.66), smoothstep(0.35, 0.7, f));
        col = mix(col, floorC, smoothstep(0.0, -0.1, h));
        // night: deep blue with stars and a moonlit cloud floor; storm: grey it down
        vec3 night = mix(vec3(0.07, 0.1, 0.24), vec3(0.015, 0.02, 0.07), smoothstep(0.0, 0.7, h));
        night = mix(night, mix(vec3(0.08, 0.1, 0.2), vec3(0.2, 0.25, 0.42), smoothstep(0.35, 0.7, f)), smoothstep(0.0, -0.1, h));
        vec2 sp = d.xz / (abs(h) + 0.35) * 150.0;
        night += step(0.993, hash(floor(sp))) * smoothstep(0.3, 0.05, length(fract(sp) - 0.5)) * smoothstep(0.02, 0.2, h) * 0.9;
        col = mix(col, night, uNight);
        col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(0.8, 0.86, 1.0), uStorm * 0.75);
        gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 20), mat);
  m.name = 'OutsideSky';
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

/** Far islands for the outside world: the window-sky models at landscape scale, painted flat, hazed by distance. */
function islandMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uNight, uStorm },
    vertexShader: /* glsl */`
      attribute vec4 color; varying vec3 vView; varying vec4 vCol; varying float vDist;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz; vCol = color; vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      varying vec3 vView; varying vec4 vCol; varying float vDist; uniform float uNight; uniform float uStorm;
      void main() {
        vec3 nx = cross(dFdx(vView), dFdy(vView));
        vec3 n = nx / max(length(nx), 1e-9);
        vec3 L = normalize((viewMatrix * vec4(0.3, 0.35, -1.0, 0.0)).xyz);
        float lit = smoothstep(-0.2, 0.6, dot(n, L));
        vec3 alb = pow(max(vCol.rgb, vec3(0.0)), vec3(2.2));
        vec3 c = alb * mix(mix(vec3(0.5, 0.42, 0.72), vec3(1.5, 1.15, 0.85), lit), mix(vec3(0.06, 0.08, 0.2), vec3(0.2, 0.26, 0.5), lit), uNight);
        c = mix(c, vec3(1.0, 0.86, 0.5) * (1.3 + uNight), 1.0 - vCol.a);
        vec3 haze = mix(mix(vec3(0.93, 0.6, 0.52), vec3(0.06, 0.08, 0.2), uNight), vec3(0.45, 0.5, 0.6), uStorm * 0.7);
        c = mix(c, haze, smoothstep(120.0, 1100.0, vDist) * 0.9);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Top speed (m/s) at full throttle, and where the throttle sits on the way out (a slow cruise). */
const MAX_SPEED = 24;
const CRUISE = 3 / MAX_SPEED;
/** Thumbstick radius (px): the knob's travel, full deflection at the rim. */
const STICK_R = 56;

const WORLD_BOX = 1800; // islands repeat in a box this wide around the ship, so there is always something to fly to

export class Outside {
  mode: OutsideMode = 'inside';
  busy = false;
  private holder: THREE.Group | null = null;
  private loading: Promise<boolean> | null = null;
  private world = new THREE.Group();
  private dome = skyDome();
  private islands: { o: THREE.Object3D; base: THREE.Vector3 }[] = [];
  private spinners: { o: THREE.Object3D; axis: THREE.Vector3; rps: number }[] = [];
  /** The ship's moving parts: rudder, fins, sails… (ship-rig.ts) */
  private parts: ShipRig | null = null;
  private centre = new THREE.Vector3(0, 6, 9);
  private pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  private orbit = { yaw: 2.55, pitch: 0.16, dist: 46, yawT: 2.55, pitchT: 0.16, distT: 46 };
  private ship = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 3, turn: 0, climb: 0 };
  private keys = new Set<string>();
  private stick = { turn: 0, climb: 0 };
  private throttle = CRUISE;
  private hud: HTMLElement;
  private layer: HTMLElement;
  private hint: HTMLElement;
  private helmBtn: HTMLButtonElement;
  /**
   * At the helm: the stick, the speed slider and the flight keys steer the ship. Off (the default) the view works
   * like the cabin and the library (drag to look, pinch / scroll to zoom, arrow keys turn) and she sails on by herself.
   */
  helm = false;
  private stickEl: HTMLElement;
  private knobEl: HTMLElement;
  private thrEl: HTMLElement;
  private thrFill: HTMLElement;
  private isOut = false;
  private mixK = 1;
  private rt: THREE.WebGLRenderTarget | null = null;
  private fadeQuad: THREE.Mesh;
  /** Glowing dots round the ship (stations.ts): fly round to the bow, a side, above, or back in at the stern. */
  private way: Waypoints;
  private shipBox = new THREE.Box3(new THREE.Vector3(-6, 0, -4), new THREE.Vector3(6, 14, 22));

  constructor(private scene: THREE.Scene, private rig: CameraRig, private hooks: OutsideHooks) {
    this.world.name = 'OutsideWorld';
    this.world.visible = false;
    this.dome.visible = false;
    scene.add(this.world, this.dome);
    // the window sky laid over the outside world while the camera passes the window (prerender fills tSky)
    this.fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, fog: false, toneMapped: false,
      uniforms: { tSky: { value: null }, uK: { value: 1 }, uDepth: { value: FADE_DEPTH } },
      vertexShader: /* glsl */`
        uniform float uDepth; varying vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; vec4 c = projectionMatrix * vec4(0.0, 0.0, -uDepth, 1.0); gl_Position = vec4(position.xy * c.w, c.z, c.w); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tSky; uniform float uK; varying vec2 vUv;
        void main() {
          vec4 s = texture2D(tSky, vUv);
          float a = min(s.a, 1.0);
          if (a < 0.002) discard;
          gl_FragColor = vec4(s.rgb / max(a, 1e-4), a * uK); // the target holds premultiplied colour
          #include <colorspace_fragment>
        }`,
    }));
    this.fadeQuad.name = 'WindowSkyFade';
    this.fadeQuad.frustumCulled = false;
    this.fadeQuad.renderOrder = -1000; // first of the transparent pass: over the outside world, under glass and shafts
    this.fadeQuad.visible = false;
    scene.add(this.fadeQuad);

    const layer = this.layer = document.createElement('div');
    layer.className = 'outside-layer';
    layer.hidden = true;
    const hud = this.hud = document.createElement('div');
    hud.className = 'outside-hud';
    hud.hidden = true;
    hud.innerHTML = `
      <div class="out-throttle" role="slider" tabindex="0" aria-label="Throttle" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100">
        <span class="out-thr-label">Speed</span><span class="out-thr-track"><span class="out-thr-fill"></span></span>
      </div>
      <button type="button" class="btn out-helm" aria-pressed="false">Take the helm</button>
      <div class="out-stick" aria-hidden="true"><span class="out-knob"></span></div>
      <p class="out-hint" aria-live="polite"></p>`;
    hooks.root.append(layer, hud);
    this.hint = hud.querySelector('.out-hint')!;
    this.stickEl = hud.querySelector('.out-stick')!;
    this.knobEl = hud.querySelector('.out-knob')!;
    this.thrEl = hud.querySelector('.out-throttle')!;
    this.thrFill = hud.querySelector('.out-thr-fill')!;
    this.way = new Waypoints(hud, id => this.goStation(id));
    this.setupStations();
    this.helmBtn = hud.querySelector('.out-helm')!;
    this.helmBtn.addEventListener('click', () => this.setHelm(!this.helm));
    this.bindPointer(layer);
    this.bindStick();
    this.bindThrottle();
    this.setThrottle(CRUISE);
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.mode === 'inside' || this.busy) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.helm) this.setHelm(false); else void this.goInside(); return; }
      const a = document.activeElement;
      if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey && !(a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement)) { this.setHelm(!this.helm); return; }
      // away from the helm the keys are the shared camera keys (main.ts passes them to orbitBy / zoomBy)
      if (!this.helm) return;
      // a slider focused with Tab keeps its own keys (arrows, Page Up/Down, Home/End); every other key still flies
      if (e.target === this.thrEl && /^(Arrow|Page|Home$|End$)/.test(e.key)) return;
      this.keys.add(e.key.toLowerCase());
      if (e.key.startsWith('Arrow')) e.preventDefault();
    }, true);
    addEventListener('keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  get active() { return this.mode !== 'inside' || this.busy; }
  /** The outside world (turns and tilts against the ship; children are placed relative to the ship). */
  get worldGroup(): THREE.Group { return this.world; }
  /** The ship's flight state in the outside world's frame (read only). */
  get shipState(): { pos: THREE.Vector3; yaw: number; speed: number } { return this.ship; }
  /** True while the outside world is on screen. */
  get isOutside() { return this.isOut; }

  /** Models for the far islands (the sky.glb the window sky uses). Call before sky.addModels consumes it. */
  setSkyModels(gltf: GLTF | null) {
    if (!gltf || this.islands.length) return;
    const mat = islandMaterial();
    const protos: THREE.Mesh[] = [];
    gltf.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && /^SKY_(island|rocks)/.test(o.name)) protos.push(m); });
    if (!protos.length) return;
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const n = FULL ? 16 : 9;
    for (let i = 0; i < n; i++) {
      const p = protos[i % protos.length];
      const mesh = new THREE.Mesh(p.geometry, mat);
      mesh.position.copy(p.position); mesh.scale.copy(p.scale); // undo the file's int16 quantisation
      mesh.frustumCulled = false;
      const g = new THREE.Group();
      g.add(mesh);
      // the models come in assorted sizes: normalise each to a 30..80 m island
      p.geometry.computeBoundingSphere();
      const raw = (p.geometry.boundingSphere?.radius ?? 1) * Math.max(p.scale.x, p.scale.y, p.scale.z);
      g.scale.setScalar((30 + rnd() * 50) / Math.max(raw, 1e-3));
      g.rotation.y = rnd() * Math.PI * 2;
      // keep a clear lane around the ship's start, then scatter
      let x = 0, z = 0;
      do { x = (rnd() - 0.5) * WORLD_BOX; z = (rnd() - 0.5) * WORLD_BOX; } while (Math.hypot(x, z) < 240);
      const base = new THREE.Vector3(x, -70 + rnd() * 120, z);
      this.world.add(g);
      this.islands.push({ o: g, base });
    }
    this.layoutWorld();
  }

  /** Give it the galleon (preloaded for the opening shot), or let it fetch one when first needed. */
  setShip(gltf: GLTF | null) {
    if (!gltf || this.holder) return;
    const ship = gltf.scene;
    ship.updateMatrixWorld(true);
    const anchor = ship.getObjectByName('Cabin_anchor');
    const m = new THREE.Matrix4();
    if (anchor) m.copy(anchor.matrixWorld).invert();
    else m.makeRotationY(-Math.PI / 2).multiply(new THREE.Matrix4().makeTranslation(10.02, -4.45, 0));
    const holder = this.holder = new THREE.Group();
    holder.name = 'Galleon';
    holder.applyMatrix4(m);
    holder.add(ship);
    holder.visible = false;
    ship.traverse(o => {
      const e = o.userData as { joint?: string; axis?: number[]; rpm?: number };
      if (e.joint === 'spin' && e.axis && e.rpm && !ShipRig.DRIVEN.has(o.name)) this.spinners.push({ o, axis: new THREE.Vector3(...e.axis).normalize(), rps: e.rpm / 60 });
      // the cabin brings its own stern windows: the ship's glass (opaque, glowing) and frames would cover them
      if (/^Gallery_(glass|frames)/.test(o.name)) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
    });
    this.parts = new ShipRig(ship);
    this.scene.add(holder);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    this.shipBox.copy(box);
    box.getCenter(this.centre);
    this.centre.y = lerp(box.min.y, box.max.y, 0.36);
  }

  /** Fetch the galleon in the background so the Outside view opens without a wait. */
  preload(): Promise<boolean> { return this.ensureShip(); }

  private ensureShip(): Promise<boolean> {
    if (this.holder) return Promise.resolve(true);
    return this.loading ??= loadGLB(FULL ? '/assets/galleon.glb' : '/assets/galleon_lite.glb').then(g => { this.setShip(g); return !!this.holder; });
  }

  // ───────────────────────── transitions

  /** 1 = the cabin's window sky, 0 = the outside world, in between = crossfading (both drawn, see prerender). */
  private setMix(k: number) {
    k = clamp(k, 0, 1);
    if (k === this.mixK) return;
    this.mixK = k;
    const out = k < 1;
    if (this.holder) this.holder.visible = out;
    this.world.visible = out;
    this.dome.visible = out;
    if (this.hooks.windowSky) this.hooks.windowSky.visible = k >= 1;
    this.fadeQuad.visible = k > 0 && k < 1;
    (this.fadeQuad.material as THREE.ShaderMaterial).uniforms.uK.value = k;
    this.rig.camera.far = out ? 4000 : 200;
    this.rig.camera.updateProjectionMatrix();
    this.hooks.mix?.(k);
  }

  /** Which side of the window the camera is on (cabin UI, panels, whales). */
  private setOutside(on: boolean) {
    if (this.isOut === on) return;
    this.isOut = on;
    this.hooks.crossed(on);
  }

  /** Mix and side for a camera position near the stern window: the crossfade runs while it passes the opening. */
  private atWindow(pos: THREE.Vector3) {
    const d = WINDOW.z - pos.z; // > 0: outside
    const u = clamp((d + FADE_IN) / (FADE_IN + FADE_OUT), 0, 1);
    this.setMix(1 - u * u * (3 - 2 * u));
    this.setOutside(d > 0);
  }

  /**
   * Called by the render loop just before the frame is drawn. While crossfading, the window sky is drawn on its own
   * into a target, then laid over the outside world (only where that is farther than FADE_DEPTH, so the cabin and the
   * hull stay in front) at the mix.
   */
  prerender(renderer: THREE.WebGLRenderer) {
    const sky = this.hooks.windowSky;
    if (!sky || !this.fadeQuad.visible) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!this.rt) this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: true });
    else if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y);
    (this.fadeQuad.material as THREE.ShaderMaterial).uniforms.tSky.value = this.rt.texture;
    const prevTarget = renderer.getRenderTarget(), prevAlpha = renderer.getClearAlpha();
    const prevColor = renderer.getClearColor(new THREE.Color());
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    sky.visible = true;
    renderer.render(sky, this.rig.camera);
    sky.visible = false;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
  }

  private orbitPos(out = new THREE.Vector3()) {
    const o = this.orbit;
    return out.set(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist).add(this.centre);
  }

  private orbitAt(yaw: number, pitch: number, dist: number) {
    return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(this.centre);
  }

  /** Keys from the window into the cabin, turning round over the wheel and the table to the landing view. */
  private enterKeys(): Key[] {
    const over = this.rig.viewFor('overview');
    const a = new THREE.Vector3(0.1, 1.98, -1.6), b = new THREE.Vector3(0.5, 1.92, 0.5);
    return [
      { p: WINDOW.clone(), t: new THREE.Vector3(0, 1.75, 1.6) },
      { p: a, t: new THREE.Vector3(2.5, 1.62, 1.2) },
      { p: b, t: new THREE.Vector3(2.4, 1.5, -2.6) },
      { p: over.pos, t: over.target },
    ];
  }

  /** Keys from far astern (looking at the ship) in through the middle window. */
  private approachKeys(far: THREE.Vector3): Key[] {
    const into = new THREE.Vector3(0, 1.7, 2);
    return [
      { p: far.clone().lerp(ASTERN, 0.6).setY(lerp(far.y, ASTERN.y, 0.75)), t: this.centre.clone().lerp(into, 0.1) },
      { p: ASTERN.clone(), t: this.centre.clone().lerp(into, 0.8) },
    ];
  }

  private skipAll = false;
  private run(dur: number, step: (k: number) => void, skippable = false, holdAt = 0): Promise<void> {
    return new Promise(resolve => {
      let t0 = -1, skipped = this.skipAll && skippable;
      const onSkip = () => { skipped = true; this.skipAll = true; };
      if (skippable) { addEventListener('pointerdown', onSkip); addEventListener('keydown', onSkip); }
      const frame = (now: number) => {
        if (t0 < 0) t0 = now;
        let k = dur <= 0 ? 1 : clamp((now - t0) / 1000 / dur, 0, 1);
        if (HOLD !== null && skippable) { k = clamp((HOLD - holdAt) / dur, 0, 1); if (HOLD < holdAt + dur && k >= 1) k = 0.9999; if (HOLD < holdAt + dur) { step(k); requestAnimationFrame(frame); return; } }
        if (skipped) k = 1;
        step(k);
        if (k >= 1) { if (skippable) { removeEventListener('pointerdown', onSkip); removeEventListener('keydown', onSkip); } resolve(); return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  /** Fly one path; the window crossfade follows the camera. `level` (0..1 of the time) eases the ship and the camera's up level. */
  private async fly(f: Flight, dur: number, opts: { skippable?: boolean; level?: number; fov0?: number } = {}) {
    const r0 = this.ship.roll, p0 = this.ship.pitch;
    const up0 = this.pose.up.clone(), Y = new THREE.Vector3(0, 1, 0);
    const level = opts.level ?? 0.3;
    const cam = this.rig.camera, fov0 = opts.fov0 ?? cam.fov, fov1 = cam.fov;
    await this.run(reducedMotion ? 0 : dur, k => {
      f.at(f.progress(k), this.pose.pos, this.pose.target);
      const l = clamp(k / level, 0, 1), e = l * l * (3 - 2 * l);
      if (r0 || p0) { this.ship.roll = r0 * (1 - e); this.ship.pitch = p0 * (1 - e); }
      this.pose.up.copy(up0).lerp(Y, e).normalize();
      if (fov0 !== fov1) { cam.fov = lerp(fov0, fov1, e); cam.updateProjectionMatrix(); }
      this.layoutWorld();
      this.atWindow(this.pose.pos);
    }, opts.skippable, 0);
  }

  /** Opening shot: start far astern, come in through the window, settle on the landing view. */
  async playIntro(): Promise<void> {
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    if (!this.holder || this.busy) return;
    this.busy = true;
    this.resetShip();
    const far = new THREE.Vector3(-22, 9, -44);
    this.pose.up.set(0, 1, 0);
    this.rig.cine = this.pose;
    this.layoutWorld();
    this.atWindow(far);
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'intro-skip'; skip.textContent = 'Skip';
    this.hooks.root.append(skip);
    this.skipAll = false;
    const keys: Key[] = [{ p: far, t: this.centre.clone() }, ...this.approachKeys(far), ...this.enterKeys()];
    // a slow start lingers on the whole ship before closing in
    const f = new Flight(keys, WINDOW, PACE.intro.grow, true, PACE.intro.turn);
    await this.run(f.duration, k => {
      f.at(f.progress(k), this.pose.pos, this.pose.target);
      this.layoutWorld();
      this.atWindow(this.pose.pos);
    }, true, 0);
    skip.remove();
    this.setMix(1);
    this.setOutside(false);
    this.rig.releaseCine();
    this.busy = false;
  }

  /** Leave through the window and take up the orbit view. */
  async goOutside(): Promise<boolean> {
    if (this.busy || this.mode !== 'inside') return false;
    this.busy = true;
    if (!(await this.ensureShip())) { this.busy = false; return false; }
    this.resetShip();
    this.orbit.yaw = this.orbit.yawT = 2.55; this.orbit.pitch = this.orbit.pitchT = 0.16; this.orbit.dist = this.orbit.distT = 46;
    const out = this.orbitPos();
    // start from exactly what is on screen (any view, any visitor turn / zoom / sway)
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    const fov0 = cam.fov;
    this.pose.pos.copy(cam.position);
    this.pose.target.copy(cam.position).add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(4));
    this.pose.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.rig.cine = this.pose;
    this.rig.jump('overview'); // under the cinematic: the rig is ready for the way back
    cam.fov = fov0; cam.updateProjectionMatrix();
    this.layoutWorld();
    const ahead = new THREE.Vector3(0, 1.74, -12);
    const mid = out.clone().lerp(ASTERN, 0.35).setY(lerp(ASTERN.y, out.y, 0.5));
    const side = ASTERN.clone().lerp(mid, 0.45).setY(lerp(ASTERN.y, mid.y, 0.3));
    const keys: Key[] = [
      { p: this.pose.pos.clone(), t: this.pose.target.clone() },
      { p: new THREE.Vector3(0.42, 1.86, 0.4), t: new THREE.Vector3(0.15, 1.76, -5) },
      { p: new THREE.Vector3(0.12, 1.82, -1.5), t: new THREE.Vector3(0.04, 1.74, -9) },
      { p: WINDOW.clone(), t: ahead },
      // clear of the stern, turn to port (back toward the ship) while flying out to starboard
      { p: ASTERN.clone(), t: ASTERN.clone().add(new THREE.Vector3(-0.35, 0, -0.94)) },
      { p: side, t: side.clone().add(new THREE.Vector3(-0.9, 0.05, -0.42)) },
      { p: mid, t: this.centre.clone() },
      { p: out, t: this.centre.clone() },
    ];
    // the camera's start may be anywhere in the cabin: drop the first cabin key when it would double back
    if (this.pose.pos.distanceTo(keys[1].p) < 0.6 || this.pose.pos.z < keys[1].p.z) keys.splice(1, 1);
    const f = new Flight(keys, WINDOW, PACE.out.grow, false, PACE.out.turn);
    await this.fly(f, f.duration, { level: 0.25, fov0 });
    this.setMix(0);
    this.setOutside(true);
    this.mode = 'orbit';
    this.busy = false;
    this.showHud(true);
    this.hooks.mode?.('orbit');
    return true;
  }

  /** Back in through the window to the landing view: round the ship to astern, then in. */
  async goInside(): Promise<void> {
    if (this.busy || this.mode === 'inside') return;
    this.busy = true;
    this.showHud(false);
    this.mode = 'inside';
    const o = this.orbit;
    // the swing round the ship, sampled on the orbit sphere so the path never cuts through the hull
    const yA = -2.97, pA = -0.042, dA = 35.5;
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    const y0 = wrap(o.yaw), dy = wrap(yA - y0);
    const n = Math.max(1, Math.ceil(Math.abs(dy) / 0.5));
    const keys: Key[] = [{ p: this.pose.pos.clone(), t: this.pose.target.clone() }];
    for (let i = 1; i <= n; i++) {
      const k = i / n, e = k * k * (3 - 2 * k);
      keys.push({ p: this.orbitAt(y0 + dy * k, lerp(o.pitch, pA, e), lerp(o.dist, dA, e)), t: this.centre.clone() });
    }
    const far = keys[keys.length - 1].p;
    keys.push(...this.approachKeys(far), ...this.enterKeys());
    const f = new Flight(keys, WINDOW, PACE.back.grow, true, PACE.back.turn);
    await this.fly(f, f.duration, { level: 0.3 });
    this.setMix(1);
    this.setOutside(false);
    this.rig.releaseCine();
    this.busy = false;
    this.hooks.mode?.('inside');
  }

  private resetShip() {
    const s = this.ship;
    s.pitch = s.roll = s.turn = s.climb = 0; s.speed = CRUISE * MAX_SPEED;
    this.keys.clear(); this.stick.turn = this.stick.climb = 0;
    this.setThrottle(CRUISE);
  }

  /** Throttle 0..1 (the ship eases toward throttle × MAX_SPEED). */
  setThrottle(v: number) {
    this.throttle = clamp(v, 0, 1);
    const pc = Math.round(this.throttle * 100);
    this.thrFill.style.height = `${pc}%`;
    this.thrEl.setAttribute('aria-valuenow', String(pc));
    this.thrEl.setAttribute('aria-valuetext', `${Math.round(this.throttle * MAX_SPEED)} metres a second`);
  }

  private showHud(on: boolean) {
    this.hud.hidden = !on;
    this.layer.hidden = !on;
    if (!on) { this.setHelm(false); return; }
    this.hud.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
    this.setHint();
    coach('outside'); // getting around: the same hint as indoors (once)
  }

  /** The helm's own help, shown while steering (getting around in general is coach.ts's one-time hint). */
  private setHint() {
    const touch = matchMedia('(pointer: coarse)').matches;
    this.hint.hidden = !this.helm;
    this.hint.textContent = !this.helm ? ''
      : touch ? 'The stick steers · the slider sets the speed'
        : 'A / D or ← → turn · W / S or ↑ ↓ climb · Q / E speed · the stick works too · Esc leaves the helm';
  }

  /** Take or leave the helm (see `helm`). */
  setHelm(on: boolean) {
    if (on && (this.busy || this.mode !== 'orbit')) return;
    if (on === this.helm) return;
    this.helm = on;
    if (on) dismissCoach();
    this.hud.classList.toggle('helm', on);
    this.helmBtn.textContent = on ? 'Leave the helm' : 'Take the helm';
    this.helmBtn.setAttribute('aria-pressed', String(on));
    if (!on) { this.keys.clear(); this.stick.turn = this.stick.climb = 0; this.knobEl.style.transform = ''; this.stickEl.classList.remove('on'); }
    this.setHint();
  }

  /** The shared camera moves (main.ts forwards the keys; the gestures come from this view's Input). */
  orbitBy(dx: number, dy: number) {
    if (this.busy || this.mode !== 'orbit') return;
    this.way.setCurrent(null);
    this.orbit.yawT -= dx * 4.2;
    this.orbit.pitchT = clamp(this.orbit.pitchT + dy * 2.4, -0.5, 1.1);
  }
  zoomBy(f: number) {
    if (this.busy || this.mode !== 'orbit') return;
    this.orbit.distT = clamp(this.orbit.distT * f, 16, 110);
  }

  private bindThrottle() {
    const el = this.thrEl, track = el.querySelector<HTMLElement>('.out-thr-track')!;
    const at = (e: PointerEvent) => { const r = track.getBoundingClientRect(); this.setThrottle(1 - (e.clientY - r.top) / r.height); };
    let id = -1;
    el.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); /* no focus: keys keep flying */ id = e.pointerId; el.setPointerCapture(id); at(e); });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) at(e); });
    const end = (e: PointerEvent) => { if (e.pointerId === id) id = -1; };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', e => {
      const step = { ArrowUp: 0.05, ArrowRight: 0.05, ArrowDown: -0.05, ArrowLeft: -0.05, PageUp: 0.2, PageDown: -0.2 }[e.key];
      if (step !== undefined) { e.preventDefault(); this.setThrottle(this.throttle + step); }
      else if (e.key === 'Home') { e.preventDefault(); this.setThrottle(0); }
      else if (e.key === 'End') { e.preventDefault(); this.setThrottle(1); }
    });
  }

  // ───────────────────────── stations

  private setupStations() {
    const b = this.shipBox, c = this.centre, V = THREE.Vector3, at = (f: () => THREE.Vector3) => () => f();
    // the ship stays put in the scene (the world turns round her), so her points are fixed between setShip calls
    // on the hull, not at the box's edge: the box takes in the wing fins and the bowsprit
    const lerpY = (k: number) => lerp(c.y, b.max.y, k);
    this.way.set([
      { id: 'bow', label: 'Bow — the figurehead', spot: at(() => new V(c.x, c.y + 1, lerp(c.z, b.max.z, 0.6))), facing: new V(0, 0, 1) },
      { id: 'port', label: 'Port side', spot: at(() => new V(lerp(c.x, b.max.x, 0.4), c.y, c.z)), facing: new V(1, 0, 0) },
      { id: 'starboard', label: 'Starboard side', spot: at(() => new V(lerp(c.x, b.min.x, 0.4), c.y, c.z)), facing: new V(-1, 0, 0) },
      { id: 'above', label: 'Above — the masts and the sails', spot: at(() => new V(c.x, lerpY(0.6), c.z)) },
      { id: 'inside', label: 'Stern windows — back inside to the cabin', spot: at(() => WINDOW), facing: new V(0, 0, -1) },
    ]);
  }

  /** Stations for the dock (going back in is the shared Back button there). */
  get stations() { return STATION_LABELS; }
  /** The station the view is at (null: the opening view, or the visitor turned it by hand). */
  get station() { return this.way.at; }

  /** Swing the orbit round to a station (the shortest way), back to the opening view ('home'), or back inside. */
  goStation(id: string) {
    if (this.busy || this.mode !== 'orbit') return;
    if (id === 'inside') { void this.goInside(); return; }
    if (id === 'home') {
      const o = this.orbit;
      o.yawT += Math.atan2(Math.sin(2.55 - o.yawT), Math.cos(2.55 - o.yawT)); o.pitchT = 0.16; o.distT = 46;
      this.way.setCurrent(null);
      return;
    }
    const o = this.orbit, P = STATIONS[id as keyof typeof STATIONS];
    if (!P) return;
    const yaw = P.yaw ?? o.yawT;
    o.yawT += Math.atan2(Math.sin(yaw - o.yawT), Math.cos(yaw - o.yawT));
    o.pitchT = P.pitch; o.distT = P.dist;
    this.way.setCurrent(id);
  }

  // ───────────────────────── input

  /** The same gestures as indoors (input.ts): drag looks, pinch / scroll zooms, double-tap back to the opening view. */
  private bindPointer(el: HTMLElement) {
    new Input(el, this.rig.camera, {
      targets: () => [],
      hover: () => {},
      click: (_hit, at) => this.hooks.click?.(new THREE.Vector2(at.x / innerWidth * 2 - 1, -(at.y / innerHeight) * 2 + 1)),
      dragStart: () => false, drag: () => {}, dragEnd: () => {},
      swipeDown: () => {}, escape: () => {}, look: () => {},
      orbit: (dx, dy) => this.orbitBy(dx, dy),
      zoom: f => this.zoomBy(f),
      pan: () => {},
      reset: () => this.goStation('home'),
    }, { keys: false, passThrough: false });
  }

  /** The helm's stick: a pad bottom left (drag the knob; it springs back when let go). */
  private bindStick() {
    const pad = this.stickEl;
    let id = -1;
    const at = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy), k = d > STICK_R ? STICK_R / d : 1;
      this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      this.stick.turn = clamp(dx / STICK_R, -1, 1);
      this.stick.climb = clamp(-dy / STICK_R, -1, 1);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1; this.stick.turn = this.stick.climb = 0;
      pad.classList.remove('on'); this.knobEl.style.transform = '';
    };
    pad.addEventListener('pointerdown', e => {
      if (!this.helm || id !== -1) return;
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId; pad.setPointerCapture(id); pad.classList.add('on'); at(e);
    });
    pad.addEventListener('pointermove', e => { if (e.pointerId === id) at(e); });
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }

  // ───────────────────────── per frame

  private layoutWorld() {
    const s = this.ship;
    // attitude: the world (and the camera, in update) lean the other way, so the ship reads as banking
    const att = new THREE.Quaternion().setFromEuler(new THREE.Euler(s.pitch, 0, s.roll, 'YXZ')).invert();
    const yawInv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.yaw);
    const q = att.clone().multiply(yawInv);
    this.world.quaternion.copy(q);
    this.world.position.copy(this.centre).sub(this.centre.clone().applyQuaternion(att));
    this.dome.quaternion.copy(q);
    this.dome.position.copy(this.rig.camera.position);
    const half = WORLD_BOX / 2;
    for (const it of this.islands) {
      const wrap = (v: number) => ((v % WORLD_BOX) + WORLD_BOX + half) % WORLD_BOX - half;
      it.o.position.set(wrap(it.base.x - s.pos.x), it.base.y - s.pos.y, wrap(it.base.z - s.pos.z));
    }
    return att;
  }

  update(dt: number) {
    if (this.mixK >= 1 && this.mode === 'inside') return;
    for (const sp of this.spinners) sp.o.rotateOnAxis(sp.axis, sp.rps * Math.PI * 2 * dt);
    if (this.mode === 'inside' || this.busy) {
      this.way.setVisible(false);
      // the opening shot and the way in and out: the ship cruising with its hands off the helm
      this.layoutWorld();
      this.parts?.update(dt, { turn: 0, climb: 0, throttle: CRUISE, speed: CRUISE, worldQ: this.world.quaternion, speedMs: CRUISE * MAX_SPEED, climbMs: 0 });
      return;
    }
    const s = this.ship, o = this.orbit;
    const key = (...k: string[]) => k.some(x => this.keys.has(x));
    const turn = (key('a', 'arrowleft') ? 1 : 0) - (key('d', 'arrowright') ? 1 : 0) - this.stick.turn;
    const climb = (key('w', 'arrowup') ? 1 : 0) - (key('s', 'arrowdown') ? 1 : 0) + this.stick.climb;
    const thr = (key('e', '+', '=') ? 1 : 0) - (key('q', '-') ? 1 : 0);
    if (thr) this.setThrottle(this.throttle + thr * 0.45 * dt);
    const damp = (a: number, b: number, l: number) => lerp(a, b, 1 - Math.exp(-l * dt));
    s.turn = damp(s.turn, clamp(turn, -1, 1), 2.2);
    s.climb = damp(s.climb, clamp(climb, -1, 1), 2.2);
    s.speed = damp(s.speed, this.throttle * MAX_SPEED, 0.8);
    const sp = s.speed / MAX_SPEED;
    // she answers the helm at any speed, crisper with way on; heels harder the faster she goes
    s.yaw += s.turn * 0.38 * (0.45 + 0.55 * sp) * dt;
    s.roll = damp(s.roll, -s.turn * 0.3 * (0.35 + 0.65 * sp), 2.5);
    s.pitch = damp(s.pitch, -s.climb * 0.16 + Math.sin(performance.now() / 1000 * 0.7) * 0.008, 2.5);
    const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    s.pos.addScaledVector(fwd, s.speed * dt);
    const climbMs = s.climb * (2 + s.speed * 0.4); // the lift stone climbs even at a stop
    s.pos.y = clamp(s.pos.y + climbMs * dt, -70, 140);
    if (reducedMotion) { o.yaw = o.yawT; o.pitch = o.pitchT; o.dist = o.distT; } // a station or a turn: cut, no swing
    else { o.yaw = damp(o.yaw, o.yawT, 8); o.pitch = damp(o.pitch, o.pitchT, 8); o.dist = damp(o.dist, o.distT, 6); }
    const att = this.layoutWorld();
    this.parts?.update(dt, { turn: s.turn, climb: s.climb, throttle: this.throttle, speed: sp, worldQ: this.world.quaternion, speedMs: s.speed, climbMs });
    // level orbit pose, then lean it with the world about the ship's centre
    const p = this.orbitPos();
    this.pose.pos.copy(p).sub(this.centre).applyQuaternion(att).add(this.centre);
    this.pose.target.copy(this.centre);
    this.pose.up.set(0, 1, 0).applyQuaternion(att);
    this.rig.cine = this.pose;
    this.dome.position.copy(this.pose.pos);
    this.way.setVisible(true);
    this.way.update(this.rig.camera);
  }
}
