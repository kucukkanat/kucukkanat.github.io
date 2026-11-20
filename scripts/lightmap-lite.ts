// Half-resolution copies of the baked lightmaps for the lite tier (phones): 1024² instead of 2048².
// Runs after `bun run blender`. The app picks the file by tier (src/lighting.ts).
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dir, '..', 'public', 'assets');
for (const mode of ['sunset', 'night']) {
  const src = join(dir, `lightmap_${mode}.webp`), dst = join(dir, `lightmap_${mode}_1k.webp`);
  await sharp(src).resize(1024, 1024, { kernel: 'lanczos3' }).webp({ quality: 80, smartSubsample: true }).toFile(dst);
  console.log(`lightmap_${mode}_1k.webp: ${(statSync(src).size / 1024).toFixed(0)} KB → ${(statSync(dst).size / 1024).toFixed(0)} KB`);
}
