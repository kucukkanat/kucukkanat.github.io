// Polish-round props: welcome letter, portrait, message bottle, Tengwar note, √−1 slate, ship's bell.
// Every node is optional in cabin.glb. A missing prop gets a small procedural stand-in at the place the
// scene contract names, so the feature still works until the Blender build lands.
import * as THREE from 'three';
import type { Cabin, EggId } from './scene';
import { loadTexture } from './scene';
import type { Content } from './types';
import { DISPLAY, seeded } from './labels';
import { tween, ease, reducedMotion, damp } from './anim';
import { uNight, uStorm } from './lighting';

export interface Prop {
  id: EggId;
  obj: THREE.Object3D;
  /** Raycast target (HIT_* box or the prop itself). */
  hit: THREE.Object3D;
  /** true when built here because cabin.glb doesn't have it yet. */
  standIn: boolean;
}

const up = new THREE.Vector3(0, 1, 0);

// ---------- canvas helpers ----------
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}
function tex(c: HTMLCanvasElement, flipY: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = flipY;
  t.anisotropy = 4;
  return t;
}
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function paper(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string, base = '#efe1c2') {
  const rnd = seeded(seed);
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * w * 0.25;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,105,55,${0.04 + rnd() * 0.05})`); g.addColorStop(1, 'rgba(150,105,55,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(110,70,30,0.35)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) { ctx.fillStyle = rnd() > 0.5 ? '#3a2412' : '#fff'; ctx.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
  ctx.globalAlpha = 1;
}

/** Painted-looking stand-in portrait: a captain's silhouette with a peaked cap on a warm ground. */
export function portraitPlaceholder(): HTMLCanvasElement {
  const W = 512, H = 512;
  const [c, ctx] = canvas(W, H);
  const rnd = seeded('portrait');
  const g = ctx.createRadialGradient(W * 0.45, H * 0.35, 30, W / 2, H / 2, H * 0.75);
  g.addColorStop(0, '#f2c27e'); g.addColorStop(0.45, '#d98a4e'); g.addColorStop(1, '#5e2a1a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // loose brush strokes
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = rnd() * H, l = 20 + rnd() * 60, a = rnd() * Math.PI;
    ctx.strokeStyle = `hsla(${20 + rnd() * 25},${50 + rnd() * 30}%,${35 + rnd() * 40}%,${0.05 + rnd() * 0.08})`;
    ctx.lineWidth = 4 + rnd() * 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  const ink = '#2a1712';
  ctx.fillStyle = ink;
  // shoulders / coat
  ctx.beginPath();
  ctx.moveTo(60, H); ctx.bezierCurveTo(70, 470, 150, 430, 210, 420);
  ctx.lineTo(302, 420); ctx.bezierCurveTo(362, 430, 442, 470, 452, H); ctx.closePath(); ctx.fill();
  // neck + head
  ctx.fillRect(228, 360, 56, 70);
  ctx.beginPath(); ctx.ellipse(256, 318, 70, 86, 0, 0, Math.PI * 2); ctx.fill();
  // peaked cap: crown, band, brim
  ctx.beginPath();
  ctx.moveTo(168, 262); ctx.bezierCurveTo(160, 205, 210, 178, 262, 180);
  ctx.bezierCurveTo(330, 182, 360, 210, 352, 258); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3b2216'; ctx.fillRect(176, 246, 170, 22);
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.moveTo(176, 266); ctx.quadraticCurveTo(250, 300, 336, 268); ctx.lineTo(330, 280); ctx.quadraticCurveTo(250, 312, 182, 278); ctx.closePath(); ctx.fill();
  // gold badge + coat buttons + epaulette glints
  ctx.fillStyle = '#e2b468';
  ctx.beginPath(); ctx.ellipse(260, 222, 16, 12, 0, 0, Math.PI * 2); ctx.fill();
  for (const y of [500, 552, 604]) { ctx.beginPath(); ctx.arc(256, y, 6, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 0.7;
  ctx.fillRect(130, 452, 70, 8); ctx.fillRect(312, 452, 70, 8);
  ctx.globalAlpha = 1;
  // rim light from the windows
  ctx.strokeStyle = 'rgba(255,200,130,0.35)'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.ellipse(256, 318, 70, 86, 0, -1.2, 0.6); ctx.stroke();
  // varnish + vignette
  const v = ctx.createRadialGradient(W / 2, H * 0.45, H * 0.2, W / 2, H / 2, H * 0.7);
  v.addColorStop(0, 'rgba(255,220,160,0.08)'); v.addColorStop(1, 'rgba(40,15,5,0.55)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = rnd() > 0.5 ? '#000' : '#fff'; ctx.fillRect(rnd() * W, rnd() * H, 2, 2); }
  ctx.globalAlpha = 1;
  return c;
}

/** Chalk "√−1" on slate. */
function slateCanvas(): HTMLCanvasElement {
  const W = 512, H = 384;
  const [c, ctx] = canvas(W, H);
  const rnd = seeded('slate');
  ctx.fillStyle = '#2b3230'; ctx.fillRect(0, 0, W, H);
  // old wiped-off chalk clouds
  for (let i = 0; i < 14; i++) {
    const x = rnd() * W, y = rnd() * H, r = 40 + rnd() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(220,225,215,${0.03 + rnd() * 0.05})`); g.addColorStop(1, 'rgba(220,225,215,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // chalk text: many faint jittered passes
  const draw = (text: string, x: number, y: number, size: number, passes: number) => {
    ctx.font = `700 ${size}px ${DISPLAY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < passes; i++) {
      ctx.fillStyle = `rgba(240,240,232,${0.10 + rnd() * 0.08})`;
      ctx.fillText(text, x + (rnd() - 0.5) * 5, y + (rnd() - 0.5) * 5);
    }
  };
  // the radical, by hand: tick, down, long up-stroke, then the bar over −1
  const chalkLine = (pts: [number, number][], width: number, passes: number) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < passes; i++) {
      ctx.strokeStyle = `rgba(240,240,232,${0.12 + rnd() * 0.08})`; ctx.lineWidth = width * (0.8 + rnd() * 0.4);
      ctx.beginPath();
      pts.forEach(([x, y], j) => { const jx = x + (rnd() - 0.5) * 4, jy = y + (rnd() - 0.5) * 4; if (j) ctx.lineTo(jx, jy); else ctx.moveTo(jx, jy); });
      ctx.stroke();
    }
  };
  chalkLine([[78, 214], [112, 196], [160, 300], [214, 84], [452, 80]], 9, 12);
  draw('−1', 334, 196, 150, 14);
  ctx.font = `500 26px ${DISPLAY}`;
  ctx.fillStyle = 'rgba(235,235,225,0.45)'; ctx.textAlign = 'right';
  ctx.fillText('2 AM', W - 34, H - 34);
  // grain: knock dust out of the strokes, sprinkle some below
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5000; i++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.5})`; ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); }
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#2b3230'; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 260; i++) { ctx.fillStyle = `rgba(235,235,225,${rnd() * 0.25})`; ctx.fillRect(rnd() * W, H * 0.7 + rnd() * H * 0.3, 1.5, 1.5); }
  return c;
}

/** The folded letter's outside. seal: false when cabin.glb has a modelled wax seal. */
export function letterCanvas(seal = true): HTMLCanvasElement {
  const W = 512, H = 352;
  const [c, ctx] = canvas(W, H);
  paper(ctx, W, H, 'letter', '#f3e6c8');
  // folded flap
  ctx.fillStyle = 'rgba(120,80,40,0.12)';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W / 2, H * 0.55); ctx.lineTo(W, 0); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,55,25,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W / 2, H * 0.55); ctx.lineTo(W, 0); ctx.stroke();
  // wax seal
  if (!seal) {
    ctx.fillStyle = 'rgba(42,23,18,0.75)'; ctx.font = `italic 500 26px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('To whoever comes aboard', W / 2, H - 46);
    return c;
  }
  const g = ctx.createRadialGradient(W / 2 - 8, H * 0.55 - 8, 4, W / 2, H * 0.55, 46);
  g.addColorStop(0, '#d2483a'); g.addColorStop(1, '#7c1a14');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2, r = 44 + (i % 2 ? 3 : -2); ctx.lineTo(W / 2 + Math.cos(a) * r, H * 0.55 + Math.sin(a) * r); }
  ctx.fill();
  ctx.fillStyle = 'rgba(60,8,6,0.55)'; ctx.font = `700 34px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('HT', W / 2, H * 0.55 + 2);
  // address line
  ctx.fillStyle = 'rgba(42,23,18,0.75)'; ctx.font = `italic 500 26px ${DISPLAY}`;
  ctx.fillText('To whoever comes aboard', W / 2, H - 46);
  return c;
}

// ---------- the Tengwar note ----------
class TengwarNote {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private latin: HTMLCanvasElement;
  private elvish: HTMLCanvasElement | null = null;
  private k = 0;
  private target = 0;
  private drawnK = -1;

  constructor(private data: { latin: string; glyphs: string; font: string } | undefined, flipY: boolean) {
    [this.canvas, this.ctx] = canvas(768, 512);
    this.texture = tex(this.canvas, flipY);
    this.latin = this.face(null);
    this.draw();
  }

  /** Load the Tengwar font, then show the glyphs by default (Latin on hover). */
  async loadFont() {
    const d = this.data;
    if (!d?.glyphs?.trim() || !d.font?.trim()) return;
    try {
      const ff = new FontFace('KKTengwar', `url(/fonts/${encodeURIComponent(d.font)})`);
      await ff.load();
      document.fonts.add(ff);
      this.elvish = this.face('KKTengwar');
      this.drawnK = -1;
      this.draw();
    } catch { /* Latin only */ }
  }

  private face(font: string | null): HTMLCanvasElement {
    const [c, ctx] = canvas(768, 512);
    paper(ctx, 768, 512, 'tengwar');
    // pin
    const pg = ctx.createRadialGradient(380, 34, 2, 384, 38, 14);
    pg.addColorStop(0, '#f4d28a'); pg.addColorStop(1, '#8a5a1e');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(384, 38, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b1a10';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const text = font ? this.data!.glyphs : (this.data?.latin || 'Life is too short for hype-hopping. Build a foundation.');
    let size = font ? 110 : 64;
    let lines: string[] = [];
    for (; size > 20; size -= 2) {
      ctx.font = font ? `${size}px ${font}` : `italic 500 ${size}px ${DISPLAY}`;
      lines = wrapLines(ctx, text, 660);
      if (lines.length * size * (font ? 1.45 : 1.3) < 400) break;
    }
    const lh = size * (font ? 1.45 : 1.3);
    const top = 270 - ((lines.length - 1) * lh) / 2;
    const rnd = seeded('tw' + (font ?? ''));
    lines.forEach((l, i) => {
      ctx.save();
      ctx.translate(384, top + i * lh);
      ctx.rotate((rnd() - 0.5) * 0.02);
      ctx.fillText(l, 0, 0);
      ctx.restore();
    });
    return c;
  }

  setShowLatin(on: boolean) { this.target = on ? 1 : 0; }

  update(dt: number) {
    if (!this.elvish) return;
    this.k = reducedMotion ? this.target : damp(this.k, this.target, 7, dt);
    if (Math.abs(this.k - this.target) < 0.004) this.k = this.target;
    this.draw();
  }

  private draw() {
    if (Math.abs(this.drawnK - this.k) < 0.003) return;
    this.drawnK = this.k;
    const ctx = this.ctx;
    if (!this.elvish) { ctx.drawImage(this.latin, 0, 0); this.texture.needsUpdate = true; return; }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.elvish, 0, 0);
    if (this.k > 0) { ctx.globalAlpha = this.k; ctx.drawImage(this.latin, 0, 0); ctx.globalAlpha = 1; }
    this.texture.needsUpdate = true;
  }
}

// ---------- stand-in geometry ----------
const placeAt = (o: THREE.Object3D, pos: [number, number, number], yaw = 0) => { o.position.set(...pos); o.rotation.y = yaw; return o; };

function standIn(id: EggId): { obj: THREE.Object3D; face?: THREE.Mesh } {
  const g = new THREE.Group();
  g.name = `${id}_standin`;
  const wood = new THREE.MeshStandardMaterial({ color: '#5a3320', roughness: 0.8 });
  const brass = new THREE.MeshStandardMaterial({ color: '#c99a4a', roughness: 0.35, metalness: 0.85 });
  switch (id) {
    case 'letter': {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.103), new THREE.MeshStandardMaterial({ name: 'LetterPaper', roughness: 0.9 }));
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.004;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.004, 0.103), new THREE.MeshStandardMaterial({ color: '#e9d8b4', roughness: 0.9 }));
      body.position.y = 0.002;
      g.add(body, face);
      placeAt(g, [0.27, 0.853, 0.17], -0.35);
      return { obj: g, face };
    }
    case 'portrait': {
      const gilt = new THREE.MeshStandardMaterial({ color: '#a8782c', roughness: 0.5, metalness: 0.7 });
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.04), gilt);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.53, 0.046), new THREE.MeshStandardMaterial({ color: '#4a2a14', roughness: 0.7 }));
      g.add(lip);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), new THREE.MeshStandardMaterial({ name: 'PortraitCanvas', roughness: 0.85 }));
      face.position.z = 0.025;
      g.add(frame, face);
      // above the logbook rack, on the angled wall (normal ≈ (−0.68, 0, 0.73))
      placeAt(g, [2.4, 2.36, -1.6], Math.atan2(-0.68, 0.73));
      return { obj: g, face };
    }
    case 'bottle': {
      const pts: THREE.Vector2[] = [];
      for (const [r, y] of [[0.001, 0], [0.04, 0.002], [0.043, 0.02], [0.043, 0.13], [0.035, 0.16], [0.016, 0.185], [0.014, 0.23], [0.017, 0.235]] as const) pts.push(new THREE.Vector2(r, y));
      const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), new THREE.MeshStandardMaterial({ name: 'BottleGlass', color: '#9fc7a8', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false }));
      const note = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.11, 10), new THREE.MeshStandardMaterial({ color: '#efe0bd', roughness: 0.9 }));
      note.position.y = 0.075;
      const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.0195, 0.0195, 0.012, 10), new THREE.MeshStandardMaterial({ color: '#b3362a', roughness: 0.7 }));
      ribbon.position.y = 0.075;
      const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.013, 0.03, 10), new THREE.MeshStandardMaterial({ color: '#b08a5a', roughness: 1 }));
      cork.position.y = 0.245;
      const inner = new THREE.Group();
      inner.add(note, ribbon, cork, glass);
      inner.rotation.z = -Math.PI / 2 + 0.08; // lying on its side, neck slightly up
      inner.position.y = 0.043;
      g.add(inner);
      placeAt(g, [1.42, 0.93, -2.1], 0.35);
      return { obj: g };
    }
    case 'tengwar': {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.225, 0.15), new THREE.MeshStandardMaterial({ name: 'TengwarPaper', roughness: 0.95, side: THREE.DoubleSide }));
      face.rotation.z = 0.04;
      g.add(face);
      // on the window post next to the bookshelf, eye height
      placeAt(g, [-1.79, 1.62, -1.99], Math.atan2(0.6, 0.8));
      return { obj: g, face };
    }
    case 'slate': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.29, 0.02), wood);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.245), new THREE.MeshStandardMaterial({ name: 'SlateBoard', roughness: 1 }));
      face.position.z = 0.0105;
      const inner = new THREE.Group();
      inner.add(frame, face);
      inner.position.y = 0.145;
      inner.rotation.x = -0.16; // leaning back against the window
      g.add(inner);
      // standing on the left window sill (the bottle lies on the right one)
      placeAt(g, [-1.38, 0.925, -2.12], 0.3);
      return { obj: g, face };
    }
    case 'bell': {
      // origin at the hanging pivot; the bell swings about local X
      const pts: THREE.Vector2[] = [];
      for (const [r, y] of [[0.012, 0], [0.03, -0.01], [0.045, -0.05], [0.052, -0.1], [0.07, -0.135], [0.074, -0.145]] as const) pts.push(new THREE.Vector2(r, y));
      const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), new THREE.MeshStandardMaterial({ color: '#d8a650', roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide }));
      body.position.y = -0.03;
      const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12), brass);
      yoke.position.y = -0.012;
      const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), brass);
      clapper.position.y = -0.155; clapper.name = 'Bell_clapper';
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5), new THREE.MeshStandardMaterial({ color: '#c9b08a', roughness: 1 }));
      rope.position.y = -0.24;
      g.add(body, yoke, clapper, rope);
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.2), wood);
      bracket.position.set(0, 0.01, -0.09);
      const holder = new THREE.Group();
      holder.add(bracket);
      holder.name = 'bell_bracket';
      placeAt(g, [0.98, 2.02, -1.98], 0);
      g.userData.bracket = holder;
      return { obj: g };
    }
  }
}

// ---------- setup ----------
export interface Props {
  list: Prop[];
  get(id: EggId): Prop | undefined;
  hitObjects: THREE.Object3D[];
  center(id: EggId, out?: THREE.Vector3): THREE.Vector3 | null;
  liftLetter(on: boolean, camPos: THREE.Vector3): Promise<void>;
  setTengwarLatin(on: boolean): void;
  /** Portrait art + Tengwar font (after the first frame). */
  loadArt(): Promise<void>;
  update(t: number, dt: number): void;
}

export function setupProps(scene: THREE.Scene, cabin: Cabin, content: Content): Props {
  const list: Prop[] = [];
  const NODE: Record<EggId, string> = { letter: 'Letter', portrait: 'Portrait', bottle: 'Bottle', tengwar: 'Tengwar_note', slate: 'Slate', bell: 'Bell' };
  const FACE: Partial<Record<EggId, { mesh: string; mat: string }>> = {
    letter: { mesh: 'Letter_paper', mat: 'LetterPaper' },
    portrait: { mesh: 'Portrait_canvas', mat: 'PortraitCanvas' },
    tengwar: { mesh: 'Tengwar_paper', mat: 'TengwarPaper' },
    slate: { mesh: 'Slate_board', mat: 'SlateBoard' },
  };
  const faces = new Map<EggId, { mesh: THREE.Mesh; flipY: boolean }>();

  const findFace = (root: THREE.Object3D | undefined, spec: { mesh: string; mat: string }): THREE.Mesh | null => {
    const named = cabin.get(spec.mesh) as THREE.Mesh | undefined;
    if (named?.isMesh) return named;
    let found: THREE.Mesh | null = null;
    (root ?? cabin.root).traverse(o => {
      const m = o as THREE.Mesh;
      if (found || !m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some(x => x.name.replace(/\.\d+$/, '') === spec.mat)) found = m;
    });
    return found;
  };

  for (const id of Object.keys(NODE) as EggId[]) {
    let obj = cabin.get(NODE[id]);
    let standInFace: THREE.Mesh | undefined;
    const isStandIn = !obj;
    if (!obj) {
      const s = standIn(id);
      obj = s.obj;
      standInFace = s.face;
      scene.add(obj);
      if (obj.userData.bracket) { const b = obj.userData.bracket as THREE.Object3D; b.position.copy(obj.position); scene.add(b); }
      obj.updateMatrixWorld(true);
    }
    const spec = FACE[id];
    if (spec) {
      const mesh = standInFace ?? findFace(obj, spec);
      if (mesh) faces.set(id, { mesh, flipY: isStandIn });
    }
    let hit = cabin.eggHits.get(id);
    if (hit) {
      // an authored hit box that ended up away from its prop (HIT_letter lands on the floor) is moved back onto it
      const want = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
      const have = new THREE.Box3().setFromObject(hit).getCenter(new THREE.Vector3());
      hit.traverse(m => { m.userData.egg = true; });
      if (want.distanceTo(have) > 0.15 && hit.parent) {
        const p = hit.parent;
        p.updateWorldMatrix(true, false);
        const w = hit.getWorldPosition(new THREE.Vector3()).add(want.sub(have));
        hit.position.copy(p.worldToLocal(w));
        hit.updateMatrixWorld(true);
      }
    } else {
      hit = obj;
      obj.userData.hit = id;
    }
    list.push({ id, obj, hit, standIn: isStandIn });
  }
  const byId = new Map(list.map(p => [p.id, p]));

  // ----- surfaces -----
  const setFace = (id: EggId, map: THREE.Texture, glow = 0.18) => {
    const f = faces.get(id);
    if (!f) return null;
    const old = f.mesh.material as THREE.MeshStandardMaterial;
    const m = new THREE.MeshStandardMaterial({ name: old?.name, map, roughness: 0.9, metalness: 0, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: glow, side: old?.side ?? THREE.FrontSide });
    f.mesh.material = m;
    return m;
  };
  const faceMats: { m: THREE.MeshStandardMaterial; glow: number }[] = [];
  const addFace = (id: EggId, map: THREE.Texture, glow = 0.18) => { const m = setFace(id, map, glow); if (m) faceMats.push({ m, glow }); return m; };

  const portraitTex = tex(portraitPlaceholder(), faces.get('portrait')?.flipY ?? false);
  const portraitMat = addFace('portrait', portraitTex, 0.22);
  addFace('slate', tex(slateCanvas(), faces.get('slate')?.flipY ?? false), 0.12);
  if (byId.get('letter')?.standIn) addFace('letter', tex(letterCanvas(), true), 0.15);
  else addFace('letter', tex(letterCanvas(false), false), 0.12); // parchment + address around the modelled seal
  const tengwar = faces.has('tengwar') ? new TengwarNote(content.person.tengwar, faces.get('tengwar')!.flipY) : null;
  if (tengwar) addFace('tengwar', tengwar.texture, 0.15);
  // bottle glass: see-through
  byId.get('bottle')?.obj.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (mat: THREE.Material) => {
      if (mat.name.replace(/\.\d+$/, '') !== 'BottleGlass') return mat;
      const g = (mat as THREE.MeshStandardMaterial).clone();
      g.transparent = true; g.opacity = Math.min(g.opacity, 0.4); g.depthWrite = false; g.roughness = Math.min(g.roughness, 0.15);
      return g;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
    if ((Array.isArray(m.material) ? m.material : [m.material]).some(x => x.transparent)) m.renderOrder = 3;
  });

  // ----- derived viewpoints (when cabin.glb has none) -----
  const box = new THREE.Box3();
  const centerOf = (o: THREE.Object3D, out = new THREE.Vector3()) => { box.setFromObject(o); return box.isEmpty() ? o.getWorldPosition(out) : box.getCenter(out); };
  const faceNormal = (p: Prop) => {
    const f = faces.get(p.id)?.mesh ?? p.obj;
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(f.getWorldQuaternion(new THREE.Quaternion()));
    n.y = 0;
    return n.lengthSq() > 1e-4 ? n.normalize() : new THREE.Vector3(-0.68, 0, 0.73).normalize();
  };
  const portrait = byId.get('portrait');
  if (portrait && !cabin.authored.has('portrait')) {
    const c = centerOf(faces.get('portrait')?.mesh ?? portrait.obj);
    const n = faceNormal(portrait);
    cabin.views.portrait = { pos: c.clone().addScaledVector(n, 1.4).add(new THREE.Vector3(0, -0.3, 0)), target: c.clone().add(new THREE.Vector3(0, -0.04, 0)) };
  }
  const letter = byId.get('letter');
  if (letter && !cabin.authored.has('letter')) {
    const c = centerOf(letter.obj);
    cabin.views.letter = { pos: c.clone().add(new THREE.Vector3(0.05, 0.45, 0.42)), target: c.clone().add(new THREE.Vector3(0, 0.05, 0)) };
  }

  // ----- letter lift -----
  const lHome = letter ? { pos: letter.obj.position.clone(), quat: letter.obj.quaternion.clone() } : null;
  let lifted = 0;
  const liftLetter = async (on: boolean, camPos: THREE.Vector3) => {
    if (!letter || !lHome) return;
    const o = letter.obj, parent = o.parent!;
    parent.updateWorldMatrix(true, false);
    const homeWorld = parent.localToWorld(lHome.pos.clone());
    const toCam = camPos.clone().sub(homeWorld); toCam.y = 0;
    if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, 1);
    toCam.normalize();
    const liftWorld = homeWorld.clone().add(new THREE.Vector3(0, 0.13, 0)).addScaledVector(toCam, 0.06);
    const liftLocal = parent.worldToLocal(liftWorld.clone());
    const axis = new THREE.Vector3().crossVectors(up, toCam).normalize();
    const pq = parent.getWorldQuaternion(new THREE.Quaternion());
    const rot = new THREE.Quaternion().setFromAxisAngle(axis, 0.85);
    const liftQuat = pq.clone().invert().multiply(rot).multiply(pq).multiply(lHome.quat);
    const from = lifted, to = on ? 1 : 0;
    await tween(reducedMotion ? 0 : 0.7, k => {
      lifted = from + (to - from) * k;
      o.position.lerpVectors(lHome.pos, liftLocal, lifted);
      o.position.y += Math.sin(lifted * Math.PI) * 0.03;
      o.quaternion.slerpQuaternions(lHome.quat, liftQuat, lifted);
    }, { ease: on ? ease.outCubic : ease.inOutCubic, key: 'letter' });
  };

  // ----- deferred art -----
  const loadArt = async () => {
    await Promise.all([
      portraitMat ? loadTexture('/assets/portrait.webp').then(t => {
        if (!t) return;
        t.flipY = faces.get('portrait')!.flipY; t.anisotropy = 4; t.needsUpdate = true;
        portraitMat.map = t; portraitMat.emissiveMap = t; portraitMat.needsUpdate = true;
        portraitTex.dispose();
      }) : null,
      tengwar?.loadFont(),
    ]);
  };

  const update = (t: number, dt: number) => {
    tengwar?.update(dt);
    // painted surfaces carry a little self-light; less of it at night and in a storm
    const k = (1 - uNight.value * 0.75) * (1 - uStorm.value * 0.5);
    for (const f of faceMats) f.m.emissiveIntensity = f.glow * k;
    void t;
  };

  return {
    list,
    get: id => byId.get(id),
    hitObjects: list.map(p => p.hit),
    center: (id, out = new THREE.Vector3()) => { const p = byId.get(id); return p ? centerOf(p.obj, out) : null; },
    liftLetter,
    setTengwarLatin: on => tengwar?.setShowLatin(on),
    loadArt,
    update,
  };
}
