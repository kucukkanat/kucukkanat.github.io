// Whether the opening shot plays (kept apart from outside.ts so the main script does not pull that chunk in).
import { reducedMotion } from './anim';
import { FULL } from './tier';

export const INTRO_KEY = 'kk.intro.v1';

/** Should the opening shot play on this load? (?intro=1 forces it, ?intro=0 and deep links skip it.) */
export function wantsIntro(params: URLSearchParams, deepLink: boolean): boolean {
  const q = params.get('intro');
  if (q === '1') return true;
  if (q === '0' || !FULL || reducedMotion || deepLink) return false;
  try { return localStorage.getItem(INTRO_KEY) !== '1'; } catch { return false; }
}
