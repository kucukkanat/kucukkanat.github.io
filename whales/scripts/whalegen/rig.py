"""Blender object/material/armature creation."""
import math
from collections import defaultdict
import numpy as np
import bpy


def new_image(name, arr, path):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def _principled(mat):
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    return nt, bsdf


def make_material(name, kind, style, image=None, rough=0.8, double=False, blend=False, normal=None):
    mat = bpy.data.materials.new(name)
    nt, bsdf = _principled(mat)
    if kind == 'vcol':
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    elif image is not None:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = image
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        if blend:
            nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    if normal is not None:
        normal.colorspace_settings.name = 'Non-Color'
        nt_ = nt.nodes.new('ShaderNodeTexImage'); nt_.image = normal
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.0
        nt.links.new(nt_.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = rough
    try:
        bsdf.inputs['Specular IOR Level'].default_value = 0.2 if kind != 'water' else 0.6
    except KeyError:
        pass
    mat.use_backface_culling = not double
    if blend:
        try:
            mat.surface_render_method = 'BLENDED'
        except Exception:
            mat.blend_method = 'BLEND'
    mat['toon'] = 1 if style == 'B' else 0
    mat['role'] = kind
    return mat


def mesh_from_mb(name, mb, mat, arm, with_uv=False, with_col=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata(mb.v, [], mb.f)
    me.update()
    try:
        me.polygons.foreach_set('use_smooth', mb.smooth)
    except Exception:
        attr = me.attributes.new('sharp_face', 'BOOLEAN', 'FACE')
        attr.data.foreach_set('value', [not s for s in mb.smooth])
    if with_uv:
        uvl = me.uv_layers.new(name='UVMap')
        flat = []
        for fuv in mb.uv:
            for (u, v) in fuv:
                flat += (u, v)
        uvl.data.foreach_set('uv', flat)
    if with_col:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        flat = []
        for c in mb.col:
            flat += (float(c[0]), float(c[1]), float(c[2]), 1.0)
        ca.data.foreach_set('color', flat)
    me.materials.append(mat)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # vertex groups
    groups = defaultdict(lambda: defaultdict(list))
    for i, w in enumerate(mb.w):
        tot = sum(w.values())
        for g, val in w.items():
            groups[g][round(val / tot, 3)].append(i)
    for g, byw in groups.items():
        vg = ob.vertex_groups.new(name=g)
        for val, idx in byw.items():
            if val > 0:
                vg.add(idx, val, 'REPLACE')
    ob.parent = arm
    mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    return ob


def make_armature(bones):
    ad = bpy.data.armatures.new('WhaleRig')
    arm = bpy.data.objects.new('WhaleRig', ad)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, head, tail, parent in bones:
        b = ad.edit_bones.new(name)
        b.head = head; b.tail = tail; b.roll = 0.0
        eb[name] = b
    for name, head, tail, parent in bones:
        if parent:
            eb[name].parent = eb[parent]
            eb[name].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return arm
