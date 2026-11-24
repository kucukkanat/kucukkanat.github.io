"""The navigator's chart room, Ugurcan's room -> blender/out/chartroom/chartroom_raw.glb + public/assets/chartroom_lightmap_*.
Run: Blender --background --factory-startup --python blender/chartroom/build.py [-- --no-bake] [--samples N] [--preview]

Built with the library deck's kit (blender/library/kit: util.MB in three.js coordinates, painted materials, one-atlas
lightmap on the STATIC_* meshes), so it reads as the same ship. Layout (metres, three.js: +Y up, +Z toward the visitor):
  floor 4 x 4.8 m (x -2..2, z -2.4..2.4); curved hull side walls (tumblehome), barrel vault 2.7 -> 3.3 m.
  back wall: a gallery of three tall windows onto the sky (the ship's bow); his chart table in front of it.
  vault: a skylight over the chart table, where his star shows (drawn by the app).
  left wall: chart cabinet (flat drawers) with pigeonholes of rolled charts above.
  right wall: a porthole, a framed star chart and the chronometer on a shelf. Front corners: armillary sphere, sea chest.
Contract nodes (docs/SCENE_CONTRACT.md, Chart room): Ugurcan (his spot, facing +Z), Camera_main / Camera_table /
Camera_sky / Camera_window (look down local -Z; userData.target), Star (where his star is, above the skylight),
Sky_backdrop_* (the window sky, drawn by the app), Skylight_sky (the skylight's sky, drawn by the app), DOOR_front.
"""
import json
import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))       # blender/chartroom -> repo root
LIB = os.path.join(ROOT, "blender", "library")
sys.path.insert(0, LIB)
from kit import props as desk  # noqa: E402
from kit import util, materials, lightmap, export  # noqa: E402
from kit.util import MB, T, empty, mat3  # noqa: E402

ASSETS = os.path.join(ROOT, "public", "assets")
OUT = os.path.join(ROOT, "blender", "out", "chartroom")

# ---------------------------------------------------------------- layout
HALF_W, Z_BACK, Z_FRONT = 2.0, -2.4, 2.4
CEIL_SIDE, CEIL_TOP = 2.7, 3.3
BULGE = 0.18
TABLE_C, TABLE_TOP = (0.0, 0.0, -0.75), 0.92        # his chart table (a standing height)
TABLE_W, TABLE_D = 1.7, 0.95
UGURCAN = (0.0, -1.42)                              # (x, z) where he stands, behind the table, facing the visitor
WIN_Y0, WIN_Y1 = 0.85, 2.3                          # the gallery windows on the back wall
WINDOWS = [(-1.05, 0.62), (0.0, 0.7), (1.05, 0.62)]  # (x centre, width)
SKY_C, SKY_HALF = (0.0, -0.75), 0.5                 # skylight centre (x, z) and half size, over the table
PORTHOLE = (0.75, 1.5)                              # (z, y) on the right wall
PORT_R = 0.28


def log(*a):
    print("[chartroom]", *a, flush=True)


def hull_x(y):
    return HALF_W + BULGE * math.sin(math.pi * min(max(y, 0), CEIL_SIDE) / CEIL_SIDE)


VAULT_R = ((HALF_W ** 2) + (CEIL_TOP - CEIL_SIDE) ** 2) / (2 * (CEIL_TOP - CEIL_SIDE))
VAULT_CY = CEIL_TOP - VAULT_R


def vault_pt(t):
    a = math.asin(HALF_W / VAULT_R) * t
    return VAULT_R * math.sin(a), VAULT_CY + VAULT_R * math.cos(a), a


def vault_y_at(x):
    return VAULT_CY + math.sqrt(max(VAULT_R ** 2 - x * x, 0))


def spans_without(a, b, holes):
    """[a, b] minus the (lo, hi) holes."""
    out, z = [], a
    for lo, hi in sorted(holes):
        if hi <= z or lo >= b:
            continue
        if lo > z:
            out.append((z, lo))
        z = max(z, hi)
    if z < b:
        out.append((z, b))
    return out


# ---------------------------------------------------------------- shell
def shell(C):
    floor = MB("STATIC_floor")
    sh = MB("STATIC_shell")
    floor.prism([(-HALF_W, Z_FRONT), (HALF_W, Z_FRONT), (HALF_W, Z_BACK), (-HALF_W, Z_BACK)], 0.12,
                center=(0, -0.06, 0), mat="Planks", plane='xz', grain='z')
    depth = Z_FRONT - Z_BACK
    zc = (Z_FRONT + Z_BACK) / 2
    pz, py = PORTHOLE
    n = 12
    for sx in (-1, 1):
        for i in range(n):
            y0, y1 = CEIL_SIDE * i / n, CEIL_SIDE * (i + 1) / n
            x0, x1 = hull_x(y0) + 0.06, hull_x(y1) + 0.06
            ym, xm = (y0 + y1) / 2, (x0 + x1) / 2
            h = math.hypot(y1 - y0, x1 - x0) + 0.004
            roll = math.degrees(math.atan2(x1 - x0, y1 - y0)) * -sx
            holes = [(pz - 0.4, pz + 0.4)] if sx == 1 and abs(ym - py) < 0.34 else []
            for a, b in spans_without(Z_BACK, Z_FRONT, holes):
                sh.box((0.08, h, b - a), (sx * xm, ym, (a + b) / 2), "WallPlanks", roll=roll, grain='z')
    # the porthole
    win = MB("STATIC_portholes")
    glass = MB("Window_glass", smooth_angle=0)
    x = hull_x(py) + 0.06
    with win.frame((x, py, pz), yaw=-90):
        ring_plate(win, PORT_R + 0.02, 0.46, 0.1, "WallPlanks")
        win.torus(PORT_R + 0.03, 0.035, (0, 0, -0.06), "Brass", seg=28, rseg=8)
        win.torus(PORT_R + 0.02, 0.022, (0, 0, 0.05), "Brass", seg=28, rseg=6)
        for k in range(8):
            a = 2 * math.pi * k / 8 + 0.2
            win.sphere(0.014, ((PORT_R + 0.085) * math.cos(a), (PORT_R + 0.085) * math.sin(a), -0.085), "Brass", segs=6, rings=4)
    with glass.frame((x, py, pz), yaw=-90):
        disc(glass, PORT_R + 0.01, 0.0, "Glass")
    # ribs on the hull and across the vault
    for zr in (-1.6, 0.0, 1.6):
        for sx in (-1, 1):
            m = 9
            for i in range(m):
                y0, y1 = CEIL_SIDE * i / m, CEIL_SIDE * (i + 1) / m
                x0, x1 = hull_x(y0) - 0.02, hull_x(y1) - 0.02
                h = math.hypot(y1 - y0, x1 - x0) + 0.01
                roll = math.degrees(math.atan2(x1 - x0, y1 - y0)) * -sx
                sh.box((0.12, h, 0.14), (sx * (x0 + x1) / 2, (y0 + y1) / 2, zr), "DarkWood", roll=roll, bevel=0.01)
        arc_boxes(sh, -0.12, 0.16, zr, "DarkWood")
    # vault planks fore-aft, leaving the skylight open
    sxc, szc = SKY_C
    n = 16
    for i in range(n):
        xa, ya, aa = vault_pt(-1 + 2 * i / n)
        xb, yb, ab = vault_pt(-1 + 2 * (i + 1) / n)
        w = math.hypot(xb - xa, yb - ya) + 0.004
        roll = -math.degrees((aa + ab) / 2)
        holes = [(szc - SKY_HALF, szc + SKY_HALF)] if abs((xa + xb) / 2 - sxc) < SKY_HALF else []
        for z0, z1 in spans_without(Z_BACK, Z_FRONT, holes):
            sh.box((w, 0.06, z1 - z0), ((xa + xb) / 2 + 0.03 * math.sin((aa + ab) / 2), (ya + yb) / 2 + 0.03 * math.cos((aa + ab) / 2), (z0 + z1) / 2),
                   "WallPlanks", roll=roll, grain='z')
    # the ridge beam stops at the skylight
    for z0, z1 in spans_without(Z_BACK, Z_FRONT, [(szc - SKY_HALF - 0.05, szc + SKY_HALF + 0.05)]):
        sh.box((0.16, 0.12, z1 - z0), (0, CEIL_TOP - 0.06, (z0 + z1) / 2), "DarkWood", bevel=0.015, grain='z')
    # back wall with the three gallery windows; front wall with the door
    W = 2 * HALF_W + 0.6
    xs = sorted([(cx - w / 2, cx + w / 2) for cx, w in WINDOWS])
    sh.box((W, WIN_Y0, 0.12), (0, WIN_Y0 / 2, Z_BACK - 0.06), "WallPlanks", grain='y')
    top = CEIL_TOP + 0.1
    sh.box((W, top - WIN_Y1, 0.12), (0, (WIN_Y1 + top) / 2, Z_BACK - 0.06), "WallPlanks", grain='y')
    for a, b in spans_without(-W / 2, W / 2, xs):
        sh.box((b - a, WIN_Y1 - WIN_Y0, 0.12), ((a + b) / 2, (WIN_Y0 + WIN_Y1) / 2, Z_BACK - 0.06), "WallPlanks", grain='y')
    # the front wall and its door (the way back to the cabin)
    DW, DH = 0.9, 2.05
    for a, b in spans_without(-W / 2, W / 2, [(-DW / 2, DW / 2)]):
        sh.box((b - a, top, 0.12), ((a + b) / 2, top / 2, Z_FRONT + 0.06), "WallPlanks", grain='y')
    sh.box((DW, top - DH, 0.12), (0, (DH + top) / 2, Z_FRONT + 0.06), "WallPlanks", grain='y')
    for sx in (-1, 1):
        sh.box((0.1, DH + 0.1, 0.18), (sx * (DW / 2 + 0.05), (DH + 0.1) / 2, Z_FRONT + 0.02), "Mahogany", bevel=0.012)
    sh.box((DW + 0.3, 0.12, 0.2), (0, DH + 0.06, Z_FRONT + 0.02), "Mahogany", bevel=0.015, grain='x')
    # the door itself, ajar into the passage (dark beyond)
    with sh.frame((-DW / 2 + 0.02, 0, Z_FRONT + 0.1), yaw=-62):
        sh.box((DW - 0.06, DH - 0.04, 0.05), ((DW - 0.06) / 2, (DH - 0.04) / 2 + 0.01, 0.03), "Mahogany", bevel=0.01, grain='y')
        for yy in (0.35, 1.0, 1.65):
            sh.box((DW - 0.2, 0.08, 0.02), ((DW - 0.06) / 2, yy, 0.065), "DarkWood", bevel=0.006, grain='x')
        sh.sphere(0.03, (DW - 0.16, 1.0, 0.08), "Brass", segs=10, rings=6)
    sh.box((DW + 0.1, DH, 0.05), (0, DH / 2, Z_FRONT + 1.0), "DarkWood", grain='y')   # passage wall beyond
    for sx in (-1, 1):
        sh.box((0.05, DH, 0.9), (sx * (DW / 2 + 0.03), DH / 2, Z_FRONT + 0.55), "DarkWood", grain='y')
    # skirting
    for sx in (-1, 1):
        sh.box((0.06, 0.14, depth), (sx * (hull_x(0.07) - 0.01), 0.07, zc), "DarkWood", grain='z')
    empty("DOOR_front", (0, 0, Z_FRONT), collection=C)
    return [floor.build(collection=C), sh.build(collection=C), win.build(collection=C)] + windows(C, glass)


def windows(C, glass):
    """The gallery windows: frames with mullions and a deep sill, glass and the painted sky behind."""
    f = MB("STATIC_windows")
    z = Z_BACK - 0.06
    for cx, w in WINDOWS:
        h = WIN_Y1 - WIN_Y0
        for sx in (-1, 1):
            f.box((0.07, h + 0.08, 0.16), (cx + sx * (w / 2 - 0.01), (WIN_Y0 + WIN_Y1) / 2, z), "Mahogany", bevel=0.012)
        f.box((w + 0.06, 0.08, 0.16), (cx, WIN_Y1, z), "Mahogany", bevel=0.012, grain='x')
        f.box((w + 0.16, 0.06, 0.34), (cx, WIN_Y0 - 0.02, z + 0.08), "Mahogany", bevel=0.015, grain='x')   # sill
        # mullions: one upright, three bars
        f.box((0.03, h, 0.05), (cx, (WIN_Y0 + WIN_Y1) / 2, z - 0.02), "DarkWood")
        for k in (1, 2, 3):
            f.box((w, 0.03, 0.05), (cx, WIN_Y0 + h * k / 4, z - 0.02), "DarkWood", grain='x')
        glass.quad([(cx - w / 2, WIN_Y0, z - 0.04), (cx + w / 2, WIN_Y0, z - 0.04), (cx + w / 2, WIN_Y1, z - 0.04), (cx - w / 2, WIN_Y1, z - 0.04)], "Glass")
    return [f.build(collection=C)]


def skylight(C):
    """A raised square light in the vault over the table: coaming, a glazed lantern with crossed bars."""
    s = MB("STATIC_skylight")
    sx, sz = SKY_C
    y = vault_y_at(SKY_HALF) - 0.02
    o, t, up = SKY_HALF, 0.05, 0.55
    with s.frame((sx, y, sz)):
        for px, pz, w, d in ((1, 0, t, 2 * o), (-1, 0, t, 2 * o), (0, 1, 2 * o, t), (0, -1, 2 * o, t)):
            s.box((w, up, d), (px * (o - t / 2), up / 2, pz * (o - t / 2)), "DarkWood", grain='y')
        for px in (-1, 1):
            s.box((0.08, 0.07, 2 * o + 0.16), (px * (o + 0.04), -0.02, 0), "Mahogany", bevel=0.01, grain='z')
            s.box((2 * o + 0.16, 0.07, 0.08), (0, -0.02, px * (o + 0.04)), "Mahogany", bevel=0.01, grain='x')
        # glazing bars at the top
        s.box((0.035, 0.05, 2 * o), (0, up, 0), "Brass", grain='z')
        s.box((2 * o, 0.05, 0.035), (0, up, 0), "Brass", grain='x')
        s.box((2 * o, 0.04, 0.04), (0, up, o - 0.02), "Brass", grain='x')
        s.box((2 * o, 0.04, 0.04), (0, up, -o + 0.02), "Brass", grain='x')
    ob = s.build(collection=C)
    g = MB("Skylight_glass", smooth_angle=0)
    gy = y + up - 0.01
    g.quad([(sx - o, gy, sz + o), (sx + o, gy, sz + o), (sx + o, gy, sz - o), (sx - o, gy, sz - o)], "Glass")
    g.build(collection=C)
    # the sky above it (the app draws it: dusk, then night with his star)
    k = MB("Skylight_sky", smooth_angle=0)
    ky = gy + 0.45
    r = 1.6
    k.quad([(sx - r, ky, sz - r), (sx + r, ky, sz - r), (sx + r, ky, sz + r), (sx - r, ky, sz + r)], "SkyBackdrop")
    k.build(collection=C)
    # the star: a little off centre, so it sits in one pane
    empty("Star", (sx + 0.2, ky - 0.01, sz - 0.18), collection=C)
    log(f"skylight at y {y:.2f}, sky at {ky:.2f}")
    return [ob]


def sky_backdrops(C):
    """The painted sky beyond the gallery windows (the app draws the cabin's sky on it)."""
    m = MB("Sky_backdrop_back", smooth_angle=0)
    z = Z_BACK - 1.4
    w, y0, y1 = 6.0, -0.4, 3.4
    m.quad([(-w / 2, y0, z), (w / 2, y0, z), (w / 2, y1, z), (-w / 2, y1, z)], "SkyBackdrop")
    p = MB("Sky_backdrop_port", smooth_angle=0)
    pz, py = PORTHOLE
    x = hull_x(py) + 0.9
    with p.frame((x, py, pz), yaw=-90):
        disc(p, 0.9, 0.0, "SkyBackdrop", n=24)
    return [m.build(collection=C), p.build(collection=C)]


def arc_boxes(mb, inset, h, z, mat, n=14, d=0.16):
    for i in range(n):
        xa, ya, aa = vault_pt(-1 + 2 * i / n)
        xb, yb, ab = vault_pt(-1 + 2 * (i + 1) / n)
        am = (aa + ab) / 2
        w = math.hypot(xb - xa, yb - ya) + 0.01
        mb.box((w, h, d), ((xa + xb) / 2 + inset * math.sin(am), (ya + yb) / 2 + inset * math.cos(am), z),
               mat, roll=-math.degrees(am), bevel=0.012)


def ring_plate(mb, r, half, depth, mat, n=32):
    tb = bmesh.new()
    front, back = [], []
    for k in range(n):
        a = 2 * math.pi * k / n
        c, s = math.cos(a), math.sin(a)
        m = half / max(abs(c), abs(s))
        for z, ring in ((depth / 2, front), (-depth / 2, back)):
            ring.append((tb.verts.new((r * c, r * s, z)), tb.verts.new((m * c, m * s, z))))
    for k in range(n):
        j = (k + 1) % n
        tb.faces.new((front[k][0], front[k][1], front[j][1], front[j][0]))
        tb.faces.new((back[j][0], back[j][1], back[k][1], back[k][0]))
        tb.faces.new((front[j][0], back[j][0], back[k][0], front[k][0]))
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    mb.raw(tb, mat)


def disc(mb, r, z, mat, n=28):
    tb = bmesh.new()
    vs = [tb.verts.new((r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n), z)) for k in range(n)]
    tb.faces.new(vs)
    uvl = tb.loops.layers.uv.new('UVMap')
    for f in tb.faces:
        for l in f.loops:
            l[uvl].uv = (0.5 + l.vert.co.x / (2 * r), 0.5 + l.vert.co.y / (2 * r))
    mb.raw(tb, mat, uv=None, smooth=False)


# ---------------------------------------------------------------- his chart table
def chart_table(C):
    t = MB("STATIC_table")
    dyn = MB("PROP_desk_lit")           # small brass things, lit by the app
    x, _, z = TABLE_C
    W, D, y = TABLE_W, TABLE_D, TABLE_TOP
    t.box((W, 0.06, D), (x, y - 0.03, z), "Mahogany", bevel=0.014, grain='x')
    t.box((W + 0.04, 0.03, 0.04), (x, y + 0.012, z + D / 2 + 0.005), "Mahogany", bevel=0.008, grain='x')   # chart lip
    # a cabinet base: two banks of shallow drawers, open knee space on his side
    for sx in (-1, 1):
        bx = x + sx * (W / 2 - 0.3)
        t.box((0.56, y - 0.12, D - 0.1), (bx, (y - 0.12) / 2 + 0.03, z), "Mahogany", bevel=0.01)
        for k in range(5):
            yy = 0.14 + k * (y - 0.3) / 5 + 0.06
            t.box((0.5, (y - 0.3) / 5 - 0.03, 0.02), (bx, yy, z + (D - 0.1) / 2 + 0.01), "DarkWood", bevel=0.005, grain='x')
            t.sphere(0.014, (bx, yy, z + (D - 0.1) / 2 + 0.03), "Brass", segs=8, rings=4)
    t.box((W - 1.2, 0.08, D - 0.2), (x, y - 0.1, z), "Mahogany", grain='x')
    t.box((W, 0.06, D), (x, 0.03, z), "DarkWood", bevel=0.01, grain='x')
    # the great chart spread on the table, weighted at the corners
    desk.sea_chart(t, (x - 0.05, y, z + 0.02), w=0.95, d=0.64, yaw=3)
    for cx, cz in ((-0.5, -0.29), (0.42, -0.31), (-0.48, 0.33), (0.4, 0.35)):
        t.cyl(0.03, 0.035, (x + cx, y + 0.018, z + cz), "Brass", segs=10, bevel=0.004)
    # dividers, parallel rule, sextant case, compass, the table lantern
    with dyn.frame((x + 0.15, y + 0.004, z + 0.05), yaw=25):
        for s in (-1, 1):
            dyn.box((0.006, 0.004, 0.2), (s * 0.012, 0.004, 0.0), "Brass", yaw=s * 6)
        dyn.cyl(0.012, 0.01, (0, 0.006, -0.1), "Brass", segs=10)
    with t.frame((x - 0.22, y, z + 0.2), yaw=-12):
        for s in (-1, 1):
            t.box((0.38, 0.012, 0.045), (0, 0.006, s * 0.04), "DarkWood", bevel=0.003, grain='x')
        for s in (-1, 1):
            t.box((0.01, 0.008, 0.1), (s * 0.12, 0.014, 0), "Brass")
    desk.compass(dyn, (x + 0.55, y + 0.0012, z + 0.25))
    desk.spyglass(t, (x - 0.6, y, z - 0.32), yaw=20)
    desk.rolled_chart(t, (x + 0.62, y, z - 0.25), length=0.5, yaw=80)
    desk.rolled_chart(t, (x + 0.7, y + 0.05, z - 0.22), length=0.45, yaw=74)
    desk.inkwell_and_quill(t, (x - 0.7, y, z + 0.28), yaw=20, dyn=dyn)
    # the sextant, in its open box at the table's right end
    sx_, sz_ = x + 0.62, z + 0.05
    t.box((0.28, 0.07, 0.24), (sx_, y + 0.035, sz_), "Mahogany", bevel=0.006)
    t.box((0.24, 0.02, 0.2), (sx_, y + 0.065, sz_), "Cloth", bevel=0.004)
    with dyn.frame((sx_, y + 0.09, sz_), yaw=10):
        dyn.torus(0.1, 0.006, (0, 0, 0), "Brass", axis='y', seg=20, rseg=4, arc=70, a0=55)
        for a in (55, 125):
            r = math.radians(a)
            dyn.box((0.006, 0.006, 0.1), (0.05 * math.cos(r), 0, -0.05 * math.sin(r)), "Brass", yaw=90 - a)
        dyn.cyl(0.008, 0.07, (0.0, 0.01, -0.02), "Brass", axis='x', segs=8)
    lx, lz = x - 0.55, z - 0.05
    t.cyl(0.075, 0.02, (lx, y + 0.01, lz), "Brass", segs=12, bevel=0.004)
    t.cyl(0.06, 0.02, (lx, y + 0.24, lz), "Brass", segs=12, r2=0.03, bevel=0.003)
    t.torus(0.035, 0.006, (lx, y + 0.3, lz), "Brass", axis='z', seg=12, rseg=5)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        t.box((0.012, 0.21, 0.012), (lx + 0.06 * math.cos(a), y + 0.125, lz + 0.06 * math.sin(a)), "Brass")
    t.cyl(0.052, 0.2, (lx, y + 0.125, lz), "LanternGlow", segs=12)
    t.cyl(0.012, 0.06, (lx, y + 0.06, lz), "Candle", segs=8)
    t.sphere(0.012, (lx, y + 0.105, lz), "LanternFlame", segs=6, rings=4, sy=1.8)
    # his tall stool, pushed back to his left
    cx, cz = x - 0.85, z - 0.85
    t.cyl(0.18, 0.05, (cx, 0.72, cz), "Mahogany", segs=14, bevel=0.01)
    t.cyl(0.16, 0.04, (cx, 0.76, cz), "Leather", segs=14, bevel=0.012)
    for k in range(3):
        a_ = math.radians(30 + 120 * k)
        t.cyl(0.02, 0.72, (cx + 0.12 * math.cos(a_), 0.36, cz + 0.12 * math.sin(a_)), "Mahogany", segs=8,
              roll=-7 * math.cos(a_), pitch=7 * math.sin(a_))
    t.torus(0.15, 0.012, (cx, 0.28, cz), "Mahogany", axis='y', seg=18, rseg=4)
    ob = t.build(collection=C)
    dyn.build(collection=C)
    return [ob]


# ---------------------------------------------------------------- walls and corners
def chart_cabinet(C):
    """Left wall: a plan chest of flat drawers, pigeonholes of rolled charts above it."""
    c = MB("STATIC_cabinet")
    rnd = random.Random(7)
    lx = -(hull_x(1.0) - 0.05)
    with c.frame((lx, 0, -0.3), yaw=90):       # local +Z = into the room, x along the wall (toward the back is -x)
        L, Dp, H = 2.6, 0.55, 0.95
        c.box((L, H, Dp), (0, H / 2, Dp / 2), "Mahogany", bevel=0.012)
        c.box((L + 0.08, 0.05, Dp + 0.05), (0, H + 0.025, Dp / 2 + 0.01), "Mahogany", bevel=0.01, grain='x')
        for col in (-1, 0, 1):
            for k in range(6):
                yy = 0.1 + k * 0.135 + 0.06
                c.box((0.8, 0.11, 0.02), (col * 0.85, yy, Dp + 0.005), "DarkWood", bevel=0.004, grain='x')
                c.box((0.12, 0.02, 0.02), (col * 0.85, yy, Dp + 0.02), "Brass", bevel=0.003, grain='x')
        # pigeonholes: a grid of square cells, each with a few rolled charts
        PH, PD = 1.15, 0.36
        y0 = H + 0.05
        c.box((L, PH, 0.03), (0, y0 + PH / 2, 0.015), "DarkWood")
        cols, rows = 8, 4
        cw, ch = L / cols, PH / rows
        for i in range(cols + 1):
            c.box((0.025, PH, PD), (-L / 2 + i * cw, y0 + PH / 2, PD / 2), "Mahogany")
        for j in range(rows + 1):
            c.box((L, 0.025, PD), (0, y0 + j * ch, PD / 2), "Mahogany", grain='x')
        for i in range(cols):
            for j in range(rows):
                cx, cy = -L / 2 + (i + 0.5) * cw, y0 + j * ch
                for _ in range(rnd.randint(1, 4)):
                    r = rnd.uniform(0.02, 0.034)
                    px = cx + rnd.uniform(-cw / 2 + r + 0.02, cw / 2 - r - 0.02)
                    py = cy + 0.0125 + r + rnd.uniform(0, ch - 2 * r - 0.06)
                    c.cyl(r, PD + rnd.uniform(-0.04, 0.06), (px, py, PD / 2 + 0.02), rnd.choice(["Parchment", "Parchment", "Sailcloth"]),
                          axis='z', segs=10)
                    c.cyl(r * 0.96, 0.002, (px, py, PD + 0.05), "PageEdge", axis='z', segs=10)
    return [c.build(collection=C)]


def right_wall(C):
    """A framed star chart, the chronometer on a little shelf, a barometer."""
    r = MB("STATIC_rightwall")
    xw = hull_x(1.5) - 0.04
    with r.frame((xw, 0, -1.25), yaw=-90):     # local +Z into the room
        # the star chart: a dark-blue sheet in a gilt frame
        cy = 1.55
        r.box((1.0, 0.75, 0.03), (0, cy, 0.0), "Mahogany", bevel=0.01)
        r.box((0.9, 0.65, 0.01), (0, cy, 0.02), "StarChart")
        for s in (-1, 1):
            r.box((1.02, 0.03, 0.035), (0, cy + s * 0.37, 0.01), "Gilt", grain='x')
            r.box((0.03, 0.76, 0.035), (s * 0.5, cy, 0.01), "Gilt")
        # chronometer shelf
        r.box((0.55, 0.04, 0.26), (0, 0.95, 0.13), "Mahogany", bevel=0.008, grain='x')
        for s in (-1, 1):
            r.prism([(0, 0), (0.2, 0), (0, -0.2)], 0.03, (s * 0.22, 0.93, 0.0), "Mahogany", plane='xy', yaw=-90)
        r.box((0.2, 0.14, 0.2), (0, 1.04, 0.13), "Mahogany", bevel=0.008)
        r.cyl(0.075, 0.012, (0, 1.115, 0.13), "Brass", segs=20, bevel=0.003)
        r.cyl(0.065, 0.002, (0, 1.122, 0.13), "Parchment", segs=20)
    with r.frame((hull_x(1.5) - 0.04, 0, 1.75), yaw=-90):
        r.box((0.12, 0.6, 0.04), (0, 1.5, 0.02), "Mahogany", bevel=0.01)
        r.cyl(0.07, 0.03, (0, 1.62, 0.05), "Brass", axis='z', segs=16, bevel=0.004)
        r.cyl(0.06, 0.002, (0, 1.62, 0.066), "Parchment", axis='z', segs=16)
        r.cyl(0.012, 0.35, (0, 1.38, 0.05), "Glass", segs=8)
    return [r.build(collection=C)]


def corners(C):
    p = MB("STATIC_props")
    rnd = random.Random(3)
    x, _, z = TABLE_C
    # rugs under the table and by the door
    p.box((2.5, 0.012, 1.9), (x, 0.006, z - 0.25), "RugBlue", bevel=0.004)
    p.box((2.3, 0.014, 1.7), (x, 0.007, z - 0.25), "RugBorder")
    p.box((2.2, 0.016, 1.6), (x, 0.008, z - 0.25), "RugBlue")
    p.box((1.2, 0.012, 0.7), (0, 0.006, 1.7), "RugRed", bevel=0.004)
    # armillary sphere on a stand, front right
    gx, gz = 1.35, 1.45
    p.cyl(0.2, 0.04, (gx, 0.02, gz), "Mahogany", segs=14, bevel=0.006)
    p.cyl(0.03, 0.8, (gx, 0.42, gz), "Mahogany", segs=8)
    p.cyl(0.06, 0.06, (gx, 0.84, gz), "Brass", segs=10)
    gy = 1.15
    p.torus(0.26, 0.01, (gx, gy, gz), "Brass", axis='z', seg=28, rseg=5)
    p.torus(0.26, 0.01, (gx, gy, gz), "Brass", axis='x', seg=28, rseg=5)
    p.torus(0.26, 0.01, (gx, gy, gz), "Brass", axis='y', seg=28, rseg=5)
    p.torus(0.255, 0.018, (gx, gy, gz), "Gilt", axis='z', seg=28, rseg=5, roll=23)
    p.cyl(0.006, 0.62, (gx, gy, gz), "Brass", segs=6, roll=23)
    p.sphere(0.06, (gx, gy, gz), "Brass", segs=12, rings=8)
    # sea chest, front left, with a coat thrown over it and a pile of logbooks
    cx, cz = -1.35, 1.6
    p.box((0.85, 0.46, 0.5), (cx, 0.23, cz), "Mahogany", bevel=0.02, yaw=12)
    p.box((0.87, 0.06, 0.52), (cx, 0.48, cz), "DarkWood", bevel=0.02, yaw=12)
    for k in (-0.28, 0.28):
        p.box((0.05, 0.48, 0.53), (cx + k * math.cos(math.radians(12)), 0.24, cz - k * math.sin(math.radians(12))), "Iron", yaw=12)
    for i, (w_, th, mt) in enumerate(((0.26, 0.05, "BookBlue"), (0.24, 0.045, "BookRed"), (0.22, 0.04, "Leather"))):
        p.box((w_, th, 0.18), (cx + 0.15, 0.51 + 0.05 * i + th / 2, cz), mt, bevel=0.004, yaw=rnd.uniform(-15, 15))
    # coiled line by the door, a bucket of rolled charts at the table's foot
    p.torus(0.17, 0.035, (1.5, 0.035, 2.05), "Sailcloth", axis='y', seg=20, rseg=6)
    p.torus(0.13, 0.035, (1.5, 0.09, 2.05), "Sailcloth", axis='y', seg=20, rseg=6)
    p.cyl(0.15, 0.4, (1.05, 0.2, -1.8), "Leather", segs=12, r2=0.17)
    for k in range(6):
        a = 2 * math.pi * k / 6
        p.cyl(0.026, 0.7, (1.05 + 0.07 * math.cos(a), 0.45, -1.8 + 0.07 * math.sin(a)), "Parchment", segs=8,
              roll=7 * math.cos(a), pitch=7 * math.sin(a))
    ob = p.build(collection=C)
    # hanging lantern from the ridge, between the skylight and the door (swings with the ship)
    hx, hz = 0.0, 0.75
    h = MB("STATIC_hanging_lantern")
    h.cyl(0.006, 0.6, (hx, CEIL_TOP - 0.36, hz), "Iron", segs=5)
    h.cyl(0.09, 0.03, (hx, CEIL_TOP - 0.68, hz), "Brass", segs=12, r2=0.05)
    h.cyl(0.07, 0.24, (hx, CEIL_TOP - 0.82, hz), "LanternGlow", segs=12)
    h.cyl(0.085, 0.025, (hx, CEIL_TOP - 0.95, hz), "Brass", segs=12)
    h.sphere(0.014, (hx, CEIL_TOP - 0.84, hz), "LanternFlame", segs=6, rings=4, sy=1.8)
    return [ob, h.build(collection=C)]


def contract_nodes(C):
    ux, uz = UGURCAN
    nodes = [empty("Ugurcan", (ux, 0, uz), yaw=0, collection=C)]

    def cam(name, pos, tgt):
        d = Vector(tgt) - Vector(pos)
        yaw = math.degrees(math.atan2(-d.x, -d.z))
        pitch = math.degrees(math.atan2(d.y, math.hypot(d.x, d.z)))
        e = empty(name, pos, yaw=yaw, pitch=pitch, collection=C, kind='SINGLE_ARROW')
        e["target"] = list(tgt)
        return e
    nodes += [cam("Camera_main", (0.25, 1.62, 1.75), (0.0, 1.25, -1.6)),
              cam("Camera_table", (0.35, 1.75, 0.55), (0.0, 0.9, -0.75)),
              cam("Camera_sky", (0.3, 1.35, 0.9), (0.0, 3.6, -0.75)),
              cam("Camera_window", (0.4, 1.55, 0.4), (0.0, 1.55, -2.6))]
    return nodes


# ---------------------------------------------------------------- lighting
def light(name, kind, energy, color, loc=None, direction=None, size=0.1, angle=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy, ld.color = energy, color
    if kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    if kind == 'AREA':
        ld.size = size
    if kind == 'SUN' and angle is not None:
        ld.angle = math.radians(angle)
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob["rig"] = 1
    if loc is not None:
        ob.location = T(*loc)
    if direction is not None:
        ob.rotation_euler = T(*direction).normalized().to_track_quat('-Z', 'Y').to_euler()
    return ob


MODES = ("sunset", "night")
RIGS = {
    "sunset": dict(world=((1.0, 0.6, 0.45), 0.6), sun=(5.0, (1.0, 0.58, 0.3)), win=(110, (1.0, 0.66, 0.6)), sky=(60, (0.95, 0.7, 0.75)),
                   room=(110, (0.72, 0.6, 0.86)), front=(70, (0.85, 0.7, 0.8)), lanterns=(25, 55)),
    "night":  dict(world=((0.12, 0.16, 0.32), 0.1), sun=(0.6, (0.55, 0.65, 1.0)), win=(30, (0.45, 0.55, 1.0)), sky=(40, (0.5, 0.6, 1.0)),
                   room=(14, (0.45, 0.5, 0.85)), front=(8, (0.5, 0.55, 0.85)), lanterns=(70, 140)),
}


def rig(mode="sunset"):
    for o in list(bpy.data.objects):
        if o.get("rig"):
            bpy.data.objects.remove(o)
    R = RIGS[mode]
    w = bpy.data.worlds.get("Sky") or bpy.data.worlds.new("Sky")
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    col, strength = R["world"]
    bg.inputs["Color"].default_value = (*col, 1)
    bg.inputs["Strength"].default_value = strength
    # the low sun (or the moon) through the gallery windows, a little from the right
    light("Sun", 'SUN', R["sun"][0], R["sun"][1], direction=(-0.25, -0.3, 1.0), angle=2)
    for cx, wd in WINDOWS:
        light(f"WinFill{cx}", 'AREA', R["win"][0], R["win"][1], loc=(cx, (WIN_Y0 + WIN_Y1) / 2, Z_BACK - 0.4), direction=(0, -0.1, 1), size=wd)
    sx, sz = SKY_C
    light("SkyFill", 'AREA', R["sky"][0], R["sky"][1], loc=(sx, vault_y_at(0) + 0.6, sz), direction=(0, -1, 0), size=0.9)
    pz, py = PORTHOLE
    light("PortFill", 'AREA', R["win"][0] * 0.4, R["win"][1], loc=(hull_x(py) + 0.4, py, pz), direction=(-1, -0.15, 0), size=0.6)
    light("RoomFill", 'AREA', R["room"][0], R["room"][1], loc=(0, CEIL_TOP - 0.15, 1.0), direction=(0, -1, 0), size=3.0)
    light("FrontFill", 'AREA', R["front"][0], R["front"][1], loc=(0, 1.8, Z_FRONT - 0.2), direction=(0, -0.2, -1), size=2.5)
    x, _, z = TABLE_C
    light("TableLantern", 'POINT', R["lanterns"][0], (1.0, 0.55, 0.22), loc=(x - 0.55, TABLE_TOP + 0.12, z - 0.05), size=0.04)
    light("HangingLantern", 'POINT', R["lanterns"][1], (1.0, 0.58, 0.25), loc=(0.0, CEIL_TOP - 0.82, 0.75), size=0.05)


def cycles(samples, denoise=True):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for kind in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type != 'CPU']
                if gpus:
                    for d in prefs.devices:
                        d.use = True
                    cy.device = 'GPU'
                    break
            except Exception:
                continue
    except Exception as e:
        log("GPU setup failed:", e)
    log("cycles device", cy.device)
    cy.samples = samples
    cy.use_denoising = denoise
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 6, 4, 2
    sc.view_settings.view_transform = 'AgX'


# ---------------------------------------------------------------- bake
LM_SCALE = 3.0
LM_RES = 2048


def bake(statics, samples, mode="sunset"):
    import numpy as np
    import time
    cycles(samples, denoise=False)
    rig(mode)
    img = bpy.data.images.new("LM_bake", LM_RES, LM_RES, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    for o in statics:
        for slot in o.material_slots:
            nt = slot.material.node_tree
            n = nt.nodes.get("LM_BAKE") or nt.nodes.new("ShaderNodeTexImage")
            n.name = "LM_BAKE"
            n.image = img
            for x in nt.nodes:
                x.select = False
            n.select = True
            nt.nodes.active = n
    hidden = []
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name.startswith(("Sky_backdrop", "Skylight_sky", "Window_glass", "Skylight_glass", "PROP_")):
            o.hide_render = True
            hidden.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in statics:
        o.select_set(True)
        o.data.uv_layers.active = o.data.uv_layers["Lightmap"]
    bpy.context.view_layer.objects.active = statics[0]
    t0 = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True, target='IMAGE_TEXTURES')
    px = np.empty(LM_RES * LM_RES * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(LM_RES, LM_RES, 4)
    lin, cover = px[..., :3].copy(), px[..., 3] > 0.5
    lin = denoise(lin, cover)
    log(f"{mode} baked in {time.time() - t0:.0f}s, coverage {cover.mean():.2f}, lum p50 {np.percentile(lin[cover].mean(1), 50):.3f}")
    for o in hidden:
        o.hide_render = False
    for o in statics:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        for slot in o.material_slots:
            nt = slot.material.node_tree
            if nt.nodes.get("LM_BAKE"):
                nt.nodes.remove(nt.nodes["LM_BAKE"])
    bpy.data.images.remove(img)
    return lin


def denoise(px, cover, sigma=1.6):
    import numpy as np
    r = int(3 * sigma)
    k = np.array([math.exp(-(i * i) / (2 * sigma * sigma)) for i in range(-r, r + 1)], np.float32)
    k /= k.sum()

    def blur(a):
        out = np.zeros_like(a)
        for i, w in enumerate(k):
            out += w * np.roll(a, i - r, axis=0)
        out2 = np.zeros_like(out)
        for i, w in enumerate(k):
            out2 += w * np.roll(out, i - r, axis=1)
        return out2
    m = cover[..., None].astype(np.float32)
    num, den = blur(px * m), blur(m)
    res = np.where(den > 1e-3, num / np.maximum(den, 1e-3), px)
    return np.where(m > 0, res, px)


def save_lightmap(lin, path, size, quality=82):
    import numpy as np
    enc = np.clip(lin / LM_SCALE, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    out = bpy.data.images.new("LM_out", LM_RES, LM_RES, alpha=False)
    rgba = np.ones((LM_RES, LM_RES, 4), np.float32)
    rgba[..., :3] = enc
    out.pixels.foreach_set(rgba.ravel())
    if size != LM_RES:
        out.scale(size, size)
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format, st.color_mode, st.quality = 'WEBP', 'RGB', quality
    out.save_render(path, scene=sc)
    bpy.data.images.remove(out)
    log(f"wrote {os.path.basename(path)} {os.path.getsize(path) / 1024:.0f} KB")


def preview(samples=48):
    """Cycles renders from the contract cameras -> blender/out/chartroom/previews/."""
    cycles(samples, denoise=True)
    rig()
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    cam_d = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    os.makedirs(os.path.join(OUT, "previews"), exist_ok=True)
    for name, lens in (("Camera_main", 22), ("Camera_table", 26), ("Camera_sky", 20), ("Camera_window", 24)):
        e = bpy.data.objects[name]
        bpy.context.view_layer.update()
        cam.matrix_world = e.matrix_world @ Matrix.Rotation(math.radians(90), 4, 'X')
        cam_d.lens = lens
        sc.render.filepath = os.path.join(OUT, "previews", f"{name}.png")
        bpy.ops.render.render(write_still=True)
        log("rendered", name)


# ---------------------------------------------------------------- main
def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return {"bake": "--no-bake" not in a, "preview": "--preview" in a,
            "samples": int(a[a.index("--samples") + 1]) if "--samples" in a else 128}


def add_materials():
    """Room-only materials, on top of the kit's (a deep-blue star chart sheet)."""
    materials.SPECS["StarChart"] = (None, 0, 1, (0.06, 0.09, 0.2), 0.85, 0.0)


def main():
    opt = args()
    util.reset()
    add_materials()
    materials.init_all()
    C = bpy.data.collections.new("Room")
    bpy.context.scene.collection.children.link(C)
    objs = shell(C)
    objs += skylight(C)
    objs += chart_table(C)
    objs += chart_cabinet(C)
    objs += right_wall(C)
    objs += corners(C)
    objs += contract_nodes(C)
    objs += sky_backdrops(C)
    statics = lightmap.statics()
    tris = 0
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    log(f"{len(statics)} static meshes, {tris} triangles total")
    lightmap.make_uvs(statics)
    os.makedirs(OUT, exist_ok=True)
    if opt["bake"]:
        os.makedirs(ASSETS, exist_ok=True)
        meta = {}
        for mode in MODES:
            lin = bake(statics, opt["samples"], mode)
            save_lightmap(lin, os.path.join(ASSETS, f"chartroom_lightmap_{mode}.webp"), 2048)
            meta[mode] = {"file": f"chartroom_lightmap_{mode}.webp", "scale": LM_SCALE, "lightMapIntensity": round(LM_SCALE * math.pi, 4), "books": [1, 1, 1]}
        with open(os.path.join(ASSETS, "chartroom_lightmaps.json"), "w") as f:
            json.dump(meta, f, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "chartroom.blend"))
    roots = [o for o in C.all_objects if o.parent is None]
    raw = os.path.join(OUT, "chartroom_raw.glb")
    export.select_tree(roots)
    bpy.ops.export_scene.gltf(filepath=raw, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_image_format='WEBP', export_image_quality=85, export_extras=True,
                              export_cameras=False, export_lights=False, export_animations=False)
    info = export.glb_info(raw)
    log(f"chartroom_raw.glb {info['bytes'] / 1024:.0f} KB, {info['tris']} tris, lightmapped: {len(info['uv1_nodes'])} meshes")
    if opt["preview"]:
        preview()


if __name__ == "__main__":
    main()
