// The chart room: the navigator's room, where Ugurcan keeps the ship's charts. Its own chunk, fetched when the
// visitor first goes there (main.ts). Like the library (library/deck.ts) it borrows the main camera (rig.cine) and the
// main scene: while inside, everything of the cabin is hidden and the room's group is shown. The room sits at the
// scene origin in its own coordinates (blender/chartroom/build.py); the way in and out is a short fade through its door.
//
//   Ugurcan   stands at his chart table (Meshy model, rig and clips, art/chartroom/ugurcan.glb); he turns his head to
//             the visitor, waves when they come in, and bows when they tap him, and his note opens (content/_ugurcan.md).
//             Now and then he walks over to the star chart or the windows, stays a while, and walks back
//   his star  in the skylight over the table: an evening star at sunset, the brightest in the sky at night
//   camera    the stations' poses (Camera_* in the room) with the visitor's gestures on top, as in the library
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CameraRig } from '../camera';
import { loadGLB } from '../scene';
import { FULL } from '../tier';
import { tween, ease, reducedMotion } from '../anim';
import { Input, type Point } from '../input';
import { Waypoints, type Station } from '../stations';
import { coach } from '../coach';
import { loadRoom, type Room } from '../library/room';
import { setupSway } from '../library/sway';
import { uNight, uStorm, uTime, uFlash } from '../library/time';
import noteText from '../../content/_ugurcan.md?raw';
import './chartroom.css';

const FILES = {
  meta: '/assets/chartroom_lightmaps.json',
  sunset: ['/assets/chartroom_lightmap_sunset.ktx2', '/assets/chartroom_lightmap_sunset_1k.ktx2'],
  night: ['/assets/chartroom_lightmap_night.ktx2', '/assets/chartroom_lightmap_night_1k.ktx2'],
};
/** His idle clips, played one after another (Meshy animation library names). */
const IDLES = ['Long_Breathe_and_Look_Around', 'Idle_02', 'Happy_Sway_Standing', 'Idle_02'];

export interface ChartHooks {
  root: HTMLElement;
  /** Inside (true) or back in the cabin (false): hide or show the cabin's UI. */
  changed(inside: boolean): void;
  /** The visitor asked to leave (the door, Back with nothing open). */
  out(): void;
  announce(text: string): void;
  paper?(): void;
}

type Phase = 'cabin' | 'in' | 'inside' | 'out';
type Pose = { pos: THREE.Vector3; target: THREE.Vector3 };

export class ChartRoom {
  phase: Phase = 'cabin';
  private group = new THREE.Group();
  private loaded: Promise<boolean> | null = null;
  private pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  private hidden: THREE.Object3D[] = [];
  private stash: { bg: THREE.Scene['background']; env: THREE.Texture | null } | null = null;
  private ui = document.createElement('div');
  private layer = document.createElement('div');
  private fade = document.createElement('div');
  private w: World | null = null;

  constructor(private scene: THREE.Scene, private rig: CameraRig, private renderer: THREE.WebGLRenderer, private hooks: ChartHooks) {
    this.group.name = 'ChartRoom';
    this.group.visible = false;
    scene.add(this.group);
    this.ui.className = 'chart-ui';
    this.ui.hidden = true;
    this.layer.className = 'chart-layer';
    this.layer.hidden = true;
    this.fade.className = 'chart-fade';
    hooks.root.append(this.layer, this.ui, this.fade);
  }

  get active() { return this.phase !== 'cabin'; }
  get inside() { return this.phase === 'inside'; }
  get busy() { return this.phase === 'in' || this.phase === 'out'; }

  orbit(dx: number, dy: number) { if (this.inside) this.w?.orbit(dx, dy); }
  zoom(f: number) { if (this.inside) this.w?.zoomGesture(f); }
  pan(dx: number, dy: number) { if (this.inside) this.w?.panGesture(dx, dy); }
  reset() { if (this.inside) this.w?.reset(); }
  get stations() { return this.w?.stations ?? []; }
  get station() { return this.w?.station ?? null; }
  goStation(id: string) { if (this.inside) this.w?.goStation(id); }
  get backLabel(): string | null { return this.inside && this.w ? this.w.backLabel : null; }

  preload(): Promise<boolean> {
    return this.loaded ??= (async () => {
      try {
        const [roomGltf, manGltf] = await Promise.all([
          loadGLB(FULL ? '/assets/chartroom.glb' : '/assets/chartroom_lite.glb'),
          loadGLB(FULL ? '/assets/ugurcan.glb' : '/assets/ugurcan_lite.glb'),
        ]);
        if (!roomGltf || !manGltf) return false;
        const room = await loadRoom(roomGltf, FULL, FILES);
        this.w = new World(this.group, room, manGltf, this.renderer, this.rig.camera, this.layer, this.ui, this.hooks);
        this.group.visible = true;
        this.renderer.compile(this.group, this.rig.camera);
        this.group.visible = false;
        return true;
      } catch (e) {
        console.warn('[chartroom]', e);
        return false;
      }
    })();
  }

  /** From the cabin: a fade, then in through the door to him. */
  async enter(station?: string): Promise<boolean> {
    if (this.phase !== 'cabin') { if (station && this.inside) this.w?.goStation(station); return true; }
    if (!(await this.preload()) || !this.w) return false;
    const w = this.w;
    this.phase = 'in';
    this.hooks.changed(true);
    const cam = this.rig.camera;
    this.pose.pos.copy(cam.position);
    this.pose.target.copy(cam.position).add(cam.getWorldDirection(new THREE.Vector3()));
    this.rig.cine = this.pose;
    const slow = reducedMotion ? 0 : 1;
    await tween(0.45 * slow, k => { this.fade.style.opacity = String(k); }, { ease: ease.inOutCubic, key: 'chart' });
    this.fade.style.opacity = '1';
    this.swap(true);
    const home = w.home;
    const door = w.doorway;
    this.pose.pos.copy(door.pos); this.pose.target.copy(door.target);
    await tween(1.6 * slow, k => {
      this.pose.pos.lerpVectors(door.pos, home.pos, k);
      this.pose.target.lerpVectors(door.target, home.target, k);
      this.fade.style.opacity = String(1 - THREE.MathUtils.smoothstep(k, 0, 0.45));
    }, { ease: ease.inOutCubic, key: 'chart' });
    this.fade.style.opacity = '0';
    this.phase = 'inside';
    this.ui.hidden = false;
    w.arrive(station);
    return true;
  }

  /** Back out through the door to the cabin's overview. */
  async exit(): Promise<void> {
    if (this.phase !== 'inside' || !this.w) return;
    const w = this.w;
    this.phase = 'out';
    this.ui.hidden = true;
    w.leave();
    const cam = this.rig.camera;
    this.pose.pos.copy(cam.position);
    this.pose.target.copy(cam.position).add(cam.getWorldDirection(new THREE.Vector3()));
    this.rig.cine = this.pose;
    const slow = reducedMotion ? 0 : 1;
    const p0 = this.pose.pos.clone(), t0 = this.pose.target.clone(), door = w.doorway;
    await tween(1.1 * slow, k => {
      this.pose.pos.lerpVectors(p0, door.pos, k);
      this.pose.target.lerpVectors(t0, door.target.clone().add(new THREE.Vector3(0, 0, 6)), k);
      this.fade.style.opacity = String(THREE.MathUtils.smoothstep(k, 0.4, 1));
    }, { ease: ease.inOutCubic, key: 'chart' });
    this.fade.style.opacity = '1';
    this.swap(false);
    this.rig.jump('overview');
    this.rig.releaseCine(0.1);
    this.phase = 'cabin';
    this.hooks.changed(false);
    await tween(0.5 * slow, k => { this.fade.style.opacity = String(1 - k); }, { ease: ease.outCubic, key: 'chart' });
    this.fade.style.opacity = '0';
  }

  private swap(inside: boolean) {
    const s = this.scene;
    if (inside) {
      this.hidden = s.children.filter(o => o !== this.group && o.visible);
      for (const o of this.hidden) o.visible = false;
      this.stash = { bg: s.background, env: s.environment };
      s.background = new THREE.Color('#1c1418');
      s.environment = null;
      this.group.visible = true;
      this.layer.hidden = false;
    } else {
      for (const o of this.hidden) o.visible = true;
      this.hidden = [];
      if (this.stash) { s.background = this.stash.bg; s.environment = this.stash.env; this.stash = null; }
      this.group.visible = false;
      this.layer.hidden = true;
      this.ui.hidden = true;
    }
  }

  /** Esc / Back: close the note, come back to him, then leave. */
  escape() {
    if (!this.inside || !this.w) return;
    if (!this.w.back()) this.hooks.out();
  }

  update(dt: number, ship: { roll: number; pitch: number }) {
    if (!this.w || !this.group.visible) return;
    this.w.update(dt, ship, this.phase === 'inside');
    if (this.phase === 'inside') {
      const c = this.rig.camera;
      this.pose.pos.copy(c.position);
      this.pose.target.copy(c.position).add(c.getWorldDirection(new THREE.Vector3()));
    }
  }
}

// ------------------------------------------------------------------------------------------------ the room inside
class World {
  readonly home: Pose;
  readonly doorway: Pose;
  private man: Navigator;
  private lights: ReturnType<typeof chartLights>;
  private sway: ReturnType<typeof setupSway>;
  private sky: THREE.ShaderMaterial | null = null;
  private note: Note;
  private way: Waypoints;
  private stationList: Station[] = [];
  private stops = new Map<string, Pose>();
  /** The camera's glide between stations: from, to, progress 0..1. */
  private glide = { from: null as Pose | null, to: null as Pose | null, k: 1 };
  private shot: Pose;
  private turn = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0 };
  private pan = { x: 0, y: 0, tx: 0, ty: 0 };
  private zoom = 1; private tZoom = 1;
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private greeted = false;

  constructor(group: THREE.Group, private room: Room, manGltf: GLTF, renderer: THREE.WebGLRenderer,
    private camera: THREE.PerspectiveCamera, private layer: HTMLElement, ui: HTMLElement, private hooks: ChartHooks) {
    group.add(room.root);
    const aniso = Math.min(FULL ? 16 : 4, renderer.capabilities.getMaxAnisotropy());
    room.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of ([] as THREE.Material[]).concat(m.material)) {
        for (const t of [(mat as THREE.MeshBasicMaterial).map, (mat as THREE.MeshBasicMaterial).lightMap]) if (t) { t.anisotropy = aniso; t.needsUpdate = true; }
      }
      if (topName(m) === 'Skylight_glass') m.material = new THREE.MeshBasicMaterial({ color: '#dfe6ff', transparent: true, opacity: 0.1, depthWrite: false });
    });
    const skyMesh = room.get('Skylight_sky');
    const star = room.get('Star')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0.2, 4.68, -0.93);
    skyMesh?.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { this.sky ??= starSky(star); m.material = this.sky; }
    });
    this.lights = chartLights(group, room);
    this.sway = setupSway({ lantern: room.get('STATIC_hanging_lantern'), light: this.lights.hang });

    const anchor = room.get('Ugurcan');
    this.man = new Navigator(manGltf);
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      const q = new THREE.Quaternion();
      anchor.matrixWorld.decompose(this.man.root.position, q, new THREE.Vector3());
      this.man.setHome(this.man.root.position, new THREE.Euler().setFromQuaternion(q, 'YXZ').y);
    }
    group.add(this.man.root);
    this.man.root.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.map) { m.map.anisotropy = aniso; m.map.needsUpdate = true; }
    });

    room.root.updateMatrixWorld(true);
    const V = THREE.Vector3;
    const shot = (name: string, pos: THREE.Vector3, target: THREE.Vector3): Pose => {
      const e = room.get(name);
      if (!e?.userData.target) return { pos, target };
      e.updateWorldMatrix(true, false);
      return { pos: e.getWorldPosition(new V()), target: new V().fromArray(e.userData.target as number[]) };
    };
    this.home = shot('Camera_main', new V(0.25, 1.62, 1.75), new V(0, 1.25, -1.6));
    this.stops.set('table', shot('Camera_table', new V(0.35, 1.75, 0.55), new V(0, 0.9, -0.75)));
    this.stops.set('star', shot('Camera_sky', new V(0.3, 1.35, 0.9), new V(0, 3.6, -0.75)));
    this.stops.set('window', shot('Camera_window', new V(0.4, 1.55, 0.4), new V(0, 1.55, -2.6)));
    // his star sits where the star view looks through the skylight, so it is in the middle of the glass there
    if (this.sky && skyMesh) {
      const box = new THREE.Box3().setFromObject(skyMesh);
      const from = this.stops.get('star')!, glass = room.get('STATIC_skylight');
      const c = glass ? new THREE.Box3().setFromObject(glass).getCenter(new V()) : from.target.clone();
      const dir = c.clone().sub(from.pos);
      const t = (box.min.y - from.pos.y) / dir.y;
      (this.sky.uniforms.uStar.value as THREE.Vector3).copy(from.pos).addScaledVector(dir, t).add(new V(0.12, 0, -0.08));
    }
    const door = room.get('DOOR_front')?.getWorldPosition(new V()) ?? new V(0, 0, 2.4);
    this.doorway = { pos: new V(door.x, 1.6, door.z + 0.7), target: new V(0, 1.3, -1.5) };
    this.shot = { pos: this.home.pos.clone(), target: this.home.target.clone() };

    this.note = new Note(ui, parseNote(noteText));
    this.note.onClose = () => { this.man.lookAway(false); this.man.hold = false; };
    this.way = new Waypoints(ui, id => this.goStation(id), 'chart');
    const head = new V();
    const lift = new V(0, 0.42, 0);
    this.stationList = [
      { id: 'ugurcan', label: 'Ugurcan — the ship’s navigator', spot: () => this.man.headPos(head).add(lift) },
      { id: 'table', label: 'Chart table — where he plots the course', spot: () => new V(0.45, 0.98, -0.5) },
      { id: 'star', label: 'Skylight — his star', spot: () => new V(0, 3.0, -0.75) },
      { id: 'window', label: 'Windows — the sky ahead', spot: () => new V(-1.05, 1.6, -2.3) },
      { id: 'door', label: 'Door — back to the cabin', spot: () => new V(door.x, 1.5, door.z - 0.1) },
    ];
    this.way.set(this.stationList);
    this.way.setCurrent('ugurcan');
    this.pointer();
  }

  get stations() { return this.stationList.filter(s => s.id !== 'door').map(s => ({ id: s.id, label: DOCK_NAME[s.id] ?? s.label.split(' — ')[0] })); }
  get station() { return this.way.at; }
  get backLabel() { return this.note.isOpen ? 'Close the note' : this.way.at !== 'ugurcan' ? 'Back to Ugurcan' : 'Back to the cabin'; }

  arrive(station?: string) {
    this.goHome(true);
    this.man.toHome();
    if (station && station !== 'ugurcan') this.goStation(station);
    this.man.play(this.greeted ? 'Wave_One_Hand' : 'Gentlemans_Bow');
    if (!this.greeted) this.hooks.announce('In the chart room. Ugurcan, the ship’s navigator, is at his chart table.');
    this.greeted = true;
    setTimeout(() => coach('chartroom'), 1200);
  }

  leave() { this.note.close(); this.goHome(true); this.man.toHome(); }

  back(): boolean {
    if (this.note.isOpen) { this.note.close(); return true; }
    if (this.way.at !== 'ugurcan') { this.goHome(); return true; }
    return false;
  }

  goStation(id: string) {
    if (id === 'door') { this.hooks.out(); return; }
    if (id === 'ugurcan') { this.goHome(); return; }
    const s = this.stops.get(id);
    if (!s) return;
    this.note.close();
    this.glideTo(s);
    this.way.setCurrent(id);
    this.hooks.announce(id === 'star' ? 'Looking up through the skylight at his star.' : `At the ${id === 'table' ? 'chart table' : 'windows'}.`);
  }

  private goHome(now = false) {
    this.way.setCurrent('ugurcan');
    if (now) { this.shot.pos.copy(this.home.pos); this.shot.target.copy(this.home.target); this.glide.k = 1; }
    else this.glideTo(this.home);
    this.resetFraming();
  }

  private glideTo(to: Pose) {
    this.glide.from = { pos: this.shot.pos.clone(), target: this.shot.target.clone() };
    this.glide.to = to;
    this.glide.k = reducedMotion ? 1 : 0;
    if (reducedMotion) { this.shot.pos.copy(to.pos); this.shot.target.copy(to.target); }
    this.resetFraming();
  }

  private openNote() {
    if (this.note.isOpen) return;
    this.goHome();
    this.man.hold = true;
    this.man.play('Gentlemans_Bow');
    this.man.lookAway(true);
    this.note.open();
    this.hooks.paper?.();
  }

  // ------------------------------------------------------------ gestures
  private resetFraming() { this.pan.tx = this.pan.ty = 0; this.tZoom = 1; this.turn.tyaw = this.turn.tpitch = 0; }
  private get offset() { return Math.abs(this.turn.tyaw) > 0.02 || Math.abs(this.turn.tpitch) > 0.02 || Math.abs(this.tZoom - 1) > 0.02 || Math.hypot(this.pan.tx, this.pan.ty) > 0.02; }
  orbit(dx: number, dy: number) {
    const k = 1.3 / this.tZoom, t = this.turn;
    t.tyaw = THREE.MathUtils.clamp(t.tyaw + dx * k, -0.7, 0.7);
    t.tpitch = THREE.MathUtils.clamp(t.tpitch + dy * k, -0.4, 0.6);
  }
  zoomGesture(f: number) { this.tZoom = THREE.MathUtils.clamp(this.tZoom / f, 1, 2.6); }
  panGesture(dx: number, dy: number) {
    this.pan.tx = THREE.MathUtils.clamp(this.pan.tx - dx * 1.6 / this.tZoom, -0.8, 0.8);
    this.pan.ty = THREE.MathUtils.clamp(this.pan.ty + dy * 1.0 / this.tZoom, -0.4, 0.5);
  }
  reset(at?: Point) {
    if (this.offset) { this.resetFraming(); return; }
    if (at && this.hitMan(at)) { this.openNote(); return; }
    this.goHome();
  }

  private cast(at: Point) {
    this.ndc.set((at.x / innerWidth) * 2 - 1, -(at.y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  private hitMan(at: Point) { this.cast(at); return this.man.hit(this.ray); }

  private pointer() {
    new Input(this.layer, this.camera, {
      targets: () => [],
      hover: (_h, at) => { if (at) this.layer.style.cursor = this.hitMan(at) ? 'pointer' : ''; },
      click: (_h, at) => {
        if (this.note.isOpen) { this.note.close(); return; }
        if (this.hitMan(at)) this.openNote();
      },
      dragStart: () => false,
      drag: () => {},
      dragEnd: () => {},
      swipeDown: () => { this.back(); },
      escape: () => {},
      look: () => {},
      orbit: (dx, dy) => this.orbit(dx, dy),
      zoom: f => this.zoomGesture(f),
      pan: (dx, dy) => this.panGesture(dx, dy),
      reset: at => this.reset(at),
    }, { keys: false, passThrough: 'chart' });
  }

  // ------------------------------------------------------------ frame
  update(dt: number, ship: { roll: number; pitch: number }, control: boolean) {
    this.room.update();
    this.lights.update();
    if (this.sky) this.sky.uniforms.uTime.value = uTime.value;
    const cam = this.camera;
    if (control) this.frameCamera(dt);
    this.sway.update(dt, control ? cam : _still, ship);
    this.way.setVisible(control && !this.note.isOpen);
    if (control) this.way.update(cam);
    this.man.update(dt, cam.position);
  }

  private frameCamera(dt: number) {
    const cam = this.camera;
    const g = this.glide;
    if (g.k < 1 && g.from && g.to) {
      g.k = Math.min(1, g.k + dt / 1.4);
      const e = ease.inOutCubic(g.k);
      this.shot.pos.lerpVectors(g.from.pos, g.to.pos, e);
      this.shot.target.lerpVectors(g.from.target, g.to.target, e);
    }
    const k = 1 - Math.exp(-dt * 6), t = this.turn, p = this.pan;
    t.yaw += (t.tyaw - t.yaw) * k; t.pitch += (t.tpitch - t.pitch) * k;
    p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;
    this.zoom += (this.tZoom - this.zoom) * k;
    cam.position.copy(this.shot.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.shot.target);
    cam.quaternion.multiply(_q.setFromEuler(_e.set(t.pitch, t.yaw, 0)));
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
    cam.position.addScaledVector(_right, p.x).add(_up.set(0, p.y, 0));
    cam.position.x = THREE.MathUtils.clamp(cam.position.x, -1.8, 1.8);
    cam.position.y = THREE.MathUtils.clamp(cam.position.y, 0.6, 2.7);
    cam.position.z = THREE.MathUtils.clamp(cam.position.z, -2.2, 2.6);
    // keep at least a 3:2 view on narrow screens, narrowed by the zoom
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(26)) * 1.5);
    const lens = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / cam.aspect)), 52, 80);
    const fov = lens / this.zoom;
    if (Math.abs(cam.fov - fov) > 1e-4) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (cam.view) cam.clearViewOffset();
  }
}

// ------------------------------------------------------------------------------------------------ Ugurcan
/** Where he goes in the room (room coordinates) and which way he faces there (radians about +Y; 0 = toward the door). */
type Spot = { x: number; z: number; yaw: number };
/** Besides his place at the table: the star chart on the starboard wall, and the middle window, looking out ahead. */
const AWAY: Spot[] = [{ x: 1.32, z: -1.3, yaw: Math.PI / 2 }, { x: 0.15, z: -1.98, yaw: Math.PI }];
/** Metres per second of each walk clip (measured from the planted foot), so his feet do not slide. */
const WALKS = { slow: { clip: 'Thoughtful_Walk', speed: 0.56 }, brisk: { clip: 'Casual_Walk', speed: 0.71 } };

class Navigator {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private idleIndex = 0;
  private head: THREE.Object3D | null = null;
  private look = { yaw: 0, pitch: 0, w: 0, away: false };
  private home: Spot = { x: 0, z: -1.42, yaw: 0 };
  /** idle: standing at a spot (idles, or a one-off clip); walk: on his way; turn: arrived, turning to face the spot's way. */
  private state: 'idle' | 'walk' | 'turn' = 'idle';
  private at: Spot = this.home;
  private target: Spot | null = null;
  private pace = WALKS.slow;
  private yaw = 0;
  /** Seconds until he next wanders off (at the table) or heads back (away). */
  private wait = 25;
  private awayIndex = 0;
  private oneOff = false;
  private then: (() => void) | null = null;
  /** No wandering while the visitor reads his note. */
  hold = false;

  constructor(gltf: GLTF) {
    this.root.name = 'Ugurcan';
    this.root.add(gltf.scene);
    gltf.scene.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) m.frustumCulled = false;
      if (!this.head && /^head$/i.test(o.name)) this.head = o;
    });
    // the clips are in place (no root travel): the walks move him from here
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    for (const c of gltf.animations) this.clips.set(c.name, this.mixer.clipAction(c));
    this.mixer.addEventListener('finished', () => { this.oneOff = false; if (this.state === 'idle') this.nextIdle(); });
    this.nextIdle();
  }

  /** His place at the table (from the room's Ugurcan empty). */
  setHome(pos: THREE.Vector3, yaw: number) {
    this.home = { x: pos.x, z: pos.z, yaw };
    this.toHome();
  }

  /** Straight back to his place, no walk (while nobody is looking: arriving, leaving). */
  toHome() {
    this.at = this.home; this.target = null; this.then = null; this.state = 'idle';
    this.yaw = this.home.yaw;
    this.root.position.set(this.home.x, this.root.position.y, this.home.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.wait = 20 + Math.random() * 15;
    if (this.current && /Walk/.test(this.current.getClip().name)) this.nextIdle();
  }

  get atHome() { return this.at === this.home && this.state === 'idle'; }

  /** A clip once (a wave, the bow) at his table; if he is away he walks back first. */
  play(name: string) {
    if (!this.atHome) { this.walkTo(this.home, WALKS.brisk, () => this.play(name)); return; }
    const a = this.clips.get(name);
    if (!a) return;
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    this.oneOff = true;
    this.fadeTo(a);
  }

  private nextIdle() {
    const name = IDLES[this.idleIndex++ % IDLES.length];
    const a = this.clips.get(name) ?? [...this.clips.values()][0];
    if (!a) return;
    a.reset().setLoop(THREE.LoopRepeat, name === 'Idle_02' ? 3 : 1);
    this.fadeTo(a);
  }

  private walkTo(spot: Spot, pace: typeof WALKS.slow, then?: () => void) {
    const a = this.clips.get(pace.clip);
    if (!a) { this.at = spot; this.toSpot(spot); then?.(); return; }
    this.target = spot; this.pace = pace; this.then = then ?? null; this.state = 'walk';
    a.reset().setLoop(THREE.LoopRepeat, Infinity);
    this.fadeTo(a, 0.4);
  }

  private toSpot(s: Spot) { this.root.position.set(s.x, this.root.position.y, s.z); this.yaw = s.yaw; this.root.rotation.set(0, s.yaw, 0); }

  private fadeTo(a: THREE.AnimationAction, t = 0.5) {
    a.enabled = true;
    a.setEffectiveWeight(1);
    a.play();
    if (this.current && this.current !== a) a.crossFadeFrom(this.current, t, false);
    this.current = a;
  }

  /** While his note is open he looks down at the chart rather than at the visitor. */
  lookAway(on: boolean) { this.look.away = on; }

  headPos(out: THREE.Vector3) { return this.head ? this.head.getWorldPosition(out) : out.copy(this.root.position).setY(1.7); }

  hit(ray: THREE.Raycaster) {
    // the skinned mesh's bind-pose bounds are close enough: a box round him
    _box.setFromCenterAndSize(_v.copy(this.root.position).setY(0.95), _size.set(0.8, 1.9, 0.8));
    return ray.ray.intersectsBox(_box);
  }

  /** Wandering: now and then he paces over to the star chart or the window, stays a while, and comes back. */
  private wander(dt: number) {
    if (this.state !== 'idle' || this.oneOff || this.hold) return;
    this.wait -= dt;
    if (this.wait > 0) return;
    if (this.at === this.home) {
      const spot = AWAY[this.awayIndex++ % AWAY.length];
      this.walkTo(spot, WALKS.slow);
      this.wait = 10 + Math.random() * 6;       // how long he stays there
    } else {
      this.walkTo(this.home, WALKS.slow);
      this.wait = 25 + Math.random() * 20;      // how long until he goes again
    }
  }

  private move(dt: number) {
    const t = this.target;
    if (!t) return;
    const p = this.root.position;
    if (this.state === 'walk') {
      const dx = t.x - p.x, dz = t.z - p.z, dist = Math.hypot(dx, dz);
      const heading = Math.atan2(dx, dz);
      this.yaw = turnToward(this.yaw, heading, dt * 3.2);
      // he turns first, then walks: no gliding sideways
      const facing = Math.max(0, Math.cos(angleDiff(this.yaw, heading)));
      const step = Math.min(dist, this.pace.speed * dt * facing * facing);
      if (dist > 1e-4) { p.x += (dx / dist) * step; p.z += (dz / dist) * step; }
      if (dist < 0.02) { p.x = t.x; p.z = t.z; this.state = 'turn'; this.at = t; this.nextIdle(); }
    } else if (this.state === 'turn') {
      this.yaw = turnToward(this.yaw, t.yaw, dt * 2.2);
      if (Math.abs(angleDiff(this.yaw, t.yaw)) < 0.01) {
        this.yaw = t.yaw; this.state = 'idle'; this.target = null;
        const then = this.then; this.then = null; then?.();
      }
    }
    this.root.rotation.set(0, this.yaw, 0);
  }

  update(dt: number, eye: THREE.Vector3) {
    this.wander(dt);
    this.move(dt);
    this.mixer.update(dt);
    if (!this.head) return;
    // at his table he turns his head toward the visitor (a little: the clip still moves it); never on the move
    const local = this.root.worldToLocal(_v.copy(eye));
    const headLocal = this.root.worldToLocal(this.head.getWorldPosition(_w));
    local.sub(headLocal);
    const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.7, 0.7);
    const pitch = THREE.MathUtils.clamp(Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.3, 0.3);
    const want = this.look.away || !this.atHome || local.z < 0 ? 0 : 0.65;
    const k = 1 - Math.exp(-dt * 3);
    this.look.w += (want - this.look.w) * k;
    this.look.yaw += (yaw - this.look.yaw) * k;
    this.look.pitch += (pitch - this.look.pitch) * k;
    if (this.look.w < 0.01) return;
    this.root.updateMatrixWorld(true);
    const up = _w.set(0, 1, 0).applyQuaternion(this.root.quaternion);
    const right = _r.set(1, 0, 0).applyQuaternion(this.root.quaternion);
    rotateWorld(this.head, up, this.look.yaw * this.look.w);
    rotateWorld(this.head, right, -this.look.pitch * this.look.w);
  }
}

const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
function turnToward(a: number, b: number, maxStep: number) {
  const d = angleDiff(a, b);
  return a + Math.sign(d) * Math.min(Math.abs(d), maxStep);
}

function rotateWorld(o: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  // rotate about a world axis through the bone's own origin
  const parentQ = o.parent ? o.parent.getWorldQuaternion(_pq) : _pq.identity();
  const worldQ = _wq.copy(parentQ).multiply(o.quaternion);
  worldQ.premultiply(_dq.setFromAxisAngle(axis, angle));
  o.quaternion.copy(parentQ.invert().multiply(worldQ));
}

// ------------------------------------------------------------------------------------------------ his note
interface NoteText { title: string; subtitle: string; body: string[] }

/** content/_ugurcan.md: "# Name", "## what he was", then paragraphs. */
function parseNote(md: string): NoteText {
  const out: NoteText = { title: 'Ugurcan', subtitle: '', body: [] };
  let para: string[] = [];
  const flush = () => { if (para.length) out.body.push(para.join(' ')); para = []; };
  for (const raw of md.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) { flush(); out.subtitle = line.slice(3); }
    else if (line.startsWith('# ')) { flush(); out.title = line.slice(2); }
    else if (!line) flush();
    else para.push(line);
  }
  flush();
  return out;
}

class Note {
  readonly el = document.createElement('section');
  onClose: () => void = () => {};
  constructor(parent: HTMLElement, text: NoteText) {
    this.el.className = 'chart-note';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', text.title);
    const h = document.createElement('h2'); h.textContent = text.title;
    const s = document.createElement('p'); s.className = 'sub'; s.textContent = text.subtitle;
    const star = document.createElement('div'); star.className = 'star'; star.setAttribute('aria-hidden', 'true'); star.textContent = '✦';
    const body = text.body.map(t => { const p = document.createElement('p'); p.textContent = t; return p; });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.setAttribute('aria-label', 'Close'); close.textContent = '×';
    close.addEventListener('click', () => this.close());
    this.el.append(close, star, h, ...(text.subtitle ? [s] : []), ...body);
    parent.appendChild(this.el);
  }
  get isOpen() { return !this.el.hidden; }
  open() { this.el.hidden = false; requestAnimationFrame(() => this.el.classList.add('on')); (this.el.querySelector('.close') as HTMLElement).focus({ preventScroll: true }); }
  close() { if (this.el.hidden) return; this.el.classList.remove('on'); this.el.hidden = true; this.onClose(); }
}

// ------------------------------------------------------------------------------------------------ light and sky
/** Dynamic lights for him and the small brass things, matched to the bake; his star lights the table at night. */
function chartLights(parent: THREE.Object3D, room: Room) {
  const hemi = new THREE.HemisphereLight('#ffcfa0', '#4a3a55', 1.0);
  const sun = new THREE.DirectionalLight('#ffb070', 1.5);
  sun.position.set(1.2, 2.2, -5);
  const fill = new THREE.DirectionalLight('#c9b6ff', 0.4);
  fill.position.set(-1, 2, 4);
  const lantern = new THREE.PointLight('#ff9a4a', 1.6, 3.5, 1.6);
  lantern.position.set(-0.55, 1.05, -0.8);
  const hang = new THREE.PointLight('#ffa050', 2.4, 5, 1.6);
  hang.position.set(0, 2.46, 0.75);
  const starLight = new THREE.SpotLight('#cfdcff', 0, 6, 0.5, 0.8, 1.2);
  const sky = room.get('Star')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0.2, 4.68, -0.93);
  starLight.position.copy(sky);
  starLight.target.position.set(0, 0.9, -0.85);
  parent.add(hemi, sun, fill, lantern, hang, starLight, starLight.target);
  const S = { sky: new THREE.Color('#ffcfa0'), ground: new THREE.Color('#4a3a55'), hemi: 1.0, sun: new THREE.Color('#ffb070'), sunI: 1.5, lantern: 1.6, hang: 2.4 };
  const N = { sky: new THREE.Color('#3a4a7a'), ground: new THREE.Color('#1a1420'), hemi: 0.35, sun: new THREE.Color('#9fb6ff'), sunI: 0.2, lantern: 3.0, hang: 4.2 };
  return {
    hang,
    update() {
      const n = uNight.value, st = uStorm.value;
      hemi.color.lerpColors(S.sky, N.sky, n);
      hemi.groundColor.lerpColors(S.ground, N.ground, n);
      hemi.intensity = THREE.MathUtils.lerp(S.hemi, N.hemi, n) * (1 - 0.3 * st) + uFlash.value;
      sun.color.lerpColors(S.sun, N.sun, n);
      sun.intensity = THREE.MathUtils.lerp(S.sunI, N.sunI, n) * (1 - 0.6 * st) + uFlash.value * 2;
      const fl = 1 + 0.15 * n * Math.sin(uTime.value * 9.7) * Math.sin(uTime.value * 3.1 + 0.4);
      lantern.intensity = THREE.MathUtils.lerp(S.lantern, N.lantern, n) * fl;
      hang.intensity = THREE.MathUtils.lerp(S.hang, N.hang, n) * fl;
      starLight.intensity = n * (1 - 0.7 * st) * (2.2 + 0.3 * Math.sin(uTime.value * 1.3));
    },
  };
}

/** The sky through the skylight: dusk overhead at sunset with his star already out; at night, stars, and his the
 *  brightest of them, with a soft glow and a slow pulse. */
function starSky(star: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    toneMapped: false,
    uniforms: { uStar: { value: star.clone() }, uNight, uStorm, uTime: { value: 0 } },
    vertexShader: /* glsl */`varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uStar; uniform float uNight; uniform float uStorm; uniform float uTime; varying vec3 vW;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 p = vW.xz;
        float r = length(p - vec2(0.0, -0.75));
        vec3 dusk = mix(vec3(0.42, 0.36, 0.66), vec3(0.95, 0.62, 0.55), smoothstep(0.2, 1.6, r));
        vec3 night = mix(vec3(0.02, 0.03, 0.09), vec3(0.05, 0.07, 0.17), smoothstep(0.0, 1.6, r));
        vec3 col = mix(dusk, night, uNight);
        // the other stars: a fine grid of points, out at night
        vec2 g = p * 22.0; vec2 cell = floor(g); vec2 f = fract(g) - 0.5;
        float h = hash(cell);
        vec2 off = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
        float d = length(f - off * 0.7);
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + 3.0 * h) + h * 40.0);
        float s = step(0.82, h) * smoothstep(0.09, 0.0, d) * tw;
        col += vec3(0.85, 0.9, 1.0) * s * (0.15 + 0.85 * uNight);
        // his star: always there, the brightest at night
        vec2 q = p - uStar.xz;
        float dq = length(q);
        float pulse = 0.85 + 0.15 * sin(uTime * 0.9);
        float k = mix(0.55, 1.0, uNight) * pulse;
        float core = smoothstep(0.07, 0.0, dq);
        float glow = exp(-dq * mix(12.0, 6.0, uNight)) * mix(0.45, 1.1, uNight);
        float rays = (exp(-abs(q.x) * 90.0) * exp(-abs(q.y) * 4.0) + exp(-abs(q.y) * 90.0) * exp(-abs(q.x) * 4.0)) * mix(0.35, 1.0, uNight);
        col += vec3(1.0, 0.95, 0.85) * (core * 2.0 + glow + rays) * k;
        col = mix(col, vec3(dot(col, vec3(0.33))) * vec3(0.8, 0.86, 1.0), uStorm * 0.6);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function topName(o: THREE.Object3D): string {
  let p: THREE.Object3D | null = o;
  while (p) { if (/^(STATIC_|Sky_backdrop|Skylight_|Window_glass)/.test(p.name)) return p.name; p = p.parent; }
  return o.name;
}

const DOCK_NAME: Record<string, string> = { ugurcan: 'Ugurcan', table: 'Charts', star: 'His star', window: 'Windows' };
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _r = new THREE.Vector3(), _size = new THREE.Vector3();
const _box = new THREE.Box3();
const _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const _still = new THREE.PerspectiveCamera();
