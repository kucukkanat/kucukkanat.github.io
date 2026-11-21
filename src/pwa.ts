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

export function registerSW(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).has('nosw')) {
    void navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => void r.unregister()));
    return;
  }
  // after load, so the worker's precache never competes with the first view's downloads
  const go = () => setTimeout(() => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* offline-only feature */ }); }, 3000);
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}
