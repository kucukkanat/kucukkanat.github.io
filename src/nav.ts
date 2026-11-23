// The address bar mirrors what is on screen, so any state can be shared and Back / Forward walk through it.
//
//   ?view=chest&item=tilttown   a cabin view, and the item pulled out there
//   ?play=tilttown              a cartridge in the handheld (implies the handheld view)
//   ?open=letter|about|story|contact|clock
//   ?outside=1                  outside the ship
//   ?deck=1                     below deck, in the library
//   ?whale=<key>                a sky whale's card
//   ?search=<words>             the Speaking Tube palette
//   ?night=1  ?storm=1          the look of the sky (rewrite the entry: never a Back step of their own)
//   ?note= ?topic= ?index= ?q=  the reading room (writing/router.ts)
//
// Everything else in the query (tier, intro, nosw, time, welcome…) is left as it is.
//
// The app reports its state (snapshot) and the module keeps the address in step. Each history entry made here
// remembers the address before it (state.prev): when the app goes back to exactly that (✕, Esc, Eject, flick
// down…), the module calls history.back() instead of stacking a new entry, so in-app back and the browser's Back
// are the same thing.

export const CABIN_KEYS = ['view', 'item', 'play', 'open', 'outside', 'deck', 'whale', 'search', 'night', 'storm'] as const;
export type CabinKey = typeof CABIN_KEYS[number];
export type CabinState = Partial<Record<CabinKey, string>>;

/** Keys that only change how things look: a change in these alone rewrites the entry. */
const LOOK: CabinKey[] = ['night', 'storm'];

interface NavState { kk: 1; prev: string | null; by?: 'cabin' | 'writing'; t: number }

/** A history.back() of ours is on its way: hold commits until its popstate lands. */
let backing = false;
addEventListener('popstate', () => { backing = false; });

const here = () => location.pathname + location.search + location.hash;
const navState = (): NavState | null => {
  const s = history.state as NavState | null;
  return s && s.kk === 1 ? s : null;
};

/** The cabin part of the current address. */
export function read(): CabinState {
  const p = new URLSearchParams(location.search);
  const s: CabinState = {};
  for (const k of CABIN_KEYS) { const v = p.get(k); if (v !== null) s[k] = v; }
  return s;
}

/** The address with the cabin keys replaced by the state's (other keys kept). */
function urlFor(s: CabinState): string {
  const p = new URLSearchParams(location.search);
  for (const k of CABIN_KEYS) p.delete(k);
  for (const k of CABIN_KEYS) { const v = s[k]; if (v !== undefined) p.set(k, v); }
  const q = p.toString();
  return location.pathname + (q ? `?${q}` : '') + location.hash;
}

export const same = (a: CabinState, b: CabinState, skip: CabinKey[] = []) =>
  CABIN_KEYS.every(k => skip.includes(k) || a[k] === b[k]);

/** True when `next` only takes things away from `cur` (closing something; the look keys aside). */
const closes = (cur: CabinState, next: CabinState) => {
  let fewer = false;
  for (const k of CABIN_KEYS) {
    if (LOOK.includes(k)) continue;
    if (next[k] !== undefined && next[k] !== cur[k]) return false;
    if (next[k] === undefined && cur[k] !== undefined) fewer = true;
  }
  return fewer;
};

/**
 * Go to an address: back when it is the entry before this one, a new entry otherwise.
 * `replace` rewrites the current entry instead.
 */
export function go(url: string, opts: { replace?: boolean; by?: NavState['by'] } = {}) {
  const cur = here();
  if (url === cur) return;
  const st = navState();
  if (!opts.replace && st?.prev === url) { backing = true; history.back(); return; }
  if (opts.replace) history.replaceState({ kk: 1, prev: st?.prev ?? null, by: st?.by, t: st?.t ?? Date.now() } satisfies NavState, '', url);
  else history.pushState({ kk: 1, prev: cur, by: opts.by, t: Date.now() } satisfies NavState, '', url);
}

/** Put the cabin state in the address (called whenever the app settles). */
export function commit(next: CabinState, opts: { replace?: boolean } = {}) {
  if (backing) return;
  const cur = read();
  if (same(cur, next)) return;
  const url = urlFor(next);
  const st = navState();
  let replace = !!opts.replace
    // only the look changed, or only the words in the search box
    || same(cur, next, LOOK) || (cur.search !== undefined && next.search !== undefined && same(cur, next, ['search', ...LOOK]))
    // the reading room just made this entry, and the cabin is tidying up behind it
    || (st?.by === 'writing' && Date.now() - st.t < 1500);
  // closing something that this session did not open (a shared link, a closed palette): no entry to come back to
  if (!replace && st?.prev !== url && closes(cur, next)) replace = true;
  // the palette closed because a result was picked: the result takes the palette's place
  if (!replace && cur.search !== undefined && next.search === undefined && st?.prev !== url) replace = true;
  go(url, { replace });
}

/** Back / Forward: called with the cabin state of the entry that became current. */
export function onPop(fn: (s: CabinState) => void) {
  addEventListener('popstate', () => fn(read()));
}
