"""Painted-diorama filter, ported from the main site's blender/kit/paint.py (numpy only, no Blender imports).

PALETTE, ACCENT, ramp() and paint() are copied unchanged so the library room can reuse them for tileable textures.
paint_character() is the character variant: the main filter maps every texture onto one four-stop ramp, which suits
a wood or brass tile but would turn a whole character atlas (skin, beard, coat, leather) into one duotone. It keeps the
same three steps with the same constants where they apply:
  1. brush smoothing  -- short blur of the tones (no grain axis, like the main site's cloth/leather entries);
  2. soft posterise   -- the same band snapping with soft edges;
  3. palette          -- instead of a ramp lookup, local colour is kept and shadows are pulled toward the cabin's
                         cool BookBlue shadow and highlights toward the Brass highlight, plus the same warm/cool dabs.
The atlas is not tileable and its UV islands abut with no padding, so blurs stay short and clamp at the borders.
even_cloth() runs first: image-to-3D shades parts of the coat ~20% darker, and the posterise turned those into hard
dark blotches; it lifts them per UV island and locally (brighten-only), and paint_character(calm=mask) keeps the
cloth's own tone instead of snapping it to a band.
"""
import numpy as np

PALETTE = {
    "Mahogany":   (("#30151A", "#5C2921", "#86402A", "#B5653B"), 'v', 30, 5),
    "DarkWood":   (("#1C1418", "#2E2026", "#45302F", "#62453A"), 'v', 34, 5),
    "Planks":     (("#6A4129", "#996437", "#BF8849", "#DEAC66"), 'v', 26, 5),
    "WallPlanks": (("#3C2320", "#5C3728", "#7C4D33", "#9B6843"), 'v', 26, 5),
    "Brass":      (("#6A481D", "#A8792B", "#D9A63F", "#F7DA7C"), None, 9, 4),
    "Gilt":       (("#7A5520", "#BF8E30", "#EBBE4C", "#FFE99C"), None, 9, 4),
    "Leather":    (("#38201A", "#5C3424", "#804C31", "#A56B45"), None, 7, 4),
    "Cloth":      (("#48121A", "#721F20", "#992F27", "#BA4B36"), None, 5, 4),
    "Parchment":  (("#B3966A", "#D0B784", "#E5D1A2", "#F3E6C4"), None, 10, 4),
    "Sailcloth":  (("#B9A683", "#D6C6A0", "#EADDBB", "#F7EED6"), None, 10, 4),
    "BookRed":    (("#45131A", "#762122", "#A1392C", "#C4583E"), None, 6, 4),
    "BookGreen":  (("#15261E", "#223E2C", "#34573A", "#4F7651"), None, 6, 4),
    "BookBlue":   (("#131D33", "#1F2F4F", "#2F466E", "#4A658F"), None, 6, 4),
    "BookOchre":  (("#5A3A14", "#8C5F1E", "#B7862E", "#D9AC4E"), None, 6, 4),
    "BookPlum":   (("#2A1426", "#48213D", "#683356", "#8A4E74"), None, 6, 4),
    "BookTeal":   (("#102A2C", "#1B4546", "#2C6462", "#4A8782"), None, 6, 4),
}
ACCENT = {"orange": "#E8652B", "cream": "#EADBB8", "ink": "#17110E", "iron": "#2B2A30", "teal": "#4FE0C8"}

# room filter detail (1 = main-site look): stroke scale, extra tone bands, how much original grain comes back
DETAIL_STROKE = 0.4
DETAIL_BANDS = 3
DETAIL_GAIN = 0.55

# character filter settings (stroke in px @1024, like PALETTE)
CHAR_STROKE = 3.0
CHAR_BANDS = 6
CHAR_CALM = 0.85          # how much of the posterise to drop on the coat cloth (paint_character `calm` mask)
CHAR_SHADOW = PALETTE["BookBlue"][0][1]
CHAR_LIGHT = PALETTE["Brass"][0][3]
CLOTH_EVEN = 0.9          # how much of the coat's large-scale darkening to remove (0..1)
CLOTH_MAX_GAIN = 1.9      # never brighten a blotch more than this


def hex_srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def hex_lin(h):
    c = hex_srgb(h)
    return tuple(float(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


def mid_lin(name):
    """Linear RGB of the palette's mid tone (flat-colour fallback / vertex colour for `name`)."""
    s = PALETTE[name][0]
    a, b = np.array(hex_lin(s[1])), np.array(hex_lin(s[2]))
    return tuple(float(v) for v in (a + b) / 2)


def _gauss(a, sigma, axis, wrap=True):
    if sigma <= 0.3:
        return a
    r = max(1, int(3 * sigma))
    out = np.zeros_like(a)
    tot = 0.0
    if not wrap:
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r, r)
        a = np.pad(a, pad, mode='edge')
    for i in range(-r, r + 1):
        w = float(np.exp(-(i * i) / (2 * sigma * sigma)))
        out += w * (np.roll(a, i, axis=axis) if wrap else np.take(a, range(r + i, r + i + out.shape[axis]), axis=axis))
        tot += w
    return out / tot


def _noise(h, w, cells, seed):
    """Tileable value noise, `cells` periods across."""
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    ys = np.arange(h) * cells / h
    xs = np.arange(w) * cells / w
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y1, x1 = (y0 + 1) % cells, (x0 + 1) % cells
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx
    b = g[y1][:, x0] * (1 - fx) + g[y1][:, x1] * fx
    return a * (1 - fy)[:, None] + b * fy[:, None]


def ramp(stops, t):
    cols = np.stack([hex_srgb(s) for s in stops])
    n = len(stops) - 1
    x = np.clip(t, 0, 1) * n
    i = np.minimum(x.astype(int), n - 1)
    f = (x - i)[..., None]
    return cols[i] * (1 - f) + cols[i + 1] * f


def _soft_posterise(t, bands):
    q = t * bands
    f = np.floor(q)
    e = np.clip((q - f - 0.5) / 0.34 + 0.5, 0, 1)
    e = e * e * (3 - 2 * e)
    return np.clip((f + e) / bands, 0, 1)


def paint(rgb, name, seed=1):
    """Main-site filter, unchanged: rgb HxWx3 float32 sRGB 0..1 (tileable) -> painted in the palette of `name`."""
    stops, grain, stroke, bands = PALETTE[name]
    # finer than the main site's filter: smaller strokes and more tones, so the prop textures keep their grain up close
    stroke, bands = stroke * DETAIL_STROKE, bands + DETAIL_BANDS
    h, w = rgb.shape[:2]
    k = h / 1024.0
    lum = rgb @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    raw_lum = lum.copy()
    if grain == 'v':
        lum = _gauss(_gauss(lum, stroke * k, 0), 2.2 * k, 1)
    elif grain == 'h':
        lum = _gauss(_gauss(lum, stroke * k, 1), 2.2 * k, 0)
    else:
        lum = _gauss(_gauss(lum, stroke * k, 0), stroke * k, 1)
    lo, hi = np.percentile(lum, 1.5), np.percentile(lum, 98.5)
    t = np.clip((lum - lo) / max(hi - lo, 1e-4), 0, 1)
    c = {'Mahogany': 0.55, 'DarkWood': 0.6}.get(name, 0.8 if grain else 0.42)
    t = np.clip(0.5 + (t - 0.5) * c + (_noise(h, w, 3, seed) - 0.5) * (0.22 if grain else 0.16)
                + (_noise(h, w, 7, seed + 5) - 0.5) * 0.10, 0, 1)
    t = _soft_posterise(t, bands)
    # the original fine grain (what the blur took out), laid back over the painted tones
    detail = raw_lum - _gauss(_gauss(raw_lum, 3 * k, 0), 3 * k, 1)
    t = np.clip(t + detail * DETAIL_GAIN / max(hi - lo, 1e-4), 0, 1)
    out = ramp(stops, t)
    src = _gauss(_gauss(rgb, 6 * k, 0), 6 * k, 1)
    mean = src.reshape(-1, 3).mean(0)
    out = out * (1 + 0.25 * (src / np.maximum(mean, 1e-3) - 1))
    warm = (_noise(h, w, 5, seed + 11) - 0.5)[..., None] * np.array([0.05, 0.0, -0.05], dtype=np.float32)
    return np.clip(out + warm, 0, 1).astype(np.float32)


def _hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.zeros_like(mx)
    safe = np.maximum(d, 1e-6)
    h = np.where(mx == r, ((g - b) / safe) % 6, h)
    h = np.where(mx == g, (b - r) / safe + 2, h)
    h = np.where(mx == b, (r - g) / safe + 4, h)
    h = np.where(d < 1e-6, 0, h) / 6.0
    return h, d / np.maximum(mx, 1e-6), mx


def _down_blur_up(a, m, factor, sigma):
    """Mask-normalised blur of `a` over mask `m`, done at 1/factor resolution and upsampled (smooth, cheap)."""
    h, w = a.shape
    hs, ws = h // factor, w // factor
    a_s = (a * m)[:hs * factor, :ws * factor].reshape(hs, factor, ws, factor).mean((1, 3))
    m_s = m[:hs * factor, :ws * factor].reshape(hs, factor, ws, factor).mean((1, 3))
    a_s = _gauss(_gauss(a_s, sigma, 0, False), sigma, 1, False)
    m_s = _gauss(_gauss(m_s, sigma, 0, False), sigma, 1, False)
    low = a_s / np.maximum(m_s, 1e-4)
    up = np.repeat(np.repeat(low, factor, 0), factor, 1)
    return _gauss(_gauss(up, factor * 0.6, 0, False), factor * 0.6, 1, False)


def hue_mask(h, hue):
    """hue range [lo, hi] in 0..1; lo > hi wraps through red."""
    lo, hi = hue
    return ((h >= lo) | (h <= hi)) if lo > hi else ((h >= lo) & (h <= hi))


def even_cloth(rgb, islands, strength=CLOTH_EVEN, max_gain=CLOTH_MAX_GAIN, hue=(0.95, 0.04), min_s=0.30, min_v=0.06):
    """Lift dark blotches on the red coat cloth (image-to-3D shades whole atlas islands darker; posterise makes it worse).

    `islands` is an int HxW map of UV island ids (-1 = empty), the same layout as `rgb`. The blotches are whole
    islands, so each island that is mostly coat cloth gets one brighten-only gain towards the coat's median tone; a
    blur across the atlas would mix unrelated islands. Folds, trim and the bandana pattern keep their detail.
    Returns (rgb, mask)."""
    h, s, v = _hsv(rgb)
    red = hue_mask(h, hue).astype(np.float32)
    m = red * np.clip((s - min_s) / 0.15, 0, 1) * np.clip((v - min_v) / 0.06, 0, 1)
    lum = rgb @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    ids = islands.ravel()
    ok = ids >= 0
    n = int(ids.max()) + 1
    w_cloth = np.bincount(ids[ok], weights=m.ravel()[ok], minlength=n)
    w_all = np.bincount(ids[ok], minlength=n).astype(np.float64)
    l_cloth = np.bincount(ids[ok], weights=(m * lum).ravel()[ok], minlength=n)
    frac = w_cloth / np.maximum(w_all, 1)
    mean = l_cloth / np.maximum(w_cloth, 1e-6)
    coat = (frac > 0.35) & (w_cloth > 40)
    target = float(np.percentile(mean[coat], 60)) if coat.any() else 0.0
    gain_i = np.where(coat, np.clip(target / np.maximum(mean, 1e-3), 1.0, max_gain), 1.0)
    gain = np.ones_like(lum)
    gain.ravel()[ok] = gain_i[ids[ok]]
    # local evening inside the cloth: the blotches are ~20% darker patches a few dozen texels across, which the
    # posterise turns into hard dark shapes. Compare each pixel's small-scale tone with a wide cloth-only average.
    k = rgb.shape[0] / 1024.0
    lum_i = lum * gain
    mb = _gauss(_gauss(m, 3 * k, 0, False), 3 * k, 1, False)
    small = _gauss(_gauss(lum_i * m, 3 * k, 0, False), 3 * k, 1, False) / np.maximum(mb, 1e-4)
    wide = _down_blur_up(lum_i, m, 4, 6 * k)
    gain = gain * np.clip(wide / np.maximum(small, 1e-3), 1.0, max_gain)
    gain = 1 + (gain - 1) * strength * m
    return np.clip(rgb * gain[..., None], 0, 1).astype(np.float32), m


def paint_character(rgb, seed=1, stroke=CHAR_STROKE, bands=CHAR_BANDS, calm=None, calm_strength=CHAR_CALM,
                    calm_all=0.0, detail=0.0):
    """rgb: HxWx3 float32 sRGB 0..1 character atlas (not tileable). Returns the painted version, same local colours."""
    h, w = rgb.shape[:2]
    k = h / 1024.0
    W = np.array([0.3, 0.59, 0.11], dtype=np.float32)
    # 1. brush smoothing: colour softened a little, tone a little more
    src = _gauss(_gauss(rgb, 0.6 * stroke * k, 0, False), 0.6 * stroke * k, 1, False)
    lum = _gauss(_gauss(rgb @ W, stroke * k, 0, False), stroke * k, 1, False)
    # 2. soft posterise of the tone (layered paint), with the same gentle mottling as the main filter
    lo, hi = np.percentile(lum, 1.5), np.percentile(lum, 98.5)
    t = np.clip((lum - lo) / max(hi - lo, 1e-4), 0, 1)
    t = np.clip(t + (_noise(h, w, 7, seed + 5) - 0.5) * 0.06, 0, 1)
    tp = _soft_posterise(t, bands)
    # calm_all: keep this much of the source tone everywhere (less banding, more of the model's own shading)
    tp = tp + (t - tp) * calm_all
    if calm is not None:
        # on the coat cloth the tone sits on a band edge and its slight variation flips between bands (blotches);
        # keep the cloth's own (already evened) tone there. Any blur of this atlas mixes unrelated islands.
        tp = tp + (t - tp) * np.clip(calm, 0, 1) * calm_strength
    target = lo + tp * (hi - lo)
    out = src * (target / np.maximum(src @ W, 1e-3))[..., None]
    # 3. palette: cool shadows, warm highlights, warm/cool dabs
    shade = ((1 - tp) ** 2 * 0.14)[..., None]
    light = (tp ** 2 * 0.10)[..., None]
    out = out * (1 - shade) + hex_srgb(CHAR_SHADOW) * shade
    out = out * (1 - light) + hex_srgb(CHAR_LIGHT) * light
    # detail: lay back the fine marks the brush smoothing took out (stitches, buttons, beard strands)
    if detail:
        out = out + (rgb - src) * detail
    warm = (_noise(h, w, 5, seed + 11) - 0.5)[..., None] * np.array([0.04, 0.0, -0.04], dtype=np.float32)
    return np.clip(out + warm, 0, 1).astype(np.float32)
