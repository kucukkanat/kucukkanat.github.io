"""Painted cloud atlas for the sky (numpy only; Blender is used just to encode the WebP).

2 x 2 cells, each a 2:1 cloud: [0] heaped bank, [1] long low bank, [2] compact cumulus, [3] thin streak.
RGB = shade (0 shadow .. 1 sunlit, softly posterised like the cabin textures), A = coverage.
The app (src/sky.ts) maps the shade onto its own sunset / night / storm colour ramps.
"""
import math
import os
import random
import tempfile
import numpy as np

CELL_W, CELL_H = 512, 256
LIGHT = np.array([0.55, 0.62, 0.56])       # sun from the upper right, a little toward the viewer


def _gauss(a, sigma, axis):
    r = max(1, int(3 * sigma))
    k = np.exp(-(np.arange(-r, r + 1) ** 2) / (2 * sigma * sigma))
    k /= k.sum()
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r, r)
    ap = np.pad(a, pad, mode='edge')
    out = np.zeros_like(a)
    for i, w in enumerate(k):
        sl = [slice(None)] * a.ndim
        sl[axis] = slice(i, i + a.shape[axis])
        out += w * ap[tuple(sl)]
    return out


def blur(a, s):
    return _gauss(_gauss(a, s, 0), s, 1)


def _noise(h, w, cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells * 2 + 1))
    ys, xs = np.arange(h) * cells / h, np.arange(w) * cells * 2 / w
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    b = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return a * (1 - fy)[:, None] + b * fy[:, None]


def _env(kind, seed):
    """Silhouette height profile E(x) (x in 0..2) and base line y0 per cloud kind."""
    rnd = random.Random(seed * 7 + 1)
    if kind == 0:      # heaped bank: a few overlapping humps
        y0, humps = 0.2, [(0.95 + rnd.uniform(-0.1, 0.1), 0.62, 0.42), (0.5, 0.36, 0.3), (1.45, 0.4, 0.32),
                          (1.2 + rnd.uniform(-0.1, 0.1), 0.5, 0.2)]
    elif kind == 1:    # long low bank
        y0, humps = 0.24, [(0.45, 0.3, 0.3), (0.9, 0.36, 0.3), (1.35, 0.3, 0.3), (1.65, 0.24, 0.2), (0.7, 0.42, 0.14)]
    elif kind == 2:    # compact towering cumulus
        y0, humps = 0.18, [(1.0, 0.7, 0.3), (0.78, 0.5, 0.26), (1.25, 0.42, 0.22)]
    else:              # thin streak
        y0, humps = 0.4, [(0.6, 0.14, 0.4), (1.2, 0.17, 0.45), (1.6, 0.1, 0.25)]

    def E(x):
        return max(h * math.exp(-((x - c) / w) ** 2) for (c, h, w) in humps)
    return E, y0


def _puffs(kind, seed):
    rnd = random.Random(seed)
    E, y0 = _env(kind, seed)
    P = []
    n = {0: 90, 1: 90, 2: 60, 3: 80}[kind]
    rmax = {0: 0.15, 1: 0.11, 2: 0.16, 3: 0.085}[kind]
    tries = 0
    while len(P) < n and tries < n * 30:
        tries += 1
        cx = rnd.uniform(0.12, 1.88)
        e = E(cx)
        if e < 0.03:
            continue
        t = rnd.random() ** 0.7                  # more puffs toward the top edge
        r = (0.35 + 0.65 * rnd.random()) * rmax * min(1.0, 0.35 + e / 0.45) * (1.1 - 0.45 * t)
        cy = y0 + max(0.0, e * t - r * 0.75)
        P.append((cx, cy, r))
    return P, y0, E


def cloud(kind, seed, W=CELL_W, H=CELL_H):
    """-> (shade HxW, alpha HxW), row 0 = top."""
    P, y0, E = _puffs(kind, seed)
    x = (np.arange(W) + 0.5) / W * 2.0
    y = 1.0 - (np.arange(H) + 0.5) / H
    X, Y = np.meshgrid(x, y)
    Ex = np.array([E(v) for v in x])[None, :]
    # brush wobble: the outline is not made of perfect circles
    wob = (_noise(H, W, 6, seed + 1) - 0.5) * 0.045 + (_noise(H, W, 14, seed + 2) - 0.5) * 0.02
    z = np.zeros((H, W))
    sd = np.full((H, W), 9.0)
    for (cx, cy, r) in P:
        d2 = (X - cx) ** 2 + (Y - cy) ** 2
        # rounder, softer domes than a hemisphere; puffs higher in the cloud sit in front
        z = np.maximum(z, np.maximum(1 - d2 / (r * r), 0.0) ** 0.7 * r + 0.25 * (cy - y0))
        sd = np.minimum(sd, np.sqrt(d2) - r)
    sd = sd + wob
    alpha = np.clip(0.5 - sd / 0.035, 0, 1)
    alpha = alpha * alpha * (3 - 2 * alpha)
    # lighting from the height field
    zs = blur(z, 2.2)
    gy, gx = np.gradient(zs, 1.0 / H, 2.0 / W)
    gy = -gy                                   # rows go down, Y goes up
    n = np.stack([-gx, -gy, np.full_like(gx, 1.6)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    lam = np.clip(n @ LIGHT, 0, 1)
    up = np.clip((Y - y0) / np.maximum(Ex, 0.08), 0, 1)
    shade = 0.5 * lam + 0.5 * up ** 0.8 + (_noise(H, W, 9, seed + 3) - 0.5) * 0.16
    if kind == 3:
        shade = 0.6 + 0.4 * shade
    shade = np.clip(shade, 0, 1)
    # soft posterise (layered paint)
    bands = 5
    q = shade * bands
    f = np.floor(q)
    e = np.clip((q - f - 0.5) / 0.55 + 0.5, 0, 1)
    e = e * e * (3 - 2 * e)
    shade = blur(np.clip((f + e) / bands, 0, 1), 1.6)
    # misty bottom, soft outline, clean cell border
    base = np.clip((Y - (y0 - 0.16)) / 0.3, 0, 1)
    base = base * base * (3 - 2 * base)
    alpha = blur(alpha, 2.0) * base * np.clip((Y - 0.02) / 0.06, 0, 1)
    edge = np.clip(np.minimum(X, 2 - X) / 0.06, 0, 1) * np.clip((1 - Y) / 0.04, 0, 1)
    alpha *= edge
    if kind == 3:
        alpha *= 0.75
    # keep sensible shade under transparent pixels (no dark fringes when filtered)
    shade = np.where(alpha > 0.02, shade, blur(shade, 6))
    return shade, alpha


def atlas():
    """-> RGBA float array (2*CELL_H, 2*CELL_W, 4), row 0 = top."""
    A = np.zeros((CELL_H * 2, CELL_W * 2, 4), np.float32)
    for k, seed in enumerate((11, 23, 37, 41)):
        s, a = cloud(k, seed)
        r, c = divmod(k, 2)
        cell = A[r * CELL_H:(r + 1) * CELL_H, c * CELL_W:(c + 1) * CELL_W]
        cell[..., 0] = cell[..., 1] = cell[..., 2] = s
        cell[..., 3] = a
    return A


def encode_webp(rgba, quality=82, keep=None):
    """Encode with Blender's image writer. Returns bytes."""
    import bpy
    h, w = rgba.shape[:2]
    img = bpy.data.images.new("sky_clouds_tmp", w, h, alpha=True)
    img.alpha_mode = 'STRAIGHT'
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).reshape(-1).astype(np.float32))
    path = keep or os.path.join(tempfile.gettempdir(), "sky_clouds_tmp.webp")
    img.filepath_raw = path
    img.file_format = 'WEBP'
    try:
        img.save(quality=quality)
    except TypeError:
        img.save()
    bpy.data.images.remove(img)
    with open(path, 'rb') as f:
        data = f.read()
    if not keep:
        os.remove(path)
    return data
