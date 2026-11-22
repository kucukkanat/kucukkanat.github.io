// Seeded randomness and value noise for the procedural whales (same seed -> same whale, on every machine).

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return h >>> 0;
}

export class RNG {
  private a: number;
  constructor(seed: number | string) { this.a = (typeof seed === 'string' ? hashStr(seed) : seed >>> 0) || 1; }
  /** [0, 1) */
  f(): number {
    let t = (this.a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) { return a + (b - a) * this.f(); }
  /** integer in [a, b] */
  int(a: number, b: number) { return a + Math.floor(this.f() * (b - a + 1)); }
  chance(p: number) { return this.f() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.f() * arr.length)]; }
  /** signed, roughly normal in [-1, 1] */
  bell() { return (this.f() + this.f() + this.f()) * 2 / 3 - 1; }
  shuffle<T>(arr: readonly T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.f() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  /** An independent stream, so adding draws to one system doesn't reshuffle another. */
  fork(label: string) { return new RNG(hashStr(label) ^ Math.imul(this.a, 2654435761)); }
}

function h2(ix: number, iy: number, seed: number) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function vnoise(x: number, y: number, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, seed), b = h2(ix + 1, iy, seed), c = h2(ix, iy + 1, seed), d = h2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm(x: number, y: number, seed = 0, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y, seed + i * 17); n += a; x *= 2.03; y *= 2.03; a *= 0.5; }
  return s / n;
}
