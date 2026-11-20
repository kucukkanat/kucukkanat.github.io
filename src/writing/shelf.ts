// The bookshelf in a digital garden: one volume per topic. Each topic becomes a book on the main shelf row; the
// older stand-alone books (external essays) move down to the notebook row so nothing disappears.
import type { Content, Item } from '../types';
import type { NotesIndex } from './types';

export const TOPIC_PREFIX = 'topic--';
export const topicItemId = (topicId: string) => TOPIC_PREFIX + topicId;
export const topicOf = (itemId: string) => (itemId.startsWith(TOPIC_PREFIX) ? itemId.slice(TOPIC_PREFIX.length) : null);

/** Fetch the notes index for the first view (small; absent when there are no notes yet). */
export async function loadNotesIndex(): Promise<NotesIndex | null> {
  try {
    const res = await fetch('/notes.json', { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const idx = await res.json() as NotesIndex;
    return Array.isArray(idx.topics) && Array.isArray(idx.notes) ? idx : null;
  } catch {
    return null;
  }
}

/** Add a book per topic (with at least one note) to the content, in topic order. */
export function shelveTopics(content: Content, index: NotesIndex | null): Content {
  if (!index) return content;
  const topics = index.topics.filter(t => t.notes.length).sort((a, b) => a.order - b.order);
  if (!topics.length) return content;
  const items: Item[] = content.items.map(i => (i.kind === 'book' ? { ...i, kind: 'notebook', order: i.order - 100 } : i));
  topics.forEach((t, i) => {
    const n = t.notes.length;
    items.push({
      id: topicItemId(t.id), kind: 'book', title: t.title, subtitle: `${n} ${n === 1 ? 'note' : 'notes'}`,
      order: i, colour: t.colour, tags: ['topic'], body: `<p>${t.blurb.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p>`,
    });
  });
  return { ...content, items };
}
