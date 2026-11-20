"""Bake sunset + night lightmaps (diffuse direct+indirect, no albedo) for all STATIC_* into one atlas.

Encoding (see docs/SCENE_CONTRACT.md): stored sRGB value = srgb(clamp(L / LM_SCALES[mode], 0, 1)), where L is
the linear light factor (final colour = albedo x L). In three.js: texture.colorSpace = SRGBColorSpace,
material.lightMap = tex, lightMapIntensity = LM_SCALE * PI (Standard/Basic materials divide by PI).
"""
import os
import time
import numpy as np
import bpy
from . import lights

LM_SCALE = 3.0
LM_SCALES = {"sunset": 3.0, "night": 1.0}   # stored = srgb(L / scale); written to lightmaps.json
RES = 2048


def _prep_materials(objs, img):
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            nt = m.node_tree
            n = nt.nodes.get("LM_BAKE")
            if not n:
                n = nt.nodes.new("ShaderNodeTexImage")
                n.name = "LM_BAKE"
            n.image = img
            for x in nt.nodes:
                x.select = False
            n.select = True
            nt.nodes.active = n


def _cleanup_materials():
    for m in bpy.data.materials:
        if m.node_tree and m.node_tree.nodes.get("LM_BAKE"):
            m.node_tree.nodes.remove(m.node_tree.nodes["LM_BAKE"])


def _set_glow(strength):
    m = bpy.data.materials.get("LanternGlow")
    if m:
        m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = strength


def _denoise(px, cover, sigma=1.6):
    """Coverage-normalised gaussian blur (stays inside UV islands)."""
    from math import exp
    r = int(3 * sigma)
    k = np.array([exp(-(i * i) / (2 * sigma * sigma)) for i in range(-r, r + 1)], dtype=np.float32)
    k /= k.sum()

    def blur(a):
        out = np.zeros_like(a)
        for i, w in enumerate(k):
            out += w * np.roll(a, i - r, axis=0)
        a2 = out
        out = np.zeros_like(a2)
        for i, w in enumerate(k):
            out += w * np.roll(a2, i - r, axis=1)
        return out

    m = cover[..., None].astype(np.float32)
    num = blur(px * m)
    den = blur(m)
    res = np.where(den > 1e-3, num / np.maximum(den, 1e-3), px)
    return np.where(m > 0, res, px)


def _save_webp(lin, path, scale, quality=82, max_kb=600):
    enc = np.clip(lin / scale, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    out = bpy.data.images.new("LM_out", RES, RES, alpha=False, float_buffer=False)
    rgba = np.ones((RES, RES, 4), dtype=np.float32)
    rgba[..., :3] = enc
    out.pixels.foreach_set(rgba.ravel())
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = 'WEBP'
    st.color_mode = 'RGB'
    q = quality
    while True:
        st.quality = q
        out.save_render(path, scene=sc)
        kb = os.path.getsize(path) / 1024
        if kb <= max_kb or q <= 40:
            break
        q -= 8
    bpy.data.images.remove(out)
    print(f"[bake] wrote {path} {kb:.0f} KB (q={q})")


def bake_one(objs, mode, samples, out_path, raw_dir):
    t0 = time.time()
    lights.cycles(samples=samples, denoise=False)
    lights.rig(mode, show_image=False)
    _set_glow(0.0 if mode == "sunset" else 6.0)
    img = bpy.data.images.get("LM_bake") or bpy.data.images.new("LM_bake", RES, RES, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color'
    _prep_materials(objs, img)
    hidden = []
    for o in bpy.data.objects:
        if o.name.startswith("HIT_") or o.name == "Window_glass":
            if not o.hide_render:
                o.hide_render = True
                hidden.append(o)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
        o.data.uv_layers.active = o.data.uv_layers["Lightmap"]
    bpy.context.view_layer.objects.active = objs[0]
    sc = bpy.context.scene
    sc.render.bake.margin = 6
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    sc.cycles.bake_type = 'DIFFUSE'
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6,
                        use_clear=True, target='IMAGE_TEXTURES')
    px = np.empty(RES * RES * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(RES, RES, 4)
    lin = px[..., :3].copy()
    cover = px[..., 3] > 0.5
    lin = _denoise(lin, cover)
    os.makedirs(raw_dir, exist_ok=True)
    np.save(os.path.join(raw_dir, f"lm_{mode}.npy"), lin.astype(np.float16))
    lum = lin[cover].mean(axis=1) if cover.any() else np.zeros(1)
    print(f"[bake] {mode}: {time.time() - t0:.0f}s coverage {cover.mean():.2f} "
          f"lum p50 {np.percentile(lum, 50):.3f} p95 {np.percentile(lum, 95):.3f} p99.5 {np.percentile(lum, 99.5):.3f}")
    _save_webp(lin, out_path, LM_SCALES[mode])
    for o in hidden:
        o.hide_render = False
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
    _set_glow(1.2)


def bake_all(objs, assets, samples=128, modes=("sunset", "night")):
    raw = os.path.join(os.path.dirname(__file__), "..", "out")
    for mode in modes:
        bake_one(objs, mode, samples, os.path.join(assets, f"lightmap_{mode}.webp"), raw)
    import json
    with open(os.path.join(assets, "lightmaps.json"), "w") as f:
        json.dump({m: {"file": f"lightmap_{m}.webp", "scale": LM_SCALES[m],
                       "lightMapIntensity": round(LM_SCALES[m] * 3.14159265, 4)} for m in LM_SCALES}, f, indent=1)
    _cleanup_materials()
