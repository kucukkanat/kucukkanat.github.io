"""Painted vertex colours for the sky models (sky.glb / sky_full.glb).

Every sky mesh is built with palette *roles* as its materials ("pal_<role>"). `paint()` turns them into one
RGBA byte colour per face corner:
  rgb   = the role's colour with soft, position-based variation (big light/dark patches, warm/cool dabs,
          a top-to-bottom gradient) -- a function of role + position only, so neighbouring faces share
          vertices and the file stays small;
  alpha = 255 normally, 0 for parts that glow at night (windows, lamps, burners).
The app's sky shader (src/sky.ts) lights them (warm light side / cool violet shadow side) and fades them
toward the horizon colour with distance.

Colours come from the cabin palette (kit/paint.py PALETTE / ACCENT) wherever a matching tone exists.
"""
import math
import numpy as np
from .paint import PALETTE, ACCENT


def _p(name, i):
    return PALETTE[name][0][i]


# role -> (sRGB hex, kind). kinds: rock | grass | leaf | flat | cloth | emit
PAL = {
    # island body
    "grass": ("#93A455", "grass"), "grass_hi": ("#B7BE62", "grass"), "lip": ("#6F8A48", "grass"),
    "soil": (_p("WallPlanks", 1), "rock"),
    "rock1": ("#D9A070", "rock"), "rock2": ("#A8684A", "rock"), "rock3": ("#7C4D43", "rock"),
    "rock4": ("#55303F", "rock"),
    "root": (_p("Leather", 1), "flat"), "vine": ("#557A3A", "leaf"),
    # plants
    "pine1": ("#3F6A4A", "leaf"), "pine2": (_p("BookGreen", 3), "leaf"),
    "leaf": ("#7C9C4C", "leaf"), "leaf2": ("#9CB25A", "leaf"), "trunk": (_p("Mahogany", 1), "flat"),
    "flower": (_p("Gilt", 2), "flat"), "flower2": ("#E58A8A", "flat"),
    # buildings
    "wall": (_p("Sailcloth", 2), "flat"), "white": (_p("Parchment", 3), "flat"),
    "stone": (_p("Sailcloth", 0), "rock"), "roof": (_p("BookRed", 3), "flat"), "roof2": (ACCENT["orange"], "flat"),
    "roof3": (_p("BookTeal", 3), "flat"), "red": (_p("Cloth", 3), "flat"), "dark": (_p("DarkWood", 1), "flat"),
    "sail": (_p("Sailcloth", 3), "cloth"),
    "window": ("#FFD98A", "emit"), "lamp": (_p("Gilt", 3), "emit"), "burner": ("#FFC66B", "emit"),
    # water
    "water": ("#6FB6C8", "flat"), "water2": ("#A6D8DE", "flat"), "foam": ("#F2F6F0", "flat"),
    # balloons / airships
    "orange": (ACCENT["orange"], "cloth"), "orange_dk": ("#C24E22", "cloth"), "cream": (ACCENT["cream"], "cloth"),
    "teal": (_p("BookTeal", 3), "cloth"), "teal_dk": (_p("BookTeal", 2), "cloth"),
    "ochre": (_p("BookOchre", 3), "cloth"), "plum": (_p("BookPlum", 3), "cloth"),
    "plum_dk": (_p("BookPlum", 2), "cloth"), "blue": (_p("BookBlue", 3), "cloth"),
    "brass": (_p("Brass", 2), "flat"), "wood": (_p("Mahogany", 2), "flat"), "wood_dk": (_p("Mahogany", 1), "flat"),
    "wood_lt": (_p("Planks", 2), "flat"), "rope": (_p("Leather", 3), "flat"),
}
# role -> material name used while modelling
M = {k: "pal_" + k for k in PAL}

COLS = {}      # object name -> (n_loops, 4) uint8, filled by paint()
EXTRAS = {}    # object name -> dict written to the glTF node extras (glow points...)


def _srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float64)


def _hash(ix, iy, iz, seed):
    n = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1274126177) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def vnoise(x, y, z, seed=0):
    """Smooth value noise 0..1."""
    ix, iy, iz = math.floor(x), math.floor(y), math.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    fx, fy, fz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    v = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy) * (fz if dz else 1 - fz)
                v += w * _hash(ix + dx, iy + dy, iz + dz, seed)
    return v


def paint(ob, mat_names, seed=0):
    """Compute the corner colours of `ob` (mesh built by util.MB, Blender coords) from its role materials."""
    me = ob.data
    vs = [v.co.copy() for v in me.vertices]
    if not vs:
        COLS[ob.name] = np.zeros((0, 4), np.uint8)
        return ob
    zs = [v.z for v in vs]                      # Blender Z = up
    z0, z1 = min(zs), max(zs)
    ext = max(max(v.x for v in vs) - min(v.x for v in vs), max(v.y for v in vs) - min(v.y for v in vs), z1 - z0, 1e-3)
    f1, f2 = 3.0 / ext, 9.0 / ext
    base = {}
    for i, n in enumerate(mat_names):
        key = n[4:] if n.startswith("pal_") else n
        hx, kind = PAL.get(key, ("#FF00FF", "flat"))
        base[i] = (_srgb(hx), kind)
    cache = {}
    out = np.zeros((len(me.loops), 4), np.uint8)
    for poly in me.polygons:
        c0, kind = base.get(poly.material_index, (_srgb("#FF00FF"), "flat"))
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            k = (vi, poly.material_index)
            col = cache.get(k)
            if col is None:
                p = vs[vi]
                n1 = vnoise(p.x * f1, p.y * f1, p.z * f1, seed) - 0.5        # big patches
                n2 = vnoise(p.x * f2, p.y * f2, p.z * f2, seed + 7) - 0.5    # dabs
                h = (p.z - z0) / max(z1 - z0, 1e-6)                          # 0 bottom .. 1 top
                c = c0.copy()
                a = 255
                if kind == "rock":
                    c *= 1 + 0.30 * n1 + 0.14 * n2
                    c += n2 * np.array([0.08, 0.0, -0.08])
                    # cooler and darker toward the underside
                    t = max(0.0, min(1.0, -p.z / max(-z0, 1e-6))) if z0 < 0 else 0.0
                    c = c * (1 - 0.30 * t) + np.array([0.03, 0.0, 0.10]) * t
                elif kind == "grass":
                    c *= 1 + 0.22 * n1 + 0.10 * n2
                    c += max(0.0, n1) * np.array([0.16, 0.10, -0.04])          # sun-bleached patches
                    c += min(0.0, n2) * np.array([0.10, -0.02, -0.12])         # cool dabs
                elif kind == "leaf":
                    c *= 1 + 0.26 * n1 + 0.14 * n2
                    c += n2 * np.array([0.10, 0.06, -0.06])
                elif kind == "cloth":
                    c *= (0.84 + 0.24 * h) * (1 + 0.10 * n1)
                    c += n2 * np.array([0.05, 0.0, -0.05])
                elif kind == "emit":
                    a = 0
                else:
                    c *= 1 + 0.14 * n1 + 0.08 * n2
                    c += n2 * np.array([0.04, 0.0, -0.04])
                col = tuple(int(round(max(0.0, min(1.0, v)) * 255)) for v in c) + (a,)
                cache[k] = col
            out[li] = col
    COLS[ob.name] = out
    return ob
