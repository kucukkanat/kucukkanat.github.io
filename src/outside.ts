// Outside the ship. The cabin sits inside the sky galleon (the ship's Cabin_anchor is put on the cabin's origin),
// so the camera can leave and enter through the middle stern window without a cut:
//   opening shot  → the galleon from astern, in through the window, a turn over the chart table, the landing view;
//   "Outside"     → the same way out, then an orbit view of the ship; "Take the helm" makes it fly.
// The ship itself never moves: flying turns and slides the outside world (and tilts world + camera for the bank),
// which leaves the baked cabin where it is.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CameraRig } from './camera';
import { ease, reducedMotion } from './anim';
import { FULL } from './tier';
import { loadGLB } from './scene';
import { uNight, uStorm } from './lighting';

const KEY = 'kk.intro.v1';
const HOLD = (() => { const v = new URLSearchParams(location.search).get('introT'); return v === null || !Number.isFinite(+v) ? null : +v; })();
const { clamp, lerp } = THREE.MathUtils;

/** Should the opening shot play on this load? (?intro=1 forces it, ?intro=0 and deep links skip it.) */
export function wantsIntro(params: URLSearchParams, deepLink: boolean): boolean {
  const q = params.get('intro');
  if (q === '1') return true;
  if (q === '0' || !FULL || reducedMotion || deepLink) return false;
  try { return localStorage.getItem(KEY) !== '1'; } catch { return false; }
}

export type OutsideMode = 'inside' | 'orbit' | 'helm';

export interface OutsideHooks {
  /** Where the HUD goes. */
  root: HTMLElement;
  /** The camera crossed the window: true = now outside (hide the window sky, the cabin UI), false = back inside. */
  crossed(outside: boolean): void;
  /** Mode changed (for announcements / sound). */
  mode?(m: OutsideMode): void;
}

// Path through the middle stern window, in cabin coordinates (windows face -Z, the bow is toward +Z).
const WINDOW = new THREE.Vector3(0, 1.8, -2.62);
const ASTERN = new THREE.Vector3(0, 1.86, -7.5);

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
  private centre = new THREE.Vector3(0, 6, 9);
  private pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  private orbit = { yaw: 2.55, pitch: 0.16, dist: 46, yawT: 2.55, pitchT: 0.16, distT: 46 };
  private ship = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, speed: 3, turn: 0, climb: 0 };
  private keys = new Set<string>();
  private drag = { turn: 0, climb: 0 };
  private hud: HTMLElement;
  private layer: HTMLElement;
  private helmBtn: HTMLButtonElement;
  private hint: HTMLElement;
  private isOut = false;

  constructor(private scene: THREE.Scene, private rig: CameraRig, private hooks: OutsideHooks) {
    this.world.name = 'OutsideWorld';
    this.world.visible = false;
    this.dome.visible = false;
    scene.add(this.world, this.dome);

    const layer = this.layer = document.createElement('div');
    layer.className = 'outside-layer';
    layer.hidden = true;
    const hud = this.hud = document.createElement('div');
    hud.className = 'outside-hud';
    hud.hidden = true;
    hud.innerHTML = `
      <button type="button" class="btn out-in">Back inside</button>
      <button type="button" class="btn out-helm" aria-pressed="false">Take the helm</button>
      <p class="out-hint" aria-live="polite"></p>`;
    hooks.root.append(layer, hud);
    this.helmBtn = hud.querySelector('.out-helm')!;
    this.hint = hud.querySelector('.out-hint')!;
    hud.querySelector('.out-in')!.addEventListener('click', () => { void this.goInside(); });
    this.helmBtn.addEventListener('click', () => this.setHelm(this.mode !== 'helm'));
    this.bindPointer(layer);
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.mode === 'inside' || this.busy) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.mode === 'helm') this.setHelm(false); else void this.goInside(); return; }
      if (e.key === 'h' || e.key === 'H') { this.setHelm(this.mode !== 'helm'); return; }
      this.keys.add(e.key.toLowerCase());
      if (e.key.startsWith('Arrow')) e.preventDefault();
    }, true);
    addEventListener('keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  get active() { return this.mode !== 'inside' || this.busy; }

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
      if (e.joint === 'spin' && e.axis && e.rpm) this.spinners.push({ o, axis: new THREE.Vector3(...e.axis).normalize(), rps: e.rpm / 60 });
      // the cabin brings its own stern windows: the ship's glass (opaque, glowing) and frames would cover them
      if (/^Gallery_(glass|frames)/.test(o.name)) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
    });
    this.scene.add(holder);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    box.getCenter(this.centre);
    this.centre.y = lerp(box.min.y, box.max.y, 0.36);
  }

  private ensureShip(): Promise<boolean> {
    if (this.holder) return Promise.resolve(true);
    return this.loading ??= loadGLB(FULL ? '/assets/galleon.glb' : '/assets/galleon_lite.glb').then(g => { this.setShip(g); return !!this.holder; });
  }

  // ───────────────────────── transitions

  private setOutside(on: boolean) {
    if (this.isOut === on) return;
    this.isOut = on;
    if (this.holder) this.holder.visible = on;
    this.world.visible = on;
    this.dome.visible = on;
    this.rig.camera.far = on ? 4000 : 200;
    this.rig.camera.updateProjectionMatrix();
    this.hooks.crossed(on);
  }

  /** Camera position on the way between the landing view and a point astern (k: 0 = landing view, 1 = astern). */
  private through(k: number, from: THREE.Vector3, out: THREE.Vector3, pos: THREE.Vector3, target: THREE.Vector3) {
    const over = this.rig.viewFor('overview');
    // inside part: up from the landing view, over the table and the wheel, turning to face the window
    const SPLIT = 0.42;
    if (k <= SPLIT) {
      const u = k / SPLIT;
      const e = ease.inOutCubic(u);
      const a = new THREE.Vector3(0.42, 1.86, 0.4), b = new THREE.Vector3(0.12, 1.82, -1.5);
      const curve = new THREE.CatmullRomCurve3([over.pos, a, b, WINDOW], false, 'catmullrom', 0.5);
      curve.getPoint(e, pos);
      // heading: the landing view looks at the windows already, so only ease the aim from its target to straight out
      target.lerpVectors(over.target, new THREE.Vector3(0, 1.74, -12), e);
      void from;
      return;
    }
    const u = (k - SPLIT) / (1 - SPLIT);
    const e = ease.inOutCubic(u);
    const curve = new THREE.CatmullRomCurve3([WINDOW, ASTERN, out.clone().lerp(ASTERN, 0.35).setY(lerp(ASTERN.y, out.y, 0.5)), out], false, 'catmullrom', 0.5);
    curve.getPoint(e, pos);
    // going out we look ahead (astern) and then turn back to the ship
    const ahead = new THREE.Vector3(0, 1.74, -12).lerp(pos.clone().add(new THREE.Vector3(0, 0, -6)), 0.5);
    target.lerpVectors(ahead, this.centre, ease.inOutCubic(clamp((u - 0.25) / 0.6, 0, 1)));
  }

  /** Coming in: from the window over the wheel and the table, turning round to the landing view (u: 0 = at the window). */
  private enter(u: number, pos: THREE.Vector3, target: THREE.Vector3) {
    const over = this.rig.viewFor('overview');
    const sm = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
    const curve = new THREE.CatmullRomCurve3([WINDOW, new THREE.Vector3(0.1, 1.98, -1.6), new THREE.Vector3(0.5, 1.92, 0.5), over.pos], false, 'catmullrom', 0.5);
    curve.getPoint(ease.inOutCubic(u), pos);
    // heading swings from "forward into the cabin" round the starboard side to "back at the windows"
    const ang = Math.PI * sm((u - 0.12) / 0.7);
    const dir = new THREE.Vector3(Math.sin(ang), -0.12 * sm(u * 2), Math.cos(ang)).multiplyScalar(4);
    target.copy(pos).add(dir).lerp(over.target, sm((u - 0.72) / 0.28));
  }

  /** Coming in, outside part (u: 0 = far, 1 = at the window): look at the ship, then into the middle window. */
  private approach(u: number, far: THREE.Vector3, pos: THREE.Vector3, target: THREE.Vector3) {
    const curve = new THREE.CatmullRomCurve3([far, far.clone().lerp(ASTERN, 0.6).setY(lerp(far.y, ASTERN.y, 0.75)), ASTERN, WINDOW], false, 'catmullrom', 0.5);
    curve.getPoint(u, pos);
    const sm = clamp((u - 0.25) / 0.55, 0, 1);
    target.lerpVectors(this.centre, new THREE.Vector3(0, 1.7, 2), sm * sm * (3 - 2 * sm));
  }

  private orbitPos(out = new THREE.Vector3()) {
    const o = this.orbit;
    return out.set(Math.sin(o.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw) * Math.cos(o.pitch)).multiplyScalar(o.dist).add(this.centre);
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

  /** Opening shot: start far astern, come in through the window, settle on the landing view. */
  async playIntro(): Promise<void> {
    try { localStorage.setItem(KEY, '1'); } catch { /* private mode */ }
    if (!this.holder || this.busy) return;
    this.busy = true;
    this.resetShip();
    const far = new THREE.Vector3(-22, 9, -44);
    this.pose.up.set(0, 1, 0);
    this.rig.cine = this.pose;
    this.setOutside(true);
    this.layoutWorld();
    const skip = document.createElement('button');
    skip.type = 'button'; skip.className = 'intro-skip'; skip.textContent = 'Skip';
    this.hooks.root.append(skip);
    this.skipAll = false;
    const OUT_T = 3.9, IN_T = 2.6;
    await this.run(OUT_T, k => {
      this.approach(Math.pow(k, 1.6), far, this.pose.pos, this.pose.target); // linger on the whole ship, then close in
    }, true, 0);
    this.setOutside(false);
    await this.run(IN_T, k => this.enter(k, this.pose.pos, this.pose.target), true, OUT_T);
    skip.remove();
    this.setOutside(false);
    this.rig.cine = null;
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
    this.pose.up.set(0, 1, 0);
    const start = this.rig.viewFor('overview');
    this.pose.pos.copy(start.pos); this.pose.target.copy(start.target);
    this.rig.jump('overview');
    this.rig.cine = this.pose;
    this.layoutWorld();
    await this.run(reducedMotion ? 0 : 4.2, k => {
      this.through(k, out, out, this.pose.pos, this.pose.target);
      this.setOutside(this.pose.pos.z < WINDOW.z);
    });
    this.setOutside(true);
    this.mode = 'orbit';
    this.busy = false;
    this.showHud(true);
    this.hooks.mode?.('orbit');
    return true;
  }

  /** Back in through the window to the landing view. */
  async goInside(): Promise<void> {
    if (this.busy || this.mode === 'inside') return;
    this.busy = true;
    this.showHud(false);
    this.setHelm(false, true);
    const from = this.rig.camera.position.clone();
    const lookFrom = this.pose.target.clone();
    // level the ship while the camera swings astern
    const r0 = this.ship.roll, p0 = this.ship.pitch;
    const out = new THREE.Vector3(-6, 4.5, -26);
    await this.run(reducedMotion ? 0 : 1.6, k => {
      const e = ease.inOutCubic(k);
      this.ship.roll = r0 * (1 - e); this.ship.pitch = p0 * (1 - e);
      this.layoutWorld();
      this.pose.up.set(0, 1, 0);
      this.pose.pos.lerpVectors(from, out, e);
      this.pose.target.lerpVectors(lookFrom, this.centre, e);
    });
    this.mode = 'inside';
    await this.run(reducedMotion ? 0 : 2.4, k => this.approach(ease.inOutCubic(k), out, this.pose.pos, this.pose.target));
    this.setOutside(false);
    await this.run(reducedMotion ? 0 : 2.6, k => this.enter(k, this.pose.pos, this.pose.target));
    this.setOutside(false);
    this.rig.cine = null;
    this.busy = false;
    this.hooks.mode?.('inside');
  }

  private resetShip() {
    const s = this.ship;
    s.pitch = s.roll = s.turn = s.climb = 0; s.speed = 3;
    this.keys.clear(); this.drag.turn = this.drag.climb = 0;
  }

  setHelm(on: boolean, quiet = false) {
    if (this.mode === 'inside' && !quiet) return;
    if (this.mode !== 'inside') this.mode = on ? 'helm' : 'orbit';
    this.helmBtn.setAttribute('aria-pressed', String(on));
    this.helmBtn.textContent = on ? 'Leave the helm' : 'Take the helm';
    this.layer.classList.toggle('helm', on);
    const touch = matchMedia('(pointer: coarse)').matches;
    this.hint.textContent = on
      ? (touch ? 'Drag left or right to turn, up or down to climb or dive' : 'A / D or ← → turn · W / S or ↑ ↓ climb and dive · drag also steers · Esc lets go')
      : (touch ? 'Drag to look around the ship · pinch to zoom' : 'Drag to look around the ship · scroll to zoom · H takes the helm · Esc goes back inside');
    if (!quiet) this.hooks.mode?.(this.mode);
  }

  private showHud(on: boolean) {
    this.hud.hidden = !on;
    this.layer.hidden = !on;
    if (on) this.setHelm(false, true);
  }

  // ───────────────────────── input

  private bindPointer(el: HTMLElement) {
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = 0; });
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; if (!pts.size) this.drag.turn = this.drag.climb = 0; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId);
      if (!p || this.busy) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (pts.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) this.orbit.distT = clamp(this.orbit.distT * pinch / Math.max(d, 1), 16, 110);
        pinch = d;
        return;
      }
      if (this.mode === 'helm') {
        // the drag is a tiller: how far the pointer is from where it went down sets the turn and the climb
        this.drag.turn = clamp(dx / (innerWidth * 0.22), -1, 1);
        this.drag.climb = clamp(-dy / (innerHeight * 0.22), -1, 1);
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      this.orbit.yawT -= dx / innerWidth * 4.2;
      this.orbit.pitchT = clamp(this.orbit.pitchT + dy / innerHeight * 2.4, -0.5, 1.1);
    });
    el.addEventListener('wheel', e => { e.preventDefault(); this.orbit.distT = clamp(this.orbit.distT * Math.exp(e.deltaY * 0.0012), 16, 110); }, { passive: false });
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
    if (!this.isOut && this.mode === 'inside') return;
    for (const sp of this.spinners) sp.o.rotateOnAxis(sp.axis, sp.rps * Math.PI * 2 * dt);
    if (this.mode === 'inside' || this.busy) { this.layoutWorld(); return; }
    const s = this.ship, o = this.orbit;
    const helm = this.mode === 'helm';
    const key = (...k: string[]) => k.some(x => this.keys.has(x));
    let turn = 0, climb = 0;
    if (helm) {
      turn = (key('a', 'arrowleft') ? 1 : 0) - (key('d', 'arrowright') ? 1 : 0) - this.drag.turn;
      climb = (key('w', 'arrowup') ? 1 : 0) - (key('s', 'arrowdown') ? 1 : 0) + this.drag.climb;
    }
    const damp = (a: number, b: number, l: number) => lerp(a, b, 1 - Math.exp(-l * dt));
    s.turn = damp(s.turn, clamp(turn, -1, 1), 2.2);
    s.climb = damp(s.climb, clamp(climb, -1, 1), 2.2);
    s.speed = damp(s.speed, helm ? 17 : 3, 0.8);
    s.yaw += s.turn * 0.38 * dt;
    s.roll = damp(s.roll, -s.turn * 0.3, 2.5);
    s.pitch = damp(s.pitch, -s.climb * 0.16, 2.5);
    const fwd = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    s.pos.addScaledVector(fwd, s.speed * dt);
    s.pos.y = clamp(s.pos.y + s.climb * s.speed * 0.45 * dt, -70, 140);
    o.yaw = damp(o.yaw, o.yawT, 8); o.pitch = damp(o.pitch, o.pitchT, 8); o.dist = damp(o.dist, o.distT, 6);
    const att = this.layoutWorld();
    // level orbit pose, then lean it with the world about the ship's centre
    const p = this.orbitPos();
    this.pose.pos.copy(p).sub(this.centre).applyQuaternion(att).add(this.centre);
    this.pose.target.copy(this.centre);
    this.pose.up.set(0, 1, 0).applyQuaternion(att);
    this.rig.cine = this.pose;
    this.dome.position.copy(this.pose.pos);
  }
}
