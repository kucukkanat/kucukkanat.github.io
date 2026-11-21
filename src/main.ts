import { plainFx, setupShafts, type Fx } from './fx';
import { FULL } from './tier';
import type { Outside } from './outside';
import { wantsIntro } from './intro-flag';
import { setupPatch } from './patch';
import type { Writing } from './writing/reader';
import type { Search, SearchItem } from './writing/search';
import { loadNotesIndex, shelveTopics, topicOf, topicItemId } from './writing/shelf';
import './style.css';
import * as THREE from 'three';
import { loadContent, findItem } from './content';
import { loadCaptain } from './captain';
import { loadGLB, indexCabin, makeManager, type ViewName, type Cabin, type EggId } from './scene';
import { setupLighting, prefetchLightmap } from './lighting';
import { setupSky, prefetchSky } from './sky';
import { Collectibles, type Collectible, type Place } from './collectibles';
import { CameraRig } from './camera';
import { UI } from './ui';
import { Play } from './play';
import { Input } from './input';
import { audio } from './audio';
import { fontsReady } from './labels';
import { tween, updateTweens, tweensActive, reducedMotion, clamp } from './anim';
import { setupProps } from './props';
import { Weather } from './weather';
import { setupDust } from './dust';
import { Sheets, type SheetKind } from './sheets';
import { Inspector, INSPECT_LAYER, type InspectKind } from './inspect';
import { ShipMotion } from './ship';
import { Hanging, addTestRigs } from './hang';
import { LetterView } from './letter';
import { ShipClock } from './clock';
import { uRainSlant } from './lighting';
import { lockZoom, registerSW } from './pwa';

lockZoom();
registerSW();

const LETTER_KEY = 'kk-letter';
const LETTER_ID = '__letter';
const INSPECT_KINDS = new Set(['cartridge', 'book', 'notebook', 'memcard']);

const params = new URLSearchParams(location.search);
const loaderFill = document.getElementById('loader-fill');
const loaderText = document.getElementById('loader-text');
// One-time hint about the camera controls; hidden on the first drag/zoom or after a few seconds.
let hintEl: HTMLElement | null = null;
const hideHint = () => { if (!hintEl) return; hintEl.classList.remove('on'); const el = hintEl; hintEl = null; setTimeout(() => el.remove(), 400); };
const showHint = () => {
  let seen = false;
  try { seen = localStorage.getItem('kk-hint') === '1'; localStorage.setItem('kk-hint', '1'); } catch { /* private mode */ }
  if (seen) return;
  const touch = matchMedia('(pointer: coarse)').matches;
  hintEl = document.createElement('div');
  hintEl.className = 'cam-hint';
  hintEl.setAttribute('role', 'status');
  hintEl.textContent = touch ? 'Drag to look · two fingers to zoom and pan · double-tap to reset' : 'Drag to look · scroll to zoom · right-drag to pan · double-click to reset';
  document.body.appendChild(hintEl);
  requestAnimationFrame(() => hintEl?.classList.add('on'));
  setTimeout(hideHint, 6000);
};
const showNote = (text: string) => {
  document.querySelectorAll('.cam-hint.note').forEach(n => n.remove());
  const el = document.createElement('div');
  el.className = 'cam-hint note'; el.setAttribute('role', 'status'); el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 400); }, 2200);
};
const setProgress = (p: number) => { if (loaderFill) loaderFill.style.width = `${Math.round(p * 100)}%`; };

const VIEW_PLACE: Partial<Record<ViewName, Place>> = { chest: 'chest', shelf: 'shelf', rack: 'rack', table: 'table' };
const HOTSPOT_LABEL: Record<string, string> = {
  chest: 'Map chest — projects you can play',
  table: 'Chart table — my voyage so far',
  rack: 'Logbook rack — a save file from every job',
  shelf: 'Bookshelf — things I wrote',
  handheld: 'KANAT·1 — the handheld',
  lantern: 'Lantern — sunset or night',
  wheel: 'Ship’s wheel — give it a spin',
};
const EGG_LABEL: Record<EggId, string> = {
  letter: 'The welcome letter',
  portrait: 'The captain’s portrait — about me',
  bottle: 'Message in a bottle — write to me',
  tengwar: 'A note pinned to the post, in Elvish letters',
  slate: 'A slate with √−1 chalked on it',
  bell: 'Ring the ship’s bell',
};

async function main() {
  const app = document.getElementById('app')!;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    location.replace('/plain/');
    return;
  }
  const touch = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, touch ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.setAttribute('aria-label', 'The airship cabin. Use the hotspot buttons or the dock to move around.');
  renderer.domElement.setAttribute('role', 'img');
  app.appendChild(renderer.domElement);

  const manager = makeManager(p => setProgress(0.1 + p * 0.8));
  // Everything the first view needs is fetched at once (the lightmap and the sky used to wait for the cabin).
  prefetchLightmap();
  prefetchSky();
  // First view only: content, cabin, collectibles, sunset light + sky. Everything else streams in after the first frame.
  // The galleon is not fetched here: it streams in after the first frame (full tier) or when Outside is opened.
  const fxFull = FULL ? import('./fx-full') : null;
  const introOn = wantsIntro(params, ['view', 'play', 'open', 'storm', 'night', 'item', 'note', 'topic', 'index'].some(k => params.has(k)));
  const [content0, notesIndex, cabinGltf, collGltf, galleonGltf] = await Promise.all([
    loadContent(),
    loadNotesIndex(),
    loadGLB('/assets/cabin.glb', manager),
    loadGLB('/assets/collectibles.glb', manager),
    introOn ? loadGLB('/assets/galleon.glb', manager) : Promise.resolve(null),
    introOn ? import('./outside') : null, // warm the chunk so the opening shot can start before the first frame
    fontsReady(),
  ]);
  // The captain is not part of the first frame: his download starts once the first view's files are in (so it does
  // not slow them down) and runs while the scene is set up and compiled, so he is there when the room appears.
  const captainGltf = loadGLB('/assets/captain.glb');
  // the digital garden: one book per topic on the shelf (writing/shelf.ts)
  const content = shelveTopics(content0, notesIndex);
  if (loaderText) loaderText.textContent = 'Lighting the lantern…';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2a1712');
  if (!cabinGltf) throw new Error('cabin.glb missing');
  const cabinRoot = cabinGltf.scene;
  scene.add(cabinRoot);
  const cabin: Cabin = indexCabin(cabinRoot);

  const lighting = await setupLighting(renderer, scene, cabin);
  const skyAnchor = cabin.get('SKY_anchor')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(0, 1.6, -6);
  const sky = await setupSky(scene, skyAnchor);
  const coll = new Collectibles(scene, cabin);
  await coll.build(content, collGltf);
  coll.hideRoute();
  const props = setupProps(scene, cabin, content);
  setupPatch(cabin);
  const shafts = setupShafts(scene);
  const dust = setupDust(scene, { pixelRatio: renderer.getPixelRatio(), count: touch ? 150 : 240 });

  const rig = new CameraRig(cabin);
  const camera = rig.camera;
  // post-processing is its own chunk, fetched by the full tier only (started before the assets, awaited here)
  let fx: Fx = plainFx(renderer);
  if (fxFull) { try { fx = (await fxFull).setupFullFx(renderer, scene, camera); } catch { /* stay plain */ } }
  const weather = new Weather(lighting, sky, rig, { announce: t => ui.announce(t) });
  const ship = new ShipMotion();
  const hoverCapable = matchMedia('(hover: hover)').matches;

  // Wheel
  const wheel = cabin.get('Wheel');
  const wheelBase = wheel?.quaternion.clone() ?? new THREE.Quaternion();
  const wheelAxis = new THREE.Vector3(0, 0, 1);
  if (wheel?.parent) wheelAxis.applyQuaternion(wheel.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  let wheelAngle = 0, wheelVel = 0, wheelHeld = false;

  // State
  let goOutside: () => void = () => { /* set once the outside view exists */ };
  let outsideRef: Outside | null = null;
  // the sky whales: their own chunk, set up in idle time after the sky models (whales-world.ts)
  let whalesRef: import('./whales-world').WhalesWorld | null = null;
  let skyGltf: Awaited<ReturnType<typeof loadGLB>> = null;
  let night = false;
  let pulled: Collectible | null = null;
  let lastHover: Collectible | null = null;
  let tengwarPinned = false;
  let letterOpen = false;
  let firstLetter = false;

  const play = new Play(scene, cabin, rig, coll, {
    onEnter: () => { ui.setVisible(false); audio.duck(true); },
    onExit: () => { ui.setVisible(true); audio.duck(false); },
  });

  const hitCenter = (id: string) => {
    const o = cabin.hits.get(id);
    if (!o) return null;
    const box = new THREE.Box3().setFromObject(o);
    const c = box.getCenter(new THREE.Vector3());
    // the table's centre is where the handheld sits: put its hotspot on the far side of the map
    if (id === 'table') { c.y = box.max.y; c.z = box.min.z + (box.max.z - box.min.z) * 0.22; c.x += (box.max.x - box.min.x) * 0.18; }
    return c;
  };

  const ui = new UI(document.body, content, {
    nav: v => goto(v),
    back: () => back(),
    hotspot: id => activateHit(id),
    item: id => { const c = coll.byId.get(id); if (c) select(c); },
    insert: id => { const c = coll.byId.get(id); if (c) insert(c); },
    panelClosed: () => { putBack(); },
    toggleNight: () => toggleNight(),
    outside: () => goOutside(),
    writing: () => { void writing.openIndex(); },
    search: () => search.open(),
    toggleSound: async () => {
      const m = audio.nextMode();
      ui.setSound(m);
      showNote(m === 'off' ? 'Sound off' : m === 'ambient' ? 'Sound: ambient — wind, ship and music' : 'Sound: full — with the little clicks too');
      await audio.setMode(m);
      audio.setStorm(weather.storm);
      audio.click();
    },
    letter: () => openLetter(true),
    egg: id => activateHit(id),
    eggFocus: (id, on) => { if (id === 'tengwar') props.setTengwarLatin(on || tengwarPinned); },
  });
  // Writing: the Reading Room + Ship's Index (writing/reader.ts) and the Speaking Tube search (writing/search.ts)
  // Both are separate chunks, fetched the first time they are needed (or when the address asks for a note).
  let writingRef: Writing | null = null;
  let writingP: Promise<Writing> | null = null;
  const getWriting = () => writingP ??= import('./writing/reader').then(m => (writingRef = new m.Writing(document.body, {
    changed: open => {
      ui.setVisible(!open);
      if (open) { hideHint(); if (ui.panelOpen) ui.closePanel(true); if (sheets.isOpen) sheets.close('close', true); clock.close(); putBack(); if (letterOpen) tuckLetter(); }
    },
    focusTopic: id => { coll.setHover(id ? coll.byId.get(topicItemId(id)) ?? null : null); },
    announce: t => ui.announce(t),
  })));
  const writing = {
    get isOpen() { return !!writingRef?.isOpen; },
    openIndex: (o?: Parameters<Writing['openIndex']>[0]) => getWriting().then(w => w.openIndex(o)),
    openNote: (slug: string, o?: Parameters<Writing['openNote']>[1]) => getWriting().then(w => w.openNote(slug, o)),
    openTopic: (id: string, o?: Parameters<Writing['openTopic']>[1]) => getWriting().then(w => w.openTopic(id, o)),
    close: () => writingRef?.close(),
    openFromUrl: async () => (['note', 'topic', 'index'].some(k => params.has(k)) ? (await getWriting()).openFromUrl() : false),
  };
  /** The note most recently left partly read (same storage the reader writes: kk.read.<slug> = { p, m, at }). */
  const lastRead = (): { slug: string; title: string } | null => {
    try {
      let best: { slug: string; at: number } | null = null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('kk.read.')) continue;
        const v = JSON.parse(localStorage.getItem(key) ?? '{}') as { m?: number; at?: number };
        if (v.m !== undefined && v.m > 0.03 && v.m < 0.97 && (!best || (v.at ?? 0) > best.at)) best = { slug: key.slice(8), at: v.at ?? 0 };
      }
      const n = best && notesIndex?.notes.find(x => x.slug === best!.slug);
      return n ? { slug: n.slug, title: n.title } : null;
    } catch { return null; }
  };
  const searchItems = (): SearchItem[] => {
    const items: SearchItem[] = [];
    const show = (view: ViewName, id: string) => { writing.close(); void goto(view).then(() => { const c = coll.byId.get(id); if (c) select(c); }); };
    for (const t of notesIndex?.topics ?? []) if (t.notes.length) items.push({ id: `t-${t.id}`, group: 'Topics', title: t.title, detail: `${t.notes.length} notes · ${t.blurb}`, run: () => { void writing.openTopic(t.id); } });
    for (const it of content.items) {
      if (it.kind === 'cartridge') items.push({ id: `p-${it.id}`, group: 'Projects', title: it.title, detail: it.subtitle, keywords: it.tags, run: () => show('chest', it.id) });
      else if (it.kind === 'memory-card') items.push({ id: `j-${it.id}`, group: 'Career', title: it.title, detail: [it.role, it.period].filter(Boolean).join(' · '), keywords: it.tags, run: () => show('rack', it.id) });
      else if (it.kind === 'notebook') items.push({ id: `b-${it.id}`, group: 'Projects', title: it.title, detail: it.subtitle, keywords: [...(it.tags ?? []), 'book', 'writing'], run: () => show('shelf', it.id) });
    }
    const act = (id: string, title: string, detail: string, keywords: string[], run: () => void) => items.push({ id: `a-${id}`, group: 'Actions', title, detail, keywords, run: () => { writing.close(); run(); } });
    act('index', 'Open the Ship\u2019s Index', 'Every note, with filters', ['writing', 'blog', 'articles', 'notes', 'yazılar', 'liste'], () => { void writing.openIndex(); });
    act('night', night ? 'Blow out the lantern: back to sunset' : 'Light the lantern: night', 'Switch between sunset and night', ['night', 'day', 'dark', 'gece', 'gündüz', 'lantern'], () => toggleNight());
    act('outside', 'Go outside', 'See the ship from the air and take the helm', ['ship', 'galleon', 'fly', 'helm', 'dışarı', 'gemi'], () => goOutside());
    act('whales', 'Watch the sky whales', 'Six whales carrying their own worlds, in the whale viewer', ['whale', 'whales', 'sky whales', 'balina'], () => { location.href = '/whales/'; });
    act('letter', 'Read the welcome letter', 'The letter on the chart table', ['welcome', 'hello', 'mektup'], () => { void openLetter(true); });
    act('about', 'About HT', 'The portrait on the wall', ['about', 'who', 'bio', 'hakkında'], () => { void openAbout(); });
    act('contact', 'Send a message', 'The message bottle', ['contact', 'email', 'mail', 'iletişim', 'mesaj'], () => openSheet('contact'));
    act('bell', 'Ring the ship\u2019s bell', 'Ding', ['bell', 'çan'], () => ringBell());
    for (const [v, label, kw] of [['chest', 'Go to the chest', ['projects', 'games', 'cartridges']], ['table', 'Go to the chart table', ['career', 'map', 'voyage']], ['rack', 'Go to the logbook rack', ['jobs', 'career', 'cv']], ['shelf', 'Go to the bookshelf', ['books', 'writing']], ['handheld', 'Go to the handheld', ['play', 'console']]] as const)
      act(`view-${v}`, label, 'Move around the cabin', [...kw], () => { void goto(v); });
    act('plain', 'Plain version', 'The same content as a simple page', ['accessible', 'text', 'html'], () => { location.href = '/plain/'; });
    return items;
  };
  let searchRef: Search | null = null;
  let searchP: Promise<Search> | null = null;
  const getSearch = () => searchP ??= import('./writing/search').then(m => (searchRef = new m.Search(document.body, searchItems, {
    pickNote: (slug, q) => { void writing.openNote(slug, { q }); },
    changed: () => { /* the palette swallows keys itself while open */ },
    lastRead,
    announce: t => ui.announce(t),
  })));
  const search = {
    get isOpen() { return !!searchRef?.isOpen; },
    open: (q?: string) => { void getSearch().then(sr => sr.open(q)); },
  };
  // until the palette's chunk is loaded it cannot listen for its own shortcuts: `/` and Ctrl/Cmd+K fetch and open it
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (searchRef) return;
    const el = e.target as HTMLElement | null;
    const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    const hit = (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k');
    if (!hit || play.overlayOn) return;
    e.preventDefault();
    search.open();
  }, true);
  const sheets = new Sheets(ui.root, content, {
    closed: (kind, how) => sheetClosed(kind, how),
    openContact: () => openSheet('contact'),
  });
  const inspector = new Inspector(scene, rig, content, () => {
    if (ui.panelOpen) return ui.panelElement.getBoundingClientRect();
    if (sheets.isOpen) return sheets.element.getBoundingClientRect();
    return null;
  });
  const clock = new ShipClock(scene, cabin, ui.root, {
    // a soft ring on the half hour, two on the hour (only with sound on)
    chime: () => { /* ship's bells are rung by the sound engine (by the watch) */ },
  });
  ui.setEggButtons([
    ...props.list.map(p => ({ id: p.id as string, label: EGG_LABEL[p.id], world: () => props.center(p.id) })),
    ...(clock.obj ? [{ id: 'clock', label: 'The ship’s clock — what time is it', world: () => clock.center() }] : []),
  ]);
  const letterView = new LetterView(scene, content, props.get('letter')?.obj, ui.root, () => tuckLetter());
  // hanging things swing with the ship: bell (+ clapper), hanging lamp, every SWING_* and ROPE_* (hang.ts)
  if (params.get('testrope') === '1') addTestRigs(scene);
  const bellObj = props.get('bell')?.obj;
  let lastClang = 0;
  const hang = new Hanging(scene, {
    bell: bellObj,
    clapper: bellObj ? (cabin.get('Bell_clapper') ?? bellObj.getObjectByName('Bell_clapper')) : undefined,
    lamp: cabin.get('Hanging_lamp'),
    // the clapper hits the rim in rough air: a soft clang, never a peal
    strike: g => {
      const now = performance.now();
      if (now - lastClang < 900) return;
      lastClang = now;
      audio.bell(0.035 + 0.12 * g);
    },
  });
  if (params.get('physlog') === '1') setInterval(() => { const s = hang.lastStats; console.info(`[hang] ${JSON.stringify(hang.count)} avg ${s.avg.toFixed(3)} ms max ${s.max.toFixed(3)} ms steps/frame ${s.steps.toFixed(2)} strikes ${hang.strikes}`); }, 3000);
  ui.setSound('off');
  ui.setNight(false);
  ui.setHotspots([...cabin.hits.keys()].map(id => ({ id, label: HOTSPOT_LABEL[id] ?? id, world: hitCenter(id)! })).filter(s => s.world), true);
  // Sound preference is remembered, but audio still needs a gesture to start.
  if (audio.enabled) {
    const saved = audio.mode;
    audio.mode = 'off';
    const resume = () => { ui.setSound(saved); void audio.setMode(saved).then(() => audio.setStorm(weather.storm)); };
    window.addEventListener('pointerdown', resume, { once: true });
  }

  function putBack() {
    if (pulled) {
      const p = pulled;
      pulled = null;
      coll.setPulled(null);
      if (inspector.isCurrent(p.item.id)) inspector.close();
    }
  }

  function select(c: Collectible) {
    // a topic volume opens its notes in the Reading Room instead of the inspector
    const topic = topicOf(c.item.id);
    if (topic) { audio.paper(); void writing.openTopic(topic); return; }
    if (c.detached) { if (inspector.isCurrent(c.item.id)) inspector.flip(); return; }
    const isIsland = c.kind === 'island';
    if (pulled === c) { ui.closePanel(); return; }
    if (letterOpen) tuckLetter();
    audio.click();
    clock.close();
    if (sheets.isOpen && sheets.kind !== 'contact') sheets.close();
    const inspect = INSPECT_KINDS.has(c.kind);
    if (pulled && pulled !== c && inspector.isCurrent(pulled.item.id) && !inspect) inspector.close();
    pulled = c;
    if (inspect) {
      // the item comes up to the camera and turns over (inspect.ts)
      coll.setPulled(null);
      coll.setHover(null);
      if (c.kind === 'book' || c.kind === 'notebook') audio.paper();
      inspector.open({ id: c.item.id, kind: c.kind as InspectKind, obj: c.obj, item: c.item, coll: c });
    } else coll.setPulled(c);
    if (c.item.job) coll.pulseJob(c.item.job);
    const shown = isIsland ? (coll.sameJob(c, 'memcard')?.item ?? c.item) : c.item;
    // panel anchored at the pulled-out pose (docked to the right while an item is inspected)
    setTimeout(() => {
      if (pulled !== c) return;
      ui.openPanel(shown, coll.worldCenter(c), inspect);
      ui.announce(`${shown.title} opened${inspect ? '. Drag to turn it over, click it to flip.' : ''}`);
    }, reducedMotion ? 0 : 120);
  }

  async function goto(v: ViewName) {
    if (play.busy) return;
    if (play.overlayOn || play.inserted && (rig.view === 'screen')) { await play.eject(); }
    if (ui.panelOpen) ui.closePanel();
    if (sheets.isOpen) sheets.close('close', true);
    if (letterOpen) tuckLetter();
    clock.close();
    putBack();
    if (rig.view === 'table' && v !== 'table') coll.hideRoute();
    if (v !== 'handheld') play.hideNoSignal();
    audio.whoosh();
    ui.setView(v);
    const place = VIEW_PLACE[v];
    ui.setItemButtons(place ? coll.list.filter(c => c.place === place).map(c => ({ id: c.item.id, label: itemLabel(c), world: coll.worldCenter(c) })) : []);
    if (v === 'table') setTimeout(() => coll.revealRoute(), reducedMotion ? 0 : 600);
    await rig.glide(v);
    if (v === 'handheld' && play.inserted && !play.busy) play.insert(play.inserted);
  }

  function itemLabel(c: Collectible) {
    const it = c.item;
    switch (c.kind) {
      case 'cartridge': return `${it.title} — ${it.subtitle ?? 'project'} (cartridge)`;
      case 'memcard': return `${it.title}, ${it.role ?? ''} ${it.period ?? ''} (memory card)`;
      case 'island': return `${it.title} on the voyage map, ${it.period ?? ''}`;
      default: return `${it.title} (${c.kind})`;
    }
  }

  function back() {
    if (letterOpen) { tuckLetter(); return; }
    if (play.overlayOn || (play.inserted && rig.view !== 'overview' && !play.busy && (rig.view === 'screen' || rig.view === 'handheld'))) { play.eject(); return; }
    if (sheets.isOpen) { sheets.close(); return; }
    if (ui.panelOpen) { ui.closePanel(); return; }
    if (clock.isOpen) { clock.close(); return; }
    if (rig.view !== 'overview') goto('overview');
  }

  function activateHit(id: string) {
    if (id === 'lantern') { toggleNight(); return; }
    if (id === 'wheel') { spinWheel(2.4); return; }
    if (id === 'clock') { audio.brass(); if (ui.panelOpen) ui.closePanel(); clock.open(); ui.announce('Ship’s clock'); return; }
    switch (id as EggId) {
      case 'letter': openLetter(true); return;
      case 'portrait': void openAbout(); return;
      case 'bottle': audio.tick(0.8); openSheet('contact'); return;
      case 'slate': audio.wood(); openSheet('story'); return;
      case 'tengwar': {
        tengwarPinned = !tengwarPinned;
        props.setTengwarLatin(tengwarPinned);
        audio.tick(1.4);
        ui.announce(tengwarPinned ? `The note reads: ${content.person.tengwar?.latin ?? ''}` : 'Back to the Elvish letters.');
        return;
      }
      case 'bell': ringBell(); return;
    }
    goto(id as ViewName);
  }

  // ----- polish-round props -----
  function openSheet(kind: SheetKind) {
    if (ui.panelOpen) ui.closePanel(true);
    putBack();
    if (kind !== 'letter' && letterOpen) tuckLetter();
    sheets.open(kind);
    ui.announce(`${kind === 'contact' ? 'Message form' : kind === 'about' ? 'About' : kind === 'story' ? 'Story' : 'Welcome letter'} opened`);
  }

  // The letter's sheet slides out of the envelope, flies up to the camera (inspect.ts) and unfolds: the welcome
  // text is written on it (letter.ts). No panel; screen readers get the same text in the letter's dialog.
  async function openLetter(_glide: boolean) {
    if (play.overlayOn || play.busy) return;
    if (letterOpen) return;
    clock.close();
    if (ui.panelOpen) ui.closePanel(true);
    if (sheets.isOpen) sheets.close('close', true);
    putBack();
    letterOpen = true;
    try { localStorage.setItem(LETTER_KEY, '1'); } catch { /* private mode */ }
    audio.tick(0.9);
    audio.paper();
    inspector.open(letterView.target(LETTER_ID, () => { /* back in the envelope */ }));
    letterView.show();
    ui.announce('The welcome letter, unfolded. Press Escape or the close button to put it back.');
  }
  function tuckLetter() {
    if (!letterOpen) return;
    letterOpen = false;
    letterView.hide();
    audio.paper();
    if (inspector.isCurrent(LETTER_ID)) inspector.close();
    if (firstLetter) { firstLetter = false; afterWelcome(); }
  }

  async function openAbout() {
    if (play.overlayOn || play.busy) return;
    if (rig.view !== 'portrait') await goto('portrait');
    openSheet('about');
  }

  function sheetClosed(kind: SheetKind, how: 'close' | 'explore') {
    if (kind === 'letter') {
      tuckLetter();
      if (how === 'explore' && rig.view === 'letter') void goto('overview');
      if (firstLetter) { firstLetter = false; afterWelcome(); }
    }
  }

  function ringBell() {
    hang.ring();
    audio.bell();
    weather.ring();
  }

  function spinWheel(v: number) {
    wheelVel += v;
    audio.creak();
  }

  let nightReady: Promise<unknown> | null = null;
  const loadNightAssets = () => nightReady ??= Promise.all([lighting.loadNight(), sky.loadNight()]);
  let nightBusy = false;
  async function toggleNight() {
    if (nightBusy) return;
    if (!night) {
      // the night bake streams in after the first frame; wait for it (tiny spinner on the lantern)
      let done = false;
      const p = loadNightAssets().then(() => { done = true; });
      await Promise.resolve();
      if (!done) { nightBusy = true; ui.setNightLoading(true); await p; ui.setNightLoading(false); nightBusy = false; }
    }
    night = !night;
    ui.setNight(night);
    audio.click();
    audio.setNight(night ? 1 : 0);
    const from = night ? 0 : 1, to = night ? 1 : 0;
    await tween(reducedMotion ? 0 : 1.6, k => lighting.setNight(from + (to - from) * k), { key: 'night' });
  }

  async function insert(c: Collectible) {
    ui.closePanel(true);
    pulled = null;
    inspector.release(c.item.id); // flies on from the inspected pose
    ui.setView('handheld');
    ui.setItemButtons([]);
    await play.insert(c);
  }

  // Input
  const hitOf = (h: THREE.Intersection | null) => {
    let o: THREE.Object3D | null = h?.object ?? null;
    while (o) { if (o.userData.hit) return o.userData.hit as string; if (o.userData.collectible) return null; o = o.parent; }
    return null;
  };
  const collOf = (h: THREE.Intersection | null) => (h?.object.userData.collectible as Collectible | undefined) ?? null;
  const allHits = [...cabin.hits.values()];
  const eggHits = props.hitObjects;

  new Input(renderer.domElement, camera, {
    targets: () => {
      if (play.overlayOn || play.busy || outsideRef?.active || writing.isOpen || search.isOpen) return [];
      const place = VIEW_PLACE[rig.view];
      const hits = [...inspector.pickables(), ...allHits.filter(h => h.userData.hit !== rig.view && !(rig.view === 'screen' && h.userData.hit === 'handheld')), ...(rig.view === 'screen' ? [] : eggHits), ...(clock.hit && rig.view !== 'screen' ? [clock.hit] : []), ...(whalesRef && rig.view === 'overview' ? whalesRef.pickables() : [])];
      if (!place) return hits;
      return [...coll.pickables.filter(p => (p.userData.collectible as Collectible).place === place), ...hits];
    },
    hover: h => {
      const c = collOf(h);
      const hc = c && !c.detached ? c : null;
      coll.setHover(hc);
      const id = hitOf(h);
      if (hoverCapable) props.setTengwarLatin(id === 'tengwar' || tengwarPinned);
      if (hc && hc !== lastHover && hc !== pulled) audio.tick(1.2);
      lastHover = hc;
      renderer.domElement.style.cursor = h && inspector.owns(h.object) ? 'grab' : c || id || h?.object.userData.whale ? 'pointer' : '';
    },
    click: h => {
      if (h && inspector.owns(h.object)) { inspector.flip(); return; }
      const whaleKey = h?.object.userData.whale as string | undefined;
      if (whaleKey) { whalesRef?.showCard(whaleKey); audio.click(); return; }
      // the letter is up: a click anywhere else puts it back
      if (letterOpen) { tuckLetter(); return; }
      const c = collOf(h);
      if (c) { select(c); return; }
      const id = hitOf(h);
      if (id) {
        if (id === 'handheld' && rig.view === 'handheld' && play.inserted) { play.insert(play.inserted); return; }
        activateHit(id); return;
      }
      if (ui.panelOpen) ui.closePanel();
      else if (sheets.isOpen && sheets.kind !== 'contact') sheets.close();
      else if (clock.isOpen) clock.close();
    },
    dragStart: h => {
      // while an item is held up close, any drag turns it instead of the camera
      if (inspector.active) { hideHint(); return inspector.startDrag(); }
      if (hitOf(h) === 'wheel') { wheelHeld = true; return true; }
      return false;
    },
    drag: (dx, dy) => {
      if (inspector.isDragging) { inspector.drag(dx, dy); return; }
      wheelVel = clamp(wheelVel + dx * 0.02, -8, 8);
    },
    dragEnd: () => { inspector.endDrag(); if (wheelHeld) audio.creak(); wheelHeld = false; },
    swipeDown: () => back(),
    escape: () => { if (!outsideRef?.active) back(); },
    look: (x, y) => rig.setLook(x, y),
    orbit: (dx, dy) => { if (outsideRef?.active) return; rig.orbit(dx, dy); hideHint(); },
    zoom: f => { rig.zoomBy(f); hideHint(); },
    pan: (dx, dy) => { rig.panBy(dx, dy); hideHint(); },
    reset: () => rig.resetView(),
  });

  // Resize
  const FG_ROPE = ['Rope_fg', 'ROPE_fg_main', 'ROPE_fg_tail', 'SWING_fg_block'];
  // Pixel ratio: capped per tier, capped again by total pixels (a 4K window at 2x is 4x the work of a laptop screen),
  // and stepped down by the governor below when frames run long.
  const baseRatio = Math.min(devicePixelRatio || 1, touch ? 1.5 : 2);
  let quality = 1;
  const applyRatio = (w: number, h: number) => {
    const budget = FULL ? 5.2e6 : 2.2e6; // drawn pixels
    const capped = Math.min(baseRatio, Math.sqrt(budget / Math.max(1, w * h)));
    renderer.setPixelRatio(Math.max(0.75, capped * quality));
  };
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    applyRatio(w, h);
    renderer.setSize(w, h, false);
    fx.resize(w, h);
    rig.resize(w, h);
    // upright phones: no foreground rope (it would fill a third of the narrow frame)
    for (const n of FG_ROPE) { const o = cabin.get(n); if (o) o.visible = w >= h; }
  };
  addEventListener('resize', resize);
  resize();

  // Debug / deep-link params: ?view=chest&item=tilttown, ?play=tilttown, ?night=1,
  // ?open=letter|about|contact|story|clock, ?storm=1, ?welcome=1 (show the first-visit letter again),
  // ?view=clock (close-up of the clock), ?time=HH:MM (clock shows that time, ticking on from there)
  const pv = params.get('view') as ViewName | null;
  const pItem = params.get('item');
  const pPlay = params.get('play');
  const pOpen = params.get('open') as SheetKind | null;
  if (params.get('night') === '1') { night = true; lighting.setNight(1); ui.setNight(true); void loadNightAssets(); }
  if (params.get('storm') === '1') void weather.set(true);
  const pTime = params.get('time')?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (pTime) { const d = new Date(); d.setHours(+pTime[1], +pTime[2], +(pTime[3] ?? 0), 0); clock.setFixed(d.getTime()); }
  if (pPlay && coll.byId.get(pPlay)) {
    rig.jump('handheld');
    ui.setView('handheld');
    setTimeout(() => insert(coll.byId.get(pPlay)!), 300);
  } else if (pv && cabin.views[pv]) {
    rig.jump(pv);
    goto(pv).then(() => {
      if (pItem) { const c = coll.byId.get(pItem) ?? (findItem(content, pItem) ? coll.byId.get(`${pItem}--island`) : undefined); if (c) select(c); }
    });
  } else {
    ui.setView('overview');
  }
  if (pOpen) setTimeout(() => {
    if (pOpen === 'letter') void openLetter(true);
    else if (pOpen === 'about') void openAbout();
    else if (pOpen === 'contact' || pOpen === 'story') openSheet(pOpen);
    else if ((pOpen as string) === 'clock') activateHit('clock');
  }, 400);
  // First visit: the letter lifts off the table and says hello (once; deep links skip it).
  let seenLetter = false;
  try { seenLetter = localStorage.getItem(LETTER_KEY) === '1'; } catch { /* private mode */ }
  if (params.get('welcome') === '1') seenLetter = false;
  const deepLink = !!(pv || pPlay || pOpen || params.get('storm'));
  firstLetter = !seenLetter && !deepLink && !!props.get('letter') || params.get('welcome') === '1';

  // Loop
  let frameMs = 16, slowFor = 0;
  let t = 0, last = -1, busyFrames = 60;
  let whaleCallT = 8;
  const poke = () => { busyFrames = 30; };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'resize', 'focusin', 'wheel', 'touchmove']) addEventListener(ev, poke, { passive: true });
  sky.update(0, 0);
  let firstFrame = true;
  const afterFirstFrame = () => {
    // Not needed for the first view: night + storm skies, the night bake, sky islands, label art, portrait, Tengwar font.
    // idle time if the browser offers it, but never later than ~1 s (background tabs can starve idle callbacks)
    const idle = (fn: () => void) => {
      let ran = false;
      const once = () => { if (!ran) { ran = true; fn(); } };
      if ('requestIdleCallback' in window) requestIdleCallback(once, { timeout: 600 });
      setTimeout(once, 'requestIdleCallback' in window ? 1000 : 50);
    };
    // the captain right after the first frame (his download started with the cabin's)
    void loadCaptain(cabin, captainGltf).then(poke);
    idle(() => {
      void loadGLB('/assets/sky.glb').then(g => {
        skyGltf = g; outsideRef?.setSkyModels(g); sky.addModels(g);
        // then the whales: after the sky has arrived, a little later on phones
        setTimeout(() => {
          void import('./whales-world').then(m => m.setupWhales(sky, scene)).then(w => {
            whalesRef = w;
            if (w && outsideRef?.isOutside) w.setOutside(outsideRef);
          }).catch(err => console.warn('sky whales', err));
        }, FULL ? 1200 : 3500);
      });
      // the galleon for the Outside view (~1 MB): larger screens fetch it once the cabin is up, phones on first use
      if (FULL && !introOn) setTimeout(() => { void getOutside().then(o => o.preload()); }, 2500);
      void coll.loadLabelArt();
      void props.loadArt();
      // night and storm art (~580 KB): fetched when first used; larger screens warm them up once the page is idle
      if (FULL) setTimeout(() => { void loadNightAssets(); void sky.loadStorm(); }, 6000);
    });
  };
  renderer.setAnimationLoop((now: number) => {
    const dt = last < 0 ? 0 : Math.min(Math.max((now - last) / 1000, 0), 0.1);
    last = now;
    t += dt;
    renderer.info.reset();
    // quality governor: if frames stay long for a couple of seconds, render fewer pixels; if that is not enough on
    // the full tier, drop the bloom. It only ever steps down (no see-sawing), and waits out the load-in hitches.
    if (dt > 0 && dt < 0.1 && t > 4 && !document.hidden && !play.overlayOn) {
      frameMs += (dt * 1000 - frameMs) * 0.05;
      if (frameMs > 25) slowFor += dt; else slowFor = Math.max(0, slowFor - dt * 2);
      if (slowFor > 2.5) {
        slowFor = 0; frameMs = 18;
        if (quality > 0.62) { quality *= 0.85; resize(); }
        else if (!fx.cheap) { fx.cheapen(); quality = 0.8; resize(); }
      }
    }
    updateTweens(t);
    // wheel physics: friction + self-centring
    if (wheel) {
      if (!wheelHeld) wheelVel += -wheelAngle * 0.6 * dt;
      wheelVel *= Math.exp(-(wheelHeld ? 6 : 1.2) * dt);
      wheelAngle += wheelVel * dt;
      wheel.quaternion.copy(wheelBase).premultiply(new THREE.Quaternion().setFromAxisAngle(wheelAxis, wheelAngle));
      sky.setYaw(clamp(wheelAngle * 0.08, -0.7, 0.7));
    }
    if (play.overlayOn) return; // the iframe covers everything: don't burn the GPU
    // reduced motion: no drifting, and only render while something changes
    weather.update(t, dt);
    // ship motion: the outside world rolls/pitches/heaves the other way; loose things swing; rain slants
    ship.update(t, dt, weather.storm);
    audio.roll(ship.roll);
    audio.setFocus(rig.view !== 'overview');
    sky.setShip(ship.worldQuat(), ship.heave);
    rig.headRoll = ship.headRoll; rig.headHeave = ship.headHeave;
    uRainSlant.value = Math.tan(-ship.roll) * 1.4 + weather.k * (0.22 + 0.3 * ship.gust);
    lighting.flicker(t, reducedMotion ? 0 : 0.035 + 0.2 * ship.amp + 0.18 * ship.gust);
    props.update(t, dt);
    hang.update(dt, ship);
    dust.update();
    const clockTicked = clock.update();
    if (reducedMotion) {
      if (tweensActive() || weather.active || clockTicked) busyFrames = Math.max(busyFrames, tweensActive() || weather.active ? 30 : 1);
      if (busyFrames-- <= 0) return;
    } else sky.update(t, dt);
    coll.update(t, dt, camera.position);
    play.update(t);
    rig.setSheet(innerWidth <= 720 && (ui.panelOpen || sheets.isOpen || clock.isOpen));
    outsideRef?.update(dt);
    whalesRef?.update(t, dt, camera);
    // now and then the nearest whale calls (louder when close, panned to where it is)
    if (whalesRef && audio.enabled && !reducedMotion && (whaleCallT -= dt) <= 0) {
      whaleCallT = 18 + Math.random() * 26;
      const n = whalesRef.nearest(camera);
      if (n) audio.whale(n.key, clamp(0.5 / Math.max(n.rel, 1), 0.04, 0.3), n.pan);
    }
    rig.update(t, dt);
    inspector.update(dt);
    ui.setQuiet(inspector.overlay);
    ui.update(camera, innerWidth, innerHeight, id => { const c = coll.byId.get(id); return c ? coll.worldCenter(c) : null; });
    clock.place(camera, innerWidth, innerHeight);
    letterView.place(camera, innerWidth, innerHeight);
    play.placeNoSignal();
    fx.render(scene, camera);
    if (inspector.overlay) {
      // the inspected item: a second pass on top (depth cleared), so it never clips into the cabin
      const bg = scene.background;
      scene.background = null;
      renderer.autoClear = false;
      renderer.clearDepth();
      camera.layers.set(INSPECT_LAYER);
      renderer.render(scene, camera);
      camera.layers.set(0);
      renderer.autoClear = true;
      scene.background = bg;
    }
    if (firstFrame) { firstFrame = false; afterFirstFrame(); }
  });

  // Outside the ship: the opening shot, and the "Outside" button (outside.ts, its own chunk)
  let outsideP: Promise<Outside> | null = null;
  const getOutside = () => outsideP ??= import('./outside').then(m => {
    const o = new m.Outside(scene, rig, {
      root: document.body,
      crossed: out => {
        whalesRef?.setOutside(out ? outsideRef : null);
        sky.group.visible = !out;
        shafts.visible = !out;
        ui.setVisible(!out);
        if (out) hideHint();
        if (out) { if (ui.panelOpen) ui.closePanel(true); if (sheets.isOpen) sheets.close('close', true); clock.close(); putBack(); }
      },
      click: ndc => { const k = whalesRef?.pickOutside(camera, ndc); if (k) { whalesRef!.showCard(k); audio.click(); } },
      mode: mo => {
        audio.whoosh();
        ui.announce(mo === 'orbit' ? 'Outside the ship. Drag to look around it.' : mo === 'helm' ? 'You have the helm.' : 'Back in the cabin.');
      },
    });
    o.setShip(galleonGltf);
    o.setSkyModels(skyGltf);
    outsideRef = o;
    return o;
  });
  goOutside = () => {
    if (letterOpen) tuckLetter();
    if (rig.view !== 'overview') rig.jump('overview');
    ui.setView('overview');
    void getOutside().then(o => o.goOutside()).then(ok => { if (!ok) showNote('The ship could not be loaded'); }, () => showNote('The ship could not be loaded'));
  };
  let introDone: Promise<void> = Promise.resolve();
  if (introOn && galleonGltf) introDone = getOutside().then(o => o.playIntro());

  // Reveal
  setProgress(1);
  const loader = document.getElementById('loader');
  requestAnimationFrame(() => { loader?.classList.add('done'); setTimeout(() => loader?.remove(), 800); });
  // land in the cabin with a short zoom in (not on deep links, which open somewhere specific)
  if (!introOn && rig.view === 'overview') void rig.zoomInFrom(1.3, 1.8);
  function afterWelcome() {
    if (rig.view === 'overview') setTimeout(() => { void rig.introSweep(); }, 500);
    setTimeout(showHint, 900);
  }
  await introDone;
  // a note, topic or the index in the address opens over the cabin
  if (await writing.openFromUrl()) firstLetter = false;
  if (firstLetter) setTimeout(() => { if (!sheets.isOpen && !play.overlayOn && !letterOpen) void openLetter(false); else if (!letterOpen) { firstLetter = false; afterWelcome(); } }, 1100);
  else {
    if (rig.view === 'overview') setTimeout(() => { void rig.introSweep(); }, 900);
    setTimeout(showHint, 1800);
  }
  // measurement hooks: whole-frame draw calls / triangles, and the real cost of a frame (render + gl.finish)
  renderer.info.autoReset = false;
  (window as unknown as { __kkInfo: unknown }).__kkInfo = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0, dpr: +renderer.getPixelRatio().toFixed(2), quality, bloom: !fx.cheap });
  (window as unknown as { __kkBench: unknown }).__kkBench = (n = 60) => {
    const gl = renderer.getContext();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { renderer.info.reset(); fx.render(scene, camera); gl.finish(); }
    return (performance.now() - t0) / n;
  };
  (window as unknown as { __kk: unknown }).__kk = {
    scene, cabin, coll, rig, play, ui, props, weather, sheets, lighting, sky, inspector, ship, clock, hang, letterView,
    get whales() { return whalesRef; },
    goto, openLetter, openAbout, openSheet, ringBell, toggleNight,
    tengwar: (on: boolean) => props.setTengwarLatin(on),
  };
}

main().catch(err => {
  console.error(err);
  const t = document.getElementById('loader-text');
  if (t) t.innerHTML = 'The airship could not take off. <a href="/plain/">Read the plain version</a>.';
});
