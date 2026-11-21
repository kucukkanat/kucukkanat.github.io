"""Render previews of a built whale .blend.

Usage:
  Blender -b blend/<tag>.blend --python scripts/render_whale.py -- <out_prefix> [stills|video|both] [res_x]
Style B files get toon shading (Shader-to-RGB ramp) and an inverted-hull outline for the render only.
"""
import sys, os, math, json
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out = os.path.abspath(argv[0]); mode = argv[1] if len(argv) > 1 else 'stills'
resx = int(argv[2]) if len(argv) > 2 else 1280
sc = bpy.context.scene
info = json.loads(sc['whale'])
L = info['length']; toon = info['toon']

sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = resx; sc.render.resolution_y = int(resx * 9 / 16)
sc.render.film_transparent = False
try:
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass

# ------------------------------------------------------------------ sky world
w = bpy.data.worlds.new('Sky'); sc.world = w
w.use_nodes = True
nt = w.node_tree; nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB'); bg = nt.nodes.new('ShaderNodeBackground'); o = nt.nodes.new('ShaderNodeOutputWorld')
amb = nt.nodes.new('ShaderNodeBackground'); amb.inputs[0].default_value = (0.42, 0.55, 0.75, 1); amb.inputs[1].default_value = 0.55
lp = nt.nodes.new('ShaderNodeLightPath'); mixs = nt.nodes.new('ShaderNodeMixShader')
nt.links.new(tc.outputs['Window'], sep.inputs[0])
nt.links.new(sep.outputs['Y'], ramp.inputs[0])
ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (0.93, 0.80, 0.70, 1)
ramp.color_ramp.elements[1].position = 0.85; ramp.color_ramp.elements[1].color = (0.30, 0.52, 0.85, 1)
nt.links.new(ramp.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = 1.0
nt.links.new(lp.outputs['Is Camera Ray'], mixs.inputs[0])
nt.links.new(amb.outputs[0], mixs.inputs[1]); nt.links.new(bg.outputs[0], mixs.inputs[2])
nt.links.new(mixs.outputs[0], o.inputs[0])

sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sc.collection.objects.link(sun); sun.data.energy = 3.2; sun.data.angle = math.radians(8)
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
sun.data.color = (1.0, 0.95, 0.88)
fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'SUN'))
sc.collection.objects.link(fill); fill.data.energy = 1.0
fill.rotation_euler = (math.radians(120), 0, math.radians(-140)); fill.data.color = (0.7, 0.8, 1.0)

# ------------------------------------------------------------------ toon conversion for style B
if toon:
    for mat in bpy.data.materials:
        if not mat.node_tree or mat.get('role') in ('water', 'waterfall'):
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        outn = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if not bsdf:
            continue
        diff = nt.nodes.new('ShaderNodeBsdfDiffuse')
        src = bsdf.inputs['Base Color'].links[0].from_socket if bsdf.inputs['Base Color'].links else None
        s2r = nt.nodes.new('ShaderNodeShaderToRGB')
        rmp = nt.nodes.new('ShaderNodeValToRGB')
        rmp.color_ramp.interpolation = 'CONSTANT'
        els = rmp.color_ramp.elements
        els[0].position = 0.0; els[0].color = (0.55, 0.55, 0.62, 1)
        els[1].position = 0.12; els[1].color = (0.85, 0.85, 0.88, 1)
        e3 = els.new(0.45); e3.color = (1.05, 1.05, 1.05, 1)
        mixn = nt.nodes.new('ShaderNodeMix'); mixn.data_type = 'RGBA'; mixn.blend_type = 'MULTIPLY'
        mixn.inputs['Factor'].default_value = 1.0
        emis = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(diff.outputs[0], s2r.inputs[0])
        nt.links.new(s2r.outputs['Color'], rmp.inputs['Fac'])
        if src:
            nt.links.new(src, mixn.inputs[6])
        else:
            mixn.inputs[6].default_value = bsdf.inputs['Base Color'].default_value
        nt.links.new(rmp.outputs['Color'], mixn.inputs[7])
        nt.links.new(mixn.outputs[2], emis.inputs['Color'])
        nt.links.new(emis.outputs[0], outn.inputs['Surface'])
    ol = bpy.data.materials.new('Outline')
    ol.use_nodes = True
    ol.use_backface_culling = True
    ont = ol.node_tree
    em = ont.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (0.02, 0.015, 0.025, 1)
    geo = ont.nodes.new('ShaderNodeNewGeometry'); trn = ont.nodes.new('ShaderNodeBsdfTransparent')
    mx = ont.nodes.new('ShaderNodeMixShader')
    ont.links.new(geo.outputs['Backfacing'], mx.inputs[0])
    ont.links.new(em.outputs[0], mx.inputs[1]); ont.links.new(trn.outputs[0], mx.inputs[2])
    ont.links.new(mx.outputs[0], next(n for n in ont.nodes if n.type == 'OUTPUT_MATERIAL').inputs['Surface'])
    import bmesh
    for ob in list(sc.objects):
        if ob.type == 'MESH' and ob.name in ('Whale_Body', 'Whale_Island'):
            me = ob.data.copy()
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
            bm.to_mesh(me); bm.free()
            me.materials.clear(); me.materials.append(ol)
            hull = bpy.data.objects.new(ob.name + '_Outline', me)
            sc.collection.objects.link(hull)
            hull.parent = ob.parent
            for vg in ob.vertex_groups:
                hull.vertex_groups.new(name=vg.name)
            am = hull.modifiers.new('Armature', 'ARMATURE'); am.object = ob.parent
            dm = hull.modifiers.new('Push', 'DISPLACE'); dm.mid_level = 0.0
            dm.strength = -0.011 * L / 14 * (1.0 if ob.name == 'Whale_Body' else 0.55)

# ------------------------------------------------------------------ animation: play cruise
arm = sc.objects['WhaleRig']
ad = arm.animation_data
for tr in ad.nla_tracks:
    tr.mute = True
ad.action = bpy.data.actions['cruise']
try:
    ad.action_slot = ad.action.slots[0]
except Exception:
    pass

cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
target = Vector((0, 0.1 * L, 0.05 * L))


def place_cam(az, el, dist):
    a = math.radians(az); e = math.radians(el)
    cam.location = target + Vector((dist * math.cos(a) * math.cos(e), dist * math.sin(a) * math.cos(e), dist * math.sin(e)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()


D = 1.75 * L
if mode == 'quick':
    sc.frame_set(30)
    for i, (az, el, dd) in [(0, (30, 24, 1.0)), (4, (0, 90, 1.05))]:
        place_cam(az, el, D * dd)
        sc.render.filepath = f'{out}_still{i}.png'
        bpy.ops.render.render(write_still=True)

if mode == 'label':
    # square cartridge label: three-quarter hero shot, whale + island filling the frame
    sc.render.resolution_x = sc.render.resolution_y = resx
    sc.frame_set(30)
    tg = Vector((0, 0.02 * L, 0.06 * L))
    cam.data.lens = 50
    cam.location = tg + Vector((0.95, -0.55, 0.42)).normalized() * 1.05 * L
    cam.rotation_euler = (tg - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = f'{out}.png'
    bpy.ops.render.render(write_still=True)

if mode in ('closeups', 'review'):
    sc.frame_set(30)
    ys = info.get('anat', {})
    shots = [('face', (0, -0.36 * L, -0.005 * L), (0.9, -0.55, 0.18), 0.30),
             ('jaw', (0, -0.30 * L, -0.03 * L), (0.6, -0.45, -0.65), 0.30),
             ('edge', (0.05 * L, 0.03 * L, 0.06 * L), (0.95, 0.15, 0.35), 0.30),
             ('fin', (0.09 * L, -0.11 * L, -0.07 * L), (0.35, -0.55, -0.75), 0.34),
             ('eye', (0.07 * L, -0.19 * L, -0.01 * L), (1.0, -0.25, 0.1), 0.16),
             ('fluke', (0, 0.6 * L, 0.0), (0.7, 0.45, 0.55), 0.30),
             ('top', (0, 0.05 * L, 0.0), (0.02, 0.0, 1.0), 0.75)]
    for name, tgt, d, dist in shots:
        tg = Vector(tgt); dd = Vector(d).normalized()
        cam.location = tg + dd * L * dist
        cam.rotation_euler = (tg - cam.location).to_track_quat('-Z', 'Y').to_euler()
        if name == 'top':
            cam.rotation_euler = (0, 0, math.pi / 2)
        sc.render.filepath = f'{out}_{name}.png'
        bpy.ops.render.render(write_still=True)

if mode in ('stills', 'both'):
    sc.frame_set(30)
    for i, (az, el, dd) in enumerate([(30, 22, 1.0), (90, 8, 1.0), (200, 30, 1.0), (300, 55, 0.85), (0, 90, 1.05), (150, 10, 0.75)]):
        place_cam(az, el, D * dd)
        sc.render.filepath = f'{out}_still{i}.png'
        bpy.ops.render.render(write_still=True)

if mode in ('video', 'both'):
    if hasattr(sc.render.image_settings, 'media_type'):
        sc.render.image_settings.media_type = 'VIDEO'
    sc.render.image_settings.file_format = 'FFMPEG'
    sc.render.ffmpeg.format = 'MPEG4'; sc.render.ffmpeg.codec = 'H264'
    sc.render.ffmpeg.constant_rate_factor = 'HIGH'
    sc.frame_start = 0; sc.frame_end = 239
    # orbiting camera keyed
    for f in range(0, 241, 10):
        place_cam(20 + 90 * f / 240, 18 + 8 * math.sin(f / 240 * math.pi * 2), D * 0.95)
        cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_euler', frame=f)
    sc.render.filepath = f'{out}.mp4'
    bpy.ops.render.render(animation=True)
print('RENDERED', out)
