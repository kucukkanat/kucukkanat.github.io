import * as THREE from 'three';
import type { Content, Item } from './types';
import type { ViewName } from './scene';
import { escapeHtml } from './content';
import { ShipMap } from './shipmap';

export interface UIHandlers {
  back(): void;
  hotspot(id: string): void;
  item(id: string): void;
  insert(id: string): void;
  panelClosed(): void;
  toggleNight(): void;
  /** Go to a place, and a station there (a cabin view, or a station of another place): the ship's map. */
  go(p: Place, station?: string): void;
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

/** Where the visitor is: the dock and the Back button are the same in all three. */
export type Place = 'cabin' | 'library' | 'chartroom' | 'outside';
const PLACE_NAME: Record<Place, string> = { cabin: 'Cabin', library: 'Library', chartroom: 'Chart room', outside: 'Outside' };

const ICON = {
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  lantern: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6M12 2v2M8 7h8l1 3v8l-1 2H8l-1-2v-8z"/><path d="M12 11c1.2 1.3 1.2 3.2 0 4.2-1.2-1-1.2-2.9 0-4.2z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><path d="M14.5 9.5l-1.6 4.2-4.4 1.8 1.6-4.2z"/></svg>',
  caret: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
};

export class UI {
  root: HTMLElement;
  private backBtn: HTMLButtonElement;
  /** The pill (Back · the place / map · search): kept on screen in every place (the rest of root is the cabin's). */
  readonly chrome: HTMLElement;
  private placeBtn: HTMLButtonElement;
  readonly map: ShipMap;
  private place: Place = 'cabin';
  private view: ViewName = 'overview';
  private station: string | null = null;
  private visible = true;
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
        <p>Curious, engineer, maker, mathematician</p>
      </header>
      <div class="spots"></div>
      <section class="panel" role="dialog" aria-modal="false" aria-labelledby="panel-title" hidden></section>
      <div class="sr-only" aria-live="polite"></div>`;
    parent.appendChild(root);
    // the pill: Back (what it will do) · where you are, which opens the ship's map · search
    const chrome = this.chrome = document.createElement('div');
    chrome.className = 'ui ui-chrome';
    chrome.dataset.place = 'cabin';
    chrome.innerHTML = `
      <div class="dock pill" role="toolbar" aria-label="Getting around">
        <button class="pill-btn back" type="button" hidden>${ICON.back}<span>Back</span></button>
        <button class="pill-btn place-btn" type="button" aria-haspopup="dialog" aria-keyshortcuts="M">${ICON.map}<span class="place-name">Cabin</span>${ICON.caret}</button>
        <button class="icon-btn search" type="button" aria-label="Search (press / or Ctrl+K)" aria-keyshortcuts="/ Control+K Meta+K"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></button>
      </div>`;
    parent.appendChild(chrome);
    this.map = new ShipMap(parent, {
      go: (p, st) => h.go(p, st),
      writing: () => h.writing(),
      letter: () => h.letter(),
      toggleNight: () => h.toggleNight(),
      toggleSound: () => h.toggleSound(),
    });
    this.placeBtn = chrome.querySelector('.place-btn')!;
    this.placeBtn.addEventListener('click', () => { this.placeBtn.classList.remove('beckon'); this.map.toggle(); });
    this.syncPlaceLabel();
    // the pill's height, for what sits above it in the library and outside (--dock-h)
    const dock = chrome.querySelector<HTMLElement>('.dock')!;
    const measure = () => document.documentElement.style.setProperty('--dock-h', `${Math.max(0, Math.round(innerHeight - dock.getBoundingClientRect().top))}px`);
    new ResizeObserver(measure).observe(dock);
    addEventListener('resize', measure);
    measure();
    this.backBtn = chrome.querySelector('.back')!;
    this.backBtn.addEventListener('click', () => h.back());
    chrome.querySelector('.search')!.addEventListener('click', () => h.search());
    this.spotLayer = root.querySelector('.spots')!;
    this.panel = root.querySelector('.panel')!;
    this.live = root.querySelector('[aria-live]')!;
    this.panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.closePanel(); }
    });
    this.watchLongPress();
  }

  /** The map button pulses a few times (once, after the welcome letter that points to it). */
  beckonMap() {
    this.placeBtn.classList.remove('beckon');
    void this.placeBtn.offsetWidth;
    this.placeBtn.classList.add('beckon');
    setTimeout(() => this.placeBtn.classList.remove('beckon'), 4800);
  }

  /** While the ship moves between places: the map can't start another move (it would be lost). */
  setBusy(on: boolean) {
    this.map.setDisabled(on);
    this.placeBtn.classList.toggle('busy', on);
    this.placeBtn.setAttribute('aria-busy', String(on));
  }

  private syncPlaceLabel() {
    this.placeBtn.querySelector('.place-name')!.textContent = PLACE_NAME[this.place];
    this.placeBtn.setAttribute('aria-label', `${PLACE_NAME[this.place]}: open the ship’s map (M)`);
    this.map.setHere(this.place, this.place === 'cabin' ? (this.view === 'screen' ? 'handheld' : this.view) : this.station);
  }

  announce(text: string) { this.live.textContent = text; }

  /** Hide the pulsing hotspots while something is held up close (they would float over it). */
  setQuiet(on: boolean) { this.spotLayer.classList.toggle('quiet', on); }

  setView(view: ViewName) {
    this.view = view;
    if (this.place === 'cabin') { this.setBack(view === 'overview' ? null : 'Back'); this.syncPlaceLabel(); }
    for (const s of this.spots) s.el.hidden = view !== 'overview';
    if (view === 'overview') this.flashTips();
  }

  /** Touch screens have no hover: show every hotspot's label for a few seconds (on arrival, and on a long press). */
  private tipTimer = 0;
  flashTips(ms = 3200) {
    if (!matchMedia('(hover: none)').matches || !this.spots.length) return;
    for (const s of this.spots) s.el.classList.add('show-tip');
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => { for (const s of this.spots) s.el.classList.remove('show-tip'); }, ms);
  }
  private watchLongPress() {
    let timer = 0, x = 0, y = 0;
    const cancel = () => clearTimeout(timer);
    window.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || !e.isPrimary || !(e.target instanceof HTMLCanvasElement)) return;
      x = e.clientX; y = e.clientY;
      cancel();
      timer = window.setTimeout(() => this.flashTips(), 480);
    }, { passive: true });
    window.addEventListener('pointermove', e => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel(); }, { passive: true });
    for (const ev of ['pointerup', 'pointercancel']) window.addEventListener(ev, cancel, { passive: true });
  }

  /** Sound cycles off → ambient → full (its button is in the ship's map). */
  setSound(mode: 'off' | 'ambient' | 'full' | boolean) {
    this.map.setSound(mode === true ? 'full' : mode === false ? 'off' : mode);
  }
  setNight(on: boolean) { this.map.setNight(on); }

  setHotspots(spots: Spot[], pulse: boolean) {
    for (const s of this.spots) s.el.remove();
    this.spots = spots.map(spot => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hotspot' + (pulse ? ' pulse' : '');
      el.dataset.passGestures = '';
      el.setAttribute('aria-label', spot.label);
      // "Map chest — projects you can play": phones show only the name part
      const [name, more] = spot.label.split(' — ');
      el.innerHTML = `<span class="tip" aria-hidden="true">${escapeHtml(name)}${more ? `<span class="tip-more"> — ${escapeHtml(more)}</span>` : ''}</span>`;
      el.addEventListener('click', () => this.h.hotspot(spot.id));
      this.spotLayer.appendChild(el);
      return { spot, el };
    });
    this.flashTips(4200);
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
  setNightLoading(on: boolean) { this.map.setNightLoading(on); }

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

  /** Everything, dock included (the handheld's screen, the reader). */
  setVisible(on: boolean) { this.visible = on; if (!on) this.map.close(true); this.sync(); }
  private sync() {
    this.root.style.display = this.visible && this.place === 'cabin' ? '' : 'none';
    this.chrome.style.display = this.visible ? '' : 'none';
  }

  /**
   * Which place is on screen. The cabin's own UI (brand, hotspots, panel) shows only in the cabin; the pill stays, and
   * names the place.
   */
  setPlace(place: Place) {
    if (place === this.place) return;
    this.place = place;
    this.station = null;
    this.chrome.dataset.place = place;
    if (place === 'cabin') this.setView(this.view);
    else this.setBack(null);
    this.syncPlaceLabel();
    this.sync();
  }

  /** The current station in the library / chart room / outside (null: none, the visitor wandered off). */
  setStation(id: string | null) { if (id !== this.station) { this.station = id; this.syncPlaceLabel(); } }

  /** The Back button: what it will do ("Close the book", "Back inside"…), or null to hide it. */
  setBack(label: string | null) {
    this.backBtn.hidden = label === null;
    const span = this.backBtn.querySelector('span')!;
    if (label !== null && span.textContent !== label) span.textContent = label;
  }
}
