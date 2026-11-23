# Editing content

Everything on the site comes from `content/`. You never touch 3D files to change what's in the cabin.

- `content/_person.yml` — name, tagline, bio, links, plus the cabin's set pieces (bodies are short Markdown):
  - `welcome: { title, body, signoff }` — the folded letter on the chart table, shown on first visit.
  - `about: { title, body }` — panel behind the portrait on the wall.
  - `story: { title, body }` — the √−1 slate.
  - `tengwar: { latin, glyphs, font }` — the wall note. `glyphs` is Glaemscribe output for `font` in `public/fonts/` (see docs/ART.md); empty `glyphs` shows Latin only. If you change `latin`, regenerate `glyphs`.
  - `nostr: { npub, relays, placeholder }` — where the message bottle sends its encrypted DM. The npub is a placeholder: paste the real one and set `placeholder: false`.
- One Markdown file per item. The file name is its id. The frontmatter `kind` decides where it appears:

| kind | Appears as | Required fields | Useful fields |
|---|---|---|---|
| `cartridge` | A cartridge in the map chest; can be inserted into the handheld | `title`, `group` (`games` \| `ai` \| `tools`) | `subtitle`, `year`, `order`, `colour`, `url`, `playable`, `embed`, `orientation`, `source`, `tags`, `labelPrompt` |
| `book` | A book on the shelf | `title` | `subtitle`, `year`, `colour`, `url` |
| `notebook` | A notebook on the short shelf | `title` | same as book |
| `memory-card` | A save card on the logbook rack — one per job | `title` | `role`, `period`, `current`, `achievements`, `colour`, `map: { x, y }` |

A `memory-card` with `map: { x, y }` also becomes an island on the chart-table map (x left→right, y bottom→top, both 0–1; keep y between 0.38 and 0.62 to stay on the open band of the chart). The route is drawn through the islands in `order`.

`playable: true` means the `url` can run inside the handheld (it must allow being shown in an iframe — GitHub Pages sites do). `embed` (optional) is the address the handheld loads instead, when the project has a compact embedded mode; `url` stays the link for “Open”. `orientation` (`landscape` \| `portrait`, optional) locks the phone to that orientation while the cartridge is fullscreen (Android Chrome; iPhones have no fullscreen for it).

The body (below the second `---`) is short Markdown: paragraphs, lists, links, **bold**, *italic*.

## After editing

```bash
bun run content     # validates and rebuilds public/content.json (also runs with dev/build)
bun run labels      # paints a label for any new cartridge without one (uses OpenRouter, ~$0.05–0.2 each)
bun run dev         # http://localhost:4380
```

Rows hold up to 10 cartridges each, the shelf 14 books and 6 notebooks, the rack 12 cards.

## Later: editing in the browser

Because content is plain files, a Git-based editor (for example Pages CMS or Decap CMS) can be added to edit them from a web page and commit to GitHub. Not set up yet.

## Notes and topics (the writing garden)

Long-form writing lives in two folders and is built by `scripts/build-notes.ts` (the data contract is `src/writing/types.ts`):

- `content/topics/<id>.md`: one file per topic, which is one book on the shelf and one volume in the library below deck (the first ten topics by `order`; the Librarian fetches it and the open book lists its notes; tags of the notes are the words he recognises when asked). Frontmatter: `title`, `colour` (`#rrggbb`, the book cover), `order` (a number; shelf order). The body is a one or two sentence blurb.
- `content/notes/<slug>.md`: one file per note. The file name is the slug and the address (`/writing/<slug>/`, `/?note=<slug>` in the cabin): lower-case ASCII letters, digits and dashes, unique across both languages (a Turkish note gets its own slug, for example `seksen-yuzde-kes`). Sub-folders are allowed and ignored.

```yaml
---
title: Fitting a model into a browser tab     # required
date: 2026-08-17                              # required, YYYY-MM-DD, first published
updated: 2026-09-01                           # optional, last substantial change
topic: local-ai                               # required, must match a file in content/topics/
tags: [on-device, webgpu]                     # optional
stage: growing                                # required: seedling | growing | evergreen
lang: en                                      # required: en | tr
series: { name: A local model in the browser, order: 2 }   # optional; `id` is derived from the name unless given
excerpt: One or two plain sentences.          # optional; falls back to the first paragraph (with a warning)
---
```

The body is Markdown: headings (start at `##`; the title is the page's `h1`), emphasis, lists, block quotes, fenced code with a language (` ```ts `), tables, images (`![alt](/labels/tilttown.webp)`, files under `public/`), footnotes (`[^1]` and `[^1]: text`), horizontal rules and links. Raw HTML is shown as text, not run.

**Links between notes:** `[[slug]]`, `[[slug|link text]]` or `[[Note Title]]` (matched without regard to case or Turkish letters). Each note page lists the notes that link to it ("Linked from"). A link to a note that does not exist yet is allowed: it shows as a dashed "not written yet" word and the build prints a warning.

**To add a note:** create the file, then run `bun run notes` (also part of `bun run dev` and `bun run build`). It validates everything, and writes `notes.json`, `notes/<slug>.json`, the static pages under `/writing/` and the Pagefind search index under `/pagefind/` into `public/` (dev) or `dist/` (build). The build stops on a missing required field, an unknown topic, stage or language, a bad or duplicate slug; it only warns on broken `[[links]]`, a missing excerpt, and two notes with the same order in one series.

The nine notes and three topics in the repository today are samples (their first line says "Sample note, replace me."). Delete them when the real ones arrive.
