// The welcome letter: clicking the envelope on the chart table (or the first visit, or the header's "Letter" link)
// draws a tri-folded sheet out of it, flies it up to the camera (inspect.ts) and unfolds it, large enough to read.
// The text is painted on the paper at high resolution; screen readers get the same text in a labelled dialog.
// Closing: click elsewhere, Esc, Back, or the small floating ✕ by the sheet's corner.
import * as THREE from 'three';
import type { Content } from './types';
import { DISPLAY } from './labels';
import { paper, wrapLines } from './props';
import { tween, ease, reducedMotion } from './anim';
import { escapeHtml as e } from './content';
import type { InspectTarget } from './inspect';

/** Unfolded sheet (m): a little smaller than A5, folded in three to fit the envelope. */
const W = 0.17, HS = 0.24, H3 = HS / 3;
const CW = 1200, CH = Math.round((CW * HS) / W);
const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function paragraphs(html: string): string[] {
  return html.split(/<\/p>|\n\s*\n/i)
    .map(p => p.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/gi, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(p => p.replace(/'/g, '’'));
}

/** The written side: title, body and sign-off, set as large as the page allows. */
function letterCanvas(title: string, paras: string[], signoff: string) {
  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  const ctx = c.getContext('2d')!;
  paper(ctx, CW, CH, 'letter-sheet', '#f4e8cc');
  // the two folds
  for (const y of [CH / 3, (2 * CH) / 3]) {
    const g = ctx.createLinearGradient(0, y - 10, 0, y + 10);
    g.addColorStop(0, 'rgba(110,70,30,0)'); g.addColorStop(0.5, 'rgba(110,70,30,0.16)'); g.addColorStop(1, 'rgba(110,70,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, y - 10, CW, 20);
  }
  const mx = 92, maxW = CW - mx * 2, top = 120, bottom = CH - 90;
  let size = 72, lines: string[][] = [], titleSize = 0, lh = 0, gap = 0, total = 0;
  for (; size >= 26; size -= 1) {
    ctx.font = `500 ${size}px ${DISPLAY}`;
    lines = paras.map(p => wrapLines(ctx, p, maxW));
    titleSize = Math.round(size * 1.7); lh = size * 1.42; gap = size * 0.7;
    total = titleSize * 1.5 + lines.reduce((a, l) => a + l.length * lh, 0) + gap * (lines.length - 1) + (signoff ? size * 2.6 : 0);
    if (total <= bottom - top) break;
  }
  let y = top + Math.max(0, (bottom - top - total) * 0.35);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#2a1712';
  ctx.font = `700 ${titleSize}px ${DISPLAY}`;
  y += titleSize;
  ctx.fillText(title, mx, y);
  y += titleSize * 0.5;
  ctx.font = `500 ${size}px ${DISPLAY}`; ctx.fillStyle = '#33200f';
  lines.forEach((para, pi) => {
    for (const l of para) { y += lh; ctx.fillText(l, mx, y); }
    if (pi < lines.length - 1) y += gap;
  });
  if (signoff) {
    ctx.font = `italic 600 ${Math.round(size * 1.15)}px ${DISPLAY}`; ctx.textAlign = 'right'; ctx.fillStyle = '#2a1712';
    ctx.fillText(signoff, CW - mx, y + size * 2.3);
  }
  return c;
}

export class LetterView {
  /** The sheet that flies up (the envelope stays on the table). */
  readonly sheet = new THREE.Group();
  private top = new THREE.Group();
  private bottom = new THREE.Group();
  private fold = 1;
  private el: HTMLElement;
  private closeBtn: HTMLButtonElement;
  private heading: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private corner = new THREE.Vector3();
  open = false;

  constructor(private scene: THREE.Scene, content: Content, private envelope: THREE.Object3D | undefined, parent: HTMLElement, private onClose: () => void) {
    const wel = content.person.welcome ?? { title: 'Welcome aboard', body: `<p>${e(content.person.bio)}</p>`, signoff: 'HT' };
    const paras = paragraphs(wel.body);
    const signoff = (wel.signoff ?? '').replace(/<[^>]+>/g, '').trim();
    // ----- the 3D sheet: three panels hinged at the folds; front = text, back = plain paper
    const tex = new THREE.CanvasTexture(letterCanvas(wel.title, paras, signoff));
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const front = new THREE.MeshStandardMaterial({ name: 'LetterSheet', map: tex, roughness: 0.92, metalness: 0, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.42 });
    const back = new THREE.MeshStandardMaterial({ name: 'LetterSheetBack', color: '#e9dcbc', roughness: 0.95, metalness: 0, emissive: '#e9dcbc', emissiveIntensity: 0.2, side: THREE.BackSide });
    const panel = (v0: number) => {
      const g = new THREE.PlaneGeometry(W, H3);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) / 3);
      const m = new THREE.Group();
      m.add(new THREE.Mesh(g, front), new THREE.Mesh(g, back));
      return m;
    };
    const mid = panel(1 / 3);
    const tp = panel(2 / 3); tp.position.y = H3 / 2;
    const bp = panel(0); bp.position.y = -H3 / 2;
    this.top.position.y = H3 / 2; this.top.add(tp);
    this.bottom.position.y = -H3 / 2; this.bottom.add(bp);
    this.sheet.add(mid, this.top, this.bottom);
    this.sheet.name = 'Letter_sheet';
    this.sheet.visible = false;
    this.setFold(1);
    scene.add(this.sheet);

    // ----- accessible twin + the floating ✕
    this.el = document.createElement('div');
    this.el.className = 'letter-view';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'false');
    this.el.setAttribute('aria-labelledby', 'letter-title');
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="sr-only" aria-live="polite">
        <h2 id="letter-title" tabindex="-1">${e(wel.title)}</h2>
        ${paras.map(p => `<p>${e(p)}</p>`).join('')}
        ${signoff ? `<p>${e(signoff)}</p>` : ''}
      </div>
      <button type="button" class="icon-btn letter-close" aria-label="Close the letter">${CLOSE}</button>`;
    this.heading = this.el.querySelector('#letter-title')!;
    this.closeBtn = this.el.querySelector('.letter-close')!;
    this.closeBtn.addEventListener('click', ev => { ev.stopPropagation(); this.onClose(); });
    this.el.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); this.onClose(); } });
    parent.appendChild(this.el);
  }

  private setFold(f: number) {
    this.fold = f;
    // the bottom third folds up first, the top third over it (tiny offsets: no z-fighting when flat)
    const fb = Math.min(1, f * 1.6), ft = Math.max(0, f * 1.6 - 0.6);
    this.bottom.rotation.x = -(Math.PI - 0.02) * fb;
    this.top.rotation.x = (Math.PI - 0.04) * ft;
  }

  /** Put the folded sheet on the envelope and hand it to the inspector. */
  target(id: string, onLanded: () => void): InspectTarget {
    const s = this.sheet;
    if (this.envelope) {
      this.envelope.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(this.envelope);
      const c = box.getCenter(new THREE.Vector3());
      s.position.set(c.x, box.max.y + 0.003, c.z);
      // flat on the envelope (folded, plain paper outside), its top edge where the envelope's is
      s.quaternion.copy(this.envelope.getWorldQuaternion(new THREE.Quaternion())).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    } else {
      s.position.set(0.27, 0.86, 0.2);
      s.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    }
    s.scale.setScalar(1);
    this.scene.add(s);
    s.visible = true;
    this.setFold(1);
    return {
      id, kind: 'letter', obj: s, large: true, still: true, size: new THREE.Vector3(W, HS, 0.004),
      held: () => { void tween(reducedMotion ? 0 : 0.75, k => this.setFold(1 - k), { ease: ease.inOutCubic, key: 'letter-fold' }); },
      landed: () => { s.visible = false; onLanded(); },
    };
  }

  show() {
    if (this.open) return;
    this.open = true;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) this.returnFocus = document.activeElement;
    this.el.hidden = false;
    this.el.classList.remove('on');
    requestAnimationFrame(() => {
      this.el.classList.add('on');
      this.heading.focus({ preventScroll: true });
    });
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.el.classList.remove('on');
    void tween(reducedMotion ? 0 : 0.35, k => this.setFold(Math.max(this.fold, k)), { ease: ease.inOutCubic, key: 'letter-fold' });
    setTimeout(() => { if (!this.open) this.el.hidden = true; }, 250);
    const rf = this.returnFocus;
    this.returnFocus = null;
    if (rf && document.contains(rf)) rf.focus({ preventScroll: true });
  }

  /** Keep the ✕ by the sheet's top-right corner. */
  place(camera: THREE.Camera, w: number, h: number) {
    if (!this.open) return;
    const ready = this.fold < 0.5;
    this.closeBtn.classList.toggle('ready', ready);
    this.corner.set(W / 2, HS / 2, 0);
    this.sheet.localToWorld(this.corner).project(camera);
    const x = (this.corner.x * 0.5 + 0.5) * w, y = (-this.corner.y * 0.5 + 0.5) * h;
    const size = 40;
    const left = Math.min(w - size - 6, x + 8), top = Math.max(6, y - size - 6);
    this.closeBtn.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  }
}
