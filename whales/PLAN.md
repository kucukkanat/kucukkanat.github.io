# Sky whales in the airship world: plan

Move the six sky whales (both styles, build sources, renders) into this repo. Make them wander the world outside the airship, and keep the whale viewer as its own page and as a playable cartridge.

## Decisions (interview, 2026-11-21)
| Topic | Decision |
|---|---|
| Where they appear | Outside the cabin windows, around the galleon in Outside/orbit and Take-the-helm, and occasionally close enough to click |
| Lineup in the world | All six species, **style A** (stylized-realistic). Style B stays in the viewer. |
| Desktop count | All six at once, distant ones on lighter LODs |
| Phones (lite tier) | One or two low-detail whales (≈ 8–12k tris, small textures, no particles), loaded after the first view |
| Scale | Giant sky-whales: 3–6× the galleon. The outside world is forced-perspective, so "giant" is tuned against the islands. |
| Behaviour | Slow wandering paths with banks, climbs and dives (the ecosystem reactions show). They notice the ship and swim alongside for a while, spout and trail particles (full tier only), and follow the night lantern and storm. |
| Sound | Synthesized whale calls in the existing engine (Ambient/Full modes only), positioned by the nearest whale, no audio files |
| Viewer | `/whales/` as a second Vite entry in TypeScript, using the site's three@0.187 and sharing the controller with the world; **and** a "Sky Whales" cartridge in the chest that plays it inside KANAT·1 |
| Cartridge label | Rendered in Blender (a whale with its island), not generated |
| Heavy files | Git LFS for `.blend` files, textures, renders and videos |
| Git | Commits on `main` per milestone, nothing pushed |

## Repo layout (mirrors `airship/`)
| Path | What |
|---|---|
| `whales/README.md`, `whales/PLAN.md`, `whales/RESEARCH.md` | Docs (the research and anatomy targets move here from the session's `PLAN_v2.md`) |
| `whales/scripts/` | `build_whale2.py`, `whalegen/*`, render, stretch-check, contact-sheet and manifest tools |
| `whales/out/glb/` | The 12 full export GLBs (masters, Draco) |
| `whales/out/blend/`, `whales/out/textures/` | Source scenes and textures (**LFS**) |
| `whales/renders/` | Final turnaround stills, cruise MP4s and contact sheets (**LFS**); work-in-progress renders are dropped |
| `public/assets/whales/` | Web copies, re-encoded with gltf-transform (meshopt + WebP, like the galleon): `<sp>_A.glb` (world near and viewer), `<sp>_B.glb` (viewer), `<sp>_lite.glb` (world far and phones), `manifest.json` |
| `whales/index.html` + `src/whales/` | The viewer page (Vite entry `/whales/`) |
| `src/whales/sky-whale.ts` | The runtime controller (ported from `sky-whale.js`), shared by the viewer and the world |
| `src/whales-world.ts` | The world integration (its own lazy chunk) |
| `content/sky-whales.md`, `public/labels/sky-whales.webp` | The cartridge |

The `.gitattributes` LFS patterns cover only `whales/out/blend/**`, `whales/out/textures/**` and `whales/renders/**` (`*.blend`, `*.png`, `*.mp4`). `public/` assets stay in regular git, so the Pages build never needs LFS.

## Milestones (one commit each). Status 2026-11-21: 1–6 done; the scale, routes and lighting were tuned against screenshots of the window and helm views
1. **Move sources + LFS.**
   - Install git-lfs (Homebrew, with your OK).
   - Copy scripts, masters, final renders and docs into `whales/`.
   - Fix script paths so `bun run whales` rebuilds everything from the repo.
   - Drop the work-in-progress renders.
2. **Web assets + LODs.**
   - Add a lite-LOD path to the generator: decimated body and island, 512 px textures, fewer props, same skeleton and clips.
   - Re-encode with meshopt + WebP (`scripts/compress-glb.ts` style).
   - Write `manifest.json`.
   - Measure sizes and triangle counts.
3. **Viewer page + cartridge.**
   - Port the viewer to TypeScript as the `/whales/` Vite entry, plus `?embed=1` (compact UI) for the handheld.
   - Add `content/sky-whales.md` (playable, url `/whales/?embed=1`).
   - Render the label from Blender.
   - Check it appears on `/plain/` and in search.
4. **Whales in the world** (`src/whales-world.ts`, loaded on idle after the first view, never in the critical path):
   - **Placement:** whales live in the outside-world group, so the helm's banking and sliding moves them with the sky. Their reactions are computed from their own path in that group's space, not from the ship's apparent motion.
   - **Wandering:** steering between the island bands with island avoidance and altitude bands. Window-view routes keep a whale crossing the stern windows every so often.
   - **Notice the ship:** in helm mode, a whale within range turns to swim alongside for 20–40 s, then peels away.
   - **Level of detail:** full GLB near, lite far; mixer updates throttled with distance; the existing quality governor can drop the count.
   - **Interaction:** a raycast proxy per whale opens an HTML info card (species facts from the research, ecosystem, "Open viewer"). There's also a command-palette action.
5. **Night, storm, effects and sound.**
   - Hook into `uNight`/`uStorm`: darker at night, glowing fireflies and lanterns; whales sink lower and lean into the wind in storms.
   - Spouts and trailing particles, full tier only.
   - Synthesized calls in `src/sound/engine.ts`.
6. **Verification + docs.**
   - `bun run build` passes.
   - Check full and lite tiers (`?tier=`), phone emulation, the first-view budget unchanged (no whale bytes before idle), frame time with six whales, night and storm, helm fly-by, cartridge play/eject, `/whales/` and `/plain/`.
   - Update the README table, `SCENE_CONTRACT.md` (whale assets and conventions) and `whales/README.md`.

## Budgets
- **First view:** +0 bytes. The whale chunk and GLBs load after the landing view settles, nearest first.
- **Full tier:** six style A whales, about 4–5 MB streamed progressively, about 30–40 draw calls, no realtime shadows (matching the site).
- **Lite tier:** two lite whales, about 0.6–0.8 MB in total.

## Risks / open points
- **Scale:** forced perspective means the giant scale and the routes will need visual tuning against the islands and window framing. I'll show you screenshots of the window view and helm view before finalising.
- **Lighting:** the outside world is lit to match the baked, painted cabin. The PBR whales may need a tint or light rig to sit in the palette. I'll match against the galleon.
- **LFS quota:** GitHub's free LFS quota is 1 GB of storage and 1 GB of bandwidth a month. The final sources (about 200–300 MB without the work-in-progress renders) fit.
