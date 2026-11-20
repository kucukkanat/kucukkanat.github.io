"""Entry point: rebuild every 3D asset from scratch.

    Blender --background --python blender/build.py [-- options]

Options (after `--`):
    --only cabin,collectibles,sky   stages to run (default: all)
    --no-bake                       skip the lightmap bake (keeps existing lightmap files)
    --preview                       render Cycles previews from the viewpoints to blender/out/
    --samples N                     bake samples (default 128)
    --assets DIR                    write glb/lightmaps to DIR instead of public/assets (scratch iterations)
"""
import os
import sys
import json
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import importlib
import bpy
import kit
from kit import util, materials, cabin, collectibles, export, lightmap

ASSETS = os.path.join(ROOT, "public", "assets")
OUT = os.path.join(HERE, "out")


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {"only": ["collectibles", "sky", "cabin"], "bake": True, "preview": False, "samples": 128,
           "views": None, "prefix": "preview"}
    i = 0
    while i < len(a):
        if a[i] == "--only":
            opt["only"] = a[i + 1].split(","); i += 1
        elif a[i] == "--no-bake":
            opt["bake"] = False
        elif a[i] == "--preview":
            opt["preview"] = True
        elif a[i] == "--views":
            opt["views"] = a[i + 1].split(","); i += 1
        elif a[i] == "--prefix":
            opt["prefix"] = a[i + 1]; i += 1
        elif a[i] == "--assets":
            global ASSETS
            ASSETS = os.path.abspath(a[i + 1]); i += 1
        elif a[i] == "--samples":
            opt["samples"] = int(a[i + 1]); i += 1
        i += 1
    return opt


def log(*m):
    print("[build]", *m, flush=True)


def stage_collectibles():
    util.reset()
    objs = collectibles.build()
    info = export.export_glb(os.path.join(ASSETS, "collectibles.glb"), objs)
    log("collectibles.glb", info["bytes"], "bytes", info["tris"], "tris", info["nodes"])
    return info


def stage_sky():
    from kit import sky
    util.reset()
    os.makedirs(ASSETS, exist_ok=True)
    # sky.glb: both tiers (islands 1-6, airship, two balloons, cloud atlas); sky_full.glb: full tier extras.
    infos = sky.build_files(ASSETS, keep_atlas=os.path.join(OUT, "sky_clouds.webp") if os.path.isdir(OUT) else None)
    for info in infos:
        log(os.path.basename(info["path"]), info["bytes"], "bytes", info["tris"], "tris", info["nodes"])
        for k, v in info["per"].items():
            log("   ", k, v)
    return {"files": infos}


def stage_cabin(opt):
    util.reset()
    materials.init_all()
    C = cabin.build()
    st = lightmap.statics()
    lightmap.make_uvs(st)
    os.makedirs(OUT, exist_ok=True)
    if opt["bake"]:
        from kit import bake
        bake.bake_all(st, ASSETS, samples=opt["samples"])
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "cabin.blend"))
    roots = [o for o in C.all_objects if o.parent is None]
    info = export.export_glb(os.path.join(ASSETS, "cabin.glb"), roots)
    log("cabin.glb", info["bytes"], "bytes", info["tris"], "tris")
    log("uv1:", info["uv1_nodes"])
    from kit import phys
    for r in phys.ROPES:
        log("rope", r)
    for w in phys.SWINGS:
        log("swing", w)
    if opt["preview"]:
        from kit import preview
        preview.populate(os.path.join(ASSETS, "collectibles.glb"))
        preview.render_all(OUT, opt["views"], prefix=opt["prefix"])
    return info


def main():
    opt = args()
    t0 = time.time()
    res = {}
    if "collectibles" in opt["only"]:
        res["collectibles"] = stage_collectibles()
    if "sky" in opt["only"]:
        res["sky"] = stage_sky()
    if "cabin" in opt["only"]:
        res["cabin"] = stage_cabin(opt)
    os.makedirs(OUT, exist_ok=True)
    for k, v in res.items():
        with open(os.path.join(OUT, f"{k}_info.json"), "w") as f:
            json.dump(v, f, indent=1)
    log("done in %.1fs" % (time.time() - t0))


main()
