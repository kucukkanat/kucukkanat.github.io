# Sky galleon

Exterior model of the airship whose stern cabin is the personal website. Built by script through the Blender MCP bridge.

It shares the cabin interior's painted-diorama style: `tex_process.py` imports the palette and paint filter from `../blender/kit/paint.py` (read only) and takes three source tiles from `../art/textures/`. The site loads the web copy `../public/assets/galleon.glb` for its intro shot.

| Path | What |
|---|---|
| `sky_galleon_preview.html` | Single-file preview. Model, textures and three.js are all inside it, so it opens offline. |
| `out/sky_galleon.glb` | The export: 146 nodes, about 56k triangles, 4.9 MB with textures. |
| `export_web.py` | Meshopt-compressed web copy: `../public/assets/galleon.glb` (1.8 MB). |
| `out/sky_galleon.blend` | The Blender scene of the last build. |
| `kit.py`, `hull.py`, `rig.py`, `mech.py` | Mesh kit; hull, decks, castles, stern gallery; masts, sails, rigging, flags, kite; moving parts. |
| `build.py` | Builds the scene, renders check views, exports. |
| `bl.py` | Runs a script of this folder in a live Blender through the Blender MCP extension's bridge. |
| `gen_textures.py`, `textures.json` | Texture generation through OpenRouter (prompts, spend cap). |
| `tex_process.py`, `tex/`, `tex/src/` | Painted restyle of the source images; game textures and `detail.json`; originals and `cost.json`. |
| `preview/`, `make_html.py` | Preview page source and the script that packs it into one HTML file. |

## Rebuild

Live Blender (MCP bridge started, default `localhost:9876`):

```bash
python3 bl.py build.py "side,quarter;export"
python3 make_html.py
```

Headless: `SHIP_ARGS="quarter,stern;export" Blender --background --python build.py`, then `python3 export_web.py` and `python3 make_html.py`.

The web copy is quantised, which rewrites the transforms of mesh nodes: animate only the joint empties, never a mesh node.

`make_html.py` bundles three.js with `bun` from the site's `node_modules`; without bun it writes a page that loads three.js from a CDN instead.

## Conventions

Blender: +X bow, +Y port, +Z up, metres. Hull 26 m on deck (about 32 m with bowsprit), 8.2 m beam, mainmast truck 23.6 m above the keel.

Every moving part is an empty placed on its hinge or slide axis, with the meshes as children. Custom properties (glTF `extras`, `userData` in three.js):

| prop | meaning |
|---|---|
| `joint` | `hinge`, `slide`, `spin` or `group` |
| `axis` | unit axis in the node's own glTF space |
| `min`, `max` | degrees or metres |
| `sign` | multiply the value by this; mirrored port/starboard twins then share one control |
| `rpm` | idle speed for spinners |
| `drives`, `ratio` | linkage, e.g. helm wheel to rudder |
| `morph` | shape key name on sails (`furl`) |
| `light`, `color`, `intensity` | where to put a point light |
| `label`, `group`, `note` | UI text and what the part is for |

`Cabin_anchor` marks where the site's `cabin.glb` goes: parent it there with an identity transform and its five windows line up with the stern gallery.

## Known gaps

- Braces and sheets are not modelled (they would need to stretch when a yard swings); the skiff falls and anchor cables do not lengthen.
- Flags wave in the preview by moving vertices in JavaScript, not through the model.
- The hull has no interior below the main deck; the hatch opens onto a dark floor.

## Textures and colour

Colours and the brush look come from the cabin's `blender/kit/paint.py` (`PALETTE`, `ACCENT`, `paint()`):

| Material | Palette | Source tile |
|---|---|---|
| `HullWood` | WallPlanks (walnut) | `tex/src/weathered_wood` |
| `HullDark` (wales, caps, window posts and frames) | DarkWood | `art/textures/dark_wood` |
| `Trim` | Mahogany | `art/textures/mahogany` |
| `Deck` | Planks | `tex/src/deck_wood` |
| `Spar` | ramp between Planks and WallPlanks | `tex/src/weathered_wood` |
| `PaintOrange`, `PaintCream` | ramps round ACCENT orange and cream | `tex/src/chipped_paint` |
| `Sail` | Sailcloth | `tex/src/canvas` |
| `Brass`, `Gilt` | Brass, Gilt | `art/textures/brass` |
| `Iron` | ramp round ACCENT iron | `tex/src/wrought_iron` |

`tex_process.py` (headless Blender, no paid calls) paints each tile and stores it in `tex/` as a relative map: painted colour divided by its brightest tone. `tex/detail.json` holds each map's mean and mean painted colour. `kit.py` divides every vertex colour by that mean, so a face in the material's own colour shows the painted palette texture exactly, and stripes or per-plank tints on the same material keep the brush strokes. `tex/check_*.jpg` show the painted colours for review. There are no normal maps, and metals are mostly diffuse (metallic 0.3 to 0.35): the look is flat-lit paint.

Art pieces (falcon sail emblem, falcon flag, KANAT name board, feather frieze) get a small blur, a soft posterise and a pull toward the palette; the emblem's cloth is balanced to the plain sails.

Texture coordinates run continuously along each strake, deck plank, wall row and spar, with a random offset and direction per plank, so the tile does not line up from one plank to the next. Tile sizes are per material in `kit.MATS` (`tile`, metres).

The originals in `tex/src/` were generated through OpenRouter (`gen_textures.py`, prompts in `textures.json`, spend in `tex/src/cost.json`); restyling them does not need it.

Rebuild after changing an image or the palette: `Blender --background --python tex_process.py`, then the build, `export_web.py` and `make_html.py`.
