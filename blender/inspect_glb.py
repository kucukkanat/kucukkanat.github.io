#!/usr/bin/env python3
"""Print node names (+ world translation, three.js coords) and stats of .glb files.
Usage: python3 blender/inspect_glb.py public/assets/cabin.glb [...]"""
import json
import os
import struct
import sys


def load(path):
    d = open(path, 'rb').read()
    cl, = struct.unpack_from('<I', d, 12)
    return json.loads(d[20:20 + cl])


def qrot(q, v):
    x, y, z, w = q
    # v' = q v q*
    ix = w * v[0] + y * v[2] - z * v[1]
    iy = w * v[1] + z * v[0] - x * v[2]
    iz = w * v[2] + x * v[1] - y * v[0]
    iw = -x * v[0] - y * v[1] - z * v[2]
    return [ix * w + iw * -x + iy * -z - iz * -y,
            iy * w + iw * -y + iz * -x - ix * -z,
            iz * w + iw * -z + ix * -y - iy * -x]


def main(paths):
    for p in paths:
        g = load(p)
        nodes = g.get('nodes', [])
        parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
        acc = g.get('accessors', [])

        def world(i):
            n = nodes[i]
            t = n.get('translation', [0, 0, 0])
            if i in parent:
                pi = parent[i]
                pt = world(pi)
                pr = nodes[pi].get('rotation', [0, 0, 0, 1])
                rt = qrot(pr, t)
                return [pt[0] + rt[0], pt[1] + rt[1], pt[2] + rt[2]]
            return t

        tris = 0
        print(f"## {os.path.basename(p)} — {os.path.getsize(p)/1024:.0f} KB")
        for i, n in enumerate(nodes):
            nt = 0
            uv = ''
            if 'mesh' in n:
                for pr in g['meshes'][n['mesh']]['primitives']:
                    nt += acc[pr['indices']]['count'] // 3 if 'indices' in pr else 0
                    if 'TEXCOORD_1' in pr['attributes']:
                        uv = ' uv1'
            tris += nt
            w = world(i)
            kind = f"mesh {nt} tris{uv}" if 'mesh' in n else 'empty'
            par = f" (child of {nodes[parent[i]]['name']})" if i in parent else ''
            print(f"- `{n.get('name')}` — {kind} @ ({w[0]:.3f}, {w[1]:.3f}, {w[2]:.3f}){par}")
        print(f"\nTotal triangles: {tris}; materials: {', '.join(m['name'] for m in g.get('materials', []))}\n")


if __name__ == '__main__':
    main(sys.argv[1:])
