# Sky Whales v2: realism plan

Goals from your feedback:
- The ecosystem looks pasted on; it should grow out of the whale.
- Fins and fluke are too small and mechanical, with hard junctions.
- Heads don't match the real species: face, mouth line, eyes, chin, head shape.

Budget: up to about 60k triangles and 2 MB per GLB. Anatomy should be faithful to the real animals.

**Decisions (interview 2):**
- **Style B:** the same faithful anatomy as A; it differs only in painterly rendering and palette.
- **Islands:** mostly grown-in, with 1–3 mossy rocky outcrops.
- **Checkpoint:** a review after the blue whale (both styles).
- **Species targets:** no extra notes; follow the table below.

## 1. Why v1 looks mechanical
- **Body:** one lofted tube with symmetric superellipse cross-sections. There's no lower jaw, no lip, no rostrum ridge, no splashguard and no neck crease, and the mouth is only a painted line.
- **Fins and fluke:** separate flat lofts pushed into the body. There's no shoulder or armpit fillet and no tail-stock (peduncle) transition. Each fin has 3 rigid bones, each fluke tip 1.
- **Island:** a raised plateau with a vertical cliff skirt all the way round. There's a hard ring where it meets the skin, and nothing of the ecosystem reaches beyond the footprint.
- **Skin:** colour only. No normal map, so pleats, wrinkles, tubercles and scars are flat paint.

## 2. New body pipeline (all species)
1. **Anatomical parts:**
   - **All species:** a cranium/trunk loft, an upper jaw (rostrum), a separate lower jaw loft with its own cross-sections, pectoral flippers with species planforms and real airfoil sections, and a laterally compressed peduncle with dorsal and ventral keels.
   - **Some species:** a fluke grown out of the peduncle, plus melon, spermaceti box, blowhole bulge or splashguard, and dorsal fin, hump or ridge where the species has them.
2. **Fuse the parts** with a voxel remesh, which gives smooth organic fillets at every junction (fin armpits, the fluke and peduncle, the jaw hinge). Then a light relax smooth, and a decimate to about 28–34k triangles for the body.
3. **Carve the mouth** as real geometry after the fuse: a groove that follows the species mouth curve, with an overhanging upper lip and the lower lip tucked under or bulging out per species, ending just under the eye.
4. **Re-project UVs** analytically: a cylindrical body map, plus fin and fluke islands transferred from the source parts.
5. **Rebuild weights** from part IDs and analytic falloffs. Flippers get 4 bones each and the fluke 5 (centre plus 2 per side), with soft gradient weights so they bend like tissue. The peduncle gets one extra flex bone.
6. **Skin maps:** colour (2048²) plus a normal map (2048²) generated from a height field. The height field covers ventral pleats, sperm whale prune wrinkles, humpback tubercles, scars, rake marks, barnacles, bowhead chin-hair spots and crease lines.

## 3. Species anatomy targets (from research)
| Species | Head and face | Flippers | Fluke and tail | Marks |
|---|---|---|---|---|
| **Blue** | Broad, flat, U-shaped rostrum from above; short median ridge ending at a large splashguard around the blowholes; lower jaw bows out wider than the upper; gently curved mouthline rising slightly to an eye just above and behind the mouth corner | Slender and pointed, ~12–15% of L | Broad triangular fluke, ~25% of L, shallow notch; small dorsal fin far back (~75% of L) | Mottled blue-grey; pleats from chin to navel (~50% of L) |
| **Sperm** | Huge box-shaped head ~⅓ of L, blunt square front (spermaceti); narrow rod-like lower jaw set back under the head, mouth on the underside; S-shaped blowhole at the front left; eye far back above the jaw angle | Short, broad, rounded paddles (~9% of L) | Very wide triangular fluke with straight trailing edges and a deep notch; dorsal hump at ⅔ followed by knuckles | Prune-wrinkled skin behind the head; white lips and mouth lining |
| **Beluga** | Bulbous, soft melon; short broad beak with lips and an upturned "smile"; visible neck crease (flexible neck); small eye above the mouth corner | Small broad paddles with tips curling up | Fluke with a convex trailing edge; dorsal ridge instead of a fin | White with faint grey; nicks on the ridge |
| **Humpback** | Flat rostrum covered in knob rows (tubercles), with knobs on the lower lip and a chin knob; lower jaw protrudes; no median ridge | Very long white flippers, ~⅓ of L, with a scalloped leading edge | Large fluke with a serrated trailing edge and an individual black-and-white underside pattern; small dorsal on a hump | Fewer, wider pleats; white belly patches |
| **Bowhead** | Head ~⅓ of L; strongly bowed mouthline; upper jaw arched and narrow from above; huge lower lips form most of the head side; muscular blowhole bulge with a dip behind it; eye just above the mouth corner | Short, broad paddles with blunt tips | Very wide fluke with pointed tips; no dorsal fin | White chin patch with dark spots; white peduncle band |
| **Minke** | Narrow, pointed, triangular rostrum with a single sharp median ridge; mouthline curves up behind the eye | Slim and pointed (~12% of L) with a white diagonal band | Pointed fluke, moderate notch; tall falcate dorsal fin at ~⅔ of L | Pale chevrons on the flanks |

## 4. Ecosystem that grows out of the whale
- **Profile:** lower and flatter. Soil depth tapers to zero at the edges and the base follows the curve of the back.
- **Edge mantle instead of a cliff ring:**
  - The outer band of terrain drapes onto the skin, offset 1–2 cm, with an irregular fingered outline (moss tongues, soil runs). There's no visible seam.
  - Cliffs survive only as a few rocky outcrops (at the waterfall lips and one feature rock) whose bases are buried in moss and rubble.
- **Spill-over details**, in vertex colours, skinned to the spine:
  - roots and vines gripping down the flanks;
  - moss drips and barnacle and rock clusters;
  - small plants thinning out past the footprint;
  - algae and wet streaks under the waterfalls.
- **Matching skin paint:** under and around the island the skin gets soil, moss, algae and water-stain tones in the island's palette, so colour changes continuously. The normal map adds roughness and creases at the junction.
- **Waterfalls:** they hug the skin, flowing over the flank like the reference, and end in mist and wet staining.
- **Better vegetation:**
  - more natural canopies, with more blobs, varied sizes and trunk flare;
  - terrain darkened by ambient occlusion under the canopy;
  - denser ground cover;
  - a carved stream channel from each lake to its falls.

## 5. Style A vs B with faithful anatomy
Both styles use the species-true anatomy above. B differs in rendering (cel shading, ink outline, painted posterised textures) and in palette. Whether B keeps its proportion exaggeration is a question for you.

## 6. Verification
For every whale:
- orthographic side, top and front renders, plus a ¾ face close-up;
- a proportion checklist measured from the mesh: head length, flipper and fluke ratios, eye position against the mouth corner, and dorsal position;
- the reaction and cruise checks re-run in the viewer.

Then the full renders, MP4s and contact sheets.

## 7. Order of work
1. Body pipeline plus blue whale (both styles), then a review gate with face close-ups.
2. The other five species.
3. Ecosystem blend for all six.
4. Normal maps, renders, viewer re-check.
