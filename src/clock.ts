// The ship's clock: hands follow the visitor's local time; a click shows a tiny panel with the time.
// Nodes (fix-round contract): Clock (+ HIT_clock), Clock_hour / Clock_minute / Clock_second, pivoting at the dial
// centre, rest pose at 12, rotated about the Clock group's local Z (dial normal, into the room); a positive
// angle is clockwise as seen from the room. Missing in cabin.glb → a small procedural stand-in on the right wall.
import * as THREE from 'three';
import type { Cabin } from './scene';
import { reducedMotion } from './anim';
import { DISPLAY } from './labels';

const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

interface Hand { o: THREE.Object3D; home: THREE.Quaternion; axis: THREE.Vector3; }

export class ShipClock {
  obj: THREE.Object3D | null;
  /** Raycast target (HIT_clock, or the stand-in). */
  hit: THREE.Object3D | null = null;
  standIn = false;
  private hands: Partial<Record<'hour' | 'minute' | 'second', Hand>> = {};
  private lastSec = -1;
  private lastHalf = -1;
  private panel: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private q = new THREE.Quaternion();
  private radius = 0;
  /** Debug: fixed time instead of now (ms since epoch). */
  fixed: number | null = null;

  constructor(scene: THREE.Scene, cabin: Cabin, uiRoot: HTMLElement,
    private hooks: { chime(half: boolean): void; closed?(): void }) {
    let obj = cabin.get('Clock') ?? null;
    if (!obj) { obj = standInClock(); scene.add(obj); obj.updateMatrixWorld(true); this.standIn = true; }
    this.obj = obj;
    obj.updateWorldMatrix(true, true);
    const clockQ = obj.getWorldQuaternion(new THREE.Quaternion());
    const dialN = new THREE.Vector3(0, 0, 1).applyQuaternion(clockQ);
    for (const k of ['hour', 'minute', 'second'] as const) {
      const o = cabin.get(`Clock_${k}`) ?? obj.getObjectByName(`Clock_${k}`);
      if (!o) continue;
      const pq = o.parent ? o.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      this.hands[k] = { o, home: o.quaternion.clone(), axis: dialN.clone().applyQuaternion(pq.invert()).normalize() };
    }
    const hitBox = cabin.get('HIT_clock');
    if (hitBox) {
      hitBox.traverse(m => { const mesh = m as THREE.Mesh; if (mesh.isMesh) { mesh.material = new THREE.MeshBasicMaterial({ visible: false }); mesh.userData.hit = 'clock'; } });
      hitBox.userData.hit = 'clock';
      this.hit = hitBox;
    } else {
      obj.traverse(m => { if ((m as THREE.Mesh).isMesh) m.userData.hit = 'clock'; });
      obj.userData.hit = 'clock';
      this.hit = obj;
    }
    // a camera view for ?view=clock (close-up), unless the GLB has one
    if (!cabin.authored.has('clock')) {
      const c = obj.getWorldPosition(new THREE.Vector3());
      const n = dialN.clone(); n.y = 0; if (n.lengthSq() < 1e-4) n.set(0, 0, 1); n.normalize();
      cabin.views.clock = { pos: c.clone().addScaledVector(n, 0.75).add(new THREE.Vector3(0, -0.08, 0)), target: c.clone() };
    }

    this.panel = document.createElement('section');
    this.panel.className = 'panel clock-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-labelledby', 'clock-time');
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <button type="button" class="icon-btn close" aria-label="Close">${CLOSE}</button>
      <div class="meta">Ship’s time</div>
      <h2 id="clock-time" tabindex="-1"></h2>
      <p class="sub">Ship’s time — the bell rings on the half hour.</p>`;
    this.panel.querySelector('.close')!.addEventListener('click', () => this.close());
    this.panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    uiRoot.appendChild(this.panel);
  }

  get isOpen() { return !this.panel.hidden && this.panel.classList.contains('open'); }

  center(out = new THREE.Vector3()) { return this.obj ? this.obj.getWorldPosition(out) : null; }

  private now() { return this.fixed !== null ? new Date(this.fixed + performance.now() - this.fixedAt) : new Date(); }
  private fixedAt = 0;
  setFixed(ms: number | null) { this.fixed = ms; this.fixedAt = performance.now(); this.lastHalf = -1; }

  /** Per frame. Returns true when something visible changed (reduced-motion render gate). */
  update(): boolean {
    const d = this.now();
    const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(), ms = d.getMilliseconds();
    const f = ms / 1000;
    // the second hand jumps once a second with a tiny overshoot (a damped spring), the others sweep
    const tick = reducedMotion ? 1 : 1 - Math.exp(-22 * f) * Math.cos(30 * f);
    const secA = ((s - 1 + tick) / 60) * Math.PI * 2;
    const minA = ((m + (s + f) / 60) / 60) * Math.PI * 2;
    const hourA = (((h % 12) + (m + s / 60) / 60) / 12) * Math.PI * 2;
    this.turn('second', secA);
    this.turn('minute', minA);
    this.turn('hour', hourA);
    // soft chime on the hour and the half hour
    const half = h * 2 + (m >= 30 ? 1 : 0);
    if (this.lastHalf >= 0 && half !== this.lastHalf && (m === 0 || m === 30)) this.hooks.chime(m === 30);
    this.lastHalf = half;
    const changed = s !== this.lastSec;
    if (changed) { this.lastSec = s; if (!this.panel.hidden) this.writeTime(d); }
    return changed || (!reducedMotion && f < 0.3);
  }

  private turn(k: 'hour' | 'minute' | 'second', angle: number) {
    const hd = this.hands[k];
    if (!hd) return;
    // clockwise seen from the room = negative about the dial normal (which points into the room)
    hd.o.quaternion.copy(this.q.setFromAxisAngle(hd.axis, -angle)).multiply(hd.home);
  }

  private writeTime(d: Date) {
    const el = this.panel.querySelector('#clock-time')!;
    el.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.setAttribute('aria-label', `It is ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} ship’s time`);
  }

  open() {
    if (!this.panel.hidden && this.panel.classList.contains('open')) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) this.returnFocus = document.activeElement;
    this.writeTime(this.now());
    this.panel.hidden = false;
    requestAnimationFrame(() => { this.panel.classList.add('open'); (this.panel.querySelector('h2') as HTMLElement).focus({ preventScroll: true }); });
  }

  close() {
    if (this.panel.hidden) return;
    this.panel.classList.remove('open');
    setTimeout(() => { if (!this.panel.classList.contains('open')) this.panel.hidden = true; }, 260);
    const rf = this.returnFocus; this.returnFocus = null;
    if (rf?.isConnected) rf.focus({ preventScroll: true });
    this.hooks.closed?.();
  }

  /** Desktop: the panel sits beside the clock. */
  place(camera: THREE.Camera, w: number, h: number) {
    if (this.panel.hidden || w <= 720 || !this.obj) return;
    const c = this.obj.getWorldPosition(new THREE.Vector3());
    if (!this.radius) this.radius = Math.max(0.05, new THREE.Box3().setFromObject(this.obj).getSize(new THREE.Vector3()).y / 2);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const v = c.clone().project(camera);
    const e = c.addScaledVector(right, this.radius).project(camera);
    const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
    const r = Math.abs(e.x - v.x) / 2 * w; // the clock's radius on screen
    const pw = this.panel.offsetWidth, ph = this.panel.offsetHeight;
    let left = x + r + 24;
    if (left + pw > w - 16 || v.z > 1) left = x - r - 24 - pw;
    this.panel.style.left = `${Math.max(16, Math.min(w - pw - 16, left))}px`;
    this.panel.style.top = `${Math.max(70, Math.min(h - ph - 90, y - ph / 2))}px`;
  }
}

/** Stand-in wall clock until cabin.glb carries one: brass rim, painted dial, three hands. */
function standInClock(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'Clock';
  const brass = new THREE.MeshStandardMaterial({ color: '#c99a4a', roughness: 0.35, metalness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ color: '#2a1c14', roughness: 0.5, metalness: 0.4 });
  const R = 0.12;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.12, R * 1.12, 0.04, 32), brass);
  rim.rotation.x = Math.PI / 2; rim.position.z = -0.01;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#efe3c6'; ctx.beginPath(); ctx.arc(256, 256, 256, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a2516'; ctx.fillStyle = '#3a2516'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
    ctx.lineWidth = big ? 8 : 3;
    ctx.beginPath(); ctx.moveTo(256 + Math.sin(a) * 236, 256 - Math.cos(a) * 236); ctx.lineTo(256 + Math.sin(a) * (big ? 200 : 220), 256 - Math.cos(a) * (big ? 200 : 220)); ctx.stroke();
  }
  ctx.font = `600 52px ${DISPLAY}`;
  const roman = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  roman.forEach((r, i) => { const a = (i / 12) * Math.PI * 2; ctx.fillText(r, 256 + Math.sin(a) * 160, 256 - Math.cos(a) * 160); });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const dial = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.15 }));
  dial.position.z = 0.0105;
  g.add(rim, dial);
  const hand = (name: string, len: number, wdt: number, z: number, mat: THREE.Material) => {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.z = z;
    const m = new THREE.Mesh(new THREE.BoxGeometry(wdt, len, 0.003), mat);
    m.position.y = len / 2 - len * 0.15;
    pivot.add(m); g.add(pivot);
  };
  hand('Clock_hour', R * 0.6, 0.012, 0.014, iron);
  hand('Clock_minute', R * 0.88, 0.008, 0.018, iron);
  hand('Clock_second', R * 0.95, 0.003, 0.022, new THREE.MeshStandardMaterial({ color: '#a8321f', roughness: 0.5 }));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 12), brass);
  cap.rotation.x = Math.PI / 2; cap.position.z = 0.025; g.add(cap);
  // right wall, above the pipes by the rack, facing into the room (local +Z → world −X)
  g.position.set(2.9, 2.2, 0.62);
  g.rotation.y = -Math.PI / 2;
  return g;
}
