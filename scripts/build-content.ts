// content/*.md + content/_person.yml  →  public/content.json
// Each .md file: YAML frontmatter (see src/types.ts) + a short Markdown body.
// A memory-card with `map: {x, y}` also produces a map-island for the same job.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Content, Item, Kind } from '../src/types';

const root = join(import.meta.dir, '..');
const dir = join(root, 'content');
const KINDS: Kind[] = ['cartridge', 'book', 'notebook', 'memory-card', 'map-island'];

export function md(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return src.trim().split(/\n{2,}/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-*] /.test(l))) return '<ul>' + lines.map(l => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('') + '</ul>';
    return `<p>${inline(lines.join(' '))}</p>`;
  }).join('\n');
}

export function load(): Content {
  const person = parse(readFileSync(join(dir, '_person.yml'), 'utf8'));
  // Markdown bodies of the letter, portrait and slate panels → HTML
  for (const k of ['welcome', 'about', 'story'] as const) if (person[k]?.body) person[k].body = md(person[k].body);
  const items: Item[] = [];
  const errors: string[] = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('_')).sort()) {
    const raw = readFileSync(join(dir, f), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!m) { errors.push(`${f}: missing frontmatter`); continue; }
    const fm = parse(m[1]) ?? {};
    const id = f.replace(/\.md$/, '');
    if (!KINDS.includes(fm.kind)) { errors.push(`${f}: kind must be one of ${KINDS.join(', ')}`); continue; }
    if (!fm.title) { errors.push(`${f}: title is required`); continue; }
    if (fm.kind === 'cartridge' && !['games', 'ai', 'tools'].includes(fm.group)) errors.push(`${f}: cartridge needs group games|ai|tools`);
    const labelFile = join(root, 'public', 'labels', `${id}.webp`);
    const item: Item = {
      id, order: 0, colour: '#8a6a4f', ...fm,
      year: fm.year != null ? String(fm.year) : undefined,
      label: fm.label ?? (existsSync(labelFile) ? `/labels/${id}.webp` : undefined),
      body: md(m[2] ?? ''),
    };
    items.push(item);
    if (fm.kind === 'memory-card' && fm.map) {
      items.push({ ...item, id: `${id}--island`, kind: 'map-island' });
    }
  }
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  items.sort((a, b) => a.kind.localeCompare(b.kind) || a.order - b.order);
  return { person, items };
}

if (import.meta.main) {
  const content = load();
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(join(root, 'public', 'content.json'), JSON.stringify(content, null, 2));
  const count = (k: Kind) => content.items.filter(i => i.kind === k).length;
  console.log(`content.json: ${KINDS.map(k => `${count(k)} ${k}`).join(', ')}`);
}
