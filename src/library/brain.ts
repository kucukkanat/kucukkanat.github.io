// Offline brain: search over the captain's topics and notes, in the Librarian's voice. He keeps the library for his
// old friend the captain, whose notes these are: warm, plain, a nautical wink, the odd jab at the captain.
import type { BrainEvent, LibrarianBrain, Msg, Topic } from './types';
import { Search } from './search';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const GREET = /\b(hi|hello|hey|ahoy|merhaba|good (morning|evening|afternoon))\b/;
const THANKS = /\b(thanks|thank you|cheers|ta)\b/;
const LIST = /\b(what|which)\b.*\b(have|got|topics|books|shelves|subjects|cover)\b|\b(list|catalogue|catalog|everything)\b/;

export class ScriptedBrain implements LibrarianBrain {
  readonly search: Search;
  constructor(private topics: Topic[], private wordDelay = 45) { this.search = new Search(topics); }

  /** Best topic for a question, or null (also used while the visitor types). */
  match(text: string, typing = false): Topic | null { return this.search.find(text, typing).best?.topic ?? null; }

  async *reply(_history: Msg[], userText: string): AsyncIterable<BrainEvent> {
    const q = userText.toLowerCase();
    const found = this.search.find(userText);
    const topic = found.best?.topic;
    if (topic && found.best?.note) {
      const note = found.best.note;
      yield { type: 'emote', kind: 'nod' };
      yield* this.say(pick([
        `"${note.title}"? The captain filed that under ${topic.title}. I'll fetch it and mark the page for you.`,
        `Ah, "${note.title}". One of the captain's better ones, in ${topic.title}. One moment.`,
      ]));
      yield { type: 'fetch_book', topicId: topic.id };
      yield { type: 'recommend_notes', slugs: [note.slug] };
      return;
    }
    if (topic) {
      yield { type: 'emote', kind: 'nod' };
      const n = topic.notes.length;
      yield* this.say(pick([
        `${topic.title}? Aye, the captain wrote ${n} note${n === 1 ? '' : 's'} on that. Let me fetch the volume.`,
        `Ah, ${topic.title}. I know just the shelf; I put it there myself, the captain never puts anything back.`,
        `${topic.title} it is. ${n} note${n === 1 ? '' : 's'} in the captain's hand; I'll bring the book down.`,
      ]));
      yield { type: 'fetch_book', topicId: topic.id };
      yield { type: 'recommend_notes', slugs: topic.notes.map(x => x.slug) };
      return;
    }
    if (GREET.test(q)) {
      yield { type: 'emote', kind: 'wave' };
      yield* this.say(`Ahoy, and welcome below deck. I keep the captain's library. Ask me about anything, say ${list(this.topics.slice(0, 2).map(t => t.title))}, and I'll fetch you the right volume.`);
      return;
    }
    if (THANKS.test(q)) {
      yield { type: 'emote', kind: 'nod' };
      yield* this.say(`My pleasure. The shelves are always open.`);
      return;
    }
    if (LIST.test(q)) {
      yield { type: 'emote', kind: 'point' };
      yield { type: 'suggest_books', topicIds: this.topics.map(t => t.id) };
      yield* this.say(`The books with brass plates are the captain's: ${list(this.topics.map(t => t.title))}. Which one shall I bring down? The card catalogue on the table lists them all.`);
      return;
    }
    // no dead ends: the closest subjects (or a few at random), glowing on the shelf
    yield { type: 'emote', kind: 'shrug' };
    const near = found.near.length ? found.near : [];
    const ideas = [...near, ...shuffle(this.topics.filter(t => !near.includes(t)))].slice(0, 3);
    yield { type: 'suggest_books', topicIds: ideas.map(t => t.id) };
    yield* this.say(near.length
      ? `Not quite that, I'm afraid. The closest the captain has: ${list(ideas.map(t => t.title), 'or')}. They're glowing on the shelf.`
      : `The captain hasn't written on that yet. Perhaps ${list(ideas.map(t => t.title), 'or')}? They're glowing on the shelf.`);
  }

  private async *say(text: string): AsyncIterable<BrainEvent> {
    const words = text.split(/(?<= )/);
    for (const w of words) {
      if (this.wordDelay > 0) await sleep(this.wordDelay);
      yield { type: 'text', delta: w };
    }
  }
}

/** "a, b and c" (or "or"). */
const list = (xs: string[], and = 'and') => xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`;
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const shuffle = <T>(xs: T[]) => xs.map(x => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]);
