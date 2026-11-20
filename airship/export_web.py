#!/usr/bin/env python3
"""Web copy of the galleon for the site's intro shot: out/sky_galleon.glb -> ../public/assets/galleon.glb.
Geometry is meshopt-compressed with gltf-transform (as scripts/compress-glb.ts does for the cabin); textures are already
WebP <= 1024 px. Node names, hierarchy and extras are kept. Meshopt quantisation rewrites the transforms of mesh nodes,
so the app must only animate the joint empties (every moving part is one), never a mesh node itself."""
import json, os, struct, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, 'out', 'sky_galleon.glb')
dst = os.path.join(here, '..', 'public', 'assets', 'galleon.glb')
subprocess.run(['bunx', 'gltf-transform', 'meshopt', src, dst, '--level', 'high', '--quantize-position', '14', '--quantize-texcoord', '12', '--quantize-normal', '10'], check=True,
               stdout=subprocess.DEVNULL)
d = open(dst, 'rb').read()
n = struct.unpack('<I', d[12:16])[0]
g = json.loads(d[20:20 + n])
tris = sum(g['accessors'][p['indices']]['count'] // 3 for m in g['meshes'] for p in m['primitives'])
print(os.path.normpath(dst), len(d), 'bytes,', tris, 'tris,', len(g['nodes']), 'nodes,', len(g.get('images', [])), 'textures,',
      sum(1 for x in g['nodes'] if x.get('extras', {}).get('joint')), 'joints,', sum(len(m['primitives']) for m in g['meshes']), 'primitives')
if len(d) > 2.5e6: sys.exit('over the 2.5 MB limit')

# Phone copy (loaded only when a phone visitor taps "Outside"): 256 px textures, lightly simplified, coarser quantisation.
# The model is chunky low-poly with per-face colours, so simplification removes little; most of the saving is textures.
lite = os.path.join(here, '..', 'public', 'assets', 'galleon_lite.glb')
tmp = os.path.join(here, 'out', '_lite_tmp.glb')
steps = [['weld', src, tmp], ['simplify', tmp, tmp, '--ratio', '0.25', '--error', '0.01'], ['resize', tmp, tmp, '--width', '256', '--height', '256'],
         ['webp', tmp, tmp, '--quality', '70'],
         ['meshopt', tmp, lite, '--level', 'high', '--quantize-position', '12', '--quantize-texcoord', '10', '--quantize-normal', '8']]
for st in steps:
    subprocess.run(['bunx', 'gltf-transform', *st], check=True, stdout=subprocess.DEVNULL)
os.remove(tmp)
print(os.path.normpath(lite), os.path.getsize(lite), 'bytes')
