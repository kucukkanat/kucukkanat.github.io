// A whale's genome: everything a seed decides. The body mesh is one of the Blender-built species; the individual
// (size, proportions, skin) and its whole ecosystem are grown from the seed at runtime.
import { RNG } from './rng';
import { BIOMES, BIOME_KEYS, HOME_BIOME, type Biome } from './biomes';

export const SPECIES = ['blue', 'sperm', 'beluga', 'humpback', 'bowhead', 'minke'] as const;
export type SpeciesKey = typeof SPECIES[number];

export interface SkinGenes {
  /** Multiplies the painted skin (hue / value drift of this individual). */
  tint: [number, number, number];
  mottle: number; scars: number; barnacles: number; moss: number; countershade: number;
  /** Pale patch colour (belly blotches, chin, fluke undersides). */
  patch: [number, number, number]; patchAmount: number;
  seed: number;
}

export interface Genome {
  seed: string; species: SpeciesKey; biome: Biome;
  /** A given name for this individual. */
  name: string;
  size: number; girth: number; flipper: number; fluke: number; head: number;
  /** Swim tempo multiplier. */
  tempo: number;
  skin: SkinGenes;
  /** Seed of the island layout. */
  ecoSeed: number;
  cloud: boolean;
}

const SYL_A = ['O', 'Lu', 'Ma', 'Ke', 'Na', 'Ti', 'A', 'Su', 'Ru', 'Mo', 'Ha', 'I', 'Ya', 'Bo', 'Se', 'Ko', 'El', 'Pa'];
const SYL_B = ['ru', 'na', 'li', 'mo', 'ka', 'shi', 'la', 'ren', 'vi', 'to', 'mi', 'nu', 'ha', 'lo', 'ri', 'sa'];
const SYL_C = ['', '', 'n', 'a', 'ko', 'el', 'is', 'mar', 'wen', 'o', 'ra'];

function hueShift(c: [number, number, number], deg: number): [number, number, number] {
  // rotate around the grey axis (cheap hue rotation in linear-ish RGB)
  const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), k = (1 - cs) / 3, s = sn / Math.sqrt(3);
  const [r, g, b] = c;
  return [r * (cs + k) + g * (k - s) + b * (k + s), r * (k + s) + g * (cs + k) + b * (k - s), r * (k - s) + g * (k + s) + b * (cs + k)];
}

export interface GenomeOverrides { species?: string | null; biome?: string | null }

/** The classic lineup: a species on its home biome, with a fixed seed. */
export const classicSeed = (species: string) => `classic-${species}`;

export function makeGenome(seed: string, over: GenomeOverrides = {}): Genome {
  const rng = new RNG(`whale:${seed}`);
  const classic = seed.startsWith('classic-') ? seed.slice(8) : null;
  let species = rng.pick(SPECIES) as SpeciesKey;
  let biomeKey = rng.pick(BIOME_KEYS);
  if (classic && (SPECIES as readonly string[]).includes(classic)) { species = classic as SpeciesKey; biomeKey = HOME_BIOME[classic]; }
  if (over.species && (SPECIES as readonly string[]).includes(over.species)) species = over.species as SpeciesKey;
  if (over.biome && BIOMES[over.biome]) biomeKey = over.biome;
  const g = rng.fork('body'), s = rng.fork('skin'), n = rng.fork('name');
  const val = 1 + s.bell() * 0.13;
  const tint = hueShift([val, val, val], 0).map((v, i) => v * (1 + s.bell() * 0.06 * (i === 1 ? 0.5 : 1))) as [number, number, number];
  const warm = s.bell() * 0.07;
  tint[0] *= 1 + warm; tint[2] *= 1 - warm;
  const pale = 0.82 + s.f() * 0.16;
  return {
    seed, species, biome: BIOMES[biomeKey],
    name: n.pick(SYL_A) + n.pick(SYL_B) + n.pick(SYL_C),
    size: 1 + g.bell() * 0.14, girth: 1 + g.bell() * 0.07, flipper: 1 + g.bell() * 0.13, fluke: 1 + g.bell() * 0.11,
    head: 1 + g.bell() * 0.04, tempo: 1 + g.bell() * 0.12,
    skin: {
      tint, mottle: s.range(0.15, 0.9), scars: s.range(0, 1) ** 1.6, barnacles: s.range(0, 1) ** 1.3,
      moss: s.range(0.35, 1), countershade: s.range(0.1, 0.6),
      patch: [pale, pale * (0.96 + s.f() * 0.04), pale * (0.9 + s.f() * 0.1)], patchAmount: s.range(0, 1) ** 2,
      seed: s.range(0, 100),
    },
    ecoSeed: rng.fork('eco').int(1, 2 ** 30),
    cloud: rng.fork('cloud').chance(BIOMES[biomeKey].cloud),
  };
}

/** Today's pod: six seeds, the same for every visitor on a (UTC) day. Every species swims, each on its own biome. */
export function dailyPod(date = new Date(), n = 6): Genome[] {
  const day = date.toISOString().slice(0, 10);
  const rng = new RNG(`pod:${day}`);
  const species = rng.shuffle(SPECIES), biomes = rng.shuffle(BIOME_KEYS);
  return Array.from({ length: n }, (_, i) =>
    makeGenome(`${day}-${i + 1}`, { species: species[i % species.length], biome: biomes[i % biomes.length] }));
}

/** A fresh, short, pronounceable seed for the "new whale" button. */
export function randomSeed(): string {
  const r = new RNG((Math.random() * 2 ** 32) >>> 0);
  return (r.pick(SYL_A) + r.pick(SYL_B) + '-' + r.int(100, 999)).toLowerCase();
}
