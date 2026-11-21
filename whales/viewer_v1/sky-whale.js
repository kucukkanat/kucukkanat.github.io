// SkyWhale: runtime controller for the sky-whale GLBs.
//
//   const whale = new SkyWhale(gltf, THREE, { particles: true });
//   scene.add(whale.object);
//   // every frame, after you've moved/rotated whale.object (or let whale.fly() do it):
//   whale.update(dt);
//
// What it does
//   * plays the baked `cruise` loop (swim strokes, fins, breathing, tree + water sway)
//   * turns the static reaction poses (body_* / eco_*) into ADDITIVE clips and drives their weights
//     from the whale's real acceleration in its own frame, through springs:
//       body springs are critically damped (spine/fins follow smoothly)
//       eco springs are under-damped (trees and water overshoot, then settle)
//   * scrolls waterfalls & water, emits biome particles that trail behind (world space), blowhole spouts
//   * style B ("toon" in the GLB metadata): cel-shading + inverted-hull outline
import { AdditiveAnimationBlendMode, AnimationUtils, LoopRepeat } from 'three';

const REACTIONS = ['bankL', 'bankR', 'climb', 'dive', 'accel'];

class Spring {
  constructor(stiffness, damping) { this.k = stiffness; this.c = damping; this.x = 0; this.v = 0; }
  step(target, dt) {
    const a = this.k * (target - this.x) - this.c * this.v;
    this.v += a * dt; this.x += this.v * dt; return this.x;
  }
}
const spring = (k, zeta) => new Spring(k, 2 * zeta * Math.sqrt(k));

function makeCanvasTexture(THREE, w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class SkyWhale {
  constructor(gltf, THREE, opts = {}) {
    this.THREE = THREE;
    this.opts = Object.assign({ particles: true, outline: true, reactionGain: 1.0 }, opts);
    this.object = gltf.scene;
    this.info = JSON.parse(gltf.scene.userData.whale || '{}');
    this.L = this.info.length || 12;
    this.object.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    this.skinned = [];
    this.object.traverse(o => { if (o.isSkinnedMesh) this.skinned.push(o); });
    this.blowhole = this.object.getObjectByName('blowhole');

    // ---------------------------------------------------------------- animation
    this.mixer = new THREE.AnimationMixer(this.object);
    const clips = Object.fromEntries(gltf.animations.map(c => [c.name, c]));
    this.cruise = this.mixer.clipAction(clips.cruise);
    this.cruise.setLoop(LoopRepeat).play();
    const ref = this._bindPoseClip(clips.rest || clips.cruise);
    this.reaction = {};
    for (const r of REACTIONS) {
      for (const part of ['body', 'eco']) {
        const src = clips[`${part}_${r}`]; if (!src) continue;
        const clip = AnimationUtils.makeClipAdditive(src.clone(), 0, ref);
        const act = this.mixer.clipAction(clip);
        act.blendMode = AdditiveAnimationBlendMode;
        act.setEffectiveWeight(0); act.play();
        this.reaction[`${part}_${r}`] = act;
      }
    }
    this.springs = {
      body: { bank: spring(26, 1.0), pitch: spring(22, 1.0), accel: spring(18, 1.0) },
      eco: { bank: spring(16, 0.22), pitch: spring(14, 0.25), accel: spring(12, 0.28) },
    };
    this.signals = { bank: 0, pitch: 0, accel: 0 };

    // ---------------------------------------------------------------- kinematics state
    this._prevPos = new THREE.Vector3(); this._vel = new THREE.Vector3(); this._velSm = new THREE.Vector3();
    this._acc = new THREE.Vector3(); this._first = true; this._q = new THREE.Quaternion();
    this.time = 0; this._nextSpout = 4;

    this._setupMaterials();
    this.particles = this.opts.particles ? this._makeParticles() : null;
    this.spout = this._makeSpout();
  }

  // Reference pose for additive clips = the skeleton's bind pose (robust even if a track is missing in `rest`).
  _bindPoseClip(template) {
    const THREE = this.THREE; const tracks = [];
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
  _setupMaterials() {
    const THREE = this.THREE; const toon = !!this.info.toon;
    this.scrollers = [];
    const grad = (() => {
      const data = new Uint8Array([125, 125, 125, 255, 195, 195, 195, 255, 255, 255, 255, 255]);
      const t = new THREE.DataTexture(data, 3, 1); t.minFilter = t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true; return t;
    })();
    const fallsMap = makeCanvasTexture(THREE, 64, 256, (g, w, h) => {
      g.fillStyle = '#9fdcee'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * w, len = 40 + Math.random() * 120, y = Math.random() * h;
        g.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.5})`; g.lineWidth = 1 + Math.random() * 3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y + len); g.stroke();
        g.beginPath(); g.moveTo(x, y - h); g.lineTo(x, y - h + len); g.stroke();
      }
    });
    fallsMap.wrapS = fallsMap.wrapT = THREE.RepeatWrapping; fallsMap.repeat.set(1, 3);
    const fallsAlpha = makeCanvasTexture(THREE, 4, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, h, 0, 0); // canvas y=0 -> uv v=1 (top of fall)
      gr.addColorStop(0, '#000'); gr.addColorStop(0.28, '#ccc'); gr.addColorStop(0.95, '#eee'); gr.addColorStop(1, '#888');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    fallsAlpha.colorSpace = THREE.NoColorSpace;

    this.object.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material; const role = m.userData?.role;
      if (role === 'waterfall') {
        const nm = new THREE.MeshStandardMaterial({
          map: fallsMap.clone(), alphaMap: fallsAlpha, transparent: true, depthWrite: false,
          side: THREE.DoubleSide, roughness: 0.25, emissive: 0x335566, emissiveIntensity: 0.4,
        });
        nm.map.needsUpdate = true;
        o.material = nm; o.castShadow = false; o.renderOrder = 2;
        this.scrollers.push({ tex: nm.map, v: 1.6 });
      } else if (role === 'water') {
        m.map.wrapS = m.map.wrapT = THREE.RepeatWrapping;
        m.depthWrite = false; m.roughness = 0.05; o.castShadow = false; o.renderOrder = 1;
        this.scrollers.push({ tex: m.map, v: 0.05, u: 0.03 });
      } else if (toon && (role === 'body' || role === 'vcol' || role === 'ice')) {
        const nm = new THREE.MeshToonMaterial({
          map: m.map || null, normalMap: m.normalMap || null, vertexColors: !!m.vertexColors, gradientMap: grad, side: m.side,
        });
        o.material = nm;
      }
    });
    if (toon && this.opts.outline) {
      for (const mesh of this.skinned) {
        const role = mesh.material.userData?.role ?? (mesh.material.isMeshToonMaterial ? 'toon' : '');
        if (!['Whale_Body', 'Whale_Island'].some(n => mesh.name.startsWith(n))) continue;
        const width = this.L * (mesh.name.startsWith('Whale_Body') ? 0.0028 : 0.0016);
        const mat = new THREE.MeshBasicMaterial({ color: 0x1a1220, side: THREE.BackSide });
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
            `#include <begin_vertex>\n transformed += normalize(objectNormal) * ${width.toFixed(4)};`);
        };
        const hull = new THREE.SkinnedMesh(mesh.geometry, mat);
        hull.bind(mesh.skeleton, mesh.bindMatrix);
        hull.position.copy(mesh.position); hull.quaternion.copy(mesh.quaternion); hull.scale.copy(mesh.scale);
        hull.frustumCulled = false; hull.castShadow = false;
        mesh.parent.add(hull);
      }
    }
  }

  // ---------------------------------------------------------------- particles (world space)
  _sprite(kind) {
    const THREE = this.THREE;
    return makeCanvasTexture(THREE, 64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      if (kind === 'leaves' || kind === 'petals') {
        g.fillStyle = '#fff'; g.beginPath();
        g.ellipse(32, 32, kind === 'petals' ? 22 : 26, kind === 'petals' ? 14 : 12, 0.6, 0, Math.PI * 2); g.fill();
      } else {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
        gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.8)');
        gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      }
    });
  }

  _pointsMaterial(tex, size, additive) {
    const THREE = this.THREE;
    return new THREE.PointsMaterial({
      map: tex, size, sizeAttenuation: true, transparent: true, depthWrite: false, vertexColors: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, alphaTest: additive ? 0 : 0.05,
    });
  }

  _makeParticles() {
    const THREE = this.THREE; const cfg = this.info.particles; if (!cfg) return null;
    const scale = this.L / 14;
    const N = cfg.count * 2;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const additive = cfg.kind === 'fireflies';
    const mat = this._pointsMaterial(this._sprite(cfg.kind), cfg.size * 2.2 * scale, additive);
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
    const c1 = new THREE.Color(cfg.color), c2 = new THREE.Color(cfg.color2);
    const P = { pts, pos, col, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N),
      N, cfg, c1, c2, acc: 0, scale };
    for (let i = 0; i < N; i++) { P.life[i] = -1; pos[i * 3 + 1] = -1e5; }
    return P;
  }

  _makeSpout() {
    const THREE = this.THREE; const N = 260; const scale = this.L / 14;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, this._pointsMaterial(this._sprite('mist'), 0.55 * scale, false));
    pts.frustumCulled = false;
    const S = { pts, pos, col, vel: new Float32Array(N * 3), life: new Float32Array(N), max: new Float32Array(N), N, scale };
    for (let i = 0; i < N; i++) { S.life[i] = -1; pos[i * 3 + 1] = -1e5; }
    return S;
  }

  /** Add particle systems to your scene (they simulate in world space). */
  addEffectsTo(scene) {
    if (this.particles) scene.add(this.particles.pts);
    scene.add(this.spout.pts);
  }
  removeEffectsFrom(scene) {
    if (this.particles) scene.remove(this.particles.pts);
    scene.remove(this.spout.pts);
  }

  triggerSpout() {
    const THREE = this.THREE; const S = this.spout; if (!this.blowhole) return;
    const p = new THREE.Vector3(); this.blowhole.getWorldPosition(p);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.object.getWorldQuaternion(this._q));
    let n = 0;
    for (let i = 0; i < S.N && n < 220; i++) {
      if (S.life[i] > 0) continue; n++;
      const sp = (3.5 + Math.random() * 3.5) * S.scale;
      const j = new THREE.Vector3((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7);
      const v = up.clone().multiplyScalar(sp).add(j.multiplyScalar(sp)).add(this._velSm);
      S.pos.set([p.x, p.y, p.z], i * 3); S.vel.set([v.x, v.y, v.z], i * 3);
      S.max[i] = S.life[i] = 1.2 + Math.random() * 0.9;
    }
  }

  _stepParticles(dt) {
    const THREE = this.THREE; const P = this.particles;
    if (P) {
      const cfg = P.cfg; const info = this.info.island;
      P.acc += dt * cfg.count / 3.5;
      const m = this.object.matrixWorld; const v = new THREE.Vector3();
      while (P.acc >= 1) {
        P.acc -= 1;
        const i = P.life.findIndex(l => l <= 0); if (i < 0) break;
        v.set((Math.random() * 2 - 1) * info.halfWidth, 0.2 + Math.random() * 1.5 * P.scale,
          (Math.random() * 2 - 1) * info.halfLength);
        v.add(new THREE.Vector3(...info.center)); v.applyMatrix4(m);
        P.pos.set([v.x, v.y, v.z], i * 3);
        const k = cfg.kind === 'fireflies' ? 0.85 : 0.75;
        P.vel.set([this._velSm.x * k + (Math.random() - 0.5) * 0.6, this._velSm.y * k + (Math.random() - 0.2) * 0.5,
          this._velSm.z * k + (Math.random() - 0.5) * 0.6], i * 3);
        P.max[i] = P.life[i] = 3 + Math.random() * 3;
        const c = P.c1.clone().lerp(P.c2, Math.random());
        P.col.set([c.r, c.g, c.b], i * 3);
      }
      const drag = Math.exp(-cfg.drag * dt);
      for (let i = 0; i < P.N; i++) {
        if (P.life[i] <= 0) continue;
        P.life[i] -= dt;
        const o = i * 3;
        P.vel[o] *= drag; P.vel[o + 1] = P.vel[o + 1] * drag + cfg.gravity * dt; P.vel[o + 2] *= drag;
        if (cfg.kind === 'leaves' || cfg.kind === 'petals' || cfg.kind === 'fireflies') {
          const t = this.time * 2 + i;
          P.vel[o] += Math.sin(t) * dt * 0.8; P.vel[o + 2] += Math.cos(t * 1.3) * dt * 0.8;
        }
        P.pos[o] += P.vel[o] * dt; P.pos[o + 1] += P.vel[o + 1] * dt; P.pos[o + 2] += P.vel[o + 2] * dt;
        if (P.life[i] <= 0) P.pos[o + 1] = -1e5;
      }
      P.pts.geometry.attributes.position.needsUpdate = true; P.pts.geometry.attributes.color.needsUpdate = true;
    }
    const S = this.spout;
    for (let i = 0; i < S.N; i++) {
      if (S.life[i] <= 0) continue;
      S.life[i] -= dt; const o = i * 3; const d = Math.exp(-1.4 * dt);
      S.vel[o] *= d; S.vel[o + 1] = S.vel[o + 1] * d - 4.0 * S.scale * dt; S.vel[o + 2] *= d;
      S.pos[o] += S.vel[o] * dt; S.pos[o + 1] += S.vel[o + 1] * dt; S.pos[o + 2] += S.vel[o + 2] * dt;
      const f = Math.max(0, S.life[i] / S.max[i]);
      S.col[o] = S.col[o + 1] = S.col[o + 2] = 0.95 * f;
      if (S.life[i] <= 0) S.pos[o + 1] = -1e5;
    }
    S.pts.geometry.attributes.position.needsUpdate = true; S.pts.geometry.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------------- main update
  update(dt) {
    const THREE = this.THREE;
    dt = Math.min(dt, 1 / 20);
    this.time += dt;
    this.object.updateMatrixWorld();
    const p = new THREE.Vector3().setFromMatrixPosition(this.object.matrixWorld);
    if (this._first) { this._prevPos.copy(p); this._first = false; }
    const vel = p.clone().sub(this._prevPos).divideScalar(Math.max(dt, 1e-4));
    this._prevPos.copy(p);
    const prevSm = this._velSm.clone();
    this._velSm.lerp(vel, 1 - Math.exp(-dt * 6));
    const acc = this._velSm.clone().sub(prevSm).divideScalar(Math.max(dt, 1e-4));
    this._acc.lerp(acc, 1 - Math.exp(-dt * 5));

    // acceleration + gravity tilt in the whale's own frame (+X left, +Y up, +Z forward)
    const qInv = this.object.getWorldQuaternion(this._q).invert();
    const aL = this._acc.clone().applyQuaternion(qInv);
    const gL = new THREE.Vector3(0, -1, 0).applyQuaternion(qInv); // gravity direction in local frame
    const aRef = 0.9 * this.L / 14 * 6;
    const g = this.opts.reactionGain;
    const clamp = (x) => Math.max(-1, Math.min(1, x));
    // body (spine/fins) reacts to manoeuvres only; eco (trees/water) also feels the gravity tilt,
    // so water stays roughly level and trees lean downhill while the whale is pitched/rolled.
    const sig = {
      body: { bank: clamp(g * aL.x / aRef), pitch: clamp(g * aL.y / aRef), accel: clamp(g * Math.max(0, aL.z / aRef)) },
      eco: {
        bank: clamp(g * (aL.x / aRef - gL.x * 0.45)),
        pitch: clamp(g * (aL.y / aRef - gL.z * 1.4)),
        accel: clamp(g * Math.max(0, aL.z / aRef)),
      },
    };
    this.signals = sig;

    for (const part of ['body', 'eco']) {
      const S = this.springs[part]; const s = sig[part];
      const b = S.bank.step(s.bank, dt), pt = S.pitch.step(s.pitch, dt), ac = S.accel.step(s.accel, dt);
      this._w(`${part}_bankL`, Math.max(0, b)); this._w(`${part}_bankR`, Math.max(0, -b));
      this._w(`${part}_climb`, Math.max(0, pt)); this._w(`${part}_dive`, Math.max(0, -pt));
      this._w(`${part}_accel`, Math.max(0, ac));
    }
    // swim tempo follows speed
    const speed = this._velSm.length();
    this.cruise.timeScale = 0.55 + Math.min(1.6, speed / (this.L * 0.45)) * 0.7 + this.springs.body.accel.x * 0.6;
    this.mixer.update(dt);

    for (const s of this.scrollers) { s.tex.offset.y += (s.v || 0) * dt; s.tex.offset.x += (s.u || 0) * dt; }
    if (this.time > this._nextSpout) { this.triggerSpout(); this._nextSpout = this.time + (this.info.spoutEvery || 12) * (0.8 + Math.random() * 0.4); }
    this._stepParticles(dt);
  }

  _w(name, w) { const a = this.reaction[name]; if (a) a.setEffectiveWeight(Math.min(1.25, w)); }

  get meters() {
    return {
      body: Object.fromEntries(Object.entries(this.springs.body).map(([k, s]) => [k, s.x])),
      eco: Object.fromEntries(Object.entries(this.springs.eco).map(([k, s]) => [k, s.x])),
    };
  }

  dispose() { this.mixer.stopAllAction(); }
}

// Simple autonomous flight path (smooth wandering with banks, climbs, dives and sprints).
export class AutoPilot {
  constructor(THREE, seed = 1) {
    this.THREE = THREE; this.t = seed * 10; this.heading = 0; this.pitch = 0; this.roll = 0; this.speed = 4;
    this.pos = new THREE.Vector3(); this.yawRate = 0;
  }
  step(dt, L, steer = null) {
    this.t += dt; const t = this.t;
    let yawRateT, pitchT, speedT;
    const base = L * 0.42;
    if (steer) {
      yawRateT = steer.yaw * 0.65; pitchT = steer.pitch * 0.45; speedT = base * (steer.boost ? 1.9 : 1.0);
    } else {
      yawRateT = 0.38 * Math.sin(t * 0.17) + 0.22 * Math.sin(t * 0.071 + 1.3);
      pitchT = 0.28 * Math.sin(t * 0.11 + 0.5) + 0.12 * Math.sin(t * 0.29);
      const sprint = Math.max(0, Math.sin(t * 0.05 + 2)) ** 8;
      speedT = base * (1 + 0.8 * sprint);
    }
    pitchT -= this.pos.y * 0.004;
    this.yawRate += (yawRateT - this.yawRate) * (1 - Math.exp(-dt * 1.6));
    this.pitch += (pitchT - this.pitch) * (1 - Math.exp(-dt * 1.2));
    this.speed += (speedT - this.speed) * (1 - Math.exp(-dt * 0.8));
    this.heading += this.yawRate * dt;
    const rollT = -Math.max(-0.6, Math.min(0.6, this.yawRate * this.speed / L * 2.2));
    this.roll += (rollT - this.roll) * (1 - Math.exp(-dt * 2.0));
    const dir = new this.THREE.Vector3(Math.sin(this.heading) * Math.cos(this.pitch), Math.sin(this.pitch),
      Math.cos(this.heading) * Math.cos(this.pitch));
    this.pos.addScaledVector(dir, this.speed * dt);
  }
  apply(obj) {
    obj.position.copy(this.pos);
    obj.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
  }
}
