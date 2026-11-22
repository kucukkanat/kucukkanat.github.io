// The biomes a sky whale can carry. Any biome grows on any species; the layout comes from the seed (genome.ts).
export type TreeKind = 'round' | 'conifer' | 'palm' | 'jungle' | 'mushroom' | 'coral' | 'cactus' | 'dead' | 'willow';
export type ShrubKind = 'bush' | 'fern' | 'reed' | 'shroomlet' | 'anemone' | 'agave';
export type RockKind = 'rock' | 'crystal' | 'basalt' | 'shard';
export type LandmarkKind = 'hut' | 'igloo' | 'pyramid' | 'torii' | 'arch' | 'colonnade' | 'tower' | 'stilt' | 'tent'
  | 'lighthouse' | 'statue' | 'giantTree' | 'stoneCircle' | 'wreck' | 'forge';
export type CritterKind = 'deer' | 'camel' | 'penguin' | 'capybara' | 'fox' | 'crab' | 'frog' | 'salamander' | 'goat';
export type ParticleKind = 'leaves' | 'petals' | 'snow' | 'sand' | 'fireflies' | 'embers' | 'spores' | 'bubbles';
export type LiquidKind = 'water' | 'ice' | 'lava';

export interface ParticleCfg { kind: ParticleKind; color: string; color2: string; count: number; size: number; gravity: number; drag: number }

export interface Biome {
  key: string; label: string; short: string;
  ground: [string, string]; cliff: [string, string]; shore: string; moss: string;
  /** Snow on the heights (0..1). */
  snow?: number;
  liquid: LiquidKind;
  water: { shallow: string; deep: string; foam: string; glow?: number };
  trees: { kind: TreeKind; w: number; foliage: string[]; trunk: string; scale?: number; snow?: boolean }[];
  shrubs: { kind: ShrubKind; w: number; colors: string[] }[];
  rocks: { kind: RockKind; colors: [string, string]; glow?: boolean }[];
  grass: string[]; flowers: string[];
  /** Relative amounts (1 = a temperate forest). */
  density: { trees: number; shrubs: number; grass: number; flowers: number; rocks: number };
  landmarks: LandmarkKind[];
  lanterns: number; boats: number; boulders: number; lilies: number;
  lakes: [number, number]; hills: [number, number]; relief: number;
  /** The lake sits in a crater on top of the tallest hill. */
  crater?: boolean;
  fauna: { birds: { color: string; wing: string; count: number }; fish: string | null; critter: { kind: CritterKind; color: string; color2: string; count: number } | null };
  particles: ParticleCfg;
  /** Glowing fireflies at night. */
  nightFlies?: string;
  /** Chance of a rain cloud of its own. */
  cloud: number;
  /** Stone used by the landmarks. */
  stone: [string, string]; wood: string; roof: string;
}

export const BIOMES: Record<string, Biome> = {
  forest: {
    key: 'forest', label: 'Temperate forest & waterfall lake', short: 'Temperate forest',
    ground: ['#6f9a3a', '#8db448'], cliff: ['#6b4a2f', '#7b7f7a'], shore: '#b8a77a', moss: '#5c8a30', liquid: 'water',
    water: { shallow: '#5fc6d6', deep: '#1f5f7e', foam: '#f2fbff' },
    trees: [{ kind: 'round', w: 3, foliage: ['#4f8a2b', '#6aa53a', '#3e7a2a', '#86b84a'], trunk: '#5a3d26' },
      { kind: 'conifer', w: 1.4, foliage: ['#2f5e33', '#3b6e3a'], trunk: '#5a3d26' }],
    shrubs: [{ kind: 'bush', w: 2, colors: ['#5c8a30', '#74a23c'] }, { kind: 'fern', w: 1, colors: ['#4c8a34'] }, { kind: 'reed', w: 0.4, colors: ['#8aa24a'] }],
    rocks: [{ kind: 'rock', colors: ['#7b7f7a', '#5a5f5c'] }],
    grass: ['#6fa238', '#86b848'], flowers: ['#f4e04a', '#ffffff', '#e86a9a'],
    density: { trees: 1, shrubs: 1, grass: 1, flowers: 1, rocks: 1 },
    landmarks: ['hut', 'giantTree', 'stoneCircle', 'tower'], lanterns: 2, boats: 1, boulders: 2, lilies: 6,
    lakes: [1, 2], hills: [1, 2], relief: 1,
    fauna: { birds: { color: '#f4f1e8', wing: '#5a6a74', count: 12 }, fish: '#e8843a', critter: { kind: 'deer', color: '#a8733f', color2: '#f0e2c8', count: 4 } },
    particles: { kind: 'leaves', color: '#7fb446', color2: '#c8d850', count: 90, size: 0.10, gravity: -0.25, drag: 1.2 },
    nightFlies: '#d8ff7a', cloud: 0.35, stone: ['#8e8c84', '#6a6862'], wood: '#8a5a34', roof: '#9a3a2a',
  },
  desert: {
    key: 'desert', label: 'Desert oasis', short: 'Desert oasis',
    ground: ['#e2c27f', '#d2a55c'], cliff: ['#c08a4a', '#9c5a36'], shore: '#7f9a48', moss: '#a4a04a', liquid: 'water',
    water: { shallow: '#58d4be', deep: '#15706c', foam: '#f4fff8' },
    trees: [{ kind: 'palm', w: 3, foliage: ['#4f9a3a', '#6bb048', '#3f8a30'], trunk: '#8a6a42' },
      { kind: 'cactus', w: 2, foliage: ['#5f8f4a', '#6fa052'], trunk: '#5f8f4a' }],
    shrubs: [{ kind: 'agave', w: 2, colors: ['#7fa05a', '#5f8f4a'] }, { kind: 'bush', w: 0.6, colors: ['#9a9a4a'] }, { kind: 'reed', w: 0.5, colors: ['#8fa648'] }],
    rocks: [{ kind: 'rock', colors: ['#c27a48', '#9c5a36'] }],
    grass: ['#b8a852', '#9aa448'], flowers: ['#ff6a4a', '#ffd04a'],
    density: { trees: 0.45, shrubs: 0.6, grass: 0.3, flowers: 0.3, rocks: 1.5 },
    landmarks: ['arch', 'tent', 'pyramid', 'statue'], lanterns: 1, boats: 0, boulders: 3, lilies: 2,
    lakes: [1, 1], hills: [1, 3], relief: 1.25,
    fauna: { birds: { color: '#3a2c22', wing: '#5a4636', count: 7 }, fish: '#f0c040', critter: { kind: 'camel', color: '#c69a5c', color2: '#8a6238', count: 3 } },
    particles: { kind: 'sand', color: '#e8cf92', color2: '#d6ab68', count: 160, size: 0.05, gravity: -0.05, drag: 0.6 },
    cloud: 0.05, stone: ['#d2a468', '#a8763f'], wood: '#8a6a42', roof: '#b8452e',
  },
  tundra: {
    key: 'tundra', label: 'Snowy pine tundra', short: 'Snowy pine tundra',
    ground: ['#eef4f8', '#dbe7f0'], cliff: ['#9aa7b0', '#6f7a84'], shore: '#cfdde6', moss: '#d5e2ea', snow: 1, liquid: 'ice',
    water: { shallow: '#d2efff', deep: '#6fb4d8', foam: '#ffffff' },
    trees: [{ kind: 'conifer', w: 1, foliage: ['#2c4f45', '#355c50'], trunk: '#4a3a30', snow: true }],
    shrubs: [{ kind: 'bush', w: 1, colors: ['#e2edf4', '#c8dae6'] }],
    rocks: [{ kind: 'rock', colors: ['#6f7a84', '#4e5864'] }, { kind: 'crystal', colors: ['#9fe0ff', '#dff6ff'], glow: true }],
    grass: ['#c6d8e2'], flowers: ['#bfe6ff'],
    density: { trees: 0.8, shrubs: 0.4, grass: 0.15, flowers: 0.1, rocks: 1.4 },
    landmarks: ['igloo', 'stoneCircle', 'tower'], lanterns: 2, boats: 0, boulders: 2, lilies: 0,
    lakes: [1, 2], hills: [1, 2], relief: 1.1,
    fauna: { birds: { color: '#ffffff', wing: '#b8c6d2', count: 8 }, fish: null, critter: { kind: 'penguin', color: '#22282e', color2: '#f6f8fa', count: 6 } },
    particles: { kind: 'snow', color: '#ffffff', color2: '#dff2ff', count: 220, size: 0.06, gravity: -0.6, drag: 1.6 },
    cloud: 0.55, stone: ['#a8b4be', '#7c8892'], wood: '#5a463a', roof: '#e8f0f6',
  },
  jungle: {
    key: 'jungle', label: 'Tropical jungle & cascades', short: 'Tropical jungle',
    ground: ['#3f7f2e', '#5a9a35'], cliff: ['#5a3f26', '#5d6658'], shore: '#8a7a4a', moss: '#3e7a2c', liquid: 'water',
    water: { shallow: '#48dccc', deep: '#0f6e70', foam: '#eafffb' },
    trees: [{ kind: 'jungle', w: 3, foliage: ['#2f7a2a', '#3f9a32', '#1f6a2a', '#5ab03a'], trunk: '#6a4a2e' },
      { kind: 'palm', w: 1, foliage: ['#3f9a32', '#5ab03a'], trunk: '#7a5a36' }],
    shrubs: [{ kind: 'fern', w: 3, colors: ['#2f8a2e', '#46a23a'] }, { kind: 'bush', w: 1, colors: ['#2f7a2a', '#ff5a7a'] }],
    rocks: [{ kind: 'rock', colors: ['#5d6658', '#424d3e'] }],
    grass: ['#3f8a2c', '#56a034'], flowers: ['#ff5a7a', '#ffb03a', '#ff7ad0', '#ffe24a'],
    density: { trees: 1.3, shrubs: 1.5, grass: 1.1, flowers: 1.2, rocks: 0.7 },
    landmarks: ['pyramid', 'statue', 'stilt', 'colonnade'], lanterns: 0, boats: 1, boulders: 2, lilies: 5,
    lakes: [2, 3], hills: [1, 2], relief: 1.2,
    fauna: { birds: { color: '#e83a3a', wing: '#2a7ae0', count: 10 }, fish: '#ffd24a', critter: { kind: 'capybara', color: '#9a7046', color2: '#6a4a2e', count: 4 } },
    particles: { kind: 'fireflies', color: '#d8ff7a', color2: '#7affd0', count: 70, size: 0.08, gravity: 0.02, drag: 2.0 },
    nightFlies: '#b8ff8a', cloud: 0.6, stone: ['#8a8c78', '#5e6252'], wood: '#6a4a2e', roof: '#a8904a',
  },
  autumn: {
    key: 'autumn', label: 'Autumn maple grove & ruins', short: 'Autumn maple grove',
    ground: ['#9a8a3a', '#b8973e'], cliff: ['#6b4a2f', '#8a857a'], shore: '#a89a6a', moss: '#7a7a32', liquid: 'water',
    water: { shallow: '#5aaac6', deep: '#1d5670', foam: '#f4f8fa' },
    trees: [{ kind: 'round', w: 1, foliage: ['#d9452b', '#e8762b', '#f0a830', '#b8322a', '#e0c040'], trunk: '#4a3328' }],
    shrubs: [{ kind: 'bush', w: 1, colors: ['#c8622b', '#a8842e'] }, { kind: 'fern', w: 0.5, colors: ['#8a8a32'] }],
    rocks: [{ kind: 'rock', colors: ['#8a857a', '#66625a'] }],
    grass: ['#a8983a', '#c0a242'], flowers: ['#f0d060', '#e8762b'],
    density: { trees: 1, shrubs: 0.8, grass: 0.9, flowers: 0.5, rocks: 1 },
    landmarks: ['colonnade', 'arch', 'tower', 'stoneCircle'], lanterns: 3, boats: 1, boulders: 2, lilies: 3,
    lakes: [1, 2], hills: [1, 2], relief: 0.9,
    fauna: { birds: { color: '#2a2622', wing: '#463c34', count: 14 }, fish: '#d85a2a', critter: { kind: 'fox', color: '#d86a2a', color2: '#f6ecdc', count: 3 } },
    particles: { kind: 'leaves', color: '#e8662b', color2: '#f0b030', count: 110, size: 0.11, gravity: -0.3, drag: 1.2 },
    nightFlies: '#ffd68a', cloud: 0.4, stone: ['#c4b8a0', '#968a74'], wood: '#5a4030', roof: '#7a3a2a',
  },
  sakura: {
    key: 'sakura', label: 'Cherry blossom zen garden', short: 'Cherry blossom garden',
    ground: ['#8fbf6a', '#a8d07c'], cliff: ['#7a5a40', '#8e8e88'], shore: '#d9d2c0', moss: '#6fa050', liquid: 'water',
    water: { shallow: '#72d6ea', deep: '#237a9c', foam: '#ffffff' },
    trees: [{ kind: 'round', w: 3, foliage: ['#f6b8c8', '#f9cdd8', '#f2a0b8', '#ffe0ea'], trunk: '#4a3036' },
      { kind: 'conifer', w: 0.5, foliage: ['#3f7a4a', '#4c8a52'], trunk: '#4a3036' }],
    shrubs: [{ kind: 'bush', w: 1, colors: ['#6fa050', '#f6b8c8'] }, { kind: 'reed', w: 0.6, colors: ['#8ab060'] }],
    rocks: [{ kind: 'rock', colors: ['#8e8e88', '#6c6c68'] }],
    grass: ['#86b862', '#9cc870'], flowers: ['#ffffff', '#f6b8c8'],
    density: { trees: 0.8, shrubs: 0.7, grass: 0.8, flowers: 1.2, rocks: 1.1 },
    landmarks: ['torii', 'stoneCircle', 'hut', 'tower'], lanterns: 5, boats: 1, boulders: 1, lilies: 7,
    lakes: [1, 2], hills: [1, 2], relief: 0.8,
    fauna: { birds: { color: '#ffffff', wing: '#2a2a2e', count: 8 }, fish: '#ff7a3a', critter: { kind: 'frog', color: '#5aa83a', color2: '#d8f08a', count: 5 } },
    particles: { kind: 'petals', color: '#ffc2d4', color2: '#ffffff', count: 140, size: 0.09, gravity: -0.2, drag: 1.4 },
    nightFlies: '#ffe6a8', cloud: 0.3, stone: ['#b8b4a8', '#8a867c'], wood: '#5a3a30', roof: '#3a3e48',
  },
  volcanic: {
    key: 'volcanic', label: 'Volcanic caldera & lava falls', short: 'Volcanic caldera',
    ground: ['#3a3436', '#4c4244'], cliff: ['#262224', '#5a3a30'], shore: '#6a3a26', moss: '#5a4a3a', liquid: 'lava', crater: true,
    water: { shallow: '#ffb02a', deep: '#e03a0a', foam: '#fff0a0', glow: 1.6 },
    trees: [{ kind: 'dead', w: 2, foliage: ['#2a2426'], trunk: '#2a2426' },
      { kind: 'round', w: 0.8, foliage: ['#5a8a3a', '#7aa04a'], trunk: '#3a2c26', scale: 0.7 }],
    shrubs: [{ kind: 'fern', w: 1, colors: ['#6a9a3e', '#86b04a'] }, { kind: 'bush', w: 0.5, colors: ['#4a6a34'] }],
    rocks: [{ kind: 'basalt', colors: ['#3a3638', '#242022'] }, { kind: 'shard', colors: ['#1c1a20', '#4a3a5a'] }],
    grass: ['#5a7a36', '#708a3e'], flowers: ['#ff8a2a', '#ffd24a'],
    density: { trees: 0.5, shrubs: 0.6, grass: 0.5, flowers: 0.3, rocks: 2 },
    landmarks: ['forge', 'arch', 'stoneCircle'], lanterns: 1, boats: 0, boulders: 4, lilies: 0,
    lakes: [1, 1], hills: [2, 3], relief: 1.7,
    fauna: { birds: { color: '#1e1a1c', wing: '#3a3032', count: 6 }, fish: null, critter: { kind: 'salamander', color: '#e8542a', color2: '#ffc23a', count: 4 } },
    particles: { kind: 'embers', color: '#ff9a2a', color2: '#ffe27a', count: 110, size: 0.06, gravity: 0.35, drag: 1.0 },
    cloud: 0.25, stone: ['#3e3a3c', '#28242a'], wood: '#3a2c26', roof: '#5a2a1e',
  },
  mushroom: {
    key: 'mushroom', label: 'Giant mushroom grove', short: 'Mushroom grove',
    ground: ['#4a5a6e', '#5a6a86'], cliff: ['#3a3450', '#5a4a6a'], shore: '#6a7a9a', moss: '#6a5a9a', liquid: 'water',
    water: { shallow: '#7af0e6', deep: '#2a4a9a', foam: '#e8fffb', glow: 0.5 },
    trees: [{ kind: 'mushroom', w: 3, foliage: ['#e85a7a', '#b86ae8', '#5ac8e8', '#f0a04a'], trunk: '#f0e6d8' },
      { kind: 'willow', w: 0.6, foliage: ['#6a5ab8', '#8a7ad8'], trunk: '#4a3a5a' }],
    shrubs: [{ kind: 'shroomlet', w: 3, colors: ['#ff8aa8', '#8ae8ff', '#d8a0ff'] }, { kind: 'fern', w: 1, colors: ['#5a7ab8', '#6a8ac8'] }],
    rocks: [{ kind: 'rock', colors: ['#5a5270', '#3e3854'] }, { kind: 'crystal', colors: ['#c08aff', '#8affea'], glow: true }],
    grass: ['#5a7aa8', '#6a8ab8'], flowers: ['#8affea', '#ff8ad8', '#fff08a'],
    density: { trees: 0.9, shrubs: 1.6, grass: 0.8, flowers: 1.3, rocks: 0.9 },
    landmarks: ['stoneCircle', 'hut', 'tower'], lanterns: 2, boats: 0, boulders: 1, lilies: 4,
    lakes: [1, 2], hills: [1, 2], relief: 0.9,
    fauna: { birds: { color: '#c8a0ff', wing: '#6a4ab8', count: 8 }, fish: '#8affea', critter: { kind: 'frog', color: '#8a6ae8', color2: '#8affea', count: 5 } },
    particles: { kind: 'spores', color: '#a8fff0', color2: '#e0b0ff', count: 130, size: 0.07, gravity: 0.08, drag: 2.2 },
    nightFlies: '#8affea', cloud: 0.3, stone: ['#7a7290', '#544c6c'], wood: '#5a4a6a', roof: '#e85a7a',
  },
  coral: {
    key: 'coral', label: 'Coral garden lagoon', short: 'Coral lagoon',
    ground: ['#f0e2b8', '#e6d09a'], cliff: ['#d8b88a', '#c89a8a'], shore: '#fff4d8', moss: '#e88a9a', liquid: 'water',
    water: { shallow: '#7af2e2', deep: '#1a8ab8', foam: '#ffffff' },
    trees: [{ kind: 'coral', w: 3, foliage: ['#ff6a7a', '#ff9a5a', '#c86ae8', '#ffd24a', '#5ad8c8'], trunk: '#ff8a8a' },
      { kind: 'palm', w: 1.2, foliage: ['#4aa84a', '#6ac05a'], trunk: '#a88a5a' }],
    shrubs: [{ kind: 'anemone', w: 3, colors: ['#ff7ab8', '#7ae8d8', '#ffb84a', '#b88aff'] }, { kind: 'bush', w: 0.4, colors: ['#5ab86a'] }],
    rocks: [{ kind: 'rock', colors: ['#e8d8c0', '#c8a890'] }],
    grass: ['#6ac87a', '#8ad88a'], flowers: ['#ff7ab8', '#ffd24a', '#ffffff'],
    density: { trees: 0.9, shrubs: 1.5, grass: 0.5, flowers: 0.8, rocks: 1.2 },
    landmarks: ['lighthouse', 'wreck', 'hut', 'arch'], lanterns: 1, boats: 2, boulders: 1, lilies: 0,
    lakes: [1, 2], hills: [0, 1], relief: 0.6,
    fauna: { birds: { color: '#ffffff', wing: '#c8d2da', count: 12 }, fish: '#ff6a3a', critter: { kind: 'crab', color: '#e8482a', color2: '#ff9a6a', count: 6 } },
    particles: { kind: 'bubbles', color: '#d8fbff', color2: '#ffffff', count: 90, size: 0.06, gravity: 0.3, drag: 1.4 },
    cloud: 0.25, stone: ['#f2ece0', '#c8bca8'], wood: '#a8845a', roof: '#e8482a',
  },
  swamp: {
    key: 'swamp', label: 'Misty mangrove swamp', short: 'Mangrove swamp',
    ground: ['#4a5a30', '#5e6a38'], cliff: ['#3a3222', '#4a4a3a'], shore: '#5a5232', moss: '#55702e', liquid: 'water',
    water: { shallow: '#8aa85a', deep: '#2a4a32', foam: '#d8e8b8' },
    trees: [{ kind: 'willow', w: 3, foliage: ['#5a7a34', '#6a8a3a', '#7a9a48'], trunk: '#3e3226' },
      { kind: 'dead', w: 1, foliage: ['#4a4034'], trunk: '#4a4034' }],
    shrubs: [{ kind: 'reed', w: 3, colors: ['#8a9a48', '#a8a85a'] }, { kind: 'fern', w: 1.5, colors: ['#4c7a34'] }, { kind: 'shroomlet', w: 0.6, colors: ['#e8d8a8', '#c87a4a'] }],
    rocks: [{ kind: 'rock', colors: ['#5a5a4a', '#3e3e32'] }],
    grass: ['#5a7a34', '#6e8a3c'], flowers: ['#f0e8a0', '#e8a0d8'],
    density: { trees: 0.9, shrubs: 1.7, grass: 1.2, flowers: 0.5, rocks: 0.6 },
    landmarks: ['stilt', 'wreck', 'statue'], lanterns: 3, boats: 2, boulders: 1, lilies: 12,
    lakes: [2, 3], hills: [0, 1], relief: 0.45,
    fauna: { birds: { color: '#f2f2ea', wing: '#8a9a9a', count: 7 }, fish: '#c8d86a', critter: { kind: 'frog', color: '#5a8a2e', color2: '#c8d86a', count: 7 } },
    particles: { kind: 'fireflies', color: '#e8ff8a', color2: '#a8ffb8', count: 90, size: 0.08, gravity: 0.02, drag: 2.0 },
    nightFlies: '#e8ff8a', cloud: 0.7, stone: ['#7a7a68', '#54544a'], wood: '#4e3e2c', roof: '#6a6238',
  },
  ruins: {
    key: 'ruins', label: 'Overgrown sky ruins', short: 'Sky ruins',
    ground: ['#7aa84a', '#94b85a'], cliff: ['#a89c84', '#7c725e'], shore: '#c8bca0', moss: '#6a9a3e', liquid: 'water',
    water: { shallow: '#6ad2e2', deep: '#1f6a92', foam: '#ffffff' },
    trees: [{ kind: 'round', w: 2, foliage: ['#5a9a3a', '#74b048', '#4a8a34'], trunk: '#5a4430' },
      { kind: 'willow', w: 1, foliage: ['#6aa84a', '#86be5a'], trunk: '#4e3c2a' }],
    shrubs: [{ kind: 'bush', w: 2, colors: ['#5a9a3a', '#7ab04a'] }, { kind: 'fern', w: 1, colors: ['#4a8a34'] }],
    rocks: [{ kind: 'rock', colors: ['#b8ac94', '#8a806c'] }],
    grass: ['#74a844', '#8cba54'], flowers: ['#ffffff', '#ffd86a', '#b89aff'],
    density: { trees: 0.7, shrubs: 1, grass: 1.2, flowers: 1, rocks: 1.3 },
    landmarks: ['colonnade', 'tower', 'arch', 'statue', 'pyramid'], lanterns: 2, boats: 1, boulders: 3, lilies: 4,
    lakes: [1, 2], hills: [1, 3], relief: 1.1,
    fauna: { birds: { color: '#f6f2e6', wing: '#8a8e96', count: 16 }, fish: '#f0a83a', critter: { kind: 'goat', color: '#e8e2d4', color2: '#8a7a64', count: 4 } },
    particles: { kind: 'leaves', color: '#9ad05a', color2: '#f0f0c0', count: 80, size: 0.09, gravity: -0.2, drag: 1.3 },
    nightFlies: '#fff0b0', cloud: 0.4, stone: ['#d2c8b0', '#a09680'], wood: '#6a5238', roof: '#8a4a3a',
  },
};

export const BIOME_KEYS = Object.keys(BIOMES);
/** The biome each species carried when the islands were hand-planned (the default for a seedless whale). */
export const HOME_BIOME: Record<string, string> = { blue: 'forest', sperm: 'desert', beluga: 'tundra', humpback: 'jungle', bowhead: 'autumn', minke: 'sakura' };
