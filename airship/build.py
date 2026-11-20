"""Build the sky galleon. Run inside Blender:  python3 bl.py build.py "side,quarter;export"
or headless:  SHIP_ARGS=";export" Blender --background --python build.py
SHIP_ARGS = "<views to render, comma separated>;export"."""
import bpy, sys, os, importlib, math, json, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:] = [HERE] + [p for p in sys.path if p != HERE]
for name in ('kit', 'hull', 'rig', 'mech'):      # a live Blender may hold copies loaded from another folder
    sys.modules.pop(name, None)
import kit, hull, rig, mech
mods = [kit, hull, rig, mech]
t0 = time.time()


def reset():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for b in list(coll):
            if not b.users: coll.remove(b)
    kit.WORLD.clear(); kit.STATS.clear()


def build():
    reset()
    kit.make_materials()
    root = kit.joint('Ship', note='Sky galleon. +X bow, +Y port, +Z up in Blender; metres.')
    hull.build_hull(root); hull.build_decks(root); hull.build_castle(root)
    hull.build_topsides(root); hull.build_fittings(root)
    for m in mods[2:]: m.build(root)
    return root


def setup_view():
    sc = bpy.context.scene
    try: sc.render.engine = 'BLENDER_EEVEE'
    except Exception: sc.render.engine = 'BLENDER_EEVEE_NEXT'
    w = sc.world or bpy.data.worlds.new('World'); sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    if bg: bg.inputs[0].default_value = (0.75, 0.55, 0.45, 1); bg.inputs[1].default_value = 0.9
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.5; sun.data.color = (1, .85, .7); sun.rotation_euler = (math.radians(55), 0, math.radians(120))
    sc.collection.objects.link(sun)
    sc.render.resolution_x, sc.render.resolution_y = 1400, 900
    sc.view_settings.view_transform = 'Standard'


VIEWS = {'side': ((3, 70, 12), (3, 0, 10.5), 40), 'quarter': ((-40, 36, 20), (1, 0, 10), 40), 'bow': ((42, 30, 14), (2, 0, 10), 40),
         'stern': ((-26, 6, 8), (-10, 0, 6), 28), 'below': ((-22, 30, -16), (0, 0, 6), 40), 'deck': ((-2, 10, 17), (0, 0, 5), 40),
         'top': ((0, 0.1, 75), (1, 0, 0), 40), 'sternq': ((-24, -14, 10), (-8, 0, 6), 30), 'waist': ((5, 2.5, 8.5), (-6, 0, 5.5), 50),
         'bowclose': ((22, 9, 9), (13, 0, 6.5), 40), 'under': ((6, 16, -7), (-1, 0, 0), 40), 'aft_deck': ((-4, 3, 12), (-10, 0, 8), 50)}


def shots(names, prefix='shot'):
    from mathutils import Vector
    sc = bpy.context.scene
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.clip_end = 500
    for n in names:
        pos, tgt, lens = VIEWS[n]
        cam.location = pos; cam.data.lens = lens
        cam.rotation_euler = (Vector(tgt) - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(HERE, 'out', f'{prefix}_{n}.png')
        bpy.ops.render.render(write_still=True)


def export():
    path = os.path.join(HERE, 'out', 'sky_galleon.glb')
    for o in bpy.data.objects: o.select_set(o.name in kit.WORLD)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                              export_extras=True, export_cameras=False, export_lights=False, export_morph=True,
                              export_morph_normal=False, export_animations=False, export_image_format='WEBP', export_image_quality=85)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'out', 'sky_galleon.blend'))
    return os.path.getsize(path)


if __name__ == '__main__':
    args = os.environ.get('SHIP_ARGS', 'side,quarter').split(';')
    build(); setup_view()
    views = [v for v in args[0].split(',') if v]
    if views: shots(views)
    out = {'tris': sum(kit.STATS.values()), 'objects': len(kit.WORLD), 'secs': round(time.time() - t0, 1)}
    if 'export' in args: out['glb_bytes'] = export()
    print(json.dumps(out))
