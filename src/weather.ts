// Ring the ship's bell three times → a storm rolls in. Ring three times again (or wait a minute) → it calms.
import type { Lighting } from './lighting';
import { uTime } from './lighting';
import type { Sky } from './sky';
import type { CameraRig } from './camera';
import { audio } from './audio';
import { damp, reducedMotion } from './anim';

const RING_WINDOW = 4;   // seconds for three rings
const STORM_LENGTH = 60; // seconds until it calms by itself

export class Weather {
  storm = false;
  k = 0;
  private rings: number[] = [];
  private t = 0;
  private stormStart = 0;
  private nextFlash = 0;
  private flashStart = -1;
  private busy = false;

  constructor(private lighting: Lighting, private sky: Sky, _rig: CameraRig,
    private hooks: { announce(text: string): void; changed?(storm: boolean): void }) {}

  /** A bell ring at the current time; returns true if it changed the weather. */
  ring(): boolean {
    const now = this.t;
    this.rings = this.rings.filter(r => now - r < RING_WINDOW);
    this.rings.push(now);
    if (this.rings.length >= 3) {
      this.rings = [];
      void this.set(!this.storm);
      return true;
    }
    return false;
  }

  async set(on: boolean) {
    if (this.busy || on === this.storm) return;
    if (on) {
      this.busy = true;
      await this.sky.loadStorm(); // usually preloaded after the first frame
      this.busy = false;
    }
    this.storm = on;
    this.stormStart = this.t;
    this.nextFlash = this.t + 2.5;
    audio.setStorm(on);
    this.hooks.announce(on ? 'A storm rolls in. Ring the bell three times to calm it.' : 'The storm passes.');
    this.hooks.changed?.(on);
  }

  update(t: number, dt: number) {
    this.t = t;
    if (!reducedMotion) uTime.value = t;
    if (this.storm && t - this.stormStart > STORM_LENGTH) void this.set(false);
    const target = this.storm ? 1 : 0;
    const prev = this.k;
    this.k = reducedMotion ? target : damp(this.k, target, 0.9, dt);
    if (Math.abs(this.k - target) < 0.002) this.k = target;
    // lightning: a double flicker every 6–14 s (never under reduced motion)
    let flash = 0;
    if (this.storm && !reducedMotion && this.k > 0.6) {
      if (this.flashStart < 0 && t >= this.nextFlash) { this.flashStart = t; audio.thunder(0.5 + Math.random() * 1.2); }
      if (this.flashStart >= 0) {
        const x = t - this.flashStart;
        flash = Math.max(0, 1 - x / 0.07) * 0.9 + (x > 0.16 ? Math.max(0, 1 - (x - 0.16) / 0.18) * 0.6 : 0);
        if (x > 0.4) { this.flashStart = -1; this.nextFlash = t + 6 + Math.random() * 8; flash = 0; }
      }
    }
    if (this.k !== prev || flash > 0 || this.lastFlash > 0) {
      this.lighting.setStorm(this.k);
      this.lighting.setFlash(flash);
    }
    this.lastFlash = flash;
  }
  private lastFlash = 0;

  /** True while the weather is still changing or flashing (for the reduced-motion render gate). */
  get active() { return this.k !== (this.storm ? 1 : 0) || this.lastFlash > 0; }
}
