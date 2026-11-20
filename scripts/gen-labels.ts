// Generate cartridge label art for every cartridge in public/content.json that has no public/labels/<id>.webp.
// Usage: bun run labels [id ...]           (FORCE=1 regenerates the given ids even if they exist)
// Prompt per item: frontmatter `labelPrompt` > art/labels.json `prompts[id]` > derived from title/subtitle/body.
// Images come from scripts/gen-art.ts (OpenRouter) into art/labels/<id>.png, then sharp → 256×256 webp (they render a few dozen px wide).
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import type { Content, Item } from '../src/types';

const root = join(import.meta.dir, '..');
const force = process.env.FORCE === '1';
const only = process.argv.slice(2);
// Labels are small; the mini model is plenty (see docs/ART.md). Override with OPENROUTER_IMAGE_MODEL.
const model = process.env.OPENROUTER_IMAGE_MODEL ?? 'openai/gpt-5-image-mini';

const content: Content = JSON.parse(readFileSync(join(root, 'public/content.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(root, 'art/labels.json'), 'utf8'));
const pngDir = join(root, 'art/labels');
const webpDir = join(root, 'public/labels');
mkdirSync(webpDir, { recursive: true });

const strip = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const promptFor = (it: Item & { labelPrompt?: string }) =>
  it.labelPrompt ?? cfg.prompts?.[it.id] ??
  `Illustrate the theme of a project called "${it.title}"${it.subtitle ? ` (${it.subtitle})` : ''}: ${strip(it.body)} ` +
  `Show it as one charming painted scene or object that evokes this idea; do not write the name anywhere.`;

const carts = content.items.filter(i => i.kind === 'cartridge' && (!only.length || only.includes(i.id)));
const todo = carts.filter(i => force || !existsSync(join(webpDir, `${i.id}.webp`)));
if (!todo.length) { console.log('labels: all cartridges have a label'); process.exit(0); }

// Ids that still need a fresh PNG (existing PNGs are just converted unless FORCE=1).
const gen = todo.filter(i => force || !existsSync(join(pngDir, `${i.id}.png`)));
if (gen.length) {
  const tmp = mkdtempSync(join(tmpdir(), 'labels-'));
  const spec = join(tmp, 'spec.json');
  writeFileSync(spec, JSON.stringify({
    out: 'art/labels', aspect: '1:1', style: cfg.style,
    jobs: gen.map(i => ({ id: i.id, prompt: promptFor(i) })),
  }, null, 2));
  console.log(`labels: generating ${gen.map(i => i.id).join(', ')} with ${model}`);
  const p = Bun.spawnSync(['bun', join(root, 'scripts/gen-art.ts'), spec, ...gen.map(i => i.id)], {
    cwd: root, env: { ...process.env, OPENROUTER_IMAGE_MODEL: model }, stdout: 'inherit', stderr: 'inherit',
  });
  rmSync(tmp, { recursive: true, force: true });
  if (p.exitCode !== 0) process.exit(p.exitCode ?? 1);
}

let missing = 0;
for (const i of todo) {
  const png = join(pngDir, `${i.id}.png`);
  if (!existsSync(png)) { console.log(`${i.id}: no image, skipped`); missing++; continue; }
  await sharp(png).resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toFile(join(webpDir, `${i.id}.webp`));
  console.log(`${i.id}: public/labels/${i.id}.webp`);
}
console.log('labels: run `bun run content` to pick up the new label paths');
if (missing) process.exit(1);
