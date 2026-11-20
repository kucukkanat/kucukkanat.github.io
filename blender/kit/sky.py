"""Floating islands, balloons and airships for sky.glb (both tiers) and sky_full.glb (full tier only).

Low-poly, modelled with palette roles and painted into vertex colours (kit/sky_paint.py); written by the
compact writer in kit/sky_pack.py (quantised positions + RGBA colours, no normals: the app shades them flat).
Set pieces live in kit/sky_models.py, the island body + small props in kit/islands.py, the painted cloud
atlas in kit/sky_clouds.py.
"""
import math
import os
import random
from .util import MB
from .collectibles import coll
from . import sky_paint, sky_pack, sky_models as S
from .sky_paint import M

PAL = sky_paint.PAL


def _finish(m, seed):
    ob = m.build(collection=coll("Sky"))
    sky_paint.paint(ob, list(m.mats), seed=seed)
    g = S.take_glow()
    if g:
        sky_paint.EXTRAS[ob.name] = {"glow": g}
    return ob


def island(name, r, depth, seed, dress, n=16, strata=3):
    from . import islands as I
    m = MB(name, smooth_angle=0, flat=True)
    isl = I.Island(m, r, depth, seed, M, n=n, strata=strata)
    dress(m, isl, I)
    return _finish(m, seed)


def piece(name, fn, seed=0):
    m = MB(name, smooth_angle=0, flat=True)
    fn(m)
    return _finish(m, seed)


def build():
    """-> (objects for sky.glb, objects for sky_full.glb)."""

    def flowers(m, isl, I, count, seed, avoid=()):
        rnd = random.Random(seed)
        for k in range(count):
            a = rnd.uniform(0, 2 * math.pi)
            d = isl.r * math.sqrt(rnd.uniform(0.1, 0.8))
            x, z = d * math.cos(a), d * math.sin(a)
            if any(math.hypot(x - ax, z - az) < ar for (ax, az, ar) in avoid):
                continue
            m.cyl(0.022 * isl.r, 0.03 * isl.r, isl.on_top(x, z, -0.012), M["flower" if k % 2 else "flower2"], segs=3,
                  r2=0.0, pitch=180, yaw=k * 37, cap=True)

    def ex1(m, isl, I):
        # windmill + cottage + orchard
        r = isl.r
        I.windmill(m, isl.on_top(-0.15 * r, -0.2 * r), 1.25, M, yaw=25, sail_rot=20)
        S.cottage(m, isl.on_top(0.35 * r, 0.15 * r), 0.85, yaw=-35)
        for k, (x, z, s) in enumerate(((0.5 * r, -0.4 * r, 0.9), (-0.55 * r, 0.3 * r, 1.0), (0.05 * r, 0.6 * r, 0.75),
                                         (-0.6 * r, -0.35 * r, 0.7))):
            I.round_tree(m, isl.on_top(x, z), s, M, seed=k)
        # little fence along the field
        for k in range(6):
            x = -0.2 * r + 0.09 * k
            m.box((0.014, 0.07, 0.014), isl.on_top(x, 0.32 * r, -0.03), M["trunk"])
        m.box((0.47, 0.012, 0.01), isl.on_top(0.025 * r, 0.32 * r, -0.05), M["trunk"])
        isl.tufts(10, M["grass_hi"], seed=3, avoid=((-0.15 * r, -0.2 * r, 0.2), (0.35 * r, 0.15 * r, 0.25)))
        flowers(m, isl, I, 10, 4, avoid=((-0.15 * r, -0.2 * r, 0.2), (0.35 * r, 0.15 * r, 0.25)))
        isl.roots(9, M["root"], seed=5, thick=0.024)
        isl.roots(6, M["vine"], seed=6, length=(0.2, 0.45), thick=0.018)

    def ex2(m, isl, I):
        # waterfall spilling off the edge, a few trees
        r = isl.r
        I.waterfall(m, isl, math.radians(70), M, width=0.16, seed=2)
        for k, (x, z, s) in enumerate(((-0.35 * r, -0.3 * r, 0.8), (0.4 * r, -0.35 * r, 0.65), (-0.45 * r, 0.25 * r, 0.6))):
            I.pine(m, isl.on_top(x, z), s, M, seed=k)
        I.round_tree(m, isl.on_top(0.05 * r, -0.55 * r), 0.6, M, seed=4)
        I.boulder(m, isl.on_top(0.42 * r, 0.12 * r), 0.05, M["stone"], seed=3)
        isl.tufts(8, M["grass_hi"], seed=7, avoid=((0.15 * r, 0.42 * r, 0.25),))
        flowers(m, isl, I, 6, 8, avoid=((0.15 * r, 0.42 * r, 0.25),))
        isl.roots(7, M["root"], seed=9, thick=0.026)
        isl.roots(6, M["vine"], seed=10, length=(0.25, 0.5), thick=0.02)

    def ex3(m, isl, I):
        # crooked lighthouse on the big island, keeper's cottage, trees
        r = isl.r
        I.lighthouse(m, isl.on_top(0.3 * r, -0.25 * r), 1.7, M, yaw=10)
        lp = isl.on_top(0.3 * r, -0.25 * r)
        S.glow(m, (lp[0] - 0.19, lp[1] + 1.12, lp[2] + 0.14), 0.9)
        S.cottage(m, isl.on_top(-0.25 * r, 0.1 * r), 1.0, yaw=30)
        I.cottage(m, isl.on_top(-0.5 * r, -0.35 * r), 0.7, M, yaw=-60)
        for k, (x, z, s) in enumerate(((0.55 * r, 0.35 * r, 1.0), (-0.6 * r, 0.45 * r, 1.1), (0.1 * r, 0.6 * r, 0.8))):
            I.pine(m, isl.on_top(x, z), s, M, seed=k)
        for k, (x, z, s) in enumerate(((0.62 * r, -0.05 * r, 0.8), (-0.05 * r, -0.6 * r, 0.9))):
            I.round_tree(m, isl.on_top(x, z), s, M, seed=10 + k)
        # path from the cottage to the lighthouse
        for k in range(6):
            t = k / 5
            x = -0.15 * r + (0.25 * r) * t
            z = 0.05 * r - 0.25 * r * t
            m.cyl(0.035, 0.01, isl.on_top(x, z, -0.006), M["stone"], segs=6)
        isl.tufts(12, M["grass_hi"], seed=11, avoid=((0.3 * r, -0.25 * r, 0.2), (-0.25 * r, 0.1 * r, 0.22)))
        flowers(m, isl, I, 12, 12, avoid=((0.3 * r, -0.25 * r, 0.2), (-0.25 * r, 0.1 * r, 0.22)))
        isl.roots(12, M["root"], seed=13, thick=0.017)
        isl.roots(8, M["vine"], seed=14, length=(0.18, 0.4), thick=0.013)

    def ex4(m, isl, I):
        # wild: rocks and pines
        r = isl.r
        for k, (x, z, s) in enumerate(((0.0, -0.1 * r, 0.95), (0.4 * r, 0.25 * r, 0.7), (-0.45 * r, 0.2 * r, 0.8),
                                         (0.35 * r, -0.45 * r, 0.6), (-0.3 * r, -0.5 * r, 0.55))):
            I.pine(m, isl.on_top(x, z), s, M, seed=k)
        for k, (x, z, s) in enumerate(((0.15 * r, 0.5 * r, 0.11), (-0.55 * r, -0.15 * r, 0.09), (0.6 * r, -0.05 * r, 0.08))):
            I.boulder(m, isl.on_top(x, z, 0.04), s, M["stone"] if k % 2 else M["rock3"], seed=20 + k)
        isl.tufts(8, M["grass_hi"], seed=15)
        isl.roots(8, M["root"], seed=16, thick=0.03, length=(0.35, 0.7))
        isl.roots(5, M["vine"], seed=17, length=(0.3, 0.55), thick=0.022)
        for k in range(5):
            a = 2 * math.pi * k / 5 + 0.4
            d = 0.75 * r
            I.boulder(m, isl.on_top(d * math.cos(a), d * math.sin(a), 0.05), 0.045 + 0.02 * (k % 2),
                      M["stone"] if k % 2 else M["rock2"], seed=40 + k)

    base = [
        island("SKY_island_1", 0.9, 1.5, 11, ex1),
        island("SKY_island_2", 0.6, 1.15, 22, ex2, n=14),
        island("SKY_island_3", 1.4, 2.0, 33, ex3, n=18),
        island("SKY_island_4", 0.45, 0.95, 44, ex4, n=12, strata=2),
        island("SKY_island_5", 1.6, 2.7, 55, lambda m, isl, I: S.dress_citadel(m, isl), n=20),
        island("SKY_island_6", 1.9, 1.9, 66, lambda m, isl, I: S.dress_mesa(m, isl), n=22),
        piece("SKY_airship", lambda m: S.airship(m, (0, 0, 0), 1.0), seed=1),
        piece("SKY_balloon_1", lambda m: S.balloon(m, (0, 0, 0), 1.0, "stripes", ("orange", "cream")), seed=2),
        piece("SKY_balloon_2", lambda m: S.balloon(m, (0, 0, 0), 1.0, "bands", (
            "teal", "teal", "cream", "ochre", "cream", "teal", "teal", "teal_dk"), basket="wood"), seed=3),
    ]
    full = [
        island("SKY_island_7", 0.9, 3.0, 77, lambda m, isl, I: S.dress_needle(m, isl), n=14),
        piece("SKY_rocks_1", S.rocks, seed=4),
        piece("SKY_airship_2", lambda m: S.airship(m, (0, 0, 0), 1.0, ("plum", "plum_dk", "ochre"), twin=True,
                                                    sails=True, roof="roof3"), seed=5),
        piece("SKY_balloon_3", lambda m: S.balloon(m, (0, 0, 0), 1.0, "swirl", ("plum", "ochre")), seed=6),
        piece("SKY_balloon_4", lambda m: S.balloon(m, (0, 0, 0), 1.0, "crown", ("blue", "cream", "orange"),
                                                    basket="wood"), seed=7),
    ]
    return base, full


def build_files(assets, keep_atlas=None):
    """Write sky.glb (+ cloud atlas) and sky_full.glb into `assets`. Returns their info dicts."""
    from . import sky_clouds
    base, full = build()
    atlas = sky_clouds.encode_webp(sky_clouds.atlas(), keep=keep_atlas)
    return [sky_pack.write(os.path.join(assets, "sky.glb"), base, atlas=atlas),
            sky_pack.write(os.path.join(assets, "sky_full.glb"), full)]
