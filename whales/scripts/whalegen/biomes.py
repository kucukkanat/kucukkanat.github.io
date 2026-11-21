"""Per-biome terrain features + prop population. (u,v) are normalised island coords:
u in [-1,1] along the body (-1 = towards the head), v in [-1,1] across (+1 = whale's left / +X)."""
import math
import numpy as np
from . import props as P
from .util import hex2rgb, boost, TAU, fbm, mix


def _cnt(isl, a, b):
    return a if isl.style == 'A' else b


def _col(isl, key):
    return isl.pal[key]


def _foliage(isl, key='foliage'):
    cols = [hex2rgb(c) for c in isl.biome[key]]
    return [boost(c) for c in cols] if isl.style == 'B' else cols


def _tree_scale(isl):
    return isl.U * (0.78 if isl.style == 'B' else 0.58)


def grass_and_flowers(isl, n_grass, n_flowers, gcol, fcols, r_hi=0.9):
    U = isl.U; rng = isl.rng
    for (x, y) in isl.sample(n_grass, 0.18 * U, r_hi=r_hi, lake_margin=0.05):
        isl.place(P.grass(rng, U * rng.uniform(0.8, 1.3), gcol), x, y, z_off=-0.02)
    for (x, y) in isl.sample(n_flowers, 0.15 * U, r_hi=r_hi, lake_margin=0.05):
        isl.place(P.flower(rng, U, fcols[rng.integers(len(fcols))]), x, y, z_off=-0.01)


def rim_rocks(isl, n, snow=False, r_lo=0.78, r_hi=0.96):
    U = isl.U; rng = isl.rng
    for (x, y) in isl.sample(n, 0.5 * U, r_lo=r_lo, r_hi=r_hi, lake_margin=0.0):
        isl.place(P.rock(rng, U * rng.uniform(0.7, 1.25), _col(isl, 'rock'), _col(isl, 'rock2'), isl.style, snow),
                  x, y, z_off=-0.05, occ=0.25)


def lilypads(isl, lk, n, flower=None):
    U = isl.U; rng = isl.rng
    for k in range(n):
        a = rng.uniform(0, TAU); d = rng.uniform(0.2, 0.75) * lk['r']
        x = lk['x'] + math.cos(a) * d; y = lk['y'] + math.sin(a) * d
        if isl.rnorm(x, y) > 0.9:
            continue
        isl.place(P.lilypad(rng, U, flower if rng.random() < 0.5 else None), x, y,
                  z=lk['level'] + 0.006 * U, weight=('water', lk['idx']))


# ============================================================== forest (blue whale)
def plan_forest(isl):
    isl.add_hill(-0.55, -0.25, 1.0, 0.28)
    isl.add_lake(0.02, 0.56, 0.78, depth=0.28, falls=3)


def populate_forest(isl):
    U = isl.U; rng = isl.rng; s = _tree_scale(isl); st = isl.style
    fol = _foliage(isl); con = _foliage(isl, 'conifer')
    x, y = isl.uv2xy(-0.55, -0.25)
    isl.place_tree(P.round_tree(rng, s * 1.75, fol, isl.biome['trunk'], st, n_blobs=6 if st == 'A' else 4, wide=1.2),
                   x, y, occ=0.7)
    isl.place(P.hut(rng, U * 0.62, '#8a5a34', '#9a3a2a', st), *isl.uv2xy(0.62, -0.38), rot=0.4, occ=0.6)
    for (x, y) in isl.sample(_cnt(isl, 34, 20), 0.42 * s, r_hi=0.86):
        isl.place_tree(P.round_tree(rng, s * rng.uniform(0.8, 1.15), fol, isl.biome['trunk'], st), x, y, occ=0.35)
    for (x, y) in isl.sample(_cnt(isl, 18, 10), 0.5 * s, r_hi=0.86, region=lambda u, v, x, y: u > 0.0):
        isl.place_tree(P.conifer(rng, s * rng.uniform(0.75, 1.05), con, isl.biome['trunk'], st), x, y, occ=0.3)
    rim_rocks(isl, _cnt(isl, 10, 7))
    lk = isl.lakes[0]
    lilypads(isl, lk, _cnt(isl, 6, 4), '#ffffff')
    grass_and_flowers(isl, _cnt(isl, 70, 40), _cnt(isl, 26, 16), _col(isl, 'moss'), isl.biome['flowers'])


# ============================================================== desert (sperm whale)
def plan_desert(isl):
    U = isl.U
    def dunes(x, y):
        n = fbm(x / (2.0 * U), y / (2.0 * U), 77)
        ridge = 1 - np.abs(np.sin(y / (0.9 * U) + x / (2.2 * U) + n * 4.0))
        return 0.18 * U * ridge ** 2
    isl.extra = dunes
    isl.amp = 0.05 * U
    isl.add_lake(-0.12, -0.05, 0.62, depth=0.25, falls=0, level_off=-0.10)
    isl.add_lake(0.55, -0.72, 0.38, depth=0.18, falls=1)


def populate_desert(isl):
    U = isl.U; rng = isl.rng; s = _tree_scale(isl); st = isl.style
    fol = _foliage(isl)
    lk = isl.lakes[0]
    isl.add_stain(lk['x'], lk['y'], lk['r'] * 2.2, _col(isl, 'shore'), 0.9)
    isl.add_stain(isl.lakes[1]['x'], isl.lakes[1]['y'], isl.lakes[1]['r'] * 1.9, _col(isl, 'shore'), 0.8)
    n = _cnt(isl, 12, 8); placed = 0
    for k in range(200):
        if placed >= n:
            break
        a = rng.uniform(0, TAU); d = lk['r'] + rng.uniform(0.1, 0.55) * U
        x = lk['x'] + math.cos(a) * d; y = lk['y'] + math.sin(a) * d
        if isl.rnorm(x, y) < 0.86 and all(math.hypot(x - t['x'], y - t['y']) > 0.35 * U for t in isl.trees):
            isl.place_tree(P.palm(rng, s * rng.uniform(0.8, 1.1), fol, isl.biome['trunk'], st), x, y, occ=0.3)
            placed += 1
    for (x, y) in isl.sample(_cnt(isl, 5, 3), 0.6 * U, r_hi=0.84):
        isl.place_tree(P.palm(rng, s * rng.uniform(0.7, 0.95), fol, isl.biome['trunk'], st), x, y, occ=0.3)
    for (u, v, sc) in ((0.68, 0.35, 0.85), (-0.72, -0.4, 0.7), (0.2, 0.62, 0.6)):
        x, y = isl.uv2xy(u, v)
        isl.place(P.mesa(rng, U * sc, _col(isl, 'rock'), _col(isl, 'rock2'), st), x, y, z_off=-0.1, occ=0.7 * sc)
    isl.place(P.arch(rng, U * 0.62, _col(isl, 'rock'), _col(isl, 'rock2'), st), *isl.uv2xy(0.4, -0.35), rot=1.3, occ=0.6)
    for (x, y) in isl.sample(_cnt(isl, 9, 6), 0.6 * U, r_hi=0.85):
        isl.place(P.cactus(rng, s * rng.uniform(0.8, 1.2), isl.biome['cactus'], st), x, y, occ=0.3)
    rim_rocks(isl, _cnt(isl, 10, 6))
    lilypads(isl, lk, _cnt(isl, 3, 2), '#ff9ac0')
    grass_and_flowers(isl, _cnt(isl, 40, 24), _cnt(isl, 12, 8), _col(isl, 'moss'), isl.biome['flowers'], r_hi=0.8)


# ============================================================== tundra (beluga)
def plan_tundra(isl):
    isl.add_lake(0.12, 0.22, 0.7, depth=0.2, falls=0, kind='ice')
    isl.add_hill(-0.5, -0.35, 0.9, 0.22)
    isl.add_hill(0.6, -0.3, 0.8, 0.18)


def populate_tundra(isl):
    U = isl.U; rng = isl.rng; s = _tree_scale(isl); st = isl.style
    con = _foliage(isl, 'conifer')
    isl.place(P.igloo(rng, U * 1.1, st), *isl.uv2xy(-0.45, 0.35), rot=-1.2, z_off=-0.05, occ=0.8)
    for (x, y) in isl.sample(_cnt(isl, 24, 15), 0.45 * s, r_hi=0.84):
        isl.place_tree(P.conifer(rng, s * rng.uniform(0.75, 1.15), con, isl.biome['trunk'], st, snow=True), x, y, occ=0.3)
    for (x, y) in isl.sample(_cnt(isl, 5, 4), 0.8 * U, r_hi=0.8):
        isl.place(P.crystal(rng, U * rng.uniform(0.8, 1.3), _col(isl, 'crystal'), st), x, y, occ=0.35)
    rim_rocks(isl, _cnt(isl, 12, 8), snow=True)
    # icicles hanging off the cliff lip
    n = 0 if getattr(isl, 'grown', False) else _cnt(isl, 40, 26)
    for k in range(n):
        phi = TAU * (k + rng.uniform(0, 0.6)) / n
        x, y = isl.boundary(phi, 1.0)
        z = isl.ground(x, y) - 0.04 * U
        isl.place(P.icicle(rng, U * rng.uniform(0.7, 1.3)), x, y, z=z)
    grass_and_flowers(isl, _cnt(isl, 20, 12), 0, _col(isl, 'rock2'), ['#ffffff'])


# ============================================================== jungle (humpback)
def plan_jungle(isl):
    isl.add_hill(0.12, -0.05, 1.5, 0.75)
    isl.add_hill(-0.55, 0.2, 0.8, 0.25)
    isl.amp = 0.14 * isl.U
    isl.add_lake(-0.12, 0.6, 0.62, depth=0.25, falls=2)
    isl.add_lake(0.42, -0.6, 0.58, depth=0.25, falls=2)


def populate_jungle(isl):
    U = isl.U; rng = isl.rng; s = _tree_scale(isl); st = isl.style
    fol = _foliage(isl)
    x, y = isl.uv2xy(0.12, -0.05)
    isl.place_tree(P.jungle_tree(rng, s * 1.5, fol, isl.biome['trunk'], st), x, y, occ=1.0)
    isl.place(P.step_pyramid(rng, U * 1.0, '#8a8a70', '#6a6a58', st), *isl.uv2xy(-0.62, -0.3), rot=0.3,
              z_off=-0.08, occ=0.8)
    for (x, y) in isl.sample(_cnt(isl, 20, 12), 0.6 * s, r_hi=0.84):
        isl.place_tree(P.jungle_tree(rng, s * rng.uniform(0.7, 1.0), fol, isl.biome['trunk'], st), x, y, occ=0.45)
    for (x, y) in isl.sample(_cnt(isl, 7, 4), 0.5 * s, r_hi=0.85):
        isl.place_tree(P.palm(rng, s * rng.uniform(0.7, 0.95), fol, isl.biome['trunk'], st), x, y, occ=0.3)
    for (x, y) in isl.sample(_cnt(isl, 32, 24), 0.25 * U, r_hi=0.9, lake_margin=0.05):
        isl.place(P.fern(rng, U * rng.uniform(0.8, 1.3), fol[rng.integers(len(fol))]), x, y, z_off=-0.02)
    rim_rocks(isl, _cnt(isl, 8, 5))
    for lk in isl.lakes:
        lilypads(isl, lk, _cnt(isl, 5, 3), '#ff7ad0')
    grass_and_flowers(isl, _cnt(isl, 30, 18), _cnt(isl, 40, 24), _col(isl, 'moss'), isl.biome['flowers'])


# ============================================================== autumn (bowhead)
def plan_autumn(isl):
    isl.add_hill(-0.42, 0.28, 1.0, 0.3)
    isl.add_lake(0.32, -0.58, 0.62, depth=0.25, falls=2)


def populate_autumn(isl):
    U = isl.U; rng = isl.rng; s = _tree_scale(isl); st = isl.style
    fol = _foliage(isl)
    ruin = _col(isl, 'ruin')
    cx, cy = isl.uv2xy(-0.42, 0.28)
    for k in range(6):
        a = TAU * k / 6
        x = cx + math.cos(a) * 0.75 * U; y = cy + math.sin(a) * 0.75 * U * 1.4
        isl.place(P.pillar(rng, U, ruin, st, broken=(k % 2 == 1)), x, y, rot=0, z_off=-0.05, occ=0.3)
    isl.place(P.fallen_pillar(rng, U, ruin, st), cx + 0.2 * U, cy - 0.1 * U, occ=0.5)
    isl.place(P.arch(rng, U * 0.7, ruin, _col(isl, 'rock'), st), *isl.uv2xy(0.55, 0.25), rot=0.2, occ=0.8)
    isl.occupied.append((cx, cy, 1.0 * U))
    for (x, y) in isl.sample(_cnt(isl, 24, 15), 0.48 * s, r_hi=0.83):
        isl.place_tree(P.round_tree(rng, s * rng.uniform(0.8, 1.1), fol, isl.biome['trunk'], st, maple=True),
                       x, y, occ=0.35)
        isl.add_stain(x, y, 0.7 * U, fol[rng.integers(len(fol))], 0.75, kind='speckle')
    con = [boost(hex2rgb('#2f5a33')) if st == 'B' else hex2rgb('#2f5a33')]
    for (x, y) in isl.sample(_cnt(isl, 4, 3), 0.5 * s, r_hi=0.8):
        isl.place_tree(P.conifer(rng, s * 0.9, con, isl.biome['trunk'], st), x, y, occ=0.3)
    rim_rocks(isl, _cnt(isl, 9, 6))
    lilypads(isl, isl.lakes[0], _cnt(isl, 4, 3), None)
    grass_and_flowers(isl, _cnt(isl, 55, 32), _cnt(isl, 14, 8), _col(isl, 'ground2'), isl.biome['flowers'])


# ============================================================== sakura (minke)
def plan_sakura(isl):
    isl.amp = 0.06 * isl.U
    isl.add_lake(-0.02, 0.48, 0.72, depth=0.28, falls=1)
    x, y = isl.add_pad(0.52, -0.3, 1.0, dh=-0.02)
    isl.pads[-1]['exclusive'] = True
    isl.add_hill(-0.6, -0.3, 0.7, 0.12)


def populate_sakura(isl):
    U = isl.U; rng = isl.rng; s = _tree_scale(isl); st = isl.style
    fol = _foliage(isl)
    pad = isl.pads[0]
    isl.add_stain(pad['x'], pad['y'], pad['r'] * 0.95, _col(isl, 'gravel'), 1.0, kind='raked')
    for k, (dx, dy, sc) in enumerate(((0.0, 0.0, 1.3), (0.35, 0.3, 0.8), (-0.3, 0.25, 0.7))):
        isl.place(P.rock(rng, U * sc * 1.4, _col(isl, 'rock'), _col(isl, 'rock2'), st),
                  pad['x'] + dx * U, pad['y'] + dy * U, z_off=-0.04)
    # torii at the front of the island, facing forward
    tx, ty = isl.uv2xy(-0.74, 0.0)
    isl.place(P.torii(rng, U * 1.1, isl.biome['torii'], st), tx, ty, rot=0.0, occ=0.9)
    lk = isl.lakes[0]
    # bridge across the pond (along body axis)
    isl.place(P.bridge(rng, lk['r'] * 1.9, 0.42 * U, '#b5523a', '#8a2f22'), lk['x'] - 0.15 * U, lk['y'],
              rot=math.pi / 2, z=lk['level'] + 0.04 * U, occ=0.0)
    for k in range(_cnt(isl, 4, 3)):
        a = TAU * k / 4 + 0.6
        x = lk['x'] + math.cos(a) * (lk['r'] + 0.35 * U); y = lk['y'] + math.sin(a) * (lk['r'] + 0.35 * U)
        if isl.rnorm(x, y) < 0.88:
            isl.place(P.lantern(rng, U, _col(isl, 'rock'), st), x, y, rot=a, occ=0.25)
    for (x, y) in isl.sample(_cnt(isl, 16, 10), 0.5 * s, r_hi=0.86):
        isl.place_tree(P.sakura_tree(rng, s * rng.uniform(0.85, 1.15), fol, isl.biome['trunk'], st), x, y, occ=0.35)
        isl.add_stain(x, y, 0.9 * U, fol[0], 0.85, kind='speckle')
    for k in range(_cnt(isl, 7, 5)):
        a = rng.uniform(0, TAU); d = rng.uniform(0.1, 0.7) * lk['r']
        isl.place(P.koi(rng, U), lk['x'] + math.cos(a) * d, lk['y'] + math.sin(a) * d, rot=a + math.pi / 2,
                  z=lk['level'] - 0.07 * U)
    lilypads(isl, lk, _cnt(isl, 4, 3), '#f6b8c8')
    rim_rocks(isl, _cnt(isl, 8, 5))
    grass_and_flowers(isl, _cnt(isl, 40, 24), _cnt(isl, 14, 8), _col(isl, 'moss'), isl.biome['flowers'])


PLAN = dict(forest=plan_forest, desert=plan_desert, tundra=plan_tundra, jungle=plan_jungle,
            autumn=plan_autumn, sakura=plan_sakura)
POPULATE = dict(forest=populate_forest, desert=populate_desert, tundra=populate_tundra, jungle=populate_jungle,
                autumn=populate_autumn, sakura=populate_sakura)
