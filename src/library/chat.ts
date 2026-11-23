// Parchment speech panel: the Librarian's words (typed out as he speaks) and a text box.
export class Chat {
  readonly el: HTMLElement;
  private words: HTMLElement;
  private input: HTMLInputElement;
  private button: HTMLButtonElement;
  private pending = '';
  private chipsEl!: HTMLElement;
  private hintEl!: HTMLElement;
  onSend?: (text: string) => void;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'parchment chat';
    this.el.innerHTML = `
      <div class="who">The Librarian</div>
      <div class="words" aria-live="polite"></div>
      <div class="chips" role="group" aria-label="Suggestions"></div>
      <form class="ask"><span class="field"><input type="text" placeholder="Ask about a subject, e.g. anything on game dev?" autocomplete="off" maxlength="300" aria-describedby="ask-hint" />
      <span class="hint" id="ask-hint" aria-live="polite"></span></span>
      <button type="submit">Ask</button></form>`;
    parent.appendChild(this.el);
    this.words = this.el.querySelector('.words')!;
    this.input = this.el.querySelector('input')!;
    this.button = this.el.querySelector('button[type=submit]')!;
    this.chipsEl = this.el.querySelector('.chips')!;
    this.hintEl = this.el.querySelector('.hint')!;
    this.el.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault();
      const t = this.input.value.trim();
      if (!t || this.button.disabled) return;
      this.input.value = '';
      this.onSend?.(t);
    });
  }

  startReply() { this.words.textContent = ''; this.pending = ''; }
  /** Queue text; `tick` reveals it at the speaking pace. */
  add(text: string) { this.pending += text; }
  tick(chars: number) {
    if (!this.pending || chars <= 0) return;
    this.words.textContent += this.pending.slice(0, chars);
    this.pending = this.pending.slice(chars);
  }
  flush() { this.tick(this.pending.length); }
  say(text: string) { this.words.textContent = text; this.pending = ''; }
  setBusy(b: boolean) { this.button.disabled = b; this.el.classList.toggle('busy', b); this.input.placeholder = b ? 'The Librarian is busy…' : 'Ask about another subject…'; }
  focus() { this.input.focus(); }

  /** Tappable suggestions under the reply (subjects, "what do you have?", the catalogue). */
  setChips(chips: { label: string; title?: string; onPick: () => void }[]) {
    this.chipsEl.replaceChildren(...chips.map(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = c.label;
      if (c.title) b.title = c.title;
      b.addEventListener('click', () => { if (!this.button.disabled) c.onPick(); });
      return b;
    }));
  }

  /** What the words typed so far would find, shown at the end of the box ("→ Game Development"). */
  setHint(text: string | null) {
    this.hintEl.textContent = text ? `→ ${text}` : '';
    this.el.classList.toggle('hinting', !!text);
  }
  get typed() { return this.input.value; }
}
