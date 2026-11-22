import * as THREE from 'three';

export interface InputHandlers {
  /** Return the objects to raycast for the current state. */
  targets(): THREE.Object3D[];
  hover(hit: THREE.Intersection | null): void;
  click(hit: THREE.Intersection | null): void;
  /** Drag starting on an object (or on nothing); return true to capture it (e.g. the wheel, an inspected item). */
  dragStart(hit: THREE.Intersection | null): boolean;
  drag(dx: number, dy: number): void;
  dragEnd(): void;
  swipeDown(): void;
  escape(): void;
  look(x: number, y: number): void;
  /** Free drag (not on a captured object): fractions of the canvas width/height. */
  orbit(dxNorm: number, dyNorm: number): void;
  /** Zoom by a factor: <1 closer, >1 further. */
  zoom(f: number): void;
  /** Slide the camera: fractions of the canvas width/height (two-finger drag, right/shift-drag, shift+arrows). */
  pan(dxNorm: number, dyNorm: number): void;
  /** Double-click / double-tap / "0": back to the view's own framing. */
  reset(): void;
}

/** Touches starting this close (px) to a side edge don't orbit (system back / app-switch gestures live there). */
const EDGE = 20;

/** Pointer, wheel, pinch and keyboard input over the canvas. */
export class Input {
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private down: { x: number; y: number; t: number; id: number; type: string; pan: boolean; edge: boolean } | null = null;
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

  constructor(private el: HTMLElement, private camera: THREE.Camera, private h: InputHandlers) {
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
      h.zoom(Math.exp(THREE.MathUtils.clamp(e.deltaY, -120, 120) * k));
    }, { passive: false });
    el.addEventListener('dblclick', () => h.reset());
    window.addEventListener('keydown', e => {
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
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
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
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, type: e.pointerType, pan, edge };
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
        if (this.pinchDist > 0 && d > 0) this.h.zoom(this.pinchDist / d);
        this.h.pan((m.x - this.pinchMid.x) / this.el.clientWidth, (m.y - this.pinchMid.y) / this.el.clientHeight);
        this.pinchDist = d; this.pinchMid = m;
        return;
      }
    }
    if (!e.isPrimary) return;
    if (this.down) {
      const dx = e.clientX - this.down.x, dy = e.clientY - this.down.y;
      if (Math.hypot(dx, dy) > 8) this.moved = true;
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
          if (!this.captured && !this.down) this.h.hover(this.pick(this.lastMove.x, this.lastMove.y));
        });
      }
    }
  };

  private end(e: PointerEvent) {
    this.touches.delete(e.pointerId);
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
    if (this.touches.size < 2) this.pinchDist = 0;
    if (this.touches.size === 0) this.pinched = false;
    if (!e.isPrimary || !this.down || wasPinch) { if (e.pointerId === this.down?.id) this.down = null; return; }
    const d = this.down;
    this.down = null;
    if (d.pan) return; // a pan never clicks
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const dt = performance.now() - d.t;
    if (this.captured) {
      this.captured = false;
      this.h.dragEnd();
      if (!this.moved) this.h.click(this.pick(e.clientX, e.clientY));
      return;
    }
    if (!this.moved) {
      // double-tap on empty space resets the camera (dblclick covers the mouse); a tap on something always acts on
      // it at once and never counts towards a double-tap, so the reset can't follow an item opening
      const now = performance.now();
      const hit = this.pick(e.clientX, e.clientY);
      if (d.type !== 'mouse' && !hit) {
        if (now - this.lastTap < 300 && Math.hypot(e.clientX - this.lastTapAt.x, e.clientY - this.lastTapAt.y) < 40) {
          this.h.reset(); this.lastTap = 0; return;
        }
        this.lastTap = now; this.lastTapAt = { x: e.clientX, y: e.clientY };
      } else this.lastTap = 0;
      this.h.click(hit);
      return;
    }
    // a quick single-finger flick down → back (slow vertical drags tilt the camera instead)
    if (d.type !== 'mouse' && dy > 120 && Math.abs(dx) < dy * 0.5 && dt < 300) this.h.swipeDown();
  };
}
