import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 900, 600
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.6,0.75,0.9,1); w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun','SUN')); sc.collection.objects.link(sun); sun.data.energy=3; sun.rotation_euler=(0.7,0.2,0.6)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
for i,(az,el) in enumerate([(35,20),(90,5),(200,25),(0,80)]):
    r=3.2; a=math.radians(az); e=math.radians(el)
    cam.location = Vector((r*math.cos(a)*math.cos(e), r*math.sin(a)*math.cos(e), r*math.sin(e)))
    cam.rotation_euler = (-cam.location).to_track_quat('-Z','Y').to_euler()
    sc.render.filepath = f"{out}_{i}.png"; bpy.ops.render.render(write_still=True)
