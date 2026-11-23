"""The hatch down to the library deck: an opening in the cabin floor beside the bookshelf, lined below, with a
raised coaming, the trapdoor standing open toward the wall and a ladder whose rails rise out of the opening as
handholds. Lightmapped (STATIC_hatch); HIT_hatch and VP_hatch for the app. Coordinates are three.js (see
docs/SCENE_CONTRACT.md)."""
import math
import bpy
from . import util
from .util import MB

# floor centre of the opening, between the bookshelf unit and the visitor, clear of the table and the rug
HATCH_C = (-2.05, 0.0, 0.35)
OPEN = 0.7          # opening, square
WELL = 0.9          # how deep the lined well goes below the floor


def cut_floor(floor):
    """Cut the opening out of the floor slab (a boolean with a box, applied)."""
    x, _, z = HATCH_C
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=util.T(x, -0.06, z))
    cutter = bpy.context.object
    cutter.scale = (OPEN, OPEN, 0.5)
    mod = floor.modifiers.new("hatch", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = floor
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter)
    # the boolean can leave an empty material slot (the cutter had none): give it the floor's own material
    mats = floor.data.materials
    for i, m in enumerate(mats):
        if m is None:
            mats[i] = next(x for x in mats if x is not None)


def build_static(C):
    x, _, z = HATCH_C
    h = MB("STATIC_hatch", smooth_angle=40)
    o2, t = OPEN / 2, 0.03
    with h.frame((x, 0, z)):
        # well lining and its floor, below the deck
        for sx, sz, w, d in ((1, 0, t, OPEN), (-1, 0, t, OPEN), (0, 1, OPEN, t), (0, -1, OPEN, t)):
            h.box((w, WELL, d), (sx * (o2 - t / 2), -WELL / 2, sz * (o2 - t / 2)), "DarkWood", grain='y')
        h.box((OPEN, 0.03, OPEN), (0, -WELL, 0), "DarkWood", grain='x')
        # raised coaming around the opening
        cw, ch = 0.08, 0.07
        for sx in (-1, 1):
            h.box((cw, ch, OPEN + 2 * cw), (sx * (o2 + cw / 2), ch / 2, 0), "Mahogany", bevel=0.01, grain='z')
            h.box((OPEN, ch, cw), (0, ch / 2, sx * (o2 + cw / 2)), "Mahogany", bevel=0.01, grain='x')
        # ladder on the wall side, rails rising 0.8 m above the deck as handholds
        lx = -o2 + 0.09
        for sz in (-1, 1):
            h.box((0.05, WELL + 0.8, 0.05), (lx, (0.8 - WELL) / 2, sz * 0.2), "Mahogany", bevel=0.008)
            h.sphere(0.035, (lx, 0.82, sz * 0.2), "Brass", segs=10, rings=6)
        for k in range(5):
            h.cyl(0.018, 0.4, (lx + 0.01, -WELL + 0.12 + k * 0.24, 0), "Mahogany", axis='z', segs=8)
        # the trapdoor, hinged at the wall-side edge, standing open past upright toward the wall
        hinge_x = -o2 - 0.08
        with h.frame((hinge_x, 0.07, 0), roll=100):
            h.box((OPEN + 0.06, 0.045, OPEN + 0.1), ((OPEN + 0.06) / 2, 0.0225, 0), "Planks", bevel=0.008, grain='x')
            for bz in (-0.22, 0.22):
                h.box((OPEN, 0.012, 0.06), (OPEN / 2 + 0.03, 0.05, bz), "Iron", bevel=0.003)
            h.torus(0.045, 0.008, (OPEN * 0.75, 0.06, 0), "Brass", axis='y', seg=16, rseg=6)
        for bz in (-0.22, 0.22):
            h.cyl(0.02, 0.09, (hinge_x, 0.07, bz), "Brass", axis='z', segs=10)
    return h.build(collection=C)


def build_nodes(C):
    from .cabin import vp, hit
    x, _, z = HATCH_C
    vp(C, "VP_hatch", (x + 0.75, 1.55, z + 0.95), (x - 0.05, 0.05, z - 0.05))
    hit(C, "HIT_hatch", (x, 0.35, z), (OPEN + 0.25, 0.7, OPEN + 0.25))
    util.empty("HATCH_anchor", (x, 0.0, z), collection=C, size=0.2)


def build(C, objs):
    cut_floor(objs["floor"])
    objs["hatch"] = build_static(C)
    build_nodes(C)
