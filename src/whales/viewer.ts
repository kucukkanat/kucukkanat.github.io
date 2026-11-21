// /whales/ - the sky-whale viewer: pick a whale and a style, auto-fly or steer, watch the reactions.
// ?whale=<key>&style=A|B preselects; ?embed=1 is the compact layout used inside the KANAT·1 handheld.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SkyWhale, AutoPilot, loadManifest, type WhaleEntry } from './sky-whale';
import '../fonts.css';
import { lockZoom, registerSW } from '../pwa';

lockZoom();
registerSW();

type Style = 'A' | 'B';
const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1';
if (EMBED) document.body.classList.add('embed');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function start() {
  const manifest = await loadManifest();
  if (!manifest.length) { $('loading').textContent = 'No whales found.'; return; }

  // ---------------------------------------------------------------- renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, EMBED ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !EMBED; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color('#f1dcc8');
  scene.fog = new THREE.Fog(HORIZON, 140, 650);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 90;

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#3b78c8') }, mid: { value: new THREE.Color('#9cc4e8') },
      hor: { value: HORIZON }, bot: { value: new THREE.Color('#b9cfe4') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top, mid, hor, bot;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, mid, smoothstep(0.0, 0.25, h)) : mix(hor, bot, smoothstep(0.0, -0.3, h));
        c = mix(c, top, smoothstep(0.25, 0.9, h)); gl_FragColor = vec4(c, 1.0); }`,
  }));
  scene.add(sky);
  scene.add(new THREE.HemisphereLight('#d6e8ff', '#f3d8c2', 1.15));
  const sun = new THREE.DirectionalLight('#fff0dc', 2.4);
  sun.castShadow = !EMBED; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c9d6e6', emissiveIntensity: 0.35, flatShading: true });
  const clouds: THREE.Mesh[] = [];
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  for (let i = 0; i < (EMBED ? 40 : 70); i++) {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0, n = 5 + Math.floor(Math.random() * 6); k < n; k++) {
      const g = new THREE.IcosahedronGeometry(rnd(3, 7), 1); g.scale(1, 0.62, 1); g.translate(rnd(-8, 8), rnd(-1, 2), rnd(-5, 5)); parts.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(parts), cloudMat);
    m.scale.setScalar(rnd(0.8, 2.4));
    m.position.set(rnd(-300, 300), rnd(-70, 50), rnd(-300, 300));
    if (Math.abs(m.position.y) < 18) m.position.y += Math.sign(m.position.y || 1) * 25;
    scene.add(m); clouds.push(m);
  }

  // ---------------------------------------------------------------- whales
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const cache = new Map<string, SkyWhale>();
  let whale: SkyWhale | null = null;
  let current: { key: string; style: Style } = { key: manifest[0].key, style: 'A' };
  const pilot = new AutoPilot(1);
  let mode: 'auto' | 'steer' = 'auto', chase = true, particlesOn = true, userOrbitUntil = 0, loadSeq = 0;
  const keys = new Set<string>();

  async function loadWhale(key: string, style: Style) {
    const entry = manifest.find(m => m.key === key) ?? manifest[0];
    const url = entry.files[style] ?? entry.files.A!;
    const token = ++loadSeq;
    $('loading').style.display = 'grid';
    let w = cache.get(url);
    if (!w) {
      const gltf = await loader.loadAsync(url);
      w = cache.get(url) ?? new SkyWhale(gltf, { particles: true });
      w.object.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      cache.set(url, w);
    }
    if (token !== loadSeq) return;
    if (whale) { scene.remove(whale.object); whale.removeEffectsFrom(scene); }
    const first = !whale;
    whale = w; current = { key: entry.key, style };
    scene.add(whale.object); whale.addEffectsTo(scene); whale.setParticlesVisible(particlesOn);
    pilot.apply(whale.object);
    if (first) placeCamera();
    $('loading').style.display = 'none';
    renderUI(entry);
    history.replaceState(null, '', `?${new URLSearchParams({ whale: entry.key, style, ...(EMBED ? { embed: '1' } : {}) })}`);
  }

  function placeCamera() {
    const L = whale!.L;
    const off = new THREE.Vector3(L * 1.15, L * 0.42, -L * 1.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), pilot.heading);
    controls.target.copy(whale!.object.position);
    camera.position.copy(whale!.object.position).add(off);
  }

  // ---------------------------------------------------------------- UI
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  $('whales').innerHTML = manifest.map(m => `
    <button class="wcard" data-k="${esc(m.key)}" aria-label="${esc(m.name)}: ${esc(m.biomeLabel)}">
      <span class="sw" style="background:${esc(m.color)}"></span>
      <span><div class="wname">${esc(m.name)}</div><div class="wbiome">${esc(m.biomeShort)}</div></span>
    </button>`).join('');
  $('whales').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('.wcard'); if (b) void loadWhale(b.dataset.k!, current.style); });
  $('style').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (b) void loadWhale(current.key, b.dataset.s as Style); });
  const setMode = (m: 'auto' | 'steer') => { mode = m; [...$('mode').children].forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.m === m)); };
  $('mode').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (b) setMode(b.dataset.m as 'auto' | 'steer'); });
  $('spout').onclick = () => whale?.triggerSpout();
  const toggleBtn = (id: string, on: boolean) => { $(id).classList.toggle('on', on); $(id).setAttribute('aria-pressed', String(on)); };
  $('chase').onclick = () => { chase = !chase; toggleBtn('chase', chase); };
  $('parts').onclick = () => { particlesOn = !particlesOn; toggleBtn('parts', particlesOn); whale?.setParticlesVisible(particlesOn); };
  const setCollapsed = (c: boolean) => {
    $('panel').classList.toggle('collapsed', c); $('toggle').textContent = c ? 'Show' : 'Hide'; $('toggle').setAttribute('aria-expanded', String(!c));
  };
  $('toggle').onclick = () => setCollapsed(!$('panel').classList.contains('collapsed'));
  if (EMBED && innerWidth < 700) setCollapsed(true);
  controls.addEventListener('start', () => { userOrbitUntil = performance.now() + 4000; });
  controls.addEventListener('change', () => { if (performance.now() < userOrbitUntil) userOrbitUntil = performance.now() + 2500; });

  const STEER = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('button, a, input')) { if (e.code !== 'Space') return; }
    keys.add(e.code);
    if (e.code === 'Space') { whale?.triggerSpout(); e.preventDefault(); }
    if (STEER.includes(e.code)) { if (mode !== 'steer') setMode('steer'); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const rows = ['bank', 'pitch', 'accel'] as const;
  $('meters').innerHTML = rows.map(r => `<div class="meter"><span>${r}</span>
    <div class="bar"><i id="mb_${r}"></i></div><div class="bar eco"><i id="me_${r}"></i></div></div>`).join('');
  const setBar = (el: HTMLElement, v: number) => {
    v = Math.max(-1, Math.min(1, v));
    el.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`; el.style.width = `${Math.abs(v) * 50}%`;
  };
  function renderUI(entry: WhaleEntry) {
    document.querySelectorAll<HTMLElement>('.wcard').forEach(b => b.classList.toggle('on', b.dataset.k === current.key));
    [...$('style').children].forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.s === current.style));
    const info = whale!.info, st = info.stats;
    $('subtitle').textContent = `${info.name} · ${info.biomeLabel}`;
    $('fact').textContent = entry.fact;
    $('stats').textContent = `${info.styleLabel} · ${st.triangles.toLocaleString()} tris · ${st.bones} bones · ` +
      `${st.trees} trees in ${st.treeClusters} clusters · ${st.waterfalls} waterfalls · ${entry.sizes[current.style] ?? '?'} MB`;
    document.title = `${info.name} · Sky Whales`;
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  const prevPos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  renderer.setAnimationLoop(() => {
    const now = performance.now(); const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
    if (whale) {
      const steer = mode === 'steer' ? {
        yaw: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0),
        pitch: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      } : null;
      prevPos.copy(whale.object.position);
      pilot.step(dt, whale.L, steer); pilot.apply(whale.object);
      whale.update(dt);
      const delta = whale.object.position.clone().sub(prevPos);
      camera.position.add(delta); controls.target.add(delta);
      if (chase && now > userOrbitUntil) {
        const L = whale.L;
        const want = new THREE.Vector3(L * 1.0, L * 0.38, -L * 1.35).applyAxisAngle(up, pilot.heading).add(whale.object.position);
        camera.position.lerp(want, 1 - Math.exp(-dt * 0.9));
        controls.target.lerp(whale.object.position, 1 - Math.exp(-dt * 3));
      }
      controls.update();
      sun.position.copy(whale.object.position).add(new THREE.Vector3(30, 55, 20)); sun.target.position.copy(whale.object.position);
      sky.position.copy(camera.position);
      for (const c of clouds) {
        for (const ax of ['x', 'z'] as const) {
          const d = c.position[ax] - whale.object.position[ax];
          if (d > 320) c.position[ax] -= 640; else if (d < -320) c.position[ax] += 640;
        }
        const dy = c.position.y - whale.object.position.y;
        if (dy > 90) c.position.y -= 180; else if (dy < -90) c.position.y += 180;
      }
      const m = whale.meters;
      for (const r of rows) { setBar($(`mb_${r}`), m.body[r]); setBar($(`me_${r}`), m.eco[r]); }
    }
    renderer.render(scene, camera);
  });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  const want = params.get('whale') ?? manifest[0].key;
  const style = (params.get('style') === 'B' ? 'B' : 'A') as Style;
  await loadWhale(manifest.some(m => m.key === want) ? want : manifest[0].key, style);
}

void start().catch(err => { console.error(err); $('loading').textContent = 'The whales could not load.'; });
