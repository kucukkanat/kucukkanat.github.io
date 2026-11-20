// Writes the plain, no-WebGL version of the site and the crawl files into dist/ (run after `vite build`).
//   dist/plain/index.html  — every content item as readable HTML (also what search engines index)
//   dist/sitemap.xml (with the /writing/ pages from build-notes.ts), dist/robots.txt, dist/CNAME
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { load } from './build-content';
import { loadNotes } from './build-notes';
import type { Item } from '../src/types';

const SITE = 'https://kucukkanat.com';
const root = join(import.meta.dir, '..');
const dist = resolve(root, process.env.PLAIN_OUT ?? 'dist');
const { person, items } = load();
const notes = loadNotes().index;   // the note pages themselves are written by build-notes.ts

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const by = (kind: string) => items.filter(i => i.kind === kind).sort((a, b) => a.order - b.order);
const links = (i: Item) => [
  i.url && `<a href="${esc(i.url)}">${i.playable ? 'Play / open' : 'Open'}</a>`,
  i.source && `<a href="${esc(i.source)}">Source</a>`,
].filter(Boolean).join(' · ');

const card = (i: Item) => `
    <article class="item" id="${esc(i.id)}">
      ${i.label ? `<img src="${esc(i.label)}" alt="" width="72" height="72" loading="lazy">` : `<span class="swatch" style="background:${esc(i.colour)}"></span>`}
      <div>
        <h3>${esc(i.title)}${i.year ? ` <small>${esc(i.year)}</small>` : ''}</h3>
        ${i.subtitle ? `<p class="sub">${esc(i.subtitle)}</p>` : ''}
        ${i.body}
        ${i.tags?.length ? `<p class="tags">${i.tags.map(esc).join(' · ')}</p>` : ''}
        ${links(i) ? `<p class="links">${links(i)}</p>` : ''}
      </div>
    </article>`;

const job = (i: Item) => `
    <article class="job" id="${esc(i.id)}">
      <p class="period">${esc(i.period ?? '')}${i.current ? ' · <strong>now</strong>' : ''}</p>
      <div>
        <h3>${esc(i.title)}</h3>
        <p class="sub">${esc(i.role ?? '')}</p>
        ${i.body}
        ${i.achievements?.length ? `<ul>${i.achievements.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      </div>
    </article>`;

const groups: [string, string][] = [['games', 'Games'], ['ai', 'On-device AI'], ['tools', 'Tools & toys']];
const cartridges = by('cartridge');
const jobs = by('memory-card').reverse();

const jsonld = {
  '@context': 'https://schema.org', '@type': 'Person',
  name: person.name, alternateName: ['HT', person.handle], url: SITE,
  jobTitle: 'Engineering Manager', worksFor: { '@type': 'Organization', name: 'IKEA (Ingka Group)' },
  sameAs: person.links.map((l: any) => l.url),
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(person.name)} (HT, ${esc(person.handle)}) — engineering manager, game maker</title>
<meta name="description" content="${esc(person.bio)}">
<link rel="canonical" href="${SITE}/plain/">
<meta name="theme-color" content="#2a1d16">
<meta property="og:title" content="${esc(person.name)} — ${esc(person.handle)}">
<meta property="og:description" content="${esc(person.tagline)}">
<meta property="og:url" content="${SITE}/">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<style>
:root{--bg:#F4EBDD;--ink:#2A1D16;--ink2:#6E5A49;--line:rgba(42,29,22,.14);--accent:#C8492F;--card:#FBF6EE}
@media (prefers-color-scheme:dark){:root{--bg:#1C1512;--ink:#F1E6D6;--ink2:#B5A390;--line:rgba(241,230,214,.14);--accent:#F08A5D;--card:#251C18}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 Georgia,"Iowan Old Style",serif}
.wrap{max-width:780px;margin:0 auto;padding:48px 20px 80px}
header h1{font-size:clamp(34px,6vw,52px);line-height:1.05;margin:0 0 6px;letter-spacing:-.01em}
header .tag{color:var(--ink2);font-style:italic;margin:0 0 18px}
nav.top{display:flex;flex-wrap:wrap;gap:8px 18px;font:15px system-ui,sans-serif}
a{color:var(--accent)}
.back{display:inline-block;margin-bottom:28px;font:14px system-ui,sans-serif;color:var(--ink2)}
h2{font-size:26px;margin:52px 0 8px;padding-top:12px;border-top:1px solid var(--line)}
h2 + p.lede{color:var(--ink2);margin:0 0 10px}
h3{font-size:19px;margin:0}
h3 small{font:13px system-ui,sans-serif;color:var(--ink2);font-weight:400}
h4{font:600 13px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--ink2);margin:26px 0 4px}
.item,.job{display:grid;grid-template-columns:72px 1fr;gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}
.job{grid-template-columns:110px 1fr}
.item img,.swatch{width:72px;height:72px;border-radius:10px;display:block;object-fit:cover}
.item p,.job p{margin:4px 0}
.sub{color:var(--ink2);font-style:italic}
.tags,.links,.period{font:14px system-ui,sans-serif;color:var(--ink2)}
.period{margin-top:4px!important}
ul{margin:6px 0;padding-left:20px}
footer{margin-top:56px;color:var(--ink2);font:14px system-ui,sans-serif}
@media (max-width:560px){.job{grid-template-columns:1fr;gap:2px}}
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="/">← The airship cabin (3D version)</a>
  <header>
    <h1>${esc(person.name)}</h1>
    <p class="tag">${esc(person.tagline)}</p>
    <p>${esc(person.bio)}</p>
    <nav class="top">${person.links.map((l: any) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`).join('')}</nav>
  </header>

  <h2 id="work">Projects</h2>
  <p class="lede">Most of these run right in your browser.</p>
  ${groups.map(([g, name]) => `<h4>${name}</h4>${cartridges.filter(c => c.group === g).map(card).join('')}`).join('\n')}

  <h2 id="writing">Writing</h2>
  <p class="lede"><a href="/writing/">All ${notes.notes.length} notes, by topic</a>: ${notes.topics.map(t => `<a href="/writing/topic/${esc(t.id)}/">${esc(t.title)}</a>`).join(' · ')}</p>
  ${[...by('book'), ...by('notebook')].map(card).join('')}

  <h2 id="career">Career</h2>
  ${jobs.map(job).join('')}

  <footer>Hand-made in Amsterdam. No tracking. Content lives in Markdown files in the site’s repository.</footer>
</div>
</body>
</html>
`;

mkdirSync(join(dist, 'plain'), { recursive: true });
writeFileSync(join(dist, 'plain', 'index.html'), html);
const today = new Date().toISOString().slice(0, 10);
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${today}</lastmod></url>
  <url><loc>${SITE}/plain/</loc><lastmod>${today}</lastmod></url>
  <url><loc>${SITE}/writing/</loc><lastmod>${today}</lastmod></url>
${[
  ...notes.topics.map(t => `  <url><loc>${SITE}/writing/topic/${t.id}/</loc><lastmod>${today}</lastmod></url>`),
  ...notes.notes.map(n => `  <url><loc>${SITE}${n.url}</loc><lastmod>${n.updated ?? n.date}</lastmod></url>`),
].join('\n')}
</urlset>
`);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(dist, 'CNAME'), 'kucukkanat.com\n');
if (!existsSync(join(dist, 'index.html'))) console.warn('note: dist/index.html missing — run vite build first');
console.log(`plain: ${items.length} items → ${join(dist, 'plain/index.html')}`);
