"""Preview renders from the VP_* viewpoints (Cycles, 1280x720, 50deg vertical FOV)."""
import math
import os
import bpy
from mathutils import Vector
from . import lights

VIEWS = ["overview", "chest", "handheld", "table", "rack", "shelf", "screen", "portrait", "letter"]


# close-up cameras for the fix-round checks (three coords: camera, target)
FIX_CAMS = {
    "bell": ((-0.78, 1.95, -1.45), (-1.226, 1.86, -2.061)),
    "lantern": ((-0.33, 1.08, 0.33), (-0.55, 1.0, -0.08)),
    "clock": ((1.5, 1.86, -1.25), (1.962, 1.8, -1.943)),
    "rope": ((0.15, 1.45, 2.45), (-0.66, 0.75, 1.5)),
    "tablefix": ((0.25, 1.45, 0.75), (0.3, 0.85, -0.12)),
    "lamp": ((0.25, 1.95, 0.6), (0.75, 2.5, -0.35)),
    "leftwall": ((-1.7, 1.55, 0.5), (-2.9, 1.2, -0.45)),
    "coils": ((-1.5, 1.4, 1.9), (-2.45, 0.1, 1.5)),
    "uniform": ((1.7, 1.6, -0.3), (3.0, 1.5, -0.3)),
    "uniform_walk": ((1.75, 1.6, 0.75), (3.0, 1.5, -0.3)),
    "uniform_boards": ((2.3, 1.6, -0.4), (2.9, 1.53, -0.575)),
    "uniform_cap": ((2.3, 1.7, -0.2), (2.87, 1.84, -0.49)),
    "uniform_jacket": ((2.1, 1.45, 0.1), (2.9, 1.38, -0.02)),
}


def camera_for(vp):
    a = bpy.data.objects.get("VP_" + vp)
    b = bpy.data.objects.get("VP_" + vp + "_T")
    if a is None and vp in FIX_CAMS:
        from . import util
        a = bpy.data.objects.get("FIXCAM_" + vp) or bpy.data.objects.new("FIXCAM_" + vp, None)
        b = bpy.data.objects.get("FIXCAM_" + vp + "_T") or bpy.data.objects.new("FIXCAM_" + vp + "_T", None)
        for o in (a, b):
            if o.name not in bpy.context.scene.collection.objects:
                bpy.context.scene.collection.objects.link(o)
        a.location = util.T(*FIX_CAMS[vp][0])
        b.location = util.T(*FIX_CAMS[vp][1])
    bpy.context.view_layer.update()
    cd = bpy.data.cameras.get("PreviewCam") or bpy.data.cameras.new("PreviewCam")
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(50)
    cd.clip_start = 0.01
    cam = bpy.data.objects.get("PreviewCam") or bpy.data.objects.new("PreviewCam", cd)
    if cam.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(cam)
    pa, pb = a.matrix_world.translation, b.matrix_world.translation
    cam.location = pa
    cam.rotation_euler = (pb - pa).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(path, vp, w=1280, h=720):
    sc = bpy.context.scene
    camera_for(vp)
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def hide_helpers(hide=True):
    for o in bpy.data.objects:
        if o.name.startswith("HIT_"):
            o.hide_render = hide


def preview_portrait():
    """Preview only (after export): show public/assets/portrait.webp on the canvas like the app does."""
    path = os.path.join(lights.ROOT, "public", "assets", "portrait.webp")
    m = bpy.data.materials.get("PortraitCanvas")
    if not (m and os.path.exists(path)):
        return
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])


def render_all(out, views=None, mode="sunset", samples=48, prefix="preview"):
    hide_helpers(True)
    preview_portrait()
    lights.cycles(samples=samples, denoise=True)
    lights.rig(mode, show_image=True)
    for v in views or VIEWS[:4]:
        render(os.path.join(out, f"{prefix}_{v}.png"), v)


def lightmap_preview(out, lm_path, views=("overview",), scale=2.0, prefix="lmcheck"):
    """Swap STATIC_* materials to emission = base colour (UVMap) x lightmap (Lightmap UV) x scale."""
    img = bpy.data.images.load(lm_path, check_existing=True)
    img.colorspace_settings.name = 'sRGB'
    for o in bpy.data.objects:
        if o.type != 'MESH' or not o.name.startswith("STATIC_"):
            continue
        for i, slot in enumerate(o.material_slots):
            src = slot.material
            key = src.name + "__lm"
            m = bpy.data.materials.get(key)
            if not m:
                m = src.copy()
                m.name = key
                nt = m.node_tree
                bsdf = nt.nodes.get("Principled BSDF")
                out_n = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
                tex = nt.nodes.get("BaseTex")
                lm = nt.nodes.new("ShaderNodeTexImage")
                lm.image = img
                uv = nt.nodes.new("ShaderNodeUVMap")
                uv.uv_map = "Lightmap"
                nt.links.new(uv.outputs[0], lm.inputs[0])
                mul = nt.nodes.new("ShaderNodeMix")
                mul.data_type = 'RGBA'
                mul.blend_type = 'MULTIPLY'
                mul.inputs["Factor"].default_value = 1.0
                if tex:
                    nt.links.new(tex.outputs["Color"], mul.inputs[6])
                else:
                    mul.inputs[6].default_value = bsdf.inputs["Base Color"].default_value
                nt.links.new(lm.outputs["Color"], mul.inputs[7])
                em = nt.nodes.new("ShaderNodeEmission")
                em.inputs["Strength"].default_value = scale
                nt.links.new(mul.outputs[2], em.inputs[0])
                nt.links.new(em.outputs[0], out_n.inputs["Surface"])
            slot.material = m
    hide_helpers(True)
    lights.cycles(samples=16, denoise=False)
    lights.clear()
    lights.world("sunset", True, strength=0.0)
    for v in views:
        render(os.path.join(out, f"{prefix}_{v}.png"), v)


def populate(collectibles_glb, seed=1):
    """Preview only: instance the templates at the SLOT_* anchors like the app will."""
    import random
    from mathutils import Matrix
    rnd = random.Random(seed)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=collectibles_glb)
    tpl = {o.name: o for o in set(bpy.data.objects) - before if o.name.startswith("TPL_")}
    for o in tpl.values():
        o.hide_render = True
        o.location = (0, 0, -50)
    cols = [(0.35, 0.55, 0.6), (0.55, 0.35, 0.65), (0.75, 0.42, 0.25), (0.4, 0.5, 0.3), (0.3, 0.4, 0.65), (0.6, 0.25, 0.3)]

    def inst(tname, anchor, offset, col):
        src = tpl[tname]
        ob = src.copy()
        ob.data = src.data.copy()
        bpy.context.scene.collection.objects.link(ob)
        ob.hide_render = False
        for i, slot in enumerate(ob.material_slots):
            if slot.material and slot.material.name.split(".")[0] in ("Plastic", "Cover"):
                m = slot.material.copy()
                m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*col, 1)
                slot.material = m
        a = bpy.data.objects[anchor]
        # glTF import puts an extra Y-up->Z-up rotation on the template; keep the template's own
        ob.matrix_world = a.matrix_world @ Matrix.Translation(offset) @ src.matrix_world.normalized().to_3x3().to_4x4()
        for ch in src.children:          # e.g. Island_flag under TPL_island
            c = ch.copy()
            c.data = ch.data.copy()
            bpy.context.scene.collection.objects.link(c)
            c.hide_render = False
            c.parent = ob
            c.matrix_parent_inverse = ch.matrix_parent_inverse.copy()
        return ob

    bpy.context.view_layer.update()
    for row in ("SLOT_cart_games", "SLOT_cart_ai", "SLOT_cart_tools"):
        c = rnd.choice(cols)
        for i in range(rnd.randint(6, 10)):
            inst("TPL_cartridge", row, (0.07 * i, 0, 0), c if rnd.random() < 0.6 else rnd.choice(cols))
    x = 0
    for i in range(12):
        inst("TPL_book", "SLOT_books", (x, 0, 0), rnd.choice(cols))
        x += 0.035 + 0.005
    x = 0
    for i in range(5):
        inst("TPL_notebook", "SLOT_notebooks", (x, 0, 0), rnd.choice(cols))
        x += 0.025
    for r in range(3):
        for c in range(4):
            if r * 4 + c < 10:
                # three (x right, -y down) -> blender local (x, 0, -z)
                inst("TPL_memcard", "SLOT_cards", (0.13 * c, 0, -0.15 * r), (0.25, 0.22, 0.2))
    for (u, v) in ((0.2, 0.3), (0.45, 0.6), (0.7, 0.4), (0.85, 0.75)):
        inst("TPL_island", "SLOT_map", (-0.6 + 1.2 * u, (v - 0.5) * 0.8, 0), (1, 1, 1))
