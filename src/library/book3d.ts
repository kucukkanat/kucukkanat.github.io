// The handed-over book, opened on the table towards the visitor: the covers open, a page turns, and the spread shows
// the topic (left) and its notes (right). Clicking a note follows its link. The HTML reader keeps the same list for
// screen readers and keyboards.
import * as THREE from 'three';
import type { Topic } from './types';

const PW = 0.21, PH = 0.29;            // one page, metres
const TEX_W = 768, TEX_H = Math.round(TEX_W * PH / PW);
const COVER: Record<string, string> = {
  BookRed: '#a1392c', BookBlue: '#2f466e', BookGreen: '#34573a', BookOchre: '#b7862e',
  BookPlum: '#683356', BookTeal: '#2c6462', Leather: '#804c31',
};
const serif = (px: number, w = 400, i = false) => `${i ? 'italic ' : ''}${w} ${px}px Georgia, 'Iowan Old Style', serif`;

interface Hit { slug: string; x0: number; y0: number; x1: number; y1: number; page?: 'L' | 'R' }

export class OpenBook {
  readonly group = new THREE.Group();
  private left!: THREE.Mesh;
  private right!: THREE.Mesh;
  private coverR!: THREE.Group;
  private turning!: THREE.Group;
  private hits: Hit[] = [];
  private t = 0;
  private state: 'closed' | 'opening' | 'open' | 'closing' = 'closed';
  onClose?: () => void;
  /** Where the camera should stand to read the spread (world). */
  readonly readPos = new THREE.Vector3();
  readonly readAt = new THREE.Vector3();

  constructor(scene: THREE.Object3D) {
    this.group.visible = false;
    this.group.renderOrder = 2;
    scene.add(this.group);
  }

  get isOpen() { return this.state === 'open' || this.state === 'opening'; }

  /** 'book' for a fetched volume, 'catalogue' for the card catalogue (its links are `topic:<id>`). */
  kind: 'book' | 'catalogue' = 'book';

  open(topic: Topic, recommended: string[], at: THREE.Vector3, camera: THREE.Camera) {
    this.kind = 'book';
    this.build(COVER[topic.colour] ?? (topic.colour.startsWith('#') ? topic.colour : '#a1392c'), this.drawLeft(topic, recommended), this.drawRight(topic, recommended));
    this.place(at, camera);
  }

  /** The catalogue: every subject with its note count; picking one sends him to fetch it. */
  openCatalogue(topics: Topic[], at: THREE.Vector3, camera: THREE.Camera) {
    this.kind = 'catalogue';
    this.build(COVER.Leather, this.drawCatalogueLeft(topics), this.drawCatalogueRight(topics));
    this.place(at, camera);
  }

  private place(at: THREE.Vector3, camera: THREE.Camera) {    // lie on the table, spread turned to face the camera, tilted up a little like a book on a stand
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const dir = camPos.clone().sub(at).setY(0).normalize();
    this.group.position.copy(at).add(new THREE.Vector3(0, 0.02, 0));
    this.group.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    this.group.updateMatrixWorld(true);
    // aim a little in front of the spread so it sits above the chat panel
    this.readAt.copy(at).add(new THREE.Vector3(0, 0.03, 0)).addScaledVector(dir, 0.09);
    this.readPos.copy(at).addScaledVector(dir, 0.3).add(new THREE.Vector3(0, 0.52, 0));
    this.state = 'opening';
    this.t = 0;
    this.group.visible = true;
  }

  close() {
    if (this.state === 'closed' || this.state === 'closing') return;
    this.state = 'closing';
    this.t = 0;
  }

  /** Slug of the note under a ray, if any. */
  pick(ray: THREE.Raycaster): string | null {
    if (this.state !== 'open') return null;
    for (const [mesh, page] of [[this.right, 'R'], [this.left, 'L']] as const) {
      const hit = ray.intersectObject(mesh, false)[0];
      if (!hit?.uv) continue;
      const x = hit.uv.x * TEX_W, y = (1 - hit.uv.y) * TEX_H;
      return this.hits.find(h => (h.page ?? 'R') === page && x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1)?.slug ?? null;
    }
    return null;
  }

  /** Is the ray over the book at all (to keep clicks on the book from closing it)? */
  over(ray: THREE.Raycaster) { return this.group.visible && ray.intersectObject(this.group, true).length > 0; }

  update(dt: number) {
    if (this.state === 'closed') return;
    this.t += dt;
    const ease = (x: number) => THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(x, 0, 1), 0, 1);
    if (this.state === 'opening') {
      // rise a touch, open the right cover (from lying on the left half), then turn one page
      const c = ease(this.t / 0.7);
      this.coverR.rotation.z = Math.PI * (1 - c);
      const p = ease((this.t - 0.55) / 0.85);
      this.turning.visible = this.t > 0.55 && p < 1;
      this.turning.rotation.z = Math.PI * p;
      this.turning.position.y = 0.0195 + Math.sin(p * Math.PI) * 0.02;
      this.group.scale.setScalar(0.9 + 0.1 * c);
      if (this.t > 1.45) { this.state = 'open'; this.turning.visible = false; }
    } else if (this.state === 'closing') {
      const c = ease(this.t / 0.5);
      this.coverR.rotation.z = Math.PI * c;
      this.group.scale.setScalar(1 - 0.1 * c);
      if (this.t > 0.5) { this.state = 'closed'; this.group.visible = false; this.onClose?.(); }
    }
  }

  // ------------------------------------------------------------ building
  private build(coverColour: string, leftPage: HTMLCanvasElement, rightPage: HTMLCanvasElement) {
    this.group.clear();
    const cover = new THREE.MeshStandardMaterial({ color: coverColour, roughness: 0.75 });
    const gilt = new THREE.MeshStandardMaterial({ color: '#d9a63f', roughness: 0.35, metalness: 0.6 });
    const block = new THREE.MeshStandardMaterial({ color: '#e9dcb8', roughness: 0.9 });
    // left half: cover board, page block, page surface
    const leftHalf = new THREE.Group();
    const boardL = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.012, 0.006, PH + 0.012), cover);
    boardL.position.set(-(PW + 0.012) / 2, 0.003, 0);
    const blockL = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.004, 0.012, PH - 0.006), block);
    blockL.position.set(-PW / 2, 0.012, 0);
    this.left = this.page(leftPage);
    this.left.position.set(-PW / 2, 0.0185, 0);
    leftHalf.add(boardL, blockL, this.left);
    // right half on a hinge at the spine (rotation.z = PI lies it on the left half = closed)
    this.coverR = new THREE.Group();
    const boardR = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.012, 0.006, PH + 0.012), cover);
    // the hinge sits at page height so the closed half lies on top of the left one
    boardR.position.set((PW + 0.012) / 2, 0.003 - 0.0185, 0);
    const blockR = new THREE.Mesh(new THREE.BoxGeometry(PW - 0.004, 0.012, PH - 0.006), block);
    blockR.position.set(PW / 2, 0.012 - 0.0185, 0);
    this.right = this.page(rightPage);
    this.right.position.set(PW / 2, 0, 0);
    // gilt band along the cover's outer edge (seen when closed)
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.0062, PH + 0.012), gilt);
    band.position.set(PW + 0.006, 0.003 - 0.0185, 0);
    this.coverR.add(boardR, blockR, this.right, band);
    this.coverR.rotation.z = Math.PI;
    this.coverR.position.y = 0.0185;
    // spine
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, PH + 0.012, 10, 1, false, Math.PI, Math.PI), cover);
    spine.rotation.x = Math.PI / 2;
    spine.position.y = 0.006;
    // the page that turns once as it opens
    this.turning = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(PW - 0.006, PH - 0.008),
      new THREE.MeshStandardMaterial({ color: '#f1e5c6', roughness: 0.9, side: THREE.DoubleSide }));
    leaf.rotation.x = -Math.PI / 2;
    leaf.position.x = (PW - 0.006) / 2;
    this.turning.add(leaf);
    this.turning.visible = false;
    this.group.add(leftHalf, this.coverR, spine, this.turning);
    this.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  private page(canvas: HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // unlit paper (a little below white), so the table lantern never washes the text out
    const m = new THREE.Mesh(new THREE.PlaneGeometry(PW - 0.004, PH - 0.006), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.86, 0.83, 0.78) }));
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  private paper() {
    const c = document.createElement('canvas');
    c.width = TEX_W; c.height = TEX_H;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, TEX_W, 0);
    grad.addColorStop(0, '#efe2c0'); grad.addColorStop(0.5, '#f5ead0'); grad.addColorStop(1, '#ead9b2');
    g.fillStyle = grad;
    g.fillRect(0, 0, TEX_W, TEX_H);
    return { c, g };
  }

  private drawLeft(topic: Topic, recommended: string[]) {
    const { c, g } = this.paper();
    g.textAlign = 'center';
    g.fillStyle = '#8c5f1e';
    g.font = serif(26, 600);
    g.fillText('FROM THE SHELVES', TEX_W / 2, 150);
    g.fillStyle = '#2a1712';
    // title, wrapped
    g.font = serif(64);
    const words = topic.title.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > TEX_W - 140 && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
    lines.forEach((l, i) => g.fillText(l, TEX_W / 2, 260 + i * 76));
    // ornament
    const y = 300 + lines.length * 76;
    g.strokeStyle = '#b7862e'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(TEX_W / 2 - 120, y); g.lineTo(TEX_W / 2 - 18, y); g.moveTo(TEX_W / 2 + 18, y); g.lineTo(TEX_W / 2 + 120, y); g.stroke();
    g.fillStyle = '#b7862e';
    g.beginPath(); g.moveTo(TEX_W / 2, y - 10); g.lineTo(TEX_W / 2 + 10, y); g.lineTo(TEX_W / 2, y + 10); g.lineTo(TEX_W / 2 - 10, y); g.fill();
    g.fillStyle = '#5c3424';
    g.font = serif(30, 400, true);
    const n = topic.notes.length;
    g.fillText(`${n} note${n === 1 ? '' : 's'} in this volume`, TEX_W / 2, y + 70);
    if (recommended.length) g.fillText('The Librarian marked his favourites.', TEX_W / 2, y + 115);
    g.font = serif(24, 400, true);
    g.fillStyle = '#8c6a4a';
    g.fillText('Close the book to ask about another subject.', TEX_W / 2, TEX_H - 90);
    return c;
  }

  private drawRight(topic: Topic, recommended: string[]) {
    const { c, g } = this.paper();
    this.hits = [];
    g.fillStyle = '#8c5f1e';
    g.font = serif(26, 600);
    g.textAlign = 'left';
    g.fillText('CONTENTS', 90, 150);
    let y = 230;
    topic.notes.slice(0, 7).forEach((note, i) => {
      const rec = recommended.includes(note.slug);
      g.fillStyle = rec ? '#992f27' : '#2a1712';
      g.font = serif(30, 600);
      g.fillText(`${i + 1}.`, 90, y);
      g.font = serif(38);
      // wrap the title in the column
      const words = note.title.split(' ');
      let line = '', ly = y;
      const x0 = 140, maxW = TEX_W - x0 - 80;
      const y0 = y - 40;
      for (const w of words) {
        const t = line ? `${line} ${w}` : w;
        if (g.measureText(t).width > maxW && line) { g.fillText(line, x0, ly); ly += 48; line = w; } else line = t;
      }
      g.fillText(line, x0, ly);
      // underline like a link
      g.strokeStyle = rec ? 'rgba(153,47,39,0.55)' : 'rgba(42,23,18,0.3)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0, ly + 10); g.lineTo(x0 + Math.min(maxW, g.measureText(line).width), ly + 10); g.stroke();
      if (rec) { g.fillStyle = '#992f27'; g.font = serif(24, 400, true); g.fillText('marked', x0, ly + 44); ly += 30; }
      this.hits.push({ slug: note.slug, x0: 70, y0, x1: TEX_W - 60, y1: ly + 20 });
      y = ly + 90;
    });
    return c;
  }

  /** The catalogue runs across both pages, five subjects a page, in large type. */
  private drawCatalogueLeft(topics: Topic[]) {
    this.hits = [];
    const notes = topics.reduce((n, t) => n + t.notes.length, 0);
    const half = Math.ceil(topics.length / 2);
    return this.cataloguePage(topics.slice(0, half), 0, 'L', 'CATALOGUE', `${topics.length} volumes, ${notes} notes`);
  }

  private drawCatalogueRight(topics: Topic[]) {
    const half = Math.ceil(topics.length / 2);
    return this.cataloguePage(topics.slice(half), half, 'R', 'CHOOSE A SUBJECT', 'and the Librarian will fetch it');
  }

  private cataloguePage(items: Topic[], first: number, page: 'L' | 'R', head: string, sub: string) {
    const { c, g } = this.paper();
    g.textAlign = 'left';
    g.fillStyle = '#8c5f1e';
    g.font = serif(32, 600);
    g.fillText(head, 70, 110);
    g.fillStyle = '#8c6a4a';
    g.font = serif(32, 400, true);
    g.fillText(sub, 70, 156);
    const top = 200, rowH = (TEX_H - top - 40) / Math.max(5, items.length);
    items.forEach((t, i) => {
      const y0 = top + i * rowH;
      // title in large type, wrapped to two lines if needed
      g.fillStyle = '#2a1712';
      let size = 54;
      g.font = serif(size);
      const words = t.title.split(' ');
      const maxW = TEX_W - 150;
      const lines: string[] = [];
      let line = '';
      for (const w of words) { const s2 = line ? `${line} ${w}` : w; if (g.measureText(s2).width > maxW && line) { lines.push(line); line = w; } else line = s2; }
      lines.push(line);
      if (lines.length > 2) { size = 44; g.font = serif(size); }
      g.fillStyle = '#992f27';
      g.font = serif(30, 600);
      g.fillText(`${first + i + 1}.`, 70, y0 + 58);
      g.fillStyle = '#2a1712';
      g.font = serif(size);
      lines.slice(0, 2).forEach((l, k) => g.fillText(l, 125, y0 + 58 + k * (size + 4)));
      g.fillStyle = '#8c6a4a';
      g.font = serif(30, 400, true);
      const ny = y0 + 58 + (Math.min(2, lines.length) - 1) * (size + 4) + 44;
      g.fillText(`${t.notes.length} note${t.notes.length === 1 ? '' : 's'}`, 125, ny);
      g.strokeStyle = 'rgba(42,23,18,0.22)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(70, y0 + rowH - 8); g.lineTo(TEX_W - 70, y0 + rowH - 8); g.stroke();
      this.hits.push({ slug: `topic:${t.id}`, x0: 50, y0, x1: TEX_W - 50, y1: y0 + rowH - 8, page });
    });
    return c;
  }
}
