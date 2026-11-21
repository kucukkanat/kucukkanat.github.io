"""Blender -b --python scripts/test_body.py -- <species> <outprefix>  : body-only anatomy check renders."""
import sys, os, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, bpy
from mathutils import Vector
from whalegen.config import SPECIES
from whalegen.sdfbody import SDFBody
key, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
t0 = time.time()
b = SDFBody(SPECIES[key], key, 'A')
P, Q = b.build()
me = bpy.data.meshes.new('b'); me.from_pydata(P.tolist(), [], Q.tolist()); me.update()
ob = bpy.data.objects.new('body', me); bpy.context.scene.collection.objects.link(ob)
bpy.context.view_layer.objects.active = ob
m = ob.modifiers.new('d', 'DECIMATE'); m.ratio = 34000 / (2 * len(Q)); m.use_symmetry = True; m.symmetry_axis = 'X'
bpy.ops.object.modifier_apply(modifier='d')
me.shade_smooth() if hasattr(me, 'shade_smooth') else None
print('TRIS', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'time %.1f' % (time.time() - t0))
mat = bpy.data.materials.new('m'); mat.use_nodes = True
bs = mat.node_tree.nodes['Principled BSDF']; bs.inputs['Base Color'].default_value = (0.35, 0.45, 0.55, 1); bs.inputs['Roughness'].default_value = 0.5
me.materials.append(mat)
sc = bpy.context.scene; sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 900; sc.render.resolution_y = 600
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.78, 0.82, 1)
sun = bpy.data.objects.new('s', bpy.data.lights.new('s', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 3.5
sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
L = b.L
views = {'side': ((1, 0, 0), 'ORTHO', L * 1.15, Vector((0, 0.1 * L, 0))),
         'top': ((0, 0, 1), 'ORTHO', L * 1.15, Vector((0, 0.1 * L, 0))),
         'front': ((0, -1, 0), 'ORTHO', L * 0.45, Vector((0, 0, 0))),
         'face': ((0.85, -0.55, 0.15), 'PERSP', 0, Vector((0, b.y(0.12), 0))),
         'fin': ((0.7, -0.35, -0.6), 'PERSP', 0, Vector((b.W(b.an['fin']['t']), b.y(b.an['fin']['t'] + 0.03), -0.04 * b.L))),
         'tail': ((0.75, 0.5, 0.45), 'PERSP', 0, Vector((0, b.y(0.97), 0))),
         'jaw': ((0.8, -0.5, -0.45), 'PERSP', 0, Vector((0, b.y(0.14), -0.03 * b.L))),
         'finfront': ((0.25, -1, -0.25), 'PERSP', 0, Vector((0, b.y(b.an['fin']['t']), -0.02 * b.L)))}
for name, (d, typ, scale, tgt) in views.items():
    d = Vector(d).normalized()
    cam.data.type = typ
    if typ == 'ORTHO':
        cam.data.ortho_scale = scale; cam.location = tgt + d * L * 2
    else:
        cam.data.lens = 50; cam.location = tgt + d * L * (0.62 if name == 'finfront' else 0.42)
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y' if abs(d.z) < 0.9 else 'Y').to_euler()
    if name == 'top':
        cam.rotation_euler = (0, 0, math.pi / 2)
    sc.render.filepath = f'{out}_{name}.png'; bpy.ops.render.render(write_still=True)
print('DONE')
