// The ship's map: one button in the pill (ui.ts) opens a cutaway of the airship. Every room is on it, with that
// room's stations listed under it, so any place is two taps away. The things that used to crowd the dock live here
// too: the Ship's Index, the welcome letter, the plain version, the lantern and the sound.
//
// A centred dialog on larger screens, a bottom sheet on phones (style.css .shipmap).
import type { Place } from './ui';

export interface MapStation { id: string; label: string }
export interface MapRoom { p: Place; label: string; blurb: string; stations: MapStation[] }

/**
 * Every room and its stations. They are listed here rather than read from the rooms, which load lazily: the map has to
 * show a room before the visitor has ever been there. The ids are the ones the address uses (?view= in the cabin,
 * ?station= elsewhere).
 */
export const ROOMS: MapRoom[] = [
  { p: 'outside', label: 'Outside', blurb: 'The ship under sail', stations: [
    { id: 'bow', label: 'Bow' }, { id: 'port', label: 'Port' }, { id: 'starboard', label: 'Starboard' }, { id: 'above', label: 'Above' }] },
  { p: 'cabin', label: 'Cabin', blurb: 'Projects, résumé and writing', stations: [
    { id: 'chest', label: 'Projects' }, { id: 'table', label: 'Voyage' }, { id: 'rack', label: 'Résumé' },
    { id: 'shelf', label: 'Blog' }, { id: 'handheld', label: 'Handheld' }] },
  { p: 'chartroom', label: 'Chart room', blurb: 'Ugurcan, the navigator', stations: [
    { id: 'ugurcan', label: 'Ugurcan' }, { id: 'table', label: 'Charts' }, { id: 'star', label: 'His star' }, { id: 'window', label: 'Windows' }] },
  { p: 'library', label: 'Library', blurb: 'Below deck, with the Librarian', stations: [
    { id: 'librarian', label: 'Librarian' }, { id: 'bookcase', label: 'Bookcase' }, { id: 'side', label: 'Shelves' }, { id: 'table', label: 'Catalogue' }] },
];

export interface MapHandlers {
  go(p: Place, station?: string): void;
  writing(): void;
  letter(): void;
  toggleNight(): void;
  toggleSound(): void;
}

const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

// The cutaway: a side view, bow to the right. The balloon and the sails are "Outside", the stern cabin with its big
// windows and the chart room forward share the main deck, the library sits below it.
const SHIP = `
<svg class="ship-svg" viewBox="0 0 420 250" aria-hidden="false" role="group" aria-label="The airship, cut away">
  <defs>
    <linearGradient id="sm-env" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3c98b"/><stop offset="1" stop-color="#c97a3c"/></linearGradient>
    <linearGradient id="sm-hull" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a3f24"/><stop offset="1" stop-color="#4a2316"/></linearGradient>
  </defs>
  <g class="rig" stroke="#e2b468" stroke-opacity=".5" stroke-width="1.2" fill="none">
    <path d="M110 92 L95 128 M170 98 L165 128 M250 98 L255 128 M310 92 L330 128"/>
  </g>
  <g class="room" data-place="outside" tabindex="0" role="button">
    <ellipse class="shape" cx="210" cy="56" rx="178" ry="46" fill="url(#sm-env)"/>
    <path d="M60 56 H360 M90 34 C150 22 270 22 330 34 M90 78 C150 90 270 90 330 78" stroke="#8a4a26" stroke-opacity=".35" fill="none"/>
    <text x="210" y="52">Outside</text><text class="sub" x="210" y="70">the ship under sail</text>
  </g>
  <path class="hull" d="M28 128 H398 L384 150 C366 214 300 236 210 236 C120 236 58 216 38 176 Z" fill="url(#sm-hull)"/>
  <g class="room" data-place="cabin" tabindex="0" role="button">
    <rect class="shape" x="40" y="134" width="186" height="50" rx="6"/>
    <path class="windows" d="M50 142 h24 v18 h-24z M80 142 h24 v18 h-24z M110 142 h24 v18 h-24z" />
    <text x="160" y="157">Cabin</text><text class="sub" x="160" y="173">the captain’s</text>
  </g>
  <g class="room" data-place="chartroom" tabindex="0" role="button">
    <rect class="shape" x="232" y="134" width="140" height="50" rx="6"/>
    <circle class="star" cx="356" cy="146" r="4"/>
    <text x="302" y="157">Chart room</text><text class="sub" x="302" y="173">the navigator’s</text>
  </g>
  <g class="room" data-place="library" tabindex="0" role="button">
    <rect class="shape" x="96" y="190" width="226" height="36" rx="6"/>
    <text x="209" y="208">Library</text><text class="sub" x="209" y="221">below deck</text>
  </g>
  <g class="pin" aria-hidden="true"><circle r="7"/><circle r="3" class="dot"/></g>
</svg>`;

/** Where the "you are here" pin sits on each room (in the drawing's units). */
const PIN: Record<Place, [number, number]> = { outside: [64, 40], cabin: [52, 176], chartroom: [244, 176], library: [108, 206] };

export class ShipMap {
  readonly el: HTMLElement;
  private place: Place = 'cabin';
  private station: string | null = null;
  private returnFocus: HTMLElement | null = null;
  private soundBtn: HTMLButtonElement;
  private nightBtn: HTMLButtonElement;
  private disabled = false;

  constructor(parent: HTMLElement, private h: MapHandlers) {
    const el = this.el = document.createElement('div');
    el.className = 'shipmap';
    el.hidden = true;
    el.innerHTML = `
      <div class="shipmap-scrim" data-close></div>
      <section class="shipmap-card" role="dialog" aria-modal="true" aria-labelledby="shipmap-title">
        <header><h2 id="shipmap-title" tabindex="-1">The ship</h2>
          <button type="button" class="icon-btn close" aria-label="Close the map" data-close>${CLOSE}</button></header>
        ${SHIP}
        <ul class="rooms"></ul>
        <footer>
          <nav class="links" aria-label="More">
            <button type="button" class="link" data-act="index">Ship’s Index</button>
            <button type="button" class="link" data-act="letter">Welcome letter</button>
            <a class="link" href="/plain/">Plain version</a>
          </nav>
          <div class="settings" role="group" aria-label="Settings">
            <button type="button" class="chip night" aria-pressed="false">Lantern: sunset</button>
            <button type="button" class="chip sound" aria-pressed="false">Sound: off</button>
          </div>
        </footer>
      </section>`;
    parent.appendChild(el);

    const list = el.querySelector('.rooms')!;
    // the list reads top to bottom as the ship does: outside, the main deck, below deck
    for (const r of ROOMS) {
      const li = document.createElement('li');
      li.dataset.place = r.p;
      const head = document.createElement('button');
      head.type = 'button'; head.className = 'room-btn';
      head.innerHTML = `<span class="name"></span><span class="blurb"></span>`;
      head.querySelector('.name')!.textContent = r.label;
      head.querySelector('.blurb')!.textContent = r.blurb;
      head.addEventListener('click', () => this.go(r.p));
      const st = document.createElement('div');
      st.className = 'stations';
      for (const s of r.stations) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'st'; b.dataset.id = s.id; b.textContent = s.label;
        b.setAttribute('aria-label', `${r.label}: ${s.label}`);
        b.addEventListener('click', () => this.go(r.p, s.id));
        st.appendChild(b);
      }
      li.append(head, st);
      list.appendChild(li);
    }
    for (const g of el.querySelectorAll<SVGGElement>('.room')) {
      const p = g.dataset.place as Place;
      const r = ROOMS.find(x => x.p === p)!;
      g.setAttribute('aria-label', `${r.label}: ${r.blurb}`);
      g.addEventListener('click', () => this.go(p));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.go(p); } });
      // the drawing and the list light up together
      const li = list.querySelector<HTMLElement>(`li[data-place="${p}"]`)!;
      const on = (v: boolean) => { g.classList.toggle('hot', v); li.classList.toggle('hot', v); };
      for (const t of [g, li]) {
        t.addEventListener('pointerenter', () => on(true)); t.addEventListener('pointerleave', () => on(false));
        t.addEventListener('focusin', () => on(true)); t.addEventListener('focusout', () => on(false));
      }
    }
    el.querySelectorAll('[data-close]').forEach(c => c.addEventListener('click', () => this.close()));
    el.querySelector('[data-act="index"]')!.addEventListener('click', () => { this.close(true); h.writing(); });
    el.querySelector('[data-act="letter"]')!.addEventListener('click', () => { this.close(true); h.letter(); });
    this.nightBtn = el.querySelector('.night')!;
    this.nightBtn.addEventListener('click', () => h.toggleNight());
    this.soundBtn = el.querySelector('.sound')!;
    this.soundBtn.addEventListener('click', () => h.toggleSound());
    el.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
      if (e.key === 'Tab') this.trap(e);
    });
    this.sync();
  }

  get isOpen() { return !this.el.hidden; }

  open() {
    if (this.isOpen) return;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.el.hidden = false;
    requestAnimationFrame(() => {
      this.el.classList.add('on');
      this.el.querySelector<HTMLElement>('#shipmap-title')!.focus({ preventScroll: true });
    });
  }

  /** `keepFocus`: something else takes focus next (the Index, the letter). */
  close(keepFocus = false) {
    if (!this.isOpen) return;
    this.el.classList.remove('on');
    setTimeout(() => { if (!this.el.classList.contains('on')) this.el.hidden = true; }, 220);
    const rf = this.returnFocus;
    this.returnFocus = null;
    if (!keepFocus && rf?.isConnected) rf.focus({ preventScroll: true });
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  /** Where the visitor is: the pin, and the current room and station in the list. */
  setHere(place: Place, station: string | null) {
    if (place === this.place && station === this.station) return;
    this.place = place; this.station = station;
    this.sync();
  }

  /** While the ship is moving between places nothing here can be picked (the move would be lost). */
  setDisabled(on: boolean) {
    if (on === this.disabled) return;
    this.disabled = on;
    this.el.classList.toggle('busy', on);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.rooms button')) b.disabled = on;
    for (const g of this.el.querySelectorAll<SVGGElement>('.room')) g.setAttribute('aria-disabled', String(on));
  }

  setNight(on: boolean) {
    this.nightBtn.setAttribute('aria-pressed', String(on));
    this.nightBtn.textContent = on ? 'Lantern: night' : 'Lantern: sunset';
  }
  setNightLoading(on: boolean) { this.nightBtn.classList.toggle('loading', on); this.nightBtn.setAttribute('aria-busy', String(on)); }
  setSound(m: 'off' | 'ambient' | 'full') {
    this.soundBtn.setAttribute('aria-pressed', String(m !== 'off'));
    this.soundBtn.textContent = `Sound: ${m}`;
  }

  private go(p: Place, station?: string) {
    if (this.disabled) return;
    this.close(true);
    this.h.go(p, station);
  }

  private sync() {
    const [x, y] = PIN[this.place];
    this.el.querySelector('.pin')!.setAttribute('transform', `translate(${x} ${y})`);
    for (const g of this.el.querySelectorAll<SVGGElement>('.room')) g.classList.toggle('here', g.dataset.place === this.place);
    for (const li of this.el.querySelectorAll<HTMLElement>('.rooms li')) {
      const here = li.dataset.place === this.place;
      li.classList.toggle('here', here);
      const head = li.querySelector('.room-btn')!;
      if (here) head.setAttribute('aria-current', 'location'); else head.removeAttribute('aria-current');
      for (const b of li.querySelectorAll<HTMLElement>('.st')) {
        if (here && b.dataset.id === this.station) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current');
      }
    }
  }

  private trap(e: KeyboardEvent) {
    const f = [...this.el.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]')].filter(n => n.getClientRects().length);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
