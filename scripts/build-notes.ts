// The notes build ("digital garden"). Contract: src/writing/types.ts.
//   content/notes/**/<slug>.md + content/topics/<id>.md  →
//   <out>/notes.json, <out>/notes/<slug>.json            data for the 3D app
//   <out>/writing/…/index.html                           plain, crawlable reading pages
//   <out>/pagefind/                                      search index over the note pages
// <out> is dist/ by default (run after `vite build`) and public/ in dev: PLAIN_OUT=public, as in build-plain.ts.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { parse } from 'yaml';
import { Marked, type Tokens } from 'marked';
import markedFootnote from 'marked-footnote';
import type { Lang, NoteBody, NoteMeta, NotesIndex, Series, Stage, Topic } from '../src/writing/types';

const SITE = 'https://kucukkanat.com';
const root = join(import.meta.dir, '..');
const STAGES: Stage[] = ['seedling', 'growing', 'evergreen'];
const LANGS: Lang[] = ['en', 'tr'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(['topic', 'index']);   // /writing/topic/<id>/ lives next to the notes
const WPM = 220;

// ---------- small helpers ----------
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (html: string) => unesc(html.replace(/<\/?(?:a|em|strong|code|span|del|b|i)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Lower-case and fold Turkish and other accented letters to ASCII (ı→i, İ→i, ğ→g, ş→s, ç→c, ö→o, ü→u). */
export const fold = (s: string) => s.replace(/İ/g, 'i').replace(/I/g, 'i').replace(/ı/g, 'i').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');
const slugify = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const isoDate = (v: unknown) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
const safeUrl = (href: string) => /^(https?:|mailto:|\/|#|\.\.?\/)/i.test(href.trim()) || !/^[a-z][a-z0-9+.-]*:/i.test(href.trim());

function frontmatter(file: string): { fm: any; body: string } | null {
  const m = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return m ? { fm: parse(m[1]) ?? {}, body: m[2] ?? '' } : null;
}
function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return mdFiles(p);
    return f.endsWith('.md') && !f.startsWith('_') ? [p] : [];
  });
}

// ---------- Markdown ----------
type Resolve = (target: string) => { slug: string; title: string } | undefined;

function render(src: string, resolveLink: Resolve): { html: string; toc: NoteBody['toc']; links: string[]; missing: string[] } {
  const toc: NoteBody['toc'] = [];
  const links: string[] = [];
  const missing: string[] = [];
  const used = new Map<string, number>();
  // A note has no <h1> of its own (the page supplies it): if the author used "#", push every heading down one level.
  const shift = new Marked().lexer(src).some(t => t.type === 'heading' && t.depth === 1) ? 1 : 0;

  const md = new Marked({ gfm: true });
  md.use(markedFootnote({ description: 'Footnotes' }));
  md.use({
    extensions: [{
      name: 'wikilink', level: 'inline',
      start: (s: string) => s.indexOf('[['),
      tokenizer(s: string) {
        const m = /^\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]+))?\]\]/.exec(s);
        return m ? { type: 'wikilink', raw: m[0], target: m[1].trim(), label: m[2]?.trim() } : undefined;
      },
      renderer(t: any) {
        const hit = resolveLink(t.target);
        if (!hit) { missing.push(t.target); return `<span class="wikilink missing" title="Not written yet">${esc(t.label ?? t.target)}</span>`; }
        if (!links.includes(hit.slug)) links.push(hit.slug);
        return `<a class="wikilink" href="/writing/${hit.slug}/" data-note="${hit.slug}">${esc(t.label ?? hit.title)}</a>`;
      },
    }],
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const level = Math.min(6, depth + shift);
        const base = slugify(text(inner)) || 'section';
        const n = (used.get(base) ?? 0) + 1;
        used.set(base, n);
        const id = n === 1 ? base : `${base}-${n}`;
        if (level === 2 || level === 3) toc.push({ id, text: text(inner), level });
        return `<h${level} id="${id}">${inner}</h${level}>\n`;
      },
      // Raw HTML in a note is shown as text, never passed through.
      html({ text: raw }: Tokens.HTML | Tokens.Tag) { return esc(raw); },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        if (!safeUrl(href)) return inner;
        const ext = /^https?:/i.test(href) ? ' rel="noopener"' : '';
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${ext}>${inner}</a>`;
      },
      image({ href, title, text: alt }: Tokens.Image) {
        if (!safeUrl(href)) return esc(alt);
        return `<img src="${esc(href)}" alt="${esc(alt)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy" decoding="async">`;
      },
      table(t: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: string) =>
          `<${tag}${c.align ? ` style="text-align:${c.align}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        return `<div class="table"><table><thead><tr>${t.header.map(c => cell(c, 'th')).join('')}</tr></thead><tbody>${
          t.rows.map(r => `<tr>${r.map(c => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table></div>\n`;
      },
    },
  });
  const html = (md.parse(src, { async: false }) as string).trim();
  // Belt and braces: nothing above can emit these, so finding one is a bug worth stopping for.
  if (/<\s*(script|iframe|object|embed|style)\b/i.test(html) || /<[^>]+\son[a-z]+\s*=/i.test(html) || /(href|src)="\s*javascript:/i.test(html))
    throw new Error('sanitiser: unsafe HTML in rendered note');
  return { html, toc, links, missing };
}

// ---------- load + validate ----------
export interface Notes { index: NotesIndex; bodies: Map<string, NoteBody>; warnings: string[] }

export function loadNotes(): Notes {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rel = (f: string) => relative(root, f);

  const topics: Topic[] = [];
  for (const f of mdFiles(join(root, 'content', 'topics'))) {
    const id = basename(f, '.md');
    const parsed = frontmatter(f);
    if (!parsed) { errors.push(`${rel(f)}: missing frontmatter`); continue; }
    const { fm, body } = parsed;
    if (!SLUG.test(id)) errors.push(`${rel(f)}: topic id must be lower-case ASCII with dashes`);
    if (topics.some(t => t.id === id)) errors.push(`${rel(f)}: duplicate topic id "${id}"`);
    if (!fm.title) errors.push(`${rel(f)}: title is required`);
    if (!/^#[0-9a-f]{6}$/i.test(fm.colour ?? '')) errors.push(`${rel(f)}: colour must be #rrggbb`);
    if (typeof fm.order !== 'number') errors.push(`${rel(f)}: order (a number) is required`);
    const blurb = text(new Marked().parse(body, { async: false }) as string);
    topics.push({ id, title: String(fm.title ?? id), colour: String(fm.colour ?? '#8a6a4f'), blurb, order: fm.order ?? 0, notes: [] });
  }
  topics.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const raw: { meta: NoteMeta; src: string; file: string; hasExcerpt: boolean }[] = [];
  for (const f of mdFiles(join(root, 'content', 'notes'))) {
    const slug = basename(f, '.md');
    const parsed = frontmatter(f);
    if (!parsed) { errors.push(`${rel(f)}: missing frontmatter`); continue; }
    const { fm, body } = parsed;
    const err = (m: string) => errors.push(`${rel(f)}: ${m}`);
    if (!SLUG.test(slug)) err('slug (the file name) must be lower-case ASCII letters, digits and dashes');
    if (RESERVED.has(slug)) err(`"${slug}" is a reserved name`);
    const dup = raw.find(r => r.meta.slug === slug);
    if (dup) err(`duplicate slug "${slug}" (also ${rel(dup.file)})`);
    if (!fm.title) err('title is required');
    const date = isoDate(fm.date), updated = fm.updated != null ? isoDate(fm.updated) : undefined;
    if (!DATE.test(date)) err('date is required (YYYY-MM-DD)');
    if (updated && !DATE.test(updated)) err('updated must be YYYY-MM-DD');
    if (!fm.topic) err('topic is required');
    else if (!topics.some(t => t.id === fm.topic)) err(`unknown topic "${fm.topic}" (no content/topics/${fm.topic}.md)`);
    if (!STAGES.includes(fm.stage)) err(`stage must be one of ${STAGES.join(', ')}`);
    if (!LANGS.includes(fm.lang)) err(`lang must be one of ${LANGS.join(', ')}`);
    if (fm.tags != null && !Array.isArray(fm.tags)) err('tags must be a list');
    let series: NoteMeta['series'];
    if (fm.series != null) {
      const s = fm.series;
      if (typeof s !== 'object' || !s.name || typeof s.order !== 'number') err('series needs { name, order } (id is optional)');
      else {
        const id = String(s.id ?? slugify(s.name));
        if (!SLUG.test(id)) err('series id must be lower-case ASCII with dashes');
        series = { id, name: String(s.name), order: s.order };
      }
    }
    raw.push({
      file: f, src: body, hasExcerpt: !!fm.excerpt,
      meta: {
        slug, title: String(fm.title ?? slug), lang: fm.lang, date, ...(updated ? { updated } : {}),
        topic: String(fm.topic ?? ''), tags: (Array.isArray(fm.tags) ? fm.tags : []).map(String), stage: fm.stage,
        ...(series ? { series } : {}),
        excerpt: String(fm.excerpt ?? '').replace(/\s+/g, ' ').trim(), words: 0, minutes: 1, links: [], backlinks: [], url: `/writing/${slug}/`,
      },
    });
  }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

  // [[slug]], [[SLUG]] or [[Note Title]] (case-insensitive, Turkish letters folded)
  const bySlug = new Map(raw.map(r => [r.meta.slug, r.meta]));
  const byTitle = new Map<string, NoteMeta>();
  for (const r of raw) {
    const k = fold(r.meta.title);
    if (byTitle.has(k)) warnings.push(`${rel(r.file)}: title "${r.meta.title}" is also used by ${byTitle.get(k)!.slug}; [[title]] links go to the first`);
    else byTitle.set(k, r.meta);
  }
  const resolveLink: Resolve = target => bySlug.get(target) ?? bySlug.get(target.toLowerCase()) ?? byTitle.get(fold(target));

  const bodies = new Map<string, NoteBody>();
  for (const r of raw) {
    const out = render(r.src, resolveLink);
    const plain = text(out.html);
    r.meta.words = plain ? plain.split(' ').length : 0;
    r.meta.minutes = Math.max(1, Math.round(r.meta.words / WPM));
    r.meta.links = out.links.filter(s => s !== r.meta.slug);
    if (!r.hasExcerpt) {
      warnings.push(`${rel(r.file)}: no excerpt, using the first paragraph`);
      const first = text(/<p>([\s\S]*?)<\/p>/.exec(out.html)?.[1] ?? '');
      const two = first.match(/^.*?[.!?…](?:\s+.*?[.!?…])?(?=\s|$)/)?.[0] ?? first;
      r.meta.excerpt = two.length > 260 ? two.slice(0, 257).replace(/\s+\S*$/, '') + '…' : two;
    }
    for (const m of out.missing) warnings.push(`${rel(r.file)}: broken link [[${m}]]`);
    bodies.set(r.meta.slug, { slug: r.meta.slug, html: out.html, toc: out.toc });
  }
  for (const r of raw) for (const to of r.meta.links) bySlug.get(to)!.backlinks.push(r.meta.slug);

  const notes = raw.map(r => r.meta).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  for (const n of notes) n.backlinks.sort((a, b) => notes.findIndex(x => x.slug === a) - notes.findIndex(x => x.slug === b));
  for (const t of topics) t.notes = notes.filter(n => n.topic === t.id).map(n => n.slug);

  const series: Series[] = [];
  for (const n of notes) if (n.series) {
    let s = series.find(x => x.id === n.series!.id);
    if (!s) series.push(s = { id: n.series.id, name: n.series.name, notes: [] });
    else if (s.name !== n.series.name) warnings.push(`series "${s.id}": two names ("${s.name}" and "${n.series.name}")`);
    s.notes.push(n.slug);
  }
  for (const s of series) {
    const order = (slug: string) => bySlug.get(slug)!.series!.order;
    s.notes.sort((a, b) => order(a) - order(b) || bySlug.get(a)!.date.localeCompare(bySlug.get(b)!.date));
    const seen = new Set<number>();
    for (const slug of s.notes) {
      if (seen.has(order(slug))) warnings.push(`series "${s.id}": order ${order(slug)} is used more than once (${slug})`);
      seen.add(order(slug));
    }
  }
  series.sort((a, b) => a.id.localeCompare(b.id));
  return { index: { generated: new Date().toISOString(), topics, notes, series }, bodies, warnings };
}

// ---------- static pages ----------
const T = {
  en: { writing: 'Writing', cabin: 'Open in the cabin', linked: 'Linked from', prev: 'Previous', next: 'Next', min: 'min read',
    updated: 'updated', part: (a: number, b: number) => `Part ${a} of ${b}`, contents: 'Contents', tags: 'Tags',
    stage: { seedling: 'Seedling', growing: 'Growing', evergreen: 'Evergreen' }, lang: { en: 'English', tr: 'Turkish' } },
  tr: { writing: 'Yazılar', cabin: 'Kabinde aç', linked: 'Bu nota bağlananlar', prev: 'Önceki', next: 'Sonraki', min: 'dk okuma',
    updated: 'güncelleme', part: (a: number, b: number) => `Bölüm ${a} / ${b}`, contents: 'İçindekiler', tags: 'Etiketler',
    stage: { seedling: 'Filiz', growing: 'Büyüyor', evergreen: 'Olgun' }, lang: { en: 'İngilizce', tr: 'Türkçe' } },
} as const;
const STAGE_HELP: Record<Stage, string> = {
  seedling: 'Seedling: a first rough note', growing: 'Growing: taking shape, still changing', evergreen: 'Evergreen: settled',
};
const fmtDate = (d: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(d + 'T00:00:00Z'));
const ld = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

// Same palette and base type as the plain page (scripts/build-plain.ts), tuned for long reading.
const CSS = `
:root{--bg:#F4EBDD;--ink:#2A1D16;--ink2:#6E5A49;--line:rgba(42,29,22,.14);--accent:#C8492F;--card:#FBF6EE;--topic:#C8492F}
@media (prefers-color-scheme:dark){:root{--bg:#1C1512;--ink:#F1E6D6;--ink2:#B5A390;--line:rgba(241,230,214,.14);--accent:#F08A5D;--card:#251C18}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.65 Georgia,"Iowan Old Style",serif}
.wrap{max-width:700px;margin:0 auto;padding:40px 20px 80px}
a{color:var(--accent);text-underline-offset:.15em}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
.skip{position:absolute;left:-999px}.skip:focus{left:12px;top:12px;background:var(--card);padding:6px 10px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
nav.crumbs{display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:30px;font:14px system-ui,sans-serif;color:var(--ink2)}
nav.crumbs a{color:var(--ink2)}
h1{font-size:clamp(32px,6vw,46px);line-height:1.1;margin:8px 0 12px;letter-spacing:-.01em;text-wrap:balance}
.meta,.kicker{font:14px system-ui,sans-serif;color:var(--ink2);margin:0}
.meta span+span::before,.meta time+span::before,.meta span+time::before{content:"·";margin:0 .5em}
.dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;background:var(--topic);margin-right:.45em}
.stage{font:600 12px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase}
.cabin{display:inline-block;margin:18px 0 0;padding:9px 16px;border-radius:999px;background:var(--accent);color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none}
@media (prefers-color-scheme:dark){.cabin{color:#1C1512}}
.series,.toc{margin:24px 0 0;padding:12px 16px;background:var(--card);border:1px solid var(--line);border-radius:10px;font:15px/1.5 system-ui,sans-serif}
.series ol,.toc ol{margin:6px 0 0;padding-left:22px}.toc ol ol{margin:0}
.series p,.toc p{margin:0;color:var(--ink2)}
.prose{margin-top:34px;overflow-wrap:break-word}
.prose h2{font-size:27px;line-height:1.2;margin:46px 0 10px}
.prose h3{font-size:21px;line-height:1.25;margin:34px 0 8px}
.prose h4{font-size:18px;margin:28px 0 6px}
.prose p,.prose ul,.prose ol,.prose blockquote,.prose pre,.prose .table{margin:0 0 20px}
.prose ul,.prose ol{padding-left:24px}.prose li{margin:4px 0}.prose li>p{margin:0 0 8px}
.prose blockquote{padding:2px 0 2px 18px;border-left:3px solid var(--topic);color:var(--ink2);font-style:italic}
.prose blockquote p:last-child{margin-bottom:0}
.prose code{font:.84em/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--card);border:1px solid var(--line);border-radius:4px;padding:1px 4px}
.prose pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto}
.prose pre code{background:none;border:0;padding:0;font-size:14.5px}
.prose img{max-width:100%;height:auto;border-radius:10px;display:block;margin:0 auto}
.prose hr{border:0;border-top:1px solid var(--line);margin:36px 0}
.prose .table{overflow-x:auto}
.prose table{border-collapse:collapse;width:100%;font:15px/1.45 system-ui,sans-serif}
.prose th,.prose td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.prose th{font-weight:600;color:var(--ink2)}
.prose sup{line-height:0;font:600 .72em system-ui,sans-serif}
.prose .footnotes{margin-top:44px;padding-top:12px;border-top:1px solid var(--line);font-size:15.5px;color:var(--ink2)}
.wikilink{text-decoration-style:dotted}
.wikilink.missing{color:var(--ink2);border-bottom:1px dashed var(--ink2);cursor:help}
.pager{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:48px}
.pager a{display:block;padding:12px 16px;background:var(--card);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--ink)}
.pager small{display:block;font:13px system-ui,sans-serif;color:var(--ink2)}
.pager .next{text-align:right;grid-column:2}
h2.sec{font-size:22px;margin:48px 0 6px;padding-top:14px;border-top:1px solid var(--line)}
h2.topic{font-size:26px;margin:52px 0 4px;padding-top:14px;border-top:1px solid var(--line)}
h2.topic a{color:inherit;text-decoration:none}
.lede{color:var(--ink2);margin:0 0 6px}
ul.notes{list-style:none;margin:0;padding:0}
ul.notes li{padding:14px 0;border-bottom:1px solid var(--line)}
ul.notes h3{font-size:20px;line-height:1.3;margin:0 0 2px}
ul.notes p{margin:2px 0}
ul.notes .ex{color:var(--ink2);font-size:16px}
.tags{font:14px system-ui,sans-serif;color:var(--ink2);margin-top:40px}
footer{margin-top:56px;color:var(--ink2);font:14px system-ui,sans-serif}
@media (max-width:560px){body{font-size:17px}.pager{grid-template-columns:1fr}.pager .next{grid-column:1;text-align:left}}
`;

function page(o: { lang: Lang; title: string; description: string; path: string; head?: string; body: string; colour?: string; ignore?: boolean }): string {
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<link rel="canonical" href="${SITE}${o.path}">
<meta name="theme-color" content="#2a1d16">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${SITE}${o.path}">
<link rel="icon" href="/favicon.svg">
${o.head ?? ''}<style>${CSS}</style>
</head>
<body${o.colour ? ` style="--topic:${esc(o.colour)}"` : ''}${o.ignore ? ' data-pagefind-ignore="all"' : ''}>
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
${o.body}
</div>
</body>
</html>
`;
}

function noteRow(n: NoteMeta, level: 'h2' | 'h3' = 'h3'): string {
  const t = T[n.lang];
  return `<li lang="${n.lang}">
      <${level === 'h2' ? 'h2 style="font-size:20px;line-height:1.3;margin:0 0 2px"' : 'h3'}><a href="${n.url}">${esc(n.title)}</a></${level}>
      <p class="ex">${esc(n.excerpt)}</p>
      <p class="meta"><span class="stage" title="${esc(STAGE_HELP[n.stage])}">${t.stage[n.stage]}</span><time datetime="${n.date}">${fmtDate(n.date, n.lang)}</time><span>${t.lang[n.lang]}</span><span>${n.minutes} ${t.min}</span>${
        n.series ? `<span>${esc(n.series.name)} · ${n.series.order}</span>` : ''}</p>
    </li>`;
}

/** Pagefind folds ç, ğ, ö, ş, ü itself but not the dotless ı / dotted İ. Words that contain one are added once more
 *  in ASCII, as an indexed attribute of an empty hidden element, so "bahcivan" finds "bahçıvan". */
function asciiWords(plain: string): string {
  const words = new Set((plain.match(/[\p{L}\p{N}]*[ıİ][\p{L}\p{N}]*/gu) ?? []).map(fold));
  return words.size ? `    <span hidden data-pagefind-index-attrs="data-ascii" data-ascii="${esc([...words].join(' '))}"></span>\n` : '';
}

function notePage(n: NoteMeta, body: NoteBody, idx: NotesIndex, author: string): string {
  const t = T[n.lang];
  const topic = idx.topics.find(x => x.id === n.topic)!;
  const get = (slug: string) => idx.notes.find(x => x.slug === slug)!;
  const series = n.series && idx.series.find(s => s.id === n.series!.id);
  const pos = series ? series.notes.indexOf(n.slug) : -1;
  const prev = series && pos > 0 ? get(series.notes[pos - 1]) : undefined;
  const next = series && pos < series.notes.length - 1 ? get(series.notes[pos + 1]) : undefined;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Article',
    headline: n.title, description: n.excerpt, inLanguage: n.lang,
    datePublished: n.date, dateModified: n.updated ?? n.date,
    author: { '@type': 'Person', name: author, url: SITE }, publisher: { '@type': 'Person', name: author, url: SITE },
    url: SITE + n.url, mainEntityOfPage: SITE + n.url, wordCount: n.words,
    articleSection: topic.title, keywords: n.tags.join(', '),
    ...(series ? { isPartOf: { '@type': 'CreativeWorkSeries', name: series.name }, position: pos + 1 } : {}),
  };
  const head = `<meta property="og:type" content="article">
<meta property="article:published_time" content="${n.date}">
${n.updated ? `<meta property="article:modified_time" content="${n.updated}">\n` : ''}${prev ? `<link rel="prev" href="${SITE}${prev.url}">\n` : ''}${next ? `<link rel="next" href="${SITE}${next.url}">\n` : ''}<script type="application/ld+json">${ld(jsonld)}</script>
`;
  const toc = body.toc.filter(h => h.level === 2);
  const main = `  <nav class="crumbs" aria-label="Breadcrumb" lang="en">
    <a href="/">← The airship cabin</a><a href="/writing/">Writing</a><a href="/writing/topic/${topic.id}/">${esc(topic.title)}</a>
  </nav>
  <main id="main">
  <article data-pagefind-body
    data-slug="${n.slug}" data-topic="${topic.id}" data-topic-title="${esc(topic.title)}" data-stage="${n.stage}" data-lang="${n.lang}"
    data-date="${n.date}" data-minutes="${n.minutes}" data-excerpt="${esc(n.excerpt)}"
    data-pagefind-filter="topic[data-topic], stage[data-stage], lang[data-lang]"
    data-pagefind-meta="slug[data-slug], topic[data-topic], topicTitle[data-topic-title], stage[data-stage], lang[data-lang], date[data-date], minutes[data-minutes], excerpt[data-excerpt]"
    data-pagefind-sort="date[data-date]">
    <header>
      <p class="kicker" data-pagefind-ignore><span class="dot"></span><a href="/writing/topic/${topic.id}/" lang="en">${esc(topic.title)}</a></p>
      <h1 data-pagefind-meta="title">${esc(n.title)}</h1>
      <p class="meta" data-pagefind-ignore><span class="stage" title="${esc(STAGE_HELP[n.stage])}">${t.stage[n.stage]}</span><time datetime="${n.date}">${fmtDate(n.date, n.lang)}</time>${
        n.updated ? `<span>${t.updated} <time datetime="${n.updated}">${fmtDate(n.updated, n.lang)}</time></span>` : ''}<span>${t.lang[n.lang]}</span><span>${n.minutes} ${t.min}</span></p>
      <a class="cabin" href="/?note=${n.slug}" data-pagefind-ignore>${t.cabin} →</a>
${series ? `      <nav class="series" aria-label="${esc(series.name)}" data-pagefind-ignore>
        <p>${esc(series.name)} · ${t.part(pos + 1, series.notes.length)}</p>
        <ol>${series.notes.map(s => s === n.slug ? `<li aria-current="page"><strong>${esc(n.title)}</strong></li>` : `<li><a href="${get(s).url}">${esc(get(s).title)}</a></li>`).join('')}</ol>
      </nav>\n` : ''}${toc.length > 2 ? `      <nav class="toc" aria-label="${t.contents}" data-pagefind-ignore>
        <p>${t.contents}</p>
        <ol>${toc.map(h => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol>
      </nav>\n` : ''}    </header>
    <div class="prose">
${body.html}
    </div>
${asciiWords(n.title + ' ' + text(body.html))}${n.tags.length ? `    <p class="tags" data-pagefind-ignore>${t.tags}: ${n.tags.map(g => `<span data-pagefind-filter="tag">${esc(g)}</span>`).join(', ')}</p>\n` : ''}  </article>
${prev || next ? `  <nav class="pager" aria-label="${esc(series!.name)}">
    ${prev ? `<a class="prev" rel="prev" href="${prev.url}"><small>← ${t.prev}</small>${esc(prev.title)}</a>` : ''}
    ${next ? `<a class="next" rel="next" href="${next.url}"><small>${t.next} →</small>${esc(next.title)}</a>` : ''}
  </nav>\n` : ''}${n.backlinks.length ? `  <section aria-labelledby="linked-from">
    <h2 class="sec" id="linked-from">${t.linked}</h2>
    <ul class="notes">${n.backlinks.map(s => noteRow(get(s))).join('')}</ul>
  </section>\n` : ''}  </main>
  <footer lang="en"><a href="/writing/">All writing</a> · <a href="/writing/topic/${topic.id}/">${esc(topic.title)}</a> · <a href="/plain/">About ${esc(author)}</a></footer>`;
  return page({ lang: n.lang, title: `${n.title} · ${author}`, description: n.excerpt, path: n.url, head, body: main, colour: topic.colour });
}

function indexPage(idx: NotesIndex, author: string): string {
  const get = (slug: string) => idx.notes.find(x => x.slug === slug)!;
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Writing · ${author}`, url: `${SITE}/writing/`,
    hasPart: idx.notes.map(n => ({ '@type': 'Article', headline: n.title, url: SITE + n.url, inLanguage: n.lang, datePublished: n.date })),
  };
  const body = `  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">← The airship cabin</a><a href="/plain/">Plain version</a></nav>
  <main id="main">
    <header>
      <h1>Writing</h1>
      <p class="lede">${idx.notes.length} notes in ${idx.topics.length} topics, in English and Turkish. A garden rather than a blog: notes are marked seedling, growing or evergreen and link to each other.</p>
      <a class="cabin" href="/?index=1">Open in the cabin →</a>
    </header>
${idx.topics.map(t => `    <section aria-labelledby="t-${t.id}" style="--topic:${esc(t.colour)}">
      <h2 class="topic" id="t-${t.id}"><span class="dot"></span><a href="/writing/topic/${t.id}/">${esc(t.title)}</a></h2>
      <p class="lede">${esc(t.blurb)}</p>
      <ul class="notes">${t.notes.map(s => noteRow(get(s))).join('')}</ul>
    </section>`).join('\n')}
  </main>
  <footer>Hand-made in Amsterdam. No tracking.</footer>`;
  return page({ lang: 'en', title: `Writing · ${author}`, description: `Notes by ${author}: ${idx.topics.map(t => t.title).join(', ')}.`, path: '/writing/',
    head: `<script type="application/ld+json">${ld(jsonld)}</script>\n`, body, ignore: true });
}

function topicPage(t: Topic, idx: NotesIndex, author: string): string {
  const get = (slug: string) => idx.notes.find(x => x.slug === slug)!;
  const body = `  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">← The airship cabin</a><a href="/writing/">Writing</a></nav>
  <main id="main">
    <header>
      <p class="kicker"><span class="dot"></span>Topic</p>
      <h1>${esc(t.title)}</h1>
      <p class="lede">${esc(t.blurb)}</p>
      <a class="cabin" href="/?topic=${t.id}">Open in the cabin →</a>
    </header>
    <ul class="notes" style="margin-top:30px">${t.notes.map(s => noteRow(get(s), 'h2')).join('')}</ul>
  </main>
  <footer><a href="/writing/">All writing</a> · <a href="/plain/">About ${esc(author)}</a></footer>`;
  return page({ lang: 'en', title: `${t.title} · Writing · ${author}`, description: t.blurb, path: `/writing/topic/${t.id}/`, body, colour: t.colour, ignore: true });
}

// ---------- write ----------
if (import.meta.main) {
  const out = resolve(root, process.env.PLAIN_OUT ?? 'dist');
  const { index, bodies, warnings } = loadNotes();
  for (const w of warnings) console.warn(`notes: warning: ${w}`);
  const author: string = parse(readFileSync(join(root, 'content', '_person.yml'), 'utf8')).name;

  // Start clean, so a deleted note does not live on (in public/, or copied from public/ into dist/ by vite).
  for (const p of ['notes', 'writing', 'pagefind', 'notes.json']) rmSync(join(out, p), { recursive: true, force: true });
  const write = (path: string, data: string) => { mkdirSync(join(out, path, '..'), { recursive: true }); writeFileSync(join(out, path), data); };

  write('notes.json', JSON.stringify(index));
  for (const b of bodies.values()) write(`notes/${b.slug}.json`, JSON.stringify(b));
  write('writing/index.html', indexPage(index, author));
  for (const n of index.notes) write(`writing/${n.slug}/index.html`, notePage(n, bodies.get(n.slug)!, index, author));
  for (const t of index.topics) write(`writing/topic/${t.id}/index.html`, topicPage(t, index, author));

  // Search: Pagefind indexes the note pages (the ones with data-pagefind-body).
  // One index for both languages (forceLanguage): with Pagefind 1.6 the per-language Turkish index misses plain
  // words such as "sunucu" and "kullanıcı" (its Turkish stemmer treats query and page differently), and a single
  // index needs no mergeIndex() in the app. PAGEFIND_PER_LANG=1 switches back to one index per <html lang>.
  const pagefind = await import('pagefind');
  const { index: pf, errors } = await pagefind.createIndex(process.env.PAGEFIND_PER_LANG ? {} : { forceLanguage: 'en' });
  if (!pf) throw new Error(`pagefind: ${errors.join('; ')}`);
  const added = await pf.addDirectory({ path: out, glob: 'writing/**/*.html' });
  const written = await pf.writeFiles({ outputPath: join(out, 'pagefind') });
  await pagefind.close();
  // The app has its own search box; drop Pagefind's ready-made UI bundles (about 430 KB).
  for (const f of readdirSync(join(out, 'pagefind'))) if (/-ui\.(js|css)$/.test(f)) rmSync(join(out, 'pagefind', f));
  const pfErrors = [...added.errors, ...written.errors];
  if (pfErrors.length) throw new Error(`pagefind: ${pfErrors.join('; ')}`);

  console.log(`notes: ${index.notes.length} notes, ${index.topics.length} topics, ${index.series.length} series → ${relative(root, out)}/{notes.json,notes/,writing/,pagefind/} (${added.page_count} pages scanned for search)`);
}
