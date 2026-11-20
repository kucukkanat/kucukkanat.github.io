// Tiny tween system driven by the render loop.
export const reducedMotion = (() => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
})();

export const ease = {
  linear: (t: number) => t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  outBack: (t: number) => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};

interface Tween { t0: number; dur: number; fn: (k: number) => void; ease: (t: number) => number; done: () => void; key?: string; }
const tweens: Tween[] = [];
let now = 0;

/** Animate k from 0 to 1 over `dur` seconds. Same `key` cancels the previous tween (its promise still resolves). */
export function tween(dur: number, fn: (k: number) => void, opts: { ease?: (t: number) => number; key?: string } = {}): Promise<void> {
  if (opts.key) {
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].key === opts.key) { tweens[i].done(); tweens.splice(i, 1); }
  }
  return new Promise(resolve => {
    if (dur <= 0) { fn(1); resolve(); return; }
    tweens.push({ t0: now, dur, fn, ease: opts.ease ?? ease.inOutCubic, done: resolve, key: opts.key });
    fn(0);
  });
}

export function wait(sec: number): Promise<void> {
  return tween(sec, () => {});
}

export function tweensActive(): boolean { return tweens.length > 0; }

export function updateTweens(time: number) {
  now = time;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (tw.t0 > time) tw.t0 = time;
    const k = Math.min(1, (time - tw.t0) / tw.dur);
    tw.fn(tw.ease(k));
    if (k >= 1) { tweens.splice(i, 1); tw.done(); }
  }
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
