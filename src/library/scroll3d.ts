// His words on a parchment scroll that unrolls in the air beside him, always turned to the camera.
// The HTML chat keeps the same text for screen readers.
import * as THREE from 'three';

const W = 0.78, H = 0.44;              // scroll size in metres
const CW = 768, CH = Math.round(CW * H / W);
const FONT = (px: number) => `${px}px Georgia, 'Iowan Old Style', 'Times New Roman', serif`;

export class SpeechScroll {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private paper: THREE.Mesh;
  private rollTop: THREE.Mesh;
  private rollBottom: THREE.Mesh;
  private text = '';
  private dirty = false;
  private open = 0;          // 0 rolled up .. 1 open
  private want = 0;
  private idle = 0;

  constructor(scene: THREE.Object3D) {
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.paper = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, color: new THREE.Color(0.82, 0.8, 0.76) }));
    const wood = new THREE.MeshStandardMaterial({ color: '#5c2921', roughness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: '#d9a63f', roughness: 0.35, metalness: 0.6 });
    const roller = () => {
      const g = new THREE.Group();
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, W + 0.06, 12), wood);
      rod.rotation.z = Math.PI / 2;
      g.add(rod);
      for (const s of [-1, 1]) {
        const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), brass);
        knob.position.x = s * (W / 2 + 0.04);
        g.add(knob);
      }
      return g as unknown as THREE.Mesh;
    };
    this.rollTop = roller();
    this.rollBottom = roller();
    this.group.add(this.paper, this.rollTop, this.rollBottom);
    this.group.visible = false;
    this.group.renderOrder = 5;
    scene.add(this.group);
    this.draw();
  }

  /** Start a new reply: clears the scroll and unrolls it. */
  begin() { this.text = ''; this.dirty = true; this.want = 1; this.idle = 0; }
  /** Text revealed so far (in step with his speech). */
  set(text: string) { if (text !== this.text) { this.text = text; this.dirty = true; this.idle = 0; } }
  /** Roll it up after a while once he has finished speaking. */
  done() { this.idle = 0.0001; }
  hide() { this.want = 0; }

  update(dt: number, camera: THREE.Camera, head: THREE.Vector3) {
    if (this.idle > 0) { this.idle += dt; if (this.idle > 7) this.want = 0; }
    this.open += (this.want - this.open) * Math.min(1, dt * 5);
    this.group.visible = this.open > 0.02;
    if (!this.group.visible) return;
    if (this.dirty) { this.draw(); this.dirty = false; }
    // beside his head on the camera's left of him, a little above, facing the camera
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    const toCam = camPos.clone().sub(head).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCam).normalize();
    // beside him on wide screens; above his head on portrait ones, where the side would fall off the screen
    const narrow = (camera as THREE.PerspectiveCamera).aspect < 1;
    const pos = narrow
      ? head.clone().add(new THREE.Vector3(0, 0.5, 0)).addScaledVector(toCam, 0.55)
      : head.clone().addScaledVector(right, -0.62).add(new THREE.Vector3(0, 0.08, 0)).addScaledVector(toCam, 0.55);
    this.group.position.lerp(pos, this.group.visible && this.open < 0.1 ? 1 : Math.min(1, dt * 6));
    this.group.lookAt(camPos);
    // unroll from the top roller downwards
    const k = THREE.MathUtils.smoothstep(this.open, 0, 1);
    this.paper.scale.y = Math.max(0.001, k);
    this.paper.position.y = (H / 2) * (1 - k);
    (this.paper.material as THREE.MeshBasicMaterial).map!.repeat.set(1, Math.max(0.001, k));
    (this.paper.material as THREE.MeshBasicMaterial).map!.offset.set(0, 1 - Math.max(0.001, k));
    this.rollTop.position.y = H / 2 + 0.01;
    this.rollBottom.position.y = H / 2 - H * k - 0.01;
  }

  private draw() {
    const g = this.ctx;
    g.clearRect(0, 0, CW, CH);
    // parchment with darker, ragged edges
    const grad = g.createRadialGradient(CW * 0.4, CH * 0.35, 20, CW / 2, CH / 2, CW * 0.7);
    grad.addColorStop(0, '#f3e6c4');
    grad.addColorStop(0.6, '#e5d1a2');
    grad.addColorStop(1, '#c9ae7a');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, 6);
    for (let x = 0; x <= CW; x += 24) g.lineTo(x, 6 + Math.sin(x * 0.07) * 3);
    g.lineTo(CW, CH - 6);
    for (let x = CW; x >= 0; x -= 24) g.lineTo(x, CH - 6 + Math.sin(x * 0.05 + 1) * 3);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(140, 95, 30, 0.35)';
    g.lineWidth = 3;
    g.strokeRect(22, 22, CW - 44, CH - 44);
    // the words: wrapped, newest lines kept in view
    const size = 44, lh = size * 1.28, pad = 46, maxW = CW - pad * 2;
    g.font = FONT(size);
    g.fillStyle = '#2a1712';
    g.textBaseline = 'top';
    const lines: string[] = [];
    for (const para of this.text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const t = line ? `${line} ${word}` : word;
        if (g.measureText(t).width > maxW && line) { lines.push(line); line = word; } else line = t;
      }
      lines.push(line);
    }
    const fit = Math.floor((CH - pad * 2) / lh);
    lines.slice(-fit).forEach((l, i) => g.fillText(l, pad, pad + i * lh));
    this.tex.needsUpdate = true;
  }
}
