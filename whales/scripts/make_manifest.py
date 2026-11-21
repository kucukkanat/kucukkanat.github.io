"""Write public/assets/whales/manifest.json (species, labels, files, sizes) from the config + web copies."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from whalegen.config import SPECIES, BIOMES, ORDER
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
web = os.path.join(root, 'public', 'assets', 'whales')
FACTS = {
    'blue': 'The largest animal ever known. A broad, flat U-shaped head, a splashguard around the blowholes and throat pleats that stretch to the navel.',
    'sperm': 'A huge square head (a third of its length) holding the spermaceti organ, a narrow lower jaw underneath and prune-wrinkled skin.',
    'beluga': 'The white whale: a soft, shape-shifting melon, a flexible neck and a ridge instead of a dorsal fin.',
    'humpback': 'Flippers a third of its body length with scalloped edges, knobs on the head and a fluke pattern unique to each animal.',
    'bowhead': 'A bow-shaped mouth in a head a third of its length, a white chin patch, no dorsal fin - and it can live over 200 years.',
    'minke': 'The smallest rorqual: a sharp, pointed head with a single ridge and a bright white band on each flipper.',
}
out = []
for k in ORDER:
    sp = SPECIES[k]; files = {}; sizes = {}
    for v in ('A', 'B', 'lite'):
        f = f'{k}_{v}.glb'; p = os.path.join(web, f)
        if os.path.exists(p):
            files[v] = f'/assets/whales/{f}'; sizes[v] = round(os.path.getsize(p) / 1e6, 2)
    if not files:
        continue
    b = BIOMES[sp['biome']]
    out.append(dict(key=k, name=sp['name'], biome=sp['biome'], biomeLabel=b['label'], biomeShort=b['label'].split(' & ')[0],
                    color=sp['colors']['B']['top'], fact=FACTS[k], files=files, sizes=sizes))
os.makedirs(web, exist_ok=True)
json.dump(out, open(os.path.join(web, 'manifest.json'), 'w'), indent=1)
print('manifest', [o['key'] for o in out])
