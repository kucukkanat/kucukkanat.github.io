# Blender stream — NOTES

**Status: physics round done (2026-11-20)** — HT's feedback (design/feedback/6): the left-wall rope that read as a noose is gone → belaying-pin rail with three hanked coils; every free-hanging rope is a skinned `ROPE_*` (bones `ROPE_<name>_i`), hanging blocks are `SWING_*` pivots; sky islands rebuilt (strata, roots, identities); map pin is a figurine with a tintable flag. See "Physics round" below.
Fix round — HT's feedback (design/feedback/1–5): bell hangs on a 3-link chain from an eye bolt; table Lantern rebuilt as a ship's lantern (attached bail, vented cap, cage, see-through amber globe, candle + flame); compass moved off the logbook (table props checked for interpenetration); every rope rebuilt (smooth sections: 12 sides on the visible ropes, 6–10 on thin ceiling lines; procedural 3-strand texture + normal map, catenary spans, stacked floor coil / hanging coil instead of faceted tori, not lightmapped); wall gauges + pipe stub replaced by one bulkhead `Clock` with animatable hands; ceiling lamp is the swingable `Hanging_lamp` group; re-baked.
Earlier: polish round (Letter, Portrait, Bottle, Tengwar_note, Slate, Bell, Rope_fg, busier ceiling, VP_portrait/VP_letter). All earlier node names/anchors unchanged (STATIC_rope_fg is now the non-lightmapped `Rope_fg_mesh`).

Rebuild everything: `bun run blender` (~1.5 min on M4 Pro / Metal).
Options: `Blender --background --python blender/build.py -- --only cabin,collectibles,sky --no-bake --preview --samples 256 --views overview,chest,handheld,table,rack,shelf,screen,portrait,letter --prefix preview --assets <dir>`
Extra close-up cameras (no VP_ node, preview only): bell, lantern, clock, rope, tablefix, lamp, leftwall, coils (`kit/preview.py` FIX_CAMS), e.g. `--views bell,clock --prefix fix`.
(`--assets` writes the glb/lightmaps elsewhere — use it with `--no-bake` for iterations so the running dev server never sees a glb that doesn't match the shipped lightmaps; it still re-saves blender/out/cabin.blend.)
Code: `blender/build.py` + `blender/kit/` (authored in three.js coords; `util.T()` converts). Polish-round props live in `blender/kit/polish.py`, fix-round pieces (rope helpers + texture, clock, hanging lamp, lantern) in `blender/kit/fix.py` (placements as constants at the top of each). Textures: downscaled/tinted copies in `blender/tex/`, embedded in the glb as WebP (EXT_texture_webp).
Tools: `python3 blender/inspect_glb.py <glb>` (node dump), `python3 blender/check_uvs.py <glb>` (label/screen UV ranges),
`Blender --background blender/out/cabin.blend --python blender/check_lightmap.py -- sunset|night overview,table` (base colour × lightmap only),
`Blender --background --python blender/preview_glb.py -- public/assets/sky.glb out.png` (lineup).

## Outputs
| File | Size | Notes |
|---|---|---|
| cabin.glb | 2,495,420 B raw → 1,216,736 B meshopt | 39.6k tris, 8 STATIC_* meshes with TEXCOORD_1, 7 skins (budget ≤ 2.5 MB raw: at the limit) |
| collectibles.glb | 156,952 B | 5 templates (+ `Island_flag` child), label UVs 0..1 on TEXCOORD_0 |
| sky.glb | 320,360 B | 4 islands (vertex colours, no normals → flat) + airship, 5.6k tris |
| lightmap_sunset.webp | ~293 KB | 2048², scale 3.0 |
| lightmap_night.webp | ~260 KB | 2048², scale 1.0 |
| lightmaps.json | — | per-map scale + suggested lightMapIntensity (scale·π) |

Lightmap encoding: see docs/SCENE_CONTRACT.md "Lightmap encoding" (added by this stream). Load with `flipY=false`, `channel=1`, sRGB.

## Conventions
- Groups (empties with mesh children): `Handheld` (pitch −25°, leans back; origin = body centre), `Lantern` (origin on table), `Wheel` (origin at hub, identity rotation, faces +Z).
- `Handheld_slot` child of Handheld, local +Y out of the slot. `Handheld_screen` material `Screen`, UV 0..1. VP_screen: screen fills ~94% of a 16:9 frame at 50° vFOV.
- `HIT_*`: boxes, material `Hit` (alpha 0); chest/shelf/rack/handheld ones rotated with their furniture.
- `SLOT_*`: yaw only (chest/shelf +42°, rack −43°). `SLOT_cards` = base centre of the top-left card. `SLOT_map` identity.
- `Window_glass`: one mesh, 5 panes, material `Glass`.
- Anything the app moves/rotates is an **empty** (meshopt quantisation rewrites mesh-node transforms on compress).
- Polish props (groups = empties, mesh children in group-local coords, not lightmapped unless noted):
  - `Letter` (0.27, 0.853, 0.205), yaw −12°: `Letter_paper` (LetterPaper, 0.17×0.115 m, front face UV 0..1, v=1 toward the windows; back face mirrored UVs), `Letter_seal` (WaxSeal). `HIT_letter` top at y 0.925 (above HIT_table's 0.9).
  - `Portrait` = canvas centre (2.411, 2.303, −1.586), above the rack, tilted forward 5° (yaw −43°, pitch 5°): `Portrait_canvas` (PortraitCanvas, 0.32×0.40 m = 4:5, UV 0..1, faces +Z). Gilt frame (0.43×0.51 m outer), cords and nail are in STATIC_props (lightmapped).
  - `Bottle` (1.471, 0.990, −2.154) lying on the sill right of the wheel, along local X (neck +X): `Bottle_glass` (BottleGlass), `Bottle_note` (Parchment + twine), `Bottle_cork` (Cork). ~0.24 m long.
  - `Tengwar_note` (−2.888, 1.6, −1.137) on the stern wall left of the bookshelf, faces into the room: `Tengwar_paper` (TengwarPaper, 0.18×0.12 m = 3:2, UV 0..1, bottom corners curl), `Tengwar_tack` (Brass).
  - `Slate` = board centre (−1.967, 0.995, −1.603), on the chest top leaning 18° back against the leather box (chest yaw): `Slate_board` (SlateBoard, 0.20×0.15 m = 4:3, UV 0..1), `Slate_frame` (Mahogany + chalk stub).
  - `Bell` = pivot (−1.226, 2.035, −2.061) on a brass bracket (STATIC_props) on the window post at −18°; local +X runs along the bracket arm → swing about local X. `Bell_body` (Brass, mouth Ø 0.16 m, 0.21 m tall), `Bell_clapper` = empty at the clapper pivot (5 cm below), mesh `Bell_clapper_mesh` (iron clapper + rope lanyard to ~0.35 m below the pivot).
  - `Rope_fg` empty (−0.62, 0, 1.55) with child `Rope_fg_mesh` (NOT lightmapped — see Ropes below): ceiling block, standing part straight down into a 3-turn stacked coil on the floor (centre ≈ (−0.58, 0, 1.62), Ø 0.4 m), thinner rope with a stopper knot + whipped end at x −0.86; left edge of VP_overview, ≥0.3 m off the overview→chest/shelf camera paths.
  - `STATIC_ceiling`: extra stern beam at z −1.25, carlins, knees, furled sail (Sailcloth), two pulley blocks, a brass cleat on the face of the +30° window post (moved off the wall for the clock), the hanging lamp's canopy + eye bolt. Its ropes are in `Rigging`.
- Fix round (see docs/SCENE_CONTRACT.md "Fix round additions"):
  - `Bell`: pivot unchanged (−1.226, 2.035, −2.061) = the bottom of a brass eye bolt under the bracket arm (eye in STATIC_props). Children: `Bell_chain` (3 links, alternating planes, swings with the bell), `Bell_body` (lowered 79 mm, crown loop hooks link 3), `Bell_clapper` empty now at local y −0.129. HIT_bell grown to 0.45 m tall.
  - `Lantern` (same position/footprint Ø 0.155, 0.35 m tall incl. bail): `Lantern_body` = stepped base, candle (Candle) + flame (LanternFlame, emissive 8), collars, 4 bowed guard wires + 2 rings, vented dome, chimney + hat on posts, bail handle pivoting in lugs on both sides. `Lantern_glass` = open fresnel-ribbed globe, LanternGlow (amber, alpha 0.5 → BLEND, emissive). `Lantern_light` at local y 0.155 (flame).
  - Table: COMPASS_POS (0.5, 0.85, −0.13) (was z 0.1, it sat on the logbook); logbook (0.58, _, 0.12) yaw −12 (was crossing the front rim), pencil lies on its cover; chart roll x −0.52 (was crossing the left rim). BVH check: no two table props interpenetrate (only contact with the map/top).
  - `Clock` group = dial centre (1.963, 1.800, −1.943), on the curved wall at +33.7° between the +30° window post and the rack, yaw −33.7° (local +Z = dial normal into the room). Ø 0.248 m porthole case (bevelled bezel, 6 slotted screws, hinge lug + dog knob) on a 0.27×0.30 m mahogany plaque with 4 screws — case/plaque/screws are in STATIC_props (lightmapped). Children: `Clock_face` (cream ClockDial disc Ø 0.198 + ClockInk minute track + serif Roman numerals as flat quads, not lightmapped), `Clock_hour` / `Clock_minute` / `Clock_second` empties at the dial centre, identity rotation (rest = 12 = local +Y), meshes `Clock_*_mesh` (ClockHand blued steel; second hand ClockRed with round counterweight + brass cap) at z 1.6/3.4/5.2 mm. `HIT_clock` 0.28×0.31×0.09 m.
  - `Hanging_lamp` group = hanging point (0.75, 2.79, −0.35) just under the −0.35 beam (canopy + eye bolt stay in STATIC_ceiling). Children `Hanging_lamp_body` (top link through the eye, rod, brass lamp) + `Hanging_lamp_glass` (LampGlass). Not lightmapped; unlit.
  - Ropes: `fix.rope()` = Catmull-Rom path, parallel-transport frames, smooth shading, u around (0..1), v = length / (3.4 × diameter) → `Rope` material is a procedural 3-strand texture (blender/tex/rope_strands_256.png) + normal map (rope_strands_n_128.png) whose strands run diagonally (one tile = one lay). Closed loops get a whole number of lays and their frame twist distributed. Spans use `catenary()` sag. All ropes except the portrait cords live in non-lightmapped meshes (`Rope_fg_mesh`, `Rigging`) so the app lights them with normals (baked rope looked faceted). `Rigging` = sail lashings, pulley falls (stopper knot, whipping, run to the post cleat with sag), rope bights, left-wall rope + horn cleat (cleat in STATIC_props) + sailor's hanging coil. The two floor coils in the front-left corner were removed (no viewpoint sees that corner).
  - Wall gauges + the pipe stub between them: removed.
  - util: untextured materials now get zero UVs and Brass/Gilt a seamless position-based UV (fewer split vertices — that is what keeps cabin.glb ≤ 2.5 MB). Cloth texture 512 → 256.
- VP_portrait: ~1.1 m in front of the portrait, looking up ~17°, frame ≈50% of the frame height. VP_letter: 0.27 m from the letter at 62° down; the letter is ~40% of the frame width.
- Previews instance the templates at the anchors (blender/kit/preview.py `populate`) the way the app should.

## Previews (blender/out/)
Fix round: fix_{overview,tablefix,bell,lantern,clock,rope,lamp,leftwall}.png (from the baked cabin.blend, collectibles populated).
preview_{overview,chest,handheld,table,rack,shelf,screen,portrait,letter}.png (Cycles, sunset rig; previews show public/assets/portrait.webp on the canvas), lmcheck_{sunset,night}_*.png (base × lightmap only; lines up, no seams seen), preview_sky.png, preview_collectibles.png.


## Physics round (2026-11-20) — see docs/SCENE_CONTRACT.md "Physics round additions"
Code: `blender/kit/phys.py` (skinned ropes, swing groups, pin rail + hanks), `blender/kit/islands.py` (island body/props shared by sky + map pin), `blender/phys_preview.py` (previews).

**Left wall**: the old rope (ceiling bracket → horn cleat → hanging coil) read as a noose and is removed (cleat + bracket too). In its place a belaying-pin rail (STATIC_props, lightmapped): DarkWood rail 0.68 m centred (−2.91, 1.5, −0.45) on two knee brackets, three turned Mahogany pins at z −0.685 / −0.45 / −0.215. Hanks hung flat on the pins (static, in `Rigging`, not lightmapped): 6 / 5 / 6 round-oval loops (Ø 0.25 / 0.20 / 0.24 m), loop tops gathered round the pin necks, no loose ends, no wraps.
Noose audit: no rope anywhere forms a single loop with wraps. Remaining loops: hanks (multi-loop coils), sail lashings (around the sail bundle), the 3-loop stopper-knot lump on ROPE_fg_tail, chain links, the floor coil.

**Swinging ropes** (skinned, armature object `Rig_<name>` at the top end, mesh `ROPE_<name>` child of it, bones `ROPE_<name>_0..N-1`, bone 0 at the top; weights blend linearly between neighbouring bone heads along the arc length; material `Rope`, not lightmapped). Positions three.js world:

| Rope | top (bone 0) | end | length | bones | pinned_end |
|---|---|---|---|---|---|
| `ROPE_fg_main` (foreground, block → floor coil) | (−0.730, 2.710, 1.508) | (−0.750, 0.149, 1.632) at the coil | 2.65 m | 12 | 1 |
| `ROPE_fg_tail` (thin, stopper knot at y 1.235, free end) | (−0.860, 2.970, 1.520) | (−0.864, 0.990, 1.590) | 1.98 m | 10 | 0 |
| `ROPE_pulley_fall` (from SWING_pulley's sheave, knot + free end) | (1.555, 2.550, −1.250) | (1.559, 1.930, −1.239) | 0.62 m | 6 | 0 |
| `ROPE_pulley_span` (sheave → cleat on the 30° post) | (1.645, 2.530, −1.250) | (1.732, 2.380, −2.001) | 0.79 m | 10 | 1 |
| `ROPE_cleat_tail` (end hanging off the cleat) | (1.750, 2.320, −1.991) | (1.743, 2.120, −1.995) | 0.20 m | 6 | 0 |
| `ROPE_bight_a` (left block → stern beam, sag 0.32) | (−0.400, 2.800, −0.380) | (−0.400, 2.820, −1.170) | 1.06 m | 8 | 1 |
| `ROPE_bight_b` (sag 0.22) | (−0.250, 2.800, −0.360) | (−0.120, 2.820, −1.170) | 0.96 m | 8 | 1 |

Pinned spans: the last bone's head sits exactly on the tie point (its tail extends half a bone past it). Free ropes: heads at L·i/N, the last bone runs to the end. `pinned_end` is a custom property on the mesh object → glTF node extras → `userData.pinned_end`. Checked: 7 skins survive `gltf-transform meshopt` (it rewrites the IBMs, not the node transforms), joint names `ROPE_<name>_<i>`, validator 0 errors. Static rope that stays: Rope_fg_mesh (floor coil + ceiling plate/ring), Rigging (sail lashings, cleat wraps, hanks), Bell_clapper lanyard, portrait cords.

**Swing pivots** (empty at the hanging point, custom props `length` m pivot→centre of mass and `mass` kg as extras; children named without the SWING_ prefix):
| Node | pivot | length | mass | child |
|---|---|---|---|---|
| `SWING_pulley` | (1.600, 2.774, −1.250), inside the ceiling ring (ring + plate stay in STATIC_ceiling) | 0.20 | 3.0 | `Pulley_block` (link, shank, block, sheave, straps) |
| `SWING_fg_block` | (−0.730, 2.950, 1.508), under the ceiling plate eye (Rope_fg_mesh) | 0.16 | 2.5 | `Fg_block` |
| `Hanging_lamp`, `Bell`, `Bell_clapper` | unchanged | | | |
The sail bundle and its lashings stay static (lashed to the beam). No nets/bundles on lines exist.

**Sky islands** (`SKY_island_1..4`, origins unchanged at the grass top centre): `islands.Island` body = domed grass cap with a soft bevelled rim and a drippy lip, soil underside, three rock strata (sand / mid / dark, small outward ledges between layers) tapering to a point, hanging roots and vines. One material `SkyIsland` per island with per-corner vertex colours (palette in sky.py, per-face ±7% jitter). After export `export.flat_unindexed_normals()` drops NORMAL and welds the island vertices (three.js computes flat normals = the faceted look; ~1/3 the size). 1: windmill + cottage + orchard + fence (1282 tris); 2: waterfall from a pond spilling off the rim into mist (1009); 3: crooked red/white lighthouse, two cottages, path, trees (1681); 4: wild — pines, boulders, long roots (843).

**Map pin** (`TPL_island` in collectibles.glb, origin at the base centre, front +Z, 0.07 m wide, 0.04 m to the grass): bevelled grass top (Grass/GrassDark), pine + round tree (Leaves/Wood), pebbles, tufts, flag pole (Wood) and a waving pennant `Island_flag` (child mesh, own material `IslandFlag`, default red, two-sided, 20 tris), layered rock Rock (top band; the app tints it) / RockMid / RockDark down to a flat foot (Ø ≈ 0.03 m). 501 tris.

**Budget notes**: to fit the skins under 2.5 MB raw, STATIC_props/table/chest/rack now smooth at 40° (10-sided cylinders were faceted at 36°; now round and welded, −120 KB) and textures are embedded at WebP quality 60 (was 75, −60 KB).

Previews (blender/out/): phys_leftwall.png (rail + hanks), phys_ropes.png (all swinging ropes, red markers = bone heads), phys_sky_islands.png (lineup), phys_map_island.png, phys_overview.png, plus phys_knot.png / phys_pulley.png close-ups.
`Blender --background blender/out/cabin.blend --python blender/phys_preview.py -- cabin public/assets/collectibles.glb leftwall,ropes,map_island,overview [bones]`; sky: `Blender --background --python blender/phys_preview.py -- sky public/assets/sky.glb blender/out/phys_sky_islands.png`.

## Known issues / next
- Sunset lightmap clips (>3.0) on a few sunlit sill/frame pixels (~1%).
- Previews' sky through windows is a placeholder world; the app's backdrop will differ.
- Non-static props (Handheld, Lantern, Wheel, Clock face/hands, Hanging_lamp, Rope_fg_mesh, Rigging, ROPE_*, SWING_*) have no lightmap — app lights them (ropes get no baked shadow/AO).
- cabin.glb raw is right at the 2.5 MB budget (2,495,420 B); anything new needs equal savings elsewhere.
- Skinned ropes' bone 0 is fixed at the modelled top; when SWING_pulley / SWING_fg_block swing, the rope tops do not follow unless the app parents/pins them to the block.
- VP_overview only sees a thin strip of ceiling, so most of the new ceiling work shows from other angles; overview gets the sail bundle, lamp, pulley rope and stern knees at the top edge.
- Compressed cabin.glb grew 1.06 → 1.20 MB, lightmaps +70 KB (more static geometry in the atlas).
- Deco books on the shelf lost their bevels and their gilt bands are now front quads (keeps cabin.glb under 2.5 MB raw).

## cabin.glb — 1188 KB
- `Bell_body` — mesh 956 tris @ (-1.226, 1.853, -2.061) (child of Bell)
- `Bell_chain` — mesh 504 tris @ (-1.226, 1.996, -2.061) (child of Bell)
- `Bell_clapper_mesh` — mesh 216 tris @ (-1.226, 1.780, -2.061) (child of Bell_clapper)
- `Bell_clapper` — empty @ (-1.226, 1.906, -2.061) (child of Bell)
- `Bell` — empty @ (-1.226, 2.035, -2.061)
- `Bottle_cork` — mesh 36 tris @ (1.602, 0.990, -2.124) (child of Bottle)
- `Bottle_glass` — mesh 336 tris @ (1.489, 0.990, -2.150) (child of Bottle)
- `Bottle_note` — mesh 176 tris @ (1.449, 0.971, -2.159) (child of Bottle)
- `Bottle` — empty @ (1.471, 0.990, -2.154)
- `Clock_face` — mesh 620 tris @ (1.964, 1.800, -1.945) (child of Clock)
- `Clock_hour_mesh` — mesh 76 tris @ (1.963, 1.821, -1.941) (child of Clock_hour)
- `Clock_hour` — empty @ (1.963, 1.800, -1.943) (child of Clock)
- `Clock_minute_mesh` — mesh 76 tris @ (1.963, 1.835, -1.940) (child of Clock_minute)
- `Clock_minute` — empty @ (1.963, 1.800, -1.943) (child of Clock)
- `Clock_second_mesh` — mesh 172 tris @ (1.963, 1.831, -1.936) (child of Clock_second)
- `Clock_second` — empty @ (1.963, 1.800, -1.943) (child of Clock)
- `Clock` — empty @ (1.963, 1.800, -1.943)
- `Handheld_body` — mesh 3184 tris @ (0.000, 0.894, 0.089) (child of Handheld)
- `Handheld_screen` — mesh 2 tris @ (0.000, 0.919, 0.137) (child of Handheld)
- `Handheld_slot` — empty @ (0.000, 0.956, 0.097) (child of Handheld)
- `Handheld` — empty @ (0.000, 0.906, 0.120)
- `Hanging_lamp_body` — mesh 736 tris @ (0.750, 2.484, -0.350) (child of Hanging_lamp)
- `Hanging_lamp_glass` — mesh 120 tris @ (0.750, 2.305, -0.350) (child of Hanging_lamp)
- `Hanging_lamp` — empty @ (0.750, 2.790, -0.350)
- `HIT_bell` — mesh 12 tris @ (-1.226, 1.820, -2.061)
- `HIT_bottle` — mesh 12 tris @ (1.490, 0.990, -2.149)
- `HIT_chest` — mesh 12 tris @ (-1.954, 0.600, -1.170)
- `HIT_clock` — mesh 12 tris @ (1.974, 1.800, -1.960)
- `HIT_handheld` — mesh 12 tris @ (0.000, 0.906, 0.120)
- `HIT_lantern` — mesh 12 tris @ (-0.550, 1.022, -0.080)
- `HIT_letter` — mesh 12 tris @ (0.270, 0.888, 0.205)
- `HIT_portrait` — mesh 12 tris @ (2.398, 2.301, -1.571)
- `HIT_rack` — mesh 12 tris @ (2.394, 1.550, -1.567)
- `HIT_shelf` — mesh 12 tris @ (-2.275, 1.620, -1.527)
- `HIT_slate` — mesh 12 tris @ (-1.964, 0.997, -1.600)
- `HIT_table` — mesh 12 tris @ (0.000, 0.870, -0.200)
- `HIT_tengwar` — mesh 12 tris @ (-2.880, 1.600, -1.131)
- `HIT_wheel` — mesh 12 tris @ (0.000, 1.100, -1.900)
- `Lantern_body` — mesh 2026 tris @ (-0.550, 1.025, -0.080) (child of Lantern)
- `Lantern_glass` — mesh 288 tris @ (-0.550, 0.993, -0.080) (child of Lantern)
- `Lantern_light` — empty @ (-0.550, 1.007, -0.080) (child of Lantern)
- `Lantern` — empty @ (-0.550, 0.852, -0.080)
- `Letter_paper` — mesh 128 tris @ (0.270, 0.856, 0.205) (child of Letter)
- `Letter_seal` — mesh 296 tris @ (0.268, 0.857, 0.217) (child of Letter)
- `Letter` — empty @ (0.270, 0.853, 0.205)
- `Portrait_canvas` — mesh 2 tris @ (2.411, 2.303, -1.586) (child of Portrait)
- `Portrait` — empty @ (2.411, 2.303, -1.586)
- `ROPE_bight_a_7` — empty @ (-0.400, 3.523, -0.188) (child of ROPE_bight_a_6)
- `ROPE_bight_a_6` — empty @ (-0.400, 3.373, -0.209) (child of ROPE_bight_a_5)
- `ROPE_bight_a_5` — empty @ (-0.400, 3.228, -0.251) (child of ROPE_bight_a_4)
- `ROPE_bight_a_4` — empty @ (-0.400, 3.097, -0.323) (child of ROPE_bight_a_3)
- `ROPE_bight_a_3` — empty @ (-0.400, 2.969, -0.398) (child of ROPE_bight_a_2)
- `ROPE_bight_a_2` — empty @ (-0.400, 2.826, -0.444) (child of ROPE_bight_a_1)
- `ROPE_bight_a_1` — empty @ (-0.400, 2.677, -0.468) (child of ROPE_bight_a_0)
- `ROPE_bight_a_0` — empty @ (-0.400, 2.800, -0.380) (child of Rig_bight_a)
- `ROPE_bight_a` — mesh 240 tris @ (-0.400, 2.800, -0.380) (child of Rig_bight_a)
- `Rig_bight_a` — empty @ (-0.400, 2.800, -0.380)
- `ROPE_bight_b_7` — empty @ (-0.232, 3.498, -0.257) (child of ROPE_bight_b_6)
- `ROPE_bight_b_6` — empty @ (-0.231, 3.363, -0.279) (child of ROPE_bight_b_5)
- `ROPE_bight_b_5` — empty @ (-0.230, 3.231, -0.312) (child of ROPE_bight_b_4)
- `ROPE_bight_b_4` — empty @ (-0.230, 3.102, -0.355) (child of ROPE_bight_b_3)
- `ROPE_bight_b_3` — empty @ (-0.231, 2.974, -0.400) (child of ROPE_bight_b_2)
- `ROPE_bight_b_2` — empty @ (-0.233, 2.842, -0.435) (child of ROPE_bight_b_1)
- `ROPE_bight_b_1` — empty @ (-0.234, 2.708, -0.460) (child of ROPE_bight_b_0)
- `ROPE_bight_b_0` — empty @ (-0.250, 2.800, -0.360) (child of Rig_bight_b)
- `ROPE_bight_b` — mesh 192 tris @ (-0.250, 2.800, -0.360) (child of Rig_bight_b)
- `Rig_bight_b` — empty @ (-0.250, 2.800, -0.360)
- `ROPE_cleat_tail_5` — empty @ (1.749, 2.421, -1.978) (child of ROPE_cleat_tail_4)
- `ROPE_cleat_tail_4` — empty @ (1.749, 2.387, -1.978) (child of ROPE_cleat_tail_3)
- `ROPE_cleat_tail_3` — empty @ (1.749, 2.354, -1.981) (child of ROPE_cleat_tail_2)
- `ROPE_cleat_tail_2` — empty @ (1.749, 2.320, -1.985) (child of ROPE_cleat_tail_1)
- `ROPE_cleat_tail_1` — empty @ (1.749, 2.287, -1.986) (child of ROPE_cleat_tail_0)
- `ROPE_cleat_tail_0` — empty @ (1.750, 2.320, -1.991) (child of Rig_cleat_tail)
- `ROPE_cleat_tail` — mesh 112 tris @ (1.750, 2.320, -1.991) (child of Rig_cleat_tail)
- `Rig_cleat_tail` — empty @ (1.750, 2.320, -1.991)
- `ROPE_fg_main_11` — empty @ (-0.754, 4.787, 1.390) (child of ROPE_fg_main_10)
- `ROPE_fg_main_10` — empty @ (-0.731, 4.640, 1.512) (child of ROPE_fg_main_9)
- `ROPE_fg_main_9` — empty @ (-0.730, 4.399, 1.509) (child of ROPE_fg_main_8)
- `ROPE_fg_main_8` — empty @ (-0.730, 4.158, 1.508) (child of ROPE_fg_main_7)
- `ROPE_fg_main_7` — empty @ (-0.729, 3.917, 1.508) (child of ROPE_fg_main_6)
- `ROPE_fg_main_6` — empty @ (-0.729, 3.675, 1.508) (child of ROPE_fg_main_5)
- `ROPE_fg_main_5` — empty @ (-0.729, 3.434, 1.508) (child of ROPE_fg_main_4)
- `ROPE_fg_main_4` — empty @ (-0.729, 3.193, 1.508) (child of ROPE_fg_main_3)
- `ROPE_fg_main_3` — empty @ (-0.729, 2.951, 1.508) (child of ROPE_fg_main_2)
- `ROPE_fg_main_2` — empty @ (-0.729, 2.710, 1.508) (child of ROPE_fg_main_1)
- `ROPE_fg_main_1` — empty @ (-0.729, 2.469, 1.508) (child of ROPE_fg_main_0)
- `ROPE_fg_main_0` — empty @ (-0.730, 2.710, 1.508) (child of Rig_fg_main)
- `ROPE_fg_main` — mesh 560 tris @ (-0.730, 2.710, 1.508) (child of Rig_fg_main)
- `Rig_fg_main` — empty @ (-0.730, 2.710, 1.508)
- `ROPE_fg_tail_9` — empty @ (-0.860, 4.357, 1.525) (child of ROPE_fg_tail_8)
- `ROPE_fg_tail_8` — empty @ (-0.861, 4.159, 1.524) (child of ROPE_fg_tail_7)
- `ROPE_fg_tail_7` — empty @ (-0.861, 3.961, 1.524) (child of ROPE_fg_tail_6)
- `ROPE_fg_tail_6` — empty @ (-0.861, 3.763, 1.524) (child of ROPE_fg_tail_5)
- `ROPE_fg_tail_5` — empty @ (-0.860, 3.565, 1.525) (child of ROPE_fg_tail_4)
- `ROPE_fg_tail_4` — empty @ (-0.859, 3.366, 1.526) (child of ROPE_fg_tail_3)
- `ROPE_fg_tail_3` — empty @ (-0.859, 3.168, 1.526) (child of ROPE_fg_tail_2)
- `ROPE_fg_tail_2` — empty @ (-0.859, 2.970, 1.526) (child of ROPE_fg_tail_1)
- `ROPE_fg_tail_1` — empty @ (-0.859, 2.772, 1.526) (child of ROPE_fg_tail_0)
- `ROPE_fg_tail_0` — empty @ (-0.860, 2.970, 1.520) (child of Rig_fg_tail)
- `ROPE_fg_tail` — mesh 724 tris @ (-0.860, 2.970, 1.520) (child of Rig_fg_tail)
- `Rig_fg_tail` — empty @ (-0.860, 2.970, 1.520)
- `ROPE_pulley_fall_5` — empty @ (1.556, 2.860, -1.246) (child of ROPE_pulley_fall_4)
- `ROPE_pulley_fall_4` — empty @ (1.556, 2.757, -1.246) (child of ROPE_pulley_fall_3)
- `ROPE_pulley_fall_3` — empty @ (1.556, 2.653, -1.247) (child of ROPE_pulley_fall_2)
- `ROPE_pulley_fall_2` — empty @ (1.556, 2.550, -1.247) (child of ROPE_pulley_fall_1)
- `ROPE_pulley_fall_1` — empty @ (1.556, 2.447, -1.247) (child of ROPE_pulley_fall_0)
- `ROPE_pulley_fall_0` — empty @ (1.555, 2.550, -1.250) (child of Rig_pulley_fall)
- `ROPE_pulley_fall` — mesh 276 tris @ (1.555, 2.550, -1.250) (child of Rig_pulley_fall)
- `Rig_pulley_fall` — empty @ (1.555, 2.550, -1.250)
- `ROPE_pulley_span_9` — empty @ (1.655, 3.187, -1.265) (child of ROPE_pulley_span_8)
- `ROPE_pulley_span_8` — empty @ (1.655, 3.099, -1.273) (child of ROPE_pulley_span_7)
- `ROPE_pulley_span_7` — empty @ (1.655, 3.012, -1.282) (child of ROPE_pulley_span_6)
- `ROPE_pulley_span_6` — empty @ (1.655, 2.924, -1.290) (child of ROPE_pulley_span_5)
- `ROPE_pulley_span_5` — empty @ (1.654, 2.837, -1.298) (child of ROPE_pulley_span_4)
- `ROPE_pulley_span_4` — empty @ (1.654, 2.749, -1.307) (child of ROPE_pulley_span_3)
- `ROPE_pulley_span_3` — empty @ (1.654, 2.662, -1.313) (child of ROPE_pulley_span_2)
- `ROPE_pulley_span_2` — empty @ (1.654, 2.574, -1.320) (child of ROPE_pulley_span_1)
- `ROPE_pulley_span_1` — empty @ (1.654, 2.486, -1.326) (child of ROPE_pulley_span_0)
- `ROPE_pulley_span_0` — empty @ (1.645, 2.530, -1.250) (child of Rig_pulley_span)
- `ROPE_pulley_span` — mesh 144 tris @ (1.645, 2.530, -1.250) (child of Rig_pulley_span)
- `Rig_pulley_span` — empty @ (1.645, 2.530, -1.250)
- `Rigging` — mesh 3072 tris @ (-0.584, 2.008, -1.047)
- `Rope_fg_mesh` — mesh 1144 tris @ (-0.626, 1.499, 1.618) (child of Rope_fg)
- `Rope_fg` — empty @ (-0.620, 0.000, 1.550)
- `SKY_anchor` — empty @ (0.000, 1.500, -6.000)
- `Slate_board` — mesh 2 tris @ (-1.965, 0.996, -1.601) (child of Slate)
- `Slate_frame` — mesh 236 tris @ (-1.964, 0.996, -1.600) (child of Slate)
- `Slate` — empty @ (-1.967, 0.995, -1.603)
- `SLOT_books` — empty @ (-2.579, 1.690, -1.206)
- `SLOT_cards` — empty @ (2.247, 1.640, -1.696)
- `SLOT_cart_ai` — empty @ (-2.094, 0.770, -0.855)
- `SLOT_cart_games` — empty @ (-2.021, 0.745, -0.773)
- `SLOT_cart_tools` — empty @ (-2.168, 0.795, -0.937)
- `SLOT_map` — empty @ (0.000, 0.852, -0.200)
- `SLOT_notebooks` — empty @ (-2.572, 1.290, -1.199)
- `STATIC_ceiling` — mesh 1296 tris uv1 @ (0.000, 2.637, -0.099)
- `STATIC_chest` — mesh 3556 tris uv1 @ (-2.081, 1.325, -1.307)
- `STATIC_floor` — mesh 120 tris uv1 @ (0.000, -0.060, 0.000)
- `STATIC_props` — mesh 5876 tris uv1 @ (-0.005, 1.343, 0.076)
- `STATIC_rack` — mesh 1450 tris uv1 @ (2.197, 0.957, -1.359)
- `STATIC_shell` — mesh 2592 tris uv1 @ (0.000, 1.560, -0.000)
- `STATIC_table` — mesh 2498 tris uv1 @ (0.000, 0.458, -0.200)
- `STATIC_windows` — mesh 1968 tris uv1 @ (0.000, 1.450, -2.278)
- `Fg_block` — mesh 260 tris @ (-0.730, 2.831, 1.508) (child of SWING_fg_block)
- `SWING_fg_block` — empty @ (-0.730, 2.950, 1.508)
- `Pulley_block` — mesh 452 tris @ (1.600, 2.629, -1.250) (child of SWING_pulley)
- `SWING_pulley` — empty @ (1.600, 2.774, -1.250)
- `Tengwar_paper` — mesh 96 tris @ (-2.884, 1.600, -1.134) (child of Tengwar_note)
- `Tengwar_tack` — mesh 76 tris @ (-2.884, 1.646, -1.137) (child of Tengwar_note)
- `Tengwar_note` — empty @ (-2.888, 1.600, -1.137)
- `VP_chest` — empty @ (-1.036, 1.220, -0.718)
- `VP_chest_T` — empty @ (-2.017, 0.900, -1.180)
- `VP_handheld` — empty @ (0.000, 1.046, 0.480)
- `VP_handheld_T` — empty @ (0.000, 0.896, 0.070)
- `VP_letter` — empty @ (0.244, 1.095, 0.329)
- `VP_letter_T` — empty @ (0.269, 0.853, 0.209)
- `VP_overview` — empty @ (0.000, 1.600, 2.350)
- `VP_overview_T` — empty @ (0.000, 1.120, -1.500)
- `VP_portrait` — empty @ (1.698, 1.980, -0.821)
- `VP_portrait_T` — empty @ (2.411, 2.303, -1.586)
- `VP_rack` — empty @ (1.514, 1.500, -0.624)
- `VP_rack_T` — empty @ (2.435, 1.450, -1.611)
- `VP_screen` — empty @ (0.000, 0.951, 0.206)
- `VP_screen_T` — empty @ (0.000, 0.919, 0.137)
- `VP_shelf` — empty @ (-1.151, 1.620, -0.278)
- `VP_shelf_T` — empty @ (-2.288, 1.550, -1.542)
- `VP_table` — empty @ (0.000, 2.300, 1.000)
- `VP_table_T` — empty @ (0.000, 0.850, -0.300)
- `Wheel_mesh` — mesh 2568 tris @ (0.000, 1.100, -1.900) (child of Wheel)
- `Wheel` — empty @ (0.000, 1.100, -1.900)
- `Window_glass` — mesh 10 tris @ (0.000, 1.750, -2.408)

Total triangles: 39638; materials: Brass, Iron, Rope, Cork, BottleGlass, Parchment, ClockDial, ClockInk, ClockHand, ClockRed, OrangePlastic, BezelPlastic, DarkPlastic, CreamPlastic, Screen, LampGlass, Hit, Candle, LanternFlame, LanternGlow, LetterPaper, WaxSeal, PortraitCanvas, SlateBoard, Mahogany, DarkWood, Chalk, Sailcloth, Leather, BookRed, BookGreen, BookBlue, Glass, Planks, Cloth, Gilt, WallPlanks, SkyMap, GaugeFace, Paper, TengwarPaper
## collectibles.glb — 153 KB
- `TPL_book` — mesh 210 tris @ (0.000, 0.000, 0.000)
- `TPL_cartridge` — mesh 878 tris @ (0.000, 0.000, 0.000)
- `Island_flag` — mesh 20 tris @ (0.000, 0.000, 0.000) (child of TPL_island)
- `TPL_island` — mesh 501 tris @ (0.000, 0.000, 0.000)
- `TPL_memcard` — mesh 1318 tris @ (0.000, 0.000, 0.000)
- `TPL_notebook` — mesh 210 tris @ (0.000, 0.000, 0.000)

Total triangles: 3137; materials: Pages, Cover, SpineLabel, Plastic, Label, IslandFlag, Grass, GrassDark, RockDark, Rock, RockMid, Wood, Leaves, Contacts
## sky.glb — 313 KB
- `SKY_airship` — mesh 792 tris @ (0.000, 0.000, 0.000)
- `SKY_island_1` — mesh 1282 tris @ (0.000, 0.000, 0.000)
- `SKY_island_2` — mesh 1009 tris @ (0.000, 0.000, 0.000)
- `SKY_island_3` — mesh 1681 tris @ (0.000, 0.000, 0.000)
- `SKY_island_4` — mesh 843 tris @ (0.000, 0.000, 0.000)

Total triangles: 5607; materials: SkyBalloon, SkyStripe, SkySail, SkyWood, SkyBrass, SkyWall, SkyRoof, SkyIsland
