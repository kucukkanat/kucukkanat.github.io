import * as THREE from 'three';
import type { Cabin } from './scene';
import { anchorFrame, ensureUV } from './scene';
import type { Collectible, Collectibles } from './collectibles';
import type { CameraRig } from './camera';
import { tween, ease, wait, reducedMotion } from './anim';
import { audio } from './audio';
import { paintSky, DISPLAY, SANS } from './labels';
import { escapeHtml } from './content';
import { uNight } from './lighting';

const WING = 'M8 40c10-2 22-10 30-22 3-5 8-9 14-10-2 6-5 11-9 15 4 0 8-1 11-3-3 6-9 10-16 12 3 1 6 1 9 0-6 5-14 7-22 7-7 0-13 1-17 1z';
type ScreenMode = 'idle' | 'boot' | 'nosignal' | 'playing' | 'off';

export class Play {
  inserted: Collectible | null = null;
  overlayOn = false;
  busy = false;
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private tex: THREE.CanvasTexture;
  private mode: ScreenMode = 'idle';
  private bootT = 0;
  private bootStart = -1;
  private lastDraw = -1;
  private screenMesh: THREE.Mesh | null = null;
  private overlay: HTMLElement;
  private iframe: HTMLIFrameElement | null = null;
  private noSignal: HTMLElement;
  private slot: THREE.Object3D;

  constructor(private scene: THREE.Scene, private cabin: Cabin, private rig: CameraRig, private coll: Collectibles,
    private hooks: { onEnter(): void; onExit(): void }) {
    this.canvas.width = 1024; this.canvas.height = 640;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = false;
    this.attachScreen();
    this.slot = anchorFrame(cabin.get('Handheld_slot'), cabin.views.handheld.target.clone().add(new THREE.Vector3(0, 0.08, -0.02)));

    this.overlay = document.createElement('div');
    this.overlay.className = 'play';
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    this.overlay.setAttribute('aria-label', 'Playing');
    document.body.appendChild(this.overlay);
    this.overlay.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); this.eject(); } });

    this.noSignal = document.createElement('div');
    this.noSignal.className = 'nosignal';
    this.noSignal.hidden = true;
    document.body.appendChild(this.noSignal);
    this.draw(0);
  }

  private attachScreen() {
    let target: THREE.Mesh | null = null;
    this.cabin.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || target) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some(x => x.name === 'Screen')) target = m;
    });
    if (!target) {
      const s = this.cabin.get('Handheld_screen');
      s?.traverse(o => { if (!target && (o as THREE.Mesh).isMesh) target = o as THREE.Mesh; });
    }
    if (!target) { console.warn('[play] no handheld screen'); return; }
    const mesh = target as THREE.Mesh;
    ensureUV(mesh);
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map(m => (m.name === 'Screen' ? mat : m));
    else mesh.material = mat;
    this.screenMesh = mesh;
  }

  /** Called every frame; redraws the screen canvas at ~20 fps when animated. */
  update(t: number) {
    if (this.mode === 'boot') { if (this.bootStart < 0) this.bootStart = t; this.bootT = t - this.bootStart; }
    const animated = this.mode !== 'off';
    if (!animated || t - this.lastDraw < 0.05) return;
    this.lastDraw = t;
    this.draw(t);
  }

  private draw(t: number) {
    const { ctx } = this;
    const W = 512, H = 320;
    ctx.save();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    if (this.mode === 'idle') {
      paintSky(ctx, 0, 0, W, H, 'kanat-idle', uNight.value > 0.5);
      ctx.fillStyle = 'rgba(30,14,10,0.35)'; ctx.fillRect(0, H - 64, W, 64);
      ctx.fillStyle = '#fff6e8'; ctx.font = `700 28px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (Math.floor(t * 1.4) % 2 === 0 || reducedMotion) ctx.fillText('Insert a cartridge', W / 2, H - 32);
      this.logo(28, 22, 0.55, '#fff6e8');
      ctx.font = `700 16px ${SANS}`; ctx.textAlign = 'left'; ctx.fillStyle = '#fff6e8';
      ctx.fillText('KANAT·1', 66, 40);
    } else if (this.mode === 'boot') {
      const k = Math.min(1, this.bootT / 1.6);
      ctx.fillStyle = '#16100d'; ctx.fillRect(0, 0, W, H);
      const a = Math.min(1, k * 2.2);
      ctx.globalAlpha = a;
      const s = 1.6 + (1 - ease.outBack(Math.min(1, k * 1.6))) * 0.8;
      this.logo(W / 2 - 32 * s, H / 2 - 70 - 32 * s + 30, s, '#f07a2a');
      ctx.fillStyle = '#fbeedd'; ctx.font = `700 40px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('KANAT·1', W / 2, H / 2 + 50);
      if (k > 0.5 && this.inserted) {
        ctx.globalAlpha = Math.min(1, (k - 0.5) * 3);
        ctx.font = `500 18px ${SANS}`; ctx.fillStyle = 'rgba(251,238,221,0.75)';
        ctx.fillText(`Loading ${this.inserted.item.title}…`, W / 2, H / 2 + 92);
      }
      if (k > 0.85) { ctx.globalAlpha = (k - 0.85) / 0.15; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
    } else if (this.mode === 'nosignal') {
      const img = ctx.createImageData(128, 80);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 160; img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 10; img.data[i + 3] = 255; }
      const tmp = document.createElement('canvas'); tmp.width = 128; tmp.height = 80;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, W, H);
      ctx.fillStyle = 'rgba(20,10,8,0.7)'; ctx.fillRect(40, 92, W - 80, 136);
      ctx.fillStyle = '#fbeedd'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `700 40px ${DISPLAY}`; ctx.fillText('No signal', W / 2, 140);
      ctx.font = `500 20px ${SANS}`; ctx.fillStyle = 'rgba(251,238,221,0.8)';
      ctx.fillText('This one doesn’t run here — view the source', W / 2, 190);
    } else if (this.mode === 'playing') {
      paintSky(ctx, 0, 0, W, H, this.inserted?.item.id ?? 'x');
      ctx.fillStyle = 'rgba(20,10,8,0.45)'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.font = `700 34px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.inserted?.item.title ?? '', W / 2, H / 2);
    }
    ctx.restore();
    this.tex.needsUpdate = true;
  }

  private logo(x: number, y: number, s: number, color: string) {
    const { ctx } = this;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = color; ctx.fill(new Path2D(WING));
    ctx.restore();
  }

  private slotPose(depth: number) {
    const q = this.slot.quaternion.clone();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    return { pos: this.slot.position.clone().addScaledVector(up, depth), q };
  }

  /** Insert a cartridge: fly → chunk → glide into the screen → boot → iframe. */
  async insert(c: Collectible) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (this.inserted && this.inserted !== c) await this.returnCartridge(this.inserted);
      this.coll.setPulled(null);
      this.coll.setHover(null);
      if (this.inserted !== c) {
        this.inserted = c;
        c.detached = true;
        this.scene.attach(c.obj);
        const p0 = c.obj.position.clone(), q0 = c.obj.quaternion.clone();
        const s0 = c.obj.scale.x; // an inspected cartridge arrives scaled up
        const above = this.slotPose(0.06), inn = this.slotPose(-0.042);
        audio.whoosh();
        const camGlide = this.rig.view === 'handheld' ? Promise.resolve() : this.rig.glide('handheld', 1.2);
        await tween(reducedMotion ? 0 : 1.1, k => {
          c.obj.scale.setScalar(s0 + (1 - s0) * Math.min(1, k * 1.6));
          c.obj.position.lerpVectors(p0, above.pos, k);
          c.obj.position.y += Math.sin(k * Math.PI) * 0.35;
          c.obj.quaternion.slerpQuaternions(q0, above.q, ease.outCubic(k));
        });
        await tween(reducedMotion ? 0 : 0.18, k => c.obj.position.lerpVectors(above.pos, inn.pos, k), { ease: ease.inCubic });
        audio.chunk();
        // tiny recoil
        if (!reducedMotion) await tween(0.12, k => c.obj.position.copy(inn.pos).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(inn.q), Math.sin(k * Math.PI) * 0.006));
        await camGlide;
      }
      await this.power();
    } finally {
      this.busy = false;
    }
  }

  /** Glide into the screen and show the game (or "no signal"). */
  private async power() {
    const c = this.inserted!;
    if (!c.item.playable || !c.item.url) {
      this.mode = 'nosignal';
      if (this.rig.view !== 'handheld') await this.rig.glide('handheld');
      this.showNoSignal(c);
      return;
    }
    await this.rig.glide('screen', 1.0);
    this.mode = 'boot'; this.bootT = 0; this.bootStart = -1;
    audio.chime();
    await wait(reducedMotion ? 0.3 : 1.7);
    this.mode = 'playing';
    this.openOverlay(c);
  }

  private showNoSignal(c: Collectible) {
    const n = this.noSignal;
    const e = escapeHtml;
    n.innerHTML = `${c.item.source ? `<a class="btn primary" href="${e(c.item.source)}" target="_blank" rel="noopener">View the source ↗</a>` : ''}
      ${c.item.url ? `<a class="btn" href="${e(c.item.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}
      <button class="btn" type="button" data-eject>Eject</button>`;
    n.style.display = 'flex'; n.style.gap = '8px';
    n.querySelector('[data-eject]')!.addEventListener('click', () => this.eject());
    n.hidden = false;
    this.placeNoSignal();
    (n.querySelector('a,button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  hideNoSignal() { this.noSignal.hidden = true; if (this.mode === 'nosignal') this.mode = 'idle'; }

  placeNoSignal() {
    if (this.noSignal.hidden) return;
    const box = this.screenMesh ? new THREE.Box3().setFromObject(this.screenMesh) : null;
    const p = box ? new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, box.max.z) : this.slot.position.clone().setY(this.slot.position.y - 0.1);
    p.project(this.rig.camera);
    const w = innerWidth, h = innerHeight;
    this.noSignal.style.left = `${((p.x + 1) / 2) * w}px`;
    this.noSignal.style.top = `${Math.min(h - 130, ((1 - p.y) / 2) * h + 40)}px`;
  }

  private openOverlay(c: Collectible) {
    const it = c.item;
    const e = escapeHtml;
    const o = this.overlay;
    o.innerHTML = `
      <div class="bezel">
        <span class="logo" aria-hidden="true">KANAT·1</span>
        <span class="title">${e(it.title)}</span>
        <button class="btn eject" type="button" data-eject aria-label="Eject">⏏ <span class="label-hide">Eject</span></button>
        <a class="btn" href="${e(it.url!)}" target="_blank" rel="noopener" aria-label="Open in new tab">↗ <span class="label-hide">Open in new tab</span></a>
        ${document.fullscreenEnabled ? '<button class="btn" type="button" data-fs aria-label="Fullscreen">⛶ <span class="label-hide">Fullscreen</span></button>' : ''}
      </div>`;
    const wait = document.createElement('div');
    wait.className = 'play-wait';
    const src = it.embed ?? it.url!;
    const remote = new URL(src, location.href).origin !== location.origin;
    // cartridges hosted elsewhere can't come from our offline cache
    wait.textContent = remote && !navigator.onLine ? `No signal — ${it.title} needs an internet connection.` : `Loading ${it.title}…`;
    o.appendChild(wait);
    const f = document.createElement('iframe');
    f.title = it.title;
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-forms');
    f.setAttribute('allow', 'fullscreen; gamepad; autoplay; xr-spatial-tracking');
    f.setAttribute('allowfullscreen', '');
    f.src = src;
    o.appendChild(f);
    this.iframe = f;
    o.querySelector('[data-eject]')!.addEventListener('click', () => this.eject());
    // (iPhone Safari has no element fullscreen: the button is left out there)
    o.querySelector('[data-fs]')?.addEventListener('click', () => {
      if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
      void o.requestFullscreen?.().then(() => {
        // a cartridge that wants a particular orientation gets it while fullscreen (Android; others ignore it)
        const lock = (screen.orientation as { lock?: (o: string) => Promise<void> } | undefined)?.lock;
        if (it.orientation && lock) lock.call(screen.orientation, it.orientation).catch(() => {});
      }).catch(() => {});
    });
    o.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => o.classList.add('on')));
    this.overlayOn = true;
    this.hooks.onEnter();
    setTimeout(() => (o.querySelector('[data-eject]') as HTMLElement).focus({ preventScroll: true }), 50);
    f.addEventListener('load', () => { try { f.focus(); } catch { /* cross-origin */ } }, { once: true });
  }

  async eject() {
    if (this.busy || !this.inserted) return;
    this.busy = true;
    try {
      const c = this.inserted;
      if (this.overlayOn) {
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
        this.overlay.classList.remove('on');
        this.overlayOn = false;
        this.hooks.onExit();
        await wait(reducedMotion ? 0 : 0.4);
        this.overlay.hidden = true;
        this.iframe?.remove(); this.iframe = null;
        this.overlay.innerHTML = '';
      }
      this.noSignal.hidden = true;
      this.mode = 'idle';
      if (this.rig.view !== 'handheld') await this.rig.glide('handheld', 0.9);
      await this.returnCartridge(c);
    } finally {
      this.busy = false;
    }
  }

  private async returnCartridge(c: Collectible) {
    const out = this.slotPose(0.09);
    const p0 = c.obj.position.clone();
    audio.chunk();
    await tween(reducedMotion ? 0 : 0.25, k => c.obj.position.lerpVectors(p0, out.pos, k), { ease: ease.outBack });
    // fly home: compute home world pose
    const homeWorld = c.home.clone().applyMatrix4(c.holder.matrixWorld);
    const homeQ = c.holder.getWorldQuaternion(new THREE.Quaternion());
    const p1 = c.obj.position.clone(), q1 = c.obj.quaternion.clone();
    await tween(reducedMotion ? 0 : 0.9, k => {
      c.obj.position.lerpVectors(p1, homeWorld, k);
      c.obj.position.y += Math.sin(k * Math.PI) * 0.3;
      c.obj.quaternion.slerpQuaternions(q1, homeQ, k);
    });
    c.holder.attach(c.obj);
    c.detached = false;
    c.pull = 0; c.pullT = 0;
    if (this.inserted === c) this.inserted = null;
  }
}
