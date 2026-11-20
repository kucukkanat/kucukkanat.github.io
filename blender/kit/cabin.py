"""The airship cabin: shell, windows, furniture, props, anchors, viewpoints, hit boxes."""
import math
import bpy
import bmesh
from mathutils import Vector, Matrix
from . import util, layout as L, materials as M
from .util import MB, empty, mat3, world_point


def coll(name):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


# ----------------------------------------------------------------- shell

def build_shell(C):
    floor = MB("STATIC_floor")
    shell = MB("STATIC_shell")
    win = MB("STATIC_windows")
    glass = MB("Window_glass", smooth_angle=0)

    # outline (x, z) of floor/ceiling
    pts = []
    n = 28
    for i in range(n + 1):
        a = -L.A_END + 2 * L.A_END * i / n
        x, _, z = L.arc_pt(a)
        pts.append((x, z))
    pts += [(L.X_HALF, L.Z_BACK), (-L.X_HALF, L.Z_BACK)]
    floor.prism(pts, 0.12, center=(0, -0.06, 0), mat="Planks", plane='xz', grain='z')
    shell.prism(pts, 0.12, center=(0, L.CEIL + 0.06, 0), mat="DarkWood", plane='xz', grain='z')

    # stern wall segments
    def seg_boxes(a0, a1):
        am = (a0 + a1) / 2
        w = 2 * (L.R + 0.06) * math.sin(math.radians(abs(a1 - a0) / 2)) + 0.012
        p = L.arc_pt(am, L.R + 0.06)
        return am, w, p

    edges = L.WIN_EDGES
    angles = []
    a = -L.A_END
    left = [-L.A_END + (edges[0] + L.A_END) * i / 6 for i in range(7)]
    for i in range(6):
        angles.append((left[i], left[i + 1], False))
    for k in range(len(edges) - 1):
        for j in range(3):
            a0 = edges[k] + (edges[k + 1] - edges[k]) * j / 3
            a1 = edges[k] + (edges[k + 1] - edges[k]) * (j + 1) / 3
            angles.append((a0, a1, True))
    right = [edges[-1] + (L.A_END - edges[-1]) * i / 6 for i in range(7)]
    for i in range(6):
        angles.append((right[i], right[i + 1], False))

    for a0, a1, is_win in angles:
        am, w, p = seg_boxes(a0, a1)
        with shell.frame(p, yaw=-am):
            if is_win:
                shell.box((w, L.SILL_Y, 0.12), (0, L.SILL_Y / 2, 0), "WallPlanks")
                h = L.CEIL - L.WIN_TOP
                shell.box((w, h, 0.12), (0, L.WIN_TOP + h / 2, 0), "WallPlanks")
            else:
                shell.box((w, L.CEIL, 0.12), (0, L.CEIL / 2, 0), "WallPlanks")
            # skirting + dado rail + header beam along the arc
            shell.box((w + 0.01, 0.12, 0.05), (0, 0.06, 0.08), "DarkWood", grain='x')
            shell.box((w + 0.01, 0.2, 0.08), (0, L.CEIL - 0.1, 0.08), "DarkWood", grain='x')
            if not is_win:
                shell.box((w + 0.01, 0.06, 0.05), (0, L.SILL_Y, 0.08), "DarkWood", grain='x')

    # window posts, sills, transoms, lattice, glass
    for k, a in enumerate(edges):
        p = L.arc_pt(a, L.R + 0.01)
        with win.frame(p, yaw=-a):
            win.box((0.13, L.CEIL - 0.1, 0.16), (0, (L.CEIL - 0.1) / 2, 0.02), "DarkWood", bevel=0.015)
            # small brass cap on the post at sill height
            win.box((0.15, 0.04, 0.18), (0, L.SILL_Y + 0.03, 0.03), "Brass", bevel=0.008)
    for k in range(len(edges) - 1):
        am = (edges[k] + edges[k + 1]) / 2
        chord = 2 * L.R * math.sin(math.radians((edges[k + 1] - edges[k]) / 2))
        w_open = chord - 0.13
        p = L.arc_pt(am, L.R)
        with win.frame(p, yaw=-am):
            # sill board
            win.box((chord + 0.06, 0.05, 0.3), (0, L.SILL_Y - 0.025, 0.1), "Mahogany", bevel=0.012, grain='x')
            # header + transom
            win.box((chord, 0.08, 0.1), (0, L.WIN_TOP + 0.04, 0.0), "DarkWood", bevel=0.01, grain='x')
            win.box((w_open + 0.02, 0.05, 0.08), (0, L.TRANSOM_Y, 0.0), "DarkWood", bevel=0.01, grain='x')
            # diamond lattice in the transom light
            y0, y1 = L.TRANSOM_Y + 0.025, L.WIN_TOP
            hw = w_open / 2
            step = 0.15
            for s in (1, -1):
                c = -hw - (y1 - y0)
                while c < hw + (y1 - y0):
                    # x = c + s*(y - y0)
                    lo, hi = y0, y1
                    if s == 1:
                        lo = max(lo, y0 + (-hw - c)); hi = min(hi, y0 + (hw - c))
                    else:
                        lo = max(lo, y0 + (c - hw)); hi = min(hi, y0 + (c + hw))
                    if hi - lo > 0.01:
                        xa, xb = c + s * (lo - y0), c + s * (hi - y0)
                        length = math.hypot(xb - xa, hi - lo)
                        win.box((0.018, length, 0.025), ((xa + xb) / 2, (lo + hi) / 2, -0.01),
                                "DarkWood", roll=-s * 45)
                    c += step
            # glass pane (whole opening)
            with glass.frame(p, yaw=-am), glass.frame((0, 0, -0.03)):
                x0, x1, ya, yb = -hw - 0.01, hw + 0.01, L.SILL_Y, L.WIN_TOP
                glass.quad([(x0, ya, 0), (x1, ya, 0), (x1, yb, 0), (x0, yb, 0)], "Glass")

    # side walls, back wall, posts
    zlen = L.Z_BACK - L.arc_pt(L.A_END)[2]
    zc = (L.Z_BACK + L.arc_pt(L.A_END)[2]) / 2
    for sx in (-1, 1):
        x = sx * (L.X_HALF + 0.06)
        shell.box((0.12, L.CEIL, zlen + 0.1), (x, L.CEIL / 2, zc), "WallPlanks")
        xi = sx * (L.X_HALF - 0.025)
        shell.box((0.05, 0.12, zlen), (xi, 0.06, zc), "DarkWood", grain='z')
        shell.box((0.05, 0.06, zlen), (xi, L.SILL_Y, zc), "DarkWood", grain='z')
        shell.box((0.08, 0.2, zlen), (sx * (L.X_HALF - 0.04), L.CEIL - 0.1, zc), "DarkWood", grain='z')
        for zp in (-0.9, 0.3, 1.5, 2.5):
            shell.box((0.12, L.CEIL, 0.16), (sx * (L.X_HALF - 0.05), L.CEIL / 2, zp), "DarkWood", bevel=0.015)
    shell.box((2 * L.X_HALF + 0.2, L.CEIL, 0.12), (0, L.CEIL / 2, L.Z_BACK + 0.06), "WallPlanks", grain='y')

    # ceiling beams: transverse + radial over the stern
    for zb in (-0.35, 0.55, 1.45, 2.35):
        shell.box((2 * L.X_HALF, 0.18, 0.16), (0, L.CEIL - 0.09, zb), "DarkWood", bevel=0.02, grain='x')
    for a in [-45] + edges + [45]:
        p = L.arc_pt(a, L.R / 2)
        shell.box((0.13, 0.16, L.R), (p[0], L.CEIL - 0.08, p[2]), "DarkWood", bevel=0.02, yaw=-a, grain='z')
    shell.cyl(0.22, 0.1, (0, L.CEIL - 0.13, L.ARC_CZ), "Brass", segs=16, bevel=0.01)

    return {
        "floor": floor.build(collection=C),
        "shell": shell.build(collection=C),
        "windows": win.build(collection=C),
        "glass": glass.build(collection=C),
    }


# ----------------------------------------------------------------- chart table + props

def build_table(C):
    t = MB("STATIC_table", smooth_angle=40)
    cx, ty, cz = L.TABLE_C
    W, D = L.TABLE_W, L.TABLE_D
    with t.frame((cx, 0, cz)):
        t.box((W, 0.06, D), (0, ty - 0.03, 0), "Mahogany", bevel=0.02, grain='x')
        # raised rim
        for sz in (-1, 1):
            t.box((W, 0.025, 0.05), (0, ty + 0.008, sz * (D / 2 - 0.025)), "Mahogany", bevel=0.01, grain='x')
        for sx in (-1, 1):
            t.box((0.05, 0.025, D - 0.1), (sx * (W / 2 - 0.025), ty + 0.008, 0), "Mahogany", bevel=0.01, grain='z')
        # apron + legs
        t.box((W - 0.12, 0.14, D - 0.12), (0, ty - 0.13, 0), "Mahogany", bevel=0.015, grain='x')
        for sx in (-1, 1):
            for sz in (-1, 1):
                lx, lz = sx * (W / 2 - 0.1), sz * (D / 2 - 0.1)
                t.box((0.11, ty - 0.06, 0.11), (lx, (ty - 0.06) / 2, lz), "Mahogany", bevel=0.02)
                t.box((0.15, 0.06, 0.15), (lx, 0.03, lz), "Mahogany", bevel=0.02)
                t.box((0.14, 0.05, 0.14), (lx, ty - 0.27, lz), "Mahogany", bevel=0.015)
                # brass corner plates
                t.box((0.07, 0.006, 0.07), (sx * (W / 2 - 0.035), ty + 0.023, sz * (D / 2 - 0.035)), "Brass", bevel=0.003)
        # stretcher
        t.box((W - 0.25, 0.06, 0.06), (0, 0.18, 0), "Mahogany", bevel=0.01, grain='x')
        # front drawer fronts
        for sx in (-0.4, 0.4):
            t.box((0.5, 0.1, 0.02), (sx, ty - 0.13, D / 2 - 0.05), "Mahogany", bevel=0.008, grain='x')
            t.box((0.1, 0.02, 0.02), (sx, ty - 0.13, D / 2 - 0.03), "Brass", bevel=0.005)
    # sky map, UV 0..1 exactly; image top (v=1) toward the windows (-Z)
    mw, md = L.MAP_W / 2, L.MAP_D / 2
    y = L.MAP_Y
    t.quad([(cx - mw, y, cz + md), (cx + mw, y, cz + md), (cx + mw, y, cz - md), (cx - mw, y, cz - md)], "SkyMap")

    # compass
    px, py, pz = L.COMPASS_POS
    with t.frame((px, py, pz)):
        t.cyl(0.075, 0.03, (0, 0.015, 0), "Brass", segs=20, bevel=0.006)
        t.cyl(0.06, 0.004, (0, 0.031, 0), "GaugeFace", segs=20)
        t.torus(0.065, 0.007, (0, 0.033, 0), "Brass", seg=20, rseg=6, axis='y')
        t.box((0.008, 0.003, 0.09), (0, 0.035, 0), "Cloth", yaw=35)
        t.box((0.006, 0.003, 0.04), (0, 0.036, 0), "Iron", yaw=-55)
        t.cyl(0.006, 0.01, (0, 0.037, 0), "Brass", segs=8)
    # spyglass (lying, along local X)
    px, py, pz = L.SPYGLASS_POS
    with t.frame((px, py, pz), yaw=25):
        r0 = 0.032
        t.cyl(r0, 0.16, (0.0, r0, 0), "Leather", axis='x', segs=14)
        t.cyl(r0 * 0.85, 0.1, (0.13, r0, 0), "Brass", axis='x', segs=14)
        t.cyl(r0 * 0.7, 0.08, (0.22, r0, 0), "Brass", axis='x', segs=14)
        t.cyl(r0 * 1.12, 0.03, (-0.09, r0, 0), "Brass", axis='x', segs=14, bevel=0.004)
        t.cyl(r0 * 1.05, 0.02, (0.08, r0, 0), "Brass", axis='x', segs=14)
        t.cyl(r0 * 0.8, 0.015, (0.265, r0, 0), "Brass", axis='x', segs=14)
        # little cradle
        for sx in (-0.05, 0.12):
            t.box((0.02, 0.02, 0.07), (sx, 0.01, 0), "Mahogany", bevel=0.004)
    # closed logbook + pencil (lying on its cover) on the right front, inside the rim, clear of the compass
    BOOK = (0.58, L.TABLE_TOP, 0.12)
    with t.frame(BOOK, yaw=-12):
        t.box((0.2, 0.035, 0.26), (0, 0.0175, 0), "Leather", bevel=0.008)
        t.box((0.19, 0.03, 0.245), (0.008, 0.0175, 0), "Paper")
        t.box((0.03, 0.037, 0.27), (-0.07, 0.0185, 0), "Leather", bevel=0.004)
        t.cyl(0.004, 0.14, (0.012, 0.035 + 0.004, 0.0), "Mahogany", axis='x', segs=6, yaw=42)
    # rolled chart on the far left of the table (inside the rim)
    with t.frame((-0.52, L.TABLE_TOP, -0.55), yaw=10):
        t.cyl(0.03, 0.35, (0, 0.03, 0), "Parchment", axis='x', segs=12)
        t.cyl(0.012, 0.37, (0, 0.03, 0), "Mahogany", axis='x', segs=8)
    return t.build(collection=C)


def build_lantern(C):
    from . import fix
    return fix.build_lantern(C)


def build_wheel(C):
    cx, cy, cz = L.WHEEL_C
    grp = empty("Wheel", L.WHEEL_C, collection=C, size=0.2)
    w = MB("Wheel_mesh")
    w.torus(0.42, 0.032, (0, 0, 0), "Mahogany", seg=32, rseg=8)
    w.torus(0.2, 0.02, (0, 0, 0), "Mahogany", seg=24, rseg=6)
    w.cyl(0.085, 0.12, (0, 0, 0), "Brass", axis='z', segs=16, bevel=0.01)
    w.cyl(0.05, 0.16, (0, 0, 0), "Brass", axis='z', segs=12, bevel=0.008)
    w.torus(0.42, 0.012, (0, 0, 0.03), "Brass", seg=32, rseg=4)
    for i in range(8):
        a = 360 * i / 8
        with w.frame((0, 0, 0), roll=a):
            w.cyl(0.018, 0.36, (0.25, 0, 0), "Mahogany", axis='x', segs=8)
            w.cyl(0.026, 0.12, (0.52, 0, 0), "Mahogany", axis='x', segs=8, r2=0.018)
            w.cyl(0.02, 0.04, (0.48, 0, 0), "Mahogany", axis='x', segs=8)
            w.sphere(0.03, (0.6, 0, 0), "Mahogany", segs=8, rings=5)
    ob = w.build(origin=(0, 0, 0), collection=C)
    ob.location = (0, 0, 0)
    ob.parent = grp
    return grp


# ----------------------------------------------------------------- chest + bookshelf

CART_ROWS = [("SLOT_cart_games", 0.745, 0.60), ("SLOT_cart_ai", 0.77, 0.49), ("SLOT_cart_tools", 0.795, 0.38)]


def chest_frame():
    return mat3(L.CHEST_POS, yaw=L.CHEST_YAW)


def build_chest(C):
    c = MB("STATIC_chest", smooth_angle=40)
    with c.frame(L.CHEST_POS, yaw=L.CHEST_YAW):
        W, D = 1.0, 0.6
        # lower carcass
        c.box((W, 0.68, D), (0, 0.36, 0), "Mahogany", bevel=0.02, grain='y')
        c.box((W + 0.04, 0.05, D + 0.04), (0, 0.025, 0), "DarkWood", bevel=0.01, grain='x')
        # lower drawer fronts + handles
        for yy in (0.18, 0.48):
            c.box((W - 0.1, 0.24, 0.03), (0, yy, D / 2 + 0.01), "Mahogany", bevel=0.015, grain='x')
            c.box((0.18, 0.025, 0.03), (0, yy + 0.02, D / 2 + 0.035), "Brass", bevel=0.006)
            for sx in (-0.08, 0.08):
                c.box((0.03, 0.04, 0.02), (sx, yy + 0.02, D / 2 + 0.03), "Brass", bevel=0.005)
            c.box((0.12, 0.05, 0.01), (0, yy - 0.06, D / 2 + 0.03), "Brass", bevel=0.003)
        # sides around the open top drawer + top slab
        for sx in (-1, 1):
            c.box((0.04, 0.16, D), (sx * (W / 2 - 0.02), 0.78, 0), "Mahogany", bevel=0.01)
        c.box((W + 0.04, 0.04, D + 0.02), (0, 0.88, 0), "Mahogany", bevel=0.012, grain='x')
        c.box((W - 0.08, 0.14, 0.03), (0, 0.78, -D / 2 + 0.03), "DarkWood")
        # brass corner brackets
        for sx in (-1, 1):
            for yy in (0.1, 0.62, 0.86):
                c.box((0.05, 0.06, 0.05), (sx * (W / 2 + 0.003), yy, D / 2 + 0.003), "Brass", bevel=0.006)
        # open top drawer (pulled out)
        dz0, dz1 = 0.18, 0.68
        dzc = (dz0 + dz1) / 2
        dw = W - 0.1
        c.box((dw, 0.02, dz1 - dz0), (0, 0.725, dzc), "Mahogany", grain='z')
        for sx in (-1, 1):
            c.box((0.025, 0.1, dz1 - dz0), (sx * (dw / 2 - 0.0125), 0.765, dzc), "Mahogany", bevel=0.006, grain='z')
        c.box((dw, 0.1, 0.025), (0, 0.765, dz0 + 0.0125), "Mahogany", bevel=0.006, grain='x')
        c.box((dw + 0.04, 0.085, 0.03), (0, 0.76, dz1 - 0.015), "Mahogany", bevel=0.01, grain='x')
        c.box((0.2, 0.025, 0.03), (0, 0.765, dz1 + 0.02), "Brass", bevel=0.006)
        for sx in (-0.09, 0.09):
            c.box((0.03, 0.04, 0.025), (sx, 0.765, dz1 + 0.01), "Brass", bevel=0.005)
        for sx in (-1, 1):
            c.box((0.05, 0.05, 0.035), (sx * (dw / 2 + 0.005), 0.775, dz1 - 0.01), "Brass", bevel=0.006)
        # stepped row beds + dividers
        for (nm, by, bz) in CART_ROWS:
            h = by - 0.735
            if h > 0.001:
                c.box((dw - 0.05, h, 0.105), (0, 0.735 + h / 2, bz), "DarkWood", grain='x')
            c.box((dw - 0.05, 0.035, 0.012), (0, by + 0.0175, bz - 0.05), "Mahogany", bevel=0.003, grain='x')

        # hutch / bookshelf
        hz0, hz1 = -D / 2, -D / 2 + 0.32
        hzc = (hz0 + hz1) / 2
        hy0, hy1 = 0.9, 2.3
        c.box((W, hy1 - hy0, 0.03), (0, (hy0 + hy1) / 2, hz0 + 0.015), "DarkWood", grain='y')
        for sx in (-1, 1):
            c.box((0.045, hy1 - hy0, 0.32), (sx * (W / 2 - 0.0225), (hy0 + hy1) / 2, hzc), "Mahogany", bevel=0.012)
        for yy in (1.29, 1.69, 1.99):
            c.box((W - 0.06, 0.03, 0.31), (0, yy - 0.015, hzc), "Mahogany", bevel=0.008, grain='x')
            c.box((W - 0.06, 0.04, 0.02), (0, yy - 0.02, hz1), "Mahogany", bevel=0.006, grain='x')
        c.box((W + 0.08, 0.05, 0.38), (0, hy1 + 0.025, hzc + 0.02), "Mahogany", bevel=0.015, grain='x')
        c.box((W + 0.02, 0.08, 0.34), (0, hy1 + 0.09, hzc), "DarkWood", bevel=0.012, grain='x')
        for sx in (-1, 1):
            c.box((0.06, 0.06, 0.06), (sx * (W / 2), hy1 + 0.02, hz1 + 0.03), "Brass", bevel=0.008)
        # brass rail in front of the book row
        ry = 1.69 + 0.13
        c.cyl(0.009, W - 0.06, (0, ry, hz1 + 0.025), "Brass", axis='x', segs=8)
        for sx in (-0.44, 0.0, 0.44):
            c.cyl(0.006, 0.13, (sx, 1.69 + 0.065, hz1 + 0.025), "Brass", segs=6)
            c.sphere(0.014, (sx, ry, hz1 + 0.025), "Brass", segs=8, rings=5)
        # lower compartment deco: rolled charts + small box
        for i, (sx, rr) in enumerate([(-0.3, 0.035), (-0.22, 0.03), (-0.26, 0.032)]):
            c.cyl(rr, 0.27, (sx + (0.04 if i == 2 else 0), 0.9 + rr + (0.06 if i == 2 else 0), hzc + 0.02), "Parchment", axis='z', segs=10)
        # (pulled forward so the Slate can lean on it)
        c.box((0.24, 0.12, 0.2), (0.25, 0.96, -0.1), "Leather", bevel=0.01)
        c.box((0.25, 0.015, 0.21), (0.25, 1.02, -0.1), "Brass", bevel=0.004)
        # notebook shelf deco right of the notebooks row: stacked books lying flat + bottle
        for i, (h, mt) in enumerate([(0.035, "BookRed"), (0.03, "BookGreen"), (0.032, "BookBlue")]):
            c.box((0.22 - i * 0.015, h, 0.17), (0.28, 1.29 + sum([0.035, 0.03, 0.032][:i]) + h / 2, hzc + 0.01), mt, bevel=0.006, yaw=(i - 1) * 6)
        c.cyl(0.035, 0.14, (0.05, 1.36, hzc), "Glass", segs=10)
        c.cyl(0.012, 0.04, (0.05, 1.45, hzc), "Mahogany", segs=6)
        # decorative static books (app rows start at x=-0.44 and need ~0.56 m / 0.15 m)
        deco_books(c, 0.16, 0.46, 1.69, hzc + 0.01, 0.2, 0.25, 3)
        deco_books(c, -0.45, 0.33, 1.99, hzc + 0.01, 0.2, 0.27, 5)
        deco_books(c, -0.24, 0.12, 1.29, hzc + 0.01, 0.17, 0.23, 9)
        shelf_dressing(c, hzc)
        # top-of-shelf deco: a couple of old books
        for i, mt in enumerate(["BookRed", "BookBlue", "BookGreen", "BookRed"]):
            c.box((0.04, 0.22 - 0.02 * (i % 2), 0.16), (-0.42 + i * 0.045, hy1 + 0.13 + 0.11 - 0.01 * (i % 2), hzc), mt, bevel=0.006)
    return c.build(collection=C)


from .dress import deco_books, shelf_dressing


def chest_anchors(C):
    m = chest_frame()
    out = []
    for nm, by, bz in CART_ROWS:
        p = world_point(m, (-0.315, by, bz))
        out.append(empty(nm, p, yaw=L.CHEST_YAW, collection=C, size=0.05, kind='ARROWS'))
    hz1 = -0.3 + 0.32
    out.append(empty("SLOT_books", world_point(m, (-0.44, 1.69, hz1 - 0.115)), yaw=L.CHEST_YAW, collection=C, size=0.05, kind='ARROWS'))
    out.append(empty("SLOT_notebooks", world_point(m, (-0.44, 1.29, hz1 - 0.105)), yaw=L.CHEST_YAW, collection=C, size=0.05, kind='ARROWS'))
    return out


# ----------------------------------------------------------------- rack

RACK_COLS, RACK_ROWS = 4, 3
RACK_DX, RACK_DY = 0.13, 0.15
CARD_W, CARD_H = 0.10, 0.12


def rack_frame():
    return mat3(L.RACK_POS, yaw=L.RACK_YAW)


def rack_grid():
    """(x0, b0): local x of column 0 centre, local y of row 0 card base."""
    x0 = -RACK_DX * (RACK_COLS - 1) / 2
    span = RACK_DY * (RACK_ROWS - 1) + CARD_H
    b0 = L.RACK_CY + span / 2 - CARD_H
    return x0, b0


BOARD_Z = 0.06   # local z of the board face


def build_rack(C):
    r = MB("STATIC_rack", smooth_angle=40)
    x0, b0 = rack_grid()
    with r.frame(L.RACK_POS, yaw=L.RACK_YAW):
        BW, BH = 0.7, 0.62
        cy = L.RACK_CY
        r.box((BW, BH, 0.04), (0, cy, BOARD_Z - 0.02), "DarkWood", grain='y')
        # frame
        for sy in (-1, 1):
            r.box((BW + 0.1, 0.06, 0.07), (0, cy + sy * (BH / 2 + 0.02), BOARD_Z - 0.005), "Mahogany", bevel=0.012, grain='x')
        for sx in (-1, 1):
            r.box((0.06, BH + 0.1, 0.07), (sx * (BW / 2 + 0.02), cy, BOARD_Z - 0.005), "Mahogany", bevel=0.012)
            for sy in (-1, 1):
                r.box((0.07, 0.07, 0.02), (sx * (BW / 2 + 0.02), cy + sy * (BH / 2 + 0.02), BOARD_Z + 0.032), "Brass", bevel=0.006)
        # slot lips
        for row in range(RACK_ROWS):
            for col in range(RACK_COLS):
                x = x0 + col * RACK_DX
                yb = b0 - row * RACK_DY
                ym = yb + CARD_H / 2
                lw, lh, t = CARD_W + 0.016, CARD_H + 0.012, 0.008
                r.box((lw, t, 0.012), (x, yb - t / 2 - 0.002, BOARD_Z + 0.006), "Mahogany", grain='x')
                for sx in (-1, 1):
                    r.box((t, lh * 0.75, 0.012), (x + sx * (lw / 2 - t / 2), yb + lh * 0.75 / 2 - 0.006, BOARD_Z + 0.006), "Mahogany")
                r.box((0.04, 0.006, 0.004), (x, yb + CARD_H + 0.006, BOARD_Z + 0.002), "Brass")
        # brass name plate
        r.box((0.18, 0.04, 0.008), (0, cy + BH / 2 + 0.02, BOARD_Z + 0.032), "Brass", bevel=0.004)
        # sea chest under the rack
        with r.frame((0, 0, 0.35)):
            r.box((0.85, 0.36, 0.45), (0, 0.18, 0), "Mahogany", bevel=0.02, grain='x')
            r.box((0.87, 0.1, 0.47), (0, 0.41, 0), "Mahogany", bevel=0.03, grain='x')
            for sx in (-0.3, 0.3):
                r.box((0.05, 0.47, 0.475), (sx, 0.235, 0), "Iron", bevel=0.006)
            r.box((0.08, 0.1, 0.02), (0, 0.33, 0.235), "Brass", bevel=0.008)
            for sx in (-1, 1):
                for sz in (-1, 1):
                    r.box((0.06, 0.06, 0.06), (sx * 0.43, 0.43, sz * 0.23), "Brass", bevel=0.008)
                r.box((0.02, 0.03, 0.14), (sx * 0.44, 0.27, 0), "Brass", bevel=0.006)
    return r.build(collection=C)


def rack_anchor(C):
    x0, b0 = rack_grid()
    p = world_point(rack_frame(), (x0, b0, BOARD_Z + 0.006))
    return empty("SLOT_cards", p, yaw=L.RACK_YAW, collection=C, size=0.05, kind='ARROWS')


# ----------------------------------------------------------------- atmosphere props

def build_props(C):
    p = MB("STATIC_props", smooth_angle=40)
    # wheel pedestal + binnacle
    wx, wy, wz = L.WHEEL_C
    p.box((0.2, wy + 0.02, 0.18), (0, (wy + 0.02) / 2 - 0.02, wz - 0.17), "Mahogany", bevel=0.02)
    p.box((0.3, 0.08, 0.3), (0, 0.04, wz - 0.17), "Mahogany", bevel=0.02)
    p.cyl(0.06, 0.12, (0, wy, wz - 0.12), "Brass", axis='z', segs=12, bevel=0.006)
    # (ropes, coils and the left-wall rope moved to the non-lightmapped `Rigging` mesh, polish.build_rigging)
    # (physics round: the left-wall rope, horn cleat and ceiling bracket are gone -> belaying-pin rail,
    #  phys.pin_rail_static via polish.static_props)
    # crate front right
    with p.frame((2.35, 0, 1.75), yaw=-15):
        p.box((0.6, 0.5, 0.55), (0, 0.25, 0), "Planks", bevel=0.015)
        for yy in (0.04, 0.46):
            p.box((0.62, 0.06, 0.57), (0, yy, 0), "DarkWood", bevel=0.01, grain='x')
        for sx in (-1, 1):
            p.box((0.06, 0.5, 0.57), (sx * 0.28, 0.25, 0), "DarkWood", bevel=0.01)
        p.box((0.45, 0.32, 0.4), (0.03, 0.5 + 0.16, 0.02), "Mahogany", bevel=0.015, yaw=10)
        p.box((0.47, 0.03, 0.42), (0.03, 0.82, 0.02), "Brass", bevel=0.006, yaw=10)
    # brass pipes along the right wall + gauges
    px = L.X_HALF - 0.12
    p.cyl(0.035, 3.2, (px, 2.62, 0.9), "Brass", axis='z', segs=10)
    p.cyl(0.035, 1.0, (px, 2.12, -0.69), "Brass", segs=10)
    p.torus(0.07, 0.035, (px, 2.62, -0.69), "Brass", seg=8, rseg=8, axis='x', arc=90, a0=180)
    for zz in (2.2, 1.2, 0.2):
        p.cyl(0.045, 0.06, (px, 2.62, zz), "Brass", axis='z', segs=10, bevel=0.006)
        p.box((0.1, 0.04, 0.04), (px + 0.06, 2.62, zz), "Brass", bevel=0.006)
    # (fix round: the two wall gauges and their pipe stub are gone -> ship's clock, fix.clock_static)
    from . import fix
    fix.clock_static(p)
    # wall lamp bracket on the left wall
    with p.frame((-L.X_HALF + 0.05, 1.9, 0.9), yaw=90):
        p.box((0.12, 0.2, 0.03), (0, 0, 0.015), "Brass", bevel=0.008)
        p.cyl(0.012, 0.18, (0, 0.06, 0.1), "Brass", axis='z', segs=6)
    # barrel next to the crate
    with p.frame((1.7, 0, 2.2)):
        p.cyl(0.26, 0.7, (0, 0.35, 0), "Planks", segs=14, tile=0.8)
        p.cyl(0.29, 0.3, (0, 0.35, 0), "Planks", segs=14, tile=0.8)
        for yy in (0.08, 0.62):
            p.cyl(0.275, 0.04, (0, yy, 0), "Iron", segs=14)
        p.cyl(0.25, 0.01, (0, 0.705, 0), "DarkWood", segs=14)
    # framed chart on the left wall, front
    with p.frame((-L.X_HALF + 0.01, 1.65, 1.2), yaw=90):
        p.box((0.9, 0.62, 0.04), (0, 0, 0.02), "Mahogany", bevel=0.012, grain='x')
        p.box((0.8, 0.52, 0.01), (0, 0, 0.042), "Parchment")
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.box((0.05, 0.05, 0.012), (sx * 0.43, sy * 0.29, 0.045), "Brass", bevel=0.004)
    # floor rug
    p.box((1.9, 0.012, 1.4), (0, 0.006, -0.2), "Cloth", bevel=0.004, grain='x')
    # polish round: portrait frame, bell bracket
    from . import polish
    polish.static_props(p)
    from . import dress
    dress.static_dressing(p)
    return p.build(collection=C)


# ----------------------------------------------------------------- viewpoints + hits

def vp(C, name, cam, tgt):
    empty(name, cam, collection=C, size=0.08, kind='SPHERE')
    empty(name + "_T", tgt, collection=C, size=0.04, kind='CUBE')


def hit(C, name, center, size, yaw=0, pitch=0):
    b = MB(name, smooth_angle=0)
    b.box(size, (0, 0, 0), "Hit")
    ob = b.build(origin=(0, 0, 0), collection=C)
    ob.location = util.T(*center)
    ob.rotation_euler = util.euler_b(yaw, pitch)
    ob.display_type = 'WIRE'
    ob.hide_render = True
    ob["hit"] = 1
    return ob


def build_nodes(C, hh):
    cm = chest_frame()
    rm = rack_frame()
    vp(C, "VP_overview", (0, 1.6, 2.35), (0, 1.12, -1.5))
    vp(C, "VP_chest", world_point(cm, (0.38, 1.22, 1.3)), world_point(cm, (-0.04, 0.9, 0.3)))
    vp(C, "VP_shelf", world_point(cm, (0.0, 1.62, 1.55)), world_point(cm, (0.0, 1.55, -0.15)))
    vp(C, "VP_rack", world_point(rm, (0.0, 1.5, 1.35)), world_point(rm, (0.0, 1.45, 0.0)))
    vp(C, "VP_table", (0, 2.3, 1.0), (0, 0.85, -0.3))
    vp(C, "VP_handheld", hh["handheld_cam"], hh["handheld_tgt"])
    vp(C, "VP_screen", hh["screen_cam"], hh["screen_c"])

    hit(C, "HIT_chest", world_point(cm, (0, 0.6, 0.35)), (1.06, 0.55, 0.75), yaw=L.CHEST_YAW)
    hit(C, "HIT_shelf", world_point(cm, (0, 1.62, -0.13)), (1.06, 1.42, 0.36), yaw=L.CHEST_YAW)
    hit(C, "HIT_rack", world_point(rm, (0, L.RACK_CY, 0.06)), (0.82, 0.74, 0.12), yaw=L.RACK_YAW)
    hit(C, "HIT_table", (L.TABLE_C[0], L.TABLE_TOP + 0.02, L.TABLE_C[2]), (L.TABLE_W, 0.06, L.TABLE_D))
    hit(C, "HIT_handheld", hh["center"], (0.26, 0.15, 0.1), pitch=L.HH_PITCH)
    lx, ly, lz = L.LANTERN_POS
    hit(C, "HIT_lantern", (lx, ly + 0.17, lz), (0.18, 0.36, 0.18))
    hit(C, "HIT_wheel", L.WHEEL_C, (1.32, 1.32, 0.3))
    empty("SKY_anchor", L.SKY_ANCHOR, collection=C, size=0.5)
    empty("SLOT_map", (L.TABLE_C[0], L.MAP_Y, L.TABLE_C[2]), collection=C, size=0.1, kind='ARROWS')


def build(blockout=False):
    from . import handheld
    C = coll("Cabin")
    objs = build_shell(C)
    objs["table"] = build_table(C)
    objs["chest"] = build_chest(C)
    objs["rack"] = build_rack(C)
    objs["props"] = build_props(C)
    build_lantern(C)
    build_wheel(C)
    hh = handheld.build(C)
    chest_anchors(C)
    rack_anchor(C)
    build_nodes(C, hh)
    from . import polish, fix
    polish.build(C)
    fix.build_clock(C)
    fix.build_hanging_lamp(C)
    from . import dress
    dress.build_patch(C)
    bpy.context.view_layer.update()
    return C
