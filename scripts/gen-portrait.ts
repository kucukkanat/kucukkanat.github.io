// Painted portrait for the cabin wall, from HT's photo.
// Usage: bun run portrait                 → art/portrait-source.jpg → art/portrait/portrait.png → public/assets/portrait.webp
//        bun run portrait --placeholder   → only re-exports art/portrait/placeholder.png (coat-and-hat still life, spec art/portrait.json)
// The source photo is git-ignored (art/portrait-source.*) and is never published; only the painted result is.
// Images come from scripts/gen-art.ts (OpenRouter, key in ~/.config/openrouter/key). Model: gen-art's default unless OPENROUTER_IMAGE_MODEL is set.
import { existsSync, mkdtempSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const root = join(import.meta.dir, '..');
const outWebp = join(root, 'public/assets/portrait.webp');
const MAX_BYTES = 150 * 1024;

async function exportWebp(png: string) {
  // 4:5, 640×800 is plenty for a framed painting a few hundred px tall; step quality down until it fits.
  for (const quality of [82, 76, 70, 64, 58, 50]) {
    const buf = await sharp(png).resize(640, 800, { fit: 'cover', position: 'attention' }).webp({ quality }).toBuffer();
    if (buf.length <= MAX_BYTES || quality === 50) {
      writeFileSync(outWebp, buf);
      console.log(`portrait: public/assets/portrait.webp (${Math.round(buf.length / 1024)} KB, q${quality})`);
      return;
    }
  }
}

if (process.argv.includes('--placeholder')) {
  const png = join(root, 'art/portrait/placeholder.png');
  if (!existsSync(png)) { console.error('portrait: art/portrait/placeholder.png missing — run `bun scripts/gen-art.ts art/portrait.json placeholder`'); process.exit(1); }
  await exportWebp(png);
  process.exit(0);
}

const source = ['jpg', 'jpeg', 'png', 'webp', 'heic'].map(e => join(root, `art/portrait-source.${e}`)).find(existsSync);
if (!source) {
  console.error('portrait: no source photo. Put a head-and-shoulders photo at art/portrait-source.jpg (git-ignored, never published) and run again.');
  process.exit(1);
}

// gen-art sends refs as PNG; normalise the photo (and keep it small) next to the source, still git-ignored.
const refRel = 'art/portrait-source.ref.png';
await sharp(source).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toFile(join(root, refRel));

const spec = JSON.parse(readFileSync(join(root, 'art/portrait.json'), 'utf8'));
const job = {
  id: 'portrait', aspect: '4:5', ref: refRel,
  prompt:
    'Paint a head-and-shoulders portrait of the person in the reference photo. Keep their likeness: face shape, features, ' +
    'hair, beard or glasses if any, skin tone and expression. Repaint it in the style above, not as a photo filter. ' +
    'Dress them as a friendly airship captain: a dark navy double-breasted captain\'s coat with brass buttons over a simple shirt, ' +
    'a small brass wing pin on the lapel; no hat unless the photo has one. Warm oil-lamp light from one side, ' +
    'a soft dark wooden cabin wall behind with a hint of a glowing porthole. Calm, kind, approachable. Vertical 4:5, ' +
    'face in the upper third, centred like a painted portrait hanging on a wall.',
};
const tmp = mkdtempSync(join(tmpdir(), 'portrait-'));
const specPath = join(tmp, 'spec.json');
writeFileSync(specPath, JSON.stringify({ out: spec.out, aspect: '4:5', style: spec.style, jobs: [job] }, null, 2));
const p = Bun.spawnSync(['bun', join(root, 'scripts/gen-art.ts'), specPath, 'portrait'], {
  cwd: root, env: { ...process.env, FORCE: '1' }, stdout: 'inherit', stderr: 'inherit',
});
rmSync(tmp, { recursive: true, force: true });
rmSync(join(root, refRel), { force: true });
const png = join(root, spec.out, 'portrait.png');
if (p.exitCode !== 0 || !existsSync(png) || Date.now() - statSync(png).mtimeMs > 10 * 60_000) {
  console.error('portrait: generation failed, public/assets/portrait.webp left as it was');
  process.exit(1);
}
await exportWebp(png);
console.log('portrait: look at art/portrait/portrait.png before publishing; regenerate with `bun run portrait` if it is off.');
