"""Painted-diorama restyle of the tileable textures (numpy only, no Blender imports).

Every surface texture goes through the same three steps so the cabin and the galleon read as one hand-painted set:
  1. brush smoothing  -- a long blur along the grain and a short one across it: hairline photographic grain goes,
                         broad streaks stay and read as brush strokes;
  2. soft posterise   -- the tones snap to a few bands with soft edges (layered paint instead of a gradient);
  3. palette          -- the bands are mapped onto a four-stop ramp (cool shadow -> warm highlight) per material.
All filters wrap around, so a tileable input stays tileable.

PALETTE is the single colour source for both builds (blender/kit/materials.py and airship/kit.py).
"""
import numpy as np

# material -> (stops shadow..highlight in sRGB hex, grain axis 'v' | 'h' | None, stroke length px @1024, bands)
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
# accents that are flat colours in both builds (sRGB hex)
ACCENT = {"orange": "#E8652B", "cream": "#EADBB8", "ink": "#17110E", "iron": "#2B2A30", "teal": "#4FE0C8"}


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


def _gauss(a, sigma, axis):
    if sigma <= 0.3:
        return a
    r = max(1, int(3 * sigma))
    out = np.zeros_like(a)
    tot = 0.0
    for i in range(-r, r + 1):
        w = float(np.exp(-(i * i) / (2 * sigma * sigma)))
        out += w * np.roll(a, i, axis=axis)
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
    """Map t (0..1 array) onto the colour stops (sRGB), evenly spaced."""
    cols = np.stack([hex_srgb(s) for s in stops])
    n = len(stops) - 1
    x = np.clip(t, 0, 1) * n
    i = np.minimum(x.astype(int), n - 1)
    f = (x - i)[..., None]
    return cols[i] * (1 - f) + cols[i + 1] * f


def paint(rgb, name, seed=1):
    """rgb: HxWx3 float32 sRGB 0..1 (tileable). Returns the painted version in the palette of `name`."""
    stops, grain, stroke, bands = PALETTE[name]
    h, w = rgb.shape[:2]
    k = h / 1024.0
    lum = rgb @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    if grain == 'v':
        lum = _gauss(_gauss(lum, stroke * k, 0), 2.2 * k, 1)
    elif grain == 'h':
        lum = _gauss(_gauss(lum, stroke * k, 1), 2.2 * k, 0)
    else:
        lum = _gauss(_gauss(lum, stroke * k, 0), stroke * k, 1)
    lo, hi = np.percentile(lum, 1.5), np.percentile(lum, 98.5)
    t = np.clip((lum - lo) / max(hi - lo, 1e-4), 0, 1)
    # big soft patches of lighter / darker paint so large surfaces do not look printed
    # metals, leather and paper stay calm (mid tones, gentle mottling); wood keeps its full streak contrast
    c = {'Mahogany': 0.55, 'DarkWood': 0.6}.get(name, 0.8 if grain else 0.42)
    t = np.clip(0.5 + (t - 0.5) * c + (_noise(h, w, 3, seed) - 0.5) * (0.22 if grain else 0.16)
                + (_noise(h, w, 7, seed + 5) - 0.5) * 0.10, 0, 1)
    q = t * bands
    f = np.floor(q)
    e = np.clip((q - f - 0.5) / 0.34 + 0.5, 0, 1)
    e = e * e * (3 - 2 * e)
    t = np.clip((f + e) / bands, 0, 1)
    out = ramp(stops, t)
    # a little of the original local colour so it is not a pure duotone, and dabs of warm / cool
    src = _gauss(_gauss(rgb, 6 * k, 0), 6 * k, 1)
    mean = src.reshape(-1, 3).mean(0)
    out = out * (1 + 0.25 * (src / np.maximum(mean, 1e-3) - 1))
    warm = (_noise(h, w, 5, seed + 11) - 0.5)[..., None] * np.array([0.05, 0.0, -0.05], dtype=np.float32)
    return np.clip(out + warm, 0, 1).astype(np.float32)
