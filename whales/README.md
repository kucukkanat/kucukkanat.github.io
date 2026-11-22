# Sky whales

Flying whales, each carrying an ecosystem on its back. The **bodies** are six species in two styles, built procedurally in Blender 5.3 (model, rig, animation and textures, all by script). Everything else is **grown in the browser from a seed**: which individual it is (size, proportions, skin), and the whole island (terrain, lakes, waterfalls, landmarks, plants, animals). The site shows today's pod wandering the sky around the airship, and `/whales/` is the standalone viewer. See [PLAN.md](PLAN.md) for the original integration plan and [RESEARCH.md](RESEARCH.md) for the anatomy research and targets.

| Species (body) | Biomes (any biome grows on any species) |
|---|---|
| Blue whale, sperm whale, beluga, humpback, bowhead, minke | Temperate forest, desert oasis, snowy tundra (frozen lakes), tropical jungle, autumn grove, cherry-blossom garden, volcanic caldera (lava lake and lava falls), giant mushroom grove, coral lagoon, mangrove swamp, overgrown sky ruins |

## Seeds
- A seed is any string. `makeGenome(seed)` (`src/whales/genome.ts`) derives the species, biome, the individual's name, size, girth, flipper / fluke / head proportions, swim tempo, skin genes and the island's layout seed. The same seed gives the same whale on every machine.
- **Today's pod:** `dailyPod()` gives six seeds per UTC day (`2026-11-22-1` … `-6`), one per species, each on a different biome. The airship world shows it; the viewer lists it.
- **Viewer:** `/whales/?seed=<seed>` (also `&species=`, `&biome=` to pin either, `&style=A|B`, `&sky=day|sunset|night|storm`). "New whale" rolls a seed, "Copy link" shares it. `classic-<species>` is the species on its original biome.

## Runtime (`src/whales/`)
| File | What |
|---|---|
| `genome.ts`, `rng.ts`, `biomes.ts` | Seeds to genomes; seeded RNG and value noise; the eleven biome definitions (palette, plants, landmarks, fauna, liquid, weather) |
| `back.ts` | Reads the body at rest: a height map of the back (rasterised from the mesh), which bones carry each spot, the flank's cross-section; and per-frame skin matrices so generated things ride the swimming body |
| `ecosystem.ts` | Grows the island: terrain shaped over the back, hills, lake basins with outlet channels, landmarks, planting. Then runs it: per-tree and per-lantern springs, undergrowth sway, floating boats and lilies, rolling boulders, waterfalls, chimney smoke, the rain cloud, fireflies |
| `water.ts` | A lake: height-field wave simulation with reflecting shores on a level plane that follows gravity and acceleration in the whale's frame (slosh), spilling over the rim, draining through outlets, refilling. Shader: depth colour, shore and crest foam, caustics, sky reflection, sun glint. Also ice and lava |
| `fauna.ts` | Birds that wheel, scatter and roost at night; grazers (deer, camels, penguins, foxes, crabs, frogs…) that wander and bolt; fish that circle and jump |
| `props.ts` | Low-poly vertex-coloured prop generators (trees, shrubs, rocks, landmarks, boats, lanterns, animals) |
| `effects.ts` | The environment uniforms the generated materials read, soft point puffs (mist, spray, smoke, rain, cloud, sparks), ribbons (waterfalls, vapour trails) |
| `skin.ts` | Procedural skin over the painted texture, in the whale's rest space: individual tint and countershading, mottling, pale patches, rake scars, barnacle clusters, moss creeping from the island |
| `sky-whale.ts` | `SkyWhale`: the controller shared by the viewer and the world. Measures the whale's linear and angular acceleration and gravity in its own frame and feeds the body reaction clips and the ecosystem |
| `viewer.ts` | The `/whales/` page |

Two levels of detail, same seed, same island:
- **full** (viewer; the two whales nearest the camera in the world): instanced props with physics, live lakes, all fauna. About 0.7 ms of simulation per frame.
- **cheap** (far whales, phones): the island merged into one skinned mesh with thinner planting, lakes that only tilt, a few birds.

The world cross-fades between them with a screen-door dither (`src/whales-world.ts`).

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
| `scripts/web.ts`, `export_web.py`, `make_manifest.py`, `web_bodies.ts` | Web copies for the site → `public/assets/whales/`: `<sp>_A.glb` (world near + viewer), `<sp>_B.glb` (viewer), `<sp>_lite.glb` (far whales, phones: ~4.5k-tri body, 512 px texture), all meshopt with KTX2 textures (`scripts/ktx2.ts`), plus `manifest.json`. `web_bodies.ts` strips the baked islands, lake / tree bone tracks and `eco_*` clips, leaving the bodies (about 0.2 to 0.85 MB each): the site generates the ecosystems |
| `out/blend/`, `out/textures/`, `renders/`, `ref/` | Source scenes, textures, final renders, reference renders (**Git LFS**) |
| `index.html` | The `/whales/` viewer page (second Vite entry; code in `src/whales/`) |

## In the site
- **The world** (`src/whales-world.ts`, its own chunk, loaded in idle time after the sky models):
  - **Window view:** today's pod wanders outside the stern windows, weaving between the islands.
  - **Outside / at the helm:** they're giant, and one may swim alongside when you fly near.
  - **Look:** body and island are painted with the sky's shader (plus the normal map, the procedural skin and a wet highlight on the body), and the lakes, falls and mist are lit from the same palette, so everything follows sunset, night and storm: lanterns glow and birds roost at night, it rains in a storm.
  - **Detail:** light bodies with static islands first; the two nearest whales swap to the full body and the simulated island.
  - **Phones:** two whales, static islands, no particles or mist.
  - **Interaction:** click one for a card linking to that seed in the viewer (the click also startles its island); the island's animals notice the camera when it is close.
  - **Sound:** whale calls in the sound engine.
- **The viewer:** `/whales/` (this folder's `index.html`, code in `src/whales/`). It's also the **Sky Whales** cartridge in the map chest (`content/sky-whales.md`), which plays inside the KANAT·1 handheld via `?embed=1`.

## Rebuild
```bash
bun run whales                     # all 12 -> whales/out
bun whales/scripts/web.ts          # web copies (bodies only) + manifest -> public/assets/whales
whales/scripts/render_all.sh       # stills + MP4s -> whales/renders
```
Blender 5.3 at `/Applications/Blender.app` (its bundled numpy and openvdb are used).

## GLB contract (web copies)
- Orientation: nose +Z, up +Y, whale's left +X. Length is in metre-like units (`userData.whale.length`).
- Mesh: `Whale_Body` (colour + normal map; material extras `role: body`, `toon: 1` for style B). The masters in `out/glb/` still carry the hand-planned islands (`Whale_Island`, `Whale_Water`, `Whale_Falls`, `Whale_Ice`).
- Bones:
  - spine chain: `root, chest, neck, head, spine_1..3, tail_1..5`;
  - fluke: `fluke, fluke_L/R_1..2`;
  - flippers: `fin_L/R_1..5` (shoulder to tip);
  - other: `breath`, `blowhole` (`tree_NN_a/b` and `water_N` remain in the skeleton, unused).
- Clips:
  - `cruise`: 8 s seamless loop: two vertical fluke strokes with a travelling wave down the spine, flippers sculling with a bend wave and a feathering twist, fluke blades flexing behind the stroke, one breath;
  - `rest`: the bind pose;
  - `body_*`: static reaction poses for `bankL`, `bankR`, `climb`, `dive` and `accel`, made additive at runtime and driven by critically damped springs.
- Scene extras `whale` (JSON): species, style, length, `island` (the footprint on the back: centre, half length, half width), `spoutEvery`.
