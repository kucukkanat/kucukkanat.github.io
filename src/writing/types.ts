// The contract between the notes build (scripts/build-notes.ts) and the app (src/writing/*). Change it here first.
//
// Source:  content/notes/<slug>.md   (frontmatter: title, date, updated?, topic, tags[], stage, series?{id,name,order}, lang, excerpt?)
//          content/topics/<id>.md    (frontmatter: title, colour, order; body = blurb)
// Output:  public/notes.json         NotesIndex (metadata only, no bodies)
//          public/notes/<slug>.json  NoteBody   (rendered HTML)
//          /writing/                 static index page (all notes; the plain, crawlable version)
//          /writing/<slug>/          one static page per note (canonical URL, Article JSON-LD, "Open in the cabin" link)
//          /writing/topic/<id>/      one static page per topic
//          /pagefind/                Pagefind index built over the /writing/ pages
// In the 3D app a note is addressed with the query string, kept in sync with the History API:
//          /?note=<slug>   /?topic=<id>   /?index=1   (optionally &q=<search words> to highlight)
// Slugs are unique across languages (a Turkish note has its own slug) and are lower-case ASCII with dashes.

export type Stage = 'seedling' | 'growing' | 'evergreen';
export type Lang = 'en' | 'tr';

export interface NoteMeta {
  slug: string;
  title: string;
  lang: Lang;
  /** ISO date (YYYY-MM-DD) first published, and last substantial update if any. */
  date: string;
  updated?: string;
  /** Topic id (one per note). */
  topic: string;
  tags: string[];
  stage: Stage;
  series?: { id: string; name: string; order: number };
  /** One or two plain-text sentences (from frontmatter, else the first paragraph). */
  excerpt: string;
  words: number;
  /** Reading time in whole minutes (>= 1). */
  minutes: number;
  /** Slugs this note links to with [[wiki links]] (resolved, existing notes only). */
  links: string[];
  /** Slugs of notes that link to this one. */
  backlinks: string[];
  /** Static page path: `/writing/<slug>/`. */
  url: string;
}

export interface Topic {
  id: string;
  title: string;
  /** Cover colour of the topic's book on the shelf (#rrggbb). */
  colour: string;
  /** Plain text, one or two sentences. */
  blurb: string;
  order: number;
  /** Slugs of the topic's notes, newest first. */
  notes: string[];
}

export interface Series { id: string; name: string; /** Slugs in reading order. */ notes: string[]; }

export interface NotesIndex {
  generated: string;
  topics: Topic[];
  /** Newest first. */
  notes: NoteMeta[];
  series: Series[];
}

export interface NoteBody {
  slug: string;
  /** Sanitised HTML of the note body (no <h1>; headings start at <h2>, each with an id). [[links]] are
   *  <a class="wikilink" href="/writing/<slug>/" data-note="<slug>">; missing targets are <span class="wikilink missing">. */
  html: string;
  toc: { id: string; text: string; level: 2 | 3 }[];
}
