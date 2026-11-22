import * as THREE from 'three';
import type { Item } from './types';
import { loadTexture } from './scene';

export const DISPLAY = '"Fraunces", Georgia, "Times New Roman", serif';
export const SANS = '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

/** Wait for web fonts (bounded) so canvas text uses them. */
export async function fontsReady() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`700 40px ${DISPLAY}`),
        document.fonts.load(`500 40px ${DISPLAY}`),
        document.fonts.load(`500 20px ${SANS}`),
      ]),
      new Promise(r => setTimeout(r, 1200)), // self-hosted + preloaded: normally ready long before this
    ]);
  } catch { /* ignore */ }
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function toTexture(c: HTMLCanvasElement, anisotropy = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // glTF UV convention
  t.anisotropy = anisotropy;
  return t;
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

/** Deterministic pseudo-random from a string. */
export function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, maxW: number, maxLines: number, start: number, min: number) {
  let size = start;
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { size, lines };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return { size: min, lines: wrap(ctx, text, maxW).slice(0, maxLines) };
}

/** Painted sky-and-island vignette used on procedural labels and the handheld idle screen. */
export function paintSky(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: string, night = false) {
  const rnd = seeded(seed);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (night) { g.addColorStop(0, '#1b2346'); g.addColorStop(0.6, '#3b3a6a'); g.addColorStop(1, '#6a557a'); }
  else { g.addColorStop(0, '#8f7fc0'); g.addColorStop(0.45, '#e9a6a0'); g.addColorStop(1, '#fbd59a'); }
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // clouds
  for (let i = 0; i < 7; i++) {
    const cx = x + rnd() * w, cy = y + h * (0.55 + rnd() * 0.4), r = w * (0.08 + rnd() * 0.12);
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    cg.addColorStop(0, night ? 'rgba(160,160,210,0.45)' : 'rgba(255,240,235,0.85)');
    cg.addColorStop(1, 'rgba(255,240,235,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.ellipse(cx, cy, r * 1.6, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  }
  // floating island
  const ix = x + w * (0.3 + rnd() * 0.4), iy = y + h * (0.35 + rnd() * 0.15), iw = w * (0.22 + rnd() * 0.12);
  ctx.fillStyle = night ? '#2b2a44' : '#6b4a5a';
  ctx.beginPath();
  ctx.moveTo(ix - iw / 2, iy);
  ctx.quadraticCurveTo(ix - iw * 0.2, iy + iw * 0.5, ix, iy + iw * 0.85);
  ctx.quadraticCurveTo(ix + iw * 0.2, iy + iw * 0.5, ix + iw / 2, iy);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = night ? '#3c5a4c' : '#7aa268';
  ctx.beginPath(); ctx.ellipse(ix, iy, iw / 2, iw * 0.09, 0, 0, Math.PI * 2); ctx.fill();
  // little tower
  ctx.fillStyle = night ? '#4a4566' : '#c98f7a';
  const tw = iw * 0.12, th = iw * (0.25 + rnd() * 0.3);
  ctx.fillRect(ix - tw / 2 + iw * 0.08, iy - th, tw, th);
  ctx.beginPath(); ctx.moveTo(ix + iw * 0.08 - tw * 0.8, iy - th); ctx.lineTo(ix + iw * 0.08, iy - th - tw * 1.4); ctx.lineTo(ix + iw * 0.08 + tw * 0.8, iy - th); ctx.fill();
  if (night) {
    ctx.fillStyle = '#fff6d0';
    for (let i = 0; i < 18; i++) ctx.fillRect(x + rnd() * w, y + rnd() * h * 0.4, 1.5, 1.5);
  }
}

/** Cartridge front label: painted card with the title. */
export function cartridgeLabel(item: Item): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 320);
  ctx.fillStyle = '#efe4cc';
  ctx.fillRect(0, 0, 256, 320);
  paintSky(ctx, 14, 14, 228, 180, item.id);
  // frame
  ctx.strokeStyle = 'rgba(60,35,20,0.55)'; ctx.lineWidth = 4; ctx.strokeRect(14, 14, 228, 180);
  // colour band
  ctx.fillStyle = item.colour; ctx.fillRect(14, 200, 228, 8);
  ctx.fillStyle = '#2a1712';
  const { size, lines } = fitFont(ctx, item.title, 700, DISPLAY, 220, 2, 40, 18);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const top = lines.length === 1 ? 245 : 232;
  lines.forEach((l, i) => ctx.fillText(l, 128, top + i * size * 1.05));
  ctx.font = `500 15px ${SANS}`; ctx.fillStyle = 'rgba(42,23,18,0.7)';
  ctx.fillText([item.year, item.group?.toUpperCase()].filter(Boolean).join(' · '), 128, 300);
  grain(ctx, 256, 320, item.id);
  return toTexture(c);
}

/** Book / notebook spine: tall canvas, title runs top-to-bottom. */
export function spineLabel(item: Item): THREE.CanvasTexture {
  const [c, ctx] = canvas(96, 512);
  ctx.fillStyle = shade(item.colour, -0.02); ctx.fillRect(0, 0, 96, 512);
  const g = ctx.createLinearGradient(0, 0, 96, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.35, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 96, 512);
  ctx.fillStyle = '#d9b46a';
  for (const y of [30, 40, 472, 482]) ctx.fillRect(8, y, 80, 4);
  ctx.save();
  ctx.translate(48, 256); ctx.rotate(Math.PI / 2);
  ctx.fillStyle = '#f3dfae';
  const { lines } = fitFont(ctx, item.title, 700, DISPLAY, 380, 1, 44, 20);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(lines[0] ?? item.title, 0, 2);
  ctx.restore();
  grain(ctx, 96, 512, item.id);
  return toTexture(c, 8);
}

/** Memory-card label: company + period (+ role). */
export function memcardLabel(item: Item): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#f1e6cf'; ctx.fillRect(0, 0, 256, 256);
  // the company name is the label: as large as it fits, so the cards can be told apart from across the cabin
  ctx.fillStyle = item.colour; ctx.fillRect(0, 0, 256, 56);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = `700 24px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(item.period ?? 'SAVE', 128, 30);
  ctx.fillStyle = '#2a1712'; ctx.textAlign = 'center';
  const name = item.title.replace(/\s*\(.*\)\s*/, '');
  const { size, lines } = fitFont(ctx, name, 700, DISPLAY, 236, 2, 76, 26);
  const top = lines.length === 1 ? 134 : 134 - size * 0.52;
  lines.forEach((l, i) => ctx.fillText(l, 128, top + i * size * 1.05));
  if (item.role) {
    ctx.font = `500 17px ${SANS}`; ctx.fillStyle = 'rgba(42,23,18,0.7)';
    ctx.fillText(wrap(ctx, item.role, 228)[0], 128, 222);
  }
  grain(ctx, 256, 256, item.id);
  return toTexture(c);
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, seed: string) {
  const rnd = seeded(seed + 'g');
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(rnd() * w, rnd() * h, 2, 2);
  }
  ctx.globalAlpha = 1;
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(40,20,10,0.25)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
}

/** Label art from public/labels when present, else procedural. */
export async function labelTexture(item: Item, fallback: (i: Item) => THREE.Texture): Promise<THREE.Texture> {
  if (item.label) {
    const t = await loadTexture(item.label);
    if (t) { t.flipY = false; t.anisotropy = 4; t.needsUpdate = true; return t; }
  }
  return fallback(item);
}

/** Soft round sprite texture (glows, clouds). */
export function softDot(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
