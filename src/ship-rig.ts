// The galleon's moving parts, driven by the flight (outside.ts). The model (airship/) puts every moving part on an
// empty at its hinge, with glTF extras: joint (hinge | slide | spin), axis (in the node's own space), min/max (deg),
// sign (mirrored port/starboard twins share one value), rpm; sails carry a "furl" shape key.
//
// Ship space (glTF): +X bow, +Y up, +Z starboard. Turn > 0 is to port (left), climb > 0 is up.
//
//   rudder + wheel   follow the turn (the wheel by the model's ratio: 540° of wheel = 35° of rudder)
//   elevators        follow the climb; the bow pitch is the flight's own (outside.ts)
//   wing fins        bank against each other in a turn, lift together in a climb, sweep back with speed
//   nacelles         tilt the propellers up when slow or climbing; propellers spin with the throttle
//   yards, spanker   brace into the turn, a little behind it (as a crew would)
//   sails            set in stages with the throttle (furled at a stop), billow with airspeed, luff in hard turns
//   flags, pennants  stream and flap faster with airspeed
//   lift stone, gyro spin up when climbing / turning; figurehead wings spread with speed

import * as THREE from 'three';

const { clamp, lerp, degToRad } = THREE.MathUtils;

export interface RigInput {
  /** -1..1, > 0 to port. */
  turn: number;
  /** -1..1, > 0 climbing. */
  climb: number;
  /** 0..1, the throttle setting. */
  throttle: number;
  /** 0..1, actual speed over top speed. */
  speed: number;
}

interface Joint { o: THREE.Object3D; q0: THREE.Quaternion; axis: THREE.Vector3; sign: number; min: number; max: number; v: number; rpm: number }
interface Cloth { mesh: THREE.Mesh; base: Float32Array; kind: 'square' | 'fore-aft' | 'flag'; furl: number; furlT: number;
  /** per vertex: belly weight 0..1 (square / fore-aft sails), or distance from the hoist (flags) */ w: Float32Array; thin: 0 | 1 | 2; size: number }

const q = new THREE.Quaternion();

export class ShipRig {
  private joints = new Map<string, Joint>();
  private sails: Cloth[] = [];
  private flags: Cloth[] = [];
  private t = 0;
  // smoothed controls (the parts move at their own pace)
  private turnL = 0; // lagging turn, for the yards and the boom

  constructor(ship: THREE.Object3D) {
    ship.traverse(o => {
      const e = o.userData as { joint?: string; axis?: number[]; sign?: number; min?: number; max?: number; rpm?: number; morph?: string };
      if (e.joint && e.joint !== 'group' && e.axis)
        this.joints.set(o.name, { o, q0: o.quaternion.clone(), axis: new THREE.Vector3(...e.axis).normalize(), sign: e.sign ?? 1,
          min: e.min ?? -360, max: e.max ?? 360, v: 0, rpm: e.rpm ?? 0 });
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (/^Sail_/.test(o.name) || (/^Sail_/.test(o.parent?.name ?? '') && m.morphTargetInfluences)) this.sails.push(this.cloth(m, /jib|spanker/.test(o.name + (o.parent?.name ?? '')) ? 'fore-aft' : 'square'));
      else if (/_cloth$/.test(o.name)) this.flags.push(this.cloth(m, 'flag'));
    });
  }

  /** Names of the spinners this rig drives (outside.ts leaves them alone). */
  static readonly DRIVEN = new Set(['Prop_L', 'Prop_R', 'Lift_stone', 'Gyro_ring', 'Wheel']);

  private cloth(mesh: THREE.Mesh, kind: Cloth['kind']): Cloth {
    mesh.geometry = mesh.geometry.clone();
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const base = Float32Array.from(pos.array as ArrayLike<number>);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!, size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const dims = [size.x, size.y, size.z];
    const thin = dims.indexOf(Math.min(...dims)) as 0 | 1 | 2;
    const w = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      if (kind === 'flag') { w[i] = base[i * 3]; continue; } // the hoist is at x = 0 (airship/rig.py)
      // belly: 1 in the middle of the cloth, 0 at its edges (the two axes that span the sail)
      let k = 1;
      for (let a = 0; a < 3; a++) if (a !== thin) { const u = (base[i * 3 + a] - (a === 0 ? c.x : a === 1 ? c.y : c.z)) / Math.max(dims[a] / 2, 1e-3); k *= clamp(1 - u * u, 0, 1); }
      w[i] = k;
    }
    const size2 = Math.max(...dims);
    return { mesh, base, kind, furl: 0, furlT: 0, w, thin, size: size2 };
  }

  /** Set a joint's value (degrees), clamped to its range; mirrored twins pass the same value. */
  private set(name: string, v: number) {
    const j = this.joints.get(name);
    if (!j) return;
    j.v = clamp(v, j.min, j.max);
    j.o.quaternion.copy(j.q0).multiply(q.setFromAxisAngle(j.axis, degToRad(j.v * j.sign)));
  }
  /** Ease a joint toward v (degrees) at rate l (1/s). */
  private ease(name: string, v: number, l: number, dt: number) {
    const j = this.joints.get(name);
    if (j) this.set(name, lerp(j.v, clamp(v, j.min, j.max), 1 - Math.exp(-l * dt)));
  }
  private spin(name: string, rpmScale: number, dt: number) {
    const j = this.joints.get(name);
    if (!j || !j.rpm) return;
    j.o.rotateOnAxis(j.axis, j.rpm / 60 * Math.PI * 2 * rpmScale * dt);
  }

  update(dt: number, c: RigInput) {
    this.t += dt;
    const t = this.t;
    const turn = clamp(c.turn, -1, 1), climb = clamp(c.climb, -1, 1), sp = clamp(c.speed, 0, 1), thr = clamp(c.throttle, 0, 1);
    this.turnL = lerp(this.turnL, turn, 1 - Math.exp(-0.9 * dt));

    // helm: rudder (+ = trailing edge to starboard = turn to starboard) and the wheel through the model's ratio
    const rudder = -turn * 30;
    this.ease('Rudder', rudder, 5, dt);
    const ratio = (this.joints.get('Wheel')?.o.userData.ratio as number | undefined) ?? 35 / 540;
    this.ease('Wheel', (this.joints.get('Rudder')?.v ?? rudder) / ratio, 6, dt);

    // elevators: trailing edge up (+) lifts the nose
    this.ease('Elevator_L', climb * 22, 5, dt);
    this.ease('Elevator_R', climb * 22, 5, dt);

    // wing fins: (+) raises both tips. A turn to port drops the port fin and raises the starboard one.
    const bank = turn * 20 * (0.5 + 0.5 * sp), lift = climb * 9 + Math.sin(t * 0.9) * 1.2;
    this.ease('Fin_L', lift - bank, 4, dt);
    this.ease('Fin_R', lift + bank, 4, dt);
    this.ease('Fin_L_sweep', sp * 50, 1.2, dt);
    this.ease('Fin_R_sweep', sp * 50, 1.2, dt);

    // propellers: tilt up (negative) when slow or climbing; spin with the throttle
    const tilt = -(1 - sp) * 40 - climb * 22;
    this.ease('Nacelle_L', tilt, 2, dt);
    this.ease('Nacelle_R', tilt, 2, dt);
    this.spin('Prop_L', 0.12 + 1.1 * thr, dt);
    this.spin('Prop_R', 0.12 + 1.1 * thr, dt);

    // the lift stone works harder in a climb; the gyro in a turn
    this.spin('Lift_stone', 1 + Math.max(0, climb) * 2.5, dt);
    this.spin('Gyro_ring', 1 + Math.abs(turn) * 2.5, dt);
    this.ease('Figurehead_wing_L', 2 + sp * 26 + climb * 8, 1.5, dt);
    this.ease('Figurehead_wing_R', 2 + sp * 26 + climb * 8, 1.5, dt);

    // trim: the yards brace into the turn and the spanker boom swings out, both behind the helm
    for (const y of ['Yard_fore_course', 'Yard_fore_topsail', 'Yard_main_course', 'Yard_main_topsail']) this.ease(y, -this.turnL * 22, 2, dt);
    this.ease('Spanker', this.turnL * 28, 1.6, dt);

    // sails: set in stages with the throttle; furled at a stop
    for (const s of this.sails) {
      const n = s.mesh.name + (s.mesh.parent?.name ?? '');
      const setAt = /topsail/.test(n) ? 0.1 : /course/.test(n) ? 0.05 : 0.02; // cruise (0.125) carries them all
      s.furlT = thr > setAt ? 0 : 1;
      s.furl = lerp(s.furl, s.furlT, 1 - Math.exp(-1.1 * dt));
      if (s.mesh.morphTargetInfluences) s.mesh.morphTargetInfluences[0] = s.furl;
      this.billow(s, sp, turn, t);
    }
    // flags and pennants: stream harder and flap faster with the airspeed
    for (const f of this.flags) this.flap(f, sp, t);
  }

  /** Push the cloth out along its thin axis: a full belly with airspeed, a luffing ripple when slow or turning hard. */
  private billow(s: Cloth, sp: number, turn: number, t: number) {
    const pos = s.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array, b = s.base, open = 1 - s.furl;
    // square sails fill toward the bow (wind from astern); fore-and-aft sails fill to leeward of the turn
    const dir = s.kind === 'square' ? 1 : (turn >= 0 ? 1 : -1);
    const belly = open * s.size * (0.03 + 0.09 * sp) * dir;
    const luff = open * s.size * 0.012 * (0.4 + 1.6 * (1 - sp) + 1.2 * Math.abs(turn));
    const ax = s.thin;
    for (let i = 0; i < pos.count; i++) {
      const w = s.w[i], u = b[i * 3 + (ax === 1 ? 0 : 1)];
      a[i * 3 + ax] = b[i * 3 + ax] + w * belly + w * luff * Math.sin(u * 2.3 + t * (3 + 4 * sp));
    }
    pos.needsUpdate = true;
    s.mesh.geometry.computeVertexNormals();
  }

  private flap(f: Cloth, sp: number, t: number) {
    const pos = f.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array, b = f.base;
    const amp = 0.08 + 0.12 * sp, freq = 3 + 6 * sp;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.abs(f.w[i]), k = Math.min(1, d * 0.6);
      a[i * 3 + 2] = b[i * 3 + 2] + Math.sin(d * 2.6 - t * freq) * amp * 1.4 * k;
      a[i * 3 + 1] = b[i * 3 + 1] + Math.sin(d * 1.7 - t * freq * 0.75) * amp * 0.5 * k - sp * 0.08 * d * (1 - sp * 0.5);
    }
    pos.needsUpdate = true;
    f.mesh.geometry.computeVertexNormals();
  }
}
