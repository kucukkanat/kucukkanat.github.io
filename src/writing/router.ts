// The address of what is being read: /?note=<slug>  /?topic=<id>  /?index=1  (optionally &q=<words>).
// Only these four query keys are touched; everything else in the query string (tier, intro, night, view…) is kept.

export type Route =
  | { kind: 'note'; slug: string; q?: string }
  | { kind: 'topic'; id: string }
  | { kind: 'index'; topic?: string; q?: string };

const KEYS = ['note', 'topic', 'index', 'q'];

/** The route in the current URL, or null when it does not ask for writing. */
export function current(): Route | null {
  const p = new URLSearchParams(location.search);
  const q = p.get('q')?.trim() || undefined;
  const note = p.get('note');
  if (note) return { kind: 'note', slug: note, q };
  const index = p.get('index');
  const topic = p.get('topic') || undefined;
  if (index !== null && index !== '0') return { kind: 'index', topic, q };
  if (topic) return { kind: 'topic', id: topic };
  return null;
}

/** The in-app URL for a route (null: the cabin, with the writing keys removed). */
export function href(route: Route | null): string {
  const p = new URLSearchParams(location.search);
  for (const k of KEYS) p.delete(k);
  if (route?.kind === 'note') { p.set('note', route.slug); if (route.q) p.set('q', route.q); }
  else if (route?.kind === 'topic') p.set('topic', route.id);
  else if (route?.kind === 'index') { p.set('index', '1'); if (route.topic) p.set('topic', route.topic); if (route.q) p.set('q', route.q); }
  const s = p.toString();
  return location.pathname + (s ? `?${s}` : '') + location.hash;
}

const here = () => location.pathname + location.search + location.hash;

/** Add a history entry for the route (nothing happens when the address already says so). */
export function push(route: Route | null) {
  const url = href(route);
  if (url !== here()) history.pushState(history.state, '', url);
}

/** Rewrite the current history entry. */
export function replace(route: Route | null) {
  const url = href(route);
  if (url !== here()) history.replaceState(history.state, '', url);
}

/** Back / Forward: called with the route of the entry that became current. Returns the unsubscribe function. */
export function onPop(fn: (route: Route | null) => void): () => void {
  const h = () => fn(current());
  addEventListener('popstate', h);
  return () => removeEventListener('popstate', h);
}

const baseTitle = document.title;
/** The site's short name: the part after the dash in "Hilmi Tolga Şahin — kucukkanat". */
export const SITE = baseTitle.split(/\s[—–|·-]\s/).pop()?.trim() || baseTitle || 'kucukkanat';

/** "<title> · <site>" while something is open; null restores the page's own title. */
export function setTitle(title: string | null) {
  document.title = title ? `${title} · ${SITE}` : baseTitle;
}
