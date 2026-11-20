import type { Content, Item } from './types';

export async function loadContent(): Promise<Content> {
  const res = await fetch('/content.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`content.json: ${res.status}`);
  return res.json();
}

export const byOrder = (a: Item, b: Item) => a.order - b.order;

export function cartridges(c: Content, group: 'games' | 'ai' | 'tools'): Item[] {
  return c.items.filter(i => i.kind === 'cartridge' && i.group === group).sort(byOrder).slice(0, 10);
}
export const books = (c: Content) => c.items.filter(i => i.kind === 'book').sort(byOrder).slice(0, 14);
export const notebooks = (c: Content) => c.items.filter(i => i.kind === 'notebook').sort(byOrder).slice(0, 6);
/** Newest first. */
export const memoryCards = (c: Content) => c.items.filter(i => i.kind === 'memory-card').sort((a, b) => b.order - a.order);
/** Chronological. */
export const islands = (c: Content) => c.items.filter(i => i.kind === 'map-island' && i.map).sort(byOrder);

export function findItem(c: Content, id: string): Item | undefined {
  return c.items.find(i => i.id === id);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}
