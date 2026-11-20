"""Lighting rigs shared by the bake and the preview renders."""
import math
import os
import bpy
from mathutils import Vector
from . import util, layout as L

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SKY_IMG = {"sunset": [os.path.join(ROOT, "art", "sky", "sunset.jpg"), os.path.join(ROOT, "public", "assets", "sky_sunset.jpg")],
           "night": [os.path.join(ROOT, "art", "sky", "night.jpg"), os.path.join(ROOT, "public", "assets", "sky_night.jpg")]}


def clear():
    for o in list(bpy.data.objects):
        if o.get("rig"):
            bpy.data.objects.remove(o, do_unlink=True)


def _light(name, kind, energy, color, loc=None, rot_dir=None, size=0.1, angle=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    if kind == 'AREA':
        ld.size = size
    if kind == 'SUN' and angle is not None:
        ld.angle = math.radians(angle)
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    ob["rig"] = 1
    if loc is not None:
        ob.location = loc
    if rot_dir is not None:
        d = Vector(rot_dir).normalized()
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def world(mode, show_image=True, strength=1.0):
    w = bpy.data.worlds.get("Sky") or bpy.data.worlds.new("Sky")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs[0])
    cr = ramp.color_ramp
    if mode == "sunset":
        cr.elements[0].position = 0.45
        cr.elements[0].color = (1.0, 0.55, 0.38, 1)
        cr.elements[1].position = 0.75
        cr.elements[1].color = (0.55, 0.45, 0.75, 1)
        st = 1.6 * strength
    else:
        cr.elements[0].position = 0.45
        cr.elements[0].color = (0.05, 0.07, 0.16, 1)
        cr.elements[1].position = 0.8
        cr.elements[1].color = (0.02, 0.03, 0.08, 1)
        st = 0.25 * strength
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = st
    final = bg.outputs[0]
    img_path = next((p for p in SKY_IMG[mode] if os.path.exists(p)), None)
    if show_image and img_path:
        # camera rays see the painted sky, lighting uses the smooth gradient
        img = bpy.data.images.load(img_path, check_existing=True)
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = img
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value = (0, 0, math.radians(90))
        nt.links.new(tc.outputs["Generated"], mp.inputs[0])
        nt.links.new(mp.outputs[0], env.inputs[0])
        bg2 = nt.nodes.new("ShaderNodeBackground")
        nt.links.new(env.outputs[0], bg2.inputs[0])
        bg2.inputs["Strength"].default_value = 1.0 if mode == "sunset" else 0.8
        lp = nt.nodes.new("ShaderNodeLightPath")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
        nt.links.new(bg.outputs[0], mix.inputs[1])
        nt.links.new(bg2.outputs[0], mix.inputs[2])
        final = mix.outputs[0]
    nt.links.new(final, out.inputs[0])


def lantern_pos():
    o = bpy.data.objects.get("Lantern_light")
    bpy.context.view_layer.update()
    return o.matrix_world.translation.copy() if o else util.T(L.LANTERN_POS[0], L.LANTERN_POS[1] + 0.13, L.LANTERN_POS[2])


def rig(mode, show_image=True):
    clear()
    world(mode, show_image)
    if mode == "sunset":
        # low warm sun from beyond the stern windows (three: from -Z, a bit right, ~14deg up)
        d3 = Vector((-0.3, -0.42, 1.0))            # direction the light travels (three)
        _light("Sun", 'SUN', 5.5, (1.0, 0.58, 0.3), rot_dir=util.T(*d3), angle=2)
        # sky bounce through the windows: big soft area lights just outside the glass
        for a in (-18, 0, 18):
            p = L.arc_pt(a, L.R + 1.0, 1.8)
            ob = _light(f"SkyFill{a}", 'AREA', 170, (1.0, 0.66, 0.7), loc=util.T(*p),
                        rot_dir=util.T(-p[0], -0.2, -(p[2] - L.ARC_CZ)), size=2.2)
        # soft warm room fill (bounce stand-in) so the back of the cabin is not black
        # painted look: warm light, cool violet shadow side (the fill is weak and cool so the sun patches read)
        _light("RoomFill", 'AREA', 55, (0.72, 0.6, 0.86), loc=util.T(0, 2.85, 0.8), rot_dir=(0, 0, -1), size=3.5)
    else:
        lp = lantern_pos()
        _light("LanternLight", 'POINT', 110, (1.0, 0.55, 0.22), loc=lp, size=0.04)
        d3 = Vector((0.3, -0.5, 1.0))
        _light("Moon", 'SUN', 0.7, (0.55, 0.65, 1.0), rot_dir=util.T(*d3), angle=1)
        for a in (-18, 0, 18):
            p = L.arc_pt(a, L.R + 1.0, 1.8)
            _light(f"MoonFill{a}", 'AREA', 60, (0.45, 0.55, 1.0), loc=util.T(*p),
                   rot_dir=util.T(-p[0], -0.2, -(p[2] - L.ARC_CZ)), size=2.2)


def cycles(samples=64, denoise=True):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        cy.device = 'GPU'
    except Exception as e:
        print("GPU setup failed:", e)
        cy.device = 'CPU'
    cy.samples = samples
    cy.use_denoising = denoise
    cy.max_bounces = 6
    cy.diffuse_bounces = 4
    cy.glossy_bounces = 2
    cy.transparent_max_bounces = 8
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
