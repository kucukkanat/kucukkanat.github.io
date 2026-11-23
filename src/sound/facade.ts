// Tiny always-loaded front for the sound engine. The engine (./engine.ts) is a separate chunk,
// imported only when the visitor turns sound on — the first view never pays for it.
import type { SoundEngine, Mode } from './engine';

const KEY = 'kk-sound';

class Sound {
  private eng: SoundEngine | null = null;
  private loading: Promise<SoundEngine | null> | null = null;
  private night = 0; private storm = false; private focus = false; private ducked = false;
  mode: Mode = 'off';

  constructor() {
    try {
      const v = localStorage.getItem(KEY);
      // 'on' was the old boolean setting
      this.mode = v === 'ambient' || v === 'full' ? v : v === 'on' ? 'full' : 'off';
    } catch { /* private mode */ }
  }

  get enabled() { return this.mode !== 'off'; }
  /** Old boolean API: kept so callers don't change. On → full. */
  set enabled(on: boolean) { this.mode = on ? (this.mode === 'off' ? 'full' : this.mode) : 'off'; }

  private load(): Promise<SoundEngine | null> {
    if (this.eng) return Promise.resolve(this.eng);
    this.loading ??= import('./engine').then(m => {
      try {
        this.eng = new m.SoundEngine();
        this.eng.setNight(this.night); this.eng.setStorm(this.storm); this.eng.setFocus(this.focus); this.eng.duck(this.ducked); this.eng.setBelow(this.below);
      } catch { this.eng = null; }
      return this.eng;
    }).catch(() => null);
    return this.loading;
  }

  /** Must be called from a user gesture. */
  async setMode(m: Mode) {
    this.mode = m;
    try { localStorage.setItem(KEY, m); } catch { /* ignore */ }
    if (m === 'off') { await this.eng?.stop(); return; }
    const e = await this.load();
    if (e && this.mode !== 'off') await e.start(this.mode);
  }
  /** Off → ambient → full → off. */
  nextMode(): Mode { return this.mode === 'off' ? 'ambient' : this.mode === 'ambient' ? 'full' : 'off'; }
  async setEnabled(on: boolean) { await this.setMode(on ? 'full' : 'off'); }

  // context (cheap; remembered until the engine exists)
  setNight(k: number) { if (k === this.night) return; this.night = k; this.eng?.setNight(k); }
  setStorm(on: boolean) { this.storm = on; this.eng?.setStorm(on); }
  // called every frame by the app: only changes reach the engine (no per-frame audio automation)
  setFocus(close: boolean) { if (close === this.focus) return; this.focus = close; this.eng?.setFocus(close); }
  private below = false;
  /** Below deck: muffled weather (library/deck.ts). */
  setBelow(on: boolean) { if (on === this.below) return; this.below = on; this.eng?.setBelow(on); }
  duck(on: boolean) { if (on === this.ducked) return; this.ducked = on; this.eng?.duck(on); }
  /** Ship roll in radians, every frame (creaks follow the motion). No-op while sound is off. */
  roll(r: number) { if (this.mode !== 'off') this.eng?.feedRoll(r); }

  // one-shots: silent unless the engine is running in full mode
  private fx(f: (e: SoundEngine) => void) { if (this.mode === 'full' && this.eng) f(this.eng); }
  tick(pitch = 1) { this.fx(e => e.tick(pitch)); }
  /** A syllable of the Librarian's speech. */
  blip() { this.fx(e => e.blip()); }
  click() { this.fx(e => e.click()); }
  chunk() { this.fx(e => e.chunk()); }
  chime() { this.fx(e => e.chime()); }
  whoosh() { this.fx(e => e.whoosh()); }
  paper() { this.fx(e => e.paper()); }
  wood() { this.fx(e => e.wood()); }
  brass() { this.fx(e => e.brass()); }
  creak() { this.fx(e => e.creak()); }
  thunder(delay?: number) { if (this.mode !== 'off') this.eng?.thunder(delay); }
  bell(gain?: number, delay?: number) { if (this.mode !== 'off') this.eng?.bell(gain, delay); }
  /** A sky whale's call (ambient and full modes). */
  whale(species: string, gain?: number, pan?: number) { if (this.mode !== 'off') this.eng?.whale(species, gain, pan); }
}

export const audio = new Sound();
export type { Mode };
