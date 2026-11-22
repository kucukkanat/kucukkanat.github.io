// The animals of a whale's island: a flock that wheels around it (and scatters when the whale lurches), grazers
// that wander the ground and bolt, fish that circle the lakes and jump. They also notice a visitor nearby.
import * as THREE from 'three';
import type { RNG } from './rng';
import type { Ecosystem, EcoCtx } from './ecosystem';
import { mulAffine } from './back';
import { makeCritter, makeFish } from './props';

const TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _B = new Float32Array(16), _c9 = new Float32Array(9);

interface Bird { p: THREE.Vector3; v: THREE.Vector3; a: number; rate: number; rad: number; h: number; phase: number; fear: number; roost: number; curious: boolean }
interface Critter { x: number; z: number; tx: number; tz: number; head: number; wait: number; flee: number; hop: number; s: number }
interface Fish { lake: number; a: number; rad: number; rate: number; depth: number; jump: number; next: number; s: number }

export class Fauna {
  readonly solids: THREE.Mesh[] = [];
  private birds: Bird[] = []; private birdMesh: THREE.Mesh | null = null; private bpos!: Float32Array;
  private critters: Critter[] = []; private critterMesh: THREE.InstancedMesh | null = null; private hopper = false;
  private fish: Fish[] = []; private fishMesh: THREE.InstancedMesh | null = null;
  private started = false; private calm = 0;
  get count() { return this.birds.length + this.critters.length + this.fish.length; }

  constructor(private eco: Ecosystem, material: THREE.Material, rng: RNG, full: boolean) {
    const f = eco.bio.fauna, U = eco.U;
    // ── birds (one dynamic mesh, in the motion space)
    const nb = Math.round(f.birds.count * (full ? 1 : 0.4));
    if (nb) {
      this.bpos = new Float32Array(nb * 12 * 3);
      const col = new Float32Array(nb * 12 * 3), nrm = new Float32Array(nb * 12 * 3);
      const cb = new THREE.Color(f.birds.color), cw = new THREE.Color(f.birds.wing);
      for (let i = 0; i < nb; i++) {
        for (let q = 0; q < 12; q++) { const c = q < 6 ? cb : cw; col.set([c.r, c.g, c.b], (i * 12 + q) * 3); nrm[(i * 12 + q) * 3 + 1] = 1; }
        this.birds.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), a: rng.f() * TAU, rate: rng.range(0.35, 0.7) * (rng.chance(0.5) ? 1 : -1), rad: rng.range(1.15, 1.9),
          h: rng.range(0.5, 2.2) * U, phase: rng.f() * TAU, fear: 0, roost: rng.int(0, Math.max(0, eco.roosts.length - 1)), curious: i % 3 === 0 });
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.bpos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      const m = material.clone(); m.side = THREE.DoubleSide;
      this.birdMesh = new THREE.Mesh(g, m); this.birdMesh.frustumCulled = false; this.birdMesh.name = 'Eco_Birds';
      eco.fx.add(this.birdMesh); this.solids.push(this.birdMesh);
    }
    if (!full) return;
    // ── grazers
    if (f.critter) {
      const kind = f.critter.kind; this.hopper = kind === 'frog' || kind === 'crab' || kind === 'salamander';
      const spots: Critter[] = [];
      for (let t = 0; spots.length < f.critter.count && t < 200; t++) {
        const x = rng.range(-1, 1) * eco.hw, z = eco.cz + rng.range(-1, 1) * eco.hl;
        if (eco.walkable(x, z)) spots.push({ x, z, tx: x, tz: z, head: rng.f() * TAU, wait: rng.range(0, 4), flee: 0, hop: rng.f() * TAU, s: U * rng.range(0.85, 1.15) });
      }
      if (spots.length) {
        this.critters = spots;
        this.critterMesh = new THREE.InstancedMesh(makeCritter(kind, f.critter.color, f.critter.color2), material, spots.length);
        this.critterMesh.frustumCulled = false; this.critterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.critterMesh.name = 'Eco_Critters';
        eco.group.add(this.critterMesh); this.solids.push(this.critterMesh);
      }
    }
    // ── fish
    if (f.fish) {
      eco.lakeSpecs.forEach((l, li) => {
        if (l.kind !== 'water') return;
        for (let i = 0, n = Math.max(2, Math.round(4 * (l.r / (0.45 * U)) ** 2)); i < n; i++)
          this.fish.push({ lake: li, a: rng.f() * TAU, rad: rng.range(0.25, 0.7), rate: rng.range(0.5, 1.1) * (rng.chance(0.5) ? 1 : -1), depth: rng.range(0.25, 0.6), jump: 0, next: rng.range(3, 22), s: U * rng.range(0.7, 1.1) });
      });
      if (this.fish.length) {
        this.fishMesh = new THREE.InstancedMesh(makeFish(f.fish), material, this.fish.length);
        this.fishMesh.frustumCulled = false; this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.fishMesh.name = 'Eco_Fish';
        eco.group.add(this.fishMesh); this.solids.push(this.fishMesh);
      }
    }
  }

  reset() { this.started = false; }

  update(c: EcoCtx) {
    const { dt, time, k } = c, eco = this.eco, U = eco.U;
    // how rough the ride is: sudden moves frighten everything
    const rough = Math.max(c.startle, Math.min(1, Math.max(0, Math.hypot(c.sig.x, c.sig.y, c.sig.z) - 0.75) * 2));
    this.calm = rough > 0.3 ? 0 : this.calm + dt;

    // ── birds
    if (this.birdMesh) {
      const P = this.bpos, len = 0.075 * U * k, span = 0.2 * U * k, roosts = eco.roosts;
      this.birds.forEach((b, i) => {
        if (rough > 0.3 && b.fear < 0.5) { b.fear = 1; b.v.addScaledVector(_v.set(Math.random() - 0.5, 0.6 + Math.random() * 0.6, Math.random() - 0.5), 3.5 * U * k * rough); }
        b.fear = Math.max(0, b.fear - dt * 0.22);
        b.a += b.rate * dt * (1 + b.fear * 1.6);
        const roosting = c.night > 0.6 && b.fear < 0.05 && roosts.length > 0 && c.storm < 0.5;
        if (roosting) _t.copy(roosts[b.roost % roosts.length]);
        else {
          const R = b.rad * (1 + b.fear * 0.9) * (1 - c.storm * 0.3);
          _t.set(Math.cos(b.a) * eco.hw * 1.6 * R, eco.top + b.h * (1 + b.fear) * (1 - c.storm * 0.5) + Math.sin(b.a * 2.3 + b.phase) * 0.25 * U, eco.cz + Math.sin(b.a) * eco.hl * 0.95 * R);
          if (c.visitor && b.curious && b.fear < 0.2) _t.lerp(c.visitor, 0.22);   // some drift over to look
        }
        _t.applyMatrix4(c.M);
        if (!this.started) { b.p.copy(_t); b.v.copy(c.vel); }
        const K = roosting ? 9 : 3.2, D = roosting ? 5 : 2.0;
        b.v.x += ((_t.x - b.p.x) * K - (b.v.x - c.vel.x) * D) * dt; b.v.y += ((_t.y - b.p.y) * K - (b.v.y - c.vel.y) * D) * dt; b.v.z += ((_t.z - b.p.z) * K - (b.v.z - c.vel.z) * D) * dt;
        b.p.addScaledVector(b.v, dt);
        const perched = roosting && b.p.distanceTo(_t) < 0.12 * U * k;
        // heading: the bird's own motion through the air around the whale
        _f.copy(b.v).sub(c.vel).addScaledVector(c.vel, 0.25); if (_f.lengthSq() < 1e-8) _f.set(0, 0, 1); _f.normalize();
        _r.set(-_f.z, 0, _f.x); if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0); _r.normalize(); _u.crossVectors(_r, _f);
        const glide = Math.sin(time * 0.5 + b.phase) > 0.55 && b.fear < 0.1;
        const fl = perched ? -1.1 : glide ? 0.12 : Math.sin(time * (9 + b.fear * 6) + b.phase) * 0.85;
        const o = i * 36, p = b.p, cs = Math.cos(fl), sn = Math.sin(fl);
        const put = (q: number, fx: number, rx: number, ux: number) => {
          P[o + q * 3] = p.x + _f.x * fx + _r.x * rx + _u.x * ux; P[o + q * 3 + 1] = p.y + _f.y * fx + _r.y * rx + _u.y * ux; P[o + q * 3 + 2] = p.z + _f.z * fx + _r.z * rx + _u.z * ux;
        };
        put(0, len, 0, 0); put(1, 0, -len * 0.3, 0); put(2, 0, len * 0.3, 0);
        put(3, -len, 0, 0); put(4, 0, len * 0.3, 0); put(5, 0, -len * 0.3, 0);
        put(6, len * 0.45, len * 0.15, 0); put(7, -len * 0.1, span * cs, span * sn); put(8, -len * 0.4, len * 0.15, 0);
        put(9, len * 0.45, -len * 0.15, 0); put(10, -len * 0.4, -len * 0.15, 0); put(11, -len * 0.1, -span * cs, span * sn);
      });
      this.birdMesh.geometry.attributes.position.needsUpdate = true;
      this.started = true;
    }

    // ── grazers
    if (this.critterMesh) {
      const out = this.critterMesh.instanceMatrix.array as Float32Array;
      this.critters.forEach((a, i) => {
        if (rough > 0.3 && a.flee <= 0) {
          a.flee = 2.5 + Math.random() * 2;
          for (let t = 0; t < 12; t++) { const x = (Math.random() * 2 - 1) * eco.hw * 0.6, z = eco.cz + (Math.random() * 2 - 1) * eco.hl * 0.8; if (eco.walkable(x, z)) { a.tx = x; a.tz = z; break; } }
        }
        a.flee -= dt; a.wait -= dt;
        const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
        let moving = false;
        if (d > 0.03 * U) {
          const sp = U * (a.flee > 0 ? 1.5 : this.hopper ? 0.5 : 0.28), nx = a.x + dx / d * sp * dt, nz = a.z + dz / d * sp * dt;
          if (eco.walkable(nx, nz, 1.02)) { a.x = nx; a.z = nz; moving = true; } else { a.tx = a.x; a.tz = a.z; }
          let dh = Math.atan2(dx, dz) - a.head; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); a.head += dh * Math.min(1, dt * 8);
        } else if (a.wait <= 0) {
          a.wait = 2 + Math.random() * 6;
          const an = Math.random() * TAU, r = U * (0.3 + Math.random() * 0.9), x = a.x + Math.cos(an) * r, z = a.z + Math.sin(an) * r;
          if (eco.walkable(x, z)) { a.tx = x; a.tz = z; }
        } else if (c.visitor && a.flee <= 0) {
          // idle: watch the visitor
          let dh = Math.atan2(c.visitor.x - a.x, c.visitor.z - a.z) - a.head; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); a.head += dh * Math.min(1, dt * 2);
        }
        if (moving) a.hop += dt * (a.flee > 0 ? 22 : this.hopper ? 9 : 13);
        const hop = moving ? Math.abs(Math.sin(a.hop)) * U * (this.hopper ? 0.09 : 0.025) : 0;
        const y = eco.groundY(a.x, a.z) + hop, cs = Math.cos(a.head) * a.s, sn = Math.sin(a.head) * a.s;
        eco.skinAt(a.x, a.z, _B);
        _c9.set([cs, 0, -sn, 0, a.s, 0, sn, 0, cs]);
        mulAffine(_B, 0, _c9, 0, a.x, y, a.z, out, i * 16);
      });
      this.critterMesh.instanceMatrix.needsUpdate = true;
    }

    // ── fish
    if (this.fishMesh) {
      const out = this.fishMesh.instanceMatrix.array as Float32Array;
      this.fish.forEach((f, i) => {
        const lake = eco.lakes[f.lake], s = lake.spec;
        f.a += f.rate * dt * (rough > 0.3 ? 3 : 1); f.next -= dt;
        const x = Math.cos(f.a) * s.r * f.rad, z = Math.sin(f.a) * s.r * f.rad, surf = lake.heightAt(x, z);
        let y = surf - s.depth * f.depth * (1 - f.rad * 0.5), pitch = 0;
        if (f.next <= 0 && f.jump <= 0 && this.calm > 2) { f.jump = 1; f.next = 6 + Math.random() * 24; lake.impulse(x, z, -s.r * 0.7, s.r * 0.12); }
        if (f.jump > 0) {
          const t = 1 - f.jump; f.jump -= dt * 1.6;
          y = surf + Math.sin(t * Math.PI) * s.r * 0.5 - s.depth * 0.1; pitch = Math.cos(t * Math.PI) * 1.1;
          if (f.jump <= 0) lake.impulse(x, z, s.r * 1.1, s.r * 0.14);
        }
        const head = f.a + (f.rate > 0 ? 0 : Math.PI), ch = Math.cos(-head), sh = Math.sin(-head), cp = Math.cos(-pitch), sp = Math.sin(-pitch), sc = f.s;
        // RotY(-head) * RotX(-pitch): the fish swims along the circle's tangent
        _c9.set([ch * sc, 0, -sh * sc, sh * sp * sc, cp * sc, ch * sp * sc, sh * cp * sc, -sp * sc, ch * cp * sc]);
        mulAffine(eco.lakeMatrix(f.lake), 0, _c9, 0, s.x + x, s.y + y, s.z + z, out, i * 16);
      });
      this.fishMesh.instanceMatrix.needsUpdate = true;
    }
  }
}
