// The Reading Room: a note (or a topic's contents page) laid on the chart table as a parchment page over the dimmed cabin,
// and the single entry point for everything "writing" in the app (reader, topic view, Ship's Index, address, progress).
import './writing.css';
import { reducedMotion } from '../anim';
import type { NoteMeta, NotesIndex, Topic } from './types';
import {
  LANG_NAME, backlinks, bySlug, byTopic, escapeHtml as e, fold, formatDate, getNote, loadIndex, seriesInTopic, seriesPlace, terms,
  topicById, topicNeighbours, topics,
} from './store';
import * as router from './router';
import { ICON, IndexSheet, langBadge, noteRow, partly, stageBadge } from './indexsheet';

export interface WritingHooks {
  /** Something opened or closed: the app dims the cabin, hides its dock, pauses hotspots. */
  changed(open: boolean): void;
  /** A note or topic became current (or null): the app lights that topic's book on the shelf. */
  focusTopic(topicId: string | null): void;
  announce(text: string): void;
}

const KEY = 'kk.read.';
/** p: where the reader stopped (0..1, resumed from); m: the furthest point reached (0..1, the progress); at: when (ms). */
interface Mark { p: number; m: number; at: number; }

function readMark(slug: string): Mark | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + slug) ?? 'null') as Partial<Mark> | null;
    if (!v || typeof v.p !== 'number') return null;
    return { p: v.p, m: typeof v.m === 'number' ? v.m : v.p, at: typeof v.at === 'number' ? v.at : 0 };
  } catch { return null; }
}
function writeMark(slug: string, mark: Mark) {
  try { localStorage.setItem(KEY + slug, JSON.stringify(mark)); } catch { /* private mode, full storage */ }
}

const topicUrl = (id: string) => `/writing/topic/${encodeURIComponent(id)}/`;
const coarse = () => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } };

type Mode = 'note' | 'topic' | 'index' | null;

export class Writing {
  private el: HTMLElement;
  private page: HTMLElement;
  private scroll: HTMLElement;
  private content: HTMLElement;
  private crumb: HTMLElement;
  private fill: HTMLElement;
  private meter: HTMLElement;
  private toast: HTMLElement;
  private sheet: IndexSheet;
  private mode: Mode = null;
  /** The note being read, once its body is on the page. */
  private slug: string | null = null;
  private mark: Mark | null = null;
  private token = 0;
  private returnFocus: HTMLElement | null = null;
  private saveTimer = 0;
  private toastTimer = 0;
  private hideTimer = 0;
  private ticking = false;

  constructor(root: HTMLElement, private hooks: WritingHooks) {
    const el = this.el = document.createElement('div');
    el.className = 'wr';
    el.hidden = true;
    el.innerHTML = `
      <div class="wr-scrim"></div>
      <section class="wr-page" role="dialog" aria-modal="true" aria-labelledby="wr-title" hidden>
        <div class="wr-bar">
          <button type="button" class="wr-tool" data-act="index" aria-label="Ship’s Index: all notes">${ICON.list}<span>Index</span></button>
          <div class="wr-crumb" aria-hidden="true"></div>
          <button type="button" class="wr-icon wr-close" data-act="close" aria-label="Close and return to the cabin">${ICON.close}</button>
          <div class="wr-progress" role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
        </div>
        <div class="wr-scroll" tabindex="-1"><div class="wr-content"></div></div>
        <div class="wr-toast" role="status" hidden></div>
      </section>`;
    this.page = el.querySelector('.wr-page')!;
    this.scroll = el.querySelector('.wr-scroll')!;
    this.content = el.querySelector('.wr-content')!;
    this.crumb = el.querySelector('.wr-crumb')!;
    this.meter = el.querySelector('.wr-progress')!;
    this.fill = this.meter.querySelector('i')!;
    this.toast = el.querySelector('.wr-toast')!;
    this.sheet = new IndexSheet({
      progress: slug => this.progress(slug),
      lastRead: () => this.lastRead(),
      close: () => this.close(),
    });
    el.appendChild(this.sheet.el);
    root.appendChild(el);

    el.addEventListener('click', ev => this.onClick(ev));
    this.scroll.addEventListener('scroll', () => {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => { this.ticking = false; this.onScroll(); });
    }, { passive: true });
    addEventListener('keydown', this.onKey, true);
    addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
    router.onPop(route => { void this.apply(route, false); });
  }

  get isOpen(): boolean { return this.mode !== null; }

  /** For the shelf: notes metadata once loaded (null when there are none). */
  index(): Promise<NotesIndex | null> { return loadIndex(); }

  /** How far a note has been read, 0..1 (the furthest point reached). */
  progress(slug: string): number { return readMark(slug)?.m ?? 0; }

  /** The most recently read note that is neither untouched nor finished. */
  lastRead(): { slug: string; at: number } | null {
    let best: { slug: string; at: number } | null = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(KEY)) continue;
        const slug = k.slice(KEY.length);
        const m = readMark(slug);
        if (m && partly(m.m) && (!best || m.at > best.at)) best = { slug, at: m.at };
      }
    } catch { /* no storage */ }
    return best;
  }

  async openFromUrl(): Promise<boolean> {
    const route = router.current();
    if (!route) return false;
    // a note or topic address means nothing while there are no notes; the index has an empty state of its own
    if (route.kind !== 'index' && !(await loadIndex())) return false;
    await this.apply(route, false);
    return this.isOpen;
  }

  private async apply(route: router.Route | null, push: boolean) {
    if (!route) this.shut(false);
    else if (route.kind === 'note') await this.openNote(route.slug, { q: route.q, push });
    else if (route.kind === 'topic') await this.openTopic(route.id, { push });
    else await this.openIndex({ topic: route.topic ?? '', q: route.q, push });
  }

  // ---------- note ----------
  async openNote(slug: string, opts: { q?: string; push?: boolean } = {}): Promise<void> {
    const token = this.begin('note');
    if (opts.push !== false) router.push({ kind: 'note', slug, q: opts.q });
    const ix = await loadIndex();
    if (token !== this.token) return;
    const note = ix && bySlug(ix, slug);
    if (!ix || !note) {
      this.missing('This note is not on board', 'It may have been renamed or not written yet.');
      return;
    }
    const topic = topicById(ix, note.topic);
    router.setTitle(note.title);
    this.hooks.focusTopic(topic?.id ?? null);
    this.hooks.announce(`Reading: ${note.title}`);
    this.crumb.textContent = note.title;
    this.content.innerHTML = this.noteHTML(ix, note, topic);
    this.scroll.scrollTop = 0;
    this.onScroll();
    this.focusTitle();

    const body = await getNote(slug);
    if (token !== this.token) return;
    const prose = this.content.querySelector('.wr-prose') as HTMLElement;
    if (!body) {
      prose.innerHTML = `<p class="wr-note-error">The text of this note could not be loaded. <a href="${e(note.url)}">Open the plain page</a> instead.</p>`;
      return;
    }
    prose.innerHTML = body.html;
    prose.removeAttribute('aria-busy');
    for (const a of prose.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const h = a.getAttribute('href')!;
      if (/^(https?:)?\/\//.test(h) && !a.dataset.note) { a.target = '_blank'; a.rel = 'noopener'; }
    }
    for (const t of prose.querySelectorAll('table')) {
      // wide tables scroll sideways inside the column instead of stretching the page (the build wraps them in div.table already)
      if (t.parentElement?.classList.contains('table')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'wr-table';
      t.replaceWith(wrap);
      wrap.appendChild(t);
    }
    const toc = body.toc?.filter(h => h.level === 2 || h.level === 3) ?? [];
    if (toc.length >= 3) {
      prose.insertAdjacentHTML('beforebegin', `<details class="wr-toc"><summary>Contents</summary><ol>${toc.map(h =>
        `<li class="wr-toc-${h.level}"><a href="#${e(h.id)}">${e(h.text)}</a></li>`).join('')}</ol></details>`);
    }

    this.slug = slug;
    const old = readMark(slug);
    this.mark = { p: old?.p ?? 0, m: old?.m ?? 0, at: Date.now() };
    const hits = opts.q ? this.highlight(prose, opts.q) : [];
    // one frame so the column has its height
    await new Promise(r => requestAnimationFrame(r));
    if (token !== this.token) return;
    const max = this.scroll.scrollHeight - this.scroll.clientHeight;
    if (hits.length) {
      this.scrollToEl(hits[0], false);
      this.say(`${hits.length} ${hits.length === 1 ? 'match' : 'matches'} for “${e(opts.q!.trim())}”`, 'Clear', 'clear-hits', 0);
    } else if (old && partly(old.p) && max > 40) {
      this.scroll.scrollTop = old.p * max;
      this.say('Picked up where you left off', 'Start from the top', 'top', 6000);
    }
    this.onScroll();
  }

  private noteHTML(ix: NotesIndex, n: NoteMeta, topic: Topic | undefined): string {
    const place = seriesPlace(ix, n.slug);
    const back = backlinks(ix, n.slug);
    const { older, newer } = topicNeighbours(ix, n.slug);
    const link = (m: NoteMeta, label: string, cls: string) => `<a class="wr-step ${cls}" href="${e(m.url)}" data-note="${e(m.slug)}">
      <small>${label}</small><b lang="${e(m.lang)}">${e(m.title)}</b></a>`;
    const series = place ? `<aside class="wr-series" aria-label="Series: ${e(place.series.name)}">
        <div class="wr-series-head"><span class="wr-kicker">Series</span><b>${e(place.series.name)}</b><span class="wr-part">Part ${place.position} of ${place.notes.length}</span></div>
        <ol>${place.notes.map(m => m.slug === n.slug
          ? `<li aria-current="true"><span lang="${e(m.lang)}">${e(m.title)}</span></li>`
          : `<li><a href="${e(m.url)}" data-note="${e(m.slug)}" lang="${e(m.lang)}">${e(m.title)}</a></li>`).join('')}</ol>
      </aside>` : '';
    return `
      <article class="wr-article" lang="${e(n.lang)}">
        <header class="wr-head">
          ${topic ? `<a class="wr-topic wr-topic-link" href="${topicUrl(topic.id)}" data-topic="${e(topic.id)}" lang="en"><i style="background:${e(topic.colour)}"></i>${e(topic.title)}</a>` : ''}
          <h1 id="wr-title" tabindex="-1">${e(n.title)}</h1>
          <div class="wr-meta" lang="en">
            <time datetime="${e(n.date)}">${e(formatDate(n.date))}</time>
            ${n.updated && n.updated !== n.date ? `<span>Updated <time datetime="${e(n.updated)}">${e(formatDate(n.updated))}</time></span>` : ''}
            <span>${n.minutes} min read</span>
            ${stageBadge(n.stage)}
            <span class="wr-langname">${langBadge(n.lang)} ${e(LANG_NAME[n.lang] ?? n.lang)}</span>
          </div>
        </header>
        ${series}
        <div class="wr-prose" aria-busy="true"><p class="wr-loading" lang="en">Unrolling the page…</p></div>
      </article>
      <footer class="wr-foot">
        ${place && (place.prev || place.next) ? `<nav class="wr-steps" aria-label="Series: ${e(place.series.name)}">
          ${place.prev ? link(place.prev, `${ICON.prev} Previous in the series`, 'wr-step-prev') : '<span></span>'}
          ${place.next ? link(place.next, `Next in the series ${ICON.next}`, 'wr-step-next') : '<span></span>'}</nav>` : ''}
        ${back.length ? `<section class="wr-backlinks" aria-labelledby="wr-back-title">
          <h2 id="wr-back-title">Linked from</h2>
          <ul>${back.map(m => `<li><a href="${e(m.url)}" data-note="${e(m.slug)}"><b lang="${e(m.lang)}">${e(m.title)}</b><span lang="${e(m.lang)}">${e(m.excerpt)}</span></a></li>`).join('')}</ul>
        </section>` : ''}
        ${older || newer ? `<nav class="wr-steps" aria-label="More in ${e(topic?.title ?? 'this topic')}">
          ${older ? link(older, `${ICON.prev} Earlier in ${e(topic?.title ?? 'this topic')}`, 'wr-step-prev') : '<span></span>'}
          ${newer ? link(newer, `Later in ${e(topic?.title ?? 'this topic')} ${ICON.next}`, 'wr-step-next') : '<span></span>'}</nav>` : ''}
        <p class="wr-plain"><a href="${e(n.url)}">Plain page for this note</a><span aria-hidden="true"> · </span><button type="button" class="wr-linkish" data-act="index">All notes</button></p>
      </footer>`;
  }

  // ---------- topic ----------
  async openTopic(id: string, opts: { push?: boolean } = {}): Promise<void> {
    const token = this.begin('topic');
    if (opts.push !== false) router.push({ kind: 'topic', id });
    const ix = await loadIndex();
    if (token !== this.token) return;
    const topic = ix && topicById(ix, id);
    if (!ix || !topic) {
      this.missing('This volume is not on the shelf', 'There is no topic with that name.');
      return;
    }
    const notes = byTopic(ix, id);
    const series = seriesInTopic(ix, id);
    const others = topics(ix).filter(t => t.id !== id);
    const resume = notes.filter(n => partly(this.progress(n.slug)))
      .sort((a, b) => (readMark(b.slug)?.at ?? 0) - (readMark(a.slug)?.at ?? 0))[0];
    router.setTitle(topic.title);
    this.hooks.focusTopic(topic.id);
    this.hooks.announce(`${topic.title}: ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`);
    this.crumb.textContent = topic.title;
    this.content.innerHTML = `
      <div class="wr-topicview">
        <header class="wr-head">
          <div class="wr-topic"><i style="background:${e(topic.colour)}"></i>Volume · ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}</div>
          <h1 id="wr-title" tabindex="-1">${e(topic.title)}</h1>
          ${topic.blurb ? `<p class="wr-blurb">${e(topic.blurb)}</p>` : ''}
          ${resume ? `<a class="wr-ribbon" href="${e(resume.url)}" data-note="${e(resume.slug)}">${ICON.ribbon}
            <span><small>Continue reading</small><b lang="${e(resume.lang)}">${e(resume.title)}</b></span><em>${Math.round(this.progress(resume.slug) * 100)}%</em></a>` : ''}
        </header>
        ${series.map(s => `<section class="wr-series wr-series-block" aria-label="Series: ${e(s.series.name)}">
          <div class="wr-series-head"><span class="wr-kicker">Series</span><b>${e(s.series.name)}</b><span class="wr-part">${s.notes.length} parts</span></div>
          <ol>${s.notes.map(m => `<li><a href="${e(m.url)}" data-note="${e(m.slug)}" lang="${e(m.lang)}">${e(m.title)}</a>${this.progress(m.slug) >= 0.97 ? ' <span class="wr-read">Read</span>' : ''}</li>`).join('')}</ol>
        </section>`).join('')}
        <section aria-labelledby="wr-notes-title">
          <h2 class="wr-h" id="wr-notes-title">Notes, newest first</h2>
          ${notes.length ? `<ol class="wr-rows">${notes.map(n => noteRow(n, ix, this.progress(n.slug), false)).join('')}</ol>`
            : '<p class="wr-blurb">Nothing in this volume yet.</p>'}
        </section>
        <footer class="wr-foot">
          ${others.length ? `<nav class="wr-volumes" aria-label="Other volumes"><span class="wr-kicker">Other volumes</span>
            ${others.map(t => `<a class="wr-chip" href="${topicUrl(t.id)}" data-topic="${e(t.id)}"><i style="background:${e(t.colour)}"></i>${e(t.title)}<span class="wr-n">${t.notes.length}</span></a>`).join('')}</nav>` : ''}
          <p class="wr-plain"><a href="${topicUrl(topic.id)}">Plain page for this volume</a><span aria-hidden="true"> · </span><button type="button" class="wr-linkish" data-act="index-topic" data-id="${e(topic.id)}">Filter these in the Index</button></p>
        </footer>
      </div>`;
    this.scroll.scrollTop = 0;
    this.onScroll();
    this.focusTitle();
  }

  // ---------- index ----------
  /** `topic` pre-selects that topic's filter ('' clears the filters); `q` pre-fills the filter box. */
  async openIndex(opts: { topic?: string; q?: string; push?: boolean } = {}): Promise<void> {
    const token = this.begin('index');
    if (opts.push !== false) router.push({ kind: 'index', topic: opts.topic || undefined, q: opts.q });
    const ix = await loadIndex();
    if (token !== this.token) return;
    this.sheet.show(ix, { topic: opts.topic, q: opts.q });
    router.setTitle('Ship’s Index');
    this.hooks.focusTopic(null);
    this.hooks.announce(ix ? `Ship’s Index: ${ix.notes.length} notes` : 'Ship’s Index: no notes yet');
    this.sheet.focus(coarse());
  }

  close(): void { this.shut(true); }

  // ---------- plumbing ----------
  /** Switch surface; returns the token that later async steps check to see they are still current. */
  private begin(mode: Exclude<Mode, null>): number {
    this.save();
    this.slug = null; this.mark = null;
    this.hideToast();
    const was = this.mode;
    this.mode = mode;
    clearTimeout(this.hideTimer);
    if (!was) {
      const a = document.activeElement;
      this.returnFocus = a instanceof HTMLElement && a !== document.body ? a : null;
      this.el.hidden = false;
      this.hooks.changed(true);
    }
    const reading = mode !== 'index';
    this.page.hidden = !reading;
    this.sheet.el.hidden = reading;
    this.meter.hidden = mode !== 'note';
    this.el.dataset.mode = mode;
    if (reading && was !== mode) this.content.innerHTML = '';
    // next frame, so the opening transition runs from the hidden state
    void this.el.offsetWidth;
    this.el.classList.add('wr-on');
    return ++this.token;
  }

  private shut(push: boolean) {
    if (!this.mode) return;
    this.save();
    this.token++;
    this.mode = null; this.slug = null; this.mark = null;
    this.hideToast();
    if (push) router.push(null);
    router.setTitle(null);
    const el = this.el;
    el.classList.remove('wr-on');
    clearTimeout(this.hideTimer);
    const hide = () => { if (!this.mode) { el.hidden = true; this.content.innerHTML = ''; } };
    if (reducedMotion) hide(); else this.hideTimer = window.setTimeout(hide, 280);
    const rf = this.returnFocus;
    this.returnFocus = null;
    if (rf?.isConnected) rf.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) document.activeElement.blur();
    this.hooks.focusTopic(null);
    this.hooks.changed(false);
  }

  private missing(title: string, text: string) {
    router.setTitle(title);
    this.hooks.focusTopic(null);
    this.hooks.announce(title);
    this.crumb.textContent = '';
    this.content.innerHTML = `<div class="wr-missing"><div class="wr-empty-mark" aria-hidden="true">❦</div>
      <h1 id="wr-title" tabindex="-1">${e(title)}</h1><p>${e(text)}</p>
      <p><button type="button" class="wr-btn" data-act="index">Browse the Ship’s Index</button></p></div>`;
    this.meter.hidden = true;
    this.focusTitle();
  }

  private focusTitle() {
    (this.content.querySelector('#wr-title') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  private onScroll() {
    const s = this.scroll;
    const max = s.scrollHeight - s.clientHeight;
    const p = max > 4 ? Math.min(1, Math.max(0, s.scrollTop / max)) : 1;
    this.page.classList.toggle('wr-scrolled', s.scrollTop > 120);
    if (this.mode !== 'note') return;
    const shown = this.slug ? p : 0;
    this.fill.style.transform = `scaleX(${shown})`;
    this.meter.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
    if (!this.slug || !this.mark) return;
    this.mark.p = p;
    this.mark.m = Math.max(this.mark.m, p);
    this.mark.at = Date.now();
    if (!this.saveTimer) this.saveTimer = window.setTimeout(() => this.save(), 500);
  }

  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    if (this.slug && this.mark) writeMark(this.slug, this.mark);
  }

  /** Wrap the words of the body that start with one of the query's words in <mark>; returns the marks in order. */
  private highlight(root: HTMLElement, q: string): HTMLElement[] {
    const ts = terms(q);
    if (!ts.length) return [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
    const out: HTMLElement[] = [];
    const word = /[\p{L}\p{N}]+/gu;
    for (const node of nodes) {
      const text = node.data;
      let frag: DocumentFragment | null = null, last = 0;
      for (const m of text.matchAll(word)) {
        const w = fold(m[0]);
        if (!ts.some(t => w.startsWith(t) || (t.length > 3 && w.includes(t)))) continue;
        frag ??= document.createDocumentFragment();
        frag.append(text.slice(last, m.index));
        const mark = document.createElement('mark');
        mark.className = 'wr-hit';
        mark.textContent = m[0];
        frag.append(mark);
        out.push(mark);
        last = m.index! + m[0].length;
      }
      if (frag) { frag.append(text.slice(last)); node.replaceWith(frag); }
    }
    return out;
  }

  private clearHits() {
    for (const m of this.content.querySelectorAll('mark.wr-hit')) {
      const p = m.parentNode!;
      m.replaceWith(document.createTextNode(m.textContent ?? ''));
      p.normalize();
    }
    const r = router.current();
    if (r?.kind === 'note' && r.q) router.replace({ kind: 'note', slug: r.slug });
  }

  private scrollToEl(target: Element, smooth = true) {
    const s = this.scroll;
    const top = target.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - Math.min(160, s.clientHeight / 4);
    s.scrollTo({ top: Math.max(0, top), behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
  }

  private say(html: string, action: string, act: string, ms: number) {
    clearTimeout(this.toastTimer);
    this.toast.innerHTML = `<span>${html}</span><button type="button" data-act="${act}">${action}</button>`;
    this.toast.hidden = false;
    if (ms) this.toastTimer = window.setTimeout(() => this.hideToast(), ms);
  }
  private hideToast() {
    clearTimeout(this.toastTimer);
    this.toast.hidden = true;
  }

  private onClick(ev: MouseEvent) {
    const t = ev.target as HTMLElement;
    if (t.classList.contains('wr-scrim')) { this.close(); return; }
    const act = t.closest<HTMLElement>('[data-act]');
    if (act && this.el.contains(act)) {
      switch (act.dataset.act) {
        case 'close': this.close(); return;
        case 'index': void this.openIndex(); return;
        case 'index-topic': void this.openIndex({ topic: act.dataset.id }); return;
        case 'top': this.hideToast(); this.scroll.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' }); return;
        case 'clear-hits': this.hideToast(); this.clearHits(); return;
      }
    }
    const a = t.closest('a');
    if (!a || !this.el.contains(a)) return;
    // new tab / new window / download: the plain page is the link's real target
    if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    if (a.dataset.note) { ev.preventDefault(); void this.openNote(a.dataset.note); return; }
    if (a.dataset.topic) { ev.preventDefault(); void this.openTopic(a.dataset.topic); return; }
    const h = a.getAttribute('href') ?? '';
    if (h.startsWith('#') && h.length > 1) {
      // headings and footnotes: scroll the page, leave the address alone
      ev.preventDefault();
      let target: Element | null = null;
      try { target = this.content.querySelector(`#${CSS.escape(decodeURIComponent(h.slice(1)))}`); } catch { /* odd id */ }
      if (target) {
        this.scrollToEl(target);
        if (target instanceof HTMLElement) { if (!target.hasAttribute('tabindex')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
      }
    }
  }

  private onKey = (ev: KeyboardEvent) => {
    if (!this.mode) return;
    const t = ev.target as HTMLElement;
    const inside = this.el.contains(t);
    const loose = t === document.body || t === document.documentElement || t instanceof HTMLCanvasElement;
    if (!inside && !loose) return; // something else is on top (the search palette, say)
    const surface = this.mode === 'index' ? this.sheet.el : this.page;
    if (ev.key === 'Escape') {
      if (t instanceof HTMLInputElement && t.value) return; // the filter box clears itself first
      ev.preventDefault(); ev.stopPropagation();
      this.close();
      return;
    }
    if (ev.key === 'Tab') {
      const items = [...surface.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, summary, [tabindex="0"]')]
        .filter(x => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const a = document.activeElement;
      if (loose || !surface.contains(a)) { ev.preventDefault(); first.focus(); }
      else if (ev.shiftKey && (a === first || !items.includes(a as HTMLElement) && a === surface.querySelector('#wr-title, h2'))) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && a === last) { ev.preventDefault(); first.focus(); }
      return;
    }
    if (loose && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key !== '/') {
      // focus fell out of the dialog (a click on the scrim's edge): take it back so the cabin does not react
      ev.stopPropagation();
      (this.mode === 'index' ? this.sheet.el.querySelector<HTMLElement>('.wr-ix-scroll') : this.scroll)?.focus({ preventScroll: true });
    }
  };
}
