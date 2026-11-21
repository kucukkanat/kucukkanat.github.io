"""Blender -b <blend> --python scripts/render_finposes.py -- <outprefix> : flipper/fluke motion strips."""
import bpy, sys, math, json
from mathutils import Vector
out = sys.argv[sys.argv.index('--') + 1]
sc = bpy.context.scene; L = json.loads(sc['whale'])['length']
sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 640; sc.render.resolution_y = 420
w = bpy.data.worlds.new('w'); sc.world = w
bg = w.node_tree.nodes.get('Background') if w.node_tree else None
if bg: bg.inputs[0].default_value = (0.72, 0.78, 0.86, 1)
sun = bpy.data.objects.new('s', bpy.data.lights.new('s', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 3.5
sun.rotation_euler = (math.radians(35), math.radians(20), math.radians(40))
for o in sc.objects:
    if o.name in ('Whale_Island', 'Whale_Water', 'Whale_Falls'): o.hide_render = True
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 40
arm = sc.objects['WhaleRig']; ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
def shot(tgt, d, dist, name):
    tg = Vector(tgt); cam.location = tg + Vector(d).normalized() * dist
    cam.rotation_euler = (tg - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}_{name}.png'; bpy.ops.render.render(write_still=True)
fin = arm.data.bones['fin_L_3'].head_local; flk = arm.data.bones['fluke'].head_local
def use(act):
    ad.action = bpy.data.actions[act]; ad.action_slot = ad.action.slots[0]
use('cruise')
for f in (0, 30, 60, 90):
    sc.frame_set(f); shot(fin + Vector((0.1 * L, 0.02 * L, 0)), (0.2, -1, -0.15), 0.42 * L, f'fin_cruise{f:03d}')
for f in (0, 30, 60, 90):
    sc.frame_set(f); shot(flk + Vector((0, 0.03 * L, 0)), (1, 0.15, 0.25), 0.40 * L, f'fluke_cruise{f:03d}')
b0 = arm.data.bones['fin_L_1'].head_local; b5 = arm.data.bones['fin_L_5'].tail_local
ft = b0 * 0.5 + b5 * 0.5
for act in ('rest', 'body_accel', 'body_bankL', 'body_bankR'):
    use(act); sc.frame_set(0); shot(ft, (0.35, -1.0, -0.12), 0.16 * L, f'finF_{act}')
use('cruise')
for f in (0, 60):
    sc.frame_set(f); shot(ft, (0.35, -1.0, -0.12), 0.16 * L, f'finF_cruise{f:03d}')
print('DONE')
