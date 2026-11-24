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
  { p: 'chartroom', label: 'Chart room', blurb: 'Goof, the navigator', stations: [
    { id: 'ugurcan', label: 'Goof' }, { id: 'table', label: 'Charts' }, { id: 'star', label: 'His star' }, { id: 'window', label: 'Windows' }] },
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

// The cutaway: the sky galleon side on, bow to the left. Everything above the deck (sails, masts, the open air) is
// "Outside"; the hull is cut open to show the captain's cabin in the stern castle, the chart room forward of it, and
// the library below deck.
const HULL = 'M30 152 C60 160 70 166 90 166 L330 166 L330 138 L440 132 C446 160 440 190 420 206 C390 236 330 250 240 252 C150 252 80 236 52 200 C40 184 32 168 30 152 Z';
const SAIL = (x1: number, y1: number, x2: number, y2: number, bulge: number) =>
  `M${x1} ${y1} L${x2} ${y1} Q${x2 + bulge * .35} ${(y1 + y2) / 2} ${x2 + bulge * .1} ${y2} Q${(x1 + x2) / 2} ${y2 + bulge} ${x1 - bulge * .1} ${y2} Q${x1 - bulge * .35} ${(y1 + y2) / 2} ${x1} ${y1}Z`;
/** A ribbed fan wing (the galleon's fins): panels from a pivot to each pair of rib tips, orange and cream in turn. */
const FAN = (px: number, py: number, tips: number[][]) => {
  let out = '<g class="fin">';
  for (let i = 0; i < tips.length - 1; i++) {
    const [ax, ay] = tips[i], [bx, by] = tips[i + 1];
    const mx = (ax + bx) / 2, my = (ay + by) / 2, cx = mx + (mx - px) * -.12, cy = my + (my - py) * -.12;
    out += `<path d="M${px} ${py} L${ax} ${ay} Q${cx} ${cy} ${bx} ${by} Z" fill="${i % 2 ? '#fbeedd' : '#f07a2a'}"/>`;
  }
  out += tips.map(([x, y]) => `<path d="M${px} ${py} L${x} ${y}" stroke="#6b3a22" stroke-width="1.6" stroke-linecap="round"/>`).join('');
  return out + `<circle cx="${px}" cy="${py}" r="4" fill="#c99a4a"/></g>`;
};
const BOOKS = (() => {
  const c = ['#b8432c', '#2f5d7c', '#d2a24c', '#4f7a3a', '#7a3550', '#c46a2c', '#e0c48a'];
  let out = '', x = 166, i = 0;
  for (const row of [221, 232]) {
    x = 166;
    while (x < 330) {
      const w = 3 + ((i * 7) % 3), h = 8 + ((i * 5) % 3);
      if (!(x > 236 && x < 262)) out += `<rect x="${x}" y="${row + 10 - h}" width="${w}" height="${h}" fill="${c[i % c.length]}"/>`;
      x += w + 1; i++;
    }
  }
  return out;
})();
const SHIP = `
<svg class="ship-svg" viewBox="0 0 480 300" role="group" aria-label="The sky galleon, cut away">
  <defs>
    <linearGradient id="sm-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a4b2a"/><stop offset="1" stop-color="#4a2516"/></linearGradient>
    <linearGradient id="sm-sail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e9d8b8"/><stop offset=".6" stop-color="#fbf0dc"/><stop offset="1" stop-color="#e2cfaa"/></linearGradient>
    <linearGradient id="sm-in" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2015"/><stop offset="1" stop-color="#24130c"/></linearGradient>
    <radialGradient id="sm-glow"><stop offset="0" stop-color="#ffd58f" stop-opacity=".9"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/></radialGradient>
    <clipPath id="sm-hullclip"><path d="${HULL}"/></clipPath>
  </defs>

  <g class="room outside" data-place="outside" tabindex="0" role="button">
    <rect class="hit" x="0" y="0" width="480" height="160" fill="transparent"/>
    <g class="rigging" stroke="#5a3420" stroke-width=".9" fill="none" opacity=".75">
      <path d="M150 22 L64 164 M150 22 L222 164 M255 14 L196 164 M255 14 L330 136 M255 14 L440 130 M150 22 L14 138"/>
    </g>
    <path d="M14 138 L58 152" stroke="#6b3a22" stroke-width="4" stroke-linecap="round"/>
    <path class="sail" d="M18 136 L146 30 L146 140 Z" fill="url(#sm-sail)" opacity=".95"/>
    <g class="mast" stroke="#6b3a22" stroke-linecap="round">
      <path d="M150 18 V166" stroke-width="5"/><path d="M255 10 V166" stroke-width="6"/>
      <path d="M116 54 H186 M106 92 H196 M214 38 H296 M204 84 H306" stroke-width="3"/>
    </g>
    <path class="sail" d="${SAIL(118, 56, 184, 88, 6)}" fill="url(#sm-sail)"/>
    <path class="sail" d="${SAIL(108, 94, 194, 142, 9)}" fill="url(#sm-sail)"/>
    <path class="sail" d="${SAIL(216, 40, 294, 80, 7)}" fill="url(#sm-sail)"/>
    <path class="sail" d="${SAIL(206, 86, 304, 144, 10)}" fill="url(#sm-sail)"/>
    <path d="M206 100 H304" stroke="#f07a2a" stroke-width="7" opacity=".9"/>
    <path d="M118 66 H184" stroke="#f07a2a" stroke-width="5" opacity=".9"/>
    <path d="M255 10 l24 5 -24 5z" fill="#f07a2a"/>
    <path d="M150 18 l16 4 -16 4z" fill="#f07a2a"/>
    <g class="label"><text x="392" y="56">Outside</text><text class="sub" x="392" y="72">on deck and aloft</text></g>
  </g>

  ${FAN(120, 212, [[50, 226], [52, 246], [66, 262], [88, 270]])}
  ${FAN(398, 210, [[458, 222], [462, 242], [452, 260], [432, 268]])}
  <path d="M226 250 L252 286 L284 250 Z" fill="#4a2516" stroke="#2a140c"/>

  <path class="hull" d="${HULL}" fill="url(#sm-wood)" stroke="#2a140c" stroke-width="1.5"/>
  <g clip-path="url(#sm-hullclip)">
    <path d="M0 192 H480 M0 202 H480 M0 212 H480 M0 222 H480 M0 232 H480 M0 242 H480" stroke="#2a140c" stroke-opacity=".35"/>
    <rect x="0" y="171" width="480" height="11" fill="#efe0c2"/>
    <rect x="0" y="182" width="480" height="3" fill="#f07a2a"/>
    <rect x="320" y="140" width="130" height="8" fill="#efe0c2"/>
    <circle cx="96" cy="200" r="3" fill="#ffd58f"/><circle cx="120" cy="200" r="3" fill="#ffd58f"/>
  </g>
  <path d="M60 166 H330 V138 L440 132" fill="none" stroke="#e2b468" stroke-width="2.5"/>
  <path d="M330 132 v-10 M352 131 v-10 M374 130 v-10 M396 130 v-10 M418 129 v-10 M330 122 L440 120" stroke="#c99a4a" stroke-width="1.5"/>
  <circle cx="440" cy="114" r="4" fill="#ffd58f"/><circle cx="440" cy="114" r="12" fill="url(#sm-glow)"/>

  <g class="room cut" data-place="cabin" tabindex="0" role="button">
    <rect class="shape" x="332" y="146" width="96" height="62" rx="3" fill="url(#sm-in)"/>
    <g fill="#ffcf86"><rect x="344" y="154" width="14" height="20" rx="7"/><rect x="368" y="154" width="14" height="20" rx="7"/><rect x="392" y="154" width="14" height="20" rx="7"/></g>
    <path d="M351 154 v20 M375 154 v20 M399 154 v20 M344 166 h14 M368 166 h14 M392 166 h14" stroke="#3b2015" stroke-width="1.5"/>
    <path d="M348 199 h52 M352 199 v8 M396 199 v8" stroke="#8a4b2a" stroke-width="3"/>
    <rect x="364" y="194" width="12" height="5" rx="1" fill="#f07a2a"/>
    <g class="label"><text x="380" y="191">Cabin</text></g>
  </g>

  <g class="room cut" data-place="chartroom" tabindex="0" role="button">
    <rect class="shape" x="214" y="170" width="112" height="40" rx="3" fill="url(#sm-in)"/>
    <circle cx="270" cy="174" r="12" fill="url(#sm-glow)"/><path d="M270 168 l1.6 4 4 .4 -3 2.6 1 4 -3.6-2.2 -3.6 2.2 1-4 -3-2.6 4-.4z" fill="#fff3dc"/>
    <path d="M238 202 h64 M242 202 v8 M298 202 v8" stroke="#8a4b2a" stroke-width="3"/>
    <path d="M246 199 h48" stroke="#efe0c2" stroke-width="3"/>
    <g class="label"><text x="270" y="194">Chart room</text></g>
  </g>

  <g class="room cut" data-place="library" tabindex="0" role="button">
    <rect class="shape" x="160" y="216" width="176" height="28" rx="3" fill="url(#sm-in)"/>
    ${BOOKS}
    <path d="M242 216 v28 M256 216 v28 M242 222 h14 M242 229 h14 M242 236 h14" stroke="#c99a4a" stroke-width="1.5"/>
    <g class="label"><text x="249" y="235">Library</text></g>
  </g>

  <g class="pin" aria-hidden="true"><circle r="7"/><circle r="3" class="dot"/></g>
</svg>`;

/** Where the "you are here" pin sits on each room (in the drawing's units). */
const PIN: Record<Place, [number, number]> = { outside: [352, 50], cabin: [338, 152], chartroom: [220, 176], library: [166, 222] };

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
