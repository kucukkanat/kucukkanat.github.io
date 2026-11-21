/** Shape of public/content.json, built from content/*.md by scripts/build-content.ts. */
export type Kind = 'cartridge' | 'book' | 'notebook' | 'memory-card' | 'map-island';

export interface Item {
  id: string;            // file name without .md
  kind: Kind;
  title: string;
  subtitle?: string;     // one line, e.g. "Painterly city builder"
  year?: string;
  group?: 'games' | 'ai' | 'tools';   // cartridge row in the chest
  order: number;         // sort within its place
  colour: string;        // plastic / cover colour, hex
  label?: string;        // e.g. "/labels/tilttown.webp" (absent → procedural label)
  url?: string;          // live link
  playable?: boolean;    // true → can run inside the handheld (iframe-embeddable)
  embed?: string;        // playable: URL for the handheld iframe when it differs from `url` (e.g. a compact mode)
  orientation?: 'landscape' | 'portrait'; // playable: lock the phone to this while the cartridge is fullscreen (Android)
  source?: string;       // repo link
  tags?: string[];
  job?: string;          // links memory-card and map-island of the same job
  role?: string;         // memory-card: job title
  period?: string;       // memory-card: "2018–2023"
  current?: boolean;     // memory-card: the job in progress (glows)
  map?: { x: number; y: number };   // map-island: normalised position on the sky map
  achievements?: string[];
  body: string;          // HTML from the markdown body
}

export interface Content {
  person: {
    name: string; handle: string; tagline: string; bio: string;
    links: { label: string; url: string }[];
    /** Letter on the chart table, shown on first visit. body: Markdown → HTML. */
    welcome?: { title: string; body: string; signoff?: string };
    /** Portrait panel (click the painting). body: Markdown → HTML. */
    about?: { title: string; body: string };
    /** The √−1 slate. body: Markdown → HTML. */
    story?: { title: string; body: string };
    /** Note pinned to the wall: Latin text, and its Tengwar rendering as font glyphs for the bundled Tengwar font. */
    tengwar?: { latin: string; glyphs: string; font: string };
    /** Contact form → encrypted Nostr DM. */
    nostr?: { npub: string; relays: string[]; placeholder?: boolean };
  };
  items: Item[];
}
