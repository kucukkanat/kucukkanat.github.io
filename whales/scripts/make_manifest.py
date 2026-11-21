"""Write viewer/whales.json from the config + built GLBs."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from whalegen.config import SPECIES, BIOMES, ORDER
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = []
for k in ORDER:
    sp = SPECIES[k]; files = {}; sizes = {}
    for st in 'AB':
        p = os.path.join(root, 'out', 'glb', f'{k}_{st}.glb')
        if os.path.exists(p):
            files[st] = f'../glb/{k}_{st}.glb'; sizes[st] = round(os.path.getsize(p) / 1e6, 2)
    if not files:
        continue
    out.append(dict(key=k, name=sp['name'], biome=sp['biome'], biomeLabel=BIOMES[sp['biome']]['label'],
                    biomeShort=BIOMES[sp['biome']]['label'].split(' & ')[0], color=sp['colors']['B']['top'],
                    files=files, sizes=sizes))
json.dump(out, open(os.path.join(root, 'viewer_v1', 'whales.json'), 'w'), indent=1)
print('manifest', [o['key'] for o in out])
