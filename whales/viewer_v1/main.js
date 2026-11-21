import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SkyWhale, AutoPilot } from './sky-whale.js?v=2';

const manifest = await (await fetch('./whales.json')).json();

// ------------------------------------------------------------------ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color('#f1dcc8');
scene.fog = new THREE.Fog(HORIZON, 140, 650);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 90;

// sky dome
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
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 200 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// clouds
const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#c9d6e6', emissiveIntensity: 0.35, flatShading: true });
const clouds = [];
{
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 70; i++) {
    const parts = [];
    const n = 5 + Math.floor(Math.random() * 6);
    for (let k = 0; k < n; k++) {
      const g = new THREE.IcosahedronGeometry(rnd(3, 7), 1);
      g.scale(1, 0.62, 1); g.translate(rnd(-8, 8), rnd(-1, 2), rnd(-5, 5)); parts.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(parts), cloudMat);
    const s = rnd(0.8, 2.4); m.scale.setScalar(s);
    m.position.set(rnd(-300, 300), rnd(-70, 50), rnd(-300, 300));
    if (Math.abs(m.position.y) < 18) m.position.y += Math.sign(m.position.y || 1) * 25;
    scene.add(m); clouds.push(m);
  }
}

// ------------------------------------------------------------------ whales
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const cache = new Map();
let whale = null, current = { key: manifest[0].key, style: 'A' };
const pilot = new AutoPilot(THREE, 1);
let mode = 'auto', chase = true, particlesOn = true, userOrbitUntil = 0;
const keys = new Set();

let loadSeq = 0;
async function loadWhale(key, style) {
  const entry = manifest.find(m => m.key === key);
  const url = entry.files[style];
  const token = ++loadSeq;
  document.getElementById('loading').style.display = 'grid';
  let w = cache.get(url);
  if (!w) {
    const gltf = await loader.loadAsync(url);
    w = cache.get(url) || new SkyWhale(gltf, THREE, { particles: true });
    cache.set(url, w);
  }
  if (token !== loadSeq) return;  // a newer selection superseded this one
  if (whale) { scene.remove(whale.object); whale.removeEffectsFrom(scene); }
  const first = !whale;
  whale = w; current = { key, style };
  scene.add(whale.object);
  if (particlesOn) whale.addEffectsTo(scene); else scene.add(whale.spout.pts);
  whale._first = true;
  pilot.apply(whale.object);
  if (first) placeCamera();
  document.getElementById('loading').style.display = 'none';
  renderUI();
}

function placeCamera() {
  const L = whale.L;
  const off = new THREE.Vector3(L * 1.15, L * 0.42, -L * 1.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), pilot.heading);
  controls.target.copy(whale.object.position);
  camera.position.copy(whale.object.position).add(off);
}

// ------------------------------------------------------------------ UI
const $ = (id) => document.getElementById(id);
$('whales').innerHTML = manifest.map(m => `
  <button class="wcard" data-k="${m.key}">
    <span class="sw" style="background:${m.color}"></span>
    <span><div class="wname">${m.name}</div><div class="wbiome">${m.biomeShort}</div></span>
  </button>`).join('');
$('whales').addEventListener('click', e => { const b = e.target.closest('.wcard'); if (b) loadWhale(b.dataset.k, current.style); });
$('style').addEventListener('click', e => { const b = e.target.closest('button'); if (b) loadWhale(current.key, b.dataset.s); });
$('mode').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; mode = b.dataset.m;
  [...$('mode').children].forEach(x => x.classList.toggle('on', x === b));
});
$('spout').onclick = () => whale?.triggerSpout();
$('chase').onclick = () => { chase = !chase; $('chase').classList.toggle('on', chase); };
$('parts').onclick = () => {
  particlesOn = !particlesOn; $('parts').classList.toggle('on', particlesOn);
  if (whale?.particles) (particlesOn ? scene.add(whale.particles.pts) : scene.remove(whale.particles.pts));
};
$('toggle').onclick = () => { $('panel').classList.toggle('collapsed'); $('toggle').textContent = $('panel').classList.contains('collapsed') ? 'Show' : 'Hide'; };
controls.addEventListener('start', () => { userOrbitUntil = performance.now() + 4000; });
controls.addEventListener('change', () => { if (performance.now() < userOrbitUntil) userOrbitUntil = performance.now() + 2500; });

addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'Space') { whale?.triggerSpout(); e.preventDefault(); }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && mode !== 'steer') {
    mode = 'steer'; [...$('mode').children].forEach(x => x.classList.toggle('on', x.dataset.m === 'steer'));
  }
});
addEventListener('keyup', e => keys.delete(e.code));

const meterRows = ['bank', 'pitch', 'accel'];
$('meters').innerHTML = meterRows.map(r => `<div class="meter"><span>${r}</span>
  <div class="bar"><i id="mb_${r}"></i></div><div class="bar eco"><i id="me_${r}"></i></div></div>`).join('');
function setBar(el, v) {
  v = Math.max(-1, Math.min(1, v));
  el.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`; el.style.width = `${Math.abs(v) * 50}%`;
}
function renderUI() {
  document.querySelectorAll('.wcard').forEach(b => b.classList.toggle('on', b.dataset.k === current.key));
  [...$('style').children].forEach(x => x.classList.toggle('on', x.dataset.s === current.style));
  const info = whale.info; const entry = manifest.find(m => m.key === current.key);
  $('subtitle').textContent = `${info.name} · ${info.biomeLabel}`;
  const st = info.stats;
  $('stats').innerHTML = `${info.styleLabel} · ${st.triangles.toLocaleString()} tris · ${st.bones} bones · ` +
    `${st.trees} trees in ${st.treeClusters} clusters · ${st.waterfalls} waterfalls · ${entry.sizes[current.style]} MB GLB`;
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
const prevPos = new THREE.Vector3();
function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  if (whale) {
    const steer = mode === 'steer' ? {
      yaw: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0),
      pitch: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
      boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    } : null;
    prevPos.copy(whale.object.position);
    pilot.step(dt, whale.L, steer);
    pilot.apply(whale.object);
    whale.update(dt);
    // camera follows the whale; user can orbit freely
    const delta = whale.object.position.clone().sub(prevPos);
    camera.position.add(delta); controls.target.add(delta);
    if (chase && performance.now() > userOrbitUntil) {
      const L = whale.L;
      const want = new THREE.Vector3(L * 1.0, L * 0.38, -L * 1.35).applyAxisAngle(new THREE.Vector3(0, 1, 0), pilot.heading)
        .add(whale.object.position);
      camera.position.lerp(want, 1 - Math.exp(-dt * 0.9));
      controls.target.lerp(whale.object.position, 1 - Math.exp(-dt * 3));
    }
    controls.update();
    sun.position.copy(whale.object.position).add(new THREE.Vector3(30, 55, 20));
    sun.target.position.copy(whale.object.position);
    sky.position.copy(camera.position);
    for (const c of clouds) {
      for (const ax of ['x', 'z']) {
        const d = c.position[ax] - whale.object.position[ax];
        if (d > 320) c.position[ax] -= 640; else if (d < -320) c.position[ax] += 640;
      }
      const dy = c.position.y - whale.object.position.y;
      if (dy > 90) c.position.y -= 180; else if (dy < -90) c.position.y += 180;
    }
    const m = whale.meters;
    for (const r of meterRows) { setBar($(`mb_${r}`), m.body[r]); setBar($(`me_${r}`), m.eco[r]); }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
window.__sky = { get whale() { return whale; }, pilot, THREE, camera, loadWhale };

const params = new URLSearchParams(location.search);
await loadWhale(params.get('whale') || manifest[0].key, params.get('style') || 'A');
tick();
