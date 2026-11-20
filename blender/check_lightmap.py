"""Render base colour x baked lightmap (emission only) from viewpoints to verify the lightmap UVs line up.
Blender --background blender/out/cabin.blend --python blender/check_lightmap.py -- [sunset|night] [views]"""
import os
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kit import preview, bake

a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
mode = a[0] if a else "sunset"
views = a[1].split(",") if len(a) > 1 else ["overview", "table"]
lm = os.path.join(os.path.dirname(HERE), "public", "assets", f"lightmap_{mode}.webp")
preview.lightmap_preview(os.path.join(HERE, "out"), lm, views=views, scale=bake.LM_SCALES[mode], prefix=f"lmcheck_{mode}")
