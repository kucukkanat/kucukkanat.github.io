// The Librarian: clips through one AnimationMixer with crossfades, a small state machine, procedural layers
// (look-at, breathing, jaw flaps while speaking) and the fetch choreography (walk or ladder ride, reach + two-bone
// IK, grab, carry, hand over, drop on the table).
//
// glTF bone names lose their dots in three.js (PropertyBinding.sanitizeNodeName): upper_arm.R -> upper_armR.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { solveTwoBone } from './ik';
import type { Emote } from './types';
/** Per-character runtime settings (characters/<id>.json "runtime" in the Librarian repo). */
export interface RuntimeConfig { jaw_max_deg: number; palm_half_thickness: number; stand_off: number }

export type State = 'idle' | 'listening' | 'thinking' | 'talking' | 'fetching' | 'handing_over';
export type Events = Record<string, Record<string, number>> & { _clips: Record<string, { duration: number; loop: boolean; speed?: number }> };

export interface RoomNodes {
  get(name: string): THREE.Object3D | undefined;
}

// the right arm and every joint of its five fingers (glTF names lose their dots: index.01.R -> index01R)
const RIGHT_ARM_RE = /^(shoulder|upper_arm|forearm|hand|(thumb|index|middle|ring|pinky)\d\d)R\./;
const FADE = 0.3;
const TURN_RATE = 5.0;       // rad/s
const CLIMB_TIME = 0.9;
const RIDE_SPEED = 0.9;      // m/s along the rail

const INTERRUPT = Symbol('interrupt');
const sane = (n: string) => n.replace(/[\[\]\.:\/]/g, '');
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _w = new THREE.Vector3();

export class Librarian {
  readonly root = new THREE.Group();          // moved around the room; the model sits inside, facing +Z
  readonly model: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  state: State = 'idle';
  onState?: (s: State) => void;
  onBookLanded?: (topicId: string) => void;
  ikTarget = new THREE.Vector3();
  ikWeight = 0;
  lookTarget: THREE.Vector3 | null = null;
  lookWeight = 1;
  /** Where he looks when nothing in his own choreography asks for his eyes (set by the app: a hovered book,
   *  a glance around the room); null = the visitor. */
  attention: THREE.Vector3 | null = null;

  private actions = new Map<string, THREE.AnimationAction>();
  private animated = new Map<THREE.Bone, THREE.Quaternion>();
  private procedural: THREE.Bone[] = [];
  private base: THREE.AnimationAction | null = null;
  private overlay: THREE.AnimationAction | null = null;
  private bones = new Map<string, THREE.Bone>();
  private jawRest = new THREE.Quaternion();
  private jawOpen = 0;
  private speech = '';
  private speechClock = 0;
  private syllable = 0;
  private yaw = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private time = 0;
  private waiters: { test: () => boolean; resolve: () => void }[] = [];
  private eventPrev = new Map<THREE.AnimationAction, number>();
  private emoteQueue: Emote[] = [];
  private busy = false;
  private errand = false;
  private interrupted = false;
  private ikRelax = false;
  onSyllable?: () => void;

  private jawMax: number;
  private swings: { bone: THREE.Bone; k: number; damp: number; gain: number; prev: THREE.Vector3 | null; vel: THREE.Vector3; ang: THREE.Vector2; angVel: THREE.Vector2 }[] = [];

  constructor(gltf: GLTF, private room: RoomNodes, private events: Events, shadowTex: THREE.Texture | undefined,
    private cfg: RuntimeConfig) {
    this.jawMax = THREE.MathUtils.degToRad(cfg.jaw_max_deg);
    this.model = gltf.scene;
    this.root.add(this.model);
    this.model.traverse(o => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.frustumCulled = false; }
    });
    this.jawRest.copy(this.bone('jaw').quaternion);
    this.measurePalm();
    this.procedural = ['upper_chest', 'neck', 'head', 'upper_arm.R', 'forearm.R'].map(n => this.bone(n));
    // swinging accessories (satchel on the hip, compass pendant): damped springs driven by how the bone moves
    // [bone, stiffness, damping, gain]: the cape is heavy and slow, and each lower link swings a little further
    for (const [name, k, damp, gain] of [['satchel', 60, 7, 0.018], ['pendant', 90, 5, 0.03], ['spyglass', 80, 6, 0.025],
      ['sword', 70, 8, 0.012], ['cape.01', 22, 4, 0.008], ['cape.02', 26, 4, 0.011], ['cape.03', 30, 4, 0.014]] as const) {
      const b = this.bones.get(sane(name));
      if (!b) continue;
      this.procedural.push(b);
      this.swings.push({ bone: b, k, damp, gain, prev: null, vel: new THREE.Vector3(), ang: new THREE.Vector2(), angVel: new THREE.Vector2() });
    }
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const clip of gltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    // derived layers: the carry pose of the right arm (hand_over at t=0), and walk/idle without the right arm
    const hand = gltf.animations.find(c => c.name === 'hand_over')!;
    const carry = THREE.AnimationUtils.subclip(hand, 'carry', 0, 2, 30);
    carry.tracks = carry.tracks.filter(t => RIGHT_ARM_RE.test(t.name));
    this.actions.set('carry', this.mixer.clipAction(carry));
    for (const n of ['walk', 'idle']) {
      const src = gltf.animations.find(c => c.name === n)!;
      const c = new THREE.AnimationClip(`${n}_carry`, src.duration, src.tracks.filter(t => !RIGHT_ARM_RE.test(t.name)));
      this.actions.set(`${n}_carry`, this.mixer.clipAction(c));
    }
    for (const [name, a] of this.actions) {
      const meta = events._clips[name];
      if (meta && !meta.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    // soft blob shadow on the floor (the room's bake knows nothing about him)
    if (shadowTex) {
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
        new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55, color: '#000' }));
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.012;
      blob.name = 'BlobShadow';
      blob.renderOrder = 1;
      this.root.add(blob);
    }
    const anchor = room.get('Librarian');
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      anchor.getWorldPosition(this.root.position);
      anchor.getWorldQuaternion(_q);
      this.yaw = new THREE.Euler().setFromQuaternion(_q, 'YXZ').y;
    }
    this.root.rotation.set(0, this.yaw, 0);
    this.play('idle', 0);
  }

  bone(name: string): THREE.Bone {
    const b = this.bones.get(sane(name));
    if (!b) throw new Error(`no bone ${name}`);
    return b;
  }

  get clipNames() { return [...this.actions.keys()]; }

  // ------------------------------------------------------------ clips
  play(name: string, fade = FADE, timeScale = 1): THREE.AnimationAction {
    const next = this.actions.get(name)!;
    if (next === this.base && next.isRunning() && next.loop !== THREE.LoopOnce) return next;
    next.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(1).play();
    if (this.base && this.base !== next) this.base.crossFadeTo(next, fade, false);
    this.base = next;
    this.eventPrev.set(next, 0);
    return next;
  }

  setOverlay(name: string | null, fade = 0.2) {
    const next = name ? this.actions.get(name)! : null;
    if (next === this.overlay) return;
    if (this.overlay) this.overlay.fadeOut(fade);
    if (next) { next.reset().setEffectiveWeight(1).fadeIn(fade).play(); this.eventPrev.set(next, 0); }
    this.overlay = next;
  }

  /** Play a one-shot on the base layer and resolve when it ends (events fire on the way). */
  async once(name: string, onEvent?: (e: string) => void, fade = FADE): Promise<void> {
    const a = this.play(name, fade);
    const dur = a.getClip().duration;
    const ev = this.events[name] ?? {};
    await this.until(() => {
      const t = a.time;
      const prev = this.eventPrev.get(a) ?? 0;
      for (const [k, at] of Object.entries(ev)) if (prev < at && t >= at) onEvent?.(k);
      this.eventPrev.set(a, t);
      return !a.isRunning() || t >= dur - 1e-3 || this.base !== a || this.interrupted;
    });
  }

  private until(test: () => boolean): Promise<void> {
    return new Promise(resolve => this.waiters.push({ test, resolve }));
  }

  private wait(s: number) { const end = this.time + s; return this.until(() => this.time >= end); }

  setState(s: State) {
    if (this.state === s) return;
    this.state = s;
    this.onState?.(s);
    if (this.busy) return;
    if (s === 'idle') {
      const r = Math.random();
      const hilt = this.actions.has('idle_hilt');
      this.play(r < (hilt ? 0.5 : 0.7) ? 'idle' : hilt && r < 0.8 ? 'idle_hilt' : 'idle_shift');
    }
    if (s === 'listening') this.play('idle');
    if (s === 'thinking') this.play('think');
    if (s === 'talking') this.play(Math.random() < 0.5 ? 'talk_a' : 'talk_b');
  }

  /** Queue an emote; it plays when he is not fetching, then returns to talk/idle. */
  emote(kind: Emote) {
    // a character with a hat-tip greets with it instead of the wave
    if (kind === 'wave' && this.actions.has('tip_hat')) kind = 'tip_hat' as Emote;
    if (kind === 'think') { if (!this.busy) this.play('think'); return; }
    this.emoteQueue.push(kind);
  }

  // ------------------------------------------------------------ speech
  /** Add text to be spoken: jaw flaps per syllable at a reading pace, with blips via onSyllable. */
  speak(text: string) { this.speech += text; }
  get speaking() { return this.speech.length > 0; }
  get speechLeft() { return this.speech.length; }

  private updateSpeech(dt: number) {
    if (!this.speech) { this.jawOpen = Math.max(0, this.jawOpen - dt * 8); return; }
    this.speechClock += dt;
    const rate = 15; // characters per second
    while (this.speechClock > 1 / rate && this.speech) {
      this.speechClock -= 1 / rate;
      const ch = this.speech[0];
      this.speech = this.speech.slice(1);
      if (/[aeiouy]/i.test(ch) && this.syllable <= 0) { this.syllable = 0.11; this.onSyllable?.(); }
      if (/[.,!?;:]/.test(ch)) this.speechClock -= 0.18;
    }
    this.syllable -= dt;
    const target = this.syllable > 0 ? Math.sin((1 - this.syllable / 0.11) * Math.PI) : 0;
    this.jawOpen += (target - this.jawOpen) * Math.min(1, dt * 25);
  }

  // ------------------------------------------------------------ per frame
  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    // three's PropertyMixer only writes a value when it changed since its last write, so a constant track would
    // not overwrite last frame's procedural offsets (they accumulated). Put the animated values back first.
    for (const [b, q] of this.animated) b.quaternion.copy(q);
    this.mixer.update(dt);
    for (const b of this.procedural) {
      if (!this.animated.has(b)) this.animated.set(b, new THREE.Quaternion());
      this.animated.get(b)!.copy(b.quaternion);
    }
    this.root.updateMatrixWorld(true);
    this.updateSpeech(dt);
    // the jaw is never animated by clips: rest pose + speech
    const jaw = this.bone('jaw');
    jaw.quaternion.copy(this.jawRest);
    this.rotateModelAxis(jaw, 1, 0, 0, this.jawOpen * this.jawMax);
    // breathing on top of every clip (slow, small)
    const br = Math.sin(this.time * 2 * Math.PI / 4.2);
    this.rotateModelAxis(this.bone('upper_chest'), 1, 0, 0, -0.012 * br);
    this.updateLook(dt, camera);
    this.updateSwings(dt);
    if (this.ikRelax) { this.ikWeight = Math.max(0, this.ikWeight - dt * 3); this.ikRelax = this.ikWeight > 0; }
    if (this.ikWeight > 0) {
      const pole = this.modelPoint(-0.45, 0.6, -0.35);
      solveTwoBone(this.bone('upper_arm.R'), this.bone('forearm.R'), this.bone('prop.R'), this.ikTarget, pole, this.ikWeight);
    }
    this.model.updateMatrixWorld(true);
    this.applyGrip();
    // idle chatter: emotes and talk loops when not busy
    if (!this.busy && this.emoteQueue.length) {
      const e = this.emoteQueue.shift()!;
      this.busy = true;
      void this.once(e).then(() => { this.busy = false; this.resume(); });
    } else if (!this.busy && this.state === 'talking' && !this.speaking && this.emoteQueue.length === 0) {
      this.setState('idle');
    }
    for (const w of [...this.waiters]) if (w.test()) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(); }
  }

  private resume() {
    const s = this.state;
    this.state = 'idle';
    this.setState(s === 'talking' && !this.speaking ? 'idle' : s);
    if (this.state === 'idle') this.play('idle');
  }

  private updateLook(dt: number, camera: THREE.Camera) {
    const head = this.bone('head');
    const tgt = this.lookTarget ?? this.attention ?? camera.getWorldPosition(_w);
    head.getWorldPosition(_v);
    const d = tgt.clone().sub(_v);
    // into model space
    this.model.getWorldQuaternion(_q);
    d.applyQuaternion(_q.invert());
    let yaw = Math.atan2(d.x, d.z);
    let pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    const ok = Math.abs(yaw) < THREE.MathUtils.degToRad(100);
    yaw = ok ? THREE.MathUtils.clamp(yaw, -0.85, 0.85) : 0;
    pitch = ok ? THREE.MathUtils.clamp(pitch, -0.4, 0.35) : 0;
    const k = 1 - Math.exp(-dt * 4);
    this.lookYaw += (yaw * this.lookWeight - this.lookYaw) * k;
    this.lookPitch += (pitch * this.lookWeight - this.lookPitch) * k;
    for (const [b, f] of [['neck', 0.4], ['head', 0.6]] as const) {
      this.rotateModelAxis(this.bone(b), 0, 1, 0, this.lookYaw * f);
      this.rotateModelAxis(this.bone(b), 1, 0, 0, -this.lookPitch * f);
    }
  }

  /** Pendulum swing for the satchel and pendant: the bone's world acceleration (walking, turning, stopping) pushes
   *  it the other way, a spring pulls it back. Angles in the character's frame, clamped. */
  private updateSwings(dt: number) {
    if (dt <= 0) return;
    const qInv = this.model.getWorldQuaternion(_q).invert();
    for (const s of this.swings) {
      const p = s.bone.getWorldPosition(new THREE.Vector3());
      if (!s.prev) { s.prev = p.clone(); continue; }
      const v = p.clone().sub(s.prev).divideScalar(dt);
      const acc = v.clone().sub(s.vel).divideScalar(dt).applyQuaternion(qInv);
      s.vel.copy(v);
      s.prev.copy(p);
      // forward/back acceleration (model z) tips it about X, sideways (model x) about Z
      const tx = THREE.MathUtils.clamp(acc.z * s.gain, -0.6, 0.6), tz = THREE.MathUtils.clamp(-acc.x * s.gain, -0.6, 0.6);
      s.angVel.x += (s.k * (tx - s.ang.x) - s.damp * s.angVel.x) * dt;
      s.angVel.y += (s.k * (tz - s.ang.y) - s.damp * s.angVel.y) * dt;
      s.ang.addScaledVector(s.angVel, dt);
      s.ang.clampScalar(-0.5, 0.5);
      if (!Number.isFinite(s.ang.x + s.ang.y)) { s.ang.set(0, 0); s.angVel.set(0, 0); }
      this.rotateModelAxis(s.bone, 1, 0, 0, s.ang.x);
      this.rotateModelAxis(s.bone, 0, 0, 1, s.ang.y);
    }
  }

  /** Rotate a bone about an axis given in model space (the character's own frame). */
  private rotateModelAxis(bone: THREE.Object3D, x: number, y: number, z: number, angle: number) {
    if (!angle) return;
    const axis = new THREE.Vector3(x, y, z).applyQuaternion(this.model.getWorldQuaternion(new THREE.Quaternion()));
    const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
    axis.applyQuaternion(pq).normalize();
    bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    bone.updateMatrixWorld(true);
  }

  private modelPoint(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.model.matrixWorld);
  }

  // ------------------------------------------------------------ locomotion
  private async turnTo(yaw: number) {
    let last = this.time;
    await this.until(() => {
      const dt = this.time - last;
      last = this.time;
      let d = yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const step = Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt);
      this.yaw += step;
      this.root.rotation.set(0, this.yaw, 0);
      return Math.abs(d) < 0.02 || this.interrupted;
    });
  }

  private async walkTo(x: number, z: number, carrying = false) {
    const speed = this.events._clips.walk.speed ?? 0.72;
    const target = new THREE.Vector3(x, this.root.position.y, z);
    if (target.distanceTo(this.root.position) < 0.05) return;
    this.play(carrying ? 'walk_carry' : 'walk', 0.25);
    let last = this.time;
    await this.until(() => {
      const dt = this.time - last;
      last = this.time;
      const to = target.clone().sub(this.root.position);
      to.y = 0;
      const dist = to.length();
      const want = Math.atan2(to.x, to.z);
      let d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE * dt);
      this.root.rotation.set(0, this.yaw, 0);
      // slow down while turning hard, stop at the target
      const v = Math.min(dist, speed * dt * Math.max(0.2, Math.cos(d)));
      this.root.position.addScaledVector(to.normalize(), v);
      return dist < 0.03 || this.interrupted;
    });
    this.play(carrying ? 'idle_carry' : 'idle', 0.3);
  }

  private async tween(dur: number, fn: (t: number) => void) {
    const start = this.time;
    await this.until(() => {
      const t = Math.min(1, (this.time - start) / dur);
      fn(t * t * (3 - 2 * t));
      return t >= 1 || this.interrupted;
    });
  }

  // ------------------------------------------------------------ errands
  /** True while he is pottering about on his own (tidying a shelf); `interrupt()` ends it at once. */
  get onErrand() { return this.errand; }
  async interrupt() {
    if (!this.errand) return;
    this.interrupted = true;
    await this.until(() => !this.errand);
    this.interrupted = false;
  }

  /** Left alone, he straightens a book on a shelf at about `spine` and comes back to where he stood. */
  async tidy(spine: THREE.Vector3) {
    if (this.busy) return;
    this.busy = this.errand = true;
    const home = this.root.position.clone(), homeYaw = this.yaw;
    const stop = () => { if (this.interrupted) throw INTERRUPT; };
    try {
      this.lookWeight = 0.5;
      await this.walkTo(spine.x - 0.18, spine.z + 0.1 + this.cfg.stand_off); stop();
      await this.turnTo(Math.PI); stop();
      this.lookTarget = spine;
      this.lookWeight = 1;
      this.ikTarget.copy(spine);
      const reach = this.once('reach_mid', undefined, 0.3);
      await this.tween(this.events._clips.reach_mid.duration * 0.5, t => { this.ikWeight = 0.85 * t; }); stop();
      await reach; stop();
      await this.tween(0.5, t => { this.ikWeight = 0.85 * (1 - t); }); stop();
      this.ikWeight = 0;
      this.lookTarget = null;
      this.lookWeight = 0.5;
      await this.walkTo(home.x, home.z); stop();
      await this.turnTo(homeYaw); stop();
    } catch (e) {
      if (e !== INTERRUPT) throw e;
    } finally {
      this.ikRelax = this.ikWeight > 0;
      this.lookTarget = null;
      this.lookWeight = 1;
      this.busy = this.errand = false;
      if (this.state === 'idle' || this.state === 'listening') this.play('idle', 0.3);
    }
  }

  // ------------------------------------------------------------ the fetch
  private held: { book: THREE.Object3D; parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; id: string } | null = null;
  private onTable: typeof this.held = null;

  /** Walk (or ride the ladder) to the book, take it, bring it to the table, hand it over. */
  async fetch(topicId: string) {
    if (this.busy) return;
    const book = this.room.get(`Book_${topicId}`);
    if (!book) return;
    this.busy = true;
    this.ikRelax = false;
    this.setState('fetching');
    this.lookWeight = 0.3;
    try {
      this.returnTableBook();
      book.updateWorldMatrix(true, false);
      const bp = book.getWorldPosition(new THREE.Vector3());
      const spineTop = bp.clone().add(new THREE.Vector3(0, 0.2, 0.09));
      const reach = (book.userData.reach as string) ?? 'mid';
      const shelfZ = bp.z + 0.1;
      if (reach === 'ladder') await this.rideTo(bp.x, spineTop);
      else {
        await this.walkTo(bp.x - 0.18, shelfZ + this.cfg.stand_off);
        await this.turnTo(Math.PI);
      }
      // reach with the right clip for the height above his feet, IK on top
      const dh = spineTop.y - this.root.getWorldPosition(new THREE.Vector3()).y;
      const clip = dh < 0.85 ? 'reach_low' : dh < 1.65 ? 'reach_mid' : 'reach_high';
      this.ikTarget.copy(spineTop);
      this.lookTarget = spineTop;
      this.lookWeight = 1;
      const reachP = this.once(clip, undefined, 0.25);
      await this.tween(this.events._clips[clip].duration * 0.5, t => { this.ikWeight = t; });
      await reachP;
      // grab: fingers close on top of the held reach; take the book at `attach`
      const grab = this.events.grab?.attach ?? 0.42;
      this.setOverlay('grab', 0.1);
      await this.wait(grab);
      this.take(book, topicId);
      await this.wait(0.3);
      this.lookTarget = null;
      this.lookWeight = 0.3;
      this.setOverlay('carry', 0.35);
      await this.tween(0.45, t => { this.ikWeight = 1 - t; });
      this.ikWeight = 0;
      if (reach === 'ladder') await this.climbDown();
      // to the far side of the table, facing the visitor
      const drop = this.room.get('Table_drop')!;
      const dp = drop.getWorldPosition(new THREE.Vector3());
      await this.walkTo(dp.x + 0.15, dp.z - 1.05, true);
      await this.turnTo(0);
      this.setState('handing_over');
      this.lookWeight = 1;
      this.setOverlay(null, 0.3);
      await this.once('hand_over', e => { if (e === 'release') void this.release(dp, drop); }, 0.3);
    } finally {
      this.busy = false;
      this.ikWeight = 0;
      this.lookTarget = null;
      this.lookWeight = 1;
      this.state = 'handing_over';
      this.setState('idle');
    }
  }

  /** Centre of the visible right hand and its palm direction, in hand.R's own space (measured on the bind pose). */
  private palmCenter = new THREE.Vector3();
  private palmNormal = new THREE.Vector3(1, 0, 0);
  private measurePalm() {
    this.model.updateMatrixWorld(true);
    const hand = this.bone('hand.R');
    let mesh: THREE.SkinnedMesh | null = null;
    // the body: the largest skinned mesh (the glasses are a small one, skinned to the head)
    this.model.traverse(o => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && (!mesh || sm.geometry.attributes.position.count > (mesh as THREE.SkinnedMesh).geometry.attributes.position.count)) mesh = sm;
    });
    if (!mesh) return;
    const m = mesh as THREE.SkinnedMesh;
    const hi = m.skeleton.bones.indexOf(hand);
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    const sum = new THREE.Vector3(), v = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < si.count; i++) {
      for (let k = 0; k < 4; k++) {
        if (si.getComponent(i, k) === hi && sw.getComponent(i, k) > 0.6) {
          m.getVertexPosition(i, v);
          sum.add(m.localToWorld(v));
          n++;
          break;
        }
      }
    }
    if (n) this.palmCenter.copy(hand.worldToLocal(sum.divideScalar(n)));
    // the palm faces away from the back of the hand: from the knuckles (index to pinky) and the hand's length, on
    // the side the thumb tip is on. This holds for any rest pose (A-pose palms face the thighs, T-pose palms face down).
    const wp = (n: string) => this.bone(n).getWorldPosition(new THREE.Vector3());
    const base = wp('hand.R');
    const across = wp('index.01.R').sub(wp('pinky.01.R'));
    const along = wp('middle.01.R').sub(base);
    const pn = new THREE.Vector3().crossVectors(across, along).normalize();
    // the thumb's tip: the end of its last bone (its child end joint when exported, else the bone itself)
    const t3 = this.bone('thumb.03.R');
    const thumbTip = (t3.children[0] ?? t3).getWorldPosition(new THREE.Vector3());
    if (thumbTip.sub(base).dot(pn) < 0) pn.negate();
    const qHand = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.palmNormal.copy(pn).applyQuaternion(qHand).normalize();
  }

  private gripBlend = 0;
  private gripFrom: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;

  private take(book: THREE.Object3D, id: string) {
    this.held = { book, parent: book.parent!, pos: book.position.clone(), quat: book.quaternion.clone(), id };
    const hand = this.bone('hand.R');
    hand.updateMatrixWorld(true);
    hand.attach(book);
    this.gripFrom = { p: book.position.clone(), q: book.quaternion.clone() };
    this.gripBlend = 0;
    void this.tween(0.25, t => { this.gripBlend = t; });
  }

  /** Every frame while held: the cover against the palm (thickness axis along the palm direction), the book turned
   *  about that axis to stay as upright as the hand allows, so the title never ends up upside down. */
  private applyGrip() {
    const h = this.held;
    const hand = this.bone('hand.R');
    if (!h || h.book.parent !== hand) return;
    const H = 0.3, T = 0.055;
    const hq = hand.getWorldQuaternion(new THREE.Quaternion());
    const nW = this.palmNormal.clone().applyQuaternion(hq);
    let yW = new THREE.Vector3(0, 1, 0).addScaledVector(nW, -nW.y);
    if (yW.lengthSq() < 1e-4) yW = new THREE.Vector3(0, 0, 1).addScaledVector(nW, -nW.z);
    yW.normalize();
    const zW = new THREE.Vector3().crossVectors(nW, yW);
    const worldQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(nW, yW, zW));
    const q = hq.invert().multiply(worldQ);
    const centre = this.palmCenter.clone().addScaledVector(this.palmNormal, this.cfg.palm_half_thickness + T / 2);
    const p = centre.sub(new THREE.Vector3(0, H / 2, 0).applyQuaternion(q));
    if (this.gripBlend < 1 && this.gripFrom) {
      h.book.quaternion.slerpQuaternions(this.gripFrom.q, q, this.gripBlend);
      h.book.position.lerpVectors(this.gripFrom.p, p, this.gripBlend);
    } else {
      h.book.quaternion.copy(q);
      h.book.position.copy(p);
    }
    h.book.updateMatrixWorld(true);
  }

  private async release(dp: THREE.Vector3, drop: THREE.Object3D) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    const scene = this.root.parent!;
    scene.attach(h.book);
    const p0 = h.book.position.clone(), q0 = h.book.quaternion.clone();
    // lie the book on its cover on the table, spine towards the visitor's right
    const q1 = drop.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, Math.PI / 2)));
    const p1 = dp.clone().add(new THREE.Vector3(-0.25, 0.03, -0.21));   // clear patch between the lantern and the open book, above the chat panel
    await this.tween(0.45, t => {
      h.book.position.lerpVectors(p0, p1, t);
      h.book.position.y += Math.sin(t * Math.PI) * 0.06;
      h.book.quaternion.slerpQuaternions(q0, q1, t);
    });
    this.onTable = h;
    this.onBookLanded?.(h.id);
  }

  /** Put the last handed-over book back on its shelf (instantly, before the next fetch). */
  returnTableBook() {
    const h = this.onTable;
    if (!h) return;
    h.parent.add(h.book);
    h.book.position.copy(h.pos);
    h.book.quaternion.copy(h.quat);
    this.onTable = null;
  }

  // ------------------------------------------------------------ the ladder
  private ladderRest = 0;

  private async rideTo(bookX: number, _target: THREE.Vector3) {
    const ladder = this.room.get('Ladder')!;
    const step = this.room.get('Ladder_step')!;
    const path = this.room.get('Ladder_path')!;
    this.ladderRest = ladder.position.x;
    const from = (path.userData.from as number[]) ?? [-1.85, 0, 0];
    const to = (path.userData.to as number[]) ?? [1.85, 0, 0];
    // walk to the foot of the ladder where it stands, climb, ride along the rail with it
    const foot = ladder.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 0.85 + 0.45));
    await this.walkTo(foot.x, foot.z);
    await this.turnTo(Math.PI);
    const p0 = this.root.position.clone();
    const sp = step.getWorldPosition(new THREE.Vector3());
    this.play('walk', 0.2, 0.6);
    await this.tween(CLIMB_TIME, t => { this.root.position.lerpVectors(p0, sp, t); this.root.position.y = p0.y + (sp.y - p0.y) * t; });
    this.play('idle', 0.3);
    ladder.attach(this.root);
    this.root.rotation.set(0, this.yaw, 0);   // attach() can decompose a 180° yaw as (π, 0, π)
    const x1 = THREE.MathUtils.clamp(bookX - 0.3, from[0], to[0]);
    const x0 = ladder.position.x;
    await this.tween(Math.max(0.4, Math.abs(x1 - x0) / RIDE_SPEED), t => { ladder.position.x = x0 + (x1 - x0) * t; });
  }

  private async climbDown() {
    const ladder = this.room.get('Ladder')!;
    const scene = ladder.parent!;
    scene.attach(this.root);
    this.root.rotation.set(0, this.yaw, 0);
    const p0 = this.root.position.clone();
    const p1 = ladder.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 0.85 + 0.45));
    p1.y = 0;
    this.play('walk_carry', 0.2, 0.6);
    await this.tween(CLIMB_TIME, t => { this.root.position.lerpVectors(p0, p1, t); });
    this.play('idle_carry', 0.2);
    // the ladder rolls back to where it was while he walks away
    const x0 = ladder.position.x, x1 = this.ladderRest;
    void this.tween(Math.max(0.4, Math.abs(x1 - x0) / RIDE_SPEED), t => { ladder.position.x = x0 + (x1 - x0) * t; });
  }
}
