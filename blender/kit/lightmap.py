"""Second UV map 'Lightmap' (glTF TEXCOORD_1) shared by all STATIC_* meshes in one atlas."""
import math
import bpy


def statics():
    return sorted([o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("STATIC_")],
                  key=lambda o: o.name)


def make_uvs(objs, margin=0.004):
    for o in objs:
        me = o.data
        if "Lightmap" not in me.uv_layers:
            me.uv_layers.new(name="Lightmap")
        me.uv_layers.active = me.uv_layers["Lightmap"]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=margin,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        uvs = o.data.uv_layers
        uvs.active = uvs["UVMap"]
        uvs["UVMap"].active_render = True
