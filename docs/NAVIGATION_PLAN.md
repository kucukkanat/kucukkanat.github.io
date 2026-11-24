# Navigation plan (interview, 2026-11-24)

**Status:** built (phases 1–4). The map has no `?map=1` address: closing it with the browser's Back would race the move it starts, so Esc, ✕ and the scrim close it instead.

## What's there today

The dock (`src/ui.ts`) packs everything into one bar, in every place:

| Group | Cabin | Library / Chart room / Outside |
|---|---|---|
| Viewpoints / stations | Projects · Table · Resume · Blog · Handheld | that place's 4–5 stations |
| Places | Cabin · Library · Chart room · Outside | same |
| Other | Index · Search · Lantern · Sound | same |

Plus, in the cabin: the name header with Letter · Plain version, the Back button, the glowing hotspots, and invisible egg buttons. Outside adds Take the helm.

**13 controls on desktop; on a phone the dock wraps to 3 rows (~22% of the screen).**

Other issues found:
- Viewpoints are listed twice: as glowing dots in the scene and as dock buttons.
- Two kinds of nav sit side by side (where in this room vs which room) with only a thin separator between them.
- While a place loads ("Lighting the lamps below…") the dock stays clickable and the toast sits on top of the place buttons.
- In the library, chart room and outside, Back is hidden at the place's starting point, so the only way back is the dock or a dot.
- On a phone, the welcome letter covers ~60% of the screen on arrival.

## Decisions

| Topic | Decision |
|---|---|
| Audience | Both equally: a fast route for recruiters and peers, the world for explorers |
| Style | Mostly in the world: glowing dots, doors, the hatch and the windows do the moving; minimal HUD |
| One tap from anywhere | Search. Places take two taps, via the map |
| Menu | One **Map** button opens an illustrated **deck plan** of the airship |
| Viewpoints / stations | Removed from the bar. Glowing dots in the scene, and listed under each room in the map |
| Sound + Lantern | Move into the map, as a settings row |
| Header | The name stays. Letter, Plain version and Index move into the map |
| Phone footprint | One small pill, about 56px |
| Places in the pill | The pill shows the current place (`Cabin ▾`); a tap opens the map |
| Onboarding | The welcome letter ends by pointing at the Map button; the button pulses once |
| Fixes | Lock nav during transitions · Back in every place · a smaller letter on phones |

## Target layout

```
┌────────────────────────────────────────────┐
│ Hilmi Tolga Şahin                          │  name only
│                                            │
│              (scene + glowing dots)        │
│                                            │
│      ┌──────────────────────────────┐      │
│      │ ‹ Back │  ⚓ Cabin ▾  │  🔍  │      │  the pill
│      └──────────────────────────────┘      │
└────────────────────────────────────────────┘
```

- **Back**: always present. It names what it will do: "Back", "Up to the cabin", "Back inside", "Close". At the cabin overview it collapses away and the pill shrinks to two parts.
- **Place (Map)**: the current place's name plus ▾. It opens the ship's map.
- **Search**: the Speaking Tube palette (`/`, Ctrl+K).
- Outside, **Take the helm** stays as a contextual button above the pill (it is an action, not nav).

### The ship's map (sheet / dialog)

```
┌─ The ship ──────────────────────────── ✕ ─┐
│   [illustrated airship cutaway]            │
│    ┌ Outside (sails) ┐                     │
│    │ Chart room │ Cabin (you are here) │   │   tap a room → goes there
│    └──── Library (below deck) ────────┘    │
│                                            │
│ In the cabin: Projects · Table · Resume ·  │   stations of the selected room
│               Blog · Handheld              │
│ ───────────────────────────────────────    │
│ Index · Letter · Plain version             │   links
│ Lantern ◐   Sound: off/ambient/full        │   settings
└────────────────────────────────────────────┘
```

- Desktop: a centred dialog. Phone: a bottom sheet, with the illustration on top and the lists scrolling below.
- Tapping a room goes there. Tapping a station in another room goes to that room, then that station (a deep link: `?deck=1&station=table`).
- "You are here" marks the current room and station.
- The illustration is an inline SVG (or a painted PNG with SVG hit areas), with each room a focusable `<a>`/button. Keyboard: arrow keys move between rooms, Enter goes.
- Shortcuts stay: `1`–`4` for places, `M` opens the map, `Esc` closes it.
- It gets its own address: `?map=1` (add it to `CABIN_KEYS` in `src/nav.ts`), so the browser's Back closes it.

## Work plan

### Phase 1: the pill (the biggest win, small)
1. `src/ui.ts`: replace the dock markup with a pill (`back`, `place-btn`, `search`). Drop the `nav` / `places` rows, `writing-btn`, `night` and `sound` from it. Keep `setStation` and `setPlace` (they now update the map and the pill label).
2. `style.css`: style the pill. Keep `--dock-h` measured as today, so coach hints and the library chat still sit above it.
3. Header: the name only. Letter and Plain version move out.
4. Back in every place: `setPlace` no longer calls `setBack(null)`. Each place gives its root label ("Up to the cabin", "Back inside", "Back to the cabin"), wired to the existing ladder / window / door actions.

### Phase 2: the map, as a list first
5. New `src/shipmap.ts`: the dialog / sheet. Rooms come from `PLACES`; stations come from each place's `stations` getter (deck, chartroom, outside) and the cabin's `NAV`. The settings row reuses `toggleNight` and `toggleSound`; the links reuse `writing()`, `letter()` and `/plain/`.
6. The `?map=1` route in `nav.ts` / `main.ts`, plus the `M` shortcut.
7. Accessibility: `role="dialog"`, a focus trap, focus returns to the pill, `aria-current` on the current room and station.

### Phase 3: the illustrated deck plan
8. Draw the airship cutaway (a side elevation: sails/outside on top, chart room and cabin on the main deck, library below). Generate it in the concept's painted style, or draw it as SVG; overlay SVG hit areas.
9. Hover / focus lights the room; the selected room's stations list below. Reduced motion: no animation.

### Phase 4: onboarding and fixes
10. The letter's last line: "Lost? The **Map** at the bottom shows every room of the ship." The Map button pulses once after the letter closes (`localStorage` flag, the same as `coach.ts`).
11. Smaller letter on phones: cap it at ~45vh with internal scroll, or make it a collapsed card that expands. The scene stays visible behind it.
12. Lock nav during transitions: while a place loads or the camera glides, set `inert`/`aria-disabled` on the pill's place button, and move the "Lighting the lamps…" toast above the pill (`bottom: calc(var(--dock-h) + 10px)`).
13. Update the `coach.ts` text: "drag to look · tap a glowing dot to go there · Map to change rooms".

### Phase 5: check
14. Playwright screenshots of the 4 places × desktop and phone. Keyboard-only walk (Tab, 1–4, M, Esc). Screen reader labels.
15. Update the README's "Getting around" table and `docs/SCENE_CONTRACT.md`.

## Success criteria
- Persistent chrome: 13 controls → 3 (2 at the cabin overview).
- Phone nav height: ~22% → ≤ 8% of the screen.
- Every room and station is reachable in ≤ 2 taps from anywhere; search in 1.
- No nav input is accepted mid-transition; Back exists in every place.
