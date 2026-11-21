// Whether the opening shot plays (kept apart from outside.ts so the main script does not pull that chunk in).
import { reducedMotion } from './anim';
import { FULL } from './tier';

export const INTRO_KEY = 'kk.intro.v1';

/** Should the opening shot play on this load? Only when asked for with ?intro=1: the galleon (~1 MB) would hold up
 *  the first view, so visitors land in the cabin and the ship streams in for the Outside view. */
export function wantsIntro(params: URLSearchParams, _deepLink: boolean): boolean {
  return params.get('intro') === '1' && FULL && !reducedMotion;
}
