"""Compact .glb writer for the sky models (no Blender exporter involved).

Per mesh object: triangles -> welded vertices (same position + colour) -> one interleaved vertex buffer
  POSITION  int16 normalised VEC3 (KHR_mesh_quantization; the node's translation + uniform scale undo it)
  COLOR_0   uint8 normalised VEC4 (sRGB colour; alpha 0 = glows at night)
No normals (the app shades flat from screen-space derivatives), no UVs. ~12 bytes per vertex.
Node `extras` carry the entries of sky_paint.EXTRAS (e.g. {"glow": [[x, y, z, size], ...]} in model space).
An optional cloud atlas (WebP bytes) is embedded as the texture of a 2-triangle node `SKY_clouds`.
"""
import json
import struct
import numpy as np
from . import sky_paint


def _arrays(ob):
    me = ob.data
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    tl = np.empty(n * 3, np.int32)
    me.loop_triangles.foreach_get("loops", tl)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    b = co[lv[tl]]
    pos = np.stack([b[:, 0], b[:, 2], -b[:, 1]], axis=1).astype(np.float64)     # Blender -> three / glTF
    col = sky_paint.COLS[ob.name][tl]
    # drop degenerate triangles
    t = pos.reshape(-1, 3, 3)
    area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
    keep = np.repeat(area > 1e-9, 3)
    return pos[keep], col[keep]


def _weld(pos, col):
    key = np.concatenate([np.round(pos * 2e4).astype(np.int64), col.astype(np.int64)], axis=1)
    uniq, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    return pos[first], col[first], inv.reshape(-1)


def write(path, objs, atlas=None):
    """objs: Blender mesh objects painted by sky_paint.paint(). Returns {'bytes', 'tris', 'nodes'}."""
    out = bytearray()
    views, accs, meshes, nodes = [], [], [], []
    total_tris = 0

    def view(raw, target=None, stride=None):
        while len(out) % 4:
            out.append(0)
        v = {"buffer": 0, "byteOffset": len(out), "byteLength": len(raw)}
        if target:
            v["target"] = target
        if stride:
            v["byteStride"] = stride
        out.extend(raw)
        views.append(v)
        return len(views) - 1

    per = {}
    for ob in objs:
        pos, col = _arrays(ob)
        p, c, idx = _weld(pos, col)
        lo, hi = p.min(0), p.max(0)
        centre = (lo + hi) / 2
        scale = float(max((hi - lo).max() / 2, 1e-6))
        q = np.round((p - centre) / scale * 32767).astype(np.int16)
        vb = np.zeros(len(p), dtype=[('p', '<i2', 3), ('pad', '<i2'), ('c', 'u1', 4)])
        vb['p'], vb['c'] = q, c
        big = len(p) > 65535
        ib = idx.astype(np.uint32 if big else np.uint16)
        vv = view(vb.tobytes(), 34962, 12)
        iv = view(ib.tobytes(), 34963)
        a0 = len(accs)
        accs.append({"bufferView": vv, "byteOffset": 0, "componentType": 5122, "normalized": True, "count": len(p),
                     "type": "VEC3", "min": [int(v) for v in q.min(0)], "max": [int(v) for v in q.max(0)]})
        accs.append({"bufferView": vv, "byteOffset": 8, "componentType": 5121, "normalized": True, "count": len(p),
                     "type": "VEC4"})
        accs.append({"bufferView": iv, "componentType": 5125 if big else 5123, "count": len(ib), "type": "SCALAR"})
        meshes.append({"name": ob.name, "primitives": [
            {"attributes": {"POSITION": a0, "COLOR_0": a0 + 1}, "indices": a0 + 2, "material": 0}]})
        node = {"name": ob.name, "mesh": len(meshes) - 1, "translation": [float(v) for v in centre],
                "scale": [scale, scale, scale]}
        ex = sky_paint.EXTRAS.get(ob.name)
        if ex:
            node["extras"] = ex
        nodes.append(node)
        total_tris += len(ib) // 3
        per[ob.name] = {"tris": len(ib) // 3, "verts": len(p), "bytes": len(vb.tobytes()) + len(ib.tobytes())}

    g = {"asset": {"version": "2.0", "generator": "kit/sky_pack.py"},
         "extensionsUsed": ["KHR_mesh_quantization"], "extensionsRequired": ["KHR_mesh_quantization"],
         "materials": [{"name": "SkyPaint", "pbrMetallicRoughness": {"metallicFactor": 0, "roughnessFactor": 1}}]}
    if atlas is not None:
        iv = view(atlas)
        quad = np.array([[-1, -0.5, 0], [1, -0.5, 0], [1, 0.5, 0], [-1, 0.5, 0]], np.float32)
        uv = np.array([[0, 1], [1, 1], [1, 0], [0, 0]], np.float32)
        pv, uvv = view(quad.tobytes(), 34962), view(uv.tobytes(), 34962)
        xv = view(np.array([0, 1, 2, 0, 2, 3], np.uint16).tobytes(), 34963)
        a0 = len(accs)
        accs.append({"bufferView": pv, "componentType": 5126, "count": 4, "type": "VEC3",
                     "min": [-1, -0.5, 0], "max": [1, 0.5, 0]})
        accs.append({"bufferView": uvv, "componentType": 5126, "count": 4, "type": "VEC2"})
        accs.append({"bufferView": xv, "componentType": 5123, "count": 6, "type": "SCALAR"})
        g["images"] = [{"bufferView": iv, "mimeType": "image/webp", "name": "sky_clouds"}]
        g["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]
        g["textures"] = [{"sampler": 0, "extensions": {"EXT_texture_webp": {"source": 0}}}]
        g["materials"].append({"name": "SkyClouds", "alphaMode": "BLEND", "pbrMetallicRoughness": {
            "baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1}})
        g["extensionsUsed"].append("EXT_texture_webp")
        g["extensionsRequired"].append("EXT_texture_webp")
        meshes.append({"name": "SKY_clouds", "primitives": [
            {"attributes": {"POSITION": a0, "TEXCOORD_0": a0 + 1}, "indices": a0 + 2, "material": 1}]})
        nodes.append({"name": "SKY_clouds", "mesh": len(meshes) - 1})
        per["SKY_clouds"] = {"tris": 2, "verts": 4, "bytes": len(atlas)}
    while len(out) % 4:
        out.append(0)
    g.update({"scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
              "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(out)}]})
    js = json.dumps(g, separators=(',', ':')).encode()
    while len(js) % 4:
        js += b' '
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942))
        f.write(out)
    return {"path": path, "bytes": total, "tris": total_tris, "nodes": [n["name"] for n in nodes], "per": per}
