"""Render a lineup of every top-level object in a .glb (for checking sky.glb / collectibles.glb).
Blender --background --python blender/preview_glb.py -- public/assets/sky.glb blender/out/preview_sky.png"""
import math
import sys
import bpy
from mathutils import Vector

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
roots = [o for o in bpy.context.scene.objects if o.parent is None]
roots.sort(key=lambda o: o.name)
x = 0.0
maxh = 0.0
for o in roots:
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box] if o.type == 'MESH' else [o.location]
    w = max(v.x for v in bb) - min(v.x for v in bb)
    h = max(v.z for v in bb) - min(v.z for v in bb)
    maxh = max(maxh, h)
    o.location.x += x + w / 2 - (max(v.x for v in bb) + min(v.x for v in bb)) / 2
    x += w * 1.25 + 0.02
cx = x / 2
sc = bpy.context.scene
cam_d = bpy.data.cameras.new("c")
cam_d.type = 'ORTHO'
cam_d.ortho_scale = max(x, maxh * 2.2) * 1.05
cam = bpy.data.objects.new("c", cam_d)
sc.collection.objects.link(cam)
cam.location = (cx, -10, maxh * 0.3 + 3)
cam.rotation_euler = (Vector((cx, 0, maxh * 0.3)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam
sun = bpy.data.objects.new("s", bpy.data.lights.new("s", 'SUN'))
sun.data.energy = 3
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
sc.collection.objects.link(sun)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.7, 0.75, 1)
sc.world = w
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'CYCLES'
sc.render.resolution_x, sc.render.resolution_y = 1280, 480
sc.render.filepath = dst
bpy.ops.render.render(write_still=True)
