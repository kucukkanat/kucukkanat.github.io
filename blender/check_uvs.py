#!/usr/bin/env python3
"""Print TEXCOORD ranges of label/screen/map primitives (sanity check for the contract's 0..1 UVs)."""
import json, struct, sys
for f in sys.argv[1:]:
    d = open(f, 'rb').read(); cl, = struct.unpack_from('<I', d, 12); g = json.loads(d[20:20 + cl])
    binoff = 20 + cl + 8
    def read(ai):
        a = g['accessors'][ai]; bv = g['bufferViews'][a['bufferView']]
        o = binoff + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        vals = struct.unpack_from('<%df' % (a['count'] * 2), d, o)
        us, vs = vals[0::2], vals[1::2]
        return (round(min(us), 3), round(max(us), 3), round(min(vs), 3), round(max(vs), 3))
    for n in g['nodes']:
        if 'mesh' not in n: continue
        for p in g['meshes'][n['mesh']]['primitives']:
            mn = g['materials'][p['material']]['name']
            if mn in ('Label', 'SpineLabel', 'Screen', 'SkyMap', 'LetterPaper', 'PortraitCanvas', 'TengwarPaper', 'SlateBoard'):
                print(f.split('/')[-1], n['name'], mn, {k: read(v) for k, v in p['attributes'].items() if 'TEX' in k})
