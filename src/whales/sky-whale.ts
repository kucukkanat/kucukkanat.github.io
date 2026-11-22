// SkyWhale: runtime controller for a sky whale - a Blender-built species body (public/assets/whales, built by
// whales/scripts) made into an individual by its genome, carrying an ecosystem grown from the same seed.
//
//   const whale = new SkyWhale(gltf, { genome: makeGenome('my-seed'), detail: 'full' });
//   parent.add(whale.object); whale.addEffectsTo(parent);
//   // every frame, after you've moved/rotated whale.object:
//   whale.update(dt);
//
// * plays the baked `cruise` loop and turns the static reaction poses (body_*) into ADDITIVE clips driven by the
//   whale's own acceleration through critically damped springs
// * measures that motion (linear and angular acceleration, gravity in the whale's frame) and hands it to the
//   ecosystem: trees and lanterns swing on their own springs, lakes slosh and spill, boulders roll, animals bolt
// * individual proportions (bone scales) and procedural skin from the genome
// * biome particles, blowhole spouts shaped per species, vapour trails off the fluke tips
// * style B ("toon" in the GLB metadata): cel-shading + inverted-hull outline
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { makeGenome, classicSeed, type Genome } from './genome';
import { Ecosystem, type EcoCtx, type IslandInfo } from './ecosystem';
import { makeEnv, Puffs, Ribbon, type WhaleEnv } from './effects';
import { patchSkin, restMatrix, skinUniforms, type SkinUniforms } from './skin';
import type { ParticleCfg } from './biomes';

const REACTIONS = ['bankL', 'bankR', 'climb', 'dive', 'accel'] as const;
type Part = 'body' | 'eco';
type Axis = 'bank' | 'pitch' | 'accel';

export interface WhaleInfo {
  species: string; name: string; biome: string; biomeLabel: string; style: 'A' | 'B'; styleLabel: string;
  length: number; toon: boolean; lod?: 'full' | 'lite';
  island?: IslandInfo;
  spoutEvery?: number;
  stats: { triangles: number; bones: number; trees: number; props: number; lakes: number; waterfalls: number; animals: number };
}

export interface SkyWhaleOptions {
  /** Who this whale is. Default: the species' classic individual on its home biome. */
  genome?: Genome;
  /** 'full': simulated ecosystem; 'cheap': merged, static planting (far whales, phones); 'none': the bare whale. */
  detail?: 'full' | 'cheap' | 'none';
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

const GLOWING = new Set(['fireflies', 'embers', 'spores']);
/** Blowhole jets per species: directions in the whale's frame (+X left, +Y up, +Z forward), and strength. */
const SPOUTS: Record<string, { dirs: [number, number, number][]; power: number }> = {
  blue: { dirs: [[0, 1, 0.05]], power: 1.35 },                               // one tall column
  sperm: { dirs: [[0.5, 0.62, 0.6]], power: 0.9 },                           // a single blowhole: forward and to the left
  beluga: { dirs: [[0, 1, 0.1]], power: 0.55 },
  humpback: { dirs: [[0.16, 1, 0], [-0.16, 1, 0]], power: 0.95 },            // bushy
  bowhead: { dirs: [[0.42, 1, 0], [-0.42, 1, 0]], power: 1.0 },              // a wide V
  minke: { dirs: [[0.1, 1, 0.1], [-0.1, 1, 0.1]], power: 0.6 },
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

export class SkyWhale {
  readonly object: THREE.Group;
  readonly info: WhaleInfo;
  readonly genome: Genome;
  readonly L: number;
  readonly mixer: THREE.AnimationMixer;
  readonly cruise: THREE.AnimationAction;
  readonly reaction: Record<string, THREE.AnimationAction> = {};
  readonly springs: Record<Part, Record<Axis, Spring>>;
  readonly particles: (Particles & { cfg: ParticleCfg; c1: THREE.Color; c2: THREE.Color; acc: number }) | null;
  /** Everything simulated in the motion space (particles, mist, waterfalls, birds). Add it with addEffectsTo. */
  readonly fx = new THREE.Group();
  /** Lighting and weather for the generated materials. The host keeps it current (see setEnvironment). */
  readonly env: WhaleEnv = makeEnv();
  readonly eco: Ecosystem | null = null;
  readonly body: THREE.SkinnedMesh | null = null;
  /** Uniforms of the procedural skin (for hosts that shade the body themselves). */
  readonly skin: SkinUniforms | null = null;
  time = 0;
  /** World scale of `object` (the motion space's units per glTF metre): reactions, tempo and particles follow it. */
  private k = 1;
  private baseSizes = new Map<THREE.PointsMaterial, number>();
  private opts: Required<Omit<SkyWhaleOptions, 'genome'>>;
  private skinned: THREE.SkinnedMesh[] = [];
  private blowhole: THREE.Object3D | undefined;
  private prevPos = new THREE.Vector3(); private velSm = new THREE.Vector3(); private acc = new THREE.Vector3();
  private prevQ = new THREE.Quaternion(); private angVel = new THREE.Vector3(); private angAcc = new THREE.Vector3();
  private first = true; private prime = false; private nextSpout = 4 + Math.random() * 6; private spoutT = 0; private spoutAcc = 0;
  private puffs: Puffs; private glow: Puffs;
  private trails: { bone: THREE.Object3D; ribbon: Ribbon }[] = [];
  private shape: { bone: THREE.Object3D; rest: THREE.Vector3; mul: THREE.Vector3 }[] = [];
  private pendingStartle = 0; private startleFrom: THREE.Vector3 | null = null; private visitor: THREE.Vector3 | null = null;
  private ctx: EcoCtx;

  constructor(gltf: GLTF, opts: SkyWhaleOptions = {}) {
    this.opts = { particles: true, outline: true, reactionGain: 1, space: null, spouts: true, detail: 'full', ...opts };
    this.object = gltf.scene;
    const raw = JSON.parse((gltf.scene.userData.whale as string) || '{}') as WhaleInfo & { stats?: Partial<WhaleInfo['stats']> };
    const genome = this.genome = opts.genome ?? makeGenome(classicSeed(raw.species));
    this.L = raw.length || 12;
    this.object.traverse(o => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) this.skinned.push(o as THREE.SkinnedMesh);
    });
    this.body = this.skinned.find(m => m.name.startsWith('Whale_Body')) ?? this.skinned[0] ?? null;
    this.blowhole = this.object.getObjectByName('blowhole');

    this.mixer = new THREE.AnimationMixer(this.object);
    const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
    this.cruise = this.mixer.clipAction(clips.cruise);
    this.cruise.setLoop(THREE.LoopRepeat, Infinity).play();
    this.cruise.time = Math.random() * clips.cruise.duration;
    const ref = this.bindPoseClip(clips.rest ?? clips.cruise);
    for (const r of REACTIONS) {
      const src = clips[`body_${r}`]; if (!src) continue;
      const act = this.mixer.clipAction(THREE.AnimationUtils.makeClipAdditive(src.clone(), 0, ref));
      act.blendMode = THREE.AdditiveAnimationBlendMode;
      act.setEffectiveWeight(0); act.play();
      this.reaction[`body_${r}`] = act;
    }
    this.springs = {
      body: { bank: spring(26, 1.0), pitch: spring(22, 1.0), accel: spring(18, 1.0) },
      eco: { bank: spring(16, 0.22), pitch: spring(14, 0.25), accel: spring(12, 0.28) },
    };

    // ── the generated parts: read the body at rest, before anything moves it
    const full = this.opts.detail === 'full';
    this.puffs = new Puffs(full ? 900 : 260, this.env); this.glow = new Puffs(full ? 220 : 60, this.env, true);
    const toon = !!raw.toon;
    if (this.body && raw.island) {
      const rest = restMatrix(this.body, this.object);
      if (this.opts.detail !== 'none') {
        (this as { eco: Ecosystem }).eco = new Ecosystem(this.body, this.object, raw.island, genome, this.L, this.env, this.puffs, this.glow,
          { detail: full ? 'full' : 'cheap', toon, material: t => this.ecoMaterial(t) });
        this.object.add(this.eco!.group); this.fx.add(this.eco!.fx);
      }
      const backY = this.eco ? this.eco.back.topY[this.eco.back.row(raw.island.center[2])] : raw.island.center[1];
      (this as { skin: SkinUniforms }).skin = skinUniforms(genome, raw.island, backY, this.L, rest);
    }
    const st = this.eco?.stats;
    const bodyTris = this.body ? (this.body.geometry.index?.count ?? 0) / 3 : 0;
    this.info = {
      ...raw, name: raw.name, biome: genome.biome.key, biomeLabel: genome.biome.label,
      stats: { triangles: Math.round(bodyTris + (st?.triangles ?? 0)), bones: this.body?.skeleton.bones.filter(b => !/^(tree_|water_)/.test(b.name)).length ?? 0,
        trees: st?.trees ?? 0, props: st?.props ?? 0, lakes: st?.lakes ?? 0, waterfalls: st?.waterfalls ?? 0, animals: st?.animals ?? 0 },
    };
    // ── this individual's proportions (applied over the animation every frame)
    const bone = (n: string) => this.object.getObjectByName(n);
    const addShape = (n: string, mul: THREE.Vector3) => { const b = bone(n); if (b) this.shape.push({ bone: b, rest: b.scale.clone(), mul }); };
    const root = bone('root');
    if (root) {
      // girth: scale across the body, not along it (find the bone axis that runs nose to tail)
      const zLocal = new THREE.Vector3(0, 0, 1).transformDirection(_m.copy(root.matrixWorld).invert());
      const along = Math.abs(zLocal.x) > 0.7 ? 'x' : Math.abs(zLocal.y) > 0.7 ? 'y' : 'z';
      const mul = new THREE.Vector3(genome.girth, genome.girth, genome.girth); mul[along] = 1;
      addShape('root', mul);
    }
    for (const s of ['L', 'R']) addShape(`fin_${s}_1`, new THREE.Vector3().setScalar(genome.flipper));
    addShape('fluke', new THREE.Vector3().setScalar(genome.fluke));
    addShape('head', new THREE.Vector3().setScalar(genome.head));

    this.setupMaterials(toon);
    this.particles = this.opts.particles ? this.makeParticles() : null;
    if (this.particles) this.fx.add(this.particles.pts);
    this.fx.add(this.puffs.pts, this.glow.pts);
    if (full) for (const n of ['fluke_L_2', 'fluke_R_2']) {
      const b = bone(n); if (!b) continue;
      const ribbon = new Ribbon({ nodes: 24, interval: 0.1, width: 0.05 * this.L / 14, widen: 5, gravity: 0, drag: 0.5, color: new THREE.Color(1, 1, 1), opacity: 0.3, streaks: 0.5 }, this.env);
      this.trails.push({ bone: b, ribbon }); this.fx.add(ribbon.mesh);
    }
    this.ctx = { dt: 0, time: 0, k: 1, M: new THREE.Matrix4(), q: new THREE.Quaternion(), vel: this.velSm, sig: new THREE.Vector3(), g: new THREE.Vector3(0, -1, 0), w: this.angVel, wd: this.angAcc, aRef: 1,
      night: 0, storm: 0, startle: 0, startleFrom: null, visitor: null, burst: (p, n) => this.burst(p, n) };
    this.setScale(1);
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
  /** The lit material of the generated island (vertex colours; lantern glass glows at night). */
  private ecoMaterial(toon: boolean): THREE.Material {
    const mat = toon
      ? new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: this.toonGradient() })
      : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const env = this.env;
    mat.onBeforeCompile = sh => {
      sh.uniforms.uNight = env.uNight;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n uniform float uNight;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          #ifdef USE_COLOR
            totalEmissiveRadiance += vec3(1.0, 0.7, 0.36) * step(length(vColor.rgb - vec3(1.0, 0.694, 0.214)), 0.03) * (0.25 + 2.6 * uNight);
          #endif`);
    };
    mat.customProgramCacheKey = () => 'whale-eco';
    return mat;
  }
  private grad: THREE.DataTexture | null = null;
  private toonGradient() {
    if (!this.grad) {
      this.grad = new THREE.DataTexture(new Uint8Array([125, 125, 125, 255, 195, 195, 195, 255, 255, 255, 255, 255]), 3, 1);
      this.grad.minFilter = this.grad.magFilter = THREE.NearestFilter; this.grad.needsUpdate = true;
    }
    return this.grad;
  }

  private setupMaterials(toon: boolean) {
    for (const mesh of this.skinned) {
      if (mesh !== this.body) continue;
      const m = mesh.material as THREE.MeshStandardMaterial;
      let out: THREE.Material = m;
      if (toon) mesh.material = out = new THREE.MeshToonMaterial({ map: m.map ?? null, normalMap: m.normalMap ?? null, gradientMap: this.toonGradient(), side: m.side });
      out.userData.role = 'body';
      if (this.skin) patchSkin(out, this.skin);
    }
    if (toon && this.opts.outline && this.body) {
      const mesh = this.body, width = this.L * 0.0028;
      const mat = new THREE.MeshBasicMaterial({ color: 0x1a1220, side: THREE.BackSide });
      mat.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
          `#include <begin_vertex>\n transformed += normalize(objectNormal) * ${width.toFixed(4)};`);
      };
      const hull = new THREE.SkinnedMesh(mesh.geometry, mat);
      hull.bind(mesh.skeleton, mesh.bindMatrix);
      hull.position.copy(mesh.position); hull.quaternion.copy(mesh.quaternion); hull.scale.copy(mesh.scale);
      hull.frustumCulled = false; hull.userData.ecoCustom = true; hull.name = 'Whale_Outline';
      mesh.parent!.add(hull);
    }
  }

  // ---------------------------------------------------------------- particles (in `space`)
  private sprite(kind: string) {
    return canvasTexture(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      if (kind === 'leaves' || kind === 'petals') {
        g.fillStyle = '#fff'; g.beginPath();
        g.ellipse(32, 32, kind === 'petals' ? 22 : 26, kind === 'petals' ? 14 : 12, 0.6, 0, Math.PI * 2); g.fill();
      } else if (kind === 'bubbles') {
        g.strokeStyle = '#fff'; g.lineWidth = 5; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(23, 22, 5, 0, Math.PI * 2); g.fill();
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
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.userData.ecoCustom = true;
    this.baseSizes.set(mat, size);
    const P = { pts, pos, col, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), N, scale: this.L / 14 };
    for (let i = 0; i < N; i++) { P.life[i] = -1; pos[i * 3 + 1] = -1e5; }
    return P;
  }

  private makeParticles() {
    const cfg = this.genome.biome.particles; if (!this.info.island) return null;
    const P = this.points(cfg.count * 2, this.sprite(cfg.kind), cfg.size * (GLOWING.has(cfg.kind) ? 1.5 : 2.2) * (this.L / 14), false);
    return { ...P, cfg, c1: new THREE.Color(cfg.color), c2: new THREE.Color(cfg.color2), acc: 0 };
  }

  /** Add the effects to the group they simulate in (the `space` option, or the scene). */
  addEffectsTo(parent: THREE.Object3D) { parent.add(this.fx); }
  removeEffectsFrom(_parent?: THREE.Object3D) { this.fx.removeFromParent(); }
  setParticlesVisible(on: boolean) { if (this.particles) this.particles.pts.visible = on; }
  /** Mist, spray, smoke, rain and spouts (off on the phone tier). */
  setMistVisible(on: boolean) { this.puffs.setVisible(on); this.glow.setVisible(on); for (const t of this.trails) t.ribbon.mesh.visible = on; }

  /** Set the whale's world scale (also sets object.scale; the individual's own size is applied on top). */
  setScale(k: number) {
    this.k = k * this.genome.size; this.object.scale.setScalar(this.k);
    for (const [m, s] of this.baseSizes) m.size = s * this.k;
    if (this.particles) this.particles.scale = (this.L / 14) * this.k;
    this.resetMotion();
  }
  get scale() { return this.k; }
  /** Change the space motion and particles are measured in (see the `space` option). */
  setSpace(space: THREE.Object3D | null) { this.opts.space = space; this.resetMotion(); }
  /** Forget the previous position (after teleporting / re-parenting). */
  resetMotion() {
    this.first = true; this.velSm.set(0, 0, 0); this.acc.set(0, 0, 0); this.angVel.set(0, 0, 0); this.angAcc.set(0, 0, 0);
    this.eco?.resetMotion(); for (const t of this.trails) t.ribbon.reset();
  }

  /** Night and storm, 0..1 (lanterns, fireflies, roosting birds, rain). The host also sets `env` colours itself. */
  setEnvironment(night: number, storm: number) { this.env.uNight.value = night; this.env.uStorm.value = storm; }
  /** Frighten the island (a click, a near miss): birds scatter, grazers bolt, the lakes shiver. */
  startle(strength = 1, from: THREE.Vector3 | null = null) { this.pendingStartle = Math.max(this.pendingStartle, strength); this.startleFrom = from; }
  /** Something to notice, in world coordinates (the airship, the camera) - or null. */
  setVisitor(world: THREE.Vector3 | null) { this.visitor = world; }

  /** The whale's transform in the space it moves in. */
  private localMatrix(out: THREE.Matrix4) {
    this.object.updateMatrixWorld();
    out.copy(this.object.matrixWorld);
    const s = this.opts.space;
    if (s) { s.updateMatrixWorld(); out.premultiply(_m.copy(s.matrixWorld).invert()); }
    return out;
  }

  triggerSpout() { if (this.blowhole) { this.spoutT = 0.85; } }

  /** Shed biome particles at a motion-space point. */
  private burst(p: THREE.Vector3, n: number) {
    const P = this.particles; if (!P || !P.pts.visible) return;
    for (let q = 0; q < n; q++) {
      const i = P.life.findIndex(l => l <= 0); if (i < 0) return;
      const j = this.k * this.L / 14;
      P.pos.set([p.x, p.y, p.z], i * 3);
      P.vel.set([this.velSm.x * 0.8 + (Math.random() - 0.5) * 1.5 * j, this.velSm.y * 0.8 + Math.random() * 0.8 * j, this.velSm.z * 0.8 + (Math.random() - 0.5) * 1.5 * j], i * 3);
      P.max[i] = P.life[i] = 2 + Math.random() * 2.5;
      const c = _c.copy(P.c1).lerp(P.c2, Math.random()); P.col.set([c.r, c.g, c.b], i * 3);
    }
  }

  private stepParticles(dt: number, M: THREE.Matrix4, rel: THREE.Matrix4) {
    const P = this.particles, isl = this.info.island;
    if (P && P.pts.visible && isl) {
      const cfg = P.cfg;
      P.acc += dt * cfg.count / 3.5;
      while (P.acc >= 1) {
        P.acc -= 1;
        const i = P.life.findIndex(l => l <= 0); if (i < 0) break;
        const top = this.eco?.top ?? isl.top;
        _v.set((Math.random() * 2 - 1) * isl.halfWidth, top - 0.5 * (this.L / 14) + Math.random() * 1.2 * (this.L / 14), isl.center[2] + (Math.random() * 2 - 1) * isl.halfLength).applyMatrix4(M);
        P.pos.set([_v.x, _v.y, _v.z], i * 3);
        const k = GLOWING.has(cfg.kind) ? 0.85 : 0.75, j = this.k;
        P.vel.set([this.velSm.x * k + (Math.random() - 0.5) * 0.6 * j, this.velSm.y * k + (Math.random() - 0.2) * 0.5 * j,
          this.velSm.z * k + (Math.random() - 0.5) * 0.6 * j], i * 3);
        P.max[i] = P.life[i] = 3 + Math.random() * 3;
        const c = _c.copy(P.c1).lerp(P.c2, Math.random());
        P.col.set([c.r, c.g, c.b], i * 3);
      }
      const drag = Math.exp(-cfg.drag * dt);
      const wander = cfg.kind !== 'sand' && cfg.kind !== 'snow';
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
    // the blow: jets of vapour that hang and drift behind
    if (this.spoutT > 0 && this.blowhole) {
      this.spoutT -= dt;
      const sp = SPOUTS[this.info.species] ?? SPOUTS.blue, U = this.L / 14 * this.k;
      const p = this.blowhole.getWorldPosition(_v).applyMatrix4(rel), q = this.ctx.q;
      const strength = Math.min(1, this.spoutT / 0.3) * sp.power;
      this.spoutAcc += dt * 190;
      while (this.spoutAcc >= 1) {
        this.spoutAcc -= 1;
        const d = sp.dirs[Math.floor(Math.random() * sp.dirs.length)];
        _v2.set(d[0] + (Math.random() - 0.5) * 0.28, d[1], d[2] + (Math.random() - 0.5) * 0.28).normalize().applyQuaternion(q).multiplyScalar((3.2 + Math.random() * 3.2) * U * strength).add(this.velSm);
        this.puffs.emit(p.x, p.y, p.z, _v2.x, _v2.y, _v2.z, { life: 1.5 + Math.random() * 1.3, size: (0.1 + Math.random() * 0.1) * U, grow: 4.5, alpha: 0.5, drag: 1.5, gravity: -1.1 * U, color: WHITE });
      }
    }
    // the air near the whale is dragged along with it: mist and smoke trail, but not at full speed
    const ax = this.velSm.x * 0.55, ay = this.velSm.y * 0.55, az = this.velSm.z * 0.55;
    this.puffs.step(dt, ax, ay, az); this.glow.step(dt, ax, ay, az);
  }

  // ---------------------------------------------------------------- main update
  /** Call once per frame after moving `object`. `animate: false` skips the skeleton (far / hidden whales). */
  update(dt: number, animate = true) {
    dt = Math.min(dt, 1 / 20);
    this.time += dt; this.env.uTime.value = this.time;
    const M = this.localMatrix(this.ctx.M);
    const p = new THREE.Vector3(), q = this.ctx.q; M.decompose(p, q, _v2);   // (the matrix carries the whale's scale)
    if (this.first) { this.prevPos.copy(p); this.prevQ.copy(q); this.first = false; this.prime = true; }
    const idt = 1 / Math.max(dt, 1e-4);
    const vel = p.clone().sub(this.prevPos).multiplyScalar(idt);
    // the first real sample after a reset sets the velocity outright: appearing at speed is not an acceleration
    if (this.prime && vel.lengthSq() > 0) { this.velSm.copy(vel); this.prime = false; }
    this.prevPos.copy(p);
    const prevSm = this.velSm.clone();
    this.velSm.lerp(vel, 1 - Math.exp(-dt * 6));
    const acc = this.velSm.clone().sub(prevSm).multiplyScalar(idt);
    this.acc.lerp(acc, 1 - Math.exp(-dt * 5));
    // angular velocity in the whale's own frame, from the rotation since last frame
    const dq = this.prevQ.clone().invert().multiply(q); this.prevQ.copy(q);
    if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
    const prevW = this.angVel.clone();
    this.angVel.lerp(_v.set(dq.x, dq.y, dq.z).multiplyScalar(2 * idt), 1 - Math.exp(-dt * 6));
    this.angAcc.lerp(_v.copy(this.angVel).sub(prevW).multiplyScalar(idt), 1 - Math.exp(-dt * 5));

    // acceleration + gravity in the whale's own frame (+X left, +Y up, +Z forward)
    const qInv = q.clone().invert();
    const aL = this.acc.clone().applyQuaternion(qInv);
    const gL = this.ctx.g.set(0, -1, 0).applyQuaternion(qInv);
    const aRef = 0.9 * this.L * this.k / 14 * 6;
    const g = this.opts.reactionGain;
    const clamp = (x: number) => Math.max(-1, Math.min(1, x));
    this.ctx.sig.copy(aL).multiplyScalar(g / aRef);
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
      if (part === 'eco') continue;
      this.w(`body_bankL`, Math.max(0, b)); this.w(`body_bankR`, Math.max(0, -b));
      this.w(`body_climb`, Math.max(0, pt)); this.w(`body_dive`, Math.max(0, -pt));
      this.w(`body_accel`, Math.max(0, ac));
    }
    const speed = this.velSm.length();
    this.cruise.timeScale = (0.55 + Math.min(1.6, speed / (this.L * this.k * 0.45)) * 0.7 + this.springs.body.accel.x * 0.6) * this.genome.tempo;
    if (animate) {
      this.mixer.update(dt);
      for (const s of this.shape) s.bone.scale.copy(s.rest).multiply(s.mul);
    }
    if (this.opts.spouts && this.time > this.nextSpout) {
      this.triggerSpout(); this.nextSpout = this.time + (this.info.spoutEvery ?? 12) * (0.8 + Math.random() * 0.4);
    }
    this.object.updateMatrixWorld(true);
    const rel = _m.copy(M).multiply(new THREE.Matrix4().copy(this.object.matrixWorld).invert());   // world -> motion space
    if (this.eco) {
      const c = this.ctx;
      c.dt = dt; c.time = this.time; c.k = this.k; c.aRef = aRef / (this.k * g || 1);
      c.night = this.env.uNight.value; c.storm = this.env.uStorm.value;
      c.startle = this.pendingStartle; c.startleFrom = this.startleFrom; this.pendingStartle = 0;
      // the visitor, in the whale's frame - only when close enough to matter
      c.visitor = null;
      if (this.visitor) {
        const v = this.object.worldToLocal(_v2.copy(this.visitor));
        if (v.length() < this.L * 4) c.visitor = v.clone();
      }
      this.eco.update(c);
    }
    // vapour trails off the fluke tips, stronger at speed
    if (this.trails.length) {
      const flow = Math.min(1, Math.max(0, speed / (this.L * this.k * 0.42) - 0.35));
      for (const t of this.trails) {
        t.bone.getWorldPosition(_v).applyMatrix4(rel);
        t.ribbon.flow = flow; t.ribbon.step(dt, _v, _v2.set(0, 0, 0), this.k, _v2);
      }
    }
    this.stepParticles(dt, M, rel);
  }

  private w(name: string, w: number) { this.reaction[name]?.setEffectiveWeight(Math.min(1.25, w)); }

  get meters(): Record<Part, Record<Axis, number>> {
    const m = (p: Part) => ({ bank: this.springs[p].bank.x, pitch: this.springs[p].pitch.x, accel: this.springs[p].accel.x });
    return { body: m('body'), eco: m('eco') };
  }

  /** Velocity in the whale's motion space (smoothed). */
  get velocity() { return this.velSm; }

  dispose() { this.mixer.stopAllAction(); this.eco?.dispose(); }
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
