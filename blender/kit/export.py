"""glTF export + inspection helpers."""
import json
import os
import struct
import bpy


def select_tree(objs):
    bpy.ops.object.select_all(action='DESELECT') if bpy.context.mode == 'OBJECT' else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    todo = list(objs)
    while todo:
        o = todo.pop()
        o.hide_set(False)
        o.select_set(True)
        todo.extend(o.children)


def export_glb(path, objs, image_format='WEBP'):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    select_tree(objs)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format=image_format,
        export_image_quality=60,
        export_draco_mesh_compression_enable=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    return glb_info(path)


def glb_json(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack_from('<III', data, 0)
    clen, ctype = struct.unpack_from('<II', data, 12)
    return json.loads(data[20:20 + clen])


def glb_info(path):
    g = glb_json(path)
    size = os.path.getsize(path)
    nodes = g.get('nodes', [])
    meshes = g.get('meshes', [])
    acc = g.get('accessors', [])
    tris = 0
    uv1 = []
    for n in nodes:
        if 'mesh' in n:
            for p in meshes[n['mesh']]['primitives']:
                if 'indices' in p:
                    tris += acc[p['indices']]['count'] // 3
                if 'TEXCOORD_1' in p['attributes']:
                    uv1.append(n['name'])
    return {
        'path': path, 'bytes': size, 'tris': tris,
        'nodes': [n.get('name') for n in nodes],
        'materials': [m.get('name') for m in g.get('materials', [])],
        'uv1_nodes': sorted(set(uv1)),
        'images': len(g.get('images', [])),
    }


def node_table(path):
    """Node name + translation (three coords) for NOTES."""
    g = glb_json(path)
    nodes = g.get('nodes', [])
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i
    rows = []
    for i, n in enumerate(nodes):
        t = n.get('translation', [0, 0, 0])
        p = nodes[parent[i]]['name'] if i in parent else ''
        kind = 'mesh' if 'mesh' in n else 'empty'
        rows.append((n.get('name'), kind, p, [round(v, 3) for v in t]))
    return rows


def flat_unindexed_normals(path, mesh_prefix):
    """Post-process a .glb: drop NORMAL from the primitives of meshes whose name starts with `mesh_prefix`
    and weld their vertices (identical position + other attributes). glTF clients must then compute flat
    normals (three.js GLTFLoader sets material.flatShading), which is exactly the faceted low-poly look --
    at roughly a third of the size. Rewrites the binary chunk compactly."""
    import numpy as np
    with open(path, 'rb') as f:
        data = f.read()
    clen, = struct.unpack_from('<I', data, 12)
    g = json.loads(data[20:20 + clen])
    off = 20 + clen
    blen, = struct.unpack_from('<I', data, off)
    bin_ = bytearray(data[off + 8: off + 8 + blen])
    acc, bvs = g['accessors'], g['bufferViews']
    NC = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
    NT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def read(i):
        a = acc[i]
        bv = bvs[a['bufferView']]
        dt = NC[a['componentType']]
        n = NT[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        arr = np.frombuffer(bytes(bin_[start:start + a['count'] * n * np.dtype(dt).itemsize]), dtype=dt)
        return arr.reshape(a['count'], n) if n > 1 else arr

    new_arrays = {}           # accessor index -> new numpy array
    for m in g['meshes']:
        if not m['name'].startswith(mesh_prefix):
            continue
        for p in m['primitives']:
            at = p['attributes']
            at.pop('NORMAL', None)
            keys = sorted(at.keys())
            cols = [read(at[k]).astype(np.float32).reshape(acc[at[k]]['count'], -1) for k in keys]
            full = np.concatenate(cols, axis=1)
            uniq, inv = np.unique(np.round(full, 6), axis=0, return_inverse=True)
            inv = inv.reshape(-1)
            # first occurrence of each unique row keeps its exact values
            first = np.zeros(len(uniq), dtype=np.int64)
            first[inv[::-1]] = np.arange(len(inv))[::-1]
            idx = inv[read(p['indices']).astype(np.int64)]
            c0 = 0
            for k, c in zip(keys, cols):
                w = c.shape[1]
                new_arrays[at[k]] = c[first].astype(NC[acc[at[k]]['componentType']])
                c0 += w
            new_arrays[p['indices']] = idx.astype(np.uint16 if len(uniq) < 65536 else np.uint32)
            acc[p['indices']]['componentType'] = 5123 if len(uniq) < 65536 else 5125
    # rebuild the binary chunk: every accessor that is still referenced gets its own tightly packed view
    used = set()
    for m in g['meshes']:
        for p in m['primitives']:
            used.update(p['attributes'].values())
            if 'indices' in p:
                used.add(p['indices'])
    for s in g.get('skins', []):
        if 'inverseBindMatrices' in s:
            used.add(s['inverseBindMatrices'])
    out = bytearray()
    new_bvs = []
    for i, a in enumerate(acc):
        if i not in used or 'bufferView' not in a:
            continue
        arr = new_arrays.get(i)
        if arr is None:
            arr = read(i)
        raw = np.ascontiguousarray(arr).tobytes()
        while len(out) % 4:
            out.append(0)
        bv = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)}
        old = bvs[a['bufferView']]
        if 'target' in old:
            bv['target'] = old['target']
        out += raw
        a['bufferView'] = len(new_bvs)
        a.pop('byteOffset', None)
        a['count'] = int(arr.shape[0])
        if a['type'] == 'VEC3' and i in new_arrays and 'min' in a:
            a['min'] = [float(v) for v in arr.min(0)]
            a['max'] = [float(v) for v in arr.max(0)]
        new_bvs.append(bv)
    # images keep their bytes
    for img in g.get('images', []):
        if 'bufferView' in img:
            old = bvs[img['bufferView']]
            start = old.get('byteOffset', 0)
            raw = bytes(bin_[start:start + old['byteLength']])
            while len(out) % 4:
                out.append(0)
            new_bvs.append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)})
            img['bufferView'] = len(new_bvs) - 1
            out += raw
    # drop unused accessors (normals) and renumber
    keep = [i for i, a in enumerate(acc) if i in used]
    remap = {o: n for n, o in enumerate(keep)}
    g['accessors'] = [acc[i] for i in keep]
    for m in g['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: remap[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = remap[p['indices']]
    for s in g.get('skins', []):
        if 'inverseBindMatrices' in s:
            s['inverseBindMatrices'] = remap[s['inverseBindMatrices']]
    g['bufferViews'] = new_bvs
    while len(out) % 4:
        out.append(0)
    g['buffers'] = [{'byteLength': len(out)}]
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
