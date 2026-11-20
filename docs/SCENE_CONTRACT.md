# Scene contract — Blender ⇄ three.js

The Blender build (`blender/build.py`) and the web app (`src/`) only meet through the names and conventions below. Change this file first if anything here changes.

Units: metres. three.js is Y-up; Blender is Z-up and the glTF exporter converts (Blender +Z → three +Y, Blender −Y → three +Z). Coordinates below are **three.js** coordinates.

## Layout (three.js coordinates)

- Cabin interior roughly x ∈ [−3, 3], y ∈ [0, 3], z ∈ [−2.6, 2.6]. Floor at y = 0.
- Stern windows: the curved far wall at z ≈ −2.6, facing +Z (toward the visitor). Sky is outside, beyond z < −2.6.
- Visitor enters from +Z, overview camera near (0, 1.65, 2.3) looking at the windows.
- Left wall (x ≈ −3): bookshelf above, map chest (open top drawer of cartridges) below/in front.
- Right wall (x ≈ +3): logbook rack (grid of memory cards).
- Chart table centre ≈ (0, 0.85, −0.2), top surface y ≈ 0.85, sky map on it.
- Ship's wheel between table and windows ≈ (0, 1.1, −1.9), facing +Z.
- Lantern on table left; handheld KANAT·1 on table centre-front; compass and spyglass on table right.

## Files

| File | Made by | Content |
|---|---|---|
| `public/assets/cabin.glb` | Blender | Static cabin + props + named nodes below. Draco **off**; meshopt optional. Textures embedded or as `.jpg`/`.webp`. |
| `public/assets/collectibles.glb` | Blender | Templates `TPL_*` (below), each at origin, not in the cabin. |
| `public/assets/sky.glb` | Blender | `SKY_island_1..4`, `SKY_airship` low-poly, each at origin. |
| `public/assets/lightmap_sunset.webp`, `lightmap_night.webp` | Blender | Baked lightmaps for every mesh named `STATIC_*`, laid out in their **second UV map** (glTF `TEXCOORD_1`). |
| `art/textures/*.png` | Art | Tileable painted textures Blender uses (wood, mahogany, brass, parchment, leather, cloth, rope, map). |
| `art/sky/sunset.png`, `art/sky/night.png` | Art | Painted sky backdrops (2:1-ish, no islands), app maps onto a curved backdrop. Copied to `public/assets/sky_*.jpg`. |
| `public/labels/<id>.webp` | Art | Label art per content item (square). Missing → app draws a procedural label. |
| `public/content.json` | `scripts/build-content.ts` | All content items (see `src/types.ts`). |

## Named nodes in `cabin.glb`

Viewpoints — pairs of empties (camera position + look-at target):

| Camera | Target | Purpose |
|---|---|---|
| `VP_overview` | `VP_overview_T` | Landing view of the whole cabin |
| `VP_chest` | `VP_chest_T` | Close on the open chest drawer of cartridges |
| `VP_table` | `VP_table_T` | Looking down at the chart table / sky map |
| `VP_rack` | `VP_rack_T` | Facing the logbook rack |
| `VP_shelf` | `VP_shelf_T` | Facing the bookshelf |
| `VP_handheld` | `VP_handheld_T` | Close on the handheld |
| `VP_screen` | `VP_screen_T` | Very close, screen fills view (fly-in end point) |

Hotspot hit volumes (invisible boxes, material can be anything; app hides them): `HIT_chest`, `HIT_table`, `HIT_rack`, `HIT_shelf`, `HIT_handheld`, `HIT_lantern`, `HIT_wheel`.

Slot anchors (empties). Their local axes define layout; the app instantiates templates relative to them:

| Anchor | Layout |
|---|---|
| `SLOT_cart_games`, `SLOT_cart_ai`, `SLOT_cart_tools` | Three rows in the chest drawer. Items go along the anchor's local **+X**, spacing 0.07 m, standing upright (+Y up), label facing local **+Z**. Max 10 per row. |
| `SLOT_books` | Bookshelf row start. Books along local +X, spine facing +Z, spacing = book thickness + 0.005. Max 14. |
| `SLOT_notebooks` | A second, shorter shelf row (notebooks). Same rules. Max 6. |
| `SLOT_cards` | Top-left of the rack grid. Columns along local +X every 0.13 m, rows along local −Y every 0.15 m, 4 columns, label facing +Z. |
| `SLOT_map` | Centre of the sky map on the table. Map spans local X ∈ [−0.6, 0.6], local Z ∈ [−0.4, 0.4], surface at local Y = 0. Content gives islands normalised `map: {x, y}` in [0,1] (x → right, y → toward the windows). |

Interactive objects:

| Name | Notes |
|---|---|
| `Handheld` | Group. Orange KANAT·1, landscape, chunky; d-pad left, 3 square cream buttons right. |
| `Handheld_screen` | Mesh, own material named `Screen`, UV 0..1 covering the screen exactly (app replaces its texture). |
| `Handheld_slot` | Empty at the cartridge slot on top; local +Y points out of the slot. |
| `Lantern` | Group; `Lantern_glass` mesh with material `LanternGlow` (emissive). |
| `Lantern_light` | Empty where the app puts a point light. |
| `Wheel` | Group with origin at the hub; app spins it around the world **Z** axis. |
| `Window_glass` | Mesh(es), app makes them slightly transparent. |
| `SKY_anchor` | Empty outside the windows (≈ z −6) where the app centres the sky backdrop. |

Static meshes that receive the baked lightmap are named `STATIC_*` (e.g. `STATIC_shell`, `STATIC_table`). Keep them few (≤ 12) and join where possible.

## Templates in `collectibles.glb`

All at origin, base on y = 0, facing +Z.

| Name | Size (approx.) | Materials |
|---|---|---|
| `TPL_cartridge` | 0.06 w × 0.075 h × 0.012 d | `Plastic` (app tints `color`), `Label` (front face, UV 0..1, app sets map) |
| `TPL_book` | 0.035 thick × 0.24 h × 0.17 deep | `Cover` (tint), `Pages`, `SpineLabel` (spine, UV 0..1) |
| `TPL_notebook` | 0.02 × 0.21 × 0.15 | `Cover` (tint), `Pages`, `SpineLabel` |
| `TPL_memcard` | 0.10 w × 0.12 h × 0.008 d | `Plastic` (tint), `Label` (UV 0..1), `Contacts` (gold) |
| `TPL_island` | ~0.07 wide floating islet | `Rock`, `Grass` — map pin for a job |

## Lightmap encoding (added by the Blender stream)

- Both lightmaps share one atlas laid out in `TEXCOORD_1` of every `STATIC_*` mesh (glTF UV convention: load with `texture.flipY = false`, `texture.channel = 1`).
- They store baked **lighting only** (Cycles diffuse direct + indirect, no albedo): `stored = sRGB(clamp(L / scale, 0, 1))`, where `L` is the linear factor such that final colour = base colour × L. Scales are normalised so a well-lit surface is near white: **sunset 3.0, night 1.0**, also written to `public/assets/lightmaps.json` (`{sunset: {file, scale, lightMapIntensity}, night: {...}}`).
- three.js: `tex.colorSpace = SRGBColorSpace`, `material.lightMap = tex`, `material.lightMapIntensity = scale * Math.PI` for a physically matching result (three's Standard and Basic materials divide lightmap irradiance by π). When cross-fading, blend `intensity` too (or the app may simply use its own auto-exposure).
- Non-static meshes (`Handheld*`, `Lantern*`, `Wheel*`, `Window_glass`) have no lightmap and need the app's own lights (or a flat ambient).

## Sizes/budgets

- `cabin.glb` ≤ 2.5 MB, `collectibles.glb` ≤ 300 KB, `sky.glb` ≤ 300 KB, each lightmap ≤ 600 KB (2048² webp).
- Total triangles in view ≤ 150k.

## Polish round additions (2026-11-20)

New props in `cabin.glb` (each with a `HIT_*` box; lightmap them if static):

| Name | Where (three.js) | Notes |
|---|---|---|
| `Letter` (+ `HIT_letter`) | On the chart table, front-right of the handheld | A folded letter with a wax seal. Mesh `Letter_paper` material `LetterPaper` (UV 0..1 over the visible face). Not static (the app lifts it). |
| `Portrait` (+ `HIT_portrait`) | Above the logbook rack: frame bottom at ~2.05 m, canvas centre (2.41, 2.30, −1.59), tilted forward 5° (built: the rack top is at 1.92 m, so ~1.9 m would overlap it) | Gilded frame `STATIC_`-joinable; canvas mesh `Portrait_canvas` with material `PortraitCanvas`, UV 0..1, aspect 4:5 portrait. App sets `/assets/portrait.webp` (placeholder if missing). |
| `Bottle` (+ `HIT_bottle`) | On a small shelf or the window sill near the rack | Glass message bottle with a rolled note inside, cork. Material `BottleGlass` (app makes it transparent). Not static. |
| `Tengwar_note` (+ `HIT_tengwar`) | Pinned to the left wall/beam near the bookshelf, eye height | Paper note, mesh `Tengwar_paper`, material `TengwarPaper`, UV 0..1, landscape 3:2. App draws the text. |
| `Slate` (+ `HIT_slate`) | Leaning on the chest top or hanging by the shelf | Small framed chalk slate, mesh `Slate_board`, material `SlateBoard`, UV 0..1, landscape 4:3. App draws "√−1" in chalk. |
| `Bell` (+ `HIT_bell`) | Brass ship's bell on a bracket near the windows (left or right of the wheel) | Group with origin at the hanging pivot so the app can swing it about local X; `Bell_clapper` child optional. Not static. Built: `Bell_clapper` is an **empty** at the clapper pivot (mesh child `Bell_clapper_mesh`), because meshopt quantisation rewrites mesh-node transforms. |
| `Rope_fg` | Foreground: hanging rope/rigging at the left edge of `VP_overview` (like the concept) | Static decoration. |

New viewpoints: `VP_portrait`/`_T` (facing the portrait), `VP_letter`/`_T` (looking down at the letter on the table).

New art: `public/assets/sky_storm.jpg` (storm backdrop), `public/assets/portrait.webp` (painted portrait, 4:5, ≤150 KB), Tengwar font in `public/fonts/`.

## Fix round additions (2026-11-20)

| Name | Notes |
|---|---|
| `Clock` (+ `HIT_clock`) | One wall clock (replaces the two brass gauges, which are removed). Group facing into the room; dial centre at the group origin. |
| `Clock_hour`, `Clock_minute`, `Clock_second` | Hand groups (empties with mesh children) pivoting at the dial centre. Rest pose = pointing at 12. The app rotates each about the **Clock group's local Z axis** (dial normal, pointing into the room); positive app angle = clockwise as seen by the visitor. |
| `Hanging_lamp` | The ceiling lamp as a group with its origin at the hanging point, so the app can swing it (storm). Not lightmapped. |
| `Bell` | Unchanged pivot; now hangs from the bracket by a visible shackle/chain link. |
| `Lantern` | Unchanged names (`Lantern_body`, `Lantern_glass`/`LanternGlow`, `Lantern_light`); the handle is attached. |

## Physics round additions (2026-11-20)

Hanging things move with the ship (the app simulates them; nothing hanging is in the lightmap).

| Name | Notes |
|---|---|
| `ROPE_<name>` | A rope that can swing: a **skinned mesh** with its own armature. Bones `ROPE_<name>_0 … ROPE_<name>_N` (6–12 bones) run from the fixed top end down the rope, rest pose = hanging as modelled. Bone 0 is pinned. If the rope is tied at both ends (a sagging span), set the custom property `pinned_end = 1` on the mesh object (exported as glTF extras → three.js `userData.pinned_end`); the last bone is then pinned too. Material can be shared. |
| `SWING_<name>` | A rigid hanging object (lamp, pulley block, net, sail bundle on a line): group with its origin at the pivot it hangs from. Optional custom properties `length` (m, pivot → centre of mass) and `mass` (kg). |
| `Bell`, `Bell_clapper`, `Hanging_lamp` | Unchanged; the app treats them as swing pivots (Bell_clapper is a pendulum inside the bell). |

No rope may form a loop that could read as a noose. Hanging rope coils are hung as hanks on belaying pins.

## Look-and-feel round additions (2026-11-20)

- **Palette**: `blender/kit/paint.py` (`PALETTE`, `ACCENT`, `paint()`) is the single colour source for `cabin.glb` and the galleon. Material names are unchanged; new ones: `BookOchre`, `BookPlum`, `BookTeal`, `SkyMapGlobe`.
- **Baked materials get a painted highlight** in the app by material name (`SHEEN` in `src/lighting.ts`: Brass, Gilt, Mahogany, Iron, Glass). Rename a material and it loses its sheen.
- **Dressing** (all inside `STATIC_props` / `STATIC_chest`, no new nodes): telescope, globe, chart basket, coat pegs, hourglass, bookend.
- **`public/assets/galleon.glb`** (full tier, first visit only): the sky galleon, root `Ship`, +X bow. The empty `Cabin_anchor` marks where the cabin sits inside it (cabin origin and axes); the app moves the ship so that anchor lands on the cabin's origin. Joint empties with `extras.joint = 'spin'`, `axis`, `rpm` are spun by the app. ≤ 1.8 MB, meshopt + WebP.
- **Light shafts** (`src/fx.ts`) repeat the window layout and the bake's sun direction as constants: change `layout.py` / `lights.py` and update them there too.
- **Tiers**: `src/tier.ts` (`TIER`, `FULL`).
- **Sky files**: `sky.glb` (both tiers: `SKY_island_1..6`, `SKY_airship`, `SKY_balloon_1..2`, `SKY_clouds` + cloud atlas) and `sky_full.glb` (full tier: `SKY_island_7`, `SKY_rocks_1`, `SKY_airship_2`, `SKY_balloon_3..4`). Written by `blender/kit/sky_pack.py`, not the Blender exporter: int16 positions (`KHR_mesh_quantization`), sRGB byte vertex colours, no normals, vertex alpha 0 = glowing at night. Do not run meshopt on them. Layout and tuning live in `src/sky.ts` (`LAYOUT`, `CLOUDS`, `HAZE_*`, `COLORS`).

## Outside view (2026-11-20)

- The cabin sits inside the galleon: `src/outside.ts` moves the ship so `Cabin_anchor` lands on the cabin's origin and hides the ship's `Gallery_glass*` / `Gallery_frames*` (the cabin's own stern windows show instead). Keep the ship's stern gallery and the cabin's window wall the same shape (five panes, posts every 12 degrees, radius ~3.6 m, sill 0.95 m, top 2.55 m above the cabin floor).
- The camera enters and leaves through the **middle pane** (`WINDOW` in `outside.ts`): nothing may be modelled in that opening, in either file, and the path over the wheel to the landing view must stay clear up to y = 2.0 m.
- `public/assets/galleon_lite.glb` is the phone copy (`airship/export_web.py` writes both). Fetched only when a phone visitor taps Outside.
- Flying never moves the ship or the cabin: the outside world (sky dome, far islands) turns and slides instead. Far islands reuse `sky.glb`'s island meshes.
- `Jacket_patch` / `Patch_filo` (material `SquadronPatch`, UV 0..1): the app draws the squadron patch (`src/patch.ts`), or uses `public/assets/patch.webp` when that file exists.
