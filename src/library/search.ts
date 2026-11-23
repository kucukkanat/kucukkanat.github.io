// Finding the right book from loose words: subject keywords, titles, note titles, a few synonyms, typos (edit
// distance) and, while the visitor is still typing, the start of the last word. Also says which note matched
// best, so "fix your timestep" opens Game Development at that note.
import type { Note, Topic } from './types';

export interface Hit { topic: Topic; note?: Note; score: number }
export interface SearchResult { best: Hit | null; near: Topic[] }

const STOP = new Set(`a an the of on in at about to for and or me i you any anything something some tell show
  have has got do does what whats is are was how with my your please want need know books book note notes
  there their this that it its can could would like more from by be into without not then real small than`.split(/\s+/));

/** Everyday words mapped onto the vocabulary of the shelves. */
const SYNONYMS: Record<string, string[]> = {
  gaming: ['game'], videogame: ['game'], videogames: ['game'], indie: ['game'], jams: ['jam'],
  physics: ['timestep'], loop: ['timestep'], framerate: ['timestep'], fps: ['timestep'], juice: ['juice'],
  graphics: ['render'], gpu: ['shader'], opengl: ['webgl'], glsl: ['shader'], lighting: ['lightmaps'],
  modelling3d: ['blender'], animation: ['rig'], python: ['bpy'],
  llm: ['ai'], llms: ['ai'], gpt: ['ai'], chatgpt: ['ai'], ml: ['ai'], artificial: ['ai'], intelligence: ['ai'],
  machine: ['ai'], caching: ['caching'], anthropic: ['claude'],
  javascript: ['typescript'], deno: ['bun'], bundler: ['build'], frontend: ['framework'], react: ['framework'],
  web3: ['decentralised'], p2p: ['decentralised'], bitcoin: ['nostr'], login: ['sign'], auth: ['sign'], dm: ['messages'],
  leader: ['lead'], leading: ['lead'], managing: ['management'], boss: ['manager'], onboarding: ['team'],
  meetings: ['one'], interview: ['hiring'], recruiting: ['hiring'],
  plane: ['aviation'], planes: ['aviation'], aircraft: ['aviation'], zeppelin: ['airship'], blimp: ['airship'],
  navigation: ['reckoning'], estimate: ['estimates'], estimation: ['estimates'],
  elves: ['elvish'], elf: ['elvish'], hobbit: ['tolkien'], runes: ['tengwar'], font: ['fonts'], fonts: ['fonts'],
  algebra: ['maths'], trigonometry: ['maths'], trig: ['maths'], calculus: ['maths'], complex: ['imaginary'],
  rotation: ['quaternions'], rotations: ['quaternions'], square: ['root'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.+# ]+/g, ' ').replace(/\s+/g, ' ').trim();
const stem = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const words = (s: string) => norm(s).split(' ').filter(w => w && !STOP.has(w));

function dist(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

interface Entry { word: string; w: number; note?: Note }

export class Search {
  private vocab = new Map<Topic, Entry[]>();
  private phrases = new Map<Topic, string[]>();

  constructor(private topics: Topic[]) {
    for (const t of topics) {
      const e: Entry[] = [];
      const add = (word: string, w: number, note?: Note) => { const s = stem(word); if (s.length > 1 && !STOP.has(s)) e.push({ word: s, w, note }); };
      for (const k of t.keywords) for (const w of norm(k).split(' ')) add(w, 3);
      for (const w of words(t.title)) add(w, 2);
      for (const n of t.notes) for (const w of words(n.title)) add(w, 1.5, n);
      this.vocab.set(t, e);
      this.phrases.set(t, t.keywords.filter(k => k.includes(' ')).map(norm));
    }
  }

  /** `typing`: the last word may be unfinished, so it also matches the start of a word. */
  find(text: string, typing = false): SearchResult {
    const q = norm(text);
    const raw = words(text);
    const last = raw.length ? raw[raw.length - 1] : '';
    const terms: { word: string; partial: boolean }[] = [];
    for (const w of raw) {
      const s = stem(w);
      terms.push({ word: s, partial: typing && w === last && !q.endsWith(' ') });
      for (const syn of SYNONYMS[w] ?? SYNONYMS[s] ?? []) terms.push({ word: stem(syn), partial: false });
    }
    const hits: Hit[] = [];
    for (const t of this.topics) {
      let score = 0;
      const noteScore = new Map<Note, number>();
      for (const term of terms) {
        // the best entry for this term (each term counts once per topic)
        let best = 0;
        for (const e of this.vocab.get(t)!) {
          let m = 0;
          if (e.word === term.word) m = 1;
          else if (term.partial && term.word.length >= 3 && e.word.startsWith(term.word)) m = 0.7;
          else if (term.word.length >= 4 && dist(term.word, e.word, term.word.length >= 7 ? 2 : 1) <= (term.word.length >= 7 ? 2 : 1)) m = 0.6;
          if (m * e.w > best) best = m * e.w;
          if (m && e.note) noteScore.set(e.note, Math.max(noteScore.get(e.note) ?? 0, 0) + m * e.w);
        }
        score += best;
      }
      for (const p of this.phrases.get(t)!) if (q.includes(p)) score += 4;
      if (score <= 0) continue;
      let note: Note | undefined, ns = 0;
      for (const [n, s] of noteScore) if (s > ns) { ns = s; note = n; }
      // a note wins when its words carry the match (at least one distinctive word, not just the subject)
      hits.push({ topic: t, score, note: note && ns >= 1.5 && ns >= score * 0.5 ? note : undefined });
    }
    hits.sort((a, b) => b.score - a.score);
    const best = hits[0] && hits[0].score >= 1.4 ? hits[0] : null;
    return { best, near: hits.filter(h => h !== best).slice(0, 3).map(h => h.topic) };
  }
}
