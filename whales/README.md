# Sky whales

Six flying whales, each carrying its own ecosystem, in two styles (12 models). They're built procedurally in Blender 5.3 (model, rig, animation and textures, all by script) for three.js. The site shows the style A whales wandering the sky around the airship, and `/whales/` is the standalone viewer. See [PLAN.md](PLAN.md) for the integration plan and [RESEARCH.md](RESEARCH.md) for the anatomy research and targets.

| Whale | Ecosystem | Palette |
|---|---|---|
| Blue whale | Temperate forest, waterfall lake, cabin | teal / slate |
| Sperm whale | Desert oasis, palms, mesas, sandstone arch | sand / burnt orange |
| Beluga | Snowy pine tundra, frozen pond, igloo, ice crystals | ice blue / white |
| Humpback | Tropical jungle, two cascading lakes, step pyramid | deep green / coral |
| Bowhead | Autumn maple grove, colonnade ruins, pond falls | plum / crimson |
| Minke | Cherry-blossom zen garden, koi pond, bridge, torii, lanterns | blush pink / pearl |

Both styles share species-faithful anatomy.
- **Style A:** stylized-realistic, with PBR shading and painted 2k colour + normal maps.
- **Style B:** Ghibli-like painterly, with a posterised palette and chunkier props. Cel shading and an ink outline are applied at runtime.

| Path | What |
|---|---|
| `scripts/build_whale2.py` | Builds one whale: SDF body, rig, island, textures, clips → `out/blend`, `out/glb`, `out/textures` |
| `scripts/whalegen/` | The generator: `anatomy.py` (species parts), `sdfbody.py` (OpenVDB smooth CSG), `bodymesh.py` (decimation, UVs, weights), `island2.py` + `biomes.py` + `props.py` (grown-in ecosystem), `paint2.py` (UV-rasterised painting + normal maps), `anim.py` (clips), `rig.py` (Blender objects) |
| `scripts/build_all.sh` | All 12 (about 6 min), or `build_all.sh minke humpback` for some |
| `scripts/render_all.sh`, `render_whale.py` | Turnaround stills and the 8 s cruise MP4 per variant → `renders/` |
| `scripts/measure_stretch.py`, `attrib_stretch.py` | Skin-strain check of flippers and fluke over every clip, and which bones cause it |
| `scripts/test_body.py`, `render_finposes.py`, `render_finclip.py`, `contact_sheet.py` | Anatomy and flipper review renders, contact sheets |
| `out/glb/` | Master GLBs (Draco) |
| `scripts/web.ts`, `export_web.py`, `make_manifest.py` | Web copies for the site → `public/assets/whales/`: `<sp>_A.glb` (world + viewer), `<sp>_B.glb` (viewer), `<sp>_lite.glb` (far whales, phones: ~4.5k-tri body, ~5k-tri island, 512 px texture), all meshopt + WebP, plus `manifest.json` |
| `out/blend/`, `out/textures/`, `renders/`, `ref/` | Source scenes, textures, final renders, reference renders (**Git LFS**) |
| `index.html` | The `/whales/` viewer page (second Vite entry; code in `src/whales/`) |

## Rebuild
```bash
bun run whales                     # all 12 -> whales/out
bun whales/scripts/web.ts          # web copies + manifest -> public/assets/whales
whales/scripts/render_all.sh       # stills + MP4s -> whales/renders
```
Blender 5.3 at `/Applications/Blender.app` (its bundled numpy and openvdb are used).

## GLB contract
- Orientation: nose +Z, up +Y, whale's left +X. Length is in metre-like units (`userData.whale.length`).
- Meshes: `Whale_Body` (colour + normal map), `Whale_Island` (vertex colours: terrain, props, eyes), `Whale_Water`, `Whale_Falls`, `Whale_Ice`. Material extras: `role` (`body|vcol|water|waterfall|ice`), `toon` (1 for style B).
- Bones:
  - spine chain: `root, chest, neck, head, spine_1..3, tail_1..5`;
  - fluke: `fluke, fluke_L/R_1..2`;
  - flippers: `fin_L/R_1..5` (shoulder to tip);
  - other: `breath`, `blowhole`, `tree_NN_a/b` (tree cluster bend chains), `water_N` (lake slosh).
- Clips:
  - `cruise`: 8 s seamless loop containing:
    - two vertical fluke strokes, with a travelling wave down the spine;
    - flippers sculling with a bend wave from shoulder to tip plus a feathering twist;
    - fluke blades flexing behind the stroke;
    - one breath;
    - trees and water swaying.
  - `rest`: the bind pose.
  - `body_*` / `eco_*`: static reaction poses for `bankL`, `bankR`, `climb`, `dive` and `accel`, made additive at runtime and driven by springs. Body springs are critically damped; eco springs (trees and water) are under-damped and also feel the gravity tilt.
- Scene extras `whale` (JSON): species, biome, style, particle config, island bounds, stats.
