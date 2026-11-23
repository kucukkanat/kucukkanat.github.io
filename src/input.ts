import * as THREE from 'three';

export interface InputHandlers {
  /** Return the objects to raycast for the current state. */
  targets(): THREE.Object3D[];
  /** `at`: the pointer (client px), given for mouse hover. */
  hover(hit: THREE.Intersection | null, at?: Point): void;
  click(hit: THREE.Intersection | null, at: Point): void;
  /** Drag starting on an object (or on nothing); return true to capture it (e.g. the wheel, an inspected item). */
  dragStart(hit: THREE.Intersection | null): boolean;
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  swipeDown(): void;
  escape(): void;
  look(x: number, y: number): void;
  /** Free drag (not on a captured object): fractions of the canvas width/height. */
  orbit(dxNorm: number, dyNorm: number): void;
  /** Zoom by a factor: <1 closer, >1 further. `at`: the point to zoom toward (client px), when there is one. */
  zoom(f: number, at?: Point): void;
  /** Slide the camera: fractions of the canvas width/height (two-finger drag, right/shift-drag, shift+arrows). */
  pan(dxNorm: number, dyNorm: number): void;
  /** Double-click / double-tap / "0": back to the view's own framing. `at`: where it was tapped (not for "0"). */
  reset(at?: Point): void;
}

export interface Point { x: number; y: number }

export interface InputOptions {
  /** Camera keys and Esc on the window (default true). Off for a second layer whose keys the first one forwards. */
  keys?: boolean;
  /**
   * Touches on controls over the canvas whose data-pass-gestures has this value count for gestures (default '': the
   * cabin's hotspots). false: none. Each gesture layer takes only its own controls' touches.
   */
  passThrough?: string | false;
}

/** Touches starting this close (px) to a side edge don't orbit (system back / app-switch gestures live there). */
const EDGE = 20;

/**
 * Pointer, wheel, pinch and keyboard input over the canvas, the same everywhere (cabin and library):
 *   one finger / left drag        look around (orbit)
 *   pinch / scroll                zoom (toward the fingers / the pointer)
 *   two fingers / right or shift-drag / shift+arrows   slide (pan)
 *   tap / click                   act on what is under it
 *   double-tap / double-click / 0 back to the view's own framing
 *   quick flick down / Esc        back
 */
export class Input {
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number; t: number; id: number; type: string; pan: boolean; edge: boolean; overlay: boolean } | null = null;
  private pinchMid = { x: 0, y: 0 };
  private captured = false;
  private moved = false;
  private pendingHover = false;
  private lastMove = { x: 0, y: 0 };
  private touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinched = false;
  private lastTap = 0;
  private lastTapAt = { x: 0, y: 0 };
  /** Touches that landed on a control drawn over the canvas (a hotspot dot): they still count for gestures. */
  private overlay = new Set<number>();
  /** Overlay touches that turned into a gesture: their button must not click when they lift. */
  private gestured = new Set<number>();
  private suppressClickUntil = 0;

  constructor(private el: HTMLElement, private camera: THREE.Camera, private h: InputHandlers, opts: InputOptions = {}) {
    el.style.touchAction = 'none'; // we handle pan/pinch ourselves
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', e => this.end(e));
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { h.hover(null); h.look(0, 0); } });
    el.addEventListener('contextmenu', e => e.preventDefault()); // right-drag pans
    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.shiftKey) { // shift + scroll / two-finger trackpad swipe with shift → pan
        const dx = e.deltaX || 0, dy = e.deltaX ? e.deltaY : 0;
        h.pan(-(dx || e.deltaY) / el.clientWidth * 0.6, -dy / el.clientHeight * 0.6);
        return;
      }
      // trackpad pinch arrives as ctrl+wheel with small deltas; mouse wheels as big steps
      const k = e.ctrlKey ? 0.01 : 0.0015;
      h.zoom(Math.exp(THREE.MathUtils.clamp(e.deltaY, -120, 120) * k), { x: e.clientX, y: e.clientY });
    }, { passive: false });
    el.addEventListener('dblclick', e => h.reset({ x: e.clientX, y: e.clientY }));
    // A finger on a control over the canvas ([data-pass-gestures], e.g. a hotspot dot) never reached the canvas, so
    // a pinch / pan / orbit with one finger there was seen as one finger or none. Route those touches here too:
    // a tap still clicks the button, anything more becomes a camera gesture and the click is swallowed.
    const pass = opts.passThrough ?? '';
    const through = (e: PointerEvent) => pass !== false && e.pointerType !== 'mouse' && e.target instanceof Element && e.target !== el && !!e.target.closest(`[data-pass-gestures="${pass}"]`);
    window.addEventListener('pointerdown', e => { if (through(e)) { this.overlay.add(e.pointerId); this.onDown(e); } }, true);
    window.addEventListener('pointermove', e => { if (this.overlay.has(e.pointerId) && e.target !== el) this.onMove(e); }, true);
    window.addEventListener('pointerup', e => { if (this.overlay.has(e.pointerId) && e.target !== el) this.onUp(e); }, true);
    window.addEventListener('pointercancel', e => { if (this.overlay.has(e.pointerId) && e.target !== el) this.end(e); }, true);
    window.addEventListener('click', e => {
      if (performance.now() < this.suppressClickUntil) { e.preventDefault(); e.stopPropagation(); this.suppressClickUntil = 0; }
    }, true);
    if (opts.keys !== false) window.addEventListener('keydown', e => {
      if (e.key === 'Escape') { h.escape(); return; }
      // camera keys only when nothing else (a panel, a button) has focus
      const a = document.activeElement;
      if (a && a !== document.body && a !== el) return;
      const step = 0.04;
      if (e.shiftKey && e.key.startsWith('Arrow')) {
        const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key as 'ArrowLeft'];
        if (d) { h.pan(d[0], d[1]); e.preventDefault(); }
        return;
      }
      switch (e.key) {
        case 'ArrowLeft': h.orbit(step, 0); break;
        case 'ArrowRight': h.orbit(-step, 0); break;
        case 'ArrowUp': h.orbit(0, step); break;
        case 'ArrowDown': h.orbit(0, -step); break;
        case '+': case '=': h.zoom(0.88); break;
        case '-': case '_': h.zoom(1 / 0.88); break;
        case '0': h.reset(); break;
        default: return;
      }
      e.preventDefault();
    });
  }

  private pick(x: number, y: number): THREE.Intersection | null {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hits = this.ray.intersectObjects(this.h.targets(), true);
    // an item held up for inspection is in front of everything; collectibles and props (egg) win over the
    // (bigger) hotspot volumes around them
    return hits.find(x => x.object.userData.inspected) ?? hits.find(x => x.object.userData.collectible) ?? hits.find(x => x.object.userData.egg) ?? hits[0] ?? null;
  }

  /** An overlay touch became a gesture: send its events to the canvas from now on (its button won't click). */
  private takeOver(id: number) {
    if (!this.overlay.has(id) || this.gestured.has(id)) return;
    this.gestured.add(id);
    try { this.el.setPointerCapture(id); } catch { /* already lifted */ }
  }

  private release(id: number) {
    if (this.gestured.delete(id)) this.suppressClickUntil = performance.now() + 450;
    this.overlay.delete(id);
  }

  private mid() {
    const [a, b] = [...this.touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private pinchSpan() {
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      // the first finger of a new touch: forget any finger whose lift we never saw (a ghost would turn the next
      // single-finger drag into a pinch, or a real pinch into nothing)
      if (e.isPrimary) { for (const id of this.touches.keys()) if (id !== e.pointerId) this.touches.delete(id); }
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        for (const id of this.touches.keys()) this.takeOver(id);
        // second finger: switch to pinch, cancel any drag/click in progress
        this.pinchDist = this.pinchSpan();
        this.pinchMid = this.mid();
        this.pinched = true;
        if (this.captured) this.h.dragEnd();
        this.captured = false;
        this.down = null;
        return;
      }
    }
    if (!e.isPrimary) return;
    const pan = e.pointerType === 'mouse' && (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey));
    if (e.pointerType === 'mouse' && e.button !== 0 && !pan) return;
    this.pinched = false;
    // a touch that starts at a side edge belongs to the system's back / app-switch gesture: it may still tap, but
    // it never turns the camera (no lurch while the browser takes the swipe)
    const edge = e.pointerType === 'touch' && (e.clientX < EDGE || e.clientX > innerWidth - EDGE);
    const overlay = this.overlay.has(e.pointerId);
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, type: e.pointerType, pan, edge, overlay };
    if (overlay) { this.lastMove = { x: e.clientX, y: e.clientY }; this.moved = false; return; } // its button handles a tap
    if (pan) { this.moved = false; this.lastMove = { x: e.clientX, y: e.clientY }; this.el.setPointerCapture?.(e.pointerId); return; }
    this.lastMove = { x: e.clientX, y: e.clientY };
    this.moved = false;
    const hit = this.pick(e.clientX, e.clientY);
    if (this.h.dragStart(hit)) {
      this.captured = true;
      this.el.setPointerCapture?.(e.pointerId);
    }
    if (e.pointerType !== 'mouse' && hit) this.h.hover(hit);
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        const d = this.pinchSpan(), m = this.mid();
        if (this.pinchDist > 0 && d > 0) this.h.zoom(this.pinchDist / d, m);
        this.h.pan((m.x - this.pinchMid.x) / this.el.clientWidth, (m.y - this.pinchMid.y) / this.el.clientHeight);
        this.pinchDist = d; this.pinchMid = m;
        return;
      }
    }
    if (!e.isPrimary) return;
    if (this.down) {
      const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y;
      if (Math.hypot(dx, dy) > 8) { this.moved = true; if (this.down.overlay) this.takeOver(e.pointerId); }
      const mx = e.clientX - this.lastMove.x, my = e.clientY - this.lastMove.y;
      if (this.down.pan) { if (this.moved) this.h.pan(mx / this.el.clientWidth, my / this.el.clientHeight); }
      else if (this.captured) this.h.drag(mx, my);
      else if (this.moved && !this.down.edge) this.h.orbit(mx / this.el.clientWidth, my / this.el.clientHeight);
    }
    this.lastMove = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'mouse') {
      // hovering only highlights things; the camera moves only on drag, scroll or keys
      if (!this.pendingHover && !this.down) {
        this.pendingHover = true;
        requestAnimationFrame(() => {
          this.pendingHover = false;
          if (!this.captured && !this.down) this.h.hover(this.pick(this.lastMove.x, this.lastMove.y), { ...this.lastMove });
        });
      }
    }
  };

  private end(e: PointerEvent) {
    this.touches.delete(e.pointerId);
    this.release(e.pointerId);
    if (this.touches.size < 2) this.pinchDist = 0;
    if (e.pointerId === this.down?.id) {
      this.down = null;
      if (this.captured) this.h.dragEnd();
      this.captured = false;
    }
  }

  private onUp = (e: PointerEvent) => {
    const wasPinch = this.pinched;
    this.touches.delete(e.pointerId);
    this.release(e.pointerId);
    if (this.touches.size < 2) this.pinchDist = 0;
    if (this.touches.size === 0) this.pinched = false;
    if (!e.isPrimary || !this.down || wasPinch) { if (e.pointerId === this.down?.id) this.down = null; return; }
    const d = this.down;
    this.down = null;
    if (d.pan) return; // a pan never clicks
    if (d.overlay && !this.moved) return; // a tap on a hotspot: the button's own click opens it
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const dt = performance.now() - d.t;
    if (this.captured) {
      this.captured = false;
      this.h.dragEnd();
      if (!this.moved) this.h.click(this.pick(e.clientX, e.clientY), { x: e.clientX, y: e.clientY });
      return;
    }
    if (!this.moved) {
      // double-tap on empty space resets the camera (dblclick covers the mouse); a tap on something always acts on
      // it at once and never counts towards a double-tap, so the reset can't follow an item opening
      const now = performance.now();
      const hit = this.pick(e.clientX, e.clientY);
      if (d.type !== 'mouse' && !hit) {
        if (now - this.lastTap < 300 && Math.hypot(e.clientX - this.lastTapAt.x, e.clientY - this.lastTapAt.y) < 40) {
          this.h.reset({ x: e.clientX, y: e.clientY }); this.lastTap = 0; return;
        }
        this.lastTap = now; this.lastTapAt = { x: e.clientX, y: e.clientY };
      } else this.lastTap = 0;
      this.h.click(hit, { x: e.clientX, y: e.clientY });
      return;
    }
    // a quick single-finger flick down → back (slow vertical drags tilt the camera instead)
    if (d.type !== 'mouse' && dy > 120 && Math.abs(dx) < dy * 0.5 && dt < 300) this.h.swipeDown();
  };
}
