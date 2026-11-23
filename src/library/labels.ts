// Spine labels drawn on canvas textures at runtime (as the main site does for its books and cartridges).
import * as THREE from 'three';
import type { Topic } from './types';

export function labelBooks(get: (n: string) => THREE.Object3D | undefined, topics: Topic[], lite: boolean) {
  for (const t of topics) {
    const book = get(`Book_${t.id}`);
    if (!book) continue;
    const tex = spineTexture(t.title, lite ? 192 : 384);
    book.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const out = mats.map(mat => (mat.name === 'SpineLabel'
        ? new THREE.MeshStandardMaterial({ name: 'SpineLabel', map: tex, roughness: 0.8 })
        : mat));
      m.material = Array.isArray(m.material) ? out : out[0];
    });
  }
}

function spineTexture(title: string, h: number): THREE.CanvasTexture {
  const w = Math.round(h * 0.22);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ecdcb6';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#8c5f1e';
  g.lineWidth = Math.max(1, w * 0.05);
  g.strokeRect(w * 0.08, w * 0.08, w * 0.84, h - w * 0.16);
  // title reads top-to-bottom along the spine (English convention)
  g.translate(w / 2, h / 2);
  g.rotate(Math.PI / 2);
  g.fillStyle = '#2a1712';
  let size = w * 0.52;
  g.font = `600 ${size}px Georgia, 'Times New Roman', serif`;
  const text = title.toUpperCase();
  while (g.measureText(text).width > h * 0.86 && size > 6) { size -= 1; g.font = `600 ${size}px Georgia, serif`; }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, size * 0.06);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
