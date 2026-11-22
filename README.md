# kucukkanat.com

The personal site of Hilmi Tolga Şahin (HT): the captain's cabin of an airship at sunset. Projects are game cartridges in a map chest — insert one into the KANAT·1 handheld and it plays. Writing is on the bookshelf, the career is on the logbook rack and drawn as a voyage on the chart table. A plain version lives at `/plain/`.

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

**Camera:** drag to turn, scroll / pinch to zoom, right-drag / shift-drag / two-finger drag / shift+arrows to pan, double-click / double-tap / `0` to reset, arrow keys and `+`/`-` too. Limits per view live in `LIMITS` in `src/camera.ts`; the camera never leaves the room box (`ROOM`).

**Tiers:** phones get the light build (baked light only); larger screens add bloom, a colour grade and a richer sky (`src/tier.ts`, `src/fx.ts`). `?tier=lite` and `?tier=full` force a tier.

**Loading:** visitors land straight in the cabin with a short zoom in. The first view needs only `cabin.glb`, `collectibles.glb`, the sunset lightmap and sky; they start together (preload hints in `index.html`, early fetches in `main.ts`). The captain follows right after, and the galleon (Outside view) streams in after the first frame on larger screens and on first use on phones. The old opening shot plays only with `?intro=1`. `bun run build` gives every file from `public/assets` a content-hashed copy (`scripts/hash-assets.ts`), so a CDN may cache `/assets/*` for a year. After replacing `art/models/captain.glb`, run `bun scripts/build-captain.ts`.

**Textures:** the models, lightmaps and sky backdrops ship as KTX2 (Basis Universal ETC1S), which the GPU keeps compressed: roughly 4–8x less GPU memory than WebP/JPEG, which it holds uncompressed. `scripts/ktx2.ts` encodes them with the `ktx2-encoder` devDependency (Basis compiled to WASM, so there's nothing to install: no `toktx`/KTX-Software). It runs from `bun run blender` (`scripts/compress-glb.ts`: models + lightmaps + sky), `bun scripts/build-captain.ts` and `whales/scripts/web.ts`. Maps smaller than half of 512² stay WebP. The browser side is the `KTX2Loader` in `src/scene.ts` (`initKTX2`, `gltfLoader`, `loadTexture`), with the Basis transcoder served from `public/basis/` (copied from `node_modules/three/examples/jsm/libs/basis/`; copy it again after a three.js upgrade). Compressed textures can't be read back or flipped at load time, so the bake brightness goes to `lightmaps.json` (`mean`) and the sky backdrops are flipped when they're encoded. The sources stay next to them (`lightmap_*.webp` from the bake, `sky_*.jpg`).

**Sound:** fully synthesised (no audio files) in `src/sound/engine.ts`, a separate ~4 KB chunk loaded only when the visitor turns sound on. The button cycles Off → Ambient (wind, creaks, rain, music, ship's bells) → Full (plus interaction sounds). Ship's bells strike on the half hour by the watch.

| Where | What |
|---|---|
| `content/` | Everything shown on the site, one Markdown file per item — see [docs/CONTENT.md](docs/CONTENT.md) |
| `src/` | three.js app (Vite + TypeScript) |
| `blender/` | Python scripts that build the cabin, collectibles and sky in Blender 5.3 and bake the lightmaps (`bun run blender`) |
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
