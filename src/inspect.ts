// Inspect + flip: a clicked collectible (cartridge, book, notebook, memory card) or the welcome letter leaves its
// slot, flies up close to the camera, turns to face the visitor, flips to show its back and settles on its front.
// While inspected, dragging turns it (yaw/pitch, ±60°); clicking it flips it. Closing flies it back.
// The item is drawn in a second pass on top of the scene (layer 1, depth cleared) so it never clips into the cabin.
import * as THREE from 'three';
import type { Collectible } from './collectibles';
import type { CameraRig } from './camera';
import type { Item, Content } from './types';
import { tween, wait, ease, damp, clamp, reducedMotion } from './anim';
import { DISPLAY, SANS, seeded } from './labels';
import { wrapLines } from './props';

export type InspectKind = 'cartridge' | 'book' | 'notebook' | 'memcard' | 'letter';
export const INSPECT_LAYER = 1;

export interface InspectTarget {
  id: string;
  kind: InspectKind;
  obj: THREE.Object3D;
  item?: Item;
  coll?: Collectible;
  /** Show it as large as the screen allows (the welcome letter: it must be readable). */
  large?: boolean;
  /** No automatic turn-over and no flip on click. */
  still?: boolean;
  /** View-space size (m) to fit on screen instead of the object's bounding box (its origin is then its centre). */
  size?: THREE.Vector3;
  /** Arrived up close. */
  held?: () => void;
  /** Back home after close(). */
  landed?: () => void;
}

interface Prepared {
  /** Rotation that turns the object's front toward +Z with its top up (object → "view" space). */
  frontQ: THREE.Quaternion;
  /** Bounding-box centre in object space, and size in view space. */
  center: THREE.Vector3;
  size: THREE.Vector3;
  decals: THREE.Mesh[];
}

interface Flight {
  t: InspectTarget;
  p: Prepared;
  parent: THREE.Object3D;
  homePos: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  homeScale: THREE.Vector3;
  /** Pose the flight starts from (world). */
  from: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number };
  k: number;
  phase: 'in' | 'held' | 'out';
  token: number;
  fade?: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
}

const FRONT: Record<InspectKind, THREE.Quaternion> = {
  cartridge: new THREE.Quaternion(),
  memcard: new THREE.Quaternion(),
  // books stand with the spine toward the room (+Z); the front cover is local +X
  book: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  notebook: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
  // the letter's sheet (letter.ts) is built facing +Z, top up
  letter: new THREE.Quaternion(),
};
const MAX_TURN = THREE.MathUtils.degToRad(60);
const DIST = 0.38;

export class Inspector {
  cur: Flight | null = null;
  private returning: Flight[] = [];
  private prepared = new WeakMap<THREE.Object3D, Prepared>();
  private token = 0;
  private spin = 0;
  private yaw = 0; private yawT = 0;
  private pitch = 0; private pitchT = 0;
  private dragging = false;
  private screen = { x: 0, y: 0, h: 0, ready: false };
  private tmpV = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private rig: CameraRig, _content: Content,
    private panelRect: () => DOMRect | null) {
    scene.traverse(o => { if ((o as THREE.Light).isLight) o.layers.enable(INSPECT_LAYER); });
  }

  get active() { return !!this.cur && this.cur.phase !== 'out'; }
  /** Anything drawn in the overlay pass right now? */
  get overlay() { return !!this.cur || this.returning.length > 0; }
  isCurrent(id: string) { return this.active && this.cur!.t.id === id; }
  owns(o: THREE.Object3D | null | undefined) {
    if (!this.cur) return false;
    for (let x = o; x; x = x.parent) if (x === this.cur.t.obj) return true;
    return false;
  }
  /** Raycast targets while inspecting (the item itself, so a click can flip it). */
  pickables(): THREE.Object3D[] { return this.active ? [this.cur!.t.obj] : []; }

  /** Fly an item up to the camera. */
  open(t: InspectTarget) {
    if (this.cur?.t.obj === t.obj && this.cur.phase !== 'out') return;
    if (this.cur) this.close();
    // an item still flying home is caught mid-air
    const back = this.returning.findIndex(f => f.t.obj === t.obj);
    let parent: THREE.Object3D, homePos: THREE.Vector3, homeQuat: THREE.Quaternion, homeScale: THREE.Vector3;
    if (back >= 0) {
      const f = this.returning.splice(back, 1)[0];
      f.token = ++this.token; // stop its flight home
      ({ parent, homePos, homeQuat, homeScale } = f);
      this.restoreFade(f);
    } else {
      parent = t.obj.parent ?? this.scene;
      homePos = t.obj.position.clone(); homeQuat = t.obj.quaternion.clone(); homeScale = t.obj.scale.clone();
    }
    if (t.coll) t.coll.detached = true;
    const p = this.prepare(t);
    t.obj.updateWorldMatrix(true, true);
    const from = this.worldPose(t.obj);
    this.scene.attach(t.obj);
    for (const d of p.decals) d.visible = true;
    t.obj.traverse(o => { o.userData.inspected = true; });
    const f: Flight = { t, p, parent, homePos, homeQuat, homeScale, from, k: 0, phase: 'in', token: ++this.token };
    this.cur = f;
    this.spin = 0; this.yaw = this.yawT = 0; this.pitch = this.pitchT = 0;
    this.screen.ready = false;
    void this.run(f);
  }

  /** Fly the current item back to its slot. */
  close() {
    const f = this.cur;
    if (!f) return;
    this.cur = null;
    this.dragging = false;
    f.token = ++this.token;
    f.phase = 'out';
    f.t.obj.traverse(o => { delete o.userData.inspected; });
    f.from = this.worldPose(f.t.obj);
    f.k = 0;
    this.returning.push(f);
    void this.runBack(f);
  }

  /** Hand the item over to someone else (insert into the handheld) without flying it home. */
  release(id: string) {
    const f = this.cur;
    if (!f || f.t.id !== id) return;
    this.cur = null;
    this.dragging = false;
    f.token = ++this.token;
    this.restoreFade(f);
    this.setLayer(f, false);
    for (const d of f.p.decals) d.visible = false;
    f.t.obj.traverse(o => { delete o.userData.inspected; });
  }

  /** Click on the item: half a turn about its vertical axis. */
  flip() {
    if (!this.active || this.cur!.phase !== 'held' || this.cur!.t.still) return;
    this.cur!.token = ++this.token; // stop the automatic flip sequence
    const from = this.spin, to = Math.round(this.spin / Math.PI) * Math.PI + Math.PI;
    if (reducedMotion) { this.spin = to; return; }
    void tween(0.6, k => { this.spin = from + (to - from) * k; }, { ease: ease.inOutCubic, key: 'inspect-spin' });
  }

  startDrag() {
    if (!this.active) return false;
    this.dragging = true;
    if (this.cur!.phase === 'held') {
      // the visitor takes over: settle the automatic flip on the nearest face
      this.cur!.token = ++this.token;
      const from = this.spin, to = Math.round(this.spin / Math.PI) * Math.PI;
      if (Math.abs(to - from) > 1e-3) void tween(reducedMotion ? 0 : 0.35, k => { this.spin = from + (to - from) * k; }, { ease: ease.outCubic, key: 'inspect-spin' });
    }
    return true;
  }
  /** Pixels dragged. */
  drag(dx: number, dy: number) {
    if (!this.dragging) return;
    this.yawT = clamp(this.yawT + dx * 0.009, -MAX_TURN, MAX_TURN);
    this.pitchT = clamp(this.pitchT + dy * 0.009, -MAX_TURN, MAX_TURN);
  }
  endDrag() { this.dragging = false; }
  get isDragging() { return this.dragging; }

  /** World-space centre of the inspected item (panel anchor). */
  center(out = new THREE.Vector3()) {
    const f = this.cur;
    if (!f) return null;
    return out.copy(f.p.center).multiply(f.t.obj.scale).applyQuaternion(f.t.obj.quaternion).add(f.t.obj.position);
  }

  // ---------------------------------------------------------------- animation
  private async run(f: Flight) {
    const tok = f.token;
    if (reducedMotion) {
      f.k = 1; f.phase = 'held';
      this.beginFade(f, 0, 1, 0.3);
      f.t.held?.();
      return;
    }
    await tween(0.7, k => { if (f.token === tok) f.k = k; }, { ease: ease.inOutCubic, key: 'inspect-fly' });
    if (f.token !== tok) return;
    f.k = 1; f.phase = 'held';
    f.t.held?.();
    if (f.t.still) return;
    // turn over to show the back, look at it a moment, then come round to the front again
    await wait(0.25); if (f.token !== tok) return;
    await tween(0.65, k => { if (f.token === tok) this.spin = Math.PI * k; }, { ease: ease.inOutCubic, key: 'inspect-spin' });
    await wait(1.1); if (f.token !== tok) return;
    await tween(0.65, k => { if (f.token === tok) this.spin = Math.PI + Math.PI * k; }, { ease: ease.inOutCubic, key: 'inspect-spin' });
    if (f.token === tok) this.spin = 0;
  }

  private async runBack(f: Flight) {
    const tok = f.token;
    if (reducedMotion) {
      await this.beginFade(f, 1, 0, 0.2);
      if (f.token !== tok) return;
      f.k = 1;
    } else {
      await tween(0.6, k => { if (f.token === tok) f.k = k; }, { ease: ease.inOutCubic, key: `inspect-back-${f.t.id}` });
      if (f.token !== tok) return;
    }
    this.land(f);
  }

  private land(f: Flight) {
    const i = this.returning.indexOf(f);
    if (i >= 0) this.returning.splice(i, 1);
    this.restoreFade(f);
    this.setLayer(f, false);
    for (const d of f.p.decals) d.visible = false;
    const o = f.t.obj;
    f.parent.add(o);
    o.position.copy(f.homePos); o.quaternion.copy(f.homeQuat); o.scale.copy(f.homeScale);
    if (f.t.coll) { f.t.coll.detached = false; f.t.coll.pull = 0; f.t.coll.pullT = 0; }
    f.t.landed?.();
  }

  /** Per-frame: move the inspected item (it follows the camera) and the ones flying home. */
  update(dt: number) {
    const f = this.cur;
    if (f) {
      this.yaw = reducedMotion ? this.yawT : damp(this.yaw, this.yawT, 10, dt);
      this.pitch = reducedMotion ? this.pitchT : damp(this.pitch, this.pitchT, 10, dt);
      const goal = this.goalPose(f, dt);
      const o = f.t.obj;
      const k = f.k;
      o.position.lerpVectors(f.from.pos, goal.pos, k);
      // a little arc: up and toward the camera side
      o.position.y += Math.sin(k * Math.PI) * 0.06;
      o.quaternion.slerpQuaternions(f.from.quat, goal.quat, ease.outCubic(k));
      o.scale.setScalar(f.from.scale + (goal.scale - f.from.scale) * k);
      this.setLayer(f, k > 0.18);
    }
    for (const r of this.returning) {
      const home = this.homeWorld(r);
      const o = r.t.obj, k = r.k;
      o.position.lerpVectors(r.from.pos, home.pos, k);
      o.position.y += Math.sin(k * Math.PI) * 0.05;
      o.quaternion.slerpQuaternions(r.from.quat, home.quat, k);
      o.scale.setScalar(r.from.scale + (home.scale - r.from.scale) * k);
      this.setLayer(r, k < 0.82);
    }
  }

  private homeWorld(f: Flight) {
    f.parent.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().compose(f.homePos, f.homeQuat, f.homeScale).premultiply(f.parent.matrixWorld);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(pos, quat, s);
    return { pos, quat, scale: s.x };
  }

  /** Where the item should be on screen: clear of the info panel / bottom sheet, ~40% of the view height. */
  private goalPose(f: Flight, dt: number) {
    const cam = this.rig.camera;
    const w = innerWidth, h = innerHeight;
    const phone = w <= 720;
    const r = this.panelRect();
    const shown = r && r.width > 0 && r.height > 0;
    let cx: number, cy: number, hPx: number, maxW: number;
    if (f.t.large) {
      // as big as it fits between the header and the dock
      const top = phone ? 62 : 70, bottom = h - (phone ? 70 : 78);
      cx = w / 2; cy = (top + bottom) / 2;
      maxW = w * (phone ? 0.94 : 0.9);
      hPx = Math.max(120, bottom - top);
    } else if (phone) {
      const top = 64;
      const bottom = shown ? Math.min(h - 40, r!.top) : h * 0.42;
      const avail = Math.max(120, bottom - top);
      hPx = Math.min(h * 0.4, avail * 0.78);
      cy = top + avail / 2; cx = w / 2; maxW = w * 0.84;
    } else {
      const panelRight = !shown || r!.left + r!.width / 2 > w / 2;
      const free = !shown ? [0, w - 400] : panelRight ? [0, r!.left] : [r!.right, w];
      cx = (free[0] + free[1]) / 2;
      cy = h * 0.48;
      hPx = h * 0.4;
      maxW = (free[1] - free[0]) * 0.8;
    }
    const s = this.screen;
    if (!s.ready || reducedMotion) { s.x = cx; s.y = cy; s.h = hPx; s.ready = true; }
    else { s.x = damp(s.x, cx, 8, dt); s.y = damp(s.y, cy, 8, dt); s.h = damp(s.h, hPx, 8, dt); }

    cam.updateMatrixWorld();
    const dir = this.tmpV.set((s.x / w) * 2 - 1, -(s.y / h) * 2 + 1, 0.5).applyMatrix4(cam.projectionMatrixInverse).normalize();
    const pCam = dir.clone().multiplyScalar(DIST / Math.max(0.2, -dir.z));
    const viewH = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / cam.zoom;
    const perPx = viewH / h;
    const size = f.p.size;
    const scale = Math.min((s.h * perPx) / size.y, (maxW * perPx) / size.x);
    const camQ = cam.getWorldQuaternion(new THREE.Quaternion());
    const user = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw + this.spin, 0, 'YXZ'));
    const quat = camQ.multiply(user).multiply(f.p.frontQ);
    const pos = cam.localToWorld(pCam);
    pos.sub(f.p.center.clone().multiplyScalar(scale).applyQuaternion(quat));
    return { pos, quat, scale };
  }

  private worldPose(o: THREE.Object3D) {
    o.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), s = new THREE.Vector3();
    o.matrixWorld.decompose(pos, quat, s);
    return { pos, quat, scale: s.x };
  }

  private setLayer(f: Flight, on: boolean) {
    f.t.obj.traverse(o => { if (on) o.layers.enable(INSPECT_LAYER); else o.layers.disable(INSPECT_LAYER); });
  }

  // reduced motion: appear close and fade (temporary transparent copies of the materials)
  private beginFade(f: Flight, from: number, to: number, dur: number) {
    if (!f.fade) {
      f.fade = new Map();
      f.t.obj.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        f.fade!.set(m, m.material);
        const conv = (x: THREE.Material) => { const c = x.clone(); c.transparent = true; return c; };
        m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
      });
    }
    const set = (a: number) => { for (const m of f.fade!.keys()) for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.opacity = a; };
    set(from);
    return tween(dur, k => set(from + (to - from) * k), { ease: ease.linear, key: `inspect-fade-${f.t.id}` }).then(() => { if (to >= 1 && f.phase !== 'out') this.restoreFade(f); });
  }
  private restoreFade(f: Flight) {
    if (!f.fade) return;
    for (const [m, mat] of f.fade) {
      for (const x of Array.isArray(m.material) ? m.material : [m.material]) x.dispose();
      m.material = mat;
    }
    f.fade = undefined;
  }

  // ---------------------------------------------------------------- geometry + back faces
  private prepare(t: InspectTarget): Prepared {
    const hit = this.prepared.get(t.obj);
    if (hit) return hit;
    const o = t.obj;
    o.updateWorldMatrix(true, true);
    const inv = o.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    o.traverse(c => {
      const m = c as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!.clone().applyMatrix4(inv.clone().multiply(m.matrixWorld)));
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.05, 0, -0.01), new THREE.Vector3(0.05, 0.1, 0.01));
    const frontQ = FRONT[t.kind].clone();
    const center = t.size ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const vbox = box.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(frontQ));
    const size = t.size ? t.size.clone() : vbox.getSize(new THREE.Vector3());
    const vc = center.clone().applyQuaternion(frontQ);
    const invQ = frontQ.clone().invert();
    const decals: THREE.Mesh[] = [];
    const addDecal = (canvasFn: (w: number, h: number) => HTMLCanvasElement, fw: number, fh: number, back: boolean, dy = 0) => {
      const pw = size.x * fw, ph = size.y * fh;
      const c = canvasFn(512, Math.round(512 * ph / pw));
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
      const v = new THREE.Vector3(vc.x, vc.y + size.y * dy, vc.z + (back ? -1 : 1) * (size.z / 2 + 0.0008));
      mesh.position.copy(v.applyQuaternion(invQ));
      mesh.quaternion.copy(invQ);
      if (back) mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      mesh.name = back ? 'inspect_back' : 'inspect_front';
      mesh.visible = false;
      // the item's raycast tag (collectibles) carries over so a click on the decal flips it
      if (t.coll) mesh.userData.collectible = t.coll;
      o.add(mesh);
      decals.push(mesh);
    };
    const it = t.item;
    switch (t.kind) {
      case 'cartridge': addDecal((w, h) => cartridgeBack(it!, w, h), 0.78, 0.74, true, -0.02); break;
      case 'memcard': addDecal((w, h) => memcardBack(it!, w, h), 0.82, 0.62, true, 0.04); break;
      case 'book': case 'notebook':
        addDecal((w, h) => bookCover(it!, w, h, t.kind), 0.94, 0.95, false);
        addDecal((w, h) => bookBack(it!, w, h), 0.94, 0.95, true);
        break;
    }
    const p: Prepared = { frontQ, center, size, decals };
    this.prepared.set(o, p);
    return p;
  }
}

// ---------------------------------------------------------------- canvases
function cv(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, '').replace(/\s+/g, ' ').trim();
function firstSentences(text: string, max: number) {
  const parts = text.split(/(?<=[.!?])\s+/);
  let out = '';
  for (const p of parts) { if ((out + ' ' + p).trim().length > max && out) break; out = (out + ' ' + p).trim(); }
  return out.length > max ? out.slice(0, max - 1).trimEnd() + '…' : out;
}
function fit(ctx: CanvasRenderingContext2D, text: string, weight: string, family: string, maxW: number, start: number, min: number) {
  let s = start;
  for (; s > min; s -= 2) { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = `${weight} ${s}px ${family}`;
  return s;
}
function grainy(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, a = 0.05) {
  const rnd = seeded(seed);
  ctx.globalAlpha = a;
  for (let i = 0; i < (w * h) / 220; i++) { ctx.fillStyle = rnd() > 0.5 ? '#000' : '#fff'; ctx.fillRect(rnd() * w, rnd() * h, 2, 2); }
  ctx.globalAlpha = 1;
}

/** Back label of a cartridge: title, year, tags and the KANAT·1 small print. */
function cartridgeBack(it: Item, W: number, H: number) {
  const [c, ctx] = cv(W, H);
  ctx.fillStyle = '#efe4cc'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = it.colour; ctx.fillRect(0, 0, W, H * 0.06);
  ctx.strokeStyle = 'rgba(60,35,20,0.45)'; ctx.lineWidth = 4; ctx.strokeRect(14, H * 0.06 + 12, W - 28, H * 0.94 - 26);
  ctx.fillStyle = '#2a1712'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ts = fit(ctx, it.title, '700', DISPLAY, W - 70, 64, 28);
  ctx.fillText(it.title, W / 2, H * 0.2);
  ctx.font = `500 ${Math.round(ts * 0.5)}px ${SANS}`; ctx.fillStyle = 'rgba(42,23,18,0.75)';
  ctx.fillText([it.year, it.group?.toUpperCase()].filter(Boolean).join(' · '), W / 2, H * 0.2 + ts * 0.85);
  if (it.subtitle) {
    ctx.font = `italic 500 30px ${DISPLAY}`; ctx.fillStyle = '#3a2516';
    wrapLines(ctx, it.subtitle, W - 90).slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, H * 0.43 + i * 38));
  }
  // tags as little stamped pills
  const tags = (it.tags ?? []).slice(0, 4);
  ctx.font = `600 24px ${SANS}`;
  let rowY = H * 0.62;
  const widths = tags.map(t => ctx.measureText(t).width + 28);
  const rows: string[][] = [[]]; let rw = 0;
  tags.forEach((t, i) => { if (rw + widths[i] > W - 80 && rows[rows.length - 1].length) { rows.push([]); rw = 0; } rows[rows.length - 1].push(t); rw += widths[i] + 10; });
  for (const row of rows) {
    const total = row.reduce((a, t) => a + ctx.measureText(t).width + 38, -10);
    let x = W / 2 - total / 2;
    for (const t of row) {
      const tw = ctx.measureText(t).width + 28;
      ctx.strokeStyle = 'rgba(42,23,18,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x, rowY - 20, tw, 40, 20); ctx.stroke();
      ctx.fillStyle = 'rgba(42,23,18,0.8)'; ctx.fillText(t, x + tw / 2, rowY + 1);
      x += tw + 10;
    }
    rowY += 50;
  }
  ctx.fillStyle = 'rgba(42,23,18,0.6)'; ctx.font = `700 22px ${SANS}`;
  ctx.fillText('KANAT·1 cartridge', W / 2, H - 46);
  ctx.font = `500 16px ${SANS}`; ctx.fillStyle = 'rgba(42,23,18,0.45)';
  ctx.fillText('Insert label side up · Do not open while flying', W / 2, H - 22);
  grainy(ctx, W, H, it.id + 'back');
  return c;
}

/** Memory card back: role and period, like a save-file sticker. */
function memcardBack(it: Item, W: number, H: number) {
  const [c, ctx] = cv(W, H);
  ctx.fillStyle = '#f1e6cf'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = it.colour; ctx.fillRect(0, 0, W, H * 0.18);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `700 30px ${SANS}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('SHIP’S LOG', 24, H * 0.09);
  ctx.textAlign = 'right'; ctx.font = `500 28px ${SANS}`;
  ctx.fillText(it.current ? 'IN PROGRESS' : 'SAVED', W - 24, H * 0.09);
  ctx.textAlign = 'center'; ctx.fillStyle = '#2a1712';
  const name = it.title.replace(/\s*\(.*\)\s*/, '');
  fit(ctx, name, '700', DISPLAY, W - 60, 56, 26);
  ctx.fillText(name, W / 2, H * 0.36);
  if (it.role) {
    ctx.font = `italic 500 34px ${DISPLAY}`; ctx.fillStyle = '#3a2516';
    wrapLines(ctx, it.role, W - 60).slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, H * 0.55 + i * 40));
  }
  if (it.period) {
    ctx.font = `700 34px ${SANS}`; ctx.fillStyle = it.colour;
    ctx.fillText(it.period, W / 2, H * 0.84);
  }
  grainy(ctx, W, H, it.id + 'back');
  return c;
}

function coverBase(ctx: CanvasRenderingContext2D, it: Item, W: number, H: number) {
  ctx.fillStyle = it.colour; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.28)'); g.addColorStop(0.08, 'rgba(255,255,255,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#d9b46a'; ctx.lineWidth = 5; ctx.strokeRect(26, 26, W - 52, H - 52);
  ctx.lineWidth = 2; ctx.strokeRect(38, 38, W - 76, H - 76);
}

/** Front cover of a book / notebook: gilt title. */
function bookCover(it: Item, W: number, H: number, kind: InspectKind) {
  const [c, ctx] = cv(W, H);
  coverBase(ctx, it, W, H);
  ctx.fillStyle = '#f3dfae'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 60px ${DISPLAY}`;
  const lines = wrapLines(ctx, it.title, W - 120).slice(0, 4);
  const size = lines.length > 2 ? 50 : 60;
  ctx.font = `700 ${size}px ${DISPLAY}`;
  const top = H * 0.32 - (lines.length - 1) * size * 0.55;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * size * 1.1));
  ctx.fillStyle = '#d9b46a';
  ctx.fillRect(W / 2 - 60, H * 0.56, 120, 3);
  ctx.font = `500 24px ${SANS}`; ctx.fillStyle = 'rgba(243,223,174,0.85)';
  ctx.fillText(kind === 'notebook' ? 'NOTEBOOK' : 'FROM THE CAPTAIN’S SHELF', W / 2, H * 0.62);
  if (it.year) ctx.fillText(String(it.year), W / 2, H - 80);
  grainy(ctx, W, H, it.id + 'cover', 0.06);
  return c;
}

/** Back cover: a short blurb (the subtitle, or the first lines of the text). */
function bookBack(it: Item, W: number, H: number) {
  const [c, ctx] = cv(W, H);
  coverBase(ctx, it, W, H);
  const blurb = it.subtitle ? it.subtitle : firstSentences(plain(it.body), 170);
  ctx.font = `italic 500 30px ${DISPLAY}`;
  const lines = wrapLines(ctx, `“${blurb}”`, W - 150).slice(0, 7);
  const boxH = 120 + lines.length * 40;
  const top = H * 0.38 - boxH / 2;
  ctx.fillStyle = 'rgba(20,10,6,0.35)'; ctx.fillRect(56, top, W - 112, boxH);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f3dfae';
  ctx.font = `700 34px ${DISPLAY}`;
  ctx.fillText(wrapLines(ctx, it.title, W - 140)[0] ?? it.title, W / 2, top + 44);
  ctx.fillStyle = '#d9b46a'; ctx.fillRect(W / 2 - 40, top + 74, 80, 2);
  ctx.font = `italic 500 30px ${DISPLAY}`; ctx.fillStyle = 'rgba(251,238,221,0.92)';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + 108 + i * 40));
  ctx.font = `500 20px ${SANS}`; ctx.fillStyle = 'rgba(243,223,174,0.8)';
  ctx.fillText('kucukkanat.com', W / 2, H * 0.84);
  grainy(ctx, W, H, it.id + 'backc', 0.06);
  return c;
}
