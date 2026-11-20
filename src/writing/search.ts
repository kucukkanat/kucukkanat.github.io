// The Speaking Tube: one box that finds notes (full text, Pagefind), topics, projects, jobs and cabin actions.
// Plain DOM. Notes come from the built Pagefind bundle (lazy, on first open); if it is missing the notes are
// searched by their metadata from /notes.json. Everything else is ranked locally and instantly.
import './search.css';
import type { Lang, NoteMeta, NotesIndex, Stage } from './types';

export interface SearchItem {
  id: string;
  group: 'Topics' | 'Projects' | 'Career' | 'Actions';
  title: string;
  /** Second line (subtitle, period, what the action does). */
  detail?: string;
  /** Extra words to match on (tags, synonyms, Turkish names). */
  keywords?: string[];
  run(): void;
}
export interface SearchHooks {
  pickNote(slug: string, q: string): void;
  /** Opened / closed: the app pauses its own keyboard shortcuts. */
  changed(open: boolean): void;
  lastRead(): { slug: string; title: string } | null;
  announce(text: string): void;
}

const RECENT_KEY = 'kk.search.recent';
const RECENT_MAX = 5;
const PAGEFIND_DIR = '/pagefind/';
const PAGEFIND_URL = PAGEFIND_DIR + 'pagefind.js';
const NOTES_URL = '/notes.json';
const FIXTURE_URL = '/_fixture/search-notes.json';
const NOTE_CAP = 6;
const CAPS: Record<SearchItem['group'], number> = { Topics: 4, Projects: 5, Career: 4, Actions: 5 };
const LOCAL_GROUPS: SearchItem['group'][] = ['Topics', 'Projects', 'Career', 'Actions'];
/** A local match this good (title starts with the query) is listed above the notes. */
const STRONG = 90;

// ---------- text helpers ----------

/** Lower-case and strip Turkish letters and other diacritics: "Işık Çağ" → "isik cag", "İZMİR" → "izmir". */
function fold(s: string): string {
  return s.replace(/[İIı]/g, 'i').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
const words = (folded: string) => folded.split(/[^a-z0-9]+/).filter(Boolean);
const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));

/** Edit distance of at most one (a substitution, an insertion, a deletion or two neighbours swapped). */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

interface Field { full: string; words: string[]; weight: number; }
const field = (text: string, weight: number): Field => { const full = fold(text).trim(); return { full, words: words(full), weight }; };

/** How well one folded term matches one field, 0–100. */
function scoreField(f: Field, t: string): number {
  if (!t || !f.full) return 0;
  if (f.full === t) return 100;
  if (f.full.startsWith(t)) return 92;
  let best = 0;
  for (const w of f.words) {
    if (w === t) { best = Math.max(best, 84); break; }
    if (w.startsWith(t)) best = Math.max(best, 76);
  }
  if (best) return best;
  if (t.length >= 2 && f.full.includes(t)) return 52;
  if (t.length >= 4) {
    for (const w of f.words) {
      if (near(t, w)) return 34;
      // a typo in the first letters of a longer word: "leadr" → "leadership"
      if (t.length >= 5 && w.length > t.length && (near(t, w.slice(0, t.length)) || near(t, w.slice(0, t.length + 1)) || near(t, w.slice(0, t.length - 1)))) best = 26;
    }
  }
  return best;
}

/** Score of a query against a set of fields: the whole phrase, or every word of it somewhere. */
function scoreFields(fields: Field[], q: string, toks: string[]): number {
  let phrase = 0;
  for (const f of fields) phrase = Math.max(phrase, scoreField(f, q) * f.weight);
  if (toks.length < 2) return phrase;
  let sum = 0;
  for (const t of toks) {
    let b = 0;
    for (const f of fields) b = Math.max(b, scoreField(f, t) * f.weight);
    if (!b) return phrase;
    sum += b;
  }
  return Math.max(phrase, (sum / toks.length) * 0.95);
}

/** Escape `text` and wrap the parts that match a query word in <mark>. */
function markUp(text: string, toks: string[]): string {
  if (!toks.length) return esc(text);
  return text.split(/([\p{L}\p{N}]+)/u).map((part, i) => {
    if (i % 2 === 0) return esc(part);
    const f = fold(part);
    if (f.length !== part.length) return esc(part);
    for (const t of toks) {
      const at = t.length >= 2 || f.startsWith(t) ? f.indexOf(t) : -1;
      if (at >= 0) return esc(part.slice(0, at)) + '<mark>' + esc(part.slice(at, at + t.length)) + '</mark>' + esc(part.slice(at + t.length));
    }
    return esc(part);
  }).join('');
}

/** Is the word Pagefind highlighted really (a form of) the word that was asked for? Pagefind shortens a word it does
 *  not know until something matches, so "isik" would otherwise return every page containing "is". */
function related(t: string, w: string): boolean {
  if (w.startsWith(t) || (t.length >= 5 && near(t, w))) return true;
  if (t.length < 6) return false;   // a short word has to be there as typed ("isik" is not "işi")
  let cp = 0;
  while (cp < t.length && cp < w.length && t[cp] === w[cp]) cp++;
  return cp >= Math.max(3, t.length - 4);   // other forms of the same stem: "running" → "run"
}
function plausible(excerpt: string, title: string, toks: string[]): boolean {
  const marked = [...excerpt.matchAll(/<mark>(.*?)<\/mark>/g)].flatMap(m => words(fold(m[1])));
  const pool = marked.length ? marked : words(fold(title));
  return !toks.length || pool.some(w => toks.some(t => related(t, w)));
}

/** Each Turkish page carries a hidden list of its words in plain ASCII ("bahcivan" for "bahçıvan"). A hit on that list
 *  gives an excerpt that is a run of folded words, or one with no mark at all: the note's own excerpt reads better. */
function needsPlainExcerpt(d: PagefindResult): boolean {
  const marks = [...(d.excerpt ?? '').matchAll(/<mark>(.*?)<\/mark>/g)].map(m => m[1].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));
  if (!marks.length) return true;
  if (marks.some(m => !/^[a-z0-9]+$/.test(m))) return false;
  const originals = new Set<string>();
  for (const w of (d.content ?? '').split(/[^\p{L}\p{N}]+/u)) if (/[^\x00-\x7f]/.test(w)) originals.add(fold(w));
  return marks.every(m => originals.has(m));
}

/** Pagefind excerpts are escaped text with <mark>; keep only the marks. */
const cleanExcerpt = (html: string) => html.replace(/<(?!\/?mark>)[^>]*>/g, '');

// ---------- data ----------

interface NoteHit { slug: string; title: string; excerpt: string; topic?: string; stage?: string; lang?: string; minutes?: number; }
type Filters = { lang?: Lang; stage?: Stage; topic?: string };
type FilterKey = keyof Filters;

/** The parts of Pagefind's browser API used here (https://pagefind.app/docs/api/). */
interface PagefindResult {
  url: string; excerpt: string; content?: string;
  meta?: Record<string, string>;
  filters?: Record<string, string[]>;
  sub_results?: { title: string; url: string; excerpt: string }[];
}
interface Pagefind {
  options?(o: Record<string, unknown>): Promise<void>;
  init?(): Promise<void>;
  mergeIndex?(path: string, o?: { language?: string }): Promise<void>;
  filters?(): Promise<Record<string, Record<string, number>>>;
  debouncedSearch(q: string, o?: { filters?: Record<string, unknown> }, ms?: number): Promise<{ results: { id: string; data(): Promise<PagefindResult> }[] } | null>;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    // the dev server answers a missing file with index.html
    if (!res.ok || !/json/.test(res.headers.get('content-type') ?? '')) return null;
    return await res.json() as T;
  } catch { return null; }
}

async function loadPagefind(): Promise<{ pf: Pagefind; available: Record<string, Record<string, number>> } | null> {
  try {
    const head = await fetch(PAGEFIND_URL, { method: 'HEAD' });
    if (!head.ok || !/javascript/.test(head.headers.get('content-type') ?? '')) return null;
    // An absolute URL in a variable: tsc does not look for the module, the build leaves the import alone, and the dev
    // server serves the file from public/ as it is (a root-relative path would get `?import` appended and be refused).
    const url = new URL(PAGEFIND_URL, location.href).href;
    const pf = await import(/* @vite-ignore */ url) as Pagefind;
    await pf.options?.({ excerptLength: 24 });
    await pf.init?.();
    const entry = await fetchJson<{ languages?: Record<string, unknown> }>(PAGEFIND_DIR + 'pagefind-entry.json');
    const own = (document.documentElement.lang || 'unknown').toLowerCase();
    const languages = Object.keys(entry?.languages ?? {});
    // The build makes ONE index for both languages, so this loop normally does nothing. Should the index ever be split
    // by language, Pagefind would load only the page's own (<html lang>): add the others then.
    for (const language of languages.length > 1 ? languages : []) {
      if (language === own || !pf.mergeIndex) continue;
      try { await pf.mergeIndex(new URL(PAGEFIND_DIR, location.href).href, { language }); } catch { /* that language stays metadata-only */ }
    }
    const available = (await pf.filters?.()) ?? {};
    return { pf, available };
  } catch { return null; }
}

const slugOf = (url: string) => /\/writing\/(?!topic\/)([^/?#]+)\/?(?:[?#].*)?$/.exec(url)?.[1] ?? null;

// ---------- the palette ----------

interface Row {
  group: string;
  /** Trusted HTML (already escaped). */
  title: string;
  detail?: string;
  meta?: string;
  kind: 'note' | 'item' | 'recent';
  /** Announced when picked. */
  name: string;
  /** Put this text in the input instead of closing. */
  fill?: string;
  run?(): void;
}

const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const STAGES: Stage[] = ['seedling', 'growing', 'evergreen'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export class Search {
  private el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private chips: HTMLElement;
  private status: HTMLElement;
  private open_ = false;
  private rows: Row[] = [];
  private active = 0;
  private returnFocus: HTMLElement | null = null;
  private hideTimer = 0;
  private statusTimer = 0;

  private index: NotesIndex | null = null;
  private bySlug = new Map<string, NoteMeta>();
  private noteFields = new Map<string, Field[]>();
  private topicTitle = new Map<string, string>();
  private pf: Pagefind | null = null;
  private pfAvailable: Record<string, Record<string, number>> = {};
  private loading: Promise<void> | null = null;
  private loaded = false;

  private filt: Filters = {};
  private noteHits: NoteHit[] = [];
  private noteMore = 0;
  /** The query the current note hits belong to. */
  private notesFor = '';
  private seq = 0;

  constructor(root: HTMLElement, private items: () => SearchItem[], private hooks: SearchHooks) {
    const el = this.el = document.createElement('div');
    el.className = 'st-root';
    el.hidden = true;
    el.innerHTML = `
      <div class="st-scrim"></div>
      <div class="st-palette" role="dialog" aria-modal="true" aria-label="Speaking tube: search the ship">
        <div class="st-plate">
          <span class="st-mouth" aria-hidden="true"></span>
          <input class="st-input" type="text" role="combobox" aria-expanded="true" aria-controls="st-list" aria-autocomplete="list"
            aria-label="Search notes, projects, career and actions" placeholder="Speak into the tube…"
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" />
          <button class="st-close" type="button" aria-label="Close search"><kbd aria-hidden="true">esc</kbd>${ICON_CLOSE}</button>
        </div>
        <div class="st-body">
          <div class="st-chips" role="toolbar" aria-label="Filter notes" hidden></div>
          <div class="st-list" id="st-list" role="listbox" aria-label="Results"></div>
          <div class="st-foot" aria-hidden="true">
            <span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>tab</kbd> next group</span><span><kbd>esc</kbd> close</span>
          </div>
        </div>
        <div class="st-sr" role="status" aria-live="polite"></div>
      </div>`;
    root.appendChild(el);
    this.input = el.querySelector('.st-input')!;
    this.list = el.querySelector('.st-list')!;
    this.chips = el.querySelector('.st-chips')!;
    this.status = el.querySelector('.st-sr')!;

    el.querySelector('.st-scrim')!.addEventListener('click', () => this.close());
    el.querySelector('.st-close')!.addEventListener('click', () => this.close());
    this.input.addEventListener('input', () => this.changedQuery());
    // keep the focus in the input while clicking results
    this.list.addEventListener('mousedown', e => e.preventDefault());
    this.list.addEventListener('mousemove', e => {
      const i = this.rowIndex(e.target);
      if (i >= 0 && i !== this.active) this.setActive(i, false);
    });
    this.list.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const ex = t.closest<HTMLElement>('[data-fill]');
      if (ex) { this.setQuery(ex.dataset.fill!); return; }
      if (t.closest('[data-clear]')) { this.filt = {}; this.changedFilters(); return; }
      const i = this.rowIndex(t);
      if (i >= 0) this.pick(this.rows[i]);
    });
    this.chips.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.st-chip');
      if (!b) return;
      const key = b.dataset.key as FilterKey, value = b.dataset.value!;
      if (this.filt[key] === value) delete this.filt[key];
      else (this.filt as Record<string, string>)[key] = value;
      this.changedFilters(b.dataset.key + ':' + value);
    });
    window.addEventListener('keydown', this.onKey, true);
  }

  get isOpen(): boolean { return this.open_; }

  open(initial?: string): void {
    if (!this.open_) {
      this.open_ = true;
      const a = document.activeElement;
      this.returnFocus = a instanceof HTMLElement && a !== document.body ? a : null;
      clearTimeout(this.hideTimer);
      this.el.hidden = false;
      void this.el.offsetWidth;   // start the transition from the hidden state
      this.el.classList.add('st-open');
      this.hooks.changed(true);
      this.loading ??= this.load();
      this.input.value = initial ?? '';
    } else if (initial !== undefined) this.input.value = initial;
    this.input.focus({ preventScroll: true });
    this.input.select();
    this.changedQuery();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.seq++;
    this.el.classList.remove('st-open');
    this.hideTimer = window.setTimeout(() => { this.el.hidden = true; }, 200);
    clearTimeout(this.statusTimer);
    this.status.textContent = '';
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) back.focus({ preventScroll: true }); else this.input.blur();
    this.hooks.changed(false);
  }

  // ---------- keys ----------

  private onKey = (e: KeyboardEvent) => {
    const k = e.key;
    const cmdK = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === 'k';
    if (!this.open_) {
      const slash = k === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
      if ((!slash && !cmdK) || e.isComposing || e.repeat || isTyping(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      this.open();
      return;
    }
    // while open nothing reaches the app's own shortcuts
    e.stopPropagation();
    if (e.isComposing) return;
    const focus = document.activeElement as HTMLElement | null;
    const onChip = !!focus?.classList.contains('st-chip');
    if (k === 'Escape' || cmdK) { e.preventDefault(); this.close(); return; }
    if (onChip) {
      const all = [...this.chips.querySelectorAll<HTMLElement>('.st-chip')];
      const at = all.indexOf(focus!);
      if (k === 'ArrowRight' || k === 'ArrowLeft') { e.preventDefault(); all[(at + (k === 'ArrowRight' ? 1 : -1) + all.length) % all.length].focus(); }
      else if (k === 'ArrowDown' || k === 'Tab') { e.preventDefault(); this.input.focus(); }
      else if (k.length === 1 && k !== ' ' && !e.metaKey && !e.ctrlKey) this.input.focus();
      return;
    }
    if (focus !== this.input) {
      // the close button: keep Tab inside the palette
      if (k === 'Tab') { e.preventDefault(); this.input.focus(); }
      return;
    }
    const n = this.rows.length;
    if (k === 'ArrowDown') { e.preventDefault(); if (n) this.setActive((this.active + 1) % n, true); }
    else if (k === 'ArrowUp') {
      e.preventDefault();
      const chip = this.active <= 0 && !this.chips.hidden
        ? this.chips.querySelector<HTMLElement>('.st-chip[aria-pressed="true"]') ?? this.chips.querySelector<HTMLElement>('.st-chip') : null;
      if (chip) chip.focus();
      else if (n) this.setActive((this.active - 1 + n) % n, true);
    }
    else if (k === 'Tab') { e.preventDefault(); this.jumpGroup(e.shiftKey ? -1 : 1); }
    else if (k === 'Enter') { e.preventDefault(); const r = this.rows[this.active]; if (r) this.pick(r); }
  };

  private jumpGroup(dir: 1 | -1) {
    const starts = this.rows.map((r, i) => (i === 0 || this.rows[i - 1].group !== r.group ? i : -1)).filter(i => i >= 0);
    if (!starts.length) return;
    let g = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= this.active) g = i;
    this.setActive(starts[(g + dir + starts.length) % starts.length], true);
  }

  private rowIndex(target: EventTarget | null): number {
    const o = (target as HTMLElement | null)?.closest?.<HTMLElement>('.st-opt');
    return o ? Number(o.dataset.i) : -1;
  }

  private setActive(i: number, scroll: boolean) {
    const opts = this.list.querySelectorAll<HTMLElement>('.st-opt');
    opts[this.active]?.setAttribute('aria-selected', 'false');
    this.active = i;
    const o = opts[i];
    if (o) {
      o.setAttribute('aria-selected', 'true');
      this.input.setAttribute('aria-activedescendant', o.id);
      if (scroll) {
        // the first row of a group brings its heading along
        const first = i === 0 || this.rows[i - 1].group !== this.rows[i].group;
        if (i === 0) this.list.scrollTop = 0;
        else (first ? o.parentElement! : o).scrollIntoView({ block: 'nearest' });
        o.scrollIntoView({ block: 'nearest' });
      }
    } else this.input.removeAttribute('aria-activedescendant');
  }

  private pick(row: Row) {
    if (row.fill !== undefined) { this.setQuery(row.fill); return; }
    const q = this.input.value.trim();
    if (q.length >= 2) remember(q);
    this.close();
    row.run?.();
    this.hooks.announce(`Opened ${row.name}`);
  }

  private setQuery(q: string) {
    this.input.value = q;
    this.input.focus({ preventScroll: true });
    this.changedQuery();
  }

  // ---------- searching ----------

  private async load() {
    let index = await fetchJson<NotesIndex>(NOTES_URL);
    if (!index && import.meta.env.DEV) index = await fetchJson<NotesIndex>(FIXTURE_URL);
    if (index && Array.isArray(index.notes)) {
      this.index = index;
      for (const t of index.topics ?? []) this.topicTitle.set(t.id, t.title);
      for (const n of index.notes) {
        this.bySlug.set(n.slug, n);
        this.noteFields.set(n.slug, [field(n.title, 1), field((n.tags ?? []).join(' '), 0.85), field(this.topicTitle.get(n.topic) ?? n.topic ?? '', 0.7),
          field(n.series?.name ?? '', 0.7), field(n.excerpt ?? '', 0.6)]);
      }
    }
    // no notes yet → nothing to index, do not go looking for the bundle
    if (!index || index.notes.length) {
      const got = await loadPagefind();
      if (got) { this.pf = got.pf; this.pfAvailable = got.available; }
    }
    this.loaded = true;
    if (this.open_) this.changedQuery();
  }

  private changedFilters(refocus?: string) {
    this.changedQuery();
    if (refocus) this.chips.querySelector<HTMLElement>(`.st-chip[data-id="${CSS.escape(refocus)}"]`)?.focus();
    else this.input.focus({ preventScroll: true });
  }

  private changedQuery() {
    const q = this.input.value.trim();
    const seq = ++this.seq;
    if (!q) { this.noteHits = []; this.noteMore = 0; this.notesFor = ''; }
    else if (this.loaded) void this.searchNotes(q, seq);
    this.render();
  }

  private noteHit(n: NoteMeta, excerpt: string, title?: string): NoteHit {
    return { slug: n.slug, title: title ?? n.title, excerpt, topic: this.topicTitle.get(n.topic) ?? n.topic, stage: n.stage, lang: n.lang, minutes: n.minutes };
  }

  private passes(meta: { lang?: string; stage?: string; topic?: string }, keys: FilterKey[]): boolean {
    return keys.every(k => !this.filt[k] || meta[k] === this.filt[k]);
  }

  private async searchNotes(q: string, seq: number) {
    const fq = fold(q).trim(), toks = words(fq);
    const hits: NoteHit[] = [];
    const seen = new Set<string>();
    const keys = (Object.keys(this.filt) as FilterKey[]).filter(k => this.filt[k]);

    if (this.pf) {
      // filters the index knows go to Pagefind; the rest are applied here from the notes' metadata
      const viaPf: Record<string, string> = {}, here: FilterKey[] = [];
      for (const k of keys) {
        if (this.pfAvailable[k]?.[this.filt[k]!] !== undefined) viaPf[k] = this.filt[k]!; else here.push(k);
      }
      try {
        const res = await this.pf.debouncedSearch(q, { filters: viaPf }, 150);
        if (!res || seq !== this.seq) return;
        const data = await Promise.all(res.results.slice(0, here.length ? 30 : 16).map(r => r.data()));
        if (seq !== this.seq) return;
        for (const d of data) {
          const m = d.meta ?? {};
          const slug = slugOf(d.url) ?? (d.url.includes('/writing/topic/') ? null : m.slug || null);
          if (!slug || seen.has(slug)) continue;
          const n = this.bySlug.get(slug);
          const plain = n?.excerpt ?? m.excerpt ?? '';
          if (!plausible(d.excerpt ?? '', `${m.title ?? n?.title ?? ''} ${plain}`, toks)) continue;
          const meta = n ?? { lang: m.lang ?? d.filters?.lang?.[0], stage: m.stage ?? d.filters?.stage?.[0], topic: m.topic ?? d.filters?.topic?.[0] };
          if (!this.passes(meta, here)) continue;
          seen.add(slug);
          const excerpt = needsPlainExcerpt(d) && plain ? markUp(plain, toks) : cleanExcerpt(d.excerpt ?? '');
          hits.push(n ? this.noteHit(n, excerpt, m.title)
            : { slug, title: m.title ?? slug, excerpt, topic: m.topicTitle ?? (meta.topic && (this.topicTitle.get(meta.topic) ?? meta.topic)), stage: meta.stage, lang: meta.lang,
              minutes: Number(m.minutes) || undefined });
        }
      } catch { /* a broken index: the metadata below still answers */ }
    }

    // metadata matches: the whole answer without Pagefind, and with it the notes whose title or tags match
    // in a way the full-text index misses (Turkish letters typed plain, a typo)
    if (this.index) {
      const scored: { n: NoteMeta; s: number }[] = [];
      for (const n of this.index.notes) {
        if (seen.has(n.slug) || !this.passes(n, keys)) continue;
        const s = scoreFields(this.noteFields.get(n.slug)!, fq, toks);
        if (s > 0) scored.push({ n, s });
      }
      scored.sort((a, b) => b.s - a.s);
      for (const { n } of scored) hits.push(this.noteHit(n, markUp(n.excerpt ?? '', toks)));
    }
    if (seq !== this.seq) return;
    this.noteMore = Math.max(0, hits.length - NOTE_CAP);
    this.noteHits = hits.slice(0, NOTE_CAP);
    this.notesFor = q;
    this.render();
  }

  private localMatches(q: string): Map<string, { item: SearchItem; s: number }[]> {
    const fq = fold(q).trim(), toks = words(fq);
    const out = new Map<string, { item: SearchItem; s: number }[]>();
    for (const item of this.items()) {
      const s = scoreFields([field(item.title, 1), ...(item.keywords ?? []).map(k => field(k, 0.85)), field(item.detail ?? '', 0.6)], fq, toks);
      if (s <= 0) continue;
      let g = out.get(item.group);
      if (!g) out.set(item.group, g = []);
      g.push({ item, s });
    }
    for (const g of out.values()) g.sort((a, b) => b.s - a.s);
    return out;
  }

  // ---------- rendering ----------

  private render() {
    const q = this.input.value.trim();
    const toks = words(fold(q));
    const rows: Row[] = [];
    let tail = '';
    const itemRow = (item: SearchItem, group: string = item.group): Row => ({
      group, kind: 'item', name: item.title, title: markUp(item.title, toks), detail: item.detail ? markUp(item.detail, toks) : undefined, run: () => item.run(),
    });

    if (!q) {
      let last: { slug: string; title: string } | null = null;
      try { last = this.hooks.lastRead(); } catch { /* none */ }
      if (last) {
        const l = last, n = this.bySlug.get(l.slug);
        rows.push({ group: 'Continue reading', kind: 'note', name: l.title, title: esc(l.title),
          meta: n ? this.metaLine({ topic: this.topicTitle.get(n.topic) ?? n.topic, stage: n.stage, lang: n.lang, minutes: n.minutes }) : undefined,
          run: () => this.hooks.pickNote(l.slug, '') });
      }
      for (const r of recent()) rows.push({ group: 'Recent', kind: 'recent', name: r, title: esc(r), fill: r });
      for (const item of this.items().filter(i => i.group === 'Actions').slice(0, 8)) rows.push(itemRow(item));
      const ex = this.examples();
      if (ex.length) tail = `<p class="st-hint">Try ${ex.map(x => `<button type="button" tabindex="-1" data-fill="${esc(x)}">${esc(x)}</button>`).join(' ')}</p>`;
    } else {
      const local = this.localMatches(q);
      const noteRows: Row[] = this.noteHits.map(h => ({
        group: 'Notes', kind: 'note', name: h.title, title: markUp(h.title, toks), detail: h.excerpt || undefined, meta: this.metaLine(h),
        run: () => this.hooks.pickNote(h.slug, q),
      }));
      const strong = LOCAL_GROUPS.filter(g => (local.get(g)?.[0]?.s ?? 0) >= STRONG);
      const order: string[] = [...strong, 'Notes', ...LOCAL_GROUPS.filter(g => !strong.includes(g))];
      for (const g of order) {
        if (g === 'Notes') rows.push(...noteRows);
        else for (const m of (local.get(g) ?? []).slice(0, CAPS[g as SearchItem['group']])) rows.push(itemRow(m.item));
      }
      if (!rows.length) {
        const pending = !this.loaded || this.notesFor !== q;
        const filtered = Object.values(this.filt).some(Boolean);
        const ex = this.examples();
        tail = pending ? '<p class="st-none st-wait">Listening…</p>'
          : `<div class="st-none"><p>Nothing answers to <q>${esc(q)}</q>${filtered ? ' with these filters' : ''}.</p>`
            + (filtered ? '<p><button type="button" tabindex="-1" class="st-linkish" data-clear>Clear the filters</button></p>'
              : ex.length ? `<p class="st-hint">Try ${ex.map(x => `<button type="button" tabindex="-1" data-fill="${esc(x)}">${esc(x)}</button>`).join(' ')}</p>` : '')
            + '</div>';
      }
    }

    // list
    let html = '', group = '';
    rows.forEach((r, i) => {
      if (r.group !== group) {
        if (group) html += '</div>';
        group = r.group;
        const gid = 'st-g-' + group.toLowerCase().replace(/[^a-z]+/g, '-');
        const more = group === 'Notes' && this.noteMore > 0 ? `<span class="st-more">+${this.noteMore} more, keep typing to narrow</span>` : '';
        html += `<div class="st-group" role="group" aria-labelledby="${gid}"><div class="st-gh" id="${gid}" role="presentation"><span>${esc(group)}</span>${more}</div>`;
      }
      html += `<div class="st-opt st-${r.kind}" id="st-o-${i}" role="option" aria-selected="false" data-i="${i}">`
        + `<span class="st-t">${r.title}</span>`
        + (r.detail ? `<span class="st-d">${r.detail}</span>` : '')
        + (r.meta ? `<span class="st-m">${r.meta}</span>` : '')
        + (r.kind === 'recent' ? '<span class="st-go" aria-hidden="true">↖</span>' : '<span class="st-go" aria-hidden="true">↵</span>')
        + '</div>';
    });
    if (group) html += '</div>';
    this.list.innerHTML = html + tail;
    this.list.classList.toggle('st-stale', !!q && this.loaded && this.notesFor !== q && this.noteHits.length > 0);
    this.rows = rows;
    this.active = 0;
    this.setActive(0, false);
    this.list.scrollTop = 0;
    this.renderChips(q);
    this.say(q, rows);
  }

  private metaLine(h: { topic?: string; stage?: string; lang?: string; minutes?: number }): string {
    const parts: string[] = [];
    if (h.topic) parts.push(`<span class="st-topic">${esc(h.topic)}</span>`);
    if (h.stage) parts.push(`<span class="st-stage st-stage-${esc(h.stage)}">${esc(h.stage)}</span>`);
    if (h.lang) parts.push(`<span class="st-lang" title="${h.lang === 'tr' ? 'Türkçe' : 'English'}">${esc(h.lang.toUpperCase())}</span>`);
    if (h.minutes) parts.push(`<span>${h.minutes} min</span>`);
    return parts.join('');
  }

  private renderChips(q: string) {
    const notes = this.index?.notes ?? [];
    const show = !!q && notes.length > 0;
    this.chips.hidden = !show;
    if (!show) { this.chips.innerHTML = ''; return; }
    const had = (document.activeElement as HTMLElement | null)?.dataset?.id;
    const chip = (key: FilterKey, value: string, label: string, title?: string) =>
      `<button type="button" class="st-chip" tabindex="-1" data-key="${key}" data-value="${esc(value)}" data-id="${esc(key + ':' + value)}"`
      + ` aria-pressed="${this.filt[key] === value}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
    const langs = (['en', 'tr'] as Lang[]).filter(l => notes.some(n => n.lang === l));
    const stages = STAGES.filter(s => notes.some(n => n.stage === s));
    const topics = (this.index?.topics ?? []).filter(t => notes.some(n => n.topic === t.id)).sort((a, b) => a.order - b.order);
    const sets = [
      langs.length > 1 ? langs.map(l => chip('lang', l, l.toUpperCase(), l === 'tr' ? 'Türkçe' : 'English')) : [],
      stages.length > 1 ? stages.map(s => chip('stage', s, cap(s))) : [],
      topics.length > 1 ? topics.map(t => chip('topic', t.id, t.title)) : [],
    ].filter(s => s.length);
    this.chips.hidden = !sets.length;
    this.chips.innerHTML = sets.map(s => `<span class="st-set">${s.join('')}</span>`).join('');
    if (had) this.chips.querySelector<HTMLElement>(`.st-chip[data-id="${CSS.escape(had)}"]`)?.focus();
  }

  /** A few things worth typing, taken from what the box can find. */
  private examples(): string[] {
    const items = this.items();
    const pickOf = (g: SearchItem['group']) => items.find(i => i.group === g)?.title.toLowerCase();
    const tr = this.index?.notes.find(n => n.lang === 'tr');
    const trWord = tr ? words(fold(tr.title)).find(w => w.length > 3) : undefined;
    return [...new Set([pickOf('Topics'), pickOf('Projects'), trWord, pickOf('Actions')].filter((x): x is string => !!x))].slice(0, 4);
  }

  private say(q: string, rows: Row[]) {
    clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      if (!this.open_) return;
      let text: string;
      if (!q) text = rows.length ? `${rows.length} suggestions. Type to search.` : 'Type to search.';
      else if (!rows.length) text = !this.loaded || this.notesFor !== q ? '' : `No results for ${q}.`;
      else {
        const counts = new Map<string, number>();
        for (const r of rows) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);
        text = `${rows.length} ${rows.length === 1 ? 'result' : 'results'}: ` + [...counts].map(([g, c]) => `${c} ${g.toLowerCase()}`).join(', ') + '.';
      }
      if (text) this.status.textContent = text;
    }, 450);
  }
}

function isTyping(target: EventTarget | null): boolean {
  const a = document.activeElement;
  if (a instanceof HTMLIFrameElement) return true;
  for (const el of [target, a]) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    if (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(el.type)) return true;
    if (el.closest?.('[contenteditable=""], [contenteditable="true"], [role="textbox"]')) return true;
  }
  return false;
}

function recent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
function remember(q: string) {
  try {
    const fq = fold(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recent().filter(r => fold(r) !== fq)].slice(0, RECENT_MAX)));
  } catch { /* private window */ }
}
