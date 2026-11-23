// The Librarian's brain: given the conversation, stream what he says and does. ScriptedBrain works offline;
// ClaudeBrain (worker/) can replace it without touching the rest of the app.
export interface Msg { role: 'user' | 'librarian'; text: string }

export type Emote = 'nod' | 'shrug' | 'think' | 'point' | 'wave';

export type BrainEvent =
  | { type: 'text'; delta: string }
  | { type: 'emote'; kind: Emote }
  | { type: 'fetch_book'; topicId: string }
  | { type: 'recommend_notes'; slugs: string[] }
  | { type: 'suggest_books'; topicIds: string[] };     // no exact match: these are the closest (they glow)

export interface LibrarianBrain {
  reply(history: Msg[], userText: string): AsyncIterable<BrainEvent>;
}

export interface Note { slug: string; title: string }
export interface Topic { id: string; title: string; short?: string; colour: string; keywords: string[]; notes: Note[] }
