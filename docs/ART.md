# Art

Generated with OpenRouter through `scripts/gen-art.ts` (key in `~/.config/openrouter/key`, never commit it). Sources live in `art/`, web-ready files in `public/`.

## Cartridge labels

- `bun run labels` → for every cartridge in `public/content.json` without `public/labels/<id>.webp`: generates `art/labels/<id>.png`, converts it to 512×512 webp (q80, sharp). Then `bun run content` so `content.json` picks up the `label` paths.
- Adding a cartridge: add `content/<id>.md`, `bun run content && bun run labels && bun run content`.
- Prompt per item, first match wins: frontmatter `labelPrompt:` → `art/labels.json` `prompts[id]` → derived from title/subtitle/body.
- Redo one: `FORCE=1 bun run labels <id>`. An existing PNG without a webp is only converted, not regenerated.
- Model: `openai/gpt-5-image-mini` (default in gen-labels, ~$0.045 per label). Override with `OPENROUTER_IMAGE_MODEL`. The default `gpt-5.4-image-2` is more detailed but ~5× the price (~$0.22) and busier at label size.

## Sky backdrops

- Spec `art/sky.json` → `bun scripts/gen-art.ts art/sky.json` → `art/sky/sunset.png`, `night.png` (16:9, 1280×720, default model).
- Export: bottom cropped so the horizon sits ~40% from the bottom (≈2.1:1), resized to 2048 wide, mozjpeg q82 → `public/assets/sky_sunset.jpg` (133 KB), `sky_night.jpg` (156 KB). Done with a sharp one-liner (`extract` → `resize(2048)` → `jpeg`); the horizon fraction is measured by eye per image.

- Storm (bell easter egg): spec `art/storm.json` (same style text as `sky.json`, `ref: art/sky/sunset.png` so the composition matches) → `art/sky/storm.png` → rows 18–618 of the 1280×720 image (horizon ~40% from the bottom, same 2.13:1 as sunset) → 2048×960 mozjpeg q82 → `public/assets/sky_storm.jpg` (113 KB).

## Portrait

- `bun run portrait` (`scripts/gen-portrait.ts`): reads `art/portrait-source.jpg` (or .jpeg/.png/.webp; git-ignored, never published — only the painting is), normalises it to a temporary git-ignored PNG reference, paints a 4:5 head-and-shoulders portrait with the style in `art/portrait.json` (airship-captain coat, brass wing pin, warm lamplight, no text) → `art/portrait/portrait.png` → 640×800 webp ≤150 KB → `public/assets/portrait.webp`. Exits with a message if the photo is missing. Look at the PNG and rerun if the likeness or style is off (~$0.18 per try).
- Placeholder until the photo arrives: `art/portrait.json` job `placeholder` (captain's coat and cap on a hook, wing pin, no person) → `bun run portrait --placeholder` re-exports it (43 KB).

## Tengwar note

- Text: `person.tengwar.latin` in `content/_person.yml`. `glyphs` is the output of HT's fork of Glaemscribe (github.com/kucukkanat/glaemscribe, npm build 1.3.1), mode `english-tengwar-espeak` (English, phonemic via the bundled eSpeak NG), charset `tengwar_freemono`. The string uses ConScript (CSUR) private-use code points, stored as `\uE0xx` escapes.
- Regenerate: load `build/npm/glaemscribe-*.tgz`'s `js/glaemscribe.js`, all `charsets/*.cst.js` and `modes/*.glaem.js`, and `espeakng.for.glaemscribe.nowasm.sync.js` into one Node VM context; `resource_manager.load_charsets(); load_modes()`; `mode.finalize({})`; `mode.transcribe(text, mode.supported_charsets.tengwar_freemono)[1]`.
- Font: `public/fonts/FreeMonoTengwar.ttf` — the 47 KB "embedding" build of FreeMonoTengwar 2013-07-21 from the Free Tengwar Font Project (freetengwar.sourceforge.net), unmodified. Licence: GPL v3+ with the font-embedding exception (documents that embed it are not GPL-covered); `FreeMonoTengwar-GPL.txt` and `FreeMonoTengwar-FontLog.txt` sit next to it. Its OpenType GSUB/GPOS place the tehtar (checked in Chrome). Tolkien Estate permission may be needed for commercial use of the script; this is a personal site.

## Ugurcan (chart room)

Made with the Meshy API (key on the cloud environment, never in the repo), from three photos of him (not committed):
1. Image to image (`nano-banana-pro`, the photos as references): a full-body concept in the pirate navigator's outfit (red frock coat, tricorn, cutlass, spyglass), A-pose on white, then a second pass to bring the face closer to the photos → `art/chartroom/ugurcan_concept.png`.
2. Image to 3D from the concept: `ai_model: latest` (Meshy 7.1), remeshed to 60k triangles, `texture_model: meshy-7`, `remove_lighting`, A-pose.
3. Rigging (biped, 1.78 m, fingers), then animations `[0, 11, 336, 290, 42, 415]` in one file → `art/chartroom/ugurcan.glb`.
About 120 credits in all, with the drafts.

## Style rules

- Painted, cosy indie-game key art: soft brush strokes, chunky stylised shapes, clean saturated colours. Labels must not go sepia/yellow (the mini model drifts there; the style text in `art/labels.json` counters it).
- One bold focal subject that reads at thumbnail size; full bleed, no borders, frames or mock-ups.
- No text, letters, numbers or logos anywhere (UI text is HTML).
- Sky: empty cloud sea, no islands or ships (those are 3D meshes).
- Check every image by eye; regenerate anything with text, borders, blank margins or artefacts.

## Cost so far

| What | Cost |
|---|---|
| Textures (earlier) | see `art/textures.log` |
| Labels: 16 + 6 regenerations (mini) | $0.92 |
| Model comparison (2 labels, default model) | $0.45 |
| Sky: 2 images (default model) | $0.26 |
| **Labels + sky total** | **$1.63** |
| Polish round: storm sky + portrait placeholder (default model) | $0.32 |
| Texture round: wood_planks, mahogany, dark_wood, cloth regenerated with crisper prompts (default model) | $0.90 |
