// SkyWhale: runtime controller for the sky-whale GLBs (public/assets/whales, built by whales/scripts).
//
//   const whale = new SkyWhale(gltf, { particles: true });
//   parent.add(whale.object); whale.addEffectsTo(parent);
//   // every frame, after you've moved/rotated whale.object:
//   whale.update(dt);
//
// * plays the baked `cruise` loop (swim strokes, flipper/fluke waves, breathing, tree + water sway)
// * turns the static reaction poses (body_* / eco_*) into ADDITIVE clips driven by the whale's own acceleration
//   through springs: body springs are critically damped, eco springs (trees, water) under-damped and also feel the
//   gravity tilt, so lakes stay level-ish and trees lean downhill while the whale pitches or rolls
// * scrolls waterfalls & water, emits biome particles that trail behind, blowhole spouts
// * style B ("toon" in the GLB metadata): cel-shading + inverted-hull outline
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const REACTIONS = ['bankL', 'bankR', 'climb', 'dive', 'accel'] as const;
type Part = 'body' | 'eco';
type Axis = 'bank' | 'pitch' | 'accel';

export interface WhaleInfo {
  species: string; name: string; biome: string; biomeLabel: string; style: 'A' | 'B'; styleLabel: string;
  length: number; toon: boolean; lod?: 'full' | 'lite';
  particles?: { kind: string; color: string; color2: string; count: number; size: number; gravity: number; drag: number };
  island: { center: [number, number, number]; halfLength: number; halfWidth: number; top: number };
  spoutEvery?: number;
  stats: { triangles: number; bones: number; treeClusters: number; lakes: number; waterfalls: number; trees: number };
}

export interface SkyWhaleOptions {
  particles?: boolean;
  outline?: boolean;
  reactionGain?: number;
  /** Space the whale's motion (and its particles) is measured in. Default: world. Pass the group the whales
   *  live in when that group itself moves (e.g. the outside world while the galleon flies). */
  space?: THREE.Object3D | null;
  /** Automatic blowhole spouts. */
  spouts?: boolean;
}

class Spring {
  x = 0; v = 0;
  constructor(public k: number, public c: number) {}
  step(target: number, dt: number) {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt; this.x += this.v * dt; return this.x;
  }
}
const spring = (k: number, zeta: number) => new Spring(k, 2 * zeta * Math.sqrt(k));

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

interface Particles {
  pts: THREE.Points; pos: Float32Array; col: Float32Array; vel: Float32Array; life: Float32Array; max: Float32Array;
  N: number; scale: number;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

export class SkyWhale {
  readonly object: THREE.Group;
  readonly info: WhaleInfo;
  readonly L: number;
  readonly mixer: THREE.AnimationMixer;
  readonly cruise: THREE.AnimationAction;
  readonly reaction: Record<string, THREE.AnimationAction> = {};
  readonly springs: Record<Part, Record<Axis, Spring>>;
  readonly particles: (Particles & { cfg: NonNullable<WhaleInfo['particles']>; c1: THREE.Color; c2: THREE.Color; acc: number }) | null;
  readonly spout: Particles;
  /** Materials whose colour the world tints for night / storm. */
  readonly tintable: { mat: THREE.Material & { color: THREE.Color }; base: THREE.Color }[] = [];
  time = 0;
  /** World scale of `object` (the motion space's units per glTF metre): reactions, tempo and particles follow it. */
  private k = 1;
  private baseSizes = new Map<THREE.PointsMaterial, number>();
  private opts: Required<SkyWhaleOptions>;
  private skinned: THREE.SkinnedMesh[] = [];
  private blowhole: THREE.Object3D | undefined;
  private scrollers: { tex: THREE.Texture; u?: number; v?: number }[] = [];
  private prevPos = new THREE.Vector3(); private velSm = new THREE.Vector3(); private acc = new THREE.Vector3();
  private first = true; private nextSpout = 4 + Math.random() * 6;

  constructor(gltf: GLTF, opts: SkyWhaleOptions = {}) {
    this.opts = { particles: true, outline: true, reactionGain: 1, space: null, spouts: true, ...opts };
    this.object = gltf.scene;
    this.info = JSON.parse((gltf.scene.userData.whale as string) || '{}') as WhaleInfo;
    this.L = this.info.length || 12;
    this.object.traverse(o => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.skinned.push(o as THREE.SkinnedMesh);
    });
    this.blowhole = this.object.getObjectByName('blowhole');

    this.mixer = new THREE.AnimationMixer(this.object);
    const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
    this.cruise = this.mixer.clipAction(clips.cruise);
    this.cruise.setLoop(THREE.LoopRepeat, Infinity).play();
    this.cruise.time = Math.random() * clips.cruise.duration;
    const ref = this.bindPoseClip(clips.rest ?? clips.cruise);
    for (const r of REACTIONS) for (const part of ['body', 'eco'] as const) {
      const src = clips[`${part}_${r}`]; if (!src) continue;
      const act = this.mixer.clipAction(THREE.AnimationUtils.makeClipAdditive(src.clone(), 0, ref));
      act.blendMode = THREE.AdditiveAnimationBlendMode;
      act.setEffectiveWeight(0); act.play();
      this.reaction[`${part}_${r}`] = act;
    }
    this.springs = {
      body: { bank: spring(26, 1.0), pitch: spring(22, 1.0), accel: spring(18, 1.0) },
      eco: { bank: spring(16, 0.22), pitch: spring(14, 0.25), accel: spring(12, 0.28) },
    };
    this.setupMaterials();
    this.particles = this.opts.particles ? this.makeParticles() : null;
    this.spout = this.makeSpout();
  }

  /** Reference pose for the additive clips = the skeleton's bind pose (robust if a track is missing in `rest`). */
  private bindPoseClip(template: THREE.AnimationClip) {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const t of template.tracks) {
      const [nodeName, prop] = t.name.split('.');
      const node = this.object.getObjectByName(nodeName); if (!node) continue;
      if (prop === 'quaternion') tracks.push(new THREE.QuaternionKeyframeTrack(t.name, [0], node.quaternion.toArray()));
      else if (prop === 'position') tracks.push(new THREE.VectorKeyframeTrack(t.name, [0], node.position.toArray()));
      else if (prop === 'scale') tracks.push(new THREE.VectorKeyframeTrack(t.name, [0], node.scale.toArray()));
    }
    return new THREE.AnimationClip('bind', 0, tracks);
  }

  // ---------------------------------------------------------------- materials
  private setupMaterials() {
    const toon = !!this.info.toon;
    const grad = new THREE.DataTexture(new Uint8Array([125, 125, 125, 255, 195, 195, 195, 255, 255, 255, 255, 255]), 3, 1);
    grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
    const fallsMap = canvasTexture(64, 256, (g, w, h) => {
      g.fillStyle = '#9fdcee'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * w, len = 40 + Math.random() * 120, y = Math.random() * h;
        g.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.5})`; g.lineWidth = 1 + Math.random() * 3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + len); g.stroke();
        g.beginPath(); g.moveTo(x, y - h); g.lineTo(x, y - h + len); g.stroke();
      }
    });
    fallsMap.wrapS = fallsMap.wrapT = THREE.RepeatWrapping; fallsMap.repeat.set(1, 3);
    const fallsAlpha = canvasTexture(4, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0); // canvas y=0 -> uv v=1 (top of the fall)
      gr.addColorStop(0, '#000'); gr.addColorStop(0.28, '#ccc'); gr.addColorStop(0.95, '#eee'); gr.addColorStop(1, '#888');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    fallsAlpha.colorSpace = THREE.NoColorSpace;

    this.object.traverse(o => {
      const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial; const role = m.userData?.role as string | undefined;
      let out: THREE.Material & { color: THREE.Color } = m;
      if (role === 'waterfall') {
        const nm = new THREE.MeshStandardMaterial({
          map: fallsMap.clone(), alphaMap: fallsAlpha, transparent: true, depthWrite: false,
          side: THREE.DoubleSide, roughness: 0.25, emissive: 0x335566, emissiveIntensity: 0.4,
        });
        nm.map!.needsUpdate = true;
        mesh.material = out = nm; mesh.renderOrder = 2;
        this.scrollers.push({ tex: nm.map!, v: 1.6 });
      } else if (role === 'water') {
        if (m.map) { m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping; this.scrollers.push({ tex: m.map, v: 0.05, u: 0.03 }); }
        m.depthWrite = false; m.roughness = 0.05; mesh.renderOrder = 1;
      } else if (toon && (role === 'body' || role === 'vcol' || role === 'ice')) {
        mesh.material = out = new THREE.MeshToonMaterial({
          map: m.map ?? null, normalMap: m.normalMap ?? null, vertexColors: !!m.vertexColors, gradientMap: grad, side: m.side,
        });
      }
      this.tintable.push({ mat: out, base: out.color.clone() });
    });
    if (toon && this.opts.outline) {
      for (const mesh of this.skinned) {
        if (!['Whale_Body', 'Whale_Island'].some(n => mesh.name.startsWith(n))) continue;
        const width = this.L * (mesh.name.startsWith('Whale_Body') ? 0.0028 : 0.0016);
        const mat = new THREE.MeshBasicMaterial({ color: 0x1a1220, side: THREE.BackSide });
        mat.onBeforeCompile = sh => {
          sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
            `#include <begin_vertex>\n transformed += normalize(objectNormal) * ${width.toFixed(4)};`);
        };
        const hull = new THREE.SkinnedMesh(mesh.geometry, mat);
        hull.bind(mesh.skeleton, mesh.bindMatrix);
        hull.position.copy(mesh.position); hull.quaternion.copy(mesh.quaternion); hull.scale.copy(mesh.scale);
        hull.frustumCulled = false;
        mesh.parent!.add(hull);
      }
    }
  }

  /** Multiply every material colour (for night / storm). 1 = as authored. */
  setTint(c: THREE.Color) {
    for (const t of this.tintable) t.mat.color.copy(t.base).multiply(c);
  }

  // ---------------------------------------------------------------- particles (in `space`)
  private sprite(kind: string) {
    return canvasTexture(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      if (kind === 'leaves' || kind === 'petals') {
        g.fillStyle = '#fff'; g.beginPath();
        g.ellipse(32, 32, kind === 'petals' ? 22 : 26, kind === 'petals' ? 14 : 12, 0.6, 0, Math.PI * 2); g.fill();
      } else {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.8)');
        gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }
    });
  }

  private points(N: number, tex: THREE.Texture, size: number, additive: boolean): Particles {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      map: tex, size, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, alphaTest: additive ? 0 : 0.05,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    this.baseSizes.set(mat, size);
    const P = { pts, pos, col, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), N, scale: this.L / 14 };
    for (let i = 0; i < N; i++) { P.life[i] = -1; pos[i * 3 + 1] = -1e5; }
    return P;
  }

  private makeParticles() {
    const cfg = this.info.particles; if (!cfg) return null;
    const P = this.points(cfg.count * 2, this.sprite(cfg.kind), cfg.size * 2.2 * (this.L / 14), cfg.kind === 'fireflies');
    return { ...P, cfg, c1: new THREE.Color(cfg.color), c2: new THREE.Color(cfg.color2), acc: 0 };
  }

  private makeSpout() { return this.points(260, this.sprite('mist'), 0.55 * (this.L / 14), false); }

  /** Add the particle systems to the group they simulate in (the `space` option, or the scene). */
  addEffectsTo(parent: THREE.Object3D) {
    if (this.particles) parent.add(this.particles.pts);
    parent.add(this.spout.pts);
  }
  removeEffectsFrom(parent: THREE.Object3D) {
    if (this.particles) parent.remove(this.particles.pts);
    parent.remove(this.spout.pts);
  }
  setParticlesVisible(on: boolean) { if (this.particles) this.particles.pts.visible = on; }

  /** Set the whale's world scale (also sets object.scale). Clears the motion history so a jump isn't an acceleration. */
  setScale(k: number) {
    this.k = k; this.object.scale.setScalar(k);
    for (const [m, s] of this.baseSizes) m.size = s * k;
    this.spout.scale = (this.L / 14) * k;
    if (this.particles) this.particles.scale = (this.L / 14) * k;
    this.resetMotion();
  }
  get scale() { return this.k; }
  /** Change the space motion and particles are measured in (see the `space` option). */
  setSpace(space: THREE.Object3D | null) { this.opts.space = space; this.resetMotion(); }
  /** Forget the previous position (after teleporting / re-parenting). */
  resetMotion() { this.first = true; this.velSm.set(0, 0, 0); this.acc.set(0, 0, 0); }

  /** The whale's transform in the space it moves in. */
  private localMatrix(out: THREE.Matrix4) {
    this.object.updateMatrixWorld();
    out.copy(this.object.matrixWorld);
    const s = this.opts.space;
    if (s) { s.updateMatrixWorld(); out.premultiply(_m.copy(s.matrixWorld).invert()); }
    return out;
  }

  triggerSpout() {
    const S = this.spout; if (!this.blowhole) return;
    const M = this.localMatrix(new THREE.Matrix4());
    const rel = new THREE.Matrix4().copy(M).multiply(_m.copy(this.object.matrixWorld).invert());
    const p = this.blowhole.getWorldPosition(new THREE.Vector3()).applyMatrix4(rel);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(_q.setFromRotationMatrix(M));
    let n = 0;
    for (let i = 0; i < S.N && n < 220; i++) {
      if (S.life[i] > 0) continue; n++;
      const sp = (3.5 + Math.random() * 3.5) * S.scale;
      const j = new THREE.Vector3((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7);
      const v = up.clone().multiplyScalar(sp).add(j.multiplyScalar(sp)).add(this.velSm);
      S.pos.set([p.x, p.y, p.z], i * 3); S.vel.set([v.x, v.y, v.z], i * 3);
      S.max[i] = S.life[i] = 1.2 + Math.random() * 0.9;
    }
  }

  private stepParticles(dt: number, M: THREE.Matrix4) {
    const P = this.particles;
    if (P && P.pts.visible) {
      const cfg = P.cfg; const isl = this.info.island;
      P.acc += dt * cfg.count / 3.5;
      while (P.acc >= 1) {
        P.acc -= 1;
        const i = P.life.findIndex(l => l <= 0); if (i < 0) break;
        _v.set((Math.random() * 2 - 1) * isl.halfWidth, 0.2 + Math.random() * 1.5 * P.scale, (Math.random() * 2 - 1) * isl.halfLength)
          .add(new THREE.Vector3(...isl.center)).applyMatrix4(M);
        P.pos.set([_v.x, _v.y, _v.z], i * 3);
        const k = cfg.kind === 'fireflies' ? 0.85 : 0.75, j = this.k;
        P.vel.set([this.velSm.x * k + (Math.random() - 0.5) * 0.6 * j, this.velSm.y * k + (Math.random() - 0.2) * 0.5 * j,
          this.velSm.z * k + (Math.random() - 0.5) * 0.6 * j], i * 3);
        P.max[i] = P.life[i] = 3 + Math.random() * 3;
        const c = P.c1.clone().lerp(P.c2, Math.random());
        P.col.set([c.r, c.g, c.b], i * 3);
      }
      const drag = Math.exp(-cfg.drag * dt);
      const wander = cfg.kind === 'leaves' || cfg.kind === 'petals' || cfg.kind === 'fireflies';
      for (let i = 0; i < P.N; i++) {
        if (P.life[i] <= 0) continue;
        P.life[i] -= dt; const o = i * 3;
        P.vel[o] *= drag; P.vel[o + 1] = P.vel[o + 1] * drag + cfg.gravity * this.k * dt; P.vel[o + 2] *= drag;
        if (wander) { const t = this.time * 2 + i; P.vel[o] += Math.sin(t) * dt * 0.8 * this.k; P.vel[o + 2] += Math.cos(t * 1.3) * dt * 0.8 * this.k; }
        P.pos[o] += P.vel[o] * dt; P.pos[o + 1] += P.vel[o + 1] * dt; P.pos[o + 2] += P.vel[o + 2] * dt;
        if (P.life[i] <= 0) P.pos[o + 1] = -1e5;
      }
      P.pts.geometry.attributes.position.needsUpdate = true; P.pts.geometry.attributes.color.needsUpdate = true;
    }
    const S = this.spout;
    for (let i = 0; i < S.N; i++) {
      if (S.life[i] <= 0) continue;
      S.life[i] -= dt; const o = i * 3; const d = Math.exp(-1.4 * dt);
      S.vel[o] *= d; S.vel[o + 1] = S.vel[o + 1] * d - 4.0 * S.scale * dt; S.vel[o + 2] *= d;
      S.pos[o] += S.vel[o] * dt; S.pos[o + 1] += S.vel[o + 1] * dt; S.pos[o + 2] += S.vel[o + 2] * dt;
      const f = Math.max(0, S.life[i] / S.max[i]);
      S.col[o] = S.col[o + 1] = S.col[o + 2] = 0.95 * f;
      if (S.life[i] <= 0) S.pos[o + 1] = -1e5;
    }
    S.pts.geometry.attributes.position.needsUpdate = true; S.pts.geometry.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------------- main update
  /** Call once per frame after moving `object`. `animate: false` skips the skeleton (far / hidden whales). */
  update(dt: number, animate = true) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    const M = this.localMatrix(new THREE.Matrix4());
    const p = new THREE.Vector3().setFromMatrixPosition(M);
    if (this.first) { this.prevPos.copy(p); this.first = false; }
    const vel = p.clone().sub(this.prevPos).divideScalar(Math.max(dt, 1e-4));
    this.prevPos.copy(p);
    const prevSm = this.velSm.clone();
    this.velSm.lerp(vel, 1 - Math.exp(-dt * 6));
    const acc = this.velSm.clone().sub(prevSm).divideScalar(Math.max(dt, 1e-4));
    this.acc.lerp(acc, 1 - Math.exp(-dt * 5));

    // acceleration + gravity in the whale's own frame (+X left, +Y up, +Z forward)
    const qInv = _q.setFromRotationMatrix(M).invert();
    const aL = this.acc.clone().applyQuaternion(qInv);
    const gL = new THREE.Vector3(0, -1, 0).applyQuaternion(qInv);
    const aRef = 0.9 * this.L * this.k / 14 * 6;
    const g = this.opts.reactionGain;
    const clamp = (x: number) => Math.max(-1, Math.min(1, x));
    const sig: Record<Part, Record<Axis, number>> = {
      body: { bank: clamp(g * aL.x / aRef), pitch: clamp(g * aL.y / aRef), accel: clamp(g * Math.max(0, aL.z / aRef)) },
      eco: {
        bank: clamp(g * (aL.x / aRef - gL.x * 0.45)),
        pitch: clamp(g * (aL.y / aRef - gL.z * 1.4)),
        accel: clamp(g * Math.max(0, aL.z / aRef)),
      },
    };
    for (const part of ['body', 'eco'] as const) {
      const S = this.springs[part]; const s = sig[part];
      const b = S.bank.step(s.bank, dt), pt = S.pitch.step(s.pitch, dt), ac = S.accel.step(s.accel, dt);
      this.w(`${part}_bankL`, Math.max(0, b)); this.w(`${part}_bankR`, Math.max(0, -b));
      this.w(`${part}_climb`, Math.max(0, pt)); this.w(`${part}_dive`, Math.max(0, -pt));
      this.w(`${part}_accel`, Math.max(0, ac));
    }
    const speed = this.velSm.length();
    this.cruise.timeScale = 0.55 + Math.min(1.6, speed / (this.L * this.k * 0.45)) * 0.7 + this.springs.body.accel.x * 0.6;
    if (animate) this.mixer.update(dt);

    for (const s of this.scrollers) { s.tex.offset.y += (s.v ?? 0) * dt; s.tex.offset.x += (s.u ?? 0) * dt; }
    if (this.opts.spouts && this.time > this.nextSpout) {
      this.triggerSpout(); this.nextSpout = this.time + (this.info.spoutEvery ?? 12) * (0.8 + Math.random() * 0.4);
    }
    this.stepParticles(dt, M);
  }

  private w(name: string, w: number) { this.reaction[name]?.setEffectiveWeight(Math.min(1.25, w)); }

  get meters(): Record<Part, Record<Axis, number>> {
    const m = (p: Part) => ({ bank: this.springs[p].bank.x, pitch: this.springs[p].pitch.x, accel: this.springs[p].accel.x });
    return { body: m('body'), eco: m('eco') };
  }

  /** Velocity in the whale's motion space (smoothed). */
  get velocity() { return this.velSm; }

  dispose() { this.mixer.stopAllAction(); }
}

/** Smooth wandering flight (banks, climbs, dives, sprints), or steering input. */
export class AutoPilot {
  heading = 0; pitch = 0; roll = 0; speed = 4; yawRate = 0;
  readonly pos = new THREE.Vector3();
  private t: number;
  constructor(seed = 1) { this.t = seed * 10; }
  step(dt: number, L: number, steer: { yaw: number; pitch: number; boost: boolean } | null = null) {
    this.t += dt; const t = this.t;
    let yawRateT: number, pitchT: number, speedT: number;
    const base = L * 0.42;
    if (steer) {
      yawRateT = steer.yaw * 0.65; pitchT = steer.pitch * 0.45; speedT = base * (steer.boost ? 1.9 : 1.0);
    } else {
      yawRateT = 0.38 * Math.sin(t * 0.17) + 0.22 * Math.sin(t * 0.071 + 1.3);
      pitchT = 0.28 * Math.sin(t * 0.11 + 0.5) + 0.12 * Math.sin(t * 0.29);
      speedT = base * (1 + 0.8 * Math.max(0, Math.sin(t * 0.05 + 2)) ** 8);
    }
    pitchT -= this.pos.y * 0.004;
    this.yawRate += (yawRateT - this.yawRate) * (1 - Math.exp(-dt * 1.6));
    this.pitch += (pitchT - this.pitch) * (1 - Math.exp(-dt * 1.2));
    this.speed += (speedT - this.speed) * (1 - Math.exp(-dt * 0.8));
    this.heading += this.yawRate * dt;
    const rollT = -Math.max(-0.6, Math.min(0.6, this.yawRate * this.speed / L * 2.2));
    this.roll += (rollT - this.roll) * (1 - Math.exp(-dt * 2.0));
    this.pos.addScaledVector(new THREE.Vector3(Math.sin(this.heading) * Math.cos(this.pitch), Math.sin(this.pitch),
      Math.cos(this.heading) * Math.cos(this.pitch)), this.speed * dt);
  }
  apply(obj: THREE.Object3D) {
    obj.position.copy(this.pos);
    obj.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
  }
}

export interface WhaleEntry {
  key: string; name: string; biome: string; biomeLabel: string; biomeShort: string; color: string; fact: string;
  files: Partial<Record<'A' | 'B' | 'lite', string>>; sizes: Partial<Record<'A' | 'B' | 'lite', number>>;
}

export async function loadManifest(): Promise<WhaleEntry[]> {
  const r = await fetch('/assets/whales/manifest.json');
  return r.ok ? (await r.json() as WhaleEntry[]) : [];
}
