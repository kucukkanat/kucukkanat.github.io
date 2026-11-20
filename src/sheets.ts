// Story sheets: the welcome letter, the portrait's About, the slate's story and the message-bottle contact form.
// Side cards on desktop, bottom sheets on phones (the dock hides while one is open: body:has(.panel.open)).
import type { Content } from './types';
import { escapeHtml as e } from './content';

export type SheetKind = 'letter' | 'about' | 'story' | 'contact';

const CLOSE = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

export interface SheetHooks {
  /** The sheet closed; `explore` = the visitor pressed "Start exploring" on the letter. */
  closed(kind: SheetKind, how: 'close' | 'explore'): void;
  openContact(): void;
}

export class Sheets {
  kind: SheetKind | null = null;
  private el: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private person: Content['person'];

  constructor(parent: HTMLElement, content: Content, private hooks: SheetHooks) {
    this.person = content.person;
    this.el = document.createElement('section');
    this.el.className = 'panel sheet';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'false');
    this.el.setAttribute('aria-labelledby', 'sheet-title');
    this.el.hidden = true;
    this.el.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); this.close(); } });
    parent.appendChild(this.el);
  }

  get isOpen() { return !!this.kind; }
  /** The sheet element (the inspector keeps the lifted letter clear of it). */
  get element() { return this.el; }

  open(kind: SheetKind) {
    const p = this.person;
    const el = this.el;
    if (!this.kind && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) this.returnFocus = document.activeElement;
    this.kind = kind;
    el.className = `panel sheet sheet-${kind}`;
    const close = `<button type="button" class="icon-btn close" aria-label="Close">${CLOSE}</button>`;
    switch (kind) {
      case 'letter': {
        const w = p.welcome ?? { title: 'Welcome aboard', body: `<p>${e(p.bio)}</p>`, signoff: 'HT' };
        el.innerHTML = `${close}
          <div class="kicker">A letter on the chart table</div>
          <h2 id="sheet-title" tabindex="-1">${e(w.title)}</h2>
          <div class="body">${w.body}</div>
          ${w.signoff ? `<p class="signoff">${e(w.signoff)}</p>` : ''}
          <div class="seal" aria-hidden="true"><span>HT</span></div>
          <div class="actions"><button type="button" class="btn primary" data-act="explore">Start exploring</button></div>`;
        break;
      }
      case 'about': {
        const a = p.about ?? { title: p.name, body: `<p>${e(p.bio)}</p>` };
        el.innerHTML = `${close}
          <div class="kicker">A portrait on the wall</div>
          <h2 id="sheet-title" tabindex="-1">${e(a.title)}</h2>
          <div class="body">${a.body}</div>
          <div class="actions">
            <button type="button" class="btn primary" data-act="contact">Send a message in a bottle</button>
            ${p.links.map(l => `<a class="btn" href="${e(l.url)}" target="_blank" rel="noopener">${e(l.label)}</a>`).join('')}
          </div>`;
        break;
      }
      case 'story': {
        const s = p.story ?? { title: '√−1', body: '' };
        el.innerHTML = `${close}
          <div class="kicker">Chalked on the slate</div>
          <h2 id="sheet-title" tabindex="-1">${e(s.title)}</h2>
          <div class="body">${s.body}</div>`;
        break;
      }
      case 'contact':
        el.innerHTML = `${close}${this.contactHTML()}`;
        this.wireContact();
        break;
    }
    el.querySelector('.close')!.addEventListener('click', () => this.close());
    el.querySelector('[data-act="explore"]')?.addEventListener('click', () => this.close('explore'));
    el.querySelector('[data-act="contact"]')?.addEventListener('click', () => this.hooks.openContact());
    el.querySelectorAll('.body a').forEach(a => { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); });
    el.scrollTop = 0;
    el.hidden = false;
    requestAnimationFrame(() => {
      el.classList.add('open');
      (el.querySelector('h2') as HTMLElement | null)?.focus({ preventScroll: true });
    });
  }

  close(how: 'close' | 'explore' = 'close', silent = false) {
    const kind = this.kind;
    if (!kind) return;
    this.kind = null;
    const el = this.el;
    el.classList.remove('open');
    setTimeout(() => { if (!this.kind) el.hidden = true; }, 260);
    const rf = this.returnFocus;
    this.returnFocus = null;
    if (rf && rf.isConnected) rf.focus({ preventScroll: true });
    if (!silent) this.hooks.closed(kind, how);
  }

  // ---------- contact ----------
  private contactHTML() {
    const p = this.person;
    const link = (label: string) => p.links.find(l => l.label.toLowerCase() === label.toLowerCase());
    const li = link('LinkedIn'), x = link('X');
    const npub = p.nostr?.npub ?? '';
    const short = npub.length > 24 ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : npub;
    return `
      <div class="kicker">Message in a bottle</div>
      <h2 id="sheet-title" tabindex="-1">Write to me</h2>
      <p class="sub">Your note goes to my Nostr inbox, end-to-end encrypted. No account, no email needed.</p>
      <form class="bottle-form" novalidate>
        <label><span>Message</span><textarea name="message" rows="4" maxlength="4000" required placeholder="Ahoy, HT…"></textarea></label>
        <div class="row">
          <label><span>Your name <em>(optional)</em></span><input name="name" maxlength="120" autocomplete="name" /></label>
          <label><span>How can I reach you back? <em>(optional)</em></span><input name="reach" maxlength="200" placeholder="email, @handle, npub…" /></label>
        </div>
        <div class="actions"><button type="submit" class="btn primary">Cork it and send</button></div>
        <p class="status" role="status" aria-live="polite"></p>
      </form>
      <div class="elsewhere">
        <span class="label">Or find me</span>
        ${li ? `<a class="btn" href="${e(li.url)}" target="_blank" rel="noopener">LinkedIn</a>` : ''}
        ${x ? `<a class="btn" href="${e(x.url)}" target="_blank" rel="noopener">X</a>` : ''}
        ${npub ? `<span class="npub"><a href="https://njump.me/${e(npub)}" target="_blank" rel="noopener" title="${e(npub)}">Nostr · ${e(short)}</a><button type="button" class="btn copy" data-act="copy" aria-label="Copy my npub">Copy</button></span>` : ''}
      </div>`;
  }

  private wireContact() {
    const el = this.el;
    const p = this.person;
    const form = el.querySelector('form') as HTMLFormElement;
    const status = el.querySelector('.status') as HTMLElement;
    const submit = form.querySelector('[type="submit"]') as HTMLButtonElement;
    const setStatus = (text: string, state: '' | 'sending' | 'sent' | 'failed' | 'demo') => { status.textContent = text; status.dataset.state = state; };
    // warm the Nostr code while the visitor types (not in the first-view bundle)
    if (p.nostr && !p.nostr.placeholder) void import('./nostr');
    el.querySelector('[data-act="copy"]')?.addEventListener('click', async ev => {
      const b = ev.currentTarget as HTMLButtonElement;
      try { await navigator.clipboard.writeText(p.nostr?.npub ?? ''); b.textContent = 'Copied'; }
      catch { b.textContent = 'Press ⌘C'; const a = el.querySelector('.npub a'); if (a) getSelection()?.selectAllChildren(a); }
      setTimeout(() => { b.textContent = 'Copy'; }, 1800);
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      const fd = new FormData(form);
      const msg = String(fd.get('message') ?? '').trim();
      const name = String(fd.get('name') ?? '').trim();
      const reach = String(fd.get('reach') ?? '').trim();
      if (!msg) { setStatus('The bottle is empty — write a line first.', 'failed'); (form.elements.namedItem('message') as HTMLElement).focus(); return; }
      if (!p.nostr?.npub) { setStatus('No inbox configured.', 'failed'); return; }
      if (p.nostr.placeholder) {
        setStatus('Demo mode — the captain hasn’t connected a Nostr inbox yet. Nothing was sent.', 'demo');
        return;
      }
      const text = [msg, '', `— ${name || 'a visitor'}${reach ? ` (reach me: ${reach})` : ''}`, 'via the message bottle on kucukkanat.com'].join('\n');
      submit.disabled = true;
      setStatus('Sending… the bottle is in the air.', 'sending');
      try {
        const { sendDM } = await import('./nostr');
        const r = await sendDM(p.nostr.npub, p.nostr.relays, text);
        if (r.ok > 0) {
          setStatus(`Sent — ${r.ok} of ${r.total} relays took it on board. Thank you!`, 'sent');
          form.reset();
        } else {
          console.warn('[bottle]', r.errors);
          setStatus('No relay answered. Try again in a moment, or find me on LinkedIn or X below.', 'failed');
        }
      } catch (err) {
        console.warn('[bottle]', err);
        setStatus('The bottle didn’t make it. Try again, or find me on LinkedIn or X below.', 'failed');
      } finally {
        submit.disabled = false;
      }
    });
  }
}
