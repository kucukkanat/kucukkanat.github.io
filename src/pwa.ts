// Installable-app plumbing shared by the cabin and the whale viewer: no page zoom on touch screens, and the
// service worker (production builds only; dist/sw.js is written by scripts/build-sw.ts).

/** Stop the page itself from zooming. The 3D views handle pinch themselves; iOS Safari ignores
 *  `user-scalable=no`, so its gesture events and multi-finger touchmoves are cancelled here too. */
export function lockZoom(): void {
  const stop = (e: Event) => e.preventDefault();
  // WebKit's proprietary pinch events (iOS Safari, also desktop Safari trackpads)
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  // a second finger on anything that is not a scroller we own: no page pinch
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // double-tap zoom is off via `touch-action: manipulation` in the CSS (cancelling touchend would eat clicks)
}

/** The on-screen keyboard: iOS overlays it without resizing the page, so publish how much of the bottom it covers
 *  (--kb) and the visible height (--vvh) for the bottom sheets and search to stay above it. */
export function trackKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  const update = () => {
    const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
    root.setProperty('--kb', `${kb > 60 ? kb : 0}px`); // small differences are toolbars, not a keyboard
    root.setProperty('--vvh', `${Math.round(vv.height)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

export function registerSW(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).has('nosw')) {
    void navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => void r.unregister()));
    return;
  }
  // after load, so the worker's precache never competes with the first view's downloads
  // a deploy while the app is open: the new worker takes over at once, the page offers a reload (the open page keeps
  // running its own version until then; inside an iframe, e.g. a cartridge, nothing is shown)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && window.top === window) showUpdateToast(); });
  const go = () => setTimeout(() => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* offline-only feature */ }); }, 3000);
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}

function showUpdateToast() {
  if (document.querySelector('.update-toast')) return;
  const el = document.createElement('div');
  el.className = 'update-toast';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span>New cabin ready</span><button type="button">Reload</button><button type="button" class="x" aria-label="Dismiss">✕</button>';
  const [reload, dismiss] = el.querySelectorAll('button');
  reload.addEventListener('click', () => location.reload());
  dismiss.addEventListener('click', () => { el.classList.remove('on'); setTimeout(() => el.remove(), 300); });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));
}
