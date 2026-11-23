// The camera operator. One base shot (Camera_main) and a few moves layered on it, all through critically damped
// springs so the camera never jerks:
//   intro    a slow crane down from under the ridge to the main shot while the room fades up (letterboxed)
//   talking  a gentle push-in toward him while he speaks
//   fetching the camera trucks and pans to keep him in frame, tilting up when he rides the ladder
//   handing  back out to the main shot, eased toward the table
// The app adds drag-to-pan, wheel/pinch zoom, the narrow-screen follow and the reading view on top.
import * as THREE from 'three';
import type { Librarian } from './librarian';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** No opening crane on the main site: going down the hatch is the entrance. */
export const INTRO = 0;

class Spring {
  readonly x = new THREE.Vector3();
  private v = new THREE.Vector3();
  constructor(start: THREE.Vector3, private w: number) { this.x.copy(start); }
  /** Critically damped step toward `to` (semi-implicit, stable for any dt). */
  step(to: THREE.Vector3, dt: number, w = this.w) {
    const k = w * w, c = 2 * w;
    const a = to.clone().sub(this.x).multiplyScalar(k).addScaledVector(this.v, -c);
    this.v.addScaledVector(a, dt / (1 + c * dt + k * dt * dt));
    this.x.addScaledVector(this.v, dt);
    // never let a bad frame (zero or huge dt, a degenerate target) poison the camera for good
    if (!Number.isFinite(this.x.x + this.x.y + this.x.z + this.v.x + this.v.y + this.v.z)) this.snap(to);
  }
  snap(to: THREE.Vector3) { this.x.copy(to); this.v.set(0, 0, 0); }
}

export function setupDirector(base: { pos: THREE.Vector3; target: THREE.Vector3 }, lib: Librarian, table: THREE.Vector3) {
  // the opening: high under the ridge, off to the right, looking down across the table at the shelves
  const introFrom = { pos: base.pos.clone().add(new THREE.Vector3(0.9, 0.75, -0.7)), target: new THREE.Vector3(-0.2, 0.7, -1.6) };
  const pos = new Spring(INTRO ? introFrom.pos : base.pos, 1.3);
  const target = new Spring(INTRO ? introFrom.target : base.target, 1.8);
  let t = 0, skip = false;
  let visit: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;   // the visitor went to look somewhere
  const head = new THREE.Vector3(), body = new THREE.Vector3(), wantP = new THREE.Vector3(), wantT = new THREE.Vector3();
  const look = new THREE.Matrix4(), quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);

  return {
    get time() { return t; },
    /** Away from the main shot, looking at something the visitor picked. */
    get away() { return !!visit; },
    goTo(pos: THREE.Vector3, at: THREE.Vector3) { visit = { pos: pos.clone(), target: at.clone() }; },
    goHome() { visit = null; },
    get inIntro() { return !skip && t < INTRO; },
    /** End the opening now (a click or key press); the springs carry the camera home. */
    skipIntro() { skip = true; },
    update(dt: number, opts: { reading: boolean; narrow: boolean }) {
      t += dt;
      lib.bone('head').getWorldPosition(head);
      lib.root.getWorldPosition(body);
      wantP.copy(base.pos);
      wantT.copy(base.target);
      if (!skip && t < INTRO) {
        // crane: ease out of the high shot along a curve that settles onto the main one
        const k = THREE.MathUtils.smootherstep(t / INTRO, 0, 1);
        wantP.lerpVectors(introFrom.pos, base.pos, k).y += Math.sin(k * Math.PI) * 0.12;
        wantT.lerpVectors(introFrom.target, base.target, Math.pow(k, 0.8));
        pos.snap(wantP);
        target.snap(wantT);
      } else if (visit && !opts.reading) {
        wantP.copy(visit.pos);
        wantT.copy(visit.target);
        pos.step(wantP, dt, 1.7);
        target.step(wantT, dt, 2.2);
      } else if (!REDUCED && !opts.reading) {
        const s = lib.state;
        if (s === 'fetching') {
          // keep him in frame: pan toward him, truck a little along with him, tilt up on the ladder
          wantT.lerp(new THREE.Vector3(body.x, head.y - 0.25, body.z), opts.narrow ? 0.35 : 0.55);
          wantP.x += body.x * 0.22;
          const climb = Math.max(0, body.y - 0.05);
          wantP.y += climb * 0.35;
          wantT.y += climb * 0.6;
          wantP.lerp(wantT, 0.12);
        } else if (s === 'handing_over') {
          wantT.lerp(table, 0.25);
          wantP.lerp(table, 0.1);
        } else if (s === 'talking' || s === 'thinking') {
          // a slow push-in on him while he speaks
          wantT.lerp(head, 0.3);
          wantP.lerp(head, opts.narrow ? 0.08 : 0.16);
        }
        pos.step(wantP, dt, s === 'talking' || s === 'thinking' ? 0.6 : 1.3);
        target.step(wantT, dt);
      } else {
        pos.step(wantP, dt);
        target.step(wantT, dt);
      }
      // reduced motion: cut to the shot (going to a station, back to him, following him) instead of gliding
      if (REDUCED && (skip || t >= INTRO)) { pos.snap(wantP); target.snap(wantT); }
      look.lookAt(pos.x, target.x, up);
      quat.setFromRotationMatrix(look);
      return { pos: pos.x, quat };
    },
  };
}
