// The library deck: the captain's library below the cabin, kept by his best friend, the Librarian. Its own chunk,
// fetched when the visitor first goes down (main.ts). Like Outside, it borrows the main camera (rig.cine) and the
// main scene: while below, everything of the cabin is hidden and the deck's group is shown. The library sits at the
// scene origin (its own coordinates, as built); the descent through the hatch is a continuous move with a short dip
// to black where the camera passes from the cabin's well into the library's.
//
//   books     one per topic of the notes index (content/topics), on the Book_slot<i> shelf places, in topic order
//   notes     clicking a note in the open book opens the main reader (writing/reader.ts) over the library
//   camera    the library's own director (push-in while he talks, fetch tracking) with the visitor's gestures on top,
//             the same as in the cabin (input.ts): drag to look around, two fingers / right-drag to slide, pinch /
//             scroll to zoom, double-tap a shelf to go and look (or back to the framing after looking around). The
//             gestures arrive on a layer of the deck's own over the canvas, so the cabin's handlers never see them;
//             the cabin's keys are forwarded here (main.ts)
//   stations  glowing dots (stations.ts) for the places to go: the Librarian, the bookcase, the side shelves, the
//             reading table, the portholes and the ladder up to the cabin
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CameraRig } from '../camera';
import type { Cabin } from '../scene';
import type { NotesIndex } from '../writing/types';
import { loadGLB } from '../scene';
import { FULL } from '../tier';
import { tween, ease, reducedMotion } from '../anim';
import { Input, type Point } from '../input';
import { Waypoints, type Station } from '../stations';
import { coach } from '../coach';
import { loadRoom, roomLights, type Room } from './room';
import { Librarian, type Events, type RuntimeConfig } from './librarian';
import { ScriptedBrain } from './brain';
import type { LibrarianBrain, Msg, Topic } from './types';
import { labelBooks } from './labels';
import { Chat } from './chat';
import { SpeechScroll } from './scroll3d';
import { OpenBook } from './book3d';
import { markShelves, shortName } from './shelves';
import { catalogueDrawer } from './drawer';
import { setupLife } from './life';
import { setupMoths } from './moths';
import { setupSway } from './sway';
import { setupDirector } from './director';
import './deck.css';

/** Shelf places in the room (blender/library/build.py SLOT_LIST): the first ones are within his reach. */
const SLOTS = 10;
/** The Librarian's runtime settings (characters/librarian.json in the Librarian repo). */
const RUNTIME: RuntimeConfig = { jaw_max_deg: 6, palm_half_thickness: 0.022, stand_off: 0.62 };
const VISITED_KEY = 'kk-library-visited';

export interface DeckHooks {
  /** Where the deck's HUD goes. */
  root: HTMLElement;
  index: NotesIndex;
  /** Open a note in the main reader. */
  openNote(slug: string): void;
  /** The main reader is open (the deck holds its input). */
  reading(): boolean;
  /** Below deck (true) or back in the cabin (false): hide or show the cabin's UI. */
  changed(below: boolean): void;
  /** The visitor asked to go back up (the button, Esc with nothing open). */
  up(): void;
  announce(text: string): void;
  paper?(): void;
  /** A syllable of his speech (the main sound engine). */
  blip?(): void;
}

type Phase = 'cabin' | 'down' | 'below' | 'up';

/** The library's topics from the notes index: topic order, notes with titles, keywords from the notes' tags. */
export function deckTopics(idx: NotesIndex): Topic[] {
  const meta = new Map(idx.notes.map(n => [n.slug, n]));
  return idx.topics.filter(t => t.notes.length).sort((a, b) => a.order - b.order).slice(0, SLOTS).map(t => {
    const notes = t.notes.map(s => meta.get(s)).filter(n => !!n);
    const kw = new Set<string>();
    for (const n of notes) for (const g of n.tags) kw.add(g.toLowerCase());
    for (const w of t.title.toLowerCase().split(/[^a-z0-9ğüşıöç]+/)) if (w.length > 2) kw.add(w);
    return { id: t.id, title: t.title, colour: t.colour, keywords: [...kw], notes: notes.map(n => ({ slug: n.slug, title: n.title })) };
  });
}

export class Deck {
  phase: Phase = 'cabin';
  readonly topics: Topic[];
  private group = new THREE.Group();
  private loaded: Promise<boolean> | null = null;
  private pose = { pos: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
  private hidden: THREE.Object3D[] = [];
  private stash: { bg: THREE.Scene['background']; env: THREE.Texture | null; envI: number } | null = null;
  private ui = document.createElement('div');
  private layer = document.createElement('div');
  private fade = document.createElement('div');
  private w: World | null = null;

  constructor(private scene: THREE.Scene, private rig: CameraRig, private renderer: THREE.WebGLRenderer, private cabin: Cabin, private hooks: DeckHooks) {
    this.topics = deckTopics(hooks.index);
    this.group.name = 'LibraryDeck';
    this.group.visible = false;
    scene.add(this.group);
    this.ui.className = 'deck-ui';
    this.ui.hidden = true;
    this.layer.className = 'deck-layer';
    this.layer.hidden = true;
    this.fade.className = 'deck-fade';
    hooks.root.append(this.layer, this.ui, this.fade);
  }

  get active() { return this.phase !== 'cabin'; }

  /** The cabin's camera keys while below (arrows, shift+arrows, +/-, 0): the same moves as the gestures. */
  orbit(dx: number, dy: number) { if (this.below) this.w?.orbit(dx, dy); }
  zoom(f: number) { if (this.below) this.w?.zoomGesture(f); }
  pan(dx: number, dy: number) { if (this.below) this.w?.panGesture(dx, dy); }
  reset() { if (this.below) this.w?.reset(); }

  /** Stations (stations.ts): for the dock and the address (?station=). */
  get stations() { return this.w?.stations ?? []; }
  get station() { return this.w?.station ?? null; }
  goStation(id: string) { if (this.below) this.w?.goStation(id); }
  /** The shared Back button's label below deck (null while going up or down). */
  get backLabel(): string | null { return this.below && this.w ? this.w.backLabel : null; }
  get below() { return this.phase === 'below'; }
  get busy() { return this.phase === 'down' || this.phase === 'up'; }

  /** Fetch and set up the room and the Librarian (once). */
  preload(): Promise<boolean> {
    return this.loaded ??= (async () => {
      try {
        const [roomGltf, libGltf, events] = await Promise.all([
          loadGLB(FULL ? '/assets/library.glb' : '/assets/library_lite.glb'),
          loadGLB(FULL ? '/assets/librarian.glb' : '/assets/librarian_lite.glb'),
          fetch('/assets/librarian.events.json').then(r => r.json() as Promise<Events>),
        ]);
        if (!roomGltf || !libGltf) return false;
        dressSlots(roomGltf, this.topics);
        const room = await loadRoom(roomGltf, FULL);
        this.w = new World(this.group, room, libGltf, events, this.topics, this.renderer, this.rig.camera, this.layer, this.ui, this.hooks);
        // compile now, so the first frame below does not stall
        this.group.visible = true;
        this.renderer.compile(this.group, this.rig.camera);
        this.group.visible = false;
        return true;
      } catch (e) {
        console.warn('[deck]', e);
        return false;
      }
    })();
  }

  /** From the hatch view: down the ladder into the library. `topic`: he fetches that book once you are down. */
  async enter(topic?: string): Promise<boolean> {
    if (this.phase !== 'cabin') { if (topic && this.below) this.w?.pickBook(topic); return true; }
    if (!(await this.preload()) || !this.w) return false;
    const w = this.w;
    this.phase = 'down';
    this.hooks.changed(true);
    const cam = this.rig.camera;
    const hatch = this.cabin.get('HATCH_anchor')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(-2.05, 0, 0.35);
    this.pose.pos.copy(cam.position);
    this.pose.target.copy(cam.position).add(cam.getWorldDirection(new THREE.Vector3()));
    this.pose.up.set(0, 1, 0);
    this.rig.cine = this.pose;
    const slow = reducedMotion ? 0 : 1;
    // over the opening, looking down the ladder (a little toward the ladder side, so lookAt never degenerates)
    const p0 = this.pose.pos.clone(), t0 = this.pose.target.clone();
    const over = new THREE.Vector3(hatch.x + 0.05, 1.25, hatch.z + 0.32), look = new THREE.Vector3(hatch.x - 0.12, -1.0, hatch.z);
    await tween(1.0 * slow, k => { this.pose.pos.lerpVectors(p0, over, k); this.pose.target.lerpVectors(t0, look, k); }, { ease: ease.inOutCubic, key: 'deck' });
    const into = new THREE.Vector3(hatch.x + 0.02, -0.55, hatch.z + 0.05);
    await tween(0.8 * slow, k => {
      this.pose.pos.lerpVectors(over, into, k);
      this.fade.style.opacity = String(THREE.MathUtils.smoothstep(k, 0.45, 1));
    }, { ease: ease.inOutCubic, key: 'deck' });
    this.fade.style.opacity = '1';
    // the cut: the cabin goes, the library comes; the camera is at the same place in the library's own well
    this.swap(true);
    const top = w.hatchTop;
    const lp = new THREE.Vector3(top.x + 0.02, top.y - 0.1, top.z + 0.05), lt = new THREE.Vector3(top.x - 0.12, top.y - 2.2, top.z);
    this.pose.pos.copy(lp); this.pose.target.copy(lt);
    const low = new THREE.Vector3(top.x + 0.1, 2.15, top.z + 0.1);
    await tween(0.7 * slow, k => {
      this.pose.pos.lerpVectors(lp, low, k);
      this.fade.style.opacity = String(1 - k);
    }, { ease: ease.outCubic, key: 'deck' });
    this.fade.style.opacity = '0';
    // turn to the room: ease onto the main shot, where the director takes over
    const home = w.home;
    const p1 = this.pose.pos.clone(), t1 = this.pose.target.clone();
    await tween(1.5 * slow, k => {
      this.pose.pos.lerpVectors(p1, home.pos, k);
      this.pose.target.lerpVectors(t1, home.target, k);
    }, { ease: ease.inOutCubic, key: 'deck' });
    this.phase = 'below';
    this.ui.hidden = false;
    w.arrive(topic);
    return true;
  }

  /** Back up the ladder to the cabin's hatch view. */
  async exit(): Promise<void> {
    if (this.phase !== 'below' || !this.w) return;
    const w = this.w;
    this.phase = 'up';
    this.ui.hidden = true;
    w.leave();
    const cam = this.rig.camera;
    this.pose.pos.copy(cam.position);
    this.pose.target.copy(cam.position).add(cam.getWorldDirection(new THREE.Vector3()));
    this.rig.cine = this.pose;
    const slow = reducedMotion ? 0 : 1;
    const top = w.hatchTop;
    const p0 = this.pose.pos.clone(), t0 = this.pose.target.clone();
    const under = new THREE.Vector3(top.x + 0.1, 2.0, top.z + 0.1), upLook = new THREE.Vector3(top.x - 0.15, top.y + 2, top.z);
    await tween(1.1 * slow, k => { this.pose.pos.lerpVectors(p0, under, k); this.pose.target.lerpVectors(t0, upLook, k); }, { ease: ease.inOutCubic, key: 'deck' });
    const well = new THREE.Vector3(top.x + 0.02, top.y - 0.1, top.z + 0.05);
    await tween(0.7 * slow, k => {
      this.pose.pos.lerpVectors(under, well, k);
      this.fade.style.opacity = String(THREE.MathUtils.smoothstep(k, 0.4, 1));
    }, { ease: ease.inCubic, key: 'deck' });
    this.fade.style.opacity = '1';
    this.swap(false);
    const hatch = this.cabin.get('HATCH_anchor')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(-2.05, 0, 0.35);
    const from = new THREE.Vector3(hatch.x + 0.02, -0.55, hatch.z + 0.05);
    this.pose.pos.copy(from); this.pose.target.set(hatch.x - 0.15, 2, hatch.z);
    const vp = this.rig.viewFor('hatch');
    const rise = new THREE.Vector3(hatch.x + 0.1, 1.2, hatch.z + 0.2);
    await tween(0.6 * slow, k => { this.pose.pos.lerpVectors(from, rise, k); this.fade.style.opacity = String(1 - k); }, { ease: ease.outCubic, key: 'deck' });
    this.fade.style.opacity = '0';
    const p1 = this.pose.pos.clone(), t1 = this.pose.target.clone();
    await tween(0.9 * slow, k => { this.pose.pos.lerpVectors(p1, vp.pos, k); this.pose.target.lerpVectors(t1, vp.target, k); }, { ease: ease.inOutCubic, key: 'deck' });
    this.rig.jump('hatch');
    this.rig.releaseCine(0.2);
    this.phase = 'cabin';
    this.hooks.changed(false);
  }

  /** Show the library and hide everything of the cabin (and back). */
  private swap(below: boolean) {
    const s = this.scene;
    if (below) {
      this.hidden = s.children.filter(o => o !== this.group && o.visible);
      for (const o of this.hidden) o.visible = false;
      this.stash = { bg: s.background, env: s.environment, envI: s.environmentIntensity };
      s.background = new THREE.Color('#1c1418');
      s.environment = null;
      this.group.visible = true;
      this.layer.hidden = false;
    } else {
      for (const o of this.hidden) o.visible = true;
      this.hidden = [];
      if (this.stash) { s.background = this.stash.bg; s.environment = this.stash.env; s.environmentIntensity = this.stash.envI; this.stash = null; }
      this.group.visible = false;
      this.layer.hidden = true;
      this.ui.hidden = true;
    }
  }

  /** Esc / the back gesture: close what is open, then go up. */
  escape() {
    if (!this.below || !this.w) return;
    if (!this.w.back()) this.hooks.up();
  }

  /** Ask him for a topic (search palette, a cabin book). */
  fetch(topicId: string) { if (this.below) this.w?.pickBook(topicId); }

  /** Per frame, after the camera rig: the room, the Librarian and (below) the camera. */
  update(dt: number, ship: { roll: number; pitch: number }) {
    if (!this.w || !this.group.visible) return;
    this.w.update(dt, ship, this.phase === 'below' && !this.hooks.reading());
    if (this.phase === 'below') {
      // keep the rig's cine pose where the deck put the camera, so leaving starts from what is on screen
      const c = this.rig.camera;
      this.pose.pos.copy(c.position);
      this.pose.target.copy(c.position).add(c.getWorldDirection(new THREE.Vector3()));
    }
  }
}

/** Book_slot<i> → Book_<topic id> (and its mesh), in a cover of the topic's colour. */
function dressSlots(gltf: GLTF, topics: Topic[]) {
  topics.forEach((t, i) => {
    const node = gltf.scene.getObjectByName(`Book_slot${i}`);
    if (!node) return;
    node.name = `Book_${t.id}`;
    node.userData.topic = t.id;
    node.userData.title = t.title;
    node.traverse(o => {
      if (o.name.startsWith(`BookMesh_slot${i}`)) o.name = o.name.replace(`slot${i}`, t.id);
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const recolour = (mat: THREE.Material) => {
        if (mat.name === 'Pages') return mat;
        const c = mat.clone() as THREE.MeshStandardMaterial;
        c.color.set(t.colour);
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(recolour) : recolour(m.material);
    });
  });
}

/** Everything below deck: the room, the Librarian, the in-world UI, the camera and the pointer. */
class World {
  readonly hatchTop: THREE.Vector3;
  readonly home: { pos: THREE.Vector3; target: THREE.Vector3 };
  private lib: Librarian;
  private lights: ReturnType<typeof roomLights>;
  private life: ReturnType<typeof setupLife>;
  private moths: ReturnType<typeof setupMoths>;
  private sway: ReturnType<typeof setupSway>;
  private director: ReturnType<typeof setupDirector>;
  private chat: Chat;
  private brain: LibrarianBrain;
  private matcher: ScriptedBrain;
  private scroll: SpeechScroll;
  private book3d: OpenBook;
  private drawer: ReturnType<typeof catalogueDrawer>;
  private history: Msg[] = [];
  private recommended: string[] = [];
  private shown = 0; private added = 0; private spoken = '';
  private reading: { topic?: Topic; book?: THREE.Object3D } | null = null;
  private waiters: (() => boolean)[] = [];
  private hovered: string | null = null;
  private bookMeshes: THREE.Object3D[] = [];
  private bookOf = new Map<THREE.Object3D, string>();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  // camera: pan (metres in the camera's plane), zoom (lens), tilt with the vertical pan, narrow-screen follow
  private pan = { x: 0, y: 0, tx: 0, ty: 0 };
  private zoom = 1; private tZoom = 1;
  private lensFov = 50;
  private readBlend = 0;
  private follow = { yaw: 0, pitch: 0 };
  /** The visitor's look around (radians, goal and damped), on top of the director's shot. */
  private turn = { yaw: 0, pitch: 0, tyaw: 0, tpitch: 0 };
  private way: Waypoints;
  private stationList: Station[] = [];
  /** Camera poses of the stations other than his (the main shot) and the ladder (which leaves). */
  private stops = new Map<string, { pos: THREE.Vector3; target: THREE.Vector3 }>();
  private greeted = false;
  private flame = new THREE.Vector3();

  constructor(group: THREE.Group, private room: Room, libGltf: GLTF, events: Events, private topics: Topic[],
    renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, private layer: HTMLElement, ui: HTMLElement, private hooks: DeckHooks) {
    group.add(room.root);
    const aniso = Math.min(FULL ? 16 : 4, renderer.capabilities.getMaxAnisotropy());
    const seen = new Set<THREE.Texture>();
    room.root.traverse(o => {
      for (const m of ([] as THREE.Material[]).concat((o as THREE.Mesh).material ?? [])) {
        for (const t of [(m as THREE.MeshBasicMaterial).map, (m as THREE.MeshBasicMaterial).lightMap]) if (t && !seen.has(t)) { seen.add(t); t.anisotropy = aniso; t.needsUpdate = true; }
      }
    });
    this.lights = roomLights(group);
    labelBooks(room.get, topics, !FULL);
    markShelves(group, room.get, topics, !FULL);
    this.lib = new Librarian(libGltf, room, events, blobTexture(), RUNTIME);
    group.add(this.lib.root);
    this.lib.model.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      for (const t of [m?.map, m?.normalMap]) if (t) { t.anisotropy = aniso; t.needsUpdate = true; }
    });

    // the deck hatch (its top, where the cabin's well meets the library's) and the main shot
    room.root.updateMatrixWorld(true);
    const hb = new THREE.Box3().setFromObject(room.get('STATIC_deckhatch') ?? room.root);
    const hd = room.get('HATCH_deck')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(-1.9, 0, 1.8);
    this.hatchTop = new THREE.Vector3(hd.x, room.get('STATIC_deckhatch') ? hb.max.y : 3.8, hd.z);
    const camEmpty = room.get('Camera_main')!;
    camEmpty.updateWorldMatrix(true, false);
    this.home = { pos: camEmpty.getWorldPosition(new THREE.Vector3()), target: new THREE.Vector3().fromArray(camEmpty.userData.target as number[]) };
    const table = room.get('Table_drop')!.getWorldPosition(new THREE.Vector3());
    this.director = setupDirector(this.home, this.lib, table.clone().add(new THREE.Vector3(0, 0.1, 0)));
    this.way = new Waypoints(ui, id => this.goStation(id), 'deck');
    this.setupStations(hd);

    // UI
    this.chat = new Chat(ui);
    this.brain = new ScriptedBrain(topics, 45);
    this.matcher = new ScriptedBrain(topics, 0);
    this.life = setupLife(group, room, this.lib, topics, t => this.matcher.match(t, true));
    this.moths = setupMoths(group, { lite: !FULL });
    this.sway = setupSway({ lantern: room.get('STATIC_hanging_lantern'), light: this.lights.hang });
    this.scroll = new SpeechScroll(group);
    this.book3d = new OpenBook(group);
    const roomMap = (name: string) => {
      let map: THREE.Texture | null = null;
      room.root.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial; if (!map && m?.name === name && m.map) map = m.map; });
      return map;
    };
    this.drawer = catalogueDrawer(table, { wood: roomMap('Mahogany'), brass: roomMap('Brass') });
    group.add(this.drawer.group);

    this.lib.onSyllable = () => hooks.blip?.();
    this.lib.onBookLanded = id => {
      const t = topics.find(x => x.id === id);
      const b = room.get(`Book_${id}`);
      if (!t || !b) return;
      b.visible = false;
      const drop = room.get('Table_drop')!.getWorldPosition(new THREE.Vector3());
      this.book3d.open(t, this.recommended, drop.add(new THREE.Vector3(-0.2, 0, -0.03)), camera);
      hooks.paper?.();
      hooks.announce(`${t.title} is open on the table: ${t.notes.map(n => n.title).join(', ')}.`);
      this.reading = { topic: t, book: b };
      this.pan.tx = this.pan.ty = 0;
    };
    this.book3d.onClose = () => { if (this.reading?.book) this.reading.book.visible = true; this.reading = null; this.pan.tx = this.pan.ty = 0; };
    this.chat.onSend = text => { this.chat.setHint(null); void this.ask(text); };
    const input = this.askInput();
    input.addEventListener('input', () => {
      this.life.poke();
      const f = this.matcher.search.find(input.value, true).best;
      this.chat.setHint(!input.value.trim() || !f ? null : f.note ? `"${f.note.title}"` : f.topic.title);
    });
    input.addEventListener('focus', () => { if (this.lib.state === 'idle') this.lib.setState('listening'); });
    input.addEventListener('blur', () => { if (this.lib.state === 'listening') this.lib.setState('idle'); });
    this.setChips();

    for (const t of topics) {
      room.get(`Book_${t.id}`)?.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = Array.isArray(m.material) ? m.material.map(x => x.clone()) : m.material.clone();
        this.bookMeshes.push(m);
        this.bookOf.set(m, t.id);
      });
    }
    this.pointer();
  }

  private askInput() { return this.chat.el.querySelector('input') as HTMLInputElement; }
  private until(test: () => boolean) { return new Promise<void>(res => { this.waiters.push(() => { if (test()) { res(); return true; } return false; }); }); }
  private busy() { return (this.chat.el.querySelector('button[type=submit]') as HTMLButtonElement).disabled || this.lib.state === 'fetching' || this.lib.state === 'handing_over'; }
  private speak(text: string) { this.lib.speak(text); this.chat.add(text); this.added += text.length; this.spoken += text; }
  private newReply() { this.chat.startReply(); this.shown = 0; this.added = 0; this.spoken = ''; this.scroll.begin(); }

  /** Down the ladder: he greets you (and fetches a book if you came down for one). */
  arrive(topic?: string) {
    this.goHome();
    if (topic && this.topics.some(t => t.id === topic)) { this.greeted = true; void this.pickBook(topic, true); return; }
    if (this.greeted) {
      this.newReply();
      this.speak('Back again! Which of the captain’s subjects shall we open?');
      this.lib.emote('wave');
      this.lib.setState('talking');
      void this.until(() => !this.lib.speaking).then(() => this.scroll.done());
      return;
    }
    this.greeted = true;
    let visited = false;
    try { visited = localStorage.getItem(VISITED_KEY) === '1'; localStorage.setItem(VISITED_KEY, '1'); } catch { /* storage blocked */ }
    this.newReply();
    this.lib.emote('wave');
    if (visited) this.speak('Welcome back below! Ask me for a subject, tap one below, or take a book from the shelf.');
    else {
      this.speak('Ahoy, and welcome below! I keep the captain’s library. The books with brass nameplates are his notes: ask me for a subject, tap one below, or browse the card catalogue on the table.');
      const tour = this.topics.map(t => t.id);
      setTimeout(() => { this.lib.emote('point'); this.life.suggest(tour, 8); }, 1800);
    }
    // getting around: the same hint as upstairs and outside (once), above his chat
    setTimeout(() => coach('library', { above: this.chat.el }), 1200);
    this.lib.setState('talking');
    void this.until(() => !this.lib.speaking).then(() => this.scroll.done());
  }

  /** Going up: put the open book away and stop talking. */
  leave() {
    this.closeBook();
    this.goHome();
    void this.lib.interrupt();
    this.scroll.hide();
    this.askInput().blur();
  }

  /** Esc: close the book, or come back from looking around. False when there was nothing to close. */
  back(): boolean {
    if (this.reading) { this.closeBook(); return true; }
    if (this.director.away) { this.goHome(); return true; }
    return false;
  }

  private closeBook() {
    if (!this.reading) return;
    this.book3d.close();
  }

  async ask(text: string) {
    this.goHome();
    this.life.poke();
    await this.lib.interrupt();
    this.chat.setBusy(true);
    this.history.push({ role: 'user', text });
    this.closeBook();
    this.newReply();
    this.lib.setState('thinking');
    let said = '';
    let fetchId: string | null = null;
    this.recommended = [];
    try {
      for await (const ev of this.brain.reply(this.history, text)) {
        if (ev.type === 'text') { if (!said) this.lib.setState('talking'); said += ev.delta; this.speak(ev.delta); }
        else if (ev.type === 'emote') this.lib.emote(ev.kind);
        else if (ev.type === 'fetch_book') fetchId = ev.topicId;
        else if (ev.type === 'recommend_notes') this.recommended = ev.slugs;
        else if (ev.type === 'suggest_books') { this.life.suggest(ev.topicIds, 12); this.setChips(ev.topicIds); }
      }
    } catch (e) {
      this.speak('Forgive me, I lost my place. Ask me again?');
      console.error(e);
    }
    this.history.push({ role: 'librarian', text: said });
    await this.until(() => !this.lib.speaking);
    this.scroll.done();
    if (fetchId) await this.lib.fetch(fetchId);
    this.chat.setBusy(false);
  }

  /** The visitor took a book from the shelf (or came down for one): he comments and brings it down. */
  async pickBook(topicId: string, arriving = false) {
    const t = this.topics.find(x => x.id === topicId);
    if (!t) return;
    if (this.busy()) { await this.until(() => !this.busy()); }
    this.goHome();
    this.life.poke();
    await this.lib.interrupt();
    this.chat.setBusy(true);
    this.closeBook();
    await this.until(() => !this.reading);
    this.newReply();
    this.lib.emote(arriving ? 'wave' : 'nod');
    this.lib.setState('talking');
    const n = t.notes.length, notes = `${n} note${n === 1 ? '' : 's'}`;
    const lines = arriving
      ? [`Ahoy! You came down for ${t.title}? The captain wrote ${notes} in it. Let me fetch it.`, `Welcome below! ${t.title}, is it? One moment, I know just where it is.`]
      : [`Ah, ${t.title}. The captain wrote ${notes} in that one; let me bring it down.`, `${t.title}? Good eye. One moment.`, `You found ${t.title}. I’ll fetch it for you.`];
    this.speak(lines[Math.floor(Math.random() * lines.length)]);
    this.history.push({ role: 'user', text: `(takes ${t.title} from the shelf)` });
    this.recommended = t.notes.map(x => x.slug).slice(0, 1);
    await this.until(() => !this.lib.speaking);
    this.scroll.done();
    await this.lib.fetch(topicId);
    this.chat.setBusy(false);
  }

  private setChips(ids?: string[]) {
    const pickT = ids?.length ? this.topics.filter(t => ids.includes(t.id)).slice(0, 4) : this.topics.slice(0, 4);
    this.chat.setChips([
      ...pickT.map(t => ({ label: shortName(t), title: `Fetch ${t.title}`, onPick: () => void this.pickBook(t.id) })),
      { label: 'What do you have?', onPick: () => void this.ask('What do you have?') },
      { label: 'Catalogue', title: 'Open the card catalogue', onPick: () => this.openCatalogue() },
    ]);
  }

  private openCatalogue() {
    if (this.busy() || (this.reading && this.book3d.kind === 'catalogue')) return;
    this.goHome();
    void this.lib.interrupt();
    this.life.poke();
    if (this.reading) this.closeBook();
    const at = this.room.get('Table_drop')!.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(-0.2, 0, -0.03));
    const go = () => {
      this.lib.returnTableBook();
      this.book3d.openCatalogue(this.topics, at, this.camera);
      this.hooks.paper?.();
      this.reading = {};
      this.pan.tx = this.pan.ty = 0;
      this.lib.emote('nod');
    };
    if (this.book3d.isOpen || this.reading) void this.until(() => !this.reading).then(go); else go();
  }

  // ------------------------------------------------------------ camera
  private focusDist() { return THREE.MathUtils.lerp(4, 0.6, this.readBlend); }
  private halfH(z: number) { return this.focusDist() * Math.tan(THREE.MathUtils.degToRad(this.lensFov / 2)) / z; }
  private clampPan() {
    const r = this.readBlend > 0.5 ? 0.25 : this.director.away ? 0.45 : 1;
    this.pan.tx = THREE.MathUtils.clamp(this.pan.tx, -1.6 * r, 1.6 * r);
    this.pan.ty = THREE.MathUtils.clamp(this.pan.ty, -0.7 * r, 0.8 * r);
  }
  private zoomAt(factor: number, cx: number, cy: number) {
    const before = this.tZoom;
    this.tZoom = THREE.MathUtils.clamp(this.tZoom * factor, 1, 3);
    if (this.tZoom === before) return;
    const nx = (cx / innerWidth) * 2 - 1, ny = -(cy / innerHeight) * 2 + 1;
    const dh = this.halfH(before) - this.halfH(this.tZoom);
    this.pan.tx += nx * dh * this.camera.aspect;
    this.pan.ty += ny * dh;
    if (this.tZoom === 1 && this.tZoom < before) { this.pan.tx *= 0.5; this.pan.ty *= 0.5; }
    this.clampPan();
  }
  private panBy(dxPx: number, dyPx: number, from = { x: this.pan.tx, y: this.pan.ty }) {
    const mpp = (2 * this.halfH(this.tZoom)) / innerHeight;
    this.pan.tx = from.x - dxPx * mpp;
    this.pan.ty = from.y + dyPx * mpp / (1 + TILT * this.focusDist() * (1 - this.readBlend));
    this.clampPan();
  }
  private goLook(cx: number, cy: number) {
    if (this.reading) return;
    this.cast(cx, cy);
    const hit = this.ray.intersectObject(this.room.root, true).find(h => h.face && !/Sky_backdrop/.test(h.object.name));
    if (!hit) return;
    const p = hit.point.clone(), n = hit.face!.normal.clone().transformDirection(hit.object.matrixWorld), go = new THREE.Vector3();
    if (n.dot(this.ray.ray.direction) > 0) n.negate();
    if (Math.abs(n.y) > 0.7) {
      go.copy(this.ray.ray.direction).setY(0).normalize().multiplyScalar(-1.3).add(p);
      go.y = THREE.MathUtils.clamp(p.y + (n.y > 0 ? 1.0 : -1.0), 0.9, 2.6);
    } else {
      if (p.z < -2.35) n.set(0, 0, 1);
      else if (Math.abs(p.x) > 1.95) n.set(-Math.sign(p.x), 0, 0);
      else { n.y = 0; n.normalize(); }
      go.copy(p).addScaledVector(n, 1.3);
      go.y = THREE.MathUtils.clamp(p.y + 0.15, 1.0, 2.6);
    }
    go.x = THREE.MathUtils.clamp(go.x, -2.1, 2.1);
    go.z = THREE.MathUtils.clamp(go.z, -2.3, 2.9);
    this.director.goTo(go, p);
    this.resetFraming();
    this.way.setCurrent(null);
    this.life.poke();
  }
  private goHome() {
    this.way.setCurrent('librarian');
    if (!this.director.away) return;
    this.director.goHome();
    this.resetFraming();
  }
  private cast(cx: number, cy: number) {
    this.ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  // ------------------------------------------------------------ stations (stations.ts)
  private setupStations(hatch: THREE.Vector3) {
    const V = THREE.Vector3, get = (n: string) => this.room.get(n);
    const shot = (name: string, pos: THREE.Vector3, target: THREE.Vector3) => {
      const e = get(name);
      if (!e?.userData.target) return { pos, target };
      e.updateWorldMatrix(true, false);
      return { pos: e.getWorldPosition(new V()), target: new V().fromArray(e.userData.target as number[]) };
    };
    this.stops.set('bookcase', shot('Camera_shelf', new V(0.2, 1.5, 0.4), new V(0, 1.5, -3)));
    this.stops.set('side', { pos: new V(-0.5, 1.55, 0.5), target: new V(-2.48, 1.15, -1.0) });
    this.stops.set('table', shot('Camera_table', new V(0.9, 1.45, 2.05), new V(0.2, 0.85, 0.5)));
    const fixed = (p: THREE.Vector3) => () => p;
    const head = new V();
    const stations: Station[] = [
      { id: 'librarian', label: 'The Librarian — ask him for a subject', spot: () => this.lib.bone('head').getWorldPosition(head).add(_lift) },
      { id: 'bookcase', label: 'Bookcase — one volume for each of the captain’s subjects', spot: fixed(new V(0.35, 0.04, -2.15)) },
      { id: 'side', label: 'Side shelves — the rest of the collection', spot: fixed(new V(-1.95, 0.04, -0.2)) },
      { id: 'table', label: 'Reading table — the card catalogue', spot: fixed(new V(1.15, 0.82, 0.55)) },
    ];
    const ports = get('STATIC_portholes');
    if (ports) {
      // a row along one side wall: go to the porthole nearest the bookcase (the one in view from his shot)
      const box = new THREE.Box3().setFromObject(ports);
      const side = Math.sign(box.min.x + box.max.x) || 1;
      const c = new V(side > 0 ? box.max.x - 0.1 : box.min.x + 0.1, (box.min.y + box.max.y) / 2, box.min.z + 0.3);
      const pos = new V(c.x - side * 1.7, 1.55, c.z + 0.05); // straight on: the hull ribs either side stay clear
      this.stops.set('portholes', { pos, target: c.clone().setY(c.y - 0.05) });
      stations.push({ id: 'portholes', label: 'Porthole — the sky outside', spot: fixed(c.clone().setX(c.x - side * 0.08)) });
    }
    stations.push({ id: 'up', label: 'Ladder — up to the cabin', spot: fixed(new V(hatch.x, 1.6, hatch.z)) });
    this.way.set(stations);
    this.stationList = stations;
    this.way.setCurrent('librarian');
  }

  /** The station he is at (null: looking at a spot the visitor picked). */
  get station() { return this.way.at; }
  /** The stations for the dock (the ladder is the dock's Cabin button there). */
  get stations() { return this.stationList.filter(s => s.id !== 'up').map(s => ({ id: s.id, label: DOCK_NAME[s.id] ?? s.label.split(' — ')[0] })); }
  /** What the shared Back button does here: close what is open, come back to him, or climb up. */
  get backLabel() {
    if (this.reading) return this.book3d.kind === 'catalogue' ? 'Close the catalogue' : 'Close the book';
    return this.director.away ? 'Back to the Librarian' : 'Up to the cabin';
  }

  /** Go to a station (the ladder leaves for the cabin). */
  goStation(id: string) {
    if (id === 'up') { this.hooks.up(); return; }
    if (this.reading) this.closeBook();
    if (id === 'librarian') { this.goHome(); return; }
    const s = this.stops.get(id);
    if (!s) return;
    this.director.goTo(s.pos, s.target);
    this.resetFraming();
    this.way.setCurrent(id);
    this.life.poke();
    this.hooks.announce(`At the ${id === 'side' ? 'side shelves' : id === 'table' ? 'reading table' : id}.`);
  }

  // ------------------------------------------------------------ gestures (input.ts, on the deck's own layer)
  private get offset() {
    return Math.abs(this.turn.tyaw) > 0.02 || Math.abs(this.turn.tpitch) > 0.02 || Math.abs(this.tZoom - 1) > 0.02 || Math.hypot(this.pan.tx, this.pan.ty) > 0.02;
  }
  private resetFraming() { this.pan.tx = this.pan.ty = 0; this.tZoom = 1; this.turn.tyaw = this.turn.tpitch = 0; }

  /** Drag: fractions of the screen. Dragging the world, as in the cabin: finger right → look left. */
  orbit(dx: number, dy: number) {
    if (this.readBlend > 0.5) return;
    const k = 1.3 / this.tZoom, t = this.turn;
    t.tyaw = THREE.MathUtils.clamp(t.tyaw + dx * k, -0.6, 0.6);
    t.tpitch = THREE.MathUtils.clamp(t.tpitch + dy * k, -0.35, 0.3);
  }
  /** <1 closer, >1 further, toward `at` (or the middle). */
  zoomGesture(f: number, at?: Point) { this.zoomAt(1 / f, at?.x ?? innerWidth / 2, at?.y ?? innerHeight / 2); }
  /** Slide: fractions of the screen; the room follows the fingers. */
  panGesture(dx: number, dy: number) { this.panBy(dx * innerWidth, dy * innerHeight); }
  /** Double-tap / "0": back to the framing after looking around; on a framed view, go and look where it was tapped. */
  reset(at?: Point) {
    if (this.offset) { this.resetFraming(); return; }
    if (at) { if (!this.pick(at)) this.goLook(at.x, at.y); return; }
    this.goHome();
  }

  /** A book on the shelf or the catalogue drawer under the point. */
  private pick(at: Point): 'drawer' | string | null {
    if (this.reading || this.busy()) return null;
    this.cast(at.x, at.y);
    const hit = this.ray.intersectObjects(this.bookMeshes, false)[0];
    const id = hit ? this.bookOf.get(hit.object) : undefined;
    return id ?? (this.drawer.hit(this.ray) ? 'drawer' : null);
  }

  private tap(at: Point) {
    this.cast(at.x, at.y);
    if (this.reading) {
      const slug = this.book3d.pick(this.ray);
      if (slug?.startsWith('topic:')) { this.closeBook(); void this.until(() => !this.reading).then(() => this.pickBook(slug.slice(6))); return; }
      if (slug) { this.hooks.openNote(slug); return; }
      if (!this.book3d.over(this.ray)) this.closeBook();
      return;
    }
    const what = this.pick(at);
    if (what === 'drawer') { this.drawer.highlight(false); this.openCatalogue(); }
    else if (what) { this.hovered = null; void this.pickBook(what); }
  }

  private hover(at: Point) {
    const el = this.layer;
    if (this.reading) { this.cast(at.x, at.y); el.style.cursor = this.book3d.pick(this.ray) ? 'pointer' : ''; return; }
    const what = this.pick(at);
    this.hovered = what && what !== 'drawer' ? what : null;
    this.drawer.highlight(what === 'drawer');
    el.style.cursor = what ? 'pointer' : '';
  }

  private pointer() {
    this.layer.addEventListener('pointerdown', () => this.life.poke());
    // Things to tap: the shared input counts a tap on one of these as a tap, never toward a double-tap.
    const targets = () => this.reading ? [this.book3d.group] : [...this.bookMeshes, this.drawer.group];
    new Input(this.layer, this.camera, {
      targets,
      hover: (_hit, at) => { if (at) this.hover(at); },
      click: (_hit, at) => this.tap(at),
      dragStart: () => false,
      drag: () => {},
      dragEnd: () => {},
      swipeDown: () => { this.back(); },
      escape: () => {},
      look: () => {},
      orbit: (dx, dy) => this.orbit(dx, dy),
      zoom: (f, at) => this.zoomGesture(f, at),
      pan: (dx, dy) => this.panGesture(dx, dy),
      reset: at => this.reset(at),
    }, { keys: false, passThrough: 'deck' });
  }

  // ------------------------------------------------------------ frame
  /** `control`: the deck owns the camera this frame (below, and the reader is not over it). */
  update(dt: number, ship: { roll: number; pitch: number }, control: boolean) {
    const cam = this.camera;
    this.room.update();
    this.lights.update();
    this.moths.update(this.sway.flame(this.flame));
    // lens: keep at least a 3:2 view on narrow screens (wider vertical angle, capped), narrowed by the zoom
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) * 1.5);
    this.lensFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / cam.aspect)), 50, 78);
    if (control) this.frameCamera(dt);
    this.way.setVisible(control && !this.reading && this.readBlend < 0.05);
    if (control) this.way.update(cam);
    this.sway.update(dt, control ? cam : _still, ship);
    this.book3d.update(dt);
    this.life.update(dt, {
      hovered: this.hovered, typing: this.askInput().value,
      reading: this.reading && this.book3d.isOpen ? this.book3d.readAt : null,
      quiet: !this.reading && !this.busy() && !this.lib.speaking,
    });
    this.lib.update(dt, cam);
    const reveal = this.added - this.lib.speechLeft - this.shown;
    if (reveal > 0) { this.chat.tick(reveal); this.shown += reveal; this.scroll.set(this.spoken.slice(0, this.shown)); }
    this.scroll.update(dt, cam, this.lib.bone('head').getWorldPosition(new THREE.Vector3()));
    if (this.reading || this.director.away) this.scroll.hide();
    for (let i = this.waiters.length - 1; i >= 0; i--) if (this.waiters[i]()) this.waiters.splice(i, 1);
  }

  private frameCamera(dt: number) {
    const cam = this.camera, pan = this.pan;
    if (this.director.away) { this.follow.yaw *= 0.9; this.follow.pitch *= 0.9; } else this.followAngles(dt);
    const k = 1 - Math.exp(-dt * 6);
    if (!Number.isFinite(pan.x + pan.y + pan.tx + pan.ty + this.zoom + this.tZoom)) { pan.x = pan.y = pan.tx = pan.ty = 0; this.zoom = this.tZoom = 1; }
    pan.x += (pan.tx - pan.x) * k;
    pan.y += (pan.ty - pan.y) * k;
    const shot = this.director.update(dt, { reading: !!this.reading, narrow: cam.aspect < 1.2 });
    cam.position.copy(shot.pos);
    cam.up.set(0, 1, 0);
    this.zoom += (this.tZoom - this.zoom) * k;
    const fov = this.lensFov / this.zoom;
    if (Math.abs(cam.fov - fov) > 1e-4) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (cam.view) cam.clearViewOffset();
    const t = this.turn, free = 1 - this.readBlend;
    t.yaw += (t.tyaw - t.yaw) * k;
    t.pitch += (t.tpitch - t.pitch) * k;
    cam.quaternion.copy(shot.quat).multiply(_q.setFromEuler(_e.set(this.follow.pitch + (pan.y * TILT + t.pitch) * free, this.follow.yaw + t.yaw * free, 0)));
    this.readBlend += ((this.book3d.isOpen ? 1 : 0) - this.readBlend) * (1 - Math.exp(-dt * 3));
    if (this.readBlend > 0.001) {
      const m = new THREE.Matrix4().lookAt(this.book3d.readPos, this.book3d.readAt, _up.set(0, 1, 0));
      const e = THREE.MathUtils.smoothstep(this.readBlend, 0, 1);
      cam.position.lerp(this.book3d.readPos, e);
      cam.quaternion.slerp(_q.setFromRotationMatrix(m), e);
    }
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
    _up.set(0, 1, 0);
    if (this.readBlend > 0.5) _up.applyQuaternion(cam.quaternion);
    cam.position.addScaledVector(_right, pan.x).addScaledVector(_up, pan.y);
    if (this.readBlend < 0.5) {
      cam.position.x = THREE.MathUtils.clamp(cam.position.x, -2.2, 2.2);
      cam.position.y = THREE.MathUtils.clamp(cam.position.y, 0.75, 2.75);
      cam.position.z = Math.min(cam.position.z, 2.9);
    }
  }

  /** Narrow screens: turn to keep his head in the middle of the view. */
  private followAngles(dt: number) {
    const cam = this.camera;
    const narrow = cam.aspect < 1.2;
    let yaw = 0, pitch = narrow ? -0.13 : 0;
    if (narrow) {
      const head = this.lib.bone('head').getWorldPosition(new THREE.Vector3());
      const base = this.home;
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(base.pos, base.target, _up.set(0, 1, 0)));
      const local = head.sub(base.pos).applyQuaternion(q.invert());
      const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect);
      const ang = Math.atan2(-local.x, -local.z);
      const margin = hHalf * 0.55;
      if (Math.abs(ang) > margin) yaw = THREE.MathUtils.clamp(ang - Math.sign(ang) * margin, -0.7, 0.7);
      const vHalf = THREE.MathUtils.degToRad(cam.fov / 2);
      const up = Math.atan2(local.y, -local.z);
      if (up > vHalf * 0.45) pitch = Math.min(pitch + up - vHalf * 0.45, 0.35);
    }
    const k = 1 - Math.exp(-dt * 3);
    this.follow.yaw += (yaw - this.follow.yaw) * k;
    this.follow.pitch += (pitch - this.follow.pitch) * k;
  }
}

/** Radians of tilt per metre of vertical pan: panning up or down also looks up or down a little. */
const TILT = 0.42;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _right = new THREE.Vector3(), _up = new THREE.Vector3();
/** Short names for the dock (it has to fit a phone's width). */
const DOCK_NAME: Record<string, string> = { librarian: 'Librarian', bookcase: 'Bookcase', side: 'Shelves', table: 'Table', portholes: 'Porthole' };
/** His dot floats this far above his head. */
const _lift = new THREE.Vector3(0, 0.38, 0);
/** A stand-in for the camera while the deck does not own it (the sway leans the camera it is given). */
const _still = new THREE.PerspectiveCamera();

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.9)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
