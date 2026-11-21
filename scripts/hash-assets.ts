// After `vite build`: give every file copied from public/assets a content-hashed name (cabin.3f2a9c1d.glb) and point
// every reference in dist/ at it, so a CDN may cache /assets/* for a year and a deploy still reaches every visitor.
// The unhashed files stay as well (old pages in flight, hand-typed links).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist'), assets = join(dist, 'assets');
const names = readdirSync(join(root, 'public', 'assets'));
const map = new Map<string, string>();
for (const n of names) {
  const p = join(assets, n);
  try { statSync(p); } catch { continue; }
  const h = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 8);
  const ext = extname(n);
  const hashed = `${basename(n, ext)}.${h}${ext}`;
  copyFileSync(p, join(assets, hashed));
  map.set(`/assets/${n}`, `/assets/${hashed}`);
}
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
let files = 0, refs = 0;
const re = new RegExp(`(${[...map.keys()].map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w.])`, 'g');
for (const f of walk(dist)) {
  if (!/\.(js|html|css|json|webmanifest|xml)$/.test(f)) continue;
  const s = readFileSync(f, 'utf8');
  let n = 0;
  const out = s.replace(re, m => { n++; return map.get(m)!; });
  if (n) { writeFileSync(f, out); files++; refs += n; }
}
console.log(`hash-assets: ${map.size} files hashed, ${refs} references in ${files} files`);
