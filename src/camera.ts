import * as THREE from 'three';
import type { Cabin, ViewName } from './scene';
import { tween, ease, reducedMotion, damp } from './anim';

/** Vertical FOV at landscape; portrait screens widen it to keep the horizontal framing. */
const BASE_VFOV = 50;
const REF_ASPECT = 16 / 10;
const { clamp, degToRad } = THREE.MathUtils;
/** Where the camera may be (the cabin interior, a little inside the walls, floor and ceiling beams). */
const ROOM = new THREE.Box3(new THREE.Vector3(-2.75, 0.35, -2.35), new THREE.Vector3(2.75, 2.55, 2.45));

/**
 * Visitor camera control per viewpoint.
 * - `look`: stand still, drag turns the head (yaw/pitch), zoom narrows the field of view.
 * - `orbit`: drag circles around the viewpoint's target, zoom changes the distance.
 * Angles in degrees relative to the authored viewpoint; zoom is a factor (1 = authored framing, <1 = closer).
 * panX/panY: how far (metres) the camera and its target may slide sideways / up-down from the authored framing.
 */
// panX/panY: raised 40% in the captain round (visitors wanted to slide further).
type Limits = { mode: 'look' | 'orbit' | 'none'; yaw: number; pitchDown: number; pitchUp: number; zoomIn: number; zoomOut: number; panX: number; panY: number };
const LIMITS: Record<ViewName, Limits> = {
  overview: { mode: 'look', yaw: 45, pitchDown: 22, pitchUp: 18, zoomIn: 0.45, zoomOut: 1.05, panX: 0.84, panY: 0.35 },
  chest:    { mode: 'orbit', yaw: 32, pitchDown: 12, pitchUp: 22, zoomIn: 0.5, zoomOut: 1.3, panX: 0.252, panY: 0.14 },
  table:    { mode: 'orbit', yaw: 45, pitchDown: 12, pitchUp: 18, zoomIn: 0.5, zoomOut: 1.25, panX: 0.42, panY: 0.28 },
  rack:     { mode: 'orbit', yaw: 28, pitchDown: 14, pitchUp: 14, zoomIn: 0.5, zoomOut: 1.25, panX: 0.28, panY: 0.21 },
  shelf:    { mode: 'orbit', yaw: 28, pitchDown: 14, pitchUp: 14, zoomIn: 0.5, zoomOut: 1.25, panX: 0.28, panY: 0.28 },
  handheld: { mode: 'orbit', yaw: 40, pitchDown: 15, pitchUp: 25, zoomIn: 0.55, zoomOut: 1.5, panX: 0.112, panY: 0.07 },
  screen:   { mode: 'none', yaw: 0, pitchDown: 0, pitchUp: 0, zoomIn: 1, zoomOut: 1, panX: 0.0, panY: 0.0 },
  portrait: { mode: 'orbit', yaw: 18, pitchDown: 10, pitchUp: 10, zoomIn: 0.6, zoomOut: 1.15, panX: 0.112, panY: 0.112 },
  letter:   { mode: 'orbit', yaw: 22, pitchDown: 8, pitchUp: 14, zoomIn: 0.6, zoomOut: 1.2, panX: 0.084, panY: 0.07 },
  clock:    { mode: 'orbit', yaw: 20, pitchDown: 10, pitchUp: 10, zoomIn: 0.6, zoomOut: 1.6, panX: 0.084, panY: 0.084 },
};

export class CameraRig {
  camera: THREE.PerspectiveCamera;
  view: ViewName = 'overview';
  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private look = new THREE.Vector2(); // pointer parallax
  private lookCur = new THREE.Vector2();
  private gliding = false;
  private sheet = 0;
  private sheetT = 0;
  private size = { w: 1, h: 1 };
  private baseFov = BASE_VFOV;
  // visitor offsets: goal and damped current value
  private yaw = 0; private yawCur = 0;
  private pitch = 0; private pitchCur = 0;
  private zoom = 1; private zoomCur = 1;
  private pan = new THREE.Vector2(); private panCur = new THREE.Vector2();
  /** Ship motion felt by the visitor's head (from ship.ts): a small trailing roll (rad) and heave (m). */
  headRoll = 0;
  headHeave = 0;
  /** Cinematic override (intro.ts): while set, the camera sits exactly at this pose and visitor input is ignored. */
  cine: { pos: THREE.Vector3; target: THREE.Vector3; up?: THREE.Vector3 } | null = null;

  constructor(private cabin: Cabin) {
    this.camera = new THREE.PerspectiveCamera(BASE_VFOV, 1, 0.03, 200);
    const v = this.viewFor('overview');
    this.pos.copy(v.pos); this.target.copy(v.target);
    this.apply();
  }

  resize(w: number, h: number) {
    this.size = { w, h };
    const aspect = w / h;
    this.camera.aspect = aspect;
    if (aspect < REF_ASPECT) {
      const hfov = 2 * Math.atan(Math.tan(degToRad(BASE_VFOV) / 2) * REF_ASPECT);
      const v = 2 * Math.atan(Math.tan(hfov / 2) / aspect);
      this.baseFov = Math.min(THREE.MathUtils.radToDeg(v), 82);
    } else this.baseFov = BASE_VFOV;
    // the landing view has its own portrait framing: follow it when the screen turns
    if (this.view === 'overview' && !this.gliding) { const v = this.viewFor('overview'); this.pos.copy(v.pos); this.target.copy(v.target); }
    this.updateFov();
    this.clampGoals();
  }

  viewFor(view: ViewName): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const v = this.cabin.views[view];
    // Phones held upright: stand a little higher and look down more, so the frame is the chart table with the
    // wheel and the stern windows above it (the landscape framing leaves half the table below the dock).
    if (view === 'overview' && this.portrait) return { pos: v.pos.clone().add(new THREE.Vector3(0, 0.12, 0.05)), target: new THREE.Vector3(v.target.x, v.target.y - 0.16, v.target.z) };
    return { pos: v.pos.clone(), target: v.target.clone() };
  }

  get portrait() { return this.size.w / this.size.h < 1; }
  private get lim(): Limits { return LIMITS[this.view] ?? LIMITS.screen; }
  /** Portrait phones see less of the cabin, so the overview may turn further. */
  private get yawLimit() { return degToRad(this.lim.yaw * (this.portrait && this.view === 'overview' ? 1.15 : 1)); }

  private clampGoals() {
    const L = this.lim;
    if (L.mode === 'none') { this.yaw = this.pitch = 0; this.zoom = 1; this.pan.set(0, 0); return; }
    this.yaw = clamp(this.yaw, -this.yawLimit, this.yawLimit);
    this.pitch = clamp(this.pitch, -degToRad(L.pitchDown), degToRad(L.pitchUp));
    this.zoom = clamp(this.zoom, L.zoomIn, L.zoomOut);
    this.pan.set(clamp(this.pan.x, -L.panX, L.panX), clamp(this.pan.y, -L.panY, L.panY));
  }

  /** Drag: fraction of the screen width/height moved. Dragging the world: finger right → look left. */
  orbit(dxNorm: number, dyNorm: number) {
    if (this.gliding) return;
    const k = this.lim.mode === 'look' ? 1.3 * this.zoom : 2.4;
    this.yaw += dxNorm * k;
    this.pitch += dyNorm * k * (this.lim.mode === 'look' ? 1 : 0.8);
    this.clampGoals();
  }

  /** Zoom by a factor: <1 closer, >1 further. */
  zoomBy(f: number) {
    if (this.gliding) return;
    this.zoom *= f;
    this.clampGoals();
  }

  /** Back to the authored framing of the current view. */
  /** Slide the camera sideways/up-down. Fractions of the screen; dragging the world: finger right → the view moves right. */
  panBy(dxNorm: number, dyNorm: number) {
    if (this.gliding) return;
    // metres per screen width at the target distance, so the content follows the finger
    const dist = this.pos.distanceTo(this.target) * (this.lim.mode === 'orbit' ? this.zoom : 1);
    const span = 2 * dist * Math.tan(degToRad(this.camera.fov) / 2);
    this.pan.x -= dxNorm * span * this.camera.aspect;
    this.pan.y += dyNorm * span;
    this.clampGoals();
  }

  resetView() { this.yaw = this.pitch = 0; this.zoom = 1; this.pan.set(0, 0); }
  get isOffset() { return Math.abs(this.yaw) > 0.02 || Math.abs(this.pitch) > 0.02 || Math.abs(this.zoom - 1) > 0.02 || this.pan.length() > 0.01; }
  get canControl() { return this.lim.mode !== 'none'; }

  /** One slow look left and right on first load, so phone visitors see the chest and the rack exist. */
  async introSweep() {
    if (!this.portrait || reducedMotion || this.view !== 'overview') return;
    const m = this.yawLimit * 0.5;
    for (const [to, d] of [[m, 1.4], [-m, 2.2], [0, 1.4]] as const) {
      const from = this.yaw;
      await tween(d, k => { if (this.view === 'overview') this.yaw = from + (to - from) * k; }, { ease: ease.inOutCubic, key: 'yaw' });
      if (this.view !== 'overview') return;
    }
  }

  /** Landing: start with a wider field of view (factor f) and settle into the authored framing. */
  async zoomInFrom(f: number, dur: number) {
    if (reducedMotion || this.lim.mode !== 'look') return;
    const set = (z: number) => { this.zoom = this.zoomCur = z; this.updateFov(); };
    set(f);
    await tween(dur, k => { if (this.view === 'overview') set(f + (1 - f) * k); }, { ease: ease.outCubic, key: 'zoom-in' });
  }

  get isGliding() { return this.gliding; }

  async glide(view: ViewName, dur = 1.1): Promise<void> {
    const to = this.viewFor(view);
    // Fold the visitor's current offsets into the start pose, so the glide starts from what is on screen.
    this.bakeOffsets();
    this.view = view;
    const p0 = this.pos.clone(), t0 = this.target.clone();
    const d = reducedMotion ? 0 : dur;
    this.gliding = true;
    const lift = Math.min(0.25, p0.distanceTo(to.pos) * 0.08);
    await tween(d, k => {
      this.pos.lerpVectors(p0, to.pos, k);
      this.pos.y += Math.sin(k * Math.PI) * lift;
      this.target.lerpVectors(t0, to.target, k);
    }, { ease: ease.inOutCubic, key: 'camera' });
    this.gliding = false;
  }

  jump(view: ViewName) {
    this.view = view;
    const v = this.viewFor(view);
    this.pos.copy(v.pos);
    this.target.copy(v.target);
    this.yaw = this.yawCur = this.pitch = this.pitchCur = 0;
    this.zoom = this.zoomCur = 1;
    this.pan.set(0, 0); this.panCur.set(0, 0);
    this.updateFov();
    this.apply();
  }

  /** Normalised pointer (-1..1) for a gentle look-around. */
  setLook(x: number, y: number) { this.look.set(x, y); }

  /** Bottom sheet open on phones: shift the picture up so the object stays visible. */
  setSheet(on: boolean) { this.sheetT = on ? 1 : 0; }

  update(t: number, dt: number) {
    const prev = this.sheet;
    this.sheet = reducedMotion ? this.sheetT : damp(this.sheet, this.sheetT, 6, dt);
    if (Math.abs(prev - this.sheet) > 1e-4 || (this.sheet === 0 && this.camera.view)) {
      const { w, h } = this.size;
      if (this.sheet < 1e-3) this.camera.clearViewOffset();
      else this.camera.setViewOffset(w, h, 0, h * 0.3 * this.sheet, w, h);
    }
    const amt = this.view === 'screen' || reducedMotion ? 0 : this.view === 'overview' ? 1 : 0.4;
    this.lookCur.x = damp(this.lookCur.x, this.look.x * amt, 3, dt);
    this.lookCur.y = damp(this.lookCur.y, this.look.y * amt, 3, dt);
    const s = reducedMotion ? Infinity : 10;
    const z0 = this.zoomCur;
    this.yawCur = s === Infinity ? this.yaw : damp(this.yawCur, this.yaw, s, dt);
    this.pitchCur = s === Infinity ? this.pitch : damp(this.pitchCur, this.pitch, s, dt);
    this.zoomCur = s === Infinity ? this.zoom : damp(this.zoomCur, this.zoom, s, dt);
    if (s === Infinity) this.panCur.copy(this.pan);
    else this.panCur.set(damp(this.panCur.x, this.pan.x, s, dt), damp(this.panCur.y, this.pan.y, s, dt));
    if (Math.abs(z0 - this.zoomCur) > 1e-5) this.updateFov();
    this.apply(t);
  }

  /** True while the visitor offsets are still easing toward their goal. */
  get settling() {
    return Math.abs(this.yaw - this.yawCur) + Math.abs(this.pitch - this.pitchCur) + Math.abs(this.zoom - this.zoomCur) + this.pan.distanceTo(this.panCur) > 1e-3;
  }

  private updateFov() {
    const f = this.lim.mode === 'look' ? this.zoomCur : 1;
    this.camera.fov = this.baseFov * f;
    this.camera.updateProjectionMatrix();
  }

  /** Camera position and look target with the visitor offsets applied. */
  /** Camera pose with the visitor's turn/zoom, then the pan slide on top. */
  private posed(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const p = this.turned();
    if (this.panCur.lengthSq() < 1e-8) return p;
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3().subVectors(p.target, p.pos).setY(0);
    const right = fwd.lengthSq() > 1e-8 ? fwd.normalize().cross(up) : new THREE.Vector3(1, 0, 0);
    const slide = right.multiplyScalar(this.panCur.x).addScaledVector(up, this.panCur.y);
    const pos = p.pos.clone().add(slide);
    // never slide out of the room: clamp the camera and move the target by the same amount
    const clamped = pos.clone().clamp(ROOM.min, ROOM.max);
    slide.add(clamped.sub(pos));
    return { pos: p.pos.add(slide), target: p.target.add(slide) };
  }

  /** Camera pose with the visitor's turn (yaw/pitch) and zoom applied. */
  private turned(): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const up = new THREE.Vector3(0, 1, 0);
    const mode = this.lim.mode;
    if (mode === 'look') {
      const dir = new THREE.Vector3().subVectors(this.target, this.pos);
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      dir.applyAxisAngle(up, this.yawCur).applyAxisAngle(right.applyAxisAngle(up, this.yawCur), this.pitchCur);
      return { pos: this.pos.clone(), target: this.pos.clone().add(dir) };
    }
    if (mode === 'orbit') {
      const off = new THREE.Vector3().subVectors(this.pos, this.target);
      const right = new THREE.Vector3().crossVectors(up, off).normalize();
      off.applyAxisAngle(up, -this.yawCur);
      off.applyAxisAngle(right.applyAxisAngle(up, -this.yawCur), -this.pitchCur);
      off.multiplyScalar(this.zoomCur);
      if (off.length() < 0.12) off.setLength(0.12);
      // stay inside the cabin: shorten the arm where it would leave the room box
      const t = this.target, dir = off.clone().normalize();
      let reach = off.length();
      for (const ax of ['x', 'y', 'z'] as const) {
        const d = dir[ax];
        if (Math.abs(d) < 1e-6) continue;
        const wall = d > 0 ? ROOM.max[ax] : ROOM.min[ax];
        reach = Math.min(reach, Math.max(0.12, (wall - t[ax]) / d));
      }
      off.setLength(reach);
      return { pos: t.clone().add(off), target: t.clone() };
    }
    return { pos: this.pos.clone(), target: this.target.clone() };
  }

  private bakeOffsets() {
    const p = this.posed();
    this.pos.copy(p.pos); this.target.copy(p.target);
    this.yaw = this.yawCur = this.pitch = this.pitchCur = 0;
    // a look-mode zoom is a field-of-view change, which a glide then eases back
    this.zoom = 1; this.zoomCur = 1;
    this.pan.set(0, 0); this.panCur.set(0, 0);
    this.updateFov();
  }

  private apply(t = 0) {
    const c = this.camera;
    if (this.cine) { c.position.copy(this.cine.pos); if (this.cine.up) c.up.copy(this.cine.up); c.lookAt(this.cine.target); return; }
    c.up.set(0, 1, 0);
    const p = this.posed();
    c.position.copy(p.pos);
    const sway = reducedMotion || this.view === 'screen' ? 0 : 1;
    c.position.y += (Math.sin(t * 0.6) * 0.006 + this.headHeave) * sway;
    c.position.x += Math.sin(t * 0.37) * 0.004 * sway;
    const dir = new THREE.Vector3().subVectors(p.target, p.pos);
    const dist = dir.length();
    const right = new THREE.Vector3().crossVectors(dir, c.up).normalize();
    const look = p.target
      .addScaledVector(right, this.lookCur.x * dist * 0.05)
      .addScaledVector(c.up, -this.lookCur.y * dist * 0.03);
    c.lookAt(look);
    c.rotation.z += (Math.sin(t * 0.45) * 0.002 + this.headRoll) * sway; // the head trails the ship's roll a little
  }

  /** Which way the camera faces (for panel placement etc). */
  get position() { return this.camera.position; }
}
