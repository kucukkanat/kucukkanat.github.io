"""The captain round: the chart table turns clockwise (seen from above) and the captain sits on his throne behind it.

Everything that belongs to the table (STATIC_table with its compass, spyglass, logbook and chart, the lantern, the
handheld, the letter, their hit boxes, SLOT_map and the viewpoints that look at them) is rotated about the table's
centre. The captain model (art/models/captain.glb) is imported only as a shadow caster for the bake; the cabin.glb
carries just the empty `Captain` (pose + scale) and the app loads /assets/captain.glb onto it.
"""
import math
import os
import bpy
from mathutils import Matrix, Vector
from . import util
from . import layout as L

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL = os.path.join(ROOT, "art", "models", "captain.glb")

TABLE_YAW = -30.0          # degrees about +Y (three.js); negative = clockwise seen from above
CAPTAIN_BEHIND = 0.95      # metres from the table centre to the throne centre, along the table's back axis
CAPTAIN_SIDE = 0.12        # metres to the table's right (away from the wheel)
CAPTAIN_SCALE = 1.45       # model units → metres (model is ~0.95 tall incl. hat)
CAPTAIN_YAW_EXTRA = 0.0    # extra turn of the throne relative to the table
RUG_LIFT = 0.012           # the rug under the table is ~1 cm thick

TABLE_NODES = ["STATIC_table", "Lantern", "Handheld", "Letter", "HIT_table", "HIT_handheld", "HIT_lantern",
               "HIT_letter", "SLOT_map", "VP_table", "VP_table_T", "VP_handheld", "VP_handheld_T", "VP_screen",
               "VP_screen_T", "VP_letter", "VP_letter_T"]


def _pivot_matrix(yaw_deg):
    c = util.T(L.TABLE_C[0], 0.0, L.TABLE_C[2])
    piv = Vector(c)
    # three.js yaw about +Y = Blender rotation about +Z (same handedness: three −Z ↔ Blender +Y)
    return Matrix.Translation(piv) @ Matrix.Rotation(math.radians(yaw_deg), 4, 'Z') @ Matrix.Translation(-piv)


def rotate_table():
    M = _pivot_matrix(TABLE_YAW)
    for name in TABLE_NODES:
        o = bpy.data.objects.get(name)
        if o is None:
            print("[captain] missing", name)
            continue
        if o.parent is not None and o.parent.name in TABLE_NODES:
            continue
        o.matrix_world = M @ o.matrix_world
    bpy.context.view_layer.update()


def captain_pose():
    """three.js position + yaw (degrees) of the throne's floor centre."""
    a = math.radians(TABLE_YAW)
    # table local back axis (−Z) and right axis (+X) after the yaw
    back = (-math.sin(a), -math.cos(a))   # (x, z)
    right = (math.cos(a), -math.sin(a))
    x = L.TABLE_C[0] + back[0] * CAPTAIN_BEHIND + right[0] * CAPTAIN_SIDE
    z = L.TABLE_C[2] + back[1] * CAPTAIN_BEHIND + right[1] * CAPTAIN_SIDE
    return (x, 0.0, z), TABLE_YAW + CAPTAIN_YAW_EXTRA


def build(C):
    rotate_table()
    pos, yaw = captain_pose()
    anchor = bpy.data.objects.new("Captain", None)
    anchor.empty_display_size = 0.3
    C.objects.link(anchor)
    anchor.location = util.T(pos[0], RUG_LIFT, pos[2])
    anchor.rotation_euler = util.euler_b(yaw, 0)
    anchor.scale = (CAPTAIN_SCALE,) * 3
    bpy.context.view_layer.update()
    if not os.path.exists(MODEL):
        print("[captain] no model at", MODEL)
        return anchor
    # shadow caster for the bake, in its own collection (not exported)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=MODEL)
    new = [o for o in bpy.data.objects if o not in before]
    bake_coll = bpy.data.collections.get("CaptainBake") or bpy.data.collections.new("CaptainBake")
    if bake_coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(bake_coll)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        bake_coll.objects.link(o)
    roots = [o for o in new if o.parent is None]
    # sit the model's lowest point on the floor
    lo = min((o.matrix_world @ Vector(v)).z for o in new if o.type == 'MESH' for v in o.bound_box)
    for o in roots:
        o.matrix_world = anchor.matrix_world @ Matrix.Translation((0, 0, -lo)) @ o.matrix_world
    print("[captain] at", pos, "yaw", yaw, "floor offset", lo)
    return anchor
