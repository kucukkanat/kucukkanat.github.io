# kucukkanat.com

The personal site of Hilmi Tolga Şahin (HT): the captain's cabin of an airship at sunset. Projects are game cartridges in a map chest — insert one into the KANAT·1 handheld and it plays. Writing is on the bookshelf, and below deck (down the hatch beside it) is the captain's library, kept by his best friend the Librarian, who fetches a topic's volume when asked. The career is on the logbook rack and drawn as a voyage on the chart table. A plain version lives at `/plain/`.

```bash
bun install
bun run dev        # http://localhost:4380  (rebuilds content first)
bun run build      # dist/ — 3D site + plain version + sitemap, robots, CNAME
```

**On your phone (same Wi-Fi):** [portless](https://github.com/vercel-labs/portless) gives the dev server a stable LAN name.

```bash
bun run lan:proxy  # once per boot: LAN proxy on port 80, plain HTTP, no sudo
bun run lan        # dev server at http://kucukkanat.local (Mac and phone)
```

`.local` names need mDNS on the phone (iOS: yes; Android: Chrome on Android 12+). If a phone can't resolve it, `bunx vite --host` and open the Network URL it prints.

**Getting around** works the same in the cabin, the library and outside:

| | Touch | Mouse / keyboard |
|---|---|---|
| Look around | drag | drag, arrow keys |
| Zoom | pinch | scroll, `+` / `-` |
| Slide (indoors) | two-finger drag | right-drag, shift-drag, shift+arrows |
| Back to the framing | double-tap | double-click, `0` |
| Go somewhere | tap a glowing dot, or a name in the dock | click a dot or the dock, Tab to them |
| Switch place | Cabin · Library · Outside in the dock | the dock, `1` `2` `3` |
| Back | the Back button (it says what it will do), flick down | Back, Esc |

- `src/input.ts`: one gesture layer, used by all three places. The library and outside each run their own copy on their own layer; the cabin's copy passes the keys to them.
- `src/stations.ts`: the glowing dots, like the cabin's hotspots. Library: the Librarian, bookcase, side shelves, reading table, porthole, and the ladder up. Outside: bow, port, starboard, above, and the stern windows back in.
- `src/ui.ts`: the dock and the Back button, the same in every place. The middle row shows that place's viewpoints or stations.
- `src/coach.ts`: a one-time hint with the same words in every place, shown above the dock (or the library's chat).
- **Address:** the station goes in it (`?deck=1&station=table`, `?outside=1&station=bow`), so the browser's Back and Forward walk through stations.
- **Outside:** the ship sails on by herself while you look around. **Take the helm** (or `H`) brings up the stick, the speed slider and the flight keys (A/D or ←/→ turn, W/S or ↑/↓ climb, Q/E speed). Back or Esc leaves the helm before going inside.
- **Reduced motion:** stations cut instead of gliding.
- **Limits:** cabin views in `LIMITS` in `src/camera.ts` (the camera never leaves the room box `ROOM`); the library in `src/library/deck.ts` (`orbit`, `clampPan`).

**Tiers:** phones get the light build (baked light only); larger screens add bloom, a colour grade and a richer sky (`src/tier.ts`, `src/fx.ts`). `?tier=lite` and `?tier=full` force a tier.

**Loading:** visitors land straight in the cabin with a short zoom in. The first view needs only `cabin.glb`, `collectibles.glb`, the sunset lightmap and sky; they start together (preload hints in `index.html`, early fetches in `main.ts`). The captain follows right after, and the galleon (Outside view) streams in after the first frame on larger screens and on first use on phones. The old opening shot plays only with `?intro=1`. `bun run build` gives every file from `public/assets` a content-hashed copy (`scripts/hash-assets.ts`), so a CDN may cache `/assets/*` for a year. After replacing `art/models/captain.glb`, run `bun scripts/build-captain.ts`.

**Textures:** the models, lightmaps and sky backdrops ship as KTX2 (Basis Universal ETC1S), which the GPU keeps compressed: roughly 4–8x less GPU memory than WebP/JPEG, which it holds uncompressed. `scripts/ktx2.ts` encodes them with the `ktx2-encoder` devDependency (Basis compiled to WASM, so there's nothing to install: no `toktx`/KTX-Software). It runs from `bun run blender` (`scripts/compress-glb.ts`: models + lightmaps + sky), `bun scripts/build-captain.ts` and `whales/scripts/web.ts`. Maps smaller than half of 512² stay WebP. The browser side is the `KTX2Loader` in `src/scene.ts` (`initKTX2`, `gltfLoader`, `loadTexture`), with the Basis transcoder served from `public/basis/` (copied from `node_modules/three/examples/jsm/libs/basis/`; copy it again after a three.js upgrade). Compressed textures can't be read back or flipped at load time, so the bake brightness goes to `lightmaps.json` (`mean`) and the sky backdrops are flipped when they're encoded. The sources stay next to them (`lightmap_*.webp` from the bake, `sky_*.jpg`).

**Library deck:** `src/library/` (its own chunk), `?deck=1` goes straight down. The room is built by `blender/library/build.py`, the Librarian comes from the Librarian prototype repository as `art/library/*`; `bun run library` rebuilds and compresses both. Its search is offline keyword matching over the topics and notes (`src/library/brain.ts`). See the Library deck section of [docs/SCENE_CONTRACT.md](docs/SCENE_CONTRACT.md).

**Sound:** fully synthesised (no audio files) in `src/sound/engine.ts`, a separate ~4 KB chunk loaded only when the visitor turns sound on. The button cycles Off → Ambient (wind, creaks, rain, music, ship's bells) → Full (plus interaction sounds). Ship's bells strike on the half hour by the watch. Below deck the weather is muffled and the Librarian's speech is a soft syllable blip (Full).

| Where | What |
|---|---|
| `content/` | Everything shown on the site, one Markdown file per item — see [docs/CONTENT.md](docs/CONTENT.md) |
| `src/` | three.js app (Vite + TypeScript) |
| `blender/` | Python scripts that build the cabin, collectibles and sky in Blender 5.3 and bake the lightmaps (`bun run blender`); `blender/library/` builds the library deck (`bun run library`) |
| `airship/` | The sky galleon (exterior of the same ship): build scripts, standalone preview, and the web copy `public/assets/galleon.glb` used for the opening shot |
| `whales/` | Sky whales: six Blender-built species bodies (generator scripts, master GLBs, renders, `bun run whales`); the individuals and the ecosystems on their backs are grown from seeds at runtime in `src/whales/`, see [whales/README.md](whales/README.md) |
| `blender/mcp/server.py` | Stdio MCP server for Blender Lab's MCP extension (registered in `.mcp.json`) |
| `art/` | Painted textures, labels and sky art made with OpenRouter (`scripts/gen-art.ts`), see [docs/ART.md](docs/ART.md) |
| `public/assets/` | Exported `.glb` files, lightmaps, sky images (KTX2 + their sources) |
| `public/basis/` | Basis Universal transcoder for the KTX2 textures (from three.js) |
| `docs/SCENE_CONTRACT.md` | The names and conventions Blender and the app agree on |
| `design/` | Concept art and earlier prototypes |
| [PLAN.md](PLAN.md) | Decisions and milestones |
| [docs/DEPLOY.md](docs/DEPLOY.md) | GitHub Pages + Cloudflare setup |

The OpenRouter key is read from `OPENROUTER_API_KEY` or `~/.config/openrouter/key` and is never stored in this repo.
