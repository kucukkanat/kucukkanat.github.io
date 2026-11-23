"""The library deck below the cabin -> blender/out/library/library_raw.glb + public/assets/library_lightmap_*.
Run: Blender --background --factory-startup --python blender/library/build.py [-- --no-bake]
(Ported from the library prototype; its own kit lives in blender/library/kit.)

  Blender --background --factory-startup --python blender/room.py [-- --no-bake] [--samples N] [--preview]

Built with the main site's kit (util.MB in three.js coordinates, painted materials, one-atlas lightmap on the
STATIC_* meshes). Layout (metres, three.js: +Y up, +Z toward the visitor):
  floor 5 x 6 m (x -2.5..2.5, z -3..3); curved hull side walls (tumblehome), barrel-vault ceiling 3.0 -> 3.6 m.
  back wall: floor-to-ceiling bookcase (4 bays x 7 shelves) with a rolling ladder on a brass rail;
  left wall: lower bookcase; right wall: two portholes over a window seat; reading table with lantern, rugs, clutter.
Contract nodes (docs/INTEGRATION.md): Book_<topicId> (empty at the book's base centre, spine facing +Z, with the
dynamic book mesh BookMesh_<topicId> as child), Librarian, Ladder (dynamic), Ladder_path (+ .start/.end), Ladder_step,
Table_drop, Camera_main / Camera_table / Camera_shelf (look down local -Z), Sky_backdrop_* (emissive, unbaked).
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
ROOT = os.path.dirname(os.path.dirname(HERE))   # blender/library -> repo root
sys.path.insert(0, HERE)
from kit import props as desk, gentex  # noqa: E402
from kit import util, materials, lightmap, export, paint  # noqa: E402
from kit.util import MB, T, empty, mat3  # noqa: E402

ASSETS = os.path.join(ROOT, "public", "assets")
OUT = os.path.join(ROOT, "blender", "out", "library")

# ---------------------------------------------------------------- layout
HALF_W, Z_BACK, Z_FRONT = 2.5, -3.0, 3.0
CEIL_SIDE, CEIL_TOP = 3.0, 3.6
BULGE = 0.22                      # hull tumblehome: walls bow out this much at mid-height
CASE_W, CASE_D, CASE_H = 4.4, 0.36, 3.0
BAYS = [-2.2, -1.1, 0.0, 1.1, 2.2]          # bookcase post x positions
SHELVES = [0.06, 0.48, 0.90, 1.32, 1.74, 2.16, 2.58]   # shelf top surfaces (books stand here)
RAIL_Y, RAIL_Z = 2.45, Z_BACK + CASE_D + 0.06
LADDER_FOOT = 0.85                # ladder foot distance from the rail line
TABLE_C, TABLE_TOP = (0.35, 0.0, 0.75), 0.78
PORTHOLES = [(-1.25, 1.55), (0.95, 1.55)]  # (z, y) on the right wall
PORT_R = 0.3
# Topic book slots (bay 0..3, shelf index, position 0..1 along the bay). The books here are generic: the app dresses
# Book_slot<i> with the i-th topic from content/topics (cover colour, spine title) and hides the unused ones, so the
# bake never depends on the content. The order puts the slots he reaches from the floor first, the ladder ones last.
SLOT_LIST = [(1, 3, 0.55), (2, 2, 0.35), (3, 3, 0.3), (0, 1, 0.3), (2, 4, 0.7), (3, 0, 0.5), (3, 5, 0.65),
             (0, 5, 0.6), (1, 6, 0.25), (0, 6, 0.4)]
SLOTS = {f"slot{i}": s for i, s in enumerate(SLOT_LIST)}
TOPICS = [{"id": f"slot{i}", "title": f"Slot {i}", "colour": "BookRed"} for i in range(len(SLOT_LIST))]
BOOK_T, BOOK_H, BOOK_D = 0.055, 0.30, 0.22
DECO_MATS = ["BookRed", "BookBlue", "BookGreen", "BookOchre", "BookPlum", "BookTeal", "Leather"]


def log(*a):
    print("[room]", *a, flush=True)


def hull_x(y):
    """Side wall distance from the centre line at height y (tumblehome)."""
    return HALF_W + BULGE * math.sin(math.pi * min(max(y, 0), CEIL_SIDE) / CEIL_SIDE)


VAULT_R = ((HALF_W ** 2) + (CEIL_TOP - CEIL_SIDE) ** 2) / (2 * (CEIL_TOP - CEIL_SIDE))
VAULT_CY = CEIL_TOP - VAULT_R


def vault_pt(t):
    """t in -1..1 across the ceiling."""
    a = math.asin(HALF_W / VAULT_R) * t
    return VAULT_R * math.sin(a), VAULT_CY + VAULT_R * math.cos(a), a


# ---------------------------------------------------------------- shell
def shell(C):
    floor = MB("STATIC_floor")
    sh = MB("STATIC_shell")
    pts = [(-HALF_W, Z_FRONT), (HALF_W, Z_FRONT), (HALF_W, Z_BACK), (-HALF_W, Z_BACK)]
    floor.prism(pts, 0.12, center=(0, -0.06, 0), mat="Planks", plane='xz', grain='z')
    depth = Z_FRONT - Z_BACK
    zc = (Z_FRONT + Z_BACK) / 2
    # hull planks: horizontal strips following the tumblehome, both sides
    n = 14
    for sx in (-1, 1):
        for i in range(n):
            y0, y1 = CEIL_SIDE * i / n, CEIL_SIDE * (i + 1) / n
            x0, x1 = hull_x(y0) + 0.06, hull_x(y1) + 0.06
            ym, xm = (y0 + y1) / 2, (x0 + x1) / 2
            h = math.hypot(y1 - y0, x1 - x0) + 0.004
            roll = math.degrees(math.atan2(x1 - x0, y1 - y0)) * -sx
            # right wall: leave square holes for the portholes
            cuts = [(pz - 0.42, pz + 0.42) for pz, py in PORTHOLES if sx == 1 and abs(ym - py) < 0.36]
            spans, z = [], Z_BACK
            for a, b in sorted(cuts):
                spans.append((z, a))
                z = b
            spans.append((z, Z_FRONT))
            for a, b in spans:
                sh.box((0.08, h, b - a), (sx * xm, ym, (a + b) / 2), "WallPlanks", roll=roll, grain='z')
    # porthole surrounds (fill the square cut with a ring plate), brass rims, glass and painted sky behind
    win = MB("STATIC_portholes")
    glass = MB("Window_glass", smooth_angle=0)
    for pz, py in PORTHOLES:
        x = hull_x(py) + 0.06
        with win.frame((x, py, pz), yaw=-90):
            ring_plate(win, PORT_R + 0.02, 0.48, 0.1, "WallPlanks")
            win.torus(PORT_R + 0.03, 0.035, (0, 0, -0.06), "Brass", seg=28, rseg=8)
            win.torus(PORT_R + 0.02, 0.022, (0, 0, 0.05), "Brass", seg=28, rseg=6)
            for k in range(8):
                a = 2 * math.pi * k / 8 + 0.2
                win.sphere(0.014, ((PORT_R + 0.085) * math.cos(a), (PORT_R + 0.085) * math.sin(a), -0.085), "Brass", segs=6, rings=4)
        with glass.frame((x, py, pz), yaw=-90):
            disc(glass, PORT_R + 0.01, 0.0, "Glass")
    # ribs (frames) on the hull every 1.2 m, and the vault ribs above them
    for zr in (-2.4, -1.2, 0.0, 1.2, 2.4):
        for sx in (-1, 1):
            m = 10
            for i in range(m):
                y0, y1 = CEIL_SIDE * i / m, CEIL_SIDE * (i + 1) / m
                x0, x1 = hull_x(y0) - 0.02, hull_x(y1) - 0.02
                h = math.hypot(y1 - y0, x1 - x0) + 0.01
                roll = math.degrees(math.atan2(x1 - x0, y1 - y0)) * -sx
                sh.box((0.12, h, 0.14), (sx * (x0 + x1) / 2, (y0 + y1) / 2, zr), "DarkWood", roll=roll, bevel=0.01)
        arc_boxes(sh, -0.12, 0.16, zr, "DarkWood")
    # vault planks running fore-aft
    n = 18
    for i in range(n):
        xa, ya, aa = vault_pt(-1 + 2 * i / n)
        xb, yb, ab = vault_pt(-1 + 2 * (i + 1) / n)
        w = math.hypot(xb - xa, yb - ya) + 0.004
        roll = -math.degrees((aa + ab) / 2)
        # planks over the deck hatch stop at its edges (the coaming covers the joint)
        hx, hz = HATCH_DECK
        spans = [(Z_BACK, Z_FRONT)]
        if abs((xa + xb) / 2 - hx) < HATCH_OPEN / 2:
            spans = [(Z_BACK, hz - HATCH_OPEN / 2), (hz + HATCH_OPEN / 2, Z_FRONT)]
        for z0, z1 in spans:
            sh.box((w, 0.06, z1 - z0), ((xa + xb) / 2 + 0.03 * math.sin((aa + ab) / 2), (ya + yb) / 2 + 0.03 * math.cos((aa + ab) / 2), (z0 + z1) / 2),
                   "WallPlanks", roll=roll, grain='z')
    # ridge beam
    sh.box((0.18, 0.14, depth), (0, CEIL_TOP - 0.07, zc), "DarkWood", bevel=0.015, grain='z')
    # back and front walls (front has a door frame the visitor stands in front of)
    sh.box((2 * HALF_W + 0.6, CEIL_TOP + 0.1, 0.12), (0, (CEIL_TOP + 0.1) / 2, Z_BACK - 0.06), "WallPlanks", grain='y')
    sh.box((2 * HALF_W + 0.6, CEIL_TOP + 0.1, 0.12), (0, (CEIL_TOP + 0.1) / 2, Z_FRONT + 0.06), "WallPlanks", grain='y')
    # skirting along the hull
    for sx in (-1, 1):
        sh.box((0.06, 0.14, depth), (sx * (hull_x(0.07) - 0.01), 0.07, zc), "DarkWood", grain='z')
    return [floor.build(collection=C), sh.build(collection=C), win.build(collection=C), glass.build(collection=C)]


# ---------------------------------------------------------------- the hatch up to the cabin
HATCH_DECK = (-1.9, 1.8)          # (x, z) of the opening in the vault, between the ribs at z 1.2 and 2.4
HATCH_OPEN = 0.66


def vault_y_at(x):
    """Height of the vault's inner surface at x."""
    best = min((abs(vault_pt(t / 200)[0] - x), vault_pt(t / 200)[1]) for t in range(-200, 201))
    return best[1]


def deck_hatch(C, shell_obj):
    """The way up: a square opening cut through the vault, a short lined well, a coaming ring and a fixed ladder
    from the floor up through it (the cabin's hatch sits above). HATCH_deck marks it for the app."""
    hx, hz = HATCH_DECK
    vy = vault_y_at(hx)        # (the vault planks above already leave the opening)
    h = MB("STATIC_deckhatch", smooth_angle=40)
    o2, t, up = HATCH_OPEN / 2, 0.03, 0.55
    with h.frame((hx, vy, hz)):
        for sx, sz, w, d in ((1, 0, t, HATCH_OPEN), (-1, 0, t, HATCH_OPEN), (0, 1, HATCH_OPEN, t), (0, -1, HATCH_OPEN, t)):
            h.box((w, up, d), (sx * (o2 - t / 2), up / 2, sz * (o2 - t / 2)), "DarkWood", grain='y')
        h.box((HATCH_OPEN, 0.03, HATCH_OPEN), (0, up, 0), "DarkWood", grain='x')   # the cabin's floor seen from below
        for sx in (-1, 1):
            h.box((0.07, 0.06, HATCH_OPEN + 0.14), (sx * (o2 + 0.035), -0.03, 0), "Mahogany", bevel=0.01, grain='z')
            h.box((HATCH_OPEN, 0.06, 0.07), (0, -0.03, sx * (o2 + 0.035)), "Mahogany", bevel=0.01, grain='x')
    # the ladder, on the wall side of the opening, floor to well
    lx = hx - o2 + 0.09
    top = vy + up
    for sz in (-1, 1):
        h.box((0.05, top, 0.05), (lx, top / 2, hz + sz * 0.2), "Mahogany", bevel=0.008)
    k = 0
    while 0.25 + k * 0.3 < top - 0.1:
        h.cyl(0.018, 0.4, (lx + 0.01, 0.25 + k * 0.3, hz), "Mahogany", axis='z', segs=8)
        k += 1
    ob = h.build(collection=C)
    empty("HATCH_deck", (hx, 0.0, hz), collection=C)
    log(f"deck hatch at x {hx}, z {hz}, vault {vy:.2f} m, {k} rungs")
    return [ob]


def arc_boxes(mb, inset, h, z, mat, n=16, d=0.16):
    """Transverse rib following the vault."""
    for i in range(n):
        xa, ya, aa = vault_pt(-1 + 2 * i / n)
        xb, yb, ab = vault_pt(-1 + 2 * (i + 1) / n)
        am = (aa + ab) / 2
        w = math.hypot(xb - xa, yb - ya) + 0.01
        mb.box((w, h, d), ((xa + xb) / 2 + inset * math.sin(am), (ya + yb) / 2 + inset * math.cos(am), z),
               mat, roll=-math.degrees(am), bevel=0.012)


def ring_plate(mb, r, half, depth, mat, n=32):
    """Square plate (2*half) with a round hole of radius r, in the local XY plane, centred, thickness depth."""
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
        tb.faces.new((front[j][0], back[j][0], back[k][0], front[k][0]))     # hole wall
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


# ---------------------------------------------------------------- bookcases and books
def deco_run(c, x0, x1, y, z, hmin, hmax, rnd, gaps=()):
    """Books standing on a shelf between x0 and x1 (frame coords), skipping the gaps (topic book slots).
    After the main site's dress.deco_books: varied colours and heights, gilt bands, paper labels, a few leaning."""
    x = x0
    last = None
    while True:
        t = rnd.uniform(0.022, 0.05)
        g = next(((a, b) for a, b in gaps if x + t > a and x < b), None)
        if g:
            x = g[1]
            continue
        if x + t > x1:
            break
        h = rnd.uniform(hmin, hmax)
        d = rnd.uniform(0.15, 0.2)
        mt = rnd.choice([m for m in DECO_MATS if m != last])
        last = mt
        zc = z - (0.2 - d) / 2
        lean = 0.0
        if rnd.random() < 0.08 and x + t + 0.05 < x1 and not any(x + t + 0.06 > a and x < b for a, b in gaps):
            lean = -rnd.uniform(7, 11)
        # a painted spine from the atlas in the same leather as the book, on a gently rounded face
        cells = [i for i in range(gentex.SPINE_COLS * gentex.SPINE_ROWS) if gentex.spine_cell_mat(i) == mt]
        cell = rnd.choice(cells)
        r_, c_ = divmod(cell, gentex.SPINE_COLS)
        u0, u1 = c_ / gentex.SPINE_COLS + 0.002, (c_ + 1) / gentex.SPINE_COLS - 0.002
        v0, v1 = 1 - (r_ + 1) / gentex.SPINE_ROWS, 1 - r_ / gentex.SPINE_ROWS
        with c.frame((x + t / 2, y, zc), roll=lean):
            c.box((t, h, d), (0, h / 2, 0), mt, bevel=0.003)
            zf = d / 2 + 0.0004
            desk.grid(c, lambda u, v: ((u - 0.5) * t * 0.97, 0.001 + v * (h - 0.002), zf + 0.0035 * math.sin(math.pi * u)),
                      2, 3, "SpineArt", uv=lambda u, v: (u0 + (u1 - u0) * u, v0 + (v1 - v0) * v), flip=True)
        x += t + rnd.uniform(0.0, 0.004) + (0.035 if lean else 0.0)


def bookcase(name, C, posts, shelves, height, depth, origin, yaw, topic_slots=None, seed=1):
    """Bookcase in its own frame (origin on the floor at the back-centre, local +Z = front)."""
    c = MB(name)
    vb = MB(name.replace("STATIC_", "VC_") + "_books")   # book runs: lighting baked to vertex colours
    rnd = random.Random(seed)
    w = posts[-1] - posts[0]
    with c.frame(origin, yaw=yaw), vb.frame(origin, yaw=yaw):
        c.box((w + 0.08, height, 0.03), (0, height / 2, 0.015), "DarkWood")                # back panel
        for x in posts:
            c.box((0.05, height, depth), (x, height / 2, depth / 2), "Mahogany", bevel=0.008)
        c.box((w + 0.16, 0.08, depth + 0.06), (0, height + 0.02, depth / 2 + 0.01), "Mahogany", bevel=0.015)  # crown
        c.box((w + 0.12, 0.05, 0.05), (0, height - 0.08, depth + 0.01), "Mahogany", bevel=0.01, grain='x')
        c.box((w + 0.1, 0.1, depth + 0.02), (0, 0.05, depth / 2), "DarkWood", bevel=0.008)                    # plinth
        for k in range(len(posts) - 1):
            xa, xb = posts[k] + 0.025, posts[k + 1] - 0.025
            for si, y in enumerate(shelves):
                c.box((xb - xa, 0.035, depth - 0.02), ((xa + xb) / 2, y - 0.0175, depth / 2), "Mahogany", bevel=0.006, grain='x')
                nxt = shelves[si + 1] if si + 1 < len(shelves) else height - 0.08
                gap = nxt - y - 0.035
                gaps = []
                if topic_slots:
                    for tid, (bay, sh, u) in topic_slots.items():
                        if bay == k and sh == si:
                            bx = xa + 0.06 + u * (xb - xa - 0.12 - BOOK_T)
                            gaps.append((bx - 0.012, bx + BOOK_T + 0.012))
                # leave some shelves part-empty for props
                x1 = xb - 0.01 if rnd.random() > 0.25 else xa + (xb - xa) * rnd.uniform(0.55, 0.8)
                deco_run(vb, xa + 0.01, x1, y, depth / 2 + 0.01, gap * 0.62, gap * 0.86, rnd, gaps)
                if x1 < xb - 0.15 and rnd.random() < 0.5:
                    stack(vb, (x1 + xb) / 2, y, depth / 2 + 0.02, rnd)
        # brass gallery rails on a few shelves (like the cabin)
        for k in (1, 2):
            if k + 1 >= len(posts):
                continue
            xa, xb = posts[k] + 0.03, posts[k + 1] - 0.03
            c.cyl(0.006, xb - xa, ((xa + xb) / 2, shelves[3] + 0.1, depth - 0.01), "Brass", axis='x', segs=6)
    return [c.build(collection=C), vb.build(collection=C)]


def stack(c, x, y, z, rnd, n=None):
    """A short pile of books lying flat."""
    n = n or rnd.randint(2, 4)
    yy = y
    for i in range(n):
        th = rnd.uniform(0.025, 0.045)
        w, d = rnd.uniform(0.16, 0.24), rnd.uniform(0.12, 0.17)
        c.box((w, th, d), (x + rnd.uniform(-0.01, 0.01), yy + th / 2, z), rnd.choice(DECO_MATS), bevel=0.003,
              yaw=rnd.uniform(-12, 12))
        yy += th


def topic_books(C):
    """One dynamic book per topic on the back bookcase: empty Book_<id> + child mesh BookMesh_<id>."""
    out = []
    for t in TOPICS:
        bay, si, u = SLOTS[t["id"]]
        xa, xb = BAYS[bay] + 0.025, BAYS[bay + 1] - 0.025
        bx = xa + 0.06 + u * (xb - xa - 0.12 - BOOK_T)
        x = bx + BOOK_T / 2
        y = SHELVES[si]
        z = Z_BACK + CASE_D / 2 + 0.02
        anchor = empty(f"Book_{t['id']}", (x, y, z), collection=C)
        anchor["topic"] = t["id"]
        anchor["title"] = t["title"]
        anchor["shelf_y"] = round(y, 3)
        anchor["reach"] = "ladder" if y + BOOK_H / 2 > 2.35 else "high" if y + BOOK_H / 2 > 1.7 else "mid" if y + BOOK_H / 2 > 0.75 else "low"
        m = MB(f"BookMesh_{t['id']}", smooth_angle=40)
        with m.frame((x, y, z)):
            cov = 0.0035
            col = t.get("colour", "BookRed")
            m.box((BOOK_T - 2 * cov, BOOK_H - 0.01, BOOK_D - 0.008), (0, BOOK_H / 2, -0.004), "Pages", tile=0.05)
            for sx in (-1, 1):
                m.box((cov, BOOK_H, BOOK_D), (sx * (BOOK_T / 2 - cov / 2), BOOK_H / 2, 0), col, bevel=0.0012, seg=1)
            m.cyl(BOOK_T / 2, BOOK_H, (0, BOOK_H / 2, BOOK_D / 2 - BOOK_T * 0.25), col, axis='y', segs=10)
            for yy in (0.02, BOOK_H - 0.02, 0.07):
                m.cyl(BOOK_T / 2 + 0.0012, 0.006, (0, yy, BOOK_D / 2 - BOOK_T * 0.25), "Gilt", axis='y', segs=10)
            zf = BOOK_D / 2 - BOOK_T * 0.25 + BOOK_T / 2 + 0.0006
            hw = BOOK_T * 0.36
            m.quad([(-hw, 0.095, zf), (hw, 0.095, zf), (hw, BOOK_H - 0.04, zf), (-hw, BOOK_H - 0.04, zf)], "SpineLabel")
        ob = m.build(origin=(x, y, z), collection=C, parent=anchor)
        out.append(anchor)
    return out


# ---------------------------------------------------------------- ladder and rail
def rail_and_ladder(C):
    r = MB("STATIC_rail")
    x0, x1 = BAYS[0] + 0.05, BAYS[-1] - 0.05
    r.cyl(0.016, x1 - x0, ((x0 + x1) / 2, RAIL_Y, RAIL_Z), "Brass", axis='x', segs=10)
    for x in BAYS:
        r.box((0.03, 0.03, RAIL_Z - (Z_BACK + CASE_D) + 0.02), (x, RAIL_Y, (RAIL_Z + Z_BACK + CASE_D) / 2), "Brass", bevel=0.006)
    for x in (x0, x1):
        r.sphere(0.026, (x, RAIL_Y, RAIL_Z), "Brass", segs=8, rings=6)
    rail = r.build(collection=C)
    # the ladder: origin at the hook on the rail, dynamic (slides along x)
    L = MB("LadderMesh")
    top = Vector((0, 0, 0))
    foot = Vector((0, -RAIL_Y, LADDER_FOOT))
    length = (foot - top).length
    tilt = math.degrees(math.atan2(LADDER_FOOT, RAIL_Y))
    with L.frame((0, 0, 0), pitch=-tilt):     # foot swings out into the room (+Z)
        for sx in (-1, 1):
            L.box((0.045, length + 0.05, 0.07), (sx * 0.24, -length / 2, 0), "Mahogany", bevel=0.01)
            L.cyl(0.035, 0.03, (sx * 0.24, -length, 0.02), "Iron", axis='x', segs=10)   # wheels
        steps = 8
        for i in range(1, steps + 1):
            yy = -length * i / (steps + 1)
            L.box((0.5, 0.035, 0.1), (0, yy, 0.02), "Mahogany", bevel=0.008, grain='x')
        for sx in (-1, 1):
            L.cyl(0.02, 0.06, (sx * 0.24, 0.02, -0.03), "Brass", segs=8)      # hooks
    xm = (BAYS[1] + BAYS[2]) / 2
    # the app moves the empty `Ladder` (meshopt bakes a dequantisation transform into mesh nodes, so moved nodes are empties)
    ladder = empty("Ladder", (xm, RAIL_Y, RAIL_Z), collection=C)
    mesh = L.build(origin=(0, 0, 0), collection=C)
    mesh.parent = ladder
    # standing step: the 3rd rung from the bottom (top surface), child of the ladder
    i_step = 8 - 2
    yy = -length * i_step / 9
    v = mat3((0, 0, 0), pitch=-tilt) @ Vector((0, yy + 0.02, 0.02))
    step = empty("Ladder_step", (xm + v.x, RAIL_Y + v.y, RAIL_Z + v.z), collection=C, parent=ladder)
    path = empty("Ladder_path", (0, RAIL_Y, RAIL_Z), collection=C)
    path["from"] = [x0 + 0.3, RAIL_Y, RAIL_Z]
    path["to"] = [x1 - 0.3, RAIL_Y, RAIL_Z]
    path["foot_offset"] = [0, -RAIL_Y, LADDER_FOOT]
    empty("Ladder_path.start", (x0 + 0.3, RAIL_Y, RAIL_Z), collection=C, parent=path)
    empty("Ladder_path.end", (x1 - 0.3, RAIL_Y, RAIL_Z), collection=C, parent=path)
    return [rail, ladder, path]


# ---------------------------------------------------------------- furniture and clutter
def table_and_props(C):
    t = MB("STATIC_table")
    x, _, z = TABLE_C
    W, D = 1.5, 0.82
    t.box((W, 0.05, D), (x, TABLE_TOP - 0.025, z), "Mahogany", bevel=0.012, grain='x')
    t.box((W - 0.16, 0.1, D - 0.16), (x, TABLE_TOP - 0.1, z), "Mahogany", bevel=0.008, grain='x')
    for sx in (-1, 1):
        for sz in (-1, 1):
            lx, lz = x + sx * (W / 2 - 0.1), z + sz * (D / 2 - 0.1)
            t.cyl(0.035, TABLE_TOP - 0.15, (lx, (TABLE_TOP - 0.15) / 2, lz), "Mahogany", segs=10, r2=0.028)
            t.sphere(0.045, (lx, 0.25, lz), "Mahogany", segs=10, rings=6, sy=0.6)
    t.box((W - 0.25, 0.04, 0.05), (x, 0.16, z), "Mahogany", grain='x')
    # lantern on the table
    lx, lz = x - 0.5, z - 0.18
    y = TABLE_TOP
    t.cyl(0.075, 0.02, (lx, y + 0.01, lz), "Brass", segs=12, bevel=0.004)
    t.cyl(0.06, 0.02, (lx, y + 0.24, lz), "Brass", segs=12, r2=0.03, bevel=0.003)
    t.torus(0.035, 0.006, (lx, y + 0.3, lz), "Brass", axis='z', seg=12, rseg=5)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        t.box((0.012, 0.21, 0.012), (lx + 0.06 * math.cos(a), y + 0.125, lz + 0.06 * math.sin(a)), "Brass")
    t.cyl(0.052, 0.2, (lx, y + 0.125, lz), "LanternGlow", segs=12)
    t.cyl(0.012, 0.06, (lx, y + 0.06, lz), "Candle", segs=8)
    t.sphere(0.012, (lx, y + 0.105, lz), "LanternFlame", segs=6, rings=4, sy=1.8)
    # the desk (table x -0.4..1.1, z 0.34..1.16; the visitor looks from +z). The front-centre around Table_drop stays
    # clear: fetched books land and open there, and the card catalogue (added by the app) stands at its right.
    dyn = MB("PROP_desk_lit")      # unbaked parts (app lights them): quill, compass, gilt bands, ribbon
    desk.spyglass(t, (x - 0.27, y, z - 0.33), yaw=-8)                       # back, beside the lantern
    desk.sea_chart(t, (x + 0.08, y, z - 0.14), yaw=-6)                      # back-centre
    desk.compass(dyn, (x + 0.2, y + 0.0012, z - 0.19))
    desk.open_book(t, (x + 0.52, y, z - 0.18), yaw=-14, cover="BookGreen", dyn=dyn)  # back-right, open toward the visitor
    desk.inkwell_and_quill(t, (x + 0.66, y, z + 0.1), yaw=-30, dyn=dyn)              # right
    for i, (w_, th, d_, mat, yw) in enumerate(((0.21, 0.042, 0.15, "BookBlue", -8), (0.19, 0.036, 0.14, "BookOchre", 6),
                                                 (0.17, 0.03, 0.125, "BookPlum", -3))):
        desk.closed_book(t, (x + 0.6, y + sum((0.042, 0.036, 0.03)[:i]), z + 0.27), w_, th, d_, mat, yaw=yw + 90, dyn=dyn)
    desk.rolled_chart(t, (x - 0.62, y, z + 0.12), length=0.4, yaw=78)       # left, beside the reading spot
    # stool at the right end of the table
    cx, cz = x + 1.0, z + 0.15
    t.cyl(0.19, 0.05, (cx, 0.5, cz), "Mahogany", segs=14, bevel=0.01)
    t.cyl(0.17, 0.04, (cx, 0.54, cz), "Cloth", segs=14, bevel=0.012)
    for k in range(3):
        a_ = math.radians(30 + 120 * k)
        t.cyl(0.02, 0.5, (cx + 0.12 * math.cos(a_), 0.25, cz + 0.12 * math.sin(a_)), "Mahogany", segs=8,
              roll=-8 * math.cos(a_), pitch=8 * math.sin(a_))
    table = t.build(collection=C)
    dyn.build(collection=C)

    p = MB("STATIC_props")
    rnd = random.Random(11)
    # rugs
    p.box((2.6, 0.012, 1.9), (x, 0.006, z), "RugRed", bevel=0.004)
    p.box((2.4, 0.014, 1.7), (x, 0.007, z), "RugBorder")
    p.box((2.3, 0.016, 1.6), (x, 0.008, z), "RugRed")
    p.cyl(0.85, 0.012, (-0.2, 0.006, -1.9), "RugBlue", segs=32)
    p.torus(0.8, 0.012, (-0.2, 0.012, -1.9), "RugBorder", axis='y', seg=32, rseg=4)
    # window seat under the portholes
    sx_ = hull_x(0.45) - 0.28
    p.box((0.5, 0.45, 3.4), (sx_, 0.225, -0.15), "Mahogany", bevel=0.012, grain='z')
    p.box((0.46, 0.08, 3.3), (sx_, 0.49, -0.15), "Cloth", bevel=0.03)
    for zz, mt in ((-1.5, "RugBlue"), (-0.45, "Sailcloth"), (0.55, "RugBlue")):
        p.box((0.1, 0.26, 0.34), (sx_ + 0.14, 0.64, zz), mt, bevel=0.045, seg=3, roll=12)
    # globe on a stand (front left), sea chest (front right), floor piles, map basket
    gx, gz = -1.6, 1.5
    p.cyl(0.18, 0.04, (gx, 0.02, gz), "Mahogany", segs=14, bevel=0.006)
    p.cyl(0.03, 0.75, (gx, 0.4, gz), "Mahogany", segs=8)
    p.torus(0.27, 0.012, (gx, 1.02, gz), "Brass", axis='x', seg=28, rseg=5)
    p.sphere(0.25, (gx, 1.02, gz), "Parchment", segs=18, rings=10)
    p.box((0.9, 0.48, 0.5), (1.55, 0.24, 2.2), "Mahogany", bevel=0.02, yaw=-15)
    p.box((0.92, 0.06, 0.52), (1.55, 0.5, 2.2), "DarkWood", bevel=0.02, yaw=-15)
    for k in (-0.3, 0.3):
        p.box((0.05, 0.5, 0.53), (1.55 + k * math.cos(math.radians(15)), 0.25, 2.2 + k * math.sin(math.radians(15))), "Iron", yaw=-15)
    for (fx, fz) in ((-2.0, -2.25), (1.9, -2.3), (-1.1, -2.4)):
        stack(p, fx, 0.0, fz, rnd, rnd.randint(3, 6))
    p.cyl(0.16, 0.36, (2.0, 0.18, -2.15), "Leather", segs=12, r2=0.18)
    for k in range(5):
        a = 2 * math.pi * k / 5
        p.cyl(0.028, 0.62, (2.0 + 0.07 * math.cos(a), 0.4, -2.15 + 0.07 * math.sin(a)), "Parchment", segs=8,
              roll=8 * math.cos(a), pitch=8 * math.sin(a))
    props = p.build(collection=C)
    # hanging lantern from the ridge: its own node (still lightmapped) so the app can swing it with the ship;
    # the app pivots it about the top of its chain
    hx, hz = 0.35, -0.6
    h = MB("STATIC_hanging_lantern")
    h.cyl(0.006, 0.7, (hx, CEIL_TOP - 0.42, hz), "Iron", segs=5)
    h.cyl(0.09, 0.03, (hx, CEIL_TOP - 0.79, hz), "Brass", segs=12, r2=0.05)
    h.cyl(0.07, 0.24, (hx, CEIL_TOP - 0.93, hz), "LanternGlow", segs=12)
    h.cyl(0.085, 0.025, (hx, CEIL_TOP - 1.06, hz), "Brass", segs=12)
    h.sphere(0.014, (hx, CEIL_TOP - 0.95, hz), "LanternFlame", segs=6, rings=4, sy=1.8)
    hanging = h.build(collection=C)

    # left wall: a lower bookcase against the hull
    lx = -(hull_x(1.1) - 0.03)
    left = bookcase("STATIC_bookcase_left", C, [-1.1, -0.0, 1.1], [0.06, 0.5, 0.94, 1.38, 1.82], 2.2, 0.32,
                    (lx + 0.02, 0, -1.0), 90, seed=5)
    return [table, props, hanging] + left


def contract_nodes(C):
    nodes = [empty("Librarian", (-0.85, 0, -1.05), yaw=20, collection=C),
             empty("Table_drop", (TABLE_C[0] - 0.05, TABLE_TOP + 0.004, TABLE_C[2] + 0.28), yaw=0, collection=C)]

    def cam(name, pos, tgt):
        d = Vector(tgt) - Vector(pos)
        yaw = math.degrees(math.atan2(-d.x, -d.z))
        pitch = math.degrees(math.atan2(d.y, math.hypot(d.x, d.z)))
        e = empty(name, pos, yaw=yaw, pitch=pitch, collection=C, kind='SINGLE_ARROW')
        e["target"] = list(tgt)
        return e
    nodes += [cam("Camera_main", (0.0, 1.85, 3.0), (0.05, 0.95, -1.4)),
              cam("Camera_table", (0.9, 1.45, 2.05), (0.2, 0.85, 0.5)),
              cam("Camera_shelf", (0.2, 1.5, 0.4), (0.0, 1.5, -3.0))]
    return nodes


def sky_backdrops(C):
    """Painted sunset discs outside the portholes (emissive, unlit, not baked)."""
    out = []
    for i, (pz, py) in enumerate(PORTHOLES):
        m = MB(f"Sky_backdrop_{i}", smooth_angle=0)
        x = hull_x(py) + 0.9
        with m.frame((x, py, pz), yaw=-90):
            disc(m, 0.9, 0.0, "SkyBackdrop", n=24)
        out.append(m.build(collection=C))
    return out


# ---------------------------------------------------------------- lighting (sunset rig, after kit/lights.py)
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


MODES = ("sunset", "night")      # the cabin has these two states (the lantern switches them)
# per time of day: world colour/strength, sun (energy, colour), porthole sky fill, room fill, front fill, lanterns (table, hanging)
RIGS = {
    "sunset": dict(world=((1.0, 0.6, 0.45), 0.6), sun=(6.0, (1.0, 0.58, 0.3)), sky=(80, (1.0, 0.66, 0.7)),
                   room=(150, (0.72, 0.6, 0.86)), front=(120, (0.85, 0.7, 0.8)), lanterns=(30, 70)),
    "dawn":   dict(world=((0.82, 0.74, 0.86), 0.7), sun=(3.6, (1.0, 0.8, 0.68)), sky=(90, (0.85, 0.78, 0.95)),
                   room=(170, (0.78, 0.76, 0.95)), front=(130, (0.86, 0.84, 0.92)), lanterns=(8, 18)),
    "night":  dict(world=((0.12, 0.16, 0.32), 0.1), sun=(0.5, (0.55, 0.65, 1.0)), sky=(22, (0.45, 0.55, 1.0)),
                   room=(18, (0.45, 0.5, 0.85)), front=(10, (0.5, 0.55, 0.85)), lanterns=(70, 160)),
}


def world(mode="sunset"):
    w = bpy.data.worlds.get("Sky") or bpy.data.worlds.new("Sky")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get("Background")
    col, strength = RIGS[mode]["world"]
    bg.inputs["Color"].default_value = (*col, 1)
    bg.inputs["Strength"].default_value = strength


def rig(mode="sunset"):
    for o in list(bpy.data.objects):
        if o.get("rig"):
            bpy.data.objects.remove(o)
    R = RIGS[mode]
    world(mode)
    # low sun (or the moon) through the portholes, from +X and a little from the front
    light("Sun", 'SUN', R["sun"][0], R["sun"][1], direction=(-1.0, -0.32, -0.35), angle=2)
    for pz, py in PORTHOLES:
        light(f"SkyFill{pz}", 'AREA', R["sky"][0], R["sky"][1], loc=(hull_x(py) + 0.5, py, pz), direction=(-1, -0.15, 0), size=0.8)
    # painted look: weak cool fill so the sun patches read, warm lantern pools (the only real light at night)
    light("RoomFill", 'AREA', R["room"][0], R["room"][1], loc=(0, CEIL_TOP - 0.15, 0), direction=(0, -1, 0), size=4.0)
    light("FrontFill", 'AREA', R["front"][0], R["front"][1], loc=(0, 1.8, Z_FRONT - 0.2), direction=(0, -0.2, -1), size=3.0)
    x, _, z = TABLE_C
    light("TableLantern", 'POINT', R["lanterns"][0], (1.0, 0.55, 0.22), loc=(x - 0.5, TABLE_TOP + 0.12, z - 0.18), size=0.04)
    light("HangingLantern", 'POINT', R["lanterns"][1], (1.0, 0.58, 0.25), loc=(0.35, CEIL_TOP - 0.93, -0.6), size=0.05)


def cycles(samples, denoise=True):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cy.device = 'GPU'
    except Exception as e:
        log("GPU setup failed:", e)
        cy.device = 'CPU'
    cy.samples = samples
    cy.use_denoising = denoise
    cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 6, 4, 2
    sc.view_settings.view_transform = 'AgX'


# ---------------------------------------------------------------- bake (after kit/bake.py, sunset only)
LM_SCALE = 3.0
LM_RES = 2048


def bake(statics, samples, mode="sunset"):
    import numpy as np
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
        if (o.name.startswith(("BookMesh_", "LadderMesh", "Sky_backdrop", "Window_glass"))) and o.type == 'MESH':
            o.hide_render = True
            hidden.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in statics:
        o.select_set(True)
        o.data.uv_layers.active = o.data.uv_layers["Lightmap"]
    bpy.context.view_layer.objects.active = statics[0]
    import time
    t0 = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True,
                        target='IMAGE_TEXTURES')
    # the book runs (thousands of tiny boxes) take their light as vertex colours (COLOR_0 = L / LM_SCALE)
    vcs = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("VC_")] if mode == "sunset" else []
    if vcs:
        bpy.ops.object.select_all(action='DESELECT')
        for o in vcs:
            attr = o.data.color_attributes.get("Lighting") or o.data.color_attributes.new("Lighting", 'FLOAT_COLOR', 'CORNER')
            o.data.color_attributes.active_color = attr
            o.select_set(True)
        bpy.context.view_layer.objects.active = vcs[0]
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, target='VERTEX_COLORS')
        for o in vcs:
            a = o.data.color_attributes["Lighting"]
            n = len(a.data)
            col = np.empty(n * 4, np.float32)
            a.data.foreach_get("color", col)
            col = col.reshape(-1, 4)
            col[:, :3] = np.clip(col[:, :3] / LM_SCALE, 0, 1)
            col[:, 3] = 1
            a.data.foreach_set("color", col.ravel())
        log(f"vertex-colour bake: {len(vcs)} meshes")
    px = np.empty(LM_RES * LM_RES * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(LM_RES, LM_RES, 4)
    lin, cover = px[..., :3].copy(), px[..., 3] > 0.5
    lin = denoise(lin, cover)
    log(f"baked in {time.time() - t0:.0f}s, coverage {cover.mean():.2f}, lum p50 {np.percentile(lin[cover].mean(1), 50):.3f}")
    os.makedirs(OUT, exist_ok=True)
    np.save(os.path.join(OUT, "lm_sunset.npy"), lin.astype(np.float16))
    for o in hidden:
        o.hide_render = False
    for o in statics:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        for slot in o.material_slots:
            nt = slot.material.node_tree
            if nt.nodes.get("LM_BAKE"):
                nt.nodes.remove(nt.nodes["LM_BAKE"])
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


# ---------------------------------------------------------------- preview renders
def preview(lin=None):
    """Cycles renders from the contract cameras with the librarian standing at his empty and spine titles."""
    cycles(96, denoise=True)
    rig()
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    # librarian in his idle pose
    glb = os.path.join(ROOT, "art", "librarian", "librarian.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    root = arm
    while root.parent:
        root = root.parent
    anchor = bpy.data.objects["Librarian"]
    root.matrix_world = anchor.matrix_world @ root.matrix_world
    act = bpy.data.actions.get("idle")
    if act:
        arm.animation_data_create()
        arm.animation_data.action = act
        if hasattr(arm.animation_data, "action_slot") and act.slots:
            arm.animation_data.action_slot = act.slots[0]
    sc.frame_set(30)
    # spine titles (preview only; the app draws them on canvas textures)
    ink = bpy.data.materials.new("PreviewInk")
    ink.diffuse_color = (0.08, 0.05, 0.03, 1)
    ink.use_nodes = True
    ink.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.06, 0.04, 0.03, 1)
    for t in TOPICS:
        a = bpy.data.objects[f"Book_{t['id']}"]
        cu = bpy.data.curves.new(f"title_{t['id']}", 'FONT')
        cu.body = t["title"].upper()
        cu.align_x, cu.align_y = 'CENTER', 'CENTER'
        avail = BOOK_H - 0.15
        cu.size = min(0.022, avail / (0.62 * len(cu.body)))
        ob = bpy.data.objects.new(f"title_{t['id']}", cu)
        sc.collection.objects.link(ob)
        ob.data.materials.append(ink)
        zf = BOOK_D / 2 - BOOK_T * 0.25 + BOOK_T / 2 + 0.0015
        ob.location = a.matrix_world @ T(0, 0.095 + (BOOK_H - 0.135) / 2, zf)
        ob.rotation_euler = (math.radians(90), math.radians(-90), 0)
    cam_d = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    os.makedirs(os.path.join(OUT, "previews"), exist_ok=True)
    for name, lens in (("Camera_main", 24), ("Camera_table", 30), ("Camera_shelf", 28)):
        e = bpy.data.objects[name]
        bpy.context.view_layer.update()
        cam.matrix_world = e.matrix_world @ Matrix.Rotation(math.radians(90), 4, 'X')
        cam_d.lens = lens
        sc.render.filepath = os.path.join(ROOT, "docs", "room", f"{name}.png")
        bpy.ops.render.render(write_still=True)
        log("rendered", name)


# ---------------------------------------------------------------- main
def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return {"bake": "--no-bake" not in a, "preview": "--preview" in a,
            "samples": int(a[a.index("--samples") + 1]) if "--samples" in a else 128}


def main():
    opt = args()
    util.reset()
    materials.init_all()
    C = bpy.data.collections.new("Room")
    bpy.context.scene.collection.children.link(C)
    objs = shell(C)
    objs += deck_hatch(C, objs[1])
    objs += bookcase("STATIC_bookcase", C, BAYS, SHELVES, CASE_H, CASE_D, (0, 0, Z_BACK), 0, SLOTS, seed=3)
    objs += topic_books(C)
    objs += rail_and_ladder(C)
    objs += table_and_props(C)
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
        import numpy as np
        os.makedirs(ASSETS, exist_ok=True)
        meta, means = {}, {}
        for mode in MODES:
            lin = bake(statics, opt["samples"], mode)
            cover = lin.sum(2) > 1e-5
            means[mode] = lin[cover].mean(0)
            save_lightmap(lin, os.path.join(ASSETS, f"library_lightmap_{mode}.webp"), 2048)
            save_lightmap(lin, os.path.join(ASSETS, f"library_lightmap_{mode}_lite.webp"), 1024)
            meta[mode] = {"file": f"library_lightmap_{mode}.webp", "lite": f"library_lightmap_{mode}_lite.webp", "scale": LM_SCALE,
                          "lightMapIntensity": round(LM_SCALE * math.pi, 4)}
        # the book runs carry the sunset light in COLOR_0; other times tint it by the room's mean light ratio
        for mode in MODES:
            meta[mode]["books"] = [round(float(v), 3) for v in np.clip(means[mode] / np.maximum(means["sunset"], 1e-4), 0, 2)]
        with open(os.path.join(ASSETS, "library_lightmaps.json"), "w") as f:
            json.dump(meta, f, indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "library.blend"))
    roots = [o for o in C.all_objects if o.parent is None]
    raw = os.path.join(OUT, "library_raw.glb")
    export.select_tree(roots)
    bpy.ops.export_scene.gltf(filepath=raw, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_image_format='WEBP', export_image_quality=85, export_extras=True,
                              export_cameras=False, export_lights=False, export_animations=False,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    info = export.glb_info(raw)
    log(f"library_raw.glb {info['bytes'] / 1024:.0f} KB, {info['tris']} tris, lightmapped: {len(info['uv1_nodes'])} meshes")
    if opt["preview"]:
        preview()


if __name__ == "__main__":
    main()
