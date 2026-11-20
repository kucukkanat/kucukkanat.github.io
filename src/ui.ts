import * as THREE from 'three';
import type { Content, Item } from './types';
import type { ViewName } from './scene';
import { escapeHtml } from './content';

export interface UIHandlers {
  nav(view: ViewName): void;
  back(): void;
  hotspot(id: string): void;
  item(id: string): void;
  insert(id: string): void;
  panelClosed(): void;
  toggleNight(): void;
  /** Leave the cabin for the outside view of the ship. */
  outside(): void;
  /** Open the Ship's Index (all writing). */
  writing(): void;
  /** Open the search palette. */
  search(): void;
  toggleSound(): void;
  /** Re-open the welcome letter. */
  letter(): void;
  /** A polish-round prop (letter, portrait, bottle, tengwar, slate, bell) activated from its keyboard button. */
  egg(id: string): void;
  /** Keyboard focus on/off an egg button (the Tengwar note shows its Latin while focused). */
  eggFocus?(id: string, on: boolean): void;
}

export interface Spot { id: string; label: string; world: THREE.Vector3; }

const NAV: { view: ViewName; label: string }[] = [
  { view: 'chest', label: 'Chest' },
  { view: 'table', label: 'Table' },
  { view: 'rack', label: 'Rack' },
  { view: 'shelf', label: 'Shelf' },
  { view: 'handheld', label: 'Handheld' },
];

const ICON = {
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  lantern: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6M12 2v2M8 7h8l1 3v8l-1 2H8l-1-2v-8z"/><path d="M12 11c1.2 1.3 1.2 3.2 0 4.2-1.2-1-1.2-2.9 0-4.2z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
};

export class UI {
  root: HTMLElement;
  private dockBtns = new Map<ViewName, HTMLButtonElement>();
  private backBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private nightBtn: HTMLButtonElement;
  private spots: { spot: Spot; el: HTMLButtonElement }[] = [];
  private items: { spot: Spot; el: HTMLButtonElement }[] = [];
  private eggs: { spot: Spot; el: HTMLButtonElement; world: () => THREE.Vector3 | null }[] = [];
  private spotLayer: HTMLElement;
  private panel: HTMLElement;
  private panelItem: Item | null = null;
  private panelAnchor: THREE.Vector3 | null = null;
  /** Docked panel: pinned to the right edge (an inspected item sits in the space to its left). */
  private panelDock = false;
  private returnFocus: HTMLElement | null = null;
  private live: HTMLElement;
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement, content: Content, private h: UIHandlers) {
    const root = this.root = document.createElement('div');
    root.className = 'ui';
    root.innerHTML = `
      <header class="brand">
        <h1>${escapeHtml(content.person.name)}</h1>
        <p>Curious, engineer, maker, mathematician · <button type="button" class="linkish letter-link">Letter</button> · <a href="/plain/" style="pointer-events:auto">Plain version</a></p>
      </header>
      <button class="btn back" type="button" hidden>${ICON.back}<span>Back</span></button>
      <div class="spots"></div>
      <div class="dock" role="toolbar" aria-label="Cabin">
        <nav aria-label="Viewpoints"></nav>
        <span class="sep" aria-hidden="true"></span>
        <button class="nav writing-btn" type="button" aria-label="Writing: open the Ship's Index">Writing</button>
        <button class="nav outside-btn" type="button" aria-label="Go outside and see the ship">Outside</button>
        <span class="sep" aria-hidden="true"></span>
        <button class="icon-btn search" type="button" aria-label="Search (press / or Ctrl+K)" aria-keyshortcuts="/ Control+K Meta+K"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></button>
        <button class="icon-btn night" type="button" aria-pressed="false" aria-label="Lantern: switch to night">${ICON.lantern}</button>
        <button class="icon-btn sound" type="button" aria-pressed="false" aria-label="Sound off">${ICON.soundOff}</button>
      </div>
      <section class="panel" role="dialog" aria-modal="false" aria-labelledby="panel-title" hidden></section>
      <div class="sr-only" aria-live="polite"></div>`;
    parent.appendChild(root);
    const nav = root.querySelector('nav')!;
    for (const n of NAV) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'nav'; b.textContent = n.label;
      b.addEventListener('click', () => h.nav(n.view));
      nav.appendChild(b);
      this.dockBtns.set(n.view, b);
    }
    root.querySelector('.letter-link')!.addEventListener('click', () => h.letter());
    this.backBtn = root.querySelector('.back')!;
    this.backBtn.addEventListener('click', () => h.back());
    this.soundBtn = root.querySelector('.sound')!;
    this.soundBtn.addEventListener('click', () => h.toggleSound());
    this.nightBtn = root.querySelector('.night')!;
    this.nightBtn.addEventListener('click', () => h.toggleNight());
    root.querySelector('.outside-btn')!.addEventListener('click', () => h.outside());
    root.querySelector('.writing-btn')!.addEventListener('click', () => h.writing());
    root.querySelector('.search')!.addEventListener('click', () => h.search());
    this.spotLayer = root.querySelector('.spots')!;
    this.panel = root.querySelector('.panel')!;
    this.live = root.querySelector('[aria-live]')!;
    this.panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.closePanel(); }
    });
  }

  announce(text: string) { this.live.textContent = text; }

  /** Hide the pulsing hotspots while something is held up close (they would float over it). */
  setQuiet(on: boolean) { this.spotLayer.classList.toggle('quiet', on); }

  setView(view: ViewName) {
    for (const [v, b] of this.dockBtns) b.setAttribute('aria-current', String(v === view || (view === 'screen' && v === 'handheld')));
    this.backBtn.hidden = view === 'overview';
    for (const s of this.spots) s.el.hidden = view !== 'overview';
  }

  /** Sound button cycles off → ambient → full. */
  setSound(mode: 'off' | 'ambient' | 'full' | boolean) {
    const m = mode === true ? 'full' : mode === false ? 'off' : mode;
    const on = m !== 'off';
    this.soundBtn.setAttribute('aria-pressed', String(on));
    const label = m === 'off' ? 'Sound off — click for ambient sound' : m === 'ambient' ? 'Sound: ambient — click for full sound' : 'Sound: full — click to mute';
    this.soundBtn.setAttribute('aria-label', label);
    this.soundBtn.title = label;
    this.soundBtn.dataset.mode = m;
    this.soundBtn.innerHTML = on ? ICON.soundOn : ICON.soundOff;
  }
  setNight(on: boolean) {
    this.nightBtn.setAttribute('aria-pressed', String(on));
    this.nightBtn.setAttribute('aria-label', on ? 'Lantern: back to sunset' : 'Lantern: switch to night');
  }

  setHotspots(spots: Spot[], pulse: boolean) {
    for (const s of this.spots) s.el.remove();
    this.spots = spots.map(spot => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hotspot' + (pulse ? ' pulse' : '');
      el.setAttribute('aria-label', spot.label);
      el.innerHTML = `<span class="tip" aria-hidden="true">${escapeHtml(spot.label)}</span>`;
      el.addEventListener('click', () => this.h.hotspot(spot.id));
      this.spotLayer.appendChild(el);
      return { spot, el };
    });
  }

  /** Focusable buttons over the collectibles of the current view (keyboard + screen readers). */
  setItemButtons(spots: Spot[]) {
    for (const s of this.items) s.el.remove();
    this.items = spots.map(spot => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'item-btn';
      el.setAttribute('aria-label', spot.label);
      el.addEventListener('click', () => { this.returnFocus = el; this.h.item(spot.id); });
      this.spotLayer.appendChild(el);
      return { spot, el };
    });
  }
  /**
   * Visually hidden, focusable buttons over the easter-egg props (no pulsing hotspots: they are found by looking,
   * or by tabbing). Pointer clicks go to the 3D prop underneath.
   */
  setEggButtons(eggs: { id: string; label: string; world: () => THREE.Vector3 | null }[]) {
    for (const s of this.eggs) s.el.remove();
    this.eggs = eggs.map(egg => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'item-btn egg-btn';
      el.setAttribute('aria-label', egg.label);
      el.addEventListener('click', () => this.h.egg(egg.id));
      el.addEventListener('focus', () => this.h.eggFocus?.(egg.id, true));
      el.addEventListener('blur', () => this.h.eggFocus?.(egg.id, false));
      this.spotLayer.appendChild(el);
      return { spot: { id: egg.id, label: egg.label, world: new THREE.Vector3() }, el, world: egg.world };
    });
  }

  /** Busy spinner on the lantern while the night assets stream in. */
  setNightLoading(on: boolean) { this.nightBtn.classList.toggle('loading', on); this.nightBtn.setAttribute('aria-busy', String(on)); }

  focusFirstItem() { this.items[0]?.el.focus({ preventScroll: true }); }

  /** Re-project hotspots / item buttons / panel each frame. */
  update(camera: THREE.Camera, w: number, h: number, spotWorld: (id: string) => THREE.Vector3 | null) {
    const place = (el: HTMLElement, world: THREE.Vector3, hideOff = true) => {
      this.v.copy(world).project(camera);
      const vis = this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05;
      if (hideOff) el.style.visibility = vis ? '' : 'hidden';
      el.style.left = `${((this.v.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - this.v.y) / 2) * h}px`;
    };
    for (const s of this.spots) if (!s.el.hidden) place(s.el, s.spot.world);
    for (const s of this.items) place(s.el, spotWorld(s.spot.id) ?? s.spot.world);
    for (const s of this.eggs) { const w = s.world(); if (w) place(s.el, w); else s.el.style.visibility = 'hidden'; }
    if (this.panelItem && this.panelAnchor && w > 720) this.placePanel(camera, w, h);
  }

  private placePanel(camera: THREE.Camera, w: number, h: number) {
    const pw = this.panel.offsetWidth, ph = this.panel.offsetHeight;
    if (this.panelDock) {
      this.panel.style.left = `${Math.max(16, w - pw - Math.min(48, w * 0.04))}px`;
      this.panel.style.top = `${Math.max(70, Math.min(h - ph - 80, h * 0.48 - ph / 2))}px`;
      return;
    }
    this.v.copy(this.panelAnchor!).project(camera);
    const x = ((this.v.x + 1) / 2) * w, y = ((1 - this.v.y) / 2) * h;
    const gap = Math.min(110, w * 0.08);
    // beside the object, but clear of the middle of the view where the rest of the row is
    let left = Math.max(x + gap, w * 0.6);
    if (left + pw > w - 24) left = Math.min(x - gap - pw, w * 0.4 - pw);
    left = Math.max(16, Math.min(w - pw - 16, left));
    const top = Math.max(70, Math.min(h - ph - 80, y - ph / 2));
    this.panel.style.left = `${left}px`;
    this.panel.style.top = `${top}px`;
  }

  get panelOpen() { return !!this.panelItem; }
  /** The info panel element (for keeping an inspected item clear of it). */
  get panelElement() { return this.panel; }
  get openItem() { return this.panelItem; }

  openPanel(item: Item, anchor: THREE.Vector3, dock = false) {
    const p = this.panel;
    this.panelItem = item;
    this.panelAnchor = anchor.clone();
    this.panelDock = dock;
    const e = escapeHtml;
    const kind = item.kind;
    const isJob = kind === 'memory-card' || kind === 'map-island';
    const meta = isJob ? ['Ship’s log', item.period].filter(Boolean)
      : [item.year, kind === 'cartridge' ? item.group?.toUpperCase() : kind === 'book' ? 'Book' : kind === 'notebook' ? 'Notebook' : ''].filter(Boolean);
    const title = isJob ? item.title : item.title;
    const actions: string[] = [];
    if (kind === 'cartridge') {
      actions.push(`<button type="button" class="btn ${item.playable ? 'primary' : ''}" data-act="insert">${item.playable ? 'Insert into the handheld' : 'Insert'}</button>`);
      if (item.url) actions.push(`<a class="btn" href="${e(item.url)}" target="_blank" rel="noopener">Open in new tab ↗</a>`);
      if (item.source) actions.push(`<a class="btn" href="${e(item.source)}" target="_blank" rel="noopener">Source</a>`);
    } else if (kind === 'book' || kind === 'notebook') {
      if (item.url) actions.push(`<a class="btn primary" href="${e(item.url)}" target="_blank" rel="noopener">Read ↗</a>`);
      if (item.source) actions.push(`<a class="btn" href="${e(item.source)}" target="_blank" rel="noopener">Source</a>`);
    } else if (item.url) {
      actions.push(`<a class="btn" href="${e(item.url)}" target="_blank" rel="noopener">Visit ↗</a>`);
    }
    p.innerHTML = `
      <button type="button" class="icon-btn close" aria-label="Close">${ICON.close}</button>
      <div class="accent-bar" style="background:${e(item.colour)}"></div>
      ${meta.length ? `<div class="meta">${meta.map(m => e(String(m))).join(' · ')}</div>` : ''}
      <h2 id="panel-title" tabindex="-1">${e(title)}</h2>
      ${isJob && item.role ? `<p class="sub">${e(item.role)}${item.current ? ' · now' : ''}</p>` : item.subtitle ? `<p class="sub">${e(item.subtitle)}</p>` : ''}
      ${item.tags?.length ? `<ul class="tags">${item.tags.map(t => `<li>${e(t)}</li>`).join('')}</ul>` : ''}
      <div class="body">${item.body}</div>
      ${isJob && item.achievements?.length ? `<ul class="ach">${item.achievements.map(a => `<li>${e(a)}</li>`).join('')}</ul>` : ''}
      ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}`;
    p.querySelector('.close')!.addEventListener('click', () => this.closePanel());
    p.querySelector('[data-act="insert"]')?.addEventListener('click', () => this.h.insert(item.id));
    p.querySelectorAll('.body a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); });
    if (!this.returnFocus && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) this.returnFocus = document.activeElement;
    p.hidden = false;
    requestAnimationFrame(() => {
      p.classList.add('open');
      (p.querySelector('h2') as HTMLElement).focus({ preventScroll: true });
    });
  }

  closePanel(silent = false) {
    if (!this.panelItem) return;
    this.panelItem = null;
    this.panel.classList.remove('open');
    const p = this.panel;
    setTimeout(() => { if (!this.panelItem) p.hidden = true; }, 260);
    const rf = this.returnFocus;
    this.returnFocus = null;
    if (rf && rf.isConnected) rf.focus({ preventScroll: true });
    if (!silent) this.h.panelClosed();
  }

  setVisible(on: boolean) { this.root.style.display = on ? '' : 'none'; }
}
