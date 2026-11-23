// Stations: the places a visitor can go to in a scene, shown as the same glowing dots as the cabin's hotspots
// (style.css .hotspot). Tap / click / Enter on a dot and the scene glides there. The cabin has its own (ui.ts, the
// views of camera.ts); the library (library/deck.ts) and the outside view (outside.ts) use this.
//
// A station has a dot in the world (`spot`, read every frame, so it can follow something that moves). The dot of
// the station the visitor is at is hidden; the others show where they are on screen, and fade off screen.
import * as THREE from 'three';

export interface Station {
  id: string;
  /** "Name — what it is": phones show only the name (as the cabin's hotspots). */
  label: string;
  /** Where its dot sits (world). Null: no dot just now. */
  spot(): THREE.Vector3 | null;
  /** Which way its side of the thing faces (unit): the dot hides while the camera is well round behind that side. */
  facing?: THREE.Vector3;
}

const _v = new THREE.Vector3(), _eye = new THREE.Vector3();

export class Waypoints {
  readonly el = document.createElement('div');
  private dots: { s: Station; b: HTMLButtonElement }[] = [];
  private current: string | null = null;
  private shown = true;
  private tipTimer = 0;

  /**
   * `pass`: the gesture layer that should still see pinches and drags that start on a dot
   * (input.ts `passThrough`, matched against data-pass-gestures). Leave it out where nothing takes them over.
   */
  constructor(parent: HTMLElement, private go: (id: string) => void, private pass?: string) {
    this.el.className = 'waypoints';
    parent.appendChild(this.el);
  }

  set(stations: Station[]) {
    for (const d of this.dots) d.b.remove();
    this.dots = stations.map(s => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hotspot pulse';
      if (this.pass !== undefined) b.dataset.passGestures = this.pass;
      b.setAttribute('aria-label', s.label);
      const [name, more] = s.label.split(' — ');
      const tip = document.createElement('span');
      tip.className = 'tip';
      tip.setAttribute('aria-hidden', 'true');
      tip.textContent = name;
      if (more) { const m = document.createElement('span'); m.className = 'tip-more'; m.textContent = ` — ${more}`; tip.appendChild(m); }
      b.appendChild(tip);
      b.addEventListener('click', () => this.go(s.id));
      this.el.appendChild(b);
      return { s, b };
    });
    this.sync();
  }

  /** The station the visitor is at (its dot hides), or null when they wandered off on their own. */
  setCurrent(id: string | null) { if (id !== this.current) { this.current = id; this.sync(); } }
  get at() { return this.current; }

  /** Show or hide all the dots (a book open, a move in progress, not in this scene). */
  setVisible(on: boolean) { if (on !== this.shown) { this.shown = on; this.sync(); if (on) this.flashTips(); } }

  /** Touch screens have no hover: show every label for a moment (as the cabin's hotspots do on arrival). */
  flashTips(ms = 3200) {
    if (!matchMedia('(hover: none)').matches) return;
    for (const d of this.dots) d.b.classList.add('show-tip');
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => { for (const d of this.dots) d.b.classList.remove('show-tip'); }, ms);
  }

  private sync() { for (const d of this.dots) d.b.hidden = !this.shown || d.s.id === this.current; }

  /** Put the dots where their spots are on screen. */
  update(camera: THREE.Camera) {
    if (!this.shown) return;
    const w = innerWidth, h = innerHeight;
    camera.getWorldPosition(_eye);
    for (const d of this.dots) {
      if (d.b.hidden) continue;
      const p = d.s.spot();
      if (!p || (d.s.facing && _v.subVectors(p, _eye).normalize().dot(d.s.facing) > 0.3)) { d.b.style.visibility = 'hidden'; continue; }
      _v.copy(p).project(camera);
      const vis = _v.z < 1 && Math.abs(_v.x) < 0.96 && Math.abs(_v.y) < 0.96;
      d.b.style.visibility = vis ? '' : 'hidden';
      d.b.style.left = `${((_v.x + 1) / 2) * w}px`;
      d.b.style.top = `${((1 - _v.y) / 2) * h}px`;
    }
  }
}
