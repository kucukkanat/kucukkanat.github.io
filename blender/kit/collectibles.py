"""Instanced templates (collectibles.glb). All at origin, base on y=0, facing +Z (three)."""
import math
import random
import bpy
import bmesh
from mathutils import Vector
from . import util
from .util import MB


def coll(name):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


def label_quad(mb, x0, x1, y0, y1, z, mat):
    mb.quad([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat)


def cartridge(C):
    W, H, D = 0.06, 0.075, 0.012
    m = MB("TPL_cartridge", smooth_angle=40)
    m.box((W, H - 0.006, D), (0, (H - 0.006) / 2, 0), "Plastic", bevel=0.0035, seg=2)
    # chunkier top grip block with ridges on both faces
    m.box((W, 0.016, D + 0.002), (0, H - 0.008, 0), "Plastic", bevel=0.003, seg=2)
    for k in range(4):
        y = H - 0.004 - k * 0.0035
        for sz in (-1, 1):
            m.box((W - 0.012, 0.0016, 0.0012), (0, y, sz * (D / 2 + 0.0012)), "Plastic", bevel=0.0005, seg=1)
    # side notches
    for sx in (-1, 1):
        m.box((0.002, 0.012, D * 0.6), (sx * (W / 2 + 0.0005), 0.03, 0), "Plastic", bevel=0.0006, seg=1)
    # raised rim around the (inset) label area on the front
    lx0, lx1, ly0, ly1 = -0.024, 0.024, 0.009, 0.056
    zf = D / 2
    r = 0.0025
    m.box((lx1 - lx0 + 2 * r, r, 0.0012), (0, ly0 - r / 2, zf + 0.0005), "Plastic", bevel=0.0004, seg=1)
    m.box((lx1 - lx0 + 2 * r, r, 0.0012), (0, ly1 + r / 2, zf + 0.0005), "Plastic", bevel=0.0004, seg=1)
    for sx in (lx0 - r / 2, lx1 + r / 2):
        m.box((r, ly1 - ly0, 0.0012), (sx, (ly0 + ly1) / 2, zf + 0.0005), "Plastic", bevel=0.0004, seg=1)
    label_quad(m, lx0, lx1, ly0, ly1, zf + 0.0002, "Label")
    # back: little grip arrow
    m.box((0.02, 0.012, 0.001), (0, 0.025, -zf - 0.0004), "Plastic", bevel=0.0003, seg=1)
    return m.build(collection=C)


def book(C, name, T, H, D):
    m = MB(name, smooth_angle=40)
    cov = 0.0035
    # pages block: open edge toward -Z, spine at +Z
    m.box((T - 2 * cov, H - 0.01, D - 0.008), (0, H / 2, -0.004), "Pages", tile=0.05)
    for sx in (-1, 1):
        m.box((cov, H, D), (sx * (T / 2 - cov / 2), H / 2, 0), "Cover", bevel=0.0012, seg=1)
    # rounded spine
    m.cyl(T / 2, H, (0, H / 2, D / 2 - T * 0.25), "Cover", axis='y', segs=10)
    # spine bands
    for yy in (0.018, H - 0.018):
        m.cyl(T / 2 + 0.0012, 0.006, (0, yy, D / 2 - T * 0.25), "Cover", axis='y', segs=10)
    # spine label: flat quad in front of the rounded spine
    zf = D / 2 - T * 0.25 + T / 2 + 0.0004
    hw = T * 0.36
    label_quad(m, -hw, hw, 0.03, H - 0.03, zf, "SpineLabel")
    return m.build(collection=C)


def memcard(C):
    W, H, D = 0.10, 0.12, 0.008
    m = MB("TPL_memcard", smooth_angle=40)
    from .handheld import rrect
    m.prism(rrect(W, H, 0.012, 4, 0, H / 2), D, (0, 0, 0), "Plastic", plane='xy', bevel=0.0018, seg=2)
    # notch at the top edge (keyed insert)
    m.box((0.03, 0.004, D + 0.0006), (0.02, H - 0.001, 0), "Contacts", bevel=0.0006)
    zf = D / 2
    # label recess rim
    lx0, lx1, ly0, ly1 = -0.04, 0.04, 0.036, 0.106
    r = 0.003
    m.box((lx1 - lx0 + 2 * r, r, 0.001), (0, ly0 - r / 2, zf + 0.0004), "Plastic", bevel=0.0003, seg=1)
    for sx in (lx0 - r / 2, lx1 + r / 2):
        m.box((r, ly1 - ly0 - 0.006, 0.001), (sx, (ly0 + ly1) / 2 - 0.003, zf + 0.0004), "Plastic", bevel=0.0003, seg=1)
    label_quad(m, lx0, lx1, ly0, ly1, zf + 0.0002, "Label")
    # gold contact strip
    m.box((0.074, 0.022, 0.0008), (0, 0.017, zf + 0.0001), "Plastic")
    for k in range(9):
        x = -0.032 + k * 0.008
        m.box((0.0055, 0.018, 0.0012), (x, 0.017, zf + 0.0006), "Contacts", bevel=0.0003, seg=1)
    # grip ridges on the right edge
    for k in range(4):
        m.box((0.0015, 0.004, D * 0.7), (W / 2 + 0.0004, 0.05 + k * 0.007, 0), "Plastic", bevel=0.0003, seg=1)
    return m.build(collection=C)


def jag_rock(r_top, depth, seed, rings=3, segs=7, y_top=0.0):
    """Inverted jagged cone: top ring at y_top, tip at y_top - depth. Returns bmesh (three coords)."""
    rnd = random.Random(seed)
    tb = bmesh.new()
    ringv = []
    for i in range(rings + 1):
        t = i / rings
        rr = r_top * (1 - t ** 1.3) * (0.85 + 0.25 * rnd.random()) if i > 0 else r_top
        y = y_top - depth * t
        ring = []
        for j in range(segs):
            a = 2 * math.pi * (j + 0.3 * rnd.random()) / segs
            rj = rr * (0.8 + 0.35 * rnd.random()) if i > 0 else rr * (0.92 + 0.12 * rnd.random())
            ring.append(tb.verts.new((rj * math.cos(a), y + (0.1 * depth * (rnd.random() - 0.5) if i > 0 else 0), rj * math.sin(a))))
        ringv.append(ring)
    tip = tb.verts.new((r_top * 0.1 * (rnd.random() - 0.5), y_top - depth * 1.12, 0))
    for i in range(rings):
        a, b = ringv[i], ringv[i + 1]
        for j in range(segs):
            tb.faces.new((a[j], a[(j + 1) % segs], b[(j + 1) % segs], b[j]))
    last = ringv[-1]
    for j in range(segs):
        tb.faces.new((last[j], last[(j + 1) % segs], tip))
    tb.faces.new(ringv[0][::-1])
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    return tb


def island_pin(C):
    """Map pin: a little painted-figurine floating island, ~7 cm wide, origin at the base centre, front +Z.
    Bevelled grass top with a pine and a flag pole; the flag is its own mesh `Island_flag` (material
    IslandFlag, the app tints it); layered rock (Rock / RockMid / RockDark) tapering to a small flat foot."""
    from . import islands as I
    r, depth, H = 0.034, 0.04, 0.04             # grass top at y = H, rock down to the flat foot at y = 0
    mats = {"grass": "Grass", "grass_hi": "Grass", "lip": "GrassDark", "soil": "RockDark", "rock1": "Rock",
            "rock2": "RockMid", "rock3": "RockDark", "rock4": "RockDark", "root": "Wood", "vine": "GrassDark",
            "trunk": "Wood", "pine1": "Leaves", "pine2": "Grass", "leaf": "Leaves", "leaf2": "Grass", "stone": "RockMid"}
    m = MB("TPL_island", smooth_angle=0, flat=True)
    with m.frame((0, H, 0)):
        isl = I.Island(m, r, depth, 7, mats, n=12, strata=3, ledge=0.06, flat_base=0.42)
        I.pine(m, isl.on_top(-0.013, -0.008, 0.02), 0.066, mats, seed=1)
        I.round_tree(m, isl.on_top(-0.001, -0.02, 0.02), 0.05, mats, seed=2)
        I.boulder(m, isl.on_top(0.012, 0.016, 0.05), 0.0042, "RockMid", seed=3)
        I.boulder(m, isl.on_top(-0.018, 0.012, 0.05), 0.003, "RockMid", seed=4)
        isl.tufts(6, "GrassDark", seed=4, avoid=((-0.013, -0.008, 0.012), (0.014, -0.002, 0.008)), s=1.3)
        # flag pole (Wood) with a ball finial
        fx, fz = 0.014, -0.002
        fy = isl.top_y(fx, fz)
        m.cyl(0.0011, 0.036, (fx, fy + 0.018, fz), "Wood", segs=5)
        m.sphere(0.0017, (fx, fy + 0.0365, fz), "Wood", segs=6, rings=4)
    ob = m.build(collection=C)
    # pennant: own mesh + material so the app can tint it; slightly waving, two-sided
    f = MB("Island_flag", smooth_angle=60)
    import bmesh
    from mathutils import Vector
    tb = bmesh.new()
    top_y = H + fy + 0.034
    L_, h_ = 0.02, 0.013
    cols = 5
    rows_ = []
    for i in range(cols + 1):
        t = i / cols
        x = fx + 0.0012 + L_ * t
        z = fz + 0.0025 * math.sin(t * math.pi * 1.6)
        hh = h_ * (1 - 0.85 * t)                    # tapers to a pennant
        rows_.append([tb.verts.new((x, top_y - (h_ - hh) / 2 - 0.0005 * t, z)),
                      tb.verts.new((x, top_y - (h_ + hh) / 2 + 0.0005 * t, z))])
    back = [[tb.verts.new(v.co + Vector((0, 0, -0.0003))) for v in row] for row in rows_]
    for i in range(cols):
        a, b = rows_[i], rows_[i + 1]
        tb.faces.new((a[1], b[1], b[0], a[0]))
        a, b = back[i], back[i + 1]
        tb.faces.new((a[0], b[0], b[1], a[1]))
    f.raw(tb, "IslandFlag", uv=None)
    fob = f.build(collection=C)
    fob.parent = ob
    return ob


COLLECTIBLE_MATS = {
    "Plastic": ((0.55, 0.55, 0.58), 0.5, 0.0),
    "Label": ((1, 1, 1), 0.6, 0.0),
    "Cover": ((0.5, 0.18, 0.12), 0.7, 0.0),
    "Pages": ((0.9, 0.84, 0.7), 0.9, 0.0),
    "SpineLabel": ((1, 1, 1), 0.6, 0.0),
    "Contacts": ((1.0, 0.72, 0.25), 0.3, 1.0),
    "Rock": ((0.66, 0.5, 0.34), 0.9, 0.0),
    "RockMid": ((0.45, 0.32, 0.23), 0.9, 0.0),
    "RockDark": ((0.28, 0.2, 0.17), 0.9, 0.0),
    "Grass": ((0.3, 0.52, 0.16), 0.85, 0.0),
    "GrassDark": ((0.2, 0.38, 0.11), 0.9, 0.0),
    "Leaves": ((0.15, 0.32, 0.12), 0.9, 0.0),
    "Wood": ((0.3, 0.18, 0.1), 0.8, 0.0),
    "IslandFlag": ((0.75, 0.12, 0.1), 0.7, 0.0),
}


def make_mats():
    for n, (c, r, mt) in COLLECTIBLE_MATS.items():
        m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
        m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (*c, 1)
        b.inputs["Roughness"].default_value = r
        b.inputs["Metallic"].default_value = mt


def build():
    make_mats()
    C = coll("Collectibles")
    objs = [cartridge(C), book(C, "TPL_book", 0.035, 0.24, 0.17), book(C, "TPL_notebook", 0.02, 0.21, 0.15),
            memcard(C), island_pin(C)]
    return objs
