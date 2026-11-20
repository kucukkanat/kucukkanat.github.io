// The Ship's Index: every note in one filterable, sortable, keyboard-navigable list.
import type { NoteMeta, NotesIndex, Stage } from './types';
import {
  FACETS, LANG_NAME, STAGES, bySlug, escapeHtml as e, facetCounts, facetValues, formatDate, matches, terms, topicById, topics,
  type FacetKey,
} from './store';

export const ICON = {
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  ribbon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M7 3h10v18l-5-4.2L7 21z"/></svg>',
};

const STAGE_ICON: Record<Stage, string> = {
  seedling: '<path d="M8 14V8.5M8 8.5C8 6 6.2 4.4 3.4 4.4c0 2.5 1.8 4.1 4.6 4.1ZM8 10c0-1.9 1.6-3.2 4.6-3.2 0 1.9-1.8 3.2-4.6 3.2Z"/>',
  growing: '<path d="M8 14.5V5M8 6.5C8 4.6 6.8 3.2 4.6 3c0 2 1.2 3.4 3.4 3.5ZM8 9c0-1.8 1.4-3 4-3.1 0 1.8-1.4 3-4 3.1ZM8 12c0-1.7-1.4-2.8-4-2.9 0 1.7 1.4 2.8 4 2.9Z"/>',
  evergreen: '<path d="M8 1.8 4.2 7h1.9L3 11.8h10L9.9 7h1.9L8 1.8ZM8 11.8v2.7"/>',
};
const STAGE_NAME: Record<Stage, string> = { seedling: 'Seedling', growing: 'Growing', evergreen: 'Evergreen' };
const STAGE_HINT: Record<Stage, string> = {
  seedling: 'Seedling: a first rough note',
  growing: 'Growing: taking shape, still changing',
  evergreen: 'Evergreen: settled and kept up to date',
};

export function stageBadge(stage: Stage): string {
  const s = STAGE_NAME[stage] ? stage : 'seedling';
  return `<span class="wr-stage wr-stage-${s}" title="${STAGE_HINT[s]}"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${STAGE_ICON[s]}</svg>${STAGE_NAME[s]}</span>`;
}

export function langBadge(lang: string): string {
  return `<abbr class="wr-lang" title="${e(LANG_NAME[lang] ?? lang)}">${e(lang.toUpperCase())}</abbr>`;
}

/** A note counts as partly read between these marks. */
export const partly = (p: number) => p > 0.03 && p < 0.97;

/** One note as a list row (a link that the Writing root turns into an in-place open). */
export function noteRow(n: NoteMeta, ix: NotesIndex, progress: number, showTopic = true): string {
  const t = showTopic ? topicById(ix, n.topic) : undefined;
  const read = progress >= 0.97 ? '<span class="wr-read">Read</span>'
    : partly(progress) ? `<span class="wr-read">${Math.round(progress * 100)}% read</span>` : '';
  return `<li><a class="wr-row" href="${e(n.url)}" data-note="${e(n.slug)}">
    <span class="wr-row-title" lang="${e(n.lang)}">${e(n.title)}</span>
    <span class="wr-row-excerpt" lang="${e(n.lang)}">${e(n.excerpt)}</span>
    <span class="wr-row-meta">
      ${t ? `<span class="wr-topic"><i style="background:${e(t.colour)}"></i>${e(t.title)}</span>` : ''}
      <time datetime="${e(n.date)}">${e(formatDate(n.date))}</time>
      <span>${n.minutes} min</span>
      ${stageBadge(n.stage)}
      ${langBadge(n.lang)}
      ${read}
    </span>
    ${partly(progress) ? `<span class="wr-row-bar" aria-hidden="true"><i style="width:${Math.round(progress * 100)}%"></i></span>` : ''}
  </a></li>`;
}

export interface IndexHost {
  progress(slug: string): number;
  lastRead(): { slug: string; at: number } | null;
  close(): void;
}

type Sort = 'newest' | 'oldest' | 'title' | 'time';
const SORTS: { id: Sort; label: string; hint: string }[] = [
  { id: 'newest', label: 'Newest', hint: 'Newest first' },
  { id: 'oldest', label: 'Oldest', hint: 'Oldest first' },
  { id: 'title', label: 'Title', hint: 'By title, A to Z' },
  { id: 'time', label: 'Time', hint: 'By reading time, shortest first' },
];
const FACET_NAME: Record<FacetKey, string> = { topic: 'Topic', stage: 'Stage', lang: 'Language', year: 'Year', tag: 'Tag' };
const TAGS_SHOWN = 10;
const collator = new Intl.Collator(['en', 'tr'], { sensitivity: 'base', numeric: true });

export class IndexSheet {
  readonly el: HTMLElement;
  private ix: NotesIndex | null = null;
  private sel = {} as Record<FacetKey, Set<string>>;
  private sort: Sort = 'newest';
  private text = '';
  private allTags = false;
  private input: HTMLInputElement;
  private rows: HTMLElement;
  private scroll: HTMLElement;

  constructor(private host: IndexHost) {
    for (const k of FACETS) this.sel[k] = new Set();
    const el = this.el = document.createElement('section');
    el.className = 'wr-index';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'wr-ix-title');
    el.hidden = true;
    el.innerHTML = `
      <header class="wr-ix-head">
        <div>
          <div class="wr-kicker">Ship’s Index</div>
          <h2 id="wr-ix-title" tabindex="-1">Every note on board</h2>
        </div>
        <button type="button" class="wr-icon wr-close" aria-label="Close the index">${ICON.close}</button>
      </header>
      <div class="wr-ix-tools">
        <label class="wr-filter">${ICON.search}
          <input type="search" placeholder="Filter by title, excerpt or tag" aria-label="Filter notes by title, excerpt or tag" autocomplete="off" spellcheck="false" enterkeyhint="search" />
          <kbd aria-hidden="true">/</kbd>
        </label>
        <div class="wr-sort" role="group" aria-label="Sort">
          ${SORTS.map(s => `<button type="button" data-sort="${s.id}" aria-pressed="${s.id === this.sort}" title="${s.hint}">${s.label}</button>`).join('')}
        </div>
      </div>
      <div class="wr-ix-scroll" tabindex="-1">
        <div class="wr-continue"></div>
        <details class="wr-facets"><summary><span>Filters</span><span class="wr-active"></span></summary><div class="wr-facet-groups"></div></details>
        <p class="wr-result" role="status" aria-live="polite"></p>
        <ol class="wr-rows" aria-label="Notes"></ol>
        <div class="wr-empty" hidden></div>
      </div>`;
    this.input = el.querySelector('input')!;
    this.rows = el.querySelector('.wr-rows')!;
    this.scroll = el.querySelector('.wr-ix-scroll')!;
    (el.querySelector('.wr-facets') as HTMLDetailsElement).open = matchMedia('(min-width: 721px)').matches;
    el.querySelector('.wr-close')!.addEventListener('click', () => host.close());
    this.input.addEventListener('input', () => { this.text = this.input.value; this.render(); });
    el.addEventListener('click', ev => this.onClick(ev));
    el.addEventListener('keydown', ev => this.onKey(ev));
  }

  /** Fill the sheet. `topic` (when given) replaces the filters with that topic; `q` pre-fills the filter box. */
  show(ix: NotesIndex | null, opts: { topic?: string; q?: string } = {}) {
    this.ix = ix;
    if (opts.topic !== undefined) {
      for (const k of FACETS) this.sel[k].clear();
      if (opts.topic && ix && topicById(ix, opts.topic)) this.sel.topic.add(opts.topic);
    }
    if (opts.q !== undefined) this.input.value = this.text = opts.q;
    this.render();
  }

  /** The topic filter, when exactly one is chosen (it goes into the address). */
  get topic(): string | undefined { return this.sel.topic.size === 1 ? [...this.sel.topic][0] : undefined; }

  focus(coarse: boolean) {
    // no on-screen keyboard popping up on phones
    const t = coarse || !this.ix ? this.el.querySelector('h2') as HTMLElement : this.input;
    t.focus({ preventScroll: true });
  }

  private filtered(except?: FacetKey): NoteMeta[] {
    const ts = terms(this.text);
    return (this.ix?.notes ?? []).filter(n => matches(n, ts) && FACETS.every(k =>
      k === except || !this.sel[k].size || facetValues(n, k).some(v => this.sel[k].has(v))));
  }

  private sorted(list: NoteMeta[]): NoteMeta[] {
    const by: Record<Sort, (a: NoteMeta, b: NoteMeta) => number> = {
      newest: (a, b) => b.date.localeCompare(a.date),
      oldest: (a, b) => a.date.localeCompare(b.date),
      title: (a, b) => collator.compare(a.title, b.title),
      time: (a, b) => a.minutes - b.minutes || a.words - b.words,
    };
    return [...list].sort((a, b) => by[this.sort](a, b) || collator.compare(a.title, b.title));
  }

  private facetLabel(key: FacetKey, v: string): string {
    if (key === 'topic') {
      const t = this.ix && topicById(this.ix, v);
      return t ? `<i style="background:${e(t.colour)}"></i>${e(t.title)}` : e(v);
    }
    if (key === 'stage') return e(STAGE_NAME[v as Stage] ?? v);
    if (key === 'lang') return e(LANG_NAME[v] ?? v);
    return e(v);
  }

  private facetOrder(key: FacetKey, total: Map<string, number>): string[] {
    const vals = [...total.keys()];
    switch (key) {
      case 'topic': { const order = topics(this.ix!).map(t => t.id); return vals.sort((a, b) => order.indexOf(a) - order.indexOf(b)); }
      case 'stage': return vals.sort((a, b) => STAGES.indexOf(a as Stage) - STAGES.indexOf(b as Stage));
      case 'lang': return vals.sort();
      case 'year': return vals.sort().reverse();
      case 'tag': return vals.sort((a, b) => total.get(b)! - total.get(a)! || collator.compare(a, b));
    }
  }

  private render() {
    const el = this.el;
    const ix = this.ix;
    const empty = el.querySelector('.wr-empty') as HTMLElement;
    const tools = el.querySelector('.wr-ix-tools') as HTMLElement;
    const facets = el.querySelector('.wr-facets') as HTMLElement;
    const result = el.querySelector('.wr-result') as HTMLElement;
    const cont = el.querySelector('.wr-continue') as HTMLElement;
    tools.hidden = facets.hidden = result.hidden = !ix;
    if (!ix) {
      this.rows.innerHTML = cont.innerHTML = '';
      empty.hidden = false;
      empty.innerHTML = `<div class="wr-empty-mark" aria-hidden="true">❦</div><h3>The shelf is still empty</h3><p>Nothing has been written down yet. Notes will be listed here as soon as the first one is on board.</p>`;
      return;
    }
    for (const b of el.querySelectorAll<HTMLElement>('[data-sort]')) b.setAttribute('aria-pressed', String(b.dataset.sort === this.sort));

    // continue reading
    const last = this.host.lastRead();
    const lastNote = last && bySlug(ix, last.slug);
    cont.innerHTML = lastNote ? `<a class="wr-ribbon" href="${e(lastNote.url)}" data-note="${e(lastNote.slug)}">
        ${ICON.ribbon}<span><small>Continue reading</small><b lang="${e(lastNote.lang)}">${e(lastNote.title)}</b></span>
        <em>${Math.round(this.host.progress(lastNote.slug) * 100)}%</em></a>` : '';

    // facets, each counted with the other facets and the text filter applied
    const totals = facetCounts(ix.notes);
    const focused = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.dataset : null;
    const active = FACETS.reduce((n, k) => n + this.sel[k].size, 0);
    let html = '';
    for (const key of FACETS) {
      const counts = facetCounts(this.filtered(key))[key];
      let vals = this.facetOrder(key, totals[key]);
      if (key !== 'tag' && vals.length < 2 && !this.sel[key].size) continue;
      if (!vals.length) continue;
      let more = '';
      if (key === 'tag' && vals.length > TAGS_SHOWN) {
        const hidden = vals.length - TAGS_SHOWN;
        if (!this.allTags) vals = vals.filter((v, i) => i < TAGS_SHOWN || this.sel.tag.has(v));
        more = `<button type="button" class="wr-more" data-act="tags" aria-expanded="${this.allTags}">${this.allTags ? 'Fewer tags' : `+${hidden} more`}</button>`;
      }
      html += `<div class="wr-facet" role="group" aria-label="${FACET_NAME[key]}"><span class="wr-facet-name" aria-hidden="true">${FACET_NAME[key]}</span><div class="wr-chips">${vals.map(v => {
        const n = counts.get(v) ?? 0, on = this.sel[key].has(v);
        return `<button type="button" class="wr-chip${n || on ? '' : ' wr-zero'}" data-facet="${key}" data-value="${e(v)}" aria-pressed="${on}">${this.facetLabel(key, v)}<span class="wr-n">${n}</span></button>`;
      }).join('')}${more}</div></div>`;
    }
    el.querySelector('.wr-facet-groups')!.innerHTML = html;
    el.querySelector('.wr-active')!.innerHTML = active ? `<b>${active}</b>` : '';

    const list = this.sorted(this.filtered());
    const filteredDown = active > 0 || terms(this.text).length > 0;
    result.innerHTML = `${list.length} ${list.length === 1 ? 'note' : 'notes'}${filteredDown ? ` of ${ix.notes.length} <button type="button" class="wr-more" data-act="clear">Clear filters</button>` : ''}`;
    this.rows.innerHTML = list.map(n => noteRow(n, ix, this.host.progress(n.slug))).join('');
    empty.hidden = list.length > 0;
    if (!list.length) empty.innerHTML = `<h3>Nothing matches</h3><p>No note has all of that. Try fewer filters or a shorter word.</p>`;

    if (focused?.facet) (el.querySelector(`[data-facet="${focused.facet}"][data-value="${CSS.escape(focused.value ?? '')}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
    else if (focused?.act) (el.querySelector(`[data-act="${focused.act}"]`) as HTMLElement | null ?? this.input).focus({ preventScroll: true });
  }

  private onClick(ev: MouseEvent) {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-facet], [data-sort], [data-act]');
    if (!t) return;
    if (t.dataset.facet) {
      const set = this.sel[t.dataset.facet as FacetKey], v = t.dataset.value ?? '';
      if (set.has(v)) set.delete(v); else set.add(v);
    } else if (t.dataset.sort) {
      this.sort = t.dataset.sort as Sort;
      this.scroll.scrollTop = 0;
    } else if (t.dataset.act === 'tags') {
      this.allTags = !this.allTags;
    } else if (t.dataset.act === 'clear') {
      for (const k of FACETS) this.sel[k].clear();
      this.input.value = this.text = '';
    }
    this.render();
  }

  private onKey(ev: KeyboardEvent) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target as HTMLElement;
    const typing = t === this.input;
    const rows = [...this.rows.querySelectorAll<HTMLElement>('.wr-row')];
    const i = rows.indexOf(t);
    const go = (el: HTMLElement | undefined) => {
      if (!el) return;
      ev.preventDefault();
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'nearest' });
    };
    switch (ev.key) {
      case '/':
        if (typing) return;
        ev.preventDefault(); ev.stopPropagation();
        this.input.focus(); this.input.select();
        break;
      case 'Escape':
        if (typing && this.input.value) { ev.stopPropagation(); ev.preventDefault(); this.input.value = this.text = ''; this.render(); }
        break;
      case 'ArrowDown':
        if (typing) go(rows[0]); else if (i >= 0) go(rows[i + 1] ?? rows[i]);
        break;
      case 'ArrowUp':
        if (i === 0) go(this.input); else if (i > 0) go(rows[i - 1]);
        break;
      case 'Home': if (i >= 0) go(rows[0]); break;
      case 'End': if (i >= 0) go(rows[rows.length - 1]); break;
      case 'Enter':
        // Enter in the filter box opens the only (or first) match
        if (typing && rows[0]) { ev.preventDefault(); rows[0].click(); }
        break;
    }
  }
}
