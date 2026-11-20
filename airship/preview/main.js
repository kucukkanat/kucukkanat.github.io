import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.18;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.3, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxDistance = 220; controls.minDistance = 2;

// ---------- sky ----------
const skyU = { night: { value: 0 }, sunDir: { value: new THREE.Vector3(-0.62, 0.3, 0.72).normalize() } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: skyU,
  vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `varying vec3 d; uniform float night; uniform vec3 sunDir;
    float h(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
    void main(){ float y = d.y;
      vec3 top = mix(vec3(.30,.36,.62), vec3(.02,.03,.09), night), mid = mix(vec3(.98,.62,.42), vec3(.07,.08,.2), night),
           low = mix(vec3(.62,.33,.42), vec3(.03,.03,.08), night);
      vec3 c = y > 0. ? mix(mid, top, pow(y, .55)) : mix(mid, low, pow(-y, .5));
      float s = max(dot(normalize(d), sunDir), 0.);
      c += mix(vec3(1.,.72,.38), vec3(.5,.6,.9), night) * (pow(s, 6.) * .45 + pow(s, 240.) * 2.2) * mix(1., .5, night);
      vec3 g = floor(normalize(d) * 220.); float st = step(.9975, h(g)) * night * smoothstep(-.05, .3, y);
      gl_FragColor = vec4(c + st, 1.); }` }));
scene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
{ const es = new THREE.Scene(); es.add(new THREE.Mesh(sky.geometry, sky.material)); scene.environment = pmrem.fromScene(es, 0, 1, 1500).texture; }
scene.environmentIntensity = 0.9;
function cloudTex() { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 9; i++) { const x = 30 + Math.random() * 68, y = 54 + Math.random() * 26, r = 16 + Math.random() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); } return new THREE.CanvasTexture(c); }
const clouds = new THREE.Group(); scene.add(clouds);
const cloudMat = [0, 1, 2].map(() => new THREE.SpriteMaterial({ map: cloudTex(), color: 0xffc9a8, transparent: true, depthWrite: false, fog: false }));
for (let i = 0; i < 46; i++) { const s = new THREE.Sprite(cloudMat[i % 3]); const a = Math.random() * 6.283, r = 120 + Math.random() * 380;
  s.position.set(Math.cos(a) * r, -70 + Math.random() * 120, Math.sin(a) * r); const k = 60 + Math.random() * 140; s.scale.set(k * 2.2, k, 1); clouds.add(s); }

const hemi = new THREE.HemisphereLight(0xffdcb8, 0x8a5a64, 0.75); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc48a, 2.8); sun.position.copy(skyU.sunDir.value).multiplyScalar(80).add(new THREE.Vector3(0, 30, 0));
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 32, bottom: -22, near: 1, far: 220 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06; scene.add(sun, sun.target); sun.target.position.set(0, 8, 0);

// ---------- textures (procedural: painted grain / canvas weave) ----------
function grainTex() { const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 520; i++) { const y = Math.random() * 256, x = Math.random() * 512, w = 40 + Math.random() * 260, a = .03 + Math.random() * .1;
    g.strokeStyle = Math.random() < .25 ? `rgba(255,240,215,${a})` : `rgba(60,25,10,${a})`; g.lineWidth = .6 + Math.random() * 2.2;
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + w * .3, y + (Math.random() - .5) * 5, x + w * .6, y + (Math.random() - .5) * 5, x + w, y + (Math.random() - .5) * 3); g.stroke();
    if (x + w > 512) { g.beginPath(); g.moveTo(x - 512, y); g.lineTo(x + w - 512, y); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(.42, 1.7); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function clothTex() { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(90,60,30,.11)'; g.fillRect(i * 256 / 12 - 1, 0, 2, 256); }
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(80,50,20,${Math.random() * .05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 10, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; }
const GRAIN = grainTex(), CLOTH = clothTex();
const WOOD = new Set(['HullWood', 'HullDark', 'Deck', 'Trim', 'Spar', 'PaintOrange', 'PaintCream']);
const GLOW = { Glass: [.9, 2.2], LanternGlow: [1.2, 7], LiftStone: [2.2, 5] };

// ---------- load ----------
const b64 = document.getElementById('glb').textContent.trim();
const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
const joints = [], morphs = [], lamps = [], cloths = [], spinners = [];
let ship, glowMats = {};
const deg = THREE.MathUtils.degToRad;

new GLTFLoader().parse(bin, '', gltf => {
  ship = gltf.scene.getObjectByName('Ship') || gltf.scene; scene.add(gltf.scene);
  const seen = new Set();
  gltf.scene.traverse(o => {
    const d = o.userData;
    if (o.isMesh) {
      o.castShadow = o.receiveShadow = true;
      const m = o.material;
      if (!seen.has(m)) { seen.add(m);
        if (WOOD.has(m.name) && !m.map) { m.map = GRAIN; m.needsUpdate = true; }
        if (/^(Sail|Flag)/.test(m.name)) { if (!m.map) m.map = CLOTH; m.side = THREE.DoubleSide; m.shadowSide = THREE.DoubleSide; m.needsUpdate = true; }
        if (GLOW[m.name]) glowMats[m.name] = m;
        for (const t of [m.map, m.normalMap]) if (t) t.anisotropy = 8;
        if (m.normalMap) m.normalScale.set(1.2, 1.2); }
      if (GLOW[m.name]) o.castShadow = false;
      if (/_cloth$/.test(o.name)) { o.geometry = o.geometry.clone(); cloths.push({ o, base: o.geometry.attributes.position.array.slice() }); }
    }
    if (d.morph) morphs.push(o);
    if (d.light) { const L = new THREE.PointLight(d.color, 0, 30, 1.6); L.userData.k = d.intensity;
      if (o.isMesh) { o.geometry.computeBoundingBox(); o.geometry.boundingBox.getCenter(L.position); } o.add(L); lamps.push(L); }
    if (d.joint && d.joint !== 'group') {
      const j = { o, d, p: o.position.clone(), q: o.quaternion.clone(), axis: new THREE.Vector3(...d.axis), v: 0, t: 0, sign: d.sign || 1 };
      joints.push(j); if (d.rpm) spinners.push(j);
    }
  });
  buildPanel(); setNight(false); setView('quarter', true);
  document.getElementById('load').remove();
  renderer.setAnimationLoop(frame);
}, e => { document.getElementById('load').textContent = 'Could not load the model: ' + e.message; });

function applyJoint(j) {
  const v = j.v * j.sign;
  if (j.d.joint === 'slide') j.o.position.copy(j.p).add(j.axis.clone().applyQuaternion(j.q).multiplyScalar(v));
  else j.o.quaternion.copy(j.q).multiply(new THREE.Quaternion().setFromAxisAngle(j.axis, deg(v)));
}

// ---------- control panel ----------
const ctl = {};   // label -> {joints, min, max, input, out, set(v)}
const spinOn = {};
function buildPanel() {
  const panel = document.getElementById('panel'); const groups = {};
  const G = n => groups[n] || (groups[n] = Object.assign(document.createElement('details'), { open: ['Flight controls', 'Sails', 'Propulsion'].includes(n) }));
  const order = ['Flight controls', 'Propulsion', 'Lift', 'Sails', 'Doors & hatches', 'Guns', 'Deck gear'];
  order.forEach(n => { const g = G(n); g.innerHTML = `<summary>${n}</summary>`; panel.append(g); });
  const slider = (group, label, min, max, val, unit, fn) => {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label>${label}</label><input type="range" min="${min}" max="${max}" step="${(max - min) / 200}" value="${val}"><output></output>`;
    const [, input, out] = row.children; const show = v => out.textContent = (+v).toFixed(Math.abs(max - min) < 5 ? 2 : 0) + unit;
    input.addEventListener('input', () => { show(input.value); fn(+input.value); }); show(val); G(group).append(row);
    return { input, show };
  };
  // master furl
  const furlAll = slider('Sails', 'Furl all sails', 0, 1, 0, '', v => morphs.forEach(m => ctl['m:' + m.name].set(v)));
  for (const j of joints) {
    const d = j.d; const key = d.label || j.o.name;
    if (d.rpm !== undefined && d.min === undefined) {
      if (!(key in spinOn)) { spinOn[key] = d.group !== 'Deck gear';
        const c = document.createElement('label'); c.className = 'chk'; c.innerHTML = `<input type="checkbox" ${spinOn[key] ? 'checked' : ''}> ${key} running`;
        c.firstChild.addEventListener('change', e => spinOn[key] = e.target.checked); G(d.group || 'Deck gear').append(c); }
      j.spinKey = key; continue;
    }
    if (!ctl[key]) {
      const c = ctl[key] = { joints: [], min: d.min, max: d.max };
      const unit = d.joint === 'slide' ? ' m' : '°';
      const ui = slider(d.group || 'Deck gear', key, d.min, d.max, 0, unit, v => { c.joints.forEach(x => x.t = v); link(key, v); });
      c.set = v => { v = Math.min(c.max, Math.max(c.min, v)); ui.input.value = v; ui.show(v); c.joints.forEach(x => x.t = v); };
    }
    ctl[key].joints.push(j); j.ctl = ctl[key];
  }
  for (const m of morphs) {
    const key = 'm:' + m.name; const c = ctl[key] = { morph: m, t: 0, v: 0 };
    const ui = slider('Sails', m.userData.label || m.name, 0, 1, 0, '', v => c.t = v);
    c.set = v => { ui.input.value = v; ui.show(v); c.t = v; };
  }
}
function link(key, v) {      // helm wheel <-> rudder
  const w = ctl['Helm wheel'], r = ctl['Rudder']; if (!w || !r) return;
  const ratio = w.joints[0].d.ratio;
  if (key === 'Helm wheel') r.set(-v * ratio); else if (key === 'Rudder') w.set(-v / ratio);
}

// ---------- views, night, picking ----------
const VIEWS = { quarter: [[-34, 17, 30], [1, 9, 0]], side: [[3, 11, 62], [3, 10, 0]], stern: [[-27, 8, 7], [-10, 6, 0]],
  deck: [[9, 13, 9], [-3, 6, 0]], below: [[-18, -14, 24], [0, 4, 0]] };
let viewTween = null;
function setView(n, snap) { const [p, t] = VIEWS[n]; const P = new THREE.Vector3(...p), T = new THREE.Vector3(...t);
  if (snap) { camera.position.copy(P); controls.target.copy(T); return; }
  viewTween = { p0: camera.position.clone(), t0: controls.target.clone(), P, T, k: 0 }; }
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
let night = false, nightK = 0, bob = true;
function setNight(n) { night = n; document.getElementById('night').classList.toggle('on', n); }
document.getElementById('night').onclick = () => setNight(!night);
document.getElementById('bob').onclick = e => { bob = !bob; e.target.classList.toggle('on', bob); };
document.getElementById('toggle').onclick = () => document.getElementById('panel').classList.toggle('hidden');
if (innerWidth < 760) document.getElementById('panel').classList.add('hidden');

const ray = new THREE.Raycaster(), tip = document.getElementById('tip'); let down = null;
renderer.domElement.addEventListener('pointerdown', e => down = [e.clientX, e.clientY]);
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5 || !ship) return;
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObject(ship, true)[0]; if (!hit) return;
  let o = hit.object, name = o.name, found = null, morph = null;
  for (let n = o; n && n !== scene; n = n.parent) { if (n.userData.morph && !morph) morph = n; if (n.userData.joint && n.userData.joint !== 'group' && !found) found = n; }
  let msg = `<b>${name.replace(/_/g, ' ')}</b>`;
  if (morph) { const c = ctl['m:' + morph.name]; c.set(c.t > .5 ? 0 : 1); msg = `<b>${morph.userData.label}</b>`; }
  else if (found) { const j = joints.find(x => x.o === found); const d = found.userData;
    msg = `<b>${d.label || found.name}</b> · ${d.joint}${d.min !== undefined ? ` ${d.min}…${d.max}${d.joint === 'slide' ? ' m' : '°'}` : ''}`;
    if (j.ctl) { const c = j.ctl; const far = Math.abs(c.max) >= Math.abs(c.min) ? c.max : c.min; const cur = c.joints[0].t;
      const v = Math.abs(cur) > Math.abs(far) * .5 ? 0 : (d.label === 'Helm wheel' ? 360 : far); c.set(v); link(d.label, v); }
    else if (j.spinKey) { spinOn[j.spinKey] = !spinOn[j.spinKey]; }
    if (d.note) msg += `<small>${d.note}</small>`; }
  else { for (let n = o; n && n !== scene; n = n.parent) if (n.userData.note) { msg += `<small>${n.userData.note}</small>`; break; } }
  tip.innerHTML = msg;
});

// ---------- frame ----------
const clock = new THREE.Clock(); const tmp = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
  if (viewTween) { const v = viewTween; v.k = Math.min(1, v.k + dt / 1.1); const e = v.k * v.k * (3 - 2 * v.k);
    camera.position.lerpVectors(v.p0, v.P, e); controls.target.lerpVectors(v.t0, v.T, e); if (v.k >= 1) viewTween = null; }
  for (const j of joints) {
    if (j.spinKey) { if (spinOn[j.spinKey]) j.v += j.d.rpm * 6 * dt; }
    else { const k = 1 - Math.exp(-dt * (j.d.joint === 'slide' ? 2.2 : 4)); j.v += (j.t - j.v) * k; }
    applyJoint(j);
  }
  for (const k in ctl) { const c = ctl[k]; if (c.morph) { c.v += (c.t - c.v) * (1 - Math.exp(-dt * 2.5)); c.morph.morphTargetInfluences[0] = c.v; } }
  for (const c of cloths) { const a = c.o.geometry.attributes.position; const b = c.base;
    for (let i = 0; i < a.count; i++) { const x = b[i * 3], d = Math.abs(x);
      a.array[i * 3 + 2] = b[i * 3 + 2] + Math.sin(d * 2.6 - t * 5.5) * .16 * Math.min(1, d * .6);
      a.array[i * 3 + 1] = b[i * 3 + 1] + Math.sin(d * 1.7 - t * 4.1) * .06 * Math.min(1, d * .6); }
    a.needsUpdate = true; c.o.geometry.computeVertexNormals(); }
  if (ship) { const k = bob ? 1 : 0;
    ship.position.y = Math.sin(t * .55) * .28 * k; ship.rotation.x = deg(Math.sin(t * .41) * 1.4) * k; ship.rotation.z = deg(Math.sin(t * .33 + 1) * .9) * k; }
  nightK += ((night ? 1 : 0) - nightK) * (1 - Math.exp(-dt * 2.5));
  skyU.night.value = nightK; scene.environmentIntensity = THREE.MathUtils.lerp(.9, .12, nightK);
  hemi.intensity = THREE.MathUtils.lerp(.75, .14, nightK); hemi.color.lerpColors(new THREE.Color(0xffdcb8), new THREE.Color(0x5a6aa8), nightK);
  sun.intensity = THREE.MathUtils.lerp(2.8, .35, nightK); sun.color.lerpColors(new THREE.Color(0xffc48a), new THREE.Color(0x8fa6ff), nightK);
  cloudMat.forEach(m => m.color.lerpColors(new THREE.Color(0xffc9a8), new THREE.Color(0x1a1e38), nightK));
  for (const L of lamps) L.intensity = L.userData.k * (0.25 + 2.2 * nightK) * (1 + Math.sin(t * 9 + L.id) * .04);
  for (const n in glowMats) glowMats[n].emissiveIntensity = THREE.MathUtils.lerp(GLOW[n][0], GLOW[n][1], nightK);
  clouds.rotation.y = t * .004;
  controls.update(); renderer.render(scene, camera);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
