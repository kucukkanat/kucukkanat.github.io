"""Materials. Base colour textures (painted, tileable) on UV map 'UVMap' (glTF TEXCOORD_0).
Textures are downscaled to JPEG copies in blender/tex/ which the exporter embeds."""
import os
import bpy
from . import util, paint

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART = os.path.join(ROOT, "art", "textures")
TEX = os.path.join(ROOT, "blender", "tex")

# name: (texture file or None, export size, metres per tile, flat colour, roughness, metallic)
SPECS = {
    "Planks":    ("wood_planks", 1024, 1.6, (0.55, 0.36, 0.2), 0.8, 0.0),
    "Mahogany":  ("mahogany", 1024, 0.9, (0.42, 0.16, 0.08), 0.6, 0.0),
    "DarkWood":  ("dark_wood", 1024, 1.4, (0.18, 0.1, 0.06), 0.8, 0.0),
    "Brass":     ("brass", 512, 0.35, (0.8, 0.55, 0.22), 0.4, 0.35),
    "Parchment": ("parchment", 512, 0.5, (0.85, 0.74, 0.55), 0.9, 0.0),
    "Leather":   ("leather", 512, 0.4, (0.35, 0.18, 0.1), 0.7, 0.0),
    "Cloth":     ("cloth", 512, 0.6, (0.5, 0.12, 0.1), 0.9, 0.0),
    "Rope":      (None, 0, 1, (1.0, 1.0, 1.0), 0.85, 0.0),     # procedural strand texture (fix.rope_textures)
    "SkyMap":    ("sky_map", 1024, 1.0, (0.85, 0.74, 0.55), 0.85, 0.0),
    "SkyMapGlobe": ("sky_map", 512, 0.35, (0.8, 0.72, 0.55), 0.6, 0.0),
    "Iron":      (None, 0, 1, (0.08, 0.07, 0.065), 0.6, 0.6),
    "OrangePlastic": (None, 0, 1, (0.86, 0.33, 0.09), 0.45, 0.0),   # ~#E8652B in sRGB
    "BezelPlastic":  (None, 0, 1, (0.035, 0.035, 0.045), 0.4, 0.0),
    "CreamPlastic":  (None, 0, 1, (0.86, 0.80, 0.66), 0.45, 0.0),
    "DarkPlastic":   (None, 0, 1, (0.12, 0.05, 0.03), 0.6, 0.0),
    "Screen":    (None, 0, 1, (0.05, 0.08, 0.12), 0.15, 0.0),
    "LanternGlow": (None, 0, 1, (1.0, 0.62, 0.3), 0.08, 0.0),
    "Glass":     (None, 0, 1, (0.85, 0.8, 0.75), 0.05, 0.0),
    "Hit":       (None, 0, 1, (1.0, 0.0, 1.0), 1.0, 0.0),
    "Paper":     (None, 0, 1, (0.86, 0.80, 0.66), 0.9, 0.0),
    "BookRed":   ("leather", 256, 0.3, (0.45, 0.12, 0.09), 0.7, 0.0),
    "BookGreen": ("leather", 256, 0.3, (0.17, 0.27, 0.16), 0.7, 0.0),
    "BookBlue":  ("leather", 256, 0.3, (0.14, 0.2, 0.32), 0.7, 0.0),
    "WallPlanks": ("wood_planks", 1024, 1.6, (0.4, 0.24, 0.15), 0.8, 0.0),
    "BookOchre": ("leather", 256, 0.3, (0.5, 0.33, 0.1), 0.7, 0.0),
    "BookPlum":  ("leather", 256, 0.3, (0.2, 0.09, 0.17), 0.7, 0.0),
    "BookTeal":  ("leather", 256, 0.3, (0.08, 0.2, 0.2), 0.7, 0.0),
    "GaugeFace": (None, 0, 1, (0.9, 0.85, 0.72), 0.5, 0.0),
    # polish round
    "Gilt":      ("brass", 512, 0.3, (0.85, 0.65, 0.25), 0.35, 0.4),
    "LetterPaper": (None, 0, 1, (0.9, 0.84, 0.7), 0.9, 0.0),
    "WaxSeal":   (None, 0, 1, (0.42, 0.04, 0.04), 0.35, 0.0),
    "PortraitCanvas": (None, 0, 1, (0.45, 0.35, 0.26), 0.8, 0.0),
    "BottleGlass": (None, 0, 1, (0.55, 0.72, 0.6), 0.05, 0.0),
    "TengwarPaper": (None, 0, 1, (0.88, 0.82, 0.66), 0.9, 0.0),
    "SlateBoard": (None, 0, 1, (0.1, 0.11, 0.12), 0.85, 0.0),
    "Cork":      (None, 0, 1, (0.62, 0.45, 0.28), 0.9, 0.0),
    "Chalk":     (None, 0, 1, (0.92, 0.9, 0.86), 0.95, 0.0),
    "Sailcloth": ("parchment", 512, 0.9, (0.82, 0.76, 0.62), 0.9, 0.0),
    "LampGlass": (None, 0, 1, (0.78, 0.66, 0.45), 0.2, 0.0),
    # fix round
    "Twine":     (None, 0, 1, (0.42, 0.3, 0.17), 0.9, 0.0),
    "Candle":    (None, 0, 1, (0.92, 0.86, 0.7), 0.55, 0.0),
    "LanternFlame": (None, 0, 1, (1.0, 0.8, 0.45), 0.5, 0.0),
    "ClockDial": (None, 0, 1, (0.88, 0.82, 0.66), 0.55, 0.0),
    "ClockInk":  (None, 0, 1, (0.025, 0.022, 0.02), 0.5, 0.0),
    "ClockHand": (None, 0, 1, (0.03, 0.04, 0.08), 0.3, 0.7),
    "ClockRed":  (None, 0, 1, (0.5, 0.06, 0.03), 0.4, 0.2),
    # keepsakes on the right wall (dress.keepsakes): naval cadet tunic + cap, flight jacket
    "TunicWhite": (None, 0, 1, (0.82, 0.82, 0.78), 0.85, 0.0),
    "TunicShade": (None, 0, 1, (0.46, 0.46, 0.45), 0.9, 0.0),
    "BoardBlack": (None, 0, 1, (0.012, 0.012, 0.016), 0.7, 0.0),
    "PaleGold":  (None, 0, 1, (0.98, 0.87, 0.52), 0.4, 0.0),
    "BrightGold": (None, 0, 1, (0.88, 0.60, 0.16), 0.35, 0.3),
    "CapVisor":  (None, 0, 1, (0.01, 0.01, 0.012), 0.15, 0.0),
    "FlightNylon": (None, 0, 1, (0.18, 0.21, 0.12), 0.6, 0.0),
    "KnitRib":   (None, 0, 1, (0.085, 0.10, 0.065), 0.95, 0.0),
    "KnitRibHi": (None, 0, 1, (0.15, 0.175, 0.105), 0.95, 0.0),
    "SquadronPatch": (None, 0, 1, (0.25, 0.27, 0.30), 0.9, 0.0),
}
# tint multiplied onto a shared texture (book colours etc.)
# tints are baked into the texture pixels (glTF-safe); suffix in the file name
TINT = {"Gilt": (1.0, 0.9, 0.55), "Sailcloth": (0.86, 0.8, 0.68), "BookRed": (1.0, 0.42, 0.36), "BookGreen": (0.5, 0.85, 0.55), "BookBlue": (0.45, 0.62, 1.0),
        "WallPlanks": (0.78, 0.6, 0.52)}

_prepared = {}


def prepare_texture(stem, size, tint=None, tag=""):
    """Downscale art/textures/<stem>.png to blender/tex/<stem>[_tag]_<size>.jpg (cached), optional tint."""
    os.makedirs(TEX, exist_ok=True)
    src = os.path.join(ART, stem + ".png")
    if not os.path.exists(src):
        return None
    dst = os.path.join(TEX, f"{stem}{'_' + tag if tag else ''}_{size}.jpg")
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src) or tint:
        img = bpy.data.images.load(src)
        w, h = img.size
        s = size / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))
        if tint:
            import numpy as np
            px = np.empty(len(img.pixels), dtype=np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(-1, 4)
            px[:, :3] *= np.array(tint, dtype=np.float32)
            img.pixels.foreach_set(px.ravel())
        scn = bpy.context.scene
        st = scn.render.image_settings
        st.file_format = 'JPEG'
        st.quality = 82
        st.color_mode = 'RGB'
        img.save_render(dst, scene=scn)
        bpy.data.images.remove(img)
    return dst


def prepare_painted(stem, size, name):
    """Painted-diorama version of art/textures/<stem>.png in the palette of material `name` (kit/paint.py),
    cached as blender/tex/<stem>_<name>_p<size>.png."""
    import numpy as np
    os.makedirs(TEX, exist_ok=True)
    src = os.path.join(ART, stem + ".png")
    if not os.path.exists(src):
        return None
    dst = os.path.join(TEX, f"{stem}_{name.lower()}_p{size}.png")
    newest = max(os.path.getmtime(src), os.path.getmtime(paint.__file__))
    if not os.path.exists(dst) or os.path.getmtime(dst) < newest:
        img = bpy.data.images.load(src)
        img.scale(size, size)
        px = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        rgb = paint.paint(px.reshape(size, size, 4)[..., :3].copy(), name, seed=zlib_seed(name))
        out = bpy.data.images.new("painted", size, size, alpha=False)
        out.pixels.foreach_set(np.concatenate([rgb, np.ones((size, size, 1), np.float32)], axis=2).ravel())
        out.filepath_raw = dst
        out.file_format = 'PNG'
        out.save()
        bpy.data.images.remove(out)
    return dst


def zlib_seed(name):
    import zlib
    return zlib.crc32(name.encode()) % 1000


def get(name):
    """Get or create material by name (unknown names -> grey)."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    spec = SPECS.get(name, (None, 0, 1, (0.6, 0.6, 0.6), 0.7, 0.0))
    stem, size, tile, col, rough, metal = spec
    util.TILE[name] = tile
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Base Color"].default_value = (*col, 1)
    if stem and name in paint.PALETTE:
        path = prepare_painted(stem, size, name)
        col = paint.mid_lin(name)
        bsdf.inputs["Base Color"].default_value = (*col, 1)
    else:
        path = prepare_texture(stem, size, TINT.get(name), name.lower() if name in TINT else "") if stem else None
    if path:
        img = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.name = "BaseTex"
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "UVMap"
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if name == "LanternGlow":
        # warm amber glass: see-through (candle visible), emissive so the app can drive the glow
        bsdf.inputs["Emission Color"].default_value = (1.0, 0.62, 0.25, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.2
        bsdf.inputs["Alpha"].default_value = 0.5
    if name == "LanternFlame":
        bsdf.inputs["Emission Color"].default_value = (1.0, 0.72, 0.32, 1)
        bsdf.inputs["Emission Strength"].default_value = 8.0
    if name == "Rope":
        from . import fix
        fix.setup_rope_material(m)
    if name == "Screen":
        bsdf.inputs["Emission Color"].default_value = (0.25, 0.35, 0.5, 1)
        bsdf.inputs["Emission Strength"].default_value = 0.6
    if name == "Glass":
        bsdf.inputs["Alpha"].default_value = 0.15
        bsdf.inputs["Transmission Weight"].default_value = 0.0
    if name == "BottleGlass":
        bsdf.inputs["Alpha"].default_value = 0.35
    if name == "Hit":
        bsdf.inputs["Alpha"].default_value = 0.0
    return m


def set_tile(name):
    get(name)
    return util.TILE.get(name, 1.0)


def init_all():
    for n in SPECS:
        get(n)
