import { plainFx, setupShafts, type Fx } from './fx';
import { FULL } from './tier';
import type { Outside } from './outside';
import type { Deck } from './library/deck';
import { wantsIntro } from './intro-flag';
import { setupPatch } from './patch';
import type { Writing } from './writing/reader';
import type { Search, SearchItem } from './writing/search';
import { loadNotesIndex, shelveTopics, topicOf, topicItemId } from './writing/shelf';
import './fonts.css';
import './style.css';
import * as THREE from 'three';
import { loadContent, findItem } from './content';
import { loadCaptain } from './captain';
import { loadGLB, indexCabin, makeManager, initKTX2, type ViewName, type Cabin, type EggId } from './scene';
import { setupLighting, prefetchLightmap } from './lighting';
import { setupSky, prefetchSky } from './sky';
import { Collectibles, type Collectible, type Place } from './collectibles';
import { CameraRig } from './camera';
import { UI, type Place as Where } from './ui';
import { coach, dismissCoach } from './coach';
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
import { lockZoom, registerSW, trackKeyboard } from './pwa';
import * as nav from './nav';
import { setTitle } from './writing/router';

lockZoom();
trackKeyboard();
registerSW();

const LETTER_KEY = 'kk-letter';
const LETTER_ID = '__letter';
const INSPECT_KINDS = new Set(['cartridge', 'book', 'notebook', 'memcard']);

const params = new URLSearchParams(location.search);
const loaderFill = document.getElementById('loader-fill');
const loaderText = document.getElementById('loader-text');
// The one-time hint about getting around (coach.ts): the same words in the cabin, the library and outside.
const hideHint = () => dismissCoach();
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
  hatch: 'Hatch — down to the library',
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
    // phones: let the OS pick the GPU and power mode (high-performance drains batteries for little gain on the lite tier)
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: FULL ? 'high-performance' : 'default' });
  } catch {
    location.replace('/plain/');
    return;
  }
  initKTX2(renderer); // starts the Basis transcoder download now, in parallel with the first view's files
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
  const introOn = wantsIntro(params, ['view', 'play', 'open', 'storm', 'night', 'item', 'note', 'topic', 'index', 'deck'].some(k => params.has(k)));
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
  const shaftGain = (shafts.material as THREE.ShaderMaterial).uniforms.uGain, shaftGain0 = shaftGain.value as number;
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
  // the library deck below the cabin (library/deck.ts, its own chunk)
  let deckRef: Deck | null = null;
  let goDeck: (topic?: string) => Promise<void> = async () => { /* set once the deck hooks exist */ };
  let goPlace: (p: Where) => void = () => { /* set once the address sync exists */ };
  let preloadDeck = () => { /* set once the deck hooks exist */ };
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
    place: p => goPlace(p),
    station: id => { if (deckRef?.below) deckRef.goStation(id); else if (isOut()) outsideRef?.goStation(id); },
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
    if (notesIndex?.topics.some(t => t.notes.length)) {
      act('library', 'Go down to the library', 'The captain’s library below deck, and his friend who keeps it', ['library', 'librarian', 'books', 'notes', 'below', 'kütüphane'], () => { void goDeck(); });
      for (const t of notesIndex.topics) if (t.notes.length) act(`ask-${t.id}`, `Ask the Librarian for ${t.title}`, 'He fetches the volume from the shelf below deck', ['library', 'librarian', t.title.toLowerCase()], () => { void goDeck(t.id); });
    }
    act('outside', 'Go outside', 'See the ship from the air and fly it', ['ship', 'galleon', 'fly', 'helm', 'dışarı', 'gemi'], () => goOutside());
    act('whales', 'Watch the sky whales', "Today's pod of whales carrying their own worlds, in the whale viewer", ['whale', 'whales', 'sky whales', 'balina'], () => { location.href = '/whales/'; });
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
    if (topic) { audio.paper(); if (notesIndex) void goDeck(topic); else void writing.openTopic(topic); return; }
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
    // the library is right below the shelf: larger screens start fetching it here (library/deck.ts)
    if ((v === 'shelf' || v === 'hatch') && FULL) preloadDeck();
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
    if (isOut()) { if (outsideRef?.helm) outsideRef.setHelm(false); else if (outsideRef && !outsideRef.busy) void outsideRef.goInside(); return; }
    if (deckRef?.active) { if (deckRef.below && !writing.isOpen) deckRef.escape(); return; }
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
    if (id === 'hatch') { void goDeck(); return; }
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
    // small screens read the letter on its paper bottom sheet: flying the 3D sheet up as well showed two letters
    if (!matchMedia('(max-width: 720px), (max-height: 500px)').matches) inspector.open(letterView.target(LETTER_ID, () => { /* back in the envelope */ }));
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

  let aboutIntent = false;
  async function openAbout() {
    if (play.overlayOn || play.busy) return;
    aboutIntent = true; // the address says "about" from the first frame of the glide
    try { if (rig.view !== 'portrait') await goto('portrait'); } finally { aboutIntent = false; }
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

  let playIntent: Collectible | null = null; // a cartridge on its way into the handheld (for the address)
  async function insert(c: Collectible) {
    if (play.busy) return;
    ui.closePanel(true);
    pulled = null;
    inspector.release(c.item.id); // flies on from the inspected pose
    ui.setView('handheld');
    ui.setItemButtons([]);
    playIntent = c;
    try { await play.insert(c); } finally { playIntent = null; }
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
      if (play.overlayOn || play.busy || outsideRef?.active || deckRef?.active || writing.isOpen || search.isOpen) return [];
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
    // below deck the library has its own gesture layer over the canvas; only the keys arrive here, so pass them on
    // outside, away from the helm, the same keys turn and zoom round the ship (at the helm they fly her: outside.ts)
    orbit: (dx, dy) => { if (deckRef?.active) { if (!writing.isOpen) deckRef.orbit(dx, dy); return; } if (outsideRef?.active) { if (!outsideRef.helm) outsideRef.orbitBy(dx, dy); return; } rig.orbit(dx, dy); hideHint(); },
    zoom: f => { if (deckRef?.active) { if (!writing.isOpen) deckRef.zoom(f); return; } if (outsideRef?.active) { if (!outsideRef.helm) outsideRef.zoomBy(f); return; } rig.zoomBy(f); hideHint(); },
    pan: (dx, dy) => { if (deckRef?.active) { if (!writing.isOpen) deckRef.pan(dx, dy); return; } if (outsideRef?.active) return; rig.panBy(dx, dy); hideHint(); },
    reset: () => { if (deckRef?.active) { if (!writing.isOpen) deckRef.reset(); return; } if (outsideRef?.active) { if (!outsideRef.helm) outsideRef.goStation('home'); return; } rig.resetView(); },
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
  // the address is only written once the shared link's state is up (deepP), so it is not tidied away half-way
  let deepP: Promise<unknown> = Promise.resolve();
  if (pPlay && coll.byId.get(pPlay)) {
    rig.jump('handheld');
    ui.setView('handheld');
    deepP = new Promise<void>(res => setTimeout(() => { void insert(coll.byId.get(pPlay)!).finally(res); }, 300));
  } else if (pv && cabin.views[pv]) {
    rig.jump(pv);
    deepP = goto(pv).then(() => {
      if (pItem) { const c = coll.byId.get(pItem) ?? (findItem(content, pItem) ? coll.byId.get(`${pItem}--island`) : undefined); if (c) select(c); }
    });
  } else {
    ui.setView('overview');
  }
  if (pOpen) deepP = Promise.all([deepP, new Promise<void>(res => setTimeout(res, 400))]).then(() => {
    if (pOpen === 'letter') return openLetter(true);
    else if (pOpen === 'about') return openAbout();
    else if (pOpen === 'contact' || pOpen === 'story') openSheet(pOpen);
    else if ((pOpen as string) === 'clock') activateHit('clock');
  });
  // First visit: the letter lifts off the table and says hello (once; deep links skip it).
  let seenLetter = false;
  try { seenLetter = localStorage.getItem(LETTER_KEY) === '1'; } catch { /* private mode */ }
  if (params.get('welcome') === '1') seenLetter = false;
  const deepLink = !!(pv || pPlay || pOpen || params.get('storm') || params.has('outside') || params.has('whale') || params.has('search'));
  firstLetter = !seenLetter && !deepLink && !!props.get('letter') || params.get('welcome') === '1';

  // Loop
  let frameMs = 16, slowFor = 0;
  let t = 0, last = -1, busyFrames = 60;
  let whaleCallT = 8;
  // Frame pacing: phones (lite tier) draw at most 30 fps; after a while with no input and nothing animating on its
  // own (camera moves, tweens), every tier eases down to ~20 fps, which keeps the ambient drift alive at a fraction
  // of the battery. Any input restores the full rate at once.
  const ACTIVE_MS = FULL ? 0 : 1000 / 30, IDLE_MS = 1000 / 20, IDLE_AFTER = 15000;
  let lastInput = performance.now();
  const poke = () => { busyFrames = 30; lastInput = performance.now(); };
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
        // then the whales: after the sky has arrived, a little later on phones; never on data saver or a slow link
        const net = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
        if (net?.saveData || /(^|-)(2g|3g)$/.test(net?.effectiveType ?? '')) return;
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
  const wheelSpin = new THREE.Quaternion();
  const frame = (now: number) => {
    const idle = now - lastInput > IDLE_AFTER && !tweensActive() && !wheelHeld && Math.abs(wheelVel) < 0.01 && !outsideRef?.active && !deckRef?.active;
    const minMs = idle ? IDLE_MS : ACTIVE_MS;
    // 2 ms of slack: rAF timestamps jitter, and a 60 Hz frame (16.7 ms) must still pass a 33.3 ms gap on the second one
    if (last >= 0 && minMs && now - last < minMs - 2) return;
    const dt = last < 0 ? 0 : Math.min(Math.max((now - last) / 1000, 0), 0.1);
    last = now;
    t += dt;
    renderer.info.reset();
    // quality governor: if frames stay long for a couple of seconds, render fewer pixels; if that is not enough on
    // the full tier, drop the bloom. It only ever steps down (no see-sawing), and waits out the load-in hitches.
    // (paced frames are judged against their own budget; idle frames not at all)
    if (dt > 0 && dt < 0.1 && t > 4 && !document.hidden && !play.overlayOn && !idle) {
      frameMs += (dt * 1000 - frameMs) * 0.05;
      if (frameMs > (ACTIVE_MS ? ACTIVE_MS + 12 : 25)) slowFor += dt; else slowFor = Math.max(0, slowFor - dt * 2);
      if (slowFor > 2.5) {
        slowFor = 0; frameMs = ACTIVE_MS || 18;
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
      wheel.quaternion.copy(wheelBase).premultiply(wheelSpin.setFromAxisAngle(wheelAxis, wheelAngle));
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
    deckRef?.update(dt, ship);
    inspector.update(dt);
    ui.setQuiet(inspector.overlay);
    ui.update(camera, innerWidth, innerHeight, id => { const c = coll.byId.get(id); return c ? coll.worldCenter(c) : null; });
    clock.place(camera, innerWidth, innerHeight);
    letterView.place(camera, innerWidth, innerHeight);
    play.placeNoSignal();
    outsideRef?.prerender(renderer);
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
  };
  renderer.setAnimationLoop(frame);

  // Outside the ship: the opening shot, and the "Outside" button (outside.ts, its own chunk)
  let outsideP: Promise<Outside> | null = null;
  const getOutside = () => outsideP ??= import('./outside').then(m => {
    const o = new m.Outside(scene, rig, {
      root: document.body,
      crossed: out => {
        whalesRef?.setOutside(out ? outsideRef : null);
        ui.setPlace(out ? 'outside' : 'cabin', out ? outsideRef?.stations : []);
        hideHint();
        if (out) { if (ui.panelOpen) ui.closePanel(true); if (sheets.isOpen) sheets.close('close', true); clock.close(); putBack(); }
      },
      windowSky: sky.group,
      mix: k => { shafts.visible = k > 0; shaftGain.value = shaftGain0 * k; },
      click: ndc => { const k = whalesRef?.pickOutside(camera, ndc); if (k) { whalesRef!.showCard(k); audio.click(); } },
      mode: mo => {
        audio.whoosh();
        ui.announce(mo === 'orbit' ? 'Outside the ship. Drag to look around it; take the helm to steer her.' : 'Back in the cabin.');
      },
    });
    o.setShip(galleonGltf);
    o.setSkyModels(skyGltf);
    outsideRef = o;
    return o;
  });
  let outIntent = false; // the flight out has started: the address says outside at once
  const goOutsideP = () => {
    if (letterOpen) tuckLetter();
    outIntent = true;
    ui.setView('overview'); // the flight out starts from whatever view is on screen
    return getOutside().then(o => o.goOutside()).then(ok => { if (!ok) showNote('The ship could not be loaded'); }, () => showNote('The ship could not be loaded'))
      .finally(() => { outIntent = false; });
  };
  goOutside = () => { void goOutsideP(); };

  // Below deck: the captain's library and the Librarian (library/deck.ts, its own chunk), down the hatch by the shelf
  let deckP: Promise<Deck> | null = null;
  const getDeck = () => deckP ??= import('./library/deck').then(m => (deckRef = new m.Deck(scene, rig, renderer, cabin, {
    root: document.body,
    index: notesIndex!,
    openNote: slug => { void writing.openNote(slug); },
    reading: () => writing.isOpen || search.isOpen,
    changed: below => {
      ui.setPlace(below ? 'library' : 'cabin', below ? deckRef?.stations : []);
      hideHint();
      audio.setBelow(below);
      if (below) { hideHint(); if (ui.panelOpen) ui.closePanel(true); if (sheets.isOpen) sheets.close('close', true); clock.close(); putBack(); if (letterOpen) tuckLetter(); }
    },
    up: () => { void upDeck(); },
    announce: t => ui.announce(t),
    paper: () => audio.paper(),
    blip: () => audio.blip(),
  })));
  preloadDeck = () => { if (notesIndex) void getDeck().then(d => d.preload()); };
  // a shared ?view=shelf link landed before this existed
  if (FULL && (rig.view === 'shelf' || rig.view === 'hatch')) preloadDeck();
  let deckIntent = false; // on the way down: the address says below at once
  goDeck = async (topic?: string) => {
    if (!notesIndex) return;
    if (deckRef?.active) { if (topic) deckRef.fetch(topic); return; }
    if (deckIntent || isOut()) return;
    deckIntent = true;
    try {
      if (writing.isOpen) writing.close();
      const ready = getDeck().then(d => d.preload());
      if (rig.view !== 'hatch') await goto('hatch');
      // still loading (phones, slow links): say so until it is in
      let waiting = true;
      void ready.finally(() => { waiting = false; });
      await new Promise(r => setTimeout(r, 0));
      while (waiting) { showNote('Lighting the lamps below…'); await Promise.race([ready, new Promise(r => setTimeout(r, 2000))]); }
      if (!(await ready)) { showNote('The library could not be loaded'); return; }
      audio.whoosh();
      ui.announce('Down the ladder to the library.');
      await deckRef!.enter(topic);
    } catch (err) { console.warn('deck', err); showNote('The library could not be loaded'); } finally { deckIntent = false; }
  };
  const upDeck = async () => {
    if (!deckRef?.below) return;
    audio.whoosh();
    await deckRef.exit();
    ui.announce('Back in the cabin, by the hatch.');
    await goto('shelf');
  };
  const isDeck = () => deckIntent || !!deckRef?.active;
  /** The dock's place switcher: the same moves as the address (night and storm kept). */
  goPlace = (p: Where) => {
    const look: nav.CabinState = {};
    if (night) look.night = '1';
    if (weather.storm) look.storm = '1';
    if (p === 'library') { if (!isDeck()) void goNav({ ...look, deck: '1' }); }
    else if (p === 'outside') { if (!isOut()) void goNav({ ...look, outside: '1' }); }
    else void goNav(look);
  };
  // 1 / 2 / 3: the cabin, the library, outside (as the dock's place buttons), when nothing else wants the key
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const p = ({ '1': 'cabin', '2': 'library', '3': 'outside' } as const)[e.key as '1'];
    if (!p) return;
    const a = document.activeElement;
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || (a instanceof HTMLElement && a.isContentEditable)) return;
    if (play.overlayOn || writing.isOpen || searchRef?.isOpen || letterOpen) return;
    e.preventDefault();
    goPlace(p);
  });

  // ----- the address bar (nav.ts): what is on screen, kept in the URL; Back / Forward replay it -----
  // the address follows what the visitor asked for, at once: a view mid-glide, a cartridge on its way in, the flight out
  const isOut = () => outIntent || (!!outsideRef && outsideRef.mode !== 'inside');
  const playing = () => !!playIntent || (!!play.inserted && !play.ejecting && (play.overlayOn || rig.view === 'handheld' || rig.view === 'screen'));
  const snapshot = (): nav.CabinState => {
    const s: nav.CabinState = {};
    if (night) s.night = '1';
    if (weather.storm) s.storm = '1';
    if (searchRef?.isOpen) s.search = searchRef.query;
    if (whalesRef?.cardKey) s.whale = whalesRef.cardKey;
    // on the way there the address keeps the station it asks for
    if (isOut()) { s.outside = '1'; const st = outsideRef && outsideRef.mode === 'orbit' && !outsideRef.busy ? outsideRef.station : nav.read().station; if (st) s.station = st; return s; }
    if (isDeck()) { s.deck = '1'; const st = deckRef?.below ? deckRef.station : nav.read().station; if (st && st !== 'librarian') s.station = st; return s; }
    if (playing()) s.play = (playIntent ?? play.inserted)!.item.id;
    else {
      const v = play.ejecting ? 'handheld' : rig.view; // eject ends at the handheld
      if (v !== 'overview') s.view = v;
      if (pulled) s.item = pulled.item.id;
    }
    const open = letterOpen ? 'letter' : sheets.kind ?? (clock.isOpen ? 'clock' : aboutIntent ? 'about' : null);
    if (open) s.open = open;
    return s;
  };
  const VIEW_TITLE: Partial<Record<ViewName, string>> = { hatch: 'The hatch', chest: 'The map chest', table: 'The chart table', rack: 'The logbook rack', shelf: 'The bookshelf', handheld: 'KANAT·1', screen: 'KANAT·1', portrait: 'The captain’s portrait', letter: 'The welcome letter', clock: 'The ship’s clock' };
  const OPEN_TITLE: Record<string, string> = { letter: 'The welcome letter', about: 'About', story: 'The story', contact: 'Send a message', clock: 'The ship’s clock' };
  const titleOf = (s: nav.CabinState): string | null => {
    if (s.search !== undefined) return 'Search';
    if (s.outside) return 'Outside the ship';
    if (s.deck) return 'The library';
    if (s.open) return OPEN_TITLE[s.open] ?? null;
    const id = s.play ?? s.item;
    if (id) return coll.byId.get(id)?.item.title ?? null;
    return s.view ? VIEW_TITLE[s.view as ViewName] ?? null : null;
  };
  let navOn = false, applying = false, pendingNav: nav.CabinState | null = null, nightP: Promise<void> | null = null;
  const navBusy = () => !navOn || applying;
  /** Resolves once cond() holds (checked each frame-ish), or after ms. */
  const until = (cond: () => boolean, ms = 15000) => new Promise<void>(res => {
    const t0 = performance.now();
    const tick = () => (cond() || performance.now() - t0 > ms ? res() : setTimeout(tick, 50));
    tick();
  });
  async function applyNav(t: nav.CabinState) {
    // Back / Forward pressed mid-move: let the move finish first
    await until(() => !play.busy && !outsideRef?.busy && !rig.isGliding && !deckIntent && !deckRef?.busy);
    const lit = t.night === '1';
    if (lit !== night) { nightP = toggleNight(); await nightP; nightP = null; }
    if ((t.storm === '1') !== weather.storm) void weather.set(t.storm === '1');
    if (t.search === undefined) searchRef?.close();
    if (t.whale === undefined) whalesRef?.closeCard();
    if (t.deck) {
      if (!isDeck()) { if (isOut()) await outsideRef!.goInside(); await goDeck(); }
      const st = t.station ?? 'librarian';
      if (deckRef?.below && deckRef.station !== st) deckRef.goStation(st);
    }
    else if (t.outside) {
      if (deckRef?.below) await deckRef.exit();
      if (!isOut()) await goOutsideP();
      if (outsideRef && outsideRef.station !== (t.station ?? null)) outsideRef.goStation(t.station ?? 'home');
    }
    else {
      if (isOut()) await outsideRef!.goInside();
      if (deckRef?.below) await deckRef.exit();
      if (letterOpen && t.open !== 'letter') tuckLetter();
      if (sheets.isOpen && sheets.kind !== t.open) sheets.close('close', true);
      if (clock.isOpen && t.open !== 'clock') clock.close();
      const pc = t.play ? coll.byId.get(t.play) : undefined;
      if (pc) { if (play.inserted !== pc || !play.overlayOn) { writing.close(); await insert(pc); } }
      else {
        if (play.overlayOn || playing()) await play.eject();
        const v = t.view && t.view in cabin.views ? t.view as ViewName : 'overview';
        if (rig.view !== v) await goto(v);
        const ic = t.item ? coll.byId.get(t.item) : undefined;
        if (ic && pulled !== ic) { await until(() => !ic.detached, 3000); select(ic); }
        else if (ui.panelOpen) ui.closePanel(); else putBack();
        if (t.open === 'letter') { if (!letterOpen) await openLetter(true); }
        else if (t.open === 'about') { if (sheets.kind !== 'about') await openAbout(); }
        else if (t.open === 'story' || t.open === 'contact') { if (sheets.kind !== t.open) openSheet(t.open); }
        else if (t.open === 'clock' && !clock.isOpen) activateHit('clock');
      }
    }
    if (t.whale && whalesRef?.cardKey !== t.whale) whalesRef?.showCard(t.whale);
    if (t.search !== undefined && (!searchRef?.isOpen || searchRef.query !== t.search)) search.open(t.search);
  }
  async function goNav(t: nav.CabinState) {
    if (applying) { pendingNav = t; return; }
    applying = true;
    try {
      await applyNav(t);
      while (pendingNav) { const n = pendingNav; pendingNav = null; await applyNav(n); }
    } catch (err) { console.warn('nav', err); } finally { applying = false; }
  }
  nav.onPop(t => { void goNav(t); });
  // write the state as soon as it changes: right after each click / key (and on a short poll for everything else)
  let lastTitle: string | null | undefined;
  /** The dock's current station and what Back will do, in the library and outside. */
  const syncChrome = () => {
    if (deckRef?.active) { ui.setStation(deckRef.below ? deckRef.station : null); ui.setBack(deckRef.backLabel); }
    else if (outsideRef && isOut()) { ui.setStation(outsideRef.station); ui.setBack(outsideRef.mode === 'orbit' && !outsideRef.busy ? outsideRef.helm ? 'Leave the helm' : 'Back inside' : null); }
  };
  const syncNav = () => {
    syncChrome();
    if (navBusy()) return;
    const s = snapshot();
    nav.commit(s);
    if (!writing.isOpen) { const tt = titleOf(s); if (tt !== lastTitle) { lastTitle = tt; setTitle(tt); } }
    else lastTitle = undefined;
  };
  setInterval(syncNav, 120);
  for (const ev of ['click', 'pointerup', 'keydown', 'keyup']) {
    // right after the event's own handlers have run (bubbling to the window), and again as a task in case one stopped it
    addEventListener(ev, () => queueMicrotask(syncNav), { passive: true });
    addEventListener(ev, () => { setTimeout(syncNav, 0); }, { capture: true, passive: true });
  }
  let introDone: Promise<void> = Promise.resolve();
  if (introOn && galleonGltf) introDone = getOutside().then(o => o.playIntro());

  // Reveal
  setProgress(1);
  const loader = document.getElementById('loader');
  requestAnimationFrame(() => { loader?.classList.add('done'); setTimeout(() => loader?.remove(), 800); ui.flashTips(4200); });
  // land in the cabin with a short zoom in (not on deep links, which open somewhere specific)
  if (!introOn && rig.view === 'overview') void rig.zoomInFrom(1.3, 1.8);
  function afterWelcome() {
    if (rig.view === 'overview') setTimeout(() => { void rig.introSweep(); }, 500);
    setTimeout(() => coach('cabin'), 900);
  }
  await introDone;
  // a note, topic or the index in the address opens over the cabin
  if (await writing.openFromUrl()) firstLetter = false;
  // the rest of a shared address that the first view does not cover (outside, a whale's card, the palette)
  {
    const t = nav.read();
    if (t.outside) { firstLetter = false; await goOutsideP(); if (t.station) (outsideRef as Outside | null)?.goStation(t.station); }
    else if (t.deck) { firstLetter = false; void goDeck().then(() => { if (t.station) deckRef?.goStation(t.station); }); }
    if (t.search !== undefined) { firstLetter = false; search.open(t.search); }
    if (t.whale) {
      firstLetter = false;
      const key = t.whale, t0 = performance.now();
      const tryCard = () => { if (whalesRef) whalesRef.showCard(key); else if (performance.now() - t0 < 15000) setTimeout(tryCard, 300); };
      tryCard();
    }
  }
  void Promise.all([deepP, new Promise(res => setTimeout(res, 1200))]).then(() => { navOn = true; });
  if (firstLetter) setTimeout(() => { if (!sheets.isOpen && !play.overlayOn && !letterOpen) void openLetter(false); else if (!letterOpen) { firstLetter = false; afterWelcome(); } }, 1100);
  else {
    if (rig.view === 'overview') setTimeout(() => { void rig.introSweep(); }, 900);
    setTimeout(() => coach('cabin'), 1800);
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
    get outside() { return outsideRef; },
    get deck() { return deckRef; },
    goDeck: (topic?: string) => goDeck(topic),
    /** Automated checks in a hidden tab (no rAF): run n frames of ms each. */
    step: (n = 1, ms = 16) => { let v = Math.max(last, 0); for (let i = 0; i < n; i++) frame(v += ms); },
    upDeck: () => upDeck(),
    goOutside: () => goOutside(),
    goto, openLetter, openAbout, openSheet, ringBell, toggleNight, back,
    select: (id: string) => { const c = coll.byId.get(id); if (c) select(c); },
    insert: (id: string) => { const c = coll.byId.get(id); if (c) void insert(c); },
    get navIdle() { return !navBusy() && nav.same(snapshot(), nav.read()); },
    tengwar: (on: boolean) => props.setTengwarLatin(on),
  };
}

main().catch(err => {
  console.error(err);
  const t = document.getElementById('loader-text');
  if (t) t.innerHTML = 'The airship could not take off. <a href="/plain/">Read the plain version</a>.';
});
