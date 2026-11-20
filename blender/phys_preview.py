"""Physics-round previews.

Sky islands lineup (imports a sky.glb, all four islands side by side, sunset-ish backdrop):
    Blender --background --python blender/phys_preview.py -- sky public/assets/sky.glb blender/out/phys_sky_islands.png
Cabin close-ups from blender/out/cabin.blend (collectibles populated; `bones` overlays red joint markers
on every ROPE_* chain):
    Blender --background blender/out/cabin.blend --python blender/phys_preview.py -- cabin <collectibles.glb> \
        leftwall,ropes,mapisland,overview [bones]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT = os.path.join(HERE, "out")

# three-coord cameras (pos, target, vertical fov deg)
CAMS = {
    "leftwall": ((-1.75, 1.6, 0.45), (-2.92, 1.36, -0.45), 50),
    "leftwall_far": ((-1.15, 1.62, 0.25), (-2.9, 1.3, -0.75), 55),
    "ropes": ((0.35, 1.05, 2.5), (0.1, 2.15, -0.6), 80),
    "map_island": ((0.07, 0.99, -0.12), (-0.06, 0.875, -0.28), 40),
    "knot": ((-0.55, 1.35, 1.95), (-0.86, 1.2, 1.55), 35),
    "pulley": ((1.0, 2.2, -0.6), (1.6, 2.35, -1.25), 50),
    "mapislands": ((0.0, 1.35, 0.45), (0.0, 0.85, -0.2), 50),
}


def sky(src, dst):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    isl = sorted([o for o in bpy.context.scene.objects if o.name.startswith("SKY_island")], key=lambda o: o.name)
    for o in bpy.context.scene.objects:
        if o.name == "SKY_airship":
            o.location = (-1.0, 3.0, 0.9)
            o.scale = (0.5, 0.5, 0.5)
    x = 0.0
    for o in isl:
        bb = [Vector(c) for c in o.bound_box]
        w = max(v.x for v in bb) - min(v.x for v in bb)
        o.location = (x + w / 2, 0, 0)
        o.rotation_euler = (0, 0, math.radians(-20))
        x += w + 0.45
        for p in o.data.polygons:
            p.use_smooth = False
    cx = x / 2 - 0.2
    sc = bpy.context.scene
    cd = bpy.data.cameras.new("c")
    cd.lens = 50
    cam = bpy.data.objects.new("c", cd)
    sc.collection.objects.link(cam)
    cam.location = (cx, -14.5, 2.6)
    cam.rotation_euler = (Vector((cx, 0, -0.55)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sun = bpy.data.objects.new("s", bpy.data.lights.new("s", 'SUN'))
    sun.data.energy = 3.2
    sun.data.color = (1.0, 0.93, 0.85)
    sun.rotation_euler = (math.radians(45), math.radians(10), math.radians(35))
    sc.collection.objects.link(sun)
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    grad = nt.nodes.new("ShaderNodeTexGradient")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, math.radians(-90), 0)
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.98, 0.72, 0.55, 1)
    ramp.color_ramp.elements[1].color = (0.45, 0.55, 0.78, 1)
    nt.links.new(tc.outputs["Window"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], grad.inputs["Vector"])
    nt.links.new(grad.outputs["Fac"], ramp.inputs["Fac"])
    bg.inputs["Color"].default_value = (0.85, 0.62, 0.52, 1)
    bg.inputs["Strength"].default_value = 0.9
    sc.world = w
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    try:
        sc.cycles.device = 'GPU'
    except Exception:
        pass
    sc.view_settings.view_transform = 'AgX'
    sc.render.resolution_x, sc.render.resolution_y = 1600, 720
    sc.render.filepath = dst
    bpy.ops.render.render(write_still=True)


def cabin(collectibles, views, bones):
    from kit import preview, util
    preview.populate(collectibles)
    for k, (a, b, fov) in CAMS.items():
        preview.FIX_CAMS[k] = (a, b)
    markers = []
    if bones:
        m = bpy.data.materials.new("BoneMark")
        m.use_nodes = True
        bs = m.node_tree.nodes["Principled BSDF"]
        bs.inputs["Base Color"].default_value = (1, 0.05, 0.03, 1)
        bs.inputs["Emission Color"].default_value = (1, 0.05, 0.03, 1)
        bs.inputs["Emission Strength"].default_value = 3.0
        for arm in [o for o in bpy.data.objects if o.type == 'ARMATURE']:
            for b in arm.data.bones:
                h = arm.matrix_world @ b.head_local
                bpy.ops.mesh.primitive_uv_sphere_add(radius=0.016, location=h, segments=12, ring_count=6)
                s = bpy.context.active_object
                s.data.materials.append(m)
                markers.append(s)
    for v in views:
        fov = CAMS[v][2] if v in CAMS else 50
        cam = preview.camera_for(v)
        cam.data.angle_y = math.radians(fov)
        preview.hide_helpers(True)
    from kit import lights
    preview.preview_portrait()
    lights.cycles(samples=48, denoise=True)
    lights.rig("sunset", show_image=True)
    for v in views:
        fov = CAMS[v][2] if v in CAMS else 50
        cam = preview.camera_for(v)
        cam.data.angle_y = math.radians(fov)
        sc = bpy.context.scene
        sc.render.resolution_x, sc.render.resolution_y = 1280, 720
        sc.render.image_settings.file_format = 'PNG'
        sc.render.filepath = os.path.join(OUT, f"phys_{v}.png")
        bpy.ops.render.render(write_still=True)


a = sys.argv[sys.argv.index("--") + 1:]
if a[0] == "sky":
    sky(a[1], a[2])
else:
    cabin(a[1], a[2].split(","), len(a) > 3 and a[3] == "bones")
