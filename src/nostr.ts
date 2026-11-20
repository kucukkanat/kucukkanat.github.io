// Message in a bottle → an encrypted Nostr DM to the captain. Loaded on demand (dynamic import) when the form opens.
// A throwaway key is made in the browser for every message; nothing is stored.
import { generateSecretKey, finalizeEvent, type NostrEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip17 from 'nostr-tools/nip17';
import { Relay } from 'nostr-tools/relay';

export interface SendResult { ok: number; total: number; method: 'nip17' | 'nip04'; errors: string[] }

const timeout = <T>(p: Promise<T>, ms: number, what: string) => new Promise<T>((res, rej) => {
  const id = setTimeout(() => rej(new Error(`${what}: timed out`)), ms);
  p.then(v => { clearTimeout(id); res(v); }, e => { clearTimeout(id); rej(e); });
});

export function decodeNpub(npub: string): string {
  const d = nip19.decode(npub.trim());
  if (d.type !== 'npub') throw new Error('not an npub');
  return d.data as string;
}

export async function sendDM(npub: string, relays: string[], message: string): Promise<SendResult> {
  const recipient = decodeNpub(npub);
  const sk = generateSecretKey();
  let event: NostrEvent;
  let method: SendResult['method'] = 'nip17';
  try {
    // NIP-17: kind-14 rumor, sealed (kind 13) and gift-wrapped (kind 1059, NIP-59) with a random key
    event = nip17.wrapEvent(sk, { publicKey: recipient }, message);
  } catch {
    // NIP-04 fallback (older clients only understand this)
    const nip04 = await import('nostr-tools/nip04');
    method = 'nip04';
    event = finalizeEvent({
      kind: 4, created_at: Math.floor(Date.now() / 1000), tags: [['p', recipient]],
      content: nip04.encrypt(sk, recipient, message),
    }, sk);
  }
  const errors: string[] = [];
  const results = await Promise.allSettled(relays.map(async url => {
    const relay = await timeout(Relay.connect(url), 6000, url);
    try { await timeout(relay.publish(event), 8000, url); }
    finally { try { relay.close(); } catch { /* ignore */ } }
  }));
  results.forEach((r, i) => { if (r.status === 'rejected') errors.push(`${relays[i]}: ${String((r.reason as Error)?.message ?? r.reason)}`); });
  return { ok: results.filter(r => r.status === 'fulfilled').length, total: relays.length, method, errors };
}
