// Notes data for the reader, the index and the search palette: one lazy fetch of /notes.json, bodies on demand.
import type { NoteBody, NoteMeta, NotesIndex, Series, Stage, Topic } from './types';

/**
 * Fold text for matching: lower case, Turkish letters and other accents reduced to plain ASCII
 * (ı/İ/I/i → i, ğ → g, ş → s, ç → c, ö → o, ü → u), so "Işık", "ışık" and "isik" are equal.
 */
export function fold(s: string): string {
  return s.replace(/[ıİ]/g, 'i').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Folded words of a query (letters and digits only, at least two characters). */
export function terms(q: string): string[] {
  return fold(q).split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1);
}

let indexPromise: Promise<NotesIndex | null> | null = null;
const bodies = new Map<string, Promise<NoteBody | null>>();

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    // a missing file is a 404 in production and the SPA fallback (HTML, 200) on the dev server
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

const valid = (ix: NotesIndex | null): ix is NotesIndex => !!ix && Array.isArray(ix.notes) && Array.isArray(ix.topics);

/** The notes index, fetched once. Null when there are no notes (the file is absent or empty). */
export function loadIndex(): Promise<NotesIndex | null> {
  return indexPromise ??= (async () => {
    const ix = await json<NotesIndex>('/notes.json');
    if (!valid(ix) || !ix.notes.length) return null;
    ix.series ??= [];
    return ix;
  })();
}

/** A note's rendered body, cached. Null when it cannot be loaded. */
export function getNote(slug: string): Promise<NoteBody | null> {
  let p = bodies.get(slug);
  if (!p) {
    p = json<NoteBody>(`/notes/${encodeURIComponent(slug)}.json`)
      .then(b => (b && typeof b.html === 'string' ? b : null));
    bodies.set(slug, p);
    void p.then(b => { if (!b) bodies.delete(slug); }); // a failed load may be retried
  }
  return p;
}

export function bySlug(ix: NotesIndex, slug: string): NoteMeta | undefined {
  return ix.notes.find(n => n.slug === slug);
}

export function topicById(ix: NotesIndex, id: string): Topic | undefined {
  return ix.topics.find(t => t.id === id);
}

/** Topics in shelf order. */
export function topics(ix: NotesIndex): Topic[] {
  return [...ix.topics].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** A topic's notes, newest first. */
export function byTopic(ix: NotesIndex, id: string): NoteMeta[] {
  return ix.notes.filter(n => n.topic === id).sort((a, b) => b.date.localeCompare(a.date));
}

const metas = (ix: NotesIndex, slugs: string[]) => slugs.map(s => bySlug(ix, s)).filter((n): n is NoteMeta => !!n);

/** Notes that link to this one. */
export function backlinks(ix: NotesIndex, slug: string): NoteMeta[] {
  return metas(ix, bySlug(ix, slug)?.backlinks ?? []);
}

export interface SeriesPlace { series: Series; notes: NoteMeta[]; position: number; prev: NoteMeta | null; next: NoteMeta | null; }

/** Where a note sits in its series (position is 1-based), or null when it is not part of one. */
export function seriesPlace(ix: NotesIndex, slug: string): SeriesPlace | null {
  const id = bySlug(ix, slug)?.series?.id;
  const series = id ? ix.series.find(s => s.id === id) : undefined;
  if (!series) return null;
  const notes = metas(ix, series.notes);
  const i = notes.findIndex(n => n.slug === slug);
  if (i < 0) return null;
  return { series, notes, position: i + 1, prev: notes[i - 1] ?? null, next: notes[i + 1] ?? null };
}

/** Series that have at least one note in the topic, each with its notes in reading order. */
export function seriesInTopic(ix: NotesIndex, topicId: string): { series: Series; notes: NoteMeta[] }[] {
  return ix.series.map(series => ({ series, notes: metas(ix, series.notes) }))
    .filter(s => s.notes.length > 1 && s.notes.some(n => n.topic === topicId));
}

/** The older and the newer note in the same topic. */
export function topicNeighbours(ix: NotesIndex, slug: string): { older: NoteMeta | null; newer: NoteMeta | null } {
  const note = bySlug(ix, slug);
  if (!note) return { older: null, newer: null };
  const list = byTopic(ix, note.topic);
  const i = list.findIndex(n => n.slug === slug);
  return { newer: list[i - 1] ?? null, older: list[i + 1] ?? null };
}

export type FacetKey = 'topic' | 'stage' | 'lang' | 'year' | 'tag';
export const FACETS: FacetKey[] = ['topic', 'stage', 'lang', 'year', 'tag'];
export const STAGES: Stage[] = ['seedling', 'growing', 'evergreen'];

/** The values a note has for a facet. */
export function facetValues(n: NoteMeta, key: FacetKey): string[] {
  switch (key) {
    case 'topic': return [n.topic];
    case 'stage': return [n.stage];
    case 'lang': return [n.lang];
    case 'year': return [n.date.slice(0, 4)];
    case 'tag': return n.tags;
  }
}

/** Number of notes per value, for every facet. */
export function facetCounts(notes: NoteMeta[]): Record<FacetKey, Map<string, number>> {
  const out = {} as Record<FacetKey, Map<string, number>>;
  for (const key of FACETS) {
    const m = out[key] = new Map<string, number>();
    for (const n of notes) for (const v of facetValues(n, key)) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return out;
}

/** Does the note match every term (title, excerpt, tags; folded)? */
export function matches(n: NoteMeta, ts: string[]): boolean {
  if (!ts.length) return true;
  const hay = fold(`${n.title} ${n.excerpt} ${n.tags.join(' ')}`);
  return ts.every(t => hay.includes(t));
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "2026-11-20" → "20 Nov 2026". */
export function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export const LANG_NAME: Record<string, string> = { en: 'English', tr: 'Türkçe' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
