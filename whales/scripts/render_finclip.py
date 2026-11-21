"""Blender -b <blend> --python scripts/render_finclip.py -- <out.mp4> : close-up of flipper + fluke over the cruise loop."""
import bpy, sys, math, json
from mathutils import Vector
out = sys.argv[sys.argv.index('--') + 1]
sc = bpy.context.scene; L = json.loads(sc['whale'])['length']
sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = 960; sc.render.resolution_y = 540
w = bpy.data.worlds.new('w'); sc.world = w
w.node_tree.nodes['Background'].inputs[0].default_value = (0.62, 0.72, 0.84, 1)
sun = bpy.data.objects.new('s', bpy.data.lights.new('s', 'SUN')); sc.collection.objects.link(sun); sun.data.energy = 3.2
sun.rotation_euler = (math.radians(35), math.radians(20), math.radians(40))
arm = sc.objects['WhaleRig']; ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
ad.action = bpy.data.actions['cruise']; ad.action_slot = ad.action.slots[0]
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 35
# camera parented to the chest so it rides with the body: we see the flipper motion relative to the whale
b0 = arm.data.bones['fin_L_1'].head_local; b5 = arm.data.bones['fin_L_5'].tail_local
tg = (b0 * 0.45 + b5 * 0.55)
cam.location = tg + Vector((0.35, -1.0, -0.12)).normalized() * 0.24 * L
cam.rotation_euler = (tg - cam.location).to_track_quat('-Z', 'Y').to_euler()
if hasattr(sc.render.image_settings, 'media_type'):
    sc.render.image_settings.media_type = 'VIDEO'; sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'; sc.render.ffmpeg.codec = 'H264'; sc.render.ffmpeg.constant_rate_factor = 'HIGH'
if out.endswith('.mp4'):
    sc.frame_start = 0; sc.frame_end = 239; sc.render.filepath = out
    bpy.ops.render.render(animation=True)
else:
    sc.render.image_settings.media_type = 'IMAGE' if hasattr(sc.render.image_settings, 'media_type') else None
    sc.render.image_settings.file_format = 'PNG'
    for f in (0, 30, 60, 90):
        sc.frame_set(f); sc.render.filepath = f'{out}_{f:03d}.png'; bpy.ops.render.render(write_still=True)
print('DONE')
