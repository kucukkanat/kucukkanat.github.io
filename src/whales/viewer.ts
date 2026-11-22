// /whales/ - the sky-whale viewer: today's pod or any seed, two styles, four skies; auto-fly or steer and watch
// the island answer. ?seed=<seed>&style=A|B&species=&biome=&sky= preselect (?whale=<species> picks from today's pod);
// ?embed=1 is the compact layout used inside the KANAT·1 handheld.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SkyWhale, AutoPilot, loadManifest, type WhaleEntry } from './sky-whale';
import { dailyPod, makeGenome, randomSeed, SPECIES, type Genome } from './genome';
import { BIOMES, BIOME_KEYS } from './biomes';
import { initKTX2, gltfLoader } from '../scene';
import '../fonts.css';
import { lockZoom, registerSW } from '../pwa';

lockZoom();
registerSW();

type Style = 'A' | 'B';
type SkyKey = 'day' | 'sunset' | 'night' | 'storm';
const params = new URLSearchParams(location.search);
const EMBED = params.get('embed') === '1';
if (EMBED) document.body.classList.add('embed');
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface SkyLook {
  top: string; mid: string; hor: string; bot: string; hemiSky: string; hemiGround: string; hemi: number;
  sun: string; sunI: number; sunDir: [number, number, number]; cloud: string; cloudGlow: string; night: number; storm: number; exposure: number;
}
const SKIES: Record<SkyKey, SkyLook> = {
  day: { top: '#3b78c8', mid: '#9cc4e8', hor: '#f1dcc8', bot: '#b9cfe4', hemiSky: '#d6e8ff', hemiGround: '#f3d8c2', hemi: 1.15, sun: '#fff0dc', sunI: 2.4, sunDir: [30, 55, 20], cloud: '#ffffff', cloudGlow: '#c9d6e6', night: 0, storm: 0, exposure: 1.05 },
  sunset: { top: '#33437f', mid: '#d98b78', hor: '#ffcb96', bot: '#b98294', hemiSky: '#c9b3df', hemiGround: '#e3a37c', hemi: 0.85, sun: '#ff9550', sunI: 2.7, sunDir: [58, 13, -26], cloud: '#ffd9c2', cloudGlow: '#d98a78', night: 0.25, storm: 0, exposure: 1.05 },
  night: { top: '#040817', mid: '#0d1736', hor: '#232e58', bot: '#080d22', hemiSky: '#5a6cae', hemiGround: '#232a4c', hemi: 1.25, sun: '#a9c0ff', sunI: 1.5, sunDir: [-24, 48, -30], cloud: '#1c2444', cloudGlow: '#0c1024', night: 1, storm: 0, exposure: 1.2 },
  storm: { top: '#343c47', mid: '#56616c', hor: '#78828c', bot: '#454d57', hemiSky: '#8e9aa8', hemiGround: '#4c5058', hemi: 0.95, sun: '#c9d3dd', sunI: 0.7, sunDir: [20, 50, 30], cloud: '#7a848e', cloudGlow: '#3a4048', night: 0.2, storm: 1, exposure: 1.0 },
};

async function start() {
  const manifest = await loadManifest();
  if (!manifest.length) { $('loading').textContent = 'No whales found.'; return; }
  const entryOf = (species: string) => manifest.find(m => m.key === species) ?? manifest[0];

  // ---------------------------------------------------------------- renderer / scene
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, EMBED ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = !EMBED; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);
  initKTX2(renderer); // whale textures are KTX2 (Basis)

  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(SKIES.day.hor);
  scene.fog = new THREE.Fog(HORIZON, 140, 650);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.minDistance = 2.5; controls.maxDistance = 90;

  const skyU = { top: { value: new THREE.Color(SKIES.day.top) }, mid: { value: new THREE.Color(SKIES.day.mid) }, hor: { value: HORIZON }, bot: { value: new THREE.Color(SKIES.day.bot) }, stars: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top, mid, hor, bot; uniform float stars;
      float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, mid, smoothstep(0.0, 0.25, h)) : mix(hor, bot, smoothstep(0.0, 0.3, -h));
        c = mix(c, top, smoothstep(0.25, 0.9, h));
        vec3 g = floor(vP * 160.0); float s = step(0.9975, h3(g)) * stars * smoothstep(-0.1, 0.3, h);
        gl_FragColor = vec4(c + s * (0.6 + 0.4 * h3(g + 3.0)), 1.0); }`,
  }));
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(SKIES.day.hemiSky, SKIES.day.hemiGround, SKIES.day.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(SKIES.day.sun, SKIES.day.sunI);
  sun.castShadow = !EMBED; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 200 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const sunDir = new THREE.Vector3(...SKIES.day.sunDir);

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

  // ---------------------------------------------------------------- sky moods
  let skyKey: SkyKey = (['day', 'sunset', 'night', 'storm'] as const).find(k => k === params.get('sky')) ?? 'day';
  const mood = { night: 0, storm: 0 };
  const _c = new THREE.Color(), _d = new THREE.Vector3();
  function stepSky(dt: number, snap = false) {
    const S = SKIES[skyKey], a = snap ? 1 : 1 - Math.exp(-dt * 1.8);
    skyU.top.value.lerp(_c.set(S.top), a); skyU.mid.value.lerp(_c.set(S.mid), a); skyU.hor.value.lerp(_c.set(S.hor), a); skyU.bot.value.lerp(_c.set(S.bot), a);
    hemi.color.lerp(_c.set(S.hemiSky), a); hemi.groundColor.lerp(_c.set(S.hemiGround), a); hemi.intensity += (S.hemi - hemi.intensity) * a;
    sun.color.lerp(_c.set(S.sun), a); sun.intensity += (S.sunI - sun.intensity) * a;
    sunDir.lerp(_d.set(...S.sunDir), a);
    cloudMat.color.lerp(_c.set(S.cloud), a); cloudMat.emissive.lerp(_c.set(S.cloudGlow), a);
    mood.night += (S.night - mood.night) * a; mood.storm += (S.storm - mood.storm) * a;
    skyU.stars.value = Math.max(0, mood.night - 0.5) * 2 * (1 - mood.storm);
    renderer.toneMappingExposure += (S.exposure - renderer.toneMappingExposure) * a;
  }
  stepSky(0, true);

  // ---------------------------------------------------------------- whales
  const loader = await gltfLoader();
  const pod = dailyPod();
  let whale: SkyWhale | null = null;
  let current: { genome: Genome; style: Style } = { genome: pod[0], style: 'A' };
  let over = { species: params.get('species'), biome: params.get('biome') };
  const pilot = new AutoPilot(1);
  let mode: 'auto' | 'steer' = 'auto', chase = true, particlesOn = true, userOrbitUntil = 0, loadSeq = 0;
  const keys = new Set<string>();

  function disposeWhale(w: SkyWhale) {
    scene.remove(w.object); w.removeEffectsFrom(scene); w.dispose();
    w.object.traverse(o => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose();
        mat.dispose();
      }
    });
  }

  async function loadWhale(genome: Genome, style: Style) {
    const entry = entryOf(genome.species);
    const url = entry.files[style] ?? entry.files.A!;
    const token = ++loadSeq;
    $('loading').style.display = 'grid';
    const gltf = await loader.loadAsync(url);
    if (token !== loadSeq) return;
    const w = new SkyWhale(gltf, { genome, detail: 'full', particles: true });
    w.object.traverse(o => { if ((o as THREE.Mesh).isMesh && !o.userData.ecoCustom) { o.castShadow = true; o.receiveShadow = true; } });
    if (whale) disposeWhale(whale);
    const first = !whale;
    whale = w; current = { genome, style };
    scene.add(whale.object); whale.addEffectsTo(scene); whale.setParticlesVisible(particlesOn);
    pilot.apply(whale.object);
    if (first) placeCamera();
    $('loading').style.display = 'none';
    renderUI(entry);
    const q: Record<string, string> = { seed: genome.seed, style };
    if (over.species) q.species = over.species; if (over.biome) q.biome = over.biome;
    if (skyKey !== 'day') q.sky = skyKey; if (EMBED) q.embed = '1';
    history.replaceState(null, '', `?${new URLSearchParams(q)}`);
  }
  const loadSeed = (seed: string, style = current.style) => {
    const inPod = !over.species && !over.biome ? pod.find(g => g.seed === seed) : undefined;
    return loadWhale(inPod ?? makeGenome(seed, over), style);
  };

  function placeCamera() {
    const L = whale!.L * whale!.scale;
    const off = new THREE.Vector3(L * 1.15, L * 0.42, -L * 1.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), pilot.heading);
    controls.target.copy(whale!.object.position);
    camera.position.copy(whale!.object.position).add(off);
  }

  // ---------------------------------------------------------------- UI
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  $('whales').innerHTML = pod.map(g => `
    <button class="wcard" data-seed="${esc(g.seed)}" aria-label="${esc(g.name)}, ${esc(entryOf(g.species).name)}: ${esc(g.biome.label)}">
      <span class="sw" style="background:${esc(g.biome.ground[0])}"></span>
      <span><div class="wname">${esc(g.name)} · ${esc(entryOf(g.species).name.replace(/ whale$/i, ''))}</div><div class="wbiome">${esc(g.biome.short)}</div></span>
    </button>`).join('');
  const fill = (el: HTMLSelectElement, first: string, items: [string, string][], sel: string | null) => {
    el.innerHTML = `<option value="">${first}</option>` + items.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('');
  };
  fill($<HTMLSelectElement>('species'), 'Species: from seed', SPECIES.map(s => [s, entryOf(s).name]), over.species);
  fill($<HTMLSelectElement>('biome'), 'Ecosystem: from seed', BIOME_KEYS.map(b => [b, BIOMES[b].short]), over.biome);
  const reOver = () => {
    over = { species: $<HTMLSelectElement>('species').value || null, biome: $<HTMLSelectElement>('biome').value || null };
    void loadSeed(current.genome.seed);
  };
  $('species').addEventListener('change', reOver); $('biome').addEventListener('change', reOver);
  const clearOver = () => { over = { species: null, biome: null }; $<HTMLSelectElement>('species').value = ''; $<HTMLSelectElement>('biome').value = ''; };
  $('whales').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('.wcard'); if (b) { clearOver(); void loadSeed(b.dataset.seed!); } });
  const seedInput = $<HTMLInputElement>('seed');
  seedInput.addEventListener('change', () => { const s = seedInput.value.trim(); if (s) void loadSeed(s); });
  seedInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') seedInput.blur(); });
  $('roll').onclick = () => { clearOver(); void loadSeed(randomSeed()); };
  $('copy').onclick = () => {
    void navigator.clipboard?.writeText(location.href).then(() => { $('copy').textContent = 'Copied'; setTimeout(() => { $('copy').textContent = 'Copy link'; }, 1400); });
  };
  $('style').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (b) void loadWhale(current.genome, b.dataset.s as Style); });
  const setSky = (k: SkyKey) => {
    skyKey = k; [...$('sky').children].forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.k === k));
    const q = new URLSearchParams(location.search); if (k === 'day') q.delete('sky'); else q.set('sky', k);
    history.replaceState(null, '', `?${q}`);
  };
  $('sky').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (b) setSky(b.dataset.k as SkyKey); });
  setSky(skyKey);
  const setMode = (m: 'auto' | 'steer') => { mode = m; [...$('mode').children].forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.m === m)); };
  $('mode').addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (b) setMode(b.dataset.m as 'auto' | 'steer'); });
  $('spout').onclick = () => whale?.triggerSpout();
  $('startle').onclick = () => whale?.startle(1);
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

  // a click (not a drag) on the whale frightens its island
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), sphere = new THREE.Sphere(); let downAt: [number, number] | null = null;
  renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!whale || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
    sphere.set(whale.object.position, whale.L * whale.scale * 0.3);
    if (ray.ray.intersectsSphere(sphere)) whale.startle(1);
  });

  const STEER = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest?.('button, a, input, select')) { if (e.code !== 'Space') return; }
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
    const g = current.genome;
    document.querySelectorAll<HTMLElement>('.wcard').forEach(b => b.classList.toggle('on', b.dataset.seed === g.seed && !over.species && !over.biome));
    [...$('style').children].forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.s === current.style));
    seedInput.value = g.seed;
    const info = whale!.info, st = info.stats;
    $('subtitle').textContent = `${g.name}, a ${entry.name.toLowerCase()} · ${g.biome.label}`;
    $('fact').textContent = entry.fact;
    $('stats').textContent = `${info.styleLabel} · ${st.triangles.toLocaleString()} tris · ${st.trees} trees, ${st.props} props · ` +
      `${st.lakes} lake${st.lakes === 1 ? '' : 's'}, ${st.waterfalls} fall${st.waterfalls === 1 ? '' : 's'} · ${st.animals} animals · ${entry.sizes[current.style] ?? '?'} MB`;
    document.title = `${g.name} the ${entry.name} · Sky Whales`;
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  const prevPos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), camW = new THREE.Vector3();
  const tick = (dt: number, now = performance.now()) => {
    stepSky(dt);
    if (whale) {
      const steer = mode === 'steer' ? {
        yaw: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0),
        pitch: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      } : null;
      prevPos.copy(whale.object.position);
      pilot.step(dt, whale.L * whale.scale, steer); pilot.apply(whale.object);
      // the generated materials read the same light as the scene
      const E = whale.env;
      E.uSun.value.copy(sunDir).normalize();
      E.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity / Math.PI);
      E.uSky.value.copy(hemi.color).multiplyScalar(hemi.intensity / Math.PI); E.uGround.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity / Math.PI);
      E.uHaze.value.copy(skyU.hor.value);
      whale.setEnvironment(mood.night, mood.storm);
      whale.setVisitor(camera.getWorldPosition(camW));
      whale.update(dt);
      const delta = whale.object.position.clone().sub(prevPos);
      camera.position.add(delta); controls.target.add(delta);
      if (chase && now > userOrbitUntil) {
        const L = whale.L * whale.scale;
        const want = new THREE.Vector3(L * 1.0, L * 0.38, -L * 1.35).applyAxisAngle(up, pilot.heading).add(whale.object.position);
        camera.position.lerp(want, 1 - Math.exp(-dt * 0.9));
        controls.target.lerp(whale.object.position, 1 - Math.exp(-dt * 3));
      }
      controls.update();
      sun.position.copy(whale.object.position).addScaledVector(sunDir, 1); sun.target.position.copy(whale.object.position);
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
    (scene.fog as THREE.Fog).color.copy(skyU.hor.value);
  };
  renderer.setAnimationLoop(() => {
    const now = performance.now(); const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
    tick(dt, now); renderer.render(scene, camera);
  });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  // for automated checks
  (window as unknown as { __whale: unknown }).__whale = { get whale() { return whale; }, pilot, camera, controls, setSky, loadSeed, tick, keys, renderer, scene };

  const style = (params.get('style') === 'B' ? 'B' : 'A') as Style;
  const legacy = params.get('whale');
  const seed = params.get('seed') ?? (legacy ? pod.find(g => g.species === legacy)?.seed : null) ?? pod[0].seed;
  await loadSeed(seed, style);
}

void start().catch(err => { console.error(err); $('loading').textContent = 'The whales could not load.'; });
