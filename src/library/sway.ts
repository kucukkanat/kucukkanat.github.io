// The airship under way: a slow roll and pitch that the visitor feels rather than sees. Inside the ship the room
// moves with you, so the motion shows in what is free to move: the hanging lantern swings behind the roll, the
// sky outside the portholes rises and falls, and the view leans a fraction. Hull creaks fire at the turn of a roll.
import * as THREE from 'three';
import { uTime } from './time';

const q = new URLSearchParams(location.search);
const AMOUNT = Number(q.get('sway') ?? 1);          // ?sway=0 turns the motion off (and is respected by reduced motion)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const K = REDUCED ? 0 : AMOUNT;

/** Ship attitude in radians at time t: roll about the keel (z), pitch about the beam (x). */
export function attitude(t: number) {
  const roll = THREE.MathUtils.degToRad(0.9) * (Math.sin(t * 2 * Math.PI / 9.5) + 0.3 * Math.sin(t * 2 * Math.PI / 4.3 + 1.1));
  const pitch = THREE.MathUtils.degToRad(0.4) * Math.sin(t * 2 * Math.PI / 13 + 0.6);
  return { roll: roll * K, pitch: pitch * K };
}

/** Shared with the sky shader: how far the horizon has risen (in sky-image units). */
export const uBob = { value: 0 };

export function setupSway(opts: { lantern?: THREE.Object3D; light?: THREE.PointLight; onCreak?: (strength: number) => void }) {
  // the lantern swings about the top of its chain: re-parent it under a pivot there
  let pivot: THREE.Group | null = null;
  const flameLocal = new THREE.Vector3();
  if (opts.lantern) {
    const l = opts.lantern;
    l.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(l);
    const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    pivot = new THREE.Group();
    pivot.name = 'HangingLanternPivot';
    pivot.position.copy(top);
    l.parent!.add(pivot);
    pivot.attach(l);
    // the flame sits about 0.93 m under the ridge, 0.88 under the chain top
    flameLocal.set(0, (box.min.y - top.y) + 0.11, 0);
  }
  // pendulum: angle driven by the ship's motion, lightly damped, so it lags and overshoots like a real one
  const swing = { x: 0, vx: 0, z: 0, vz: 0 };
  let lastRollV = 0, lastT = uTime.value;
  return {
    /** `ship`: the main site's ship motion (ship.ts), when given, instead of the built-in roll. */
    update(dt: number, camera: THREE.Camera, ship?: { roll: number; pitch: number }) {
      const t = uTime.value;
      const a = ship ? { roll: ship.roll * K, pitch: ship.pitch * K } : attitude(t), b = attitude(t - 0.05);
      if (pivot && dt > 0) {
        const w2 = 9.81 / 0.88;                    // ω² for a 0.88 m pendulum
        // relative to the cabin, gravity tips by the roll: the lantern wants to hang at -roll
        swing.vz += (w2 * (-a.roll - swing.z) - 0.35 * swing.vz) * dt;
        swing.z += swing.vz * dt;
        swing.vx += (w2 * (a.pitch - swing.x) - 0.35 * swing.vx) * dt;
        swing.x += swing.vx * dt;
        pivot.rotation.set(swing.x * 3, 0, swing.z * 3);
        if (opts.light) opts.light.position.copy(flameLocal).applyQuaternion(pivot.quaternion).add(pivot.position);
      }
      // the view leans a little with the deck, and the horizon outside bobs
      camera.rotateZ(a.roll * 0.35);
      camera.rotateX(a.pitch * 0.3);
      uBob.value = a.roll * 1.8;
      // creak at the turn of each roll (when the roll speed changes sign), stronger after a big roll
      const rollV = (a.roll - b.roll) / 0.05;
      if (t > lastT && Math.sign(rollV) !== Math.sign(lastRollV) && lastRollV !== 0 && K > 0)
        opts.onCreak?.(Math.min(1, Math.abs(a.roll) / THREE.MathUtils.degToRad(1.1)));
      lastRollV = rollV;
      lastT = t;
    },
    /** World position of the swinging flame (for moths). */
    flame(out: THREE.Vector3) {
      return pivot ? out.copy(flameLocal).applyQuaternion(pivot.quaternion).add(pivot.position) : out.set(0.35, 2.67, 0.6);
    },
  };
}
