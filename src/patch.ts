// The squadron patch on the flight jacket's sleeve: "Hv.H.O. ÖĞRENCİ ALAYI · 1.FİLO".
// If the owner's photo of the real patch is at /assets/patch.webp it is used as is; otherwise this redraw of it
// (navy ring with gold lettering and two stars, grey centre, red eagle on a black crag, crescent and star).
import * as THREE from 'three';
import type { Cabin } from './scene';
import { loadTexture } from './scene';

const GOLD = '#f2b632', NAVY = '#1c3f94', GREY = '#bdbdb6', RED = '#c9242b';

function arcText(ctx: CanvasRenderingContext2D, text: string, r: number, mid: number, spread: number, flip = false) {
  const chars = [...text];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  chars.forEach((ch, i) => {
    const t = chars.length === 1 ? 0 : i / (chars.length - 1) - 0.5;
    const a = mid + (flip ? -t : t) * spread;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, flip ? r : -r);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawPatch(size = 512): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = size / 512;
  ctx.scale(s, s);
  ctx.translate(256, 256);
  // outer gold border, navy ring, inner gold border, grey field
  for (const [r, col] of [[254, GOLD], [240, NAVY], [168, GOLD], [156, GREY]] as const) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  }
  // embroidery: fine diagonal stitches over the grey
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, 156, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1.2;
  for (let i = -330; i < 330; i += 5) { ctx.beginPath(); ctx.moveTo(i, -160); ctx.lineTo(i + 40, 160); ctx.stroke(); }
  // red sweep with the white crescent and star (lower right)
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.moveTo(20, 150); ctx.quadraticCurveTo(150, 110, 128, -40); ctx.quadraticCurveTo(190, 60, 120, 170); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(88, 78, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = RED;
  ctx.beginPath(); ctx.arc(97, 72, 25, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; star(ctx, 112, 96, 11, 0.3);
  // black crag
  ctx.fillStyle = '#17110e';
  ctx.beginPath(); ctx.moveTo(-112, 112); ctx.lineTo(-52, 40); ctx.lineTo(-30, 8); ctx.lineTo(-8, 30); ctx.lineTo(20, 22); ctx.lineTo(62, 112); ctx.quadraticCurveTo(-20, 160, -112, 112); ctx.closePath(); ctx.fill();
  // red eagle perched on it, wings half raised, head turned to the right
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.moveTo(-58, 22); ctx.quadraticCurveTo(-86, -30, -66, -84); ctx.quadraticCurveTo(-52, -112, -22, -110);  // back / left wing
  ctx.quadraticCurveTo(-8, -138, 22, -128); ctx.lineTo(44, -112); ctx.lineTo(24, -108);                        // head and beak
  ctx.quadraticCurveTo(30, -92, 14, -84); ctx.quadraticCurveTo(44, -60, 30, -20);                              // chest / right wing
  ctx.quadraticCurveTo(22, 10, 0, 26); ctx.lineTo(-10, 6); ctx.lineTo(-24, 28); ctx.lineTo(-36, 8); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7d1118'; ctx.lineWidth = 3;
  for (const [x0, y0, x1, y1] of [[-56, -66, -30, -30], [-44, -84, -14, -44], [-28, -92, 4, -52], [8, -70, 18, -28]]) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(16, -116, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.beginPath(); ctx.moveTo(-30, 26); ctx.lineTo(-22, 44); ctx.lineTo(-14, 28); ctx.closePath(); ctx.fill();   // talons
  ctx.beginPath(); ctx.moveTo(-8, 26); ctx.lineTo(0, 44); ctx.lineTo(8, 28); ctx.closePath(); ctx.fill();
  // "1.Filo" brushed in red on the rock
  ctx.fillStyle = RED;
  ctx.font = 'italic 700 46px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('1.Filo', -22, 92);
  // dark star, upper right
  ctx.fillStyle = '#2a2a2a'; star(ctx, 96, -92, 24, 0.2);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.restore();
  // lettering on the ring
  ctx.fillStyle = GOLD;
  ctx.font = '800 50px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  arcText(ctx, 'Hv.H.O. ÖĞRENCİ ALAYI', 203, 0, 2.55);
  ctx.font = '800 56px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  arcText(ctx, '1.FİLO', 204, 0, 0.78, true);
  star(ctx, -196, 46, 20, -0.25);
  star(ctx, 196, 46, 20, 0.25);
  // stitched edge
  ctx.strokeStyle = 'rgba(120,80,10,0.55)'; ctx.lineWidth = 3; ctx.setLineDash([5, 4]);
  for (const r of [247, 162]) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); }
  return c;
}

/** Put the patch art on the jacket (mesh `Patch_filo`, material `SquadronPatch`, UV 0..1). */
export function setupPatch(cabin: Cabin) {
  const node = cabin.get('Patch_filo') ?? cabin.get('Jacket_patch');
  if (!node) return;
  const tex = new THREE.CanvasTexture(drawPatch());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ name: 'SquadronPatch', map: tex, roughness: 0.9, metalness: 0, transparent: true, alphaTest: 0.5 });
  node.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some(x => x.name === 'SquadronPatch') || mats.length === 1) {
      // glTF UVs have v down: flip the canvas texture to match
      tex.flipY = false;
      m.material = Array.isArray(m.material) ? m.material.map(x => (x.name === 'SquadronPatch' ? mat : x)) : mat;
    }
  });
  void loadTexture('/assets/patch.webp').then(t => { if (!t) return; t.flipY = false; t.anisotropy = 8; mat.map = t; mat.needsUpdate = true; tex.dispose(); });
}
