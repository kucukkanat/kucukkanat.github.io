// Procedural soundscape for the cabin (WebAudio only — no audio files).
// Loaded lazily by ./facade.ts the first time the visitor turns sound on, so it costs nothing on first view.
//
// Graph:   wind/rain/creaks ─┐                         ┌─ dry ─────────────┐
//                            ├─ amb (focus lowpass) ─┐  │                   ├─ limiter ─ master ─ out
//          generative music ─┼─ music ───────────────┼─ mix ─ reverb send ─┘
//          interaction fx  ──┴─ fx ──────────────────┘
// All motion is AudioParam automation scheduled ahead of time; JS only runs a 4 Hz control tick.

export type Mode = 'off' | 'ambient' | 'full';
type Mood = 'sunset' | 'night' | 'storm';

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[(Math.random() * xs.length) | 0];

export class SoundEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private amb: GainNode; private ambLP: BiquadFilterNode;
  private music: GainNode; private fx: GainNode;
  private reverbSend: GainNode;
  private pink: AudioBuffer; private brown: AudioBuffer; private drops: AudioBuffer;
  // wind layers
  private rumbleG!: GainNode; private whooshG!: GainNode; private whooshBP!: BiquadFilterNode;
  private whistleG!: GainNode; private whistleBP!: BiquadFilterNode;
  private rainG!: GainNode; private dropsG!: GainNode;
  private droneG!: GainNode;
  // state
  private mode: Mode = 'full';
  private mood: Mood = 'sunset';
  private night = 0; private storm = 0;
  private gust = 0; private gustTarget = 0; private nextGust = 0;
  private timer = 0;
  private nextNote = 0; private degree = 7; private phraseLeft = 0;
  private lastRoll = 0; private lastRollVel = 0; private nextCreakOk = 0;
  private ownRollT = 0;
  private bellSlot = -1;
  private focus = false; private ducked = false; private below = false; private lastBlip = 0;

  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = this.ctx = new AC({ latencyHint: 'playback' });
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -20; limiter.knee.value = 12; limiter.ratio.value = 4; limiter.attack.value = 0.01; limiter.release.value = 0.4;
    this.master = ctx.createGain(); this.master.gain.value = 0;
    limiter.connect(this.master).connect(ctx.destination);

    const mix = ctx.createGain();
    mix.connect(limiter);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.22;
    const verb = ctx.createConvolver(); verb.buffer = this.impulse(1.3);
    mix.connect(this.reverbSend).connect(verb).connect(limiter);

    this.ambLP = ctx.createBiquadFilter(); this.ambLP.type = 'lowpass'; this.ambLP.frequency.value = 16000; this.ambLP.Q.value = 0.3;
    this.amb = ctx.createGain(); this.amb.gain.value = 0.9;
    this.amb.connect(this.ambLP).connect(mix);
    this.music = ctx.createGain(); this.music.gain.value = 0.5; this.music.connect(mix);
    this.fx = ctx.createGain(); this.fx.gain.value = 0.9; this.fx.connect(mix);

    this.pink = this.noise(8, 'pink');
    this.brown = this.noise(6, 'brown');
    this.drops = this.dropletBuffer(3);
    this.buildAmbience();
  }

  // ---------- lifecycle ----------

  async start(mode: Mode) {
    this.setMode(mode);
    await this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(0.75, t + 3); // gentle 3 s fade-in
    if (!this.timer) this.timer = window.setInterval(() => this.control(), 250);
    document.addEventListener('visibilitychange', this.onVis);
  }

  async stop() {
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.25);
    clearInterval(this.timer); this.timer = 0;
    document.removeEventListener('visibilitychange', this.onVis);
    await new Promise(r => setTimeout(r, 900));
    if (!this.timer) await this.ctx.suspend();
  }

  private onVis = () => {
    if (document.visibilityState === 'hidden') void this.ctx.suspend();
    else if (this.timer) void this.ctx.resume();
  };

  setMode(m: Mode) {
    this.mode = m;
    const t = this.ctx.currentTime;
    this.fx.gain.setTargetAtTime(m === 'full' ? 0.9 : 0, t, 0.2);
  }

  /** 0 = sunset, 1 = night. */
  setNight(k: number) { this.night = k; this.updateMood(); }
  setStorm(on: boolean) { this.storm = on ? 1 : 0; this.updateMood(); if (on) this.gustTarget = 1; }
  /** Below deck (the library): the wind and rain come through the hull, low and muffled. */
  setBelow(on: boolean) { this.below = on; this.mixAmb(); }
  /** Close-up views muffle the wind a little; the overview opens it up. */
  setFocus(close: boolean) { this.focus = close; this.mixAmb(); }
  /** A game is playing in the handheld: step back. */
  duck(on: boolean) {
    this.ducked = on; this.mixAmb();
    this.music.gain.setTargetAtTime(on ? 0.08 : 0.5, this.ctx.currentTime, 0.6);
  }
  /** Ship roll in radians (fed each frame by the app); creaks happen when the roll turns around. */
  setRoll(roll: number) {
    const vel = roll - this.lastRoll;
    if (Math.sign(vel) !== Math.sign(this.lastRollVel) && Math.abs(roll) > 0.004) this.rollTurned(Math.abs(roll));
    this.lastRoll = roll; this.lastRollVel = vel || this.lastRollVel;
  }

  private updateMood() {
    this.mood = this.storm > 0.5 ? 'storm' : this.night > 0.5 ? 'night' : 'sunset';
    const t = this.ctx.currentTime;
    this.rainG.gain.setTargetAtTime(this.storm * 0.22, t, 1.5);
    this.dropsG.gain.setTargetAtTime(this.storm * 0.35, t, 1.5);
    this.droneG.gain.setTargetAtTime(this.mood === 'storm' ? 0.05 : this.mood === 'night' ? 0.018 : 0, t, 3);
  }

  private mixAmb() {
    const t = this.ctx.currentTime;
    this.ambLP.frequency.setTargetAtTime(this.below ? 700 : this.focus ? 2600 : 16000, t, 0.5);
    this.amb.gain.setTargetAtTime((this.ducked ? 0.25 : 1) * (this.below ? 0.55 : this.focus ? 0.7 : 0.9), t, 0.6);
  }

  // ---------- buffers ----------

  private noise(seconds: number, kind: 'pink' | 'brown'): AudioBuffer {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') { // Paul Kellet's refined pink filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
      }
    }
    // crossfade the loop seam so it never clicks
    const f = Math.min(2048, n >> 3);
    for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); }
    return buf;
  }

  /** Raindrops on the glass: sparse tiny resonant ticks, looped. */
  private dropletBuffer(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let k = 0; k < seconds * 26; k++) {
        const at = Math.floor(Math.random() * (n - 800)), f = rand(2500, 6000), amp = rand(0.05, 0.25);
        for (let i = 0; i < 700; i++) d[at + i] += Math.sin((2 * Math.PI * f * i) / sr) * amp * Math.exp(-i / 90);
      }
    }
    return buf;
  }

  /** A small wooden room: stereo noise with an exponential, darkening tail. */
  private impulse(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate, n = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, k = 0.35 + 0.6 * t; // later = darker
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * Math.pow(1 - t, 3.2) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
      }
    }
    return buf;
  }

  private loop(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration); // random phase: two layers never line up
    return s;
  }

  // ---------- ambience ----------

  private buildAmbience() {
    const c = this.ctx;
    // 1. low rumble of the hull in the air
    this.rumbleG = c.createGain(); this.rumbleG.gain.value = 0.25;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
    this.loop(this.brown, 0.9).connect(lp).connect(this.rumbleG).connect(this.amb);
    // 2. mid whoosh: two pink layers at slightly different speeds → no audible loop
    this.whooshBP = c.createBiquadFilter(); this.whooshBP.type = 'bandpass'; this.whooshBP.frequency.value = 650; this.whooshBP.Q.value = 0.7;
    this.whooshG = c.createGain(); this.whooshG.gain.value = 0.12;
    const pan = c.createStereoPanner();
    this.loop(this.pink, 0.97).connect(this.whooshBP);
    this.loop(this.pink, 1.031).connect(this.whooshBP);
    this.whooshBP.connect(this.whooshG).connect(pan).connect(this.amb);
    // 3. whistle in the rigging: only on strong gusts
    this.whistleBP = c.createBiquadFilter(); this.whistleBP.type = 'bandpass'; this.whistleBP.frequency.value = 1500; this.whistleBP.Q.value = 14;
    this.whistleG = c.createGain(); this.whistleG.gain.value = 0;
    this.loop(this.pink, 1.12).connect(this.whistleBP).connect(this.whistleG).connect(this.amb);
    // rain (storm only)
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const rlp = c.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 7500;
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    this.loop(this.pink, 1.4).connect(hp).connect(rlp).connect(this.rainG).connect(this.amb);
    this.dropsG = c.createGain(); this.dropsG.gain.value = 0;
    this.loop(this.drops).connect(this.dropsG).connect(this.amb);
    // drone pad (night: faint; storm: low and present) — two detuned sines through a slow filter
    this.droneG = c.createGain(); this.droneG.gain.value = 0;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 400;
    for (const f of [73.42, 110.2, 73.6]) { const o = c.createOscillator(); o.frequency.value = f; o.connect(dlp); o.start(); }
    dlp.connect(this.droneG).connect(this.music);
  }

  // ---------- 4 Hz control: weather, gusts, music, bells ----------

  private control() {
    const c = this.ctx, t = c.currentTime;
    // gusts: random arrivals; each swells over seconds and dies away
    if (t > this.nextGust) {
      const strong = this.storm ? rand(0.6, 1) : Math.random() < 0.25 ? rand(0.5, 0.8) : rand(0.15, 0.45);
      this.gustTarget = strong;
      this.nextGust = t + (this.storm ? rand(3, 8) : rand(7, 22));
    }
    const rise = this.gustTarget > this.gust ? 0.06 : 0.025;
    this.gust += (this.gustTarget - this.gust) * rise;
    if (Math.abs(this.gustTarget - this.gust) < 0.02) this.gustTarget = this.storm ? rand(0.35, 0.6) : rand(0.05, 0.2);
    const base = this.storm ? 0.55 : this.night > 0.5 ? 0.12 : 0.2;
    const w = Math.min(1, base + this.gust * 0.6);
    const tc = 0.35;
    this.rumbleG.gain.setTargetAtTime(0.18 + w * 0.32, t, tc);
    this.whooshG.gain.setTargetAtTime(0.05 + w * w * 0.32, t, tc);
    this.whooshBP.frequency.setTargetAtTime(380 + w * 1100, t, tc * 1.5);
    const whistle = Math.max(0, w - 0.55) * 1.8;
    this.whistleG.gain.setTargetAtTime(whistle * 0.09, t, tc);
    this.whistleBP.frequency.setTargetAtTime(1200 + w * 1500 + Math.sin(t * 0.7) * 120, t, tc * 2);

    // no app roll? use a slow internal swell so creaks still happen
    this.ownRollT += 0.25;
    if (performance.now() - this.lastRollFeed > 2000) this.setRollInternal();

    this.playMusic(t);
    this.shipBells();
  }

  private lastRollFeed = 0;
  private setRollInternal() {
    const amp = this.storm ? 0.06 : 0.01;
    const roll = amp * (Math.sin(this.ownRollT * 0.75) + 0.4 * Math.sin(this.ownRollT * 0.31));
    const vel = roll - this.lastRoll;
    if (Math.sign(vel) !== Math.sign(this.lastRollVel) && Math.abs(roll) > 0.004) this.rollTurned(Math.abs(roll));
    this.lastRoll = roll; this.lastRollVel = vel || this.lastRollVel;
  }
  /** Called by the app each frame with the ship's roll. */
  feedRoll(roll: number) { this.lastRollFeed = performance.now(); this.setRoll(roll); }

  // ---------- creaks ----------

  private rollTurned(amount: number) {
    const t = this.ctx.currentTime;
    if (t < this.nextCreakOk) return;
    const chance = this.storm ? 0.85 : 0.35;
    if (Math.random() > chance) return;
    this.nextCreakOk = t + (this.storm ? rand(0.8, 2) : rand(3, 7));
    this.creak(Math.min(1, amount * (this.storm ? 10 : 40)));
  }

  /** Wood creak: stick-slip impulse train through a pair of resonances — not a buzzing oscillator. */
  creak(strength = 0.6) {
    const c = this.ctx, sr = c.sampleRate;
    const dur = rand(0.35, 0.9), n = Math.floor(sr * dur);
    const buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0);
    let pos = 0;
    const r0 = rand(25, 45), r1 = rand(50, 110); // impulses per second: speeds up then slows
    while (pos < n) {
      const k = pos / n, rate = r0 + (r1 - r0) * Math.sin(Math.PI * k);
      const env = Math.sin(Math.PI * k) ** 0.7;
      const len = Math.floor(rand(30, 120));
      const amp = env * rand(0.4, 1);
      for (let i = 0; i < len && pos + i < n; i++) d[pos + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / 18);
      pos += Math.floor(sr / rate * rand(0.6, 1.4));
    }
    const s = c.createBufferSource(); s.buffer = buf;
    const f = rand(320, 620);
    const bp1 = c.createBiquadFilter(); bp1.type = 'bandpass'; bp1.Q.value = 9; bp1.frequency.value = f;
    const bp2 = c.createBiquadFilter(); bp2.type = 'bandpass'; bp2.Q.value = 7; bp2.frequency.value = f * 2.31;
    const t = c.currentTime;
    bp1.frequency.setValueAtTime(f, t); bp1.frequency.linearRampToValueAtTime(f * rand(0.8, 1.25), t + dur);
    const g = c.createGain(); g.gain.value = 0.22 * strength;
    const g2 = c.createGain(); g2.gain.value = 0.5;
    const pan = c.createStereoPanner(); pan.pan.value = rand(-0.8, 0.8);
    s.connect(bp1).connect(g); s.connect(bp2).connect(g2).connect(g);
    g.connect(pan).connect(this.amb);
    s.start();
  }

  // ---------- generative music ----------

  private scale(): number[] {
    // D-based pentatonics: sunset major, night minor; storm uses low minor fragments
    const root = 146.83; // D3
    const major = [0, 2, 4, 7, 9], minor = [0, 3, 5, 7, 10];
    const steps = this.mood === 'sunset' ? major : minor;
    const out: number[] = [];
    for (let oct = 0; oct < 3; oct++) for (const s of steps) out.push(root * 2 ** oct * 2 ** (s / 12));
    return out;
  }

  private playMusic(t: number) {
    if (t < this.nextNote) return;
    const notes = this.scale();
    if (this.phraseLeft <= 0) {
      // rest between phrases, then a new phrase of 3–6 notes
      this.phraseLeft = (rand(3, 7)) | 0;
      this.nextNote = t + (this.mood === 'storm' ? rand(9, 16) : rand(5, 12));
      if (this.mood === 'storm') this.degree = (rand(0, 5)) | 0; // low register in the storm
      return;
    }
    this.degree = Math.max(0, Math.min(notes.length - 1, this.degree + pick([-2, -1, -1, 1, 1, 2, 0])));
    const f = notes[this.degree];
    const vel = rand(0.5, 1) * (this.mood === 'night' ? 0.7 : 1);
    this.pluck(f, vel, t + 0.02);
    if (Math.random() < 0.18) this.pluck(f * 1.5, vel * 0.5, t + 0.02); // an occasional fifth
    this.phraseLeft--;
    const tempo = this.mood === 'night' ? rand(0.9, 1.6) : this.mood === 'storm' ? rand(1.4, 2.4) : rand(0.55, 1.1);
    this.nextNote = t + tempo;
  }

  /** Kalimba-like pluck: FM with a fast-decaying modulation index. */
  private pluck(f: number, vel: number, at: number) {
    const c = this.ctx;
    const car = c.createOscillator(); car.frequency.value = f;
    const mod = c.createOscillator(); mod.frequency.value = f * 3.5;
    const idx = c.createGain(); idx.gain.setValueAtTime(f * 1.6, at); idx.gain.exponentialRampToValueAtTime(f * 0.01, at + 0.25);
    mod.connect(idx).connect(car.frequency);
    const g = c.createGain();
    const dur = rand(1.6, 3);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.09 * vel, at + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const pan = c.createStereoPanner(); pan.pan.value = rand(-0.4, 0.4);
    car.connect(g).connect(pan).connect(this.music);
    car.start(at); mod.start(at); car.stop(at + dur + 0.05); mod.stop(at + dur + 0.05);
  }

  // ---------- ship's bells (on the half hour, by the watch) ----------

  private shipBells() {
    const d = new Date();
    const slot = d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);
    const onMark = (d.getMinutes() === 0 || d.getMinutes() === 30) && d.getSeconds() < 2;
    if (this.bellSlot < 0) { this.bellSlot = slot; return; } // don't ring the moment sound turns on
    if (!onMark || slot === this.bellSlot) return;
    this.bellSlot = slot;
    const strikes = slot % 8 || 8; // 1–8 bells per four-hour watch
    let at = 0.2;
    for (let i = 0; i < strikes; i++) {
      this.bell(0.22, at);
      at += i % 2 === 0 ? 0.45 : 1.1; // struck in pairs: ding-ding … ding-ding
    }
  }

  // ---------- interaction sounds ----------

  private env(node: AudioNode, at: number, peak: number, decay: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    node.connect(g); return g;
  }

  private burst(at: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, out: AudioNode = this.fx) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.pink;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); this.env(f, at, peak, dur).connect(out);
    s.start(at, Math.random() * 6); s.stop(at + dur + 0.05);
  }

  /** Soft wooden tick (hover, small UI). */
  /** One syllable of the Librarian's speech (no voice): a short, warm, quiet tone of slightly varied pitch. */
  blip() {
    const c = this.ctx, t = c.currentTime;
    if (t - this.lastBlip < 0.05) return;
    this.lastBlip = t;
    const o = c.createOscillator(), f = c.createBiquadFilter();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140 + Math.random() * 70, t);
    o.frequency.exponentialRampToValueAtTime(110 + Math.random() * 40, t + 0.08);
    f.type = 'lowpass'; f.frequency.value = 900;
    o.connect(f);
    this.env(f, t, 0.06, 0.1).connect(this.fx);
    o.start(t); o.stop(t + 0.12);
  }
  tick(pitch = 1) { this.burst(this.ctx.currentTime, 0.035, 'bandpass', 2400 * pitch, 5, 0.25); }
  /** Plastic click (pick up a cartridge, buttons). */
  click() {
    const t = this.ctx.currentTime;
    this.burst(t, 0.012, 'highpass', 3500, 0.7, 0.35);
    this.burst(t + 0.018, 0.02, 'bandpass', 2100, 6, 0.25);
  }
  /** Cartridge seated in the handheld: plastic slide + low thump. */
  chunk() {
    const c = this.ctx, t = c.currentTime;
    this.burst(t, 0.08, 'bandpass', 1800, 2, 0.18);
    const o = c.createOscillator(); o.frequency.setValueAtTime(140, t + 0.07); o.frequency.exponentialRampToValueAtTime(55, t + 0.22);
    this.env(o, t + 0.07, 0.5, 0.24).connect(this.fx); o.start(t + 0.07); o.stop(t + 0.35);
    this.burst(t + 0.07, 0.03, 'highpass', 3000, 0.7, 0.3);
  }
  /** Handheld boot: warm bell-like three-note rise. */
  chime() {
    const t = this.ctx.currentTime;
    [587.33, 739.99, 880].forEach((f, i) => this.pluckTo(f, 0.7, t + 0.1 + i * 0.13, this.fx));
  }
  private pluckTo(f: number, vel: number, at: number, out: AudioNode) {
    const prev = this.music; this.music = out as GainNode; this.pluck(f, vel, at); this.music = prev;
  }
  /** Camera glide: a soft air movement. */
  whoosh() {
    const c = this.ctx, t = c.currentTime, s = c.createBufferSource(); s.buffer = this.pink;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(320, t); f.frequency.exponentialRampToValueAtTime(1300, t + 0.35); f.frequency.exponentialRampToValueAtTime(500, t + 0.8);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    s.connect(f).connect(g).connect(this.fx); s.start(t, Math.random() * 6); s.stop(t + 0.9);
  }
  /** Paper: a book or the letter flips. */
  paper() {
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) this.burst(t + i * rand(0.03, 0.07), rand(0.04, 0.09), 'bandpass', rand(2500, 6000), 1.2, rand(0.08, 0.16));
  }
  /** Wood: a drawer, the slate, a book set down. */
  wood() {
    const c = this.ctx, t = c.currentTime, o = c.createOscillator();
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(120, t + 0.12);
    this.env(o, t, 0.35, 0.16).connect(this.fx); o.start(t); o.stop(t + 0.2);
    this.burst(t, 0.06, 'lowpass', 700, 0.7, 0.25);
  }
  /** Brass: clock, compass, lantern. */
  brass() {
    const c = this.ctx, t = c.currentTime;
    for (const [r, a] of [[1, 0.12], [2.76, 0.06], [5.4, 0.03]]) {
      const o = c.createOscillator(); o.frequency.value = 1320 * r;
      this.env(o, t, a, 0.6 / r).connect(this.fx); o.start(t); o.stop(t + 0.7);
    }
  }
  /** Distant thunder: a swelling low rumble with a crack at the front. */
  thunder(delay = 0.6) {
    const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(); s.buffer = this.brown;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(110, t + 4);
    const g = c.createGain(); const dur = rand(3.5, 6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = c.createStereoPanner(); pan.pan.value = rand(-0.6, 0.6);
    s.connect(lp).connect(g).connect(pan).connect(this.amb); s.start(t, Math.random() * 3); s.stop(t + dur + 0.1);
    this.burst(t, 0.25, 'bandpass', 1400, 0.8, 0.12, this.amb);
  }
  /** Ship's bell: inharmonic bronze partials with long, uneven decays. */
  bell(gain = 0.3, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay, f0 = 880;
    const partials: [number, number, number][] = [[0.5, 0.5, 4], [1, 1, 3.2], [1.183, 0.45, 2.4], [1.506, 0.35, 2], [2, 0.3, 1.6], [2.514, 0.2, 1.2], [2.662, 0.15, 1], [3.011, 0.1, 0.8]];
    // the bell is part of the world: it rings in ambient mode too (through the music bus)
    const out = c.createGain(); out.gain.value = gain; out.connect(this.mode === 'full' ? this.fx : this.music);
    for (const [r, a, d] of partials) {
      const o = c.createOscillator(); o.frequency.value = f0 * r * (1 + (Math.random() - 0.5) * 0.003);
      this.env(o, t, a * 0.25, d).connect(out); o.start(t); o.stop(t + d + 0.1);
    }
    this.burst(t, 0.02, 'highpass', 4000, 0.7, 0.2, out); // the strike
  }
  /** A sky whale calling from somewhere outside (species-flavoured, synthesized). gain ~ nearness, pan -1..1. */
  whale(species: string, gain = 0.2, pan = 0) {
    const c = this.ctx, t = c.currentTime + 0.05;
    const out = c.createGain(); out.gain.value = gain * (this.storm ? 0.6 : 1);
    const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan * 0.8));
    // far away and through the hull: soften the top end
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.4;
    out.connect(lp).connect(p).connect(this.amb);
    if (species === 'sperm') {           // click trains, slowing then speeding up
      let at = t;
      for (let i = 0, n = Math.round(rand(9, 16)); i < n; i++) {
        this.burst(at, 0.012, 'bandpass', rand(1800, 2600), 4, 0.5, out);
        at += 0.11 + 0.06 * Math.sin(i / n * Math.PI);
      }
      return;
    }
    if (species === 'beluga') {          // the 'sea canary': quick whistles and chirps
      let at = t;
      for (let i = 0, n = Math.round(rand(3, 6)); i < n; i++) {
        const o = c.createOscillator(); o.type = 'sine';
        const f0 = rand(900, 1500), d = rand(0.12, 0.35);
        o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f0 * rand(1.3, 2.1), at + d * 0.7);
        o.frequency.exponentialRampToValueAtTime(f0 * rand(0.8, 1.1), at + d);
        const g = c.createGain(); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.25, at + 0.03); g.gain.linearRampToValueAtTime(0, at + d);
        o.connect(g).connect(out); o.start(at); o.stop(at + d + 0.05);
        at += d + rand(0.05, 0.25);
      }
      return;
    }
    if (species === 'minke') {           // a pulsed 'boing'
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = rand(1300, 1500);
      const am = c.createOscillator(); am.frequency.value = rand(90, 120);
      const amg = c.createGain(); amg.gain.value = 0.5;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      am.connect(amg).connect(g.gain);
      o.connect(g).connect(out); o.start(t); am.start(t); o.stop(t + 2.3); am.stop(t + 2.3);
      return;
    }
    // moans: blue / bowhead low and slow, humpback a rising-falling song phrase
    const base = species === 'blue' ? rand(70, 90) : species === 'bowhead' ? rand(110, 160) : rand(160, 240);
    const dur = species === 'blue' ? rand(4, 6) : rand(2.4, 3.6);
    const shape: [number, number][] = species === 'humpback'
      ? [[0, 1], [0.35, 1.9], [0.6, 1.4], [1, 0.8]]
      : species === 'bowhead' ? [[0, 1], [0.5, 1.5], [1, 1.1]] : [[0, 1], [0.4, 0.92], [1, 0.78]];
    for (const [h, a] of [[1, 0.5], [2, 0.18], [3, 0.07]] as const) {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * h * shape[0][1], t);
      for (const [k, m] of shape.slice(1)) o.frequency.exponentialRampToValueAtTime(base * h * m, t + k * dur);
      const vib = c.createOscillator(); vib.frequency.value = rand(4, 6);
      const vg = c.createGain(); vg.gain.value = base * h * 0.012;
      vib.connect(vg).connect(o.frequency);
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + dur * 0.25);
      g.gain.setValueAtTime(a, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(out); o.start(t); vib.start(t); o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    }
  }
}
