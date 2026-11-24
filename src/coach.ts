// The one-time hint about getting around ("coach mark"), the same words in every place: the gestures are the same
// everywhere (input.ts), so is the hint. Each place shows it once per visitor (localStorage), above the dock, and it
// goes on the visitor's first touch, drag or zoom, or after a few seconds.
import type { Place } from './ui';

const KEY = (p: Place) => p === 'cabin' ? 'kk-hint' : `kk-hint-${p}`; // the cabin keeps its old key: no repeat for returning visitors
const EXTRA: Partial<Record<Place, { touch: string; mouse: string }>> = {
  outside: { touch: 'Take the helm to steer', mouse: 'Take the helm (H) to steer' },
};

let el: HTMLElement | null = null;
let timer = 0;

/** The words for a place (also what the outside view shows at the bottom of its help). */
export function coachText(place: Place) {
  const touch = matchMedia('(pointer: coarse)').matches;
  const base = touch
    ? ['Drag to look around', 'pinch to zoom', 'tap a glowing dot to go there', 'the map below changes rooms']
    : ['Drag to look around', 'scroll to zoom', 'click a glowing dot to go there', 'the map (M) changes rooms'];
  const x = EXTRA[place];
  if (x) base.push(touch ? x.touch : x.mouse);
  return base.join(' · ');
}

/**
 * Show the hint for a place, once per visitor. `above`: an element it should sit above (the library's chat), instead
 * of just above the dock.
 */
export function coach(place: Place, opts: { above?: HTMLElement; force?: boolean } = {}) {
  try {
    if (!opts.force && localStorage.getItem(KEY(place)) === '1') return;
    localStorage.setItem(KEY(place), '1');
  } catch { /* storage blocked: show it, it can't be remembered anyway */ }
  dismissCoach(true);
  const c = el = document.createElement('div');
  c.className = 'cam-hint coach';
  c.setAttribute('role', 'status');
  c.textContent = coachText(place);
  // above the given element, else above the dock as it is now (measured here: --dock-h can lag a layout change)
  const above = opts.above ?? document.querySelector<HTMLElement>('.ui-chrome .dock');
  if (above?.getClientRects().length) c.style.bottom = `${Math.round(innerHeight - above.getBoundingClientRect().top + 10)}px`;
  document.body.appendChild(c);
  requestAnimationFrame(() => c.classList.add('on'));
  timer = window.setTimeout(() => dismissCoach(), 8000);
  // the first touch or click after it has been read a moment
  setTimeout(() => { if (el === c) addEventListener('pointerdown', () => { if (el === c) dismissCoach(); }, { once: true, capture: true }); }, 1500);
}

/** Take the hint away (the visitor started moving; another place). */
export function dismissCoach(now = false) {
  clearTimeout(timer);
  if (!el) return;
  const c = el;
  el = null;
  if (now) { c.remove(); return; }
  c.classList.remove('on');
  setTimeout(() => c.remove(), 400);
}
