"""Export web copies of a built whale (no Draco; the site meshopt-compresses them afterwards).

  Blender -b whales/out/blend/<sp>_<A|B>.blend --python whales/scripts/export_web.py -- <out.glb> [full|lite]

lite: decimated body (~5k tris) and island (~7k tris), 512 px colour texture, no normal map, no particles hint.
Same skeleton, clips, names and metadata, so the runtime controller treats both alike.
"""
import sys, json
import bpy

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]; mode = argv[1] if len(argv) > 1 else 'full'
sc = bpy.context.scene


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate_to(ob, target):
    n = tris(ob)
    if n <= target:
        return
    bpy.context.view_layer.objects.active = ob
    for o in sc.objects: o.select_set(o == ob)
    m = ob.modifiers.new('lod', 'DECIMATE'); m.ratio = target / n; m.use_symmetry = ob.name == 'Whale_Body'
    m.symmetry_axis = 'X'
    # the decimate must run before the armature modifier
    while ob.modifiers[0].name != 'lod':
        bpy.ops.object.modifier_move_up(modifier='lod')
    bpy.ops.object.modifier_apply(modifier='lod')


if mode == 'lite':
    for name, target in (('Whale_Body', 4500), ('Whale_Island', 5000)):
        if name in sc.objects:
            decimate_to(sc.objects[name], target)
    for img in bpy.data.images:
        if img.name.endswith('_normal'):
            continue
        if img.size[0] > 512:
            img.scale(512, max(1, int(img.size[1] * 512 / img.size[0])))
    mat = bpy.data.materials.get('M_body')
    if mat:  # drop the normal map
        nt = mat.node_tree
        for n in list(nt.nodes):
            if n.type in ('NORMAL_MAP',) or (n.type == 'TEX_IMAGE' and n.image and n.image.name.endswith('_normal')):
                nt.nodes.remove(n)
    info = json.loads(sc['whale']); info['lod'] = 'lite'
    info['particles'] = dict(info.get('particles', {}), count=int(info.get('particles', {}).get('count', 60) * 0.4))
    info['stats']['triangles'] = int(sum(tris(o) for o in sc.objects if o.type == 'MESH'))
    sc['whale'] = json.dumps(info)
else:
    info = json.loads(sc['whale']); info['lod'] = 'full'; sc['whale'] = json.dumps(info)

arm = sc.objects['WhaleRig']
if arm.animation_data:
    arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', export_image_format='WEBP', export_image_quality=80,
    export_draco_mesh_compression_enable=False, export_extras=True, export_animations=True,
    export_animation_mode='ACTIONS', export_force_sampling=True, export_optimize_animation_size=True,
    export_skins=True, export_def_bones=False, export_rest_position_armature=True, export_yup=True)
print('EXPORTED', out, mode, int(sum(tris(o) for o in sc.objects if o.type == 'MESH')))
