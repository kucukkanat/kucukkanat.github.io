# kucukkanat.com — The Airship Cabin

A 3D personal site: the visitor stands in the captain's cabin of an airship at sunset. Projects are game cartridges in a map chest, writing is books on the shelf, the career is memory cards in a logbook rack and a voyage drawn on the sky map. Cartridges go into the orange KANAT·1 handheld and the real project plays.

Concept art: `design/scenes/round2/f-airship-*.png` (overview, browse, play, read).

## Decisions (interview, 2026-11-20)

| Topic | Decision |
|---|---|
| Blender | Blender MCP for live building; every model also saved as a re-runnable Python script in `blender/` |
| Navigation | Fixed viewpoints + point-and-click; camera glides between them |
| First cut | Vertical slice: full cabin + one complete flow (pick cartridge → insert → play) |
| Devices | Phones matter: light download, baked lighting, touch-first, plain-HTML fallback |
| Playing | Camera flies into the handheld screen, which becomes a full-screen live iframe; Eject flies back out |
| Look | Painted, close to the concept: chunky low-poly, hand-painted textures, baked warm light |
| Sky | Sunset by default; the lantern is a switch that turns the scene to night |
| Sound | Wind, creaks, clicks, cartridge "chunk"; muted until the visitor turns it on |
| Repo | Decide later; build in `~/Developer/personal_website` |
| Stack | Vite + TypeScript + three.js, Bun for tooling |
| Career | Sky map = career voyage (one island per job, dotted route); memory cards in the wall rack = save file per job |
| Content | All of it, and **configurable**: each item says what object it is |

## Content model (configurable)

One Markdown file per item in `content/`, frontmatter decides where it appears. Add, remove or move an item by editing a file; no 3D work needed.

```yaml
# content/tilttown.md
kind: cartridge          # cartridge | book | notebook | memory-card | map-island
title: Tilt Town
year: 2026
group: games             # chest row: games | ai | tools
order: 1
colour: "#C8492F"        # plastic colour
label: labels/tilttown.png   # label art (generated or screenshot)
url: https://hackdonalds.github.io/tilttown/
playable: true           # embeddable → "Insert" plays it inside the handheld
source: https://github.com/hackdonalds/tilttown
tags: [three.js, city builder]
---
A painterly city builder… (body = the text in the info panel and the plain page)
```

- `memory-card` and `map-island` share a `job:` id so one job shows in both the rack and the map.
- One mesh per kind, instanced; each item only adds a label texture to an atlas. 30+ items cost almost nothing.
- Build step reads `content/` → `content.json` for the scene + static plain-HTML pages for search engines and no-WebGL visitors.
- Later: a browser editor for this folder (e.g. Pages CMS / Decap, which commit to GitHub) — "manage content in the website" without a backend.

## Scene and viewpoints

| Viewpoint | What's there | Interaction |
|---|---|---|
| **Overview** (landing) | Whole cabin, windows, islands drifting by | Hotspots pulse once; click any area |
| **Map chest** | Open drawer of cartridges in rows (games · AI · tools) | Hover lifts, click pulls one out with info panel → *Insert* |
| **Chart table** | Sky map with career islands + route, compass, spyglass, handheld | Click island → its memory card lights up + job panel |
| **Logbook rack** | Wall grid of memory cards, newest glowing | Click card → slides out, achievements panel |
| **Bookshelf** | Books (writing) and notebooks (how-to-work-with-me, notes) | Click → book opens on the table, *Read* link |
| **Handheld** | KANAT·1 on the table | Insert → fly into screen → live game; *Eject* |
| **Lantern** | Brass lantern | Toggle sunset ↔ night |
| **Ship's wheel** | Centre of the windows | Easter egg (turn it: the view outside swings) |

The info panels, buttons and text are HTML over the canvas (accessible, crisp, translatable), not text in 3D.

## How the art gets made

1. **Blockout in Blender (MCP)**: cabin shell (curved stern, window frames, beams), chart table, map chest, bookshelf, logbook rack, ship's wheel, lantern, spyglass, compass, and the four collectible templates: cartridge, book, memory card, KANAT·1 handheld.
2. **Textures**: tileable painted textures (wood planks, mahogany, brass, parchment, leather) generated with OpenRouter in the concept's style; map and label art also generated, text added as SVG/HTML.
3. **Baked lighting**: two lightmaps baked in Cycles — *sunset* and *night (lantern only)* — and blended in three.js when the lantern switches. Baked light is what makes it look rich on phones.
4. **Export**: one `cabin.glb` (meshopt + KTX2 textures) plus small instanced templates. Re-running `blender/build.py` rebuilds everything from scratch.
5. **Sky**: painted sky layers (sunset and night) behind the windows with parallax; floating islands and small airships as low-poly meshes drifting on slow loops.

## Performance budget

- First view under ~2.5 MB, interactive in < 3 s on a mid-range phone.
- Pixel ratio capped at 2 (1.5 on phones), no realtime shadows, ≤ ~150 draw calls.
- No WebGL / `prefers-reduced-motion` / very slow device → plain HTML site from the same content.
- Lazy-load: game iframes only on Insert; audio only after the visitor enables it.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | Setup: install `uv`, Blender MCP add-on + server, new session; scaffold Vite + TS + three + Bun; content schema with the current items | Blender tools work from the session; `bun dev` shows an empty scene; `content/` holds all items |
| **M1** | Blockout: cabin + props + collectible templates in Blender, exported; viewpoints and camera glides in three.js | Can click between all viewpoints in grey-box |
| **M2** | Vertical slice: cartridges from `content/` in the chest, hover/pull/info panel, Insert → fly into screen → live Tilt Town → Eject; first sounds | The full flow works on desktop and phone |
| **M3** | Look: painted textures, baked sunset + night lightmaps, sky and drifting islands, lantern switch | Side by side with the concept art, it reads as the same place |
| **M4** | Remaining sections: logbook rack, chart-table voyage map, bookshelf; all content kinds configurable | Every item in `content/` shows up in its place |
| **M5** | Ship-ready: plain-HTML/SEO pages, accessibility pass, perf budget, choose repo, GitHub Pages + CNAME + Cloudflare DNS | kucukkanat.com serves the site |

Each milestone ends with screenshots / a short screen recording for review before the next one starts.

## Status (2026-11-20)

M0–M4 done. M5 done except publishing: creating the GitHub repo, pushing, and the Cloudflare DNS record (needs HT). Built in parallel streams: Blender (`blender/`), art (`art/`, labels and sky), app (`src/`), plain/SEO + deploy (`scripts/build-plain.ts`, `.github/workflows/pages.yml`, `docs/DEPLOY.md`).

- Production build: first view ≈ 2.42 MB (under the 2.5 MB budget): cabin.glb meshopt-compressed 2.1 → 1.06 MB, labels 256 px.
- Interactive in ~2.5 s with software WebGL; real GPUs are faster.
- Phones: the overview can't fit the whole cabin, so it does one slow look left/right on load and visitors swipe sideways to look around.
- Tested: insert → play (Tilt Town) in a real browser, wheel drag, sound toggle, every viewpoint on desktop and phone, night mode, plain page.
- Debug deep links: `?view=overview|chest|table|rack|shelf|handheld|screen`, `&item=<id>`, `?play=<id>`, `?night=1`.

## Still open

- Career voyage stops: which city for each job (map islands)? Start point?
- Label art per cartridge: generated art, real screenshots, or both?
- A portrait of you anywhere (e.g. a painted frame on the wall)?
- Repo choice (decide at M5).

## Polish round (interview, 2026-11-20)

| Topic | Decision | Build |
|---|---|---|
| Welcome | A folded letter on the chart table by the handheld | Opens on first visit (and on click): "Welcome aboard — I'm HT…", 3-line bio, what to click first; tucks away. Copy in `content/_person.yml`. |
| You | Painted portrait on the wall, from a photo | HT drops `art/portrait-source.jpg` (git-ignored, never published); generate a painted portrait in the cabin style; framed above/near the rack; click = about panel. |
| Contact | Contact form → **Nostr DM** to HT's npub; LinkedIn; X; Nostr | Message-bottle prop opens a small form; browser makes a throwaway key, NIP-17/NIP-04 encrypted DM to HT's npub over public relays. Mock npub until HT pastes the real one (`content/_person.yml`). No email, no booking link for now. |
| Easter eggs | Tengwar note, √−1 slate, ship's bell | Tengwar note (hover transliterates via glaemscribe); slate with √−1 → the 2 AM story; ring the bell 3× → storm weather (darker sky, rain on the glass, rocking). |
| Map | No cities — companies + years | As is. |
| Voice | Warm, light captain's log | Rewrite panel copy + welcome letter: first person, plain, a nautical wink ("Ship's log, 2023: …"), facts crisp. |
| Priorities | Load speed, look, controls feel, more content | Speed: lazy-load night lightmap/sky + labels after first frame, KTX2 textures. Look: dust motes in the sun shafts, foreground rope, busier ceiling. Controls: tune after HT tries it on the phone. Content: needs HT's list of extra projects/talks. |

### Polish round status (2026-11-20)

Built in three parallel streams (Blender props + ceiling + rebake; app features; copy/Tengwar/storm/portrait) and integrated.
Done: welcome letter, portrait (placeholder painting until `art/portrait-source.jpg` + `bun run portrait`), message-bottle contact form (NIP-17 Nostr DM, demo mode until the real npub), Tengwar note (glaemscribe English mode, FreeMonoTengwar, GPL + font exception), √−1 slate story, ship's bell → storm (rain on glass, lightning, rocking), dust motes, foreground rope and busier ceiling, captain's-log copy, lazy loading of night/storm/labels/portrait/font, camera views for letter and portrait.
First view: 1.95 MiB (was 2.36). Texture downsizing would reach ~1.78 MiB but blurs the chart map; kept quality.
Waiting on HT: real npub (`content/_person.yml` → nostr.npub, placeholder: false), portrait photo, list of extra projects/talks, controls feedback after phone testing, go-ahead to create the repo and deploy.

## Look-and-feel round (interview, 2026-11-20)

| Topic | Decision |
|---|---|
| Style | Push more stylised: a **painted diorama**. Brush strokes, soft paint bands, warm light / cool violet shadow; no photographic grain |
| Order | Props first, then materials + lighting, sky, galleon |
| Galleon | Exterior opening shot, ~5 s, skippable, first visit only; the camera closes on the stern windows and dissolves into the cabin |
| Budget | Two tiers (`src/tier.ts`): **lite** = phones, today's budget, baked light, no galleon; **full** = bloom, colour grade, richer sky, galleon intro |
| Phone landing | Upright phones frame the chart table, wheel and windows; no foreground rope |
| Ship = cabin | The galleon uses the cabin's palette and paint treatment (`blender/kit/paint.py` is the one colour source for both builds) |

What was built:

- `blender/kit/paint.py`: palette + the paint filter (brush blur along the grain → soft posterise → four-stop ramp). `materials.py` runs every tileable through it; `airship/tex_process.py` does the same for the galleon.
- `blender/kit/dress.py`: varied book runs (six cover colours, gilt bands, paper labels, leaning books), hourglass and bookend, tripod telescope by the starboard window, globe + books + chart basket on and beside the sea chest, coat pegs with the captain's hat and coat.
- Bake rig (`lights.py`): stronger, lower sun, weaker and cooler fills, so sun patches and cool shadows read.
- App: painted highlights on brass and polished wood (`lighting.ts`), light shafts + bloom + grade (`fx.ts`), cartridges spread over the drawer, larger rack labels, the handheld lit by its own screen at night, portrait landing framing (`camera.ts`), opening shot (`intro.ts`).
- Debug: `?tier=lite|full`, `?intro=1` (replay), `?intro=0`, `?intro=1&introT=2.5` (freeze the shot).

## Writing: finding, browsing, searching (interview, 2026-11-20) — steps 1 to 4 built with sample notes

Problem today: the only index is the book spines; no list, search, dates or tags in 3D; the shelf silently stops at 14 books + 6 notebooks; "Read" leaves the site, so there is no text here to search or for search engines to index; a book has no address.

| Topic | Decision |
|---|---|
| Direction | **Reading Room + Ship's Index + Speaking Tube** (read on the site, a filterable list, full-text search). Card Catalogue prop, Chart of Ideas and a conversational Librarian are deferred |
| Full text | Lives **in this repository** as Markdown; this site is the canonical home |
| Volume | A **digital garden**: hundreds of interlinked notes at different stages |
| Shelf | **One volume per topic**: a book is a topic; opening it lists that topic's notes. Index and search reach every note |
| Garden features | `[[wiki links]]` with backlinks, growth stages (seedling / growing / evergreen), series with previous / next. No RSS for now |
| Languages | English and Turkish; language is a filter; search must fold Turkish letters (ı, İ, ğ, ş, ç, ö, ü) |
| Search scope | Everything: notes, projects, jobs and cabin actions ("night", "go outside") in one box |
| Migration | HT supplies the Markdown; the system is built around a couple of samples |

Build order:

1. **Content model**: `content/notes/<slug>.md` with `title, date, updated, topic, tags, stage, series {name, order}, lang, excerpt`; `content/topics/<id>.md` (title, colour, blurb, order) drives the books on the shelf. Build step resolves `[[links]]`, computes backlinks, reading time, and warns on broken links and on notes without a topic.
2. **Reading Room**: one real page per note at `/writing/<slug>/` (also the plain version: HTML, `Article` JSON-LD, sitemap). In the 3D site the topic book opens on the table, the cabin dims and the note renders in an HTML reader over it; History API so every note and topic has an address and Back works. Reading position kept in localStorage ("continue reading" ribbon on the book). Needs a real Markdown renderer (headings, code, images, footnotes).
3. **Ship's Index**: a sheet from the dock: all notes with title, date, reading time, stage, language, topic; facets with counts; keyboard navigable; choosing a row opens the note and lights its topic book.
4. **Speaking Tube**: `/` or Ctrl/Cmd+K and a dock button. Pagefind over the built `/writing/` pages (chunked index, per-language, highlighting on the target page) plus a small in-memory list of projects, jobs and cabin actions merged into the same results.
5. Later: Card Catalogue prop as the Index's in-world door; Chart of Ideas once there are 20+ notes; "related notes" precomputed at build time.

Open points: URL shape for Turkish notes (`/writing/tr/<slug>/` or one flat namespace), whether the two existing "notebooks" (user manual, consultancy) become notes or stay as links.

Built (2026-11-20): `scripts/build-notes.ts` (notes, topics, wiki links, backlinks, series, static `/writing/` pages, Pagefind index; `bun run notes` refreshes in dev), `src/writing/` (`types.ts` contract, `reader.ts` Reading Room + topic view, `indexsheet.ts` Ship's Index, `search.ts` Speaking Tube, `shelf.ts` topic volumes, `store.ts`, `router.ts`). Dock: Writing, search. Addresses: `/?note=<slug>`, `/?topic=<id>`, `/?index=1`. The nine notes in `content/notes/` are samples ("Sample note, replace me.") and must be replaced before they go live. Turkish notes share one flat slug namespace; the older stand-alone books moved to the notebook row.

## Performance pass (2026-11-20)

Measured on the built site in headless Chrome on an M4 Pro (so render times are relative, not phone numbers). Transfer sizes are gzip, as GitHub Pages serves them.

| | Before | After |
|---|---|---|
| Phone first view (transfer) | ~1.56 MB, plus ~580 KB of night/storm art fetched unasked | ~1.27 MB; night/storm only when used |
| Desktop first view, return visit | ~1.56 MB | ~1.45 MB |
| Main script (gzip) | 252 KB | 219 KB (+ chunks: bloom 5, outside 6, search 7, reader 10, loaded when used) |
| Draw calls, phone / desktop | 191 / 313 | 128 / 250 |
| Render time per frame, desktop at 2880×1800 | 2.6 ms | 2.1 ms |

What changed: reader, Ship's Index, search, outside view and post-processing are separate chunks; each map island is one merged mesh; `cabin.glb` uses meshopt level high; phones use 1024² lightmaps (`scripts/lightmap-lite.ts`); night and storm art load on first use (the full tier warms them after 6 s); a pixel budget caps very large windows; a quality governor (`main.ts` loop) lowers the pixel ratio and then drops bloom when frames stay above 25 ms.

Debug: `__kkInfo()` (draw calls, triangles, pixel ratio, quality, bloom) and `__kkBench(n)` (average ms per rendered frame) in the console.

Not done: frame rate on a real phone was never measured; the phone galleon is still 1.44 MB on disk (742 KB transferred); three.js itself is most of the main script.
