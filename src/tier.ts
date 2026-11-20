// Two visual tiers. 'lite' keeps the phone budget (baked light only, small sky, no galleon, no post-processing);
// 'full' adds the galleon fly-in, bloom, light shafts and the richer sky. Override with ?tier=lite or ?tier=full.
export type Tier = 'lite' | 'full';

function detect(): Tier {
  try {
    const q = new URLSearchParams(location.search).get('tier');
    if (q === 'lite' || q === 'full') return q;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const small = Math.min(screen.width, screen.height) < 700;
    const mem = (navigator as { deviceMemory?: number }).deviceMemory;
    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (saveData || (coarse && small) || (mem !== undefined && mem < 4)) return 'lite';
    return 'full';
  } catch {
    return 'lite';
  }
}

export const TIER: Tier = detect();
export const FULL = TIER === 'full';
