// Ship motion: the whole airship (cabin + visitor) rolls, pitches and heaves relative to the outside world.
// Inside the cabin nothing moves, so the motion shows as the horizon outside tilting and bobbing (the sky is
// rotated the opposite way), a slight lag of the visitor's head, and loose things swinging (bell, hanging lamp).
// Calm air keeps a barely perceptible drift; a storm eases in big, slow swells plus occasional gusts.
import * as THREE from 'three';
import { damp, reducedMotion } from './anim';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

const G = 9.81;
/** The gondola hangs below the envelope: it rolls and pitches about a point well above the cabin. */
const ROLL_CENTRE = new THREE.Vector3(0, 5, 0);

interface Gust { t0: number; build: number; hold: number; fade: number; strength: number; dir: number; }

export class ShipMotion {
  /** Radians the ship is rolled about its long axis (world Z) / pitched about world X; metres of heave. */
  roll = 0;
  pitch = 0;
  heave = 0;
  /** 0 = calm, 1 = full storm motion (eased, slower than the sky change). */
  amp = 0;
  /** Current gust envelope 0..1 (for flicker, rain slant). */
  gust = 0;
  /** Signed gust push (−1 … 1): which way the current gusts lean the ship (roll sign). */
  gustDir = 0;
  /** Angular acceleration (rad/s²) of roll / pitch and heave acceleration (m/s²), from finite differences (smoothed). */
  rollAcc = 0;
  pitchAcc = 0;
  heaveAcc = 0;
  /** Turbulent buffeting in the cabin frame (m/s²): small jolts that grow with the storm and its gusts. */
  buffet = new THREE.Vector3();
  /** Visitor's head: a little counter-roll and heave that trails the ship. */
  headRoll = 0;
  headHeave = 0;
  private gusts: Gust[] = [];
  private nextGust = 6;
  private phase = Math.random() * 100;
  private prev = { roll: 0, pitch: 0, heave: 0, vr: 0, vp: 0, vh: 0, dt: 0, n: 0 };
  private q = new THREE.Quaternion();
  /** turbulence thumps: a short sharp shove now and then while it storms (what sets a ship's bell clanging) */
  private jolt = { t0: -10, dur: 0.3, x: 0, z: 0, mag: 0, next: 8 };
  private e = new THREE.Euler();

  update(t: number, dt: number, storm: boolean) {
    if (reducedMotion) { this.roll = this.pitch = this.heave = this.headRoll = this.headHeave = this.gust = 0; this.amp = storm ? 1 : 0; this.rollAcc = this.pitchAcc = this.heaveAcc = 0; this.buffet.set(0, 0, 0); return; }
    // ease in over ~6 s, settle out over ~8 s
    this.amp = damp(this.amp, storm ? 1 : 0, storm ? 0.45 : 0.3, dt);
    if (this.amp < 1e-4 && !storm) this.amp = 0;
    const a = this.amp;
    const T = t + this.phase;

    // gusts: build over 1.5–2.5 s, hold, fade over 2.5–4 s; one every 7–15 s while stormy
    if (storm && a > 0.4 && t >= this.nextGust) {
      this.gusts.push({ t0: t, build: 1.5 + Math.random(), hold: 0.4 + Math.random() * 1.2, fade: 2.5 + Math.random() * 1.5, strength: 0.6 + Math.random() * 0.4, dir: Math.random() < 0.5 ? -1 : 1 });
      this.nextGust = t + 7 + Math.random() * 8;
    }
    let g = 0, gDir = 0;
    this.gusts = this.gusts.filter(q => {
      const x = t - q.t0;
      if (x > q.build + q.hold + q.fade) return false;
      const e = x < q.build ? smooth(x / q.build) : x < q.build + q.hold ? 1 : 1 - smooth((x - q.build - q.hold) / q.fade);
      g += e * q.strength; gDir += e * q.strength * q.dir;
      return true;
    });
    this.gust = Math.min(1, g);
    this.gustDir = Math.max(-1, Math.min(1, gDir));

    // calm: a barely perceptible drift
    const calmRoll = (0.35 * Math.sin(TAU * T / 11.3) + 0.15 * Math.sin(TAU * T / 17.9 + 2.1)) * DEG;
    const calmPitch = 0.2 * Math.sin(TAU * T / 9.7 + 0.8) * DEG;
    const calmHeave = 0.006 * Math.sin(TAU * T / 7.1);
    // storm: layered low-frequency swell, a gust leans the ship and swells the motion
    const swell = 1 + 0.35 * this.gust;
    const sRoll = (4.2 * Math.sin(TAU * T / 8.3) + 1.1 * Math.sin(TAU * T / 13.7 + 1.3) + 0.4 * Math.sin(TAU * T / 4.9 + 0.4)) * swell * DEG + 2.6 * DEG * gDir;
    const sPitch = (2.0 * Math.sin(TAU * T / 6.1 + 0.6) + 0.6 * Math.sin(TAU * T / 10.4 + 2.2)) * swell * DEG + 0.9 * DEG * g;
    const sHeave = (0.035 * Math.sin(TAU * T / 5.3 + 1.0) + 0.012 * Math.sin(TAU * T / 3.2 + 2.0)) * swell - 0.02 * g;
    this.roll = calmRoll * (1 - a) + sRoll * a;
    this.pitch = calmPitch * (1 - a) + sPitch * a;
    this.heave = calmHeave * (1 - a) + sHeave * a;
    // the head is carried by the ship but trails it a little
    this.headRoll = damp(this.headRoll, -this.roll * 0.12, 1.4, dt);
    this.headHeave = damp(this.headHeave, -this.heave * 0.35, 2.2, dt);
    this.derivatives(dt);
    // turbulence: band-limited jolts (1–3 Hz) that the eye can't see in the horizon (millimetres) but that knock
    // hanging things about; mostly while gusts blow through
    const b = a * (0.25 + 1.1 * this.gust);
    const j = this.jolt;
    if (storm && a > 0.5 && t >= j.next) {
      const ang = Math.random() * TAU;
      j.t0 = t; j.dur = 0.18 + Math.random() * 0.2; j.x = Math.cos(ang); j.z = Math.sin(ang);
      j.mag = (1.6 + Math.random() * 2.4) * a * (0.6 + this.gust);
      j.next = t + 2 + Math.random() * 6 * (1 - 0.5 * this.gust);
    }
    const jx = t - j.t0, jp = jx >= 0 && jx < j.dur ? j.mag * Math.sin(Math.PI * jx / j.dur) : 0;
    this.buffet.set(
      b * (0.55 * Math.sin(TAU * 1.13 * T) + 0.35 * Math.sin(TAU * 2.71 * T + 1.7) + 0.25 * Math.sin(TAU * 1.79 * T + 4.1)) + jp * j.x,
      b * (0.3 * Math.sin(TAU * 1.37 * T + 0.5) + 0.2 * Math.sin(TAU * 2.23 * T + 2.9)),
      b * (0.45 * Math.sin(TAU * 0.97 * T + 2.3) + 0.3 * Math.sin(TAU * 2.41 * T + 0.2) + 0.2 * Math.sin(TAU * 1.61 * T + 5.3)) + jp * j.z,
    );
  }

  /** Second derivatives of roll / pitch / heave from the last frames (low-passed: frame timing is jittery). */
  private derivatives(dt: number) {
    const p = this.prev;
    if (dt <= 0) return;
    const vr = (this.roll - p.roll) / dt, vp = (this.pitch - p.pitch) / dt, vh = (this.heave - p.heave) / dt;
    if (p.n >= 2) {
      const h = (dt + p.dt) / 2;
      this.rollAcc = damp(this.rollAcc, (vr - p.vr) / h, 6, dt);
      this.pitchAcc = damp(this.pitchAcc, (vp - p.vp) / h, 6, dt);
      this.heaveAcc = damp(this.heaveAcc, (vh - p.vh) / h, 6, dt);
    }
    p.roll = this.roll; p.pitch = this.pitch; p.heave = this.heave; p.vr = vr; p.vp = vp; p.vh = vh; p.dt = dt; p.n++;
  }

  /**
   * Effective gravity in the cabin frame at a point p (cabin/world coordinates, metres):
   * g_eff = R_shipᵀ·g − a_p, where a_p is the inertial acceleration of that point as the ship rolls/pitches about
   * ROLL_CENTRE (the envelope above the gondola), heaves and is buffeted. Small-angle: a_p ≈ α × (p − C) + ḧ·ŷ.
   */
  gEff(p: THREE.Vector3, out: THREE.Vector3) {
    // gravity seen from the tilted cabin
    this.q.setFromEuler(this.e.set(-this.pitch, 0, -this.roll, 'ZXY'));
    out.set(0, -G, 0).applyQuaternion(this.q);
    const rx = p.x - ROLL_CENTRE.x, ry = p.y - ROLL_CENTRE.y, rz = p.z - ROLL_CENTRE.z;
    // α = (pitchAcc, 0, rollAcc); α × r
    const ax = this.pitchAcc, az = this.rollAcc;
    const cx = -az * ry, cy = az * rx - ax * rz, cz = ax * ry;
    out.x -= cx + this.buffet.x;
    out.y -= cy + this.heaveAcc + this.buffet.y;
    out.z -= cz + this.buffet.z;
    return out;
  }

  /** Rotation of the outside world as seen from the cabin (the inverse of the ship's attitude). */
  worldQuat(out = new THREE.Quaternion()) {
    return out.setFromEuler(new THREE.Euler(-this.pitch, 0, -this.roll, 'ZXY'));
  }
}
