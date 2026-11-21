// Look tuning shared by the renderer paths. ?glow= ?contrast= ?sky= ?side= ?vig= override the defaults, for comparing looks.
const tune = (k: string, d: number) => {
  try { const v = parseFloat(new URLSearchParams(location.search).get(k) ?? ''); return Number.isFinite(v) ? v : d; } catch { return d; }
};
/** Bloom strength and light-shaft factor (1 = the original look). */
export const GLOW = tune('glow', 0.7);
/** Contrast around mid grey (1 = none). Full tier: in the colour grade; lite tier: in every material's output. */
export const CONTRAST = tune('contrast', 1.15);
/** Brightness of everything seen through the windows (sky, islands, clouds). */
export const SKY = tune('sky', 1);
/** Extra light on the side walls (bookcase, chest, rack, portrait): 0 = as baked. */
export const SIDE = tune('side', 0);
/** Edge darkening of the full tier's colour grade. */
export const VIG = tune('vig', 0.34);
