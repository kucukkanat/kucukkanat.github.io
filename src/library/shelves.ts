// Signposts on the shelves, so the visitor can tell his books from the decoration: each real book stands a little
// proud of its row with a red ribbon and a brass nameplate on the shelf lip, and a brass plaque on the crown of
// each bay lists the subjects in it. Positions follow room.py (back bookcase).
import * as THREE from 'three';
import type { Topic } from './types';

const BAYS = [-2.2, -1.1, 0.0, 1.1, 2.2];
const CASE_D = 0.36, CASE_H = 3.0, Z_BACK = -3.0;
const FRONT = Z_BACK + CASE_D;               // the bookcase's front face
const PROUD = 0.03;                          // how far a real book stands out of its row
const BOOK_H = 0.3, SPINE_Z = 0.1238;        // spine face, in the book's own space
const ROMAN = ['I', 'II', 'III', 'IV'];
const serif = (px: number, w = 400, i = false) => `${i ? 'italic ' : ''}${w} ${px}px Georgia, 'Iowan Old Style', serif`;

export const shortName = (t: Topic) => t.short ?? t.title;

export function markShelves(scene: THREE.Object3D, get: (n: string) => THREE.Object3D | undefined, topics: Topic[], lite: boolean) {
  const brass = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: 0.38, metalness: 0.55, emissive: '#3a2608', emissiveIntensity: 0.6 });
  const ribbonMat = new THREE.MeshStandardMaterial({ color: '#9e2a22', roughness: 0.55 });
  const tasselMat = new THREE.MeshStandardMaterial({ color: '#d9a63f', roughness: 0.35, metalness: 0.6 });
  const bays = new Map<number, { t: Topic; y: number }[]>();
  for (const t of topics) {
    const node = get(`Book_${t.id}`);
    if (!node) continue;
    node.updateWorldMatrix(true, false);
    const p = node.getWorldPosition(new THREE.Vector3());
    // stand proud of the row
    node.position.z += PROUD;
    // ribbon bookmark over the top of the spine, with a gilt tassel
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.11, 0.0015), ribbonMat);
    ribbon.position.set(-0.0135, BOOK_H - 0.05, SPINE_Z + 0.002);
    ribbon.rotation.z = 0.06;
    const tassel = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 8, 6), tasselMat);
    tassel.position.set(-0.0101, BOOK_H - 0.108, SPINE_Z + 0.004);
    tassel.scale.y = 1.6;
    node.add(ribbon, tassel);
    // nameplate on the shelf lip under the book
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.03), brass(plateTexture(shortName(t), lite ? 256 : 512, 0.25)));
    plate.position.set(p.x, p.y - 0.017, FRONT + 0.004);
    plate.name = `Nameplate_${t.id}`;
    scene.add(plate);
    const bay = BAYS.findIndex((x, i) => i < BAYS.length - 1 && p.x >= x && p.x < BAYS[i + 1]);
    if (!bays.has(bay)) bays.set(bay, []);
    bays.get(bay)!.push({ t, y: p.y });
  }
  // a plaque on the crown of each bay: the subjects it holds, top shelf first
  for (const [bay, items] of bays) {
    if (bay < 0) continue;
    const names = items.sort((a, b) => b.y - a.y).map(i => shortName(i.t));
    const w = 0.9, h = 0.15;                    // most of the bay's width, readable from the main view when zoomed
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(w, h), brass(plaqueTexture(ROMAN[bay] ?? '', names, lite ? 512 : 1024, h / w)));
    // on the moulding under the crown (its face is ~0.035 proud of the case), tipped down toward the room
    plaque.position.set((BAYS[bay] + BAYS[bay + 1]) / 2, CASE_H - 0.095, FRONT + 0.065);
    plaque.rotation.x = 0.15;
    plaque.name = `BayPlaque_${bay}`;
    scene.add(plaque);
  }
}

function brassCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#f0cf7e'); grad.addColorStop(0.45, '#c99a3e'); grad.addColorStop(1, '#8f6424');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(70,40,10,.55)';
  g.lineWidth = Math.max(2, h * 0.06);
  g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  return { c, g };
}

function fit(g: CanvasRenderingContext2D, text: string, maxW: number, px: number, w = 600) {
  let size = px;
  g.font = serif(size, w);
  while (g.measureText(text).width > maxW && size > 8) { size -= 1; g.font = serif(size, w); }
  return size;
}

function engrave(g: CanvasRenderingContext2D, text: string, x: number, y: number) {
  g.fillStyle = 'rgba(255,240,200,.55)';
  g.fillText(text, x + 1, y + 1.5);
  g.fillStyle = '#2b1606';
  g.fillText(text, x, y);
}

function plateTexture(title: string, w: number, aspect: number) {
  const h = Math.round(w * aspect);
  const { c, g } = brassCanvas(w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fit(g, title.toUpperCase(), w * 0.84, h * 0.5);
  engrave(g, title.toUpperCase(), w / 2, h / 2 + 1);
  return tex(c);
}

function plaqueTexture(numeral: string, names: string[], w: number, aspect: number) {
  const h = Math.round(w * aspect);
  const { c, g } = brassCanvas(w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = names.join(' · ');
  g.font = serif(h * 0.2, 600);
  engrave(g, numeral, w / 2, h * 0.2);
  fit(g, text, w * 0.9, h * 0.5, 600);
  engrave(g, text, w / 2, h * 0.6);
  return tex(c);
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
