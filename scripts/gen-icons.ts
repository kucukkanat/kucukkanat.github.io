// PWA / home-screen icons from the wing mark in public/favicon.svg. Run once after changing the mark:
// `bun scripts/gen-icons.ts` → public/icons/*.png (committed).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = join(import.meta.dir, '..', 'public', 'icons');
mkdirSync(out, { recursive: true });
const WING = 'M8 40c10-2 22-10 30-22 3-5 8-9 14-10-2 6-5 11-9 15 4 0 8-1 11-3-3 6-9 10-16 12 3 1 6 1 9 0-6 5-14 7-22 7-7 0-13 1-17 1z';
// pad: how much of the tile the wing may use (maskable icons keep it inside the 80% safe zone)
const svg = (rounded: boolean, pad: number) => {
  const s = pad, o = (64 - 64 * s) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<defs><radialGradient id="g" cx="50%" cy="60%" r="70%"><stop offset="0" stop-color="#5a2c1d"/><stop offset="1" stop-color="#2a1712"/></radialGradient></defs>
<rect width="64" height="64" rx="${rounded ? 14 : 0}" fill="url(#g)"/>
<g transform="translate(${o} ${o + 2 * s}) scale(${s})"><path d="${WING}" fill="#F07A2A"/></g></svg>`);
};
const jobs: [string, number, boolean, number][] = [
  ['icon-192.png', 192, true, 0.9],
  ['icon-512.png', 512, true, 0.9],
  ['maskable-512.png', 512, false, 0.62],
  ['apple-touch-icon.png', 180, false, 0.78], // iOS rounds the corners itself
];
for (const [name, size, rounded, pad] of jobs)
  await sharp(svg(rounded, pad), { density: 72 * size / 64 }).resize(size, size).png({ compressionLevel: 9 }).toFile(join(out, name));
console.log(`gen-icons: ${jobs.length} icons in public/icons`);
