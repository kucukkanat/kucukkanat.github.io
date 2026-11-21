"""Procedural painted textures (numpy). Image arrays are (rows=v, cols=u, 4) with row 0 = v=0 (Blender convention)."""
import math
import numpy as np
from .util import grid_fbm, smoothstep, hex2rgb, TAU


def _c(h):
    return np.array(hex2rgb(h), float)


def _lerp(a, b, t):
    t = t[..., None] if np.ndim(t) else t
    return a * (1 - t) + b * t


def ridged(h, w, cu, cv, seed, wrap=True):
    n = grid_fbm(h, w, cu, cv, seed, octaves=4, wrap_v=wrap)
    return 1 - np.abs(2 * n - 1)


def paint_body(body, island, style, W=2048, H=1024):
    sp = body.sp; B = style == 'B'
    pal = sp['colors'][style]
    top = _c(pal['top']); belly = _c(pal['belly']); acc = _c(pal['accent']); mouthc = _c(pal['mouth'])
    rim = _c(pal.get('rim', pal['accent']))
    img = np.zeros((H, W, 3))
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    UU, VV = np.meshgrid(u, v)
    seed = sp['seed'] + (100 if B else 0)

    n_big = grid_fbm(H, W, 10, 6, seed, 5)
    n_str = grid_fbm(H, W, 6, 48, seed + 1, 4)       # long strokes along body
    n_fine = grid_fbm(H, W, 64, 32, seed + 2, 3)
    veins = ridged(H, W, 14, 10, seed + 3)

    # ---------------------------------------------------------------- body region (v < 0.8)
    th = np.clip((VV - 0.005) / 0.79, 0, 1) * TAU
    co = np.cos(th)
    t = UU
    line = -sp['belly_line'] + 0.10 * (n_big - 0.5) + 0.05 * np.sin(t * 9 + n_str * 3)
    eps = 0.03 if B else 0.12
    bm = smoothstep(line - eps, line + eps, -co)  # 1 on belly
    if B:
        bm = np.round(bm * 2) / 2
    col = _lerp(top, belly, bm)
    # top-side shading / strokes
    if B:
        lum = 1 + 0.10 * (np.round((n_str - 0.5) * 3) / 3) + 0.05 * (np.round(n_big * 3) / 3 - 0.5)
        rimmask = smoothstep(0.10, 0.0, np.abs(co - 0.35)) * (1 - bm)
        col = _lerp(col, rim, 0.55 * rimmask)
    else:
        lum = 1 + 0.16 * (n_big - 0.5) + 0.12 * (n_str - 0.5) + 0.06 * (n_fine - 0.5)
        col = _lerp(col, top * 0.78, smoothstep(0.6, 1.0, co) * 0.35)  # darker dorsal line
    col = col * lum[..., None]
    # accent vein network on flanks (like the reference)
    vm = smoothstep(0.90 if B else 0.945, 0.98, veins) * smoothstep(0.85, 0.2, np.abs(co)) * smoothstep(0.12, 0.3, t)
    col = _lerp(col, acc, (0.75 if B else 0.22) * vm)
    # rorqual throat pleats
    if sp['pleats']:
        pm = smoothstep(0.02, 0.06, t) * smoothstep(0.50, 0.40, t) * smoothstep(0.25, 0.6, -co)
        stripes = smoothstep(0.75, 0.95, np.cos(th * 70 + 2.5 * (n_fine - 0.5)))
        col = col * (1 - (0.22 if not B else 0.15) * pm * stripes)[..., None]
    if sp['knobs']:
        kn = grid_fbm(H, W, 120, 60, seed + 9, 1)
        km = smoothstep(0.78, 0.86, kn) * smoothstep(0.16, 0.08, t) * smoothstep(0.2, 0.6, co)
        col = _lerp(col, acc * 0.9, 0.7 * km)
        mot = smoothstep(0.72, 0.8, grid_fbm(H, W, 40, 30, seed + 10, 2)) * bm
        col = _lerp(col, top * 1.1, 0.6 * mot)
    if sp['name'].startswith('Sperm'):
        wr = smoothstep(0.6, 1.0, np.sin(t * 380 + 6 * n_big)) * smoothstep(0.3, 0.5, t) * (1 - bm)
        col = col * (1 - 0.10 * wr)[..., None]
        sc = smoothstep(0.93, 0.98, ridged(H, W, 30, 14, seed + 12)) * smoothstep(0.28, 0.1, t)
        col = _lerp(col, acc, 0.55 * sc)
    if sp['name'].startswith('Bowhead'):
        chin = smoothstep(0.13, 0.08, t) * smoothstep(0.1, 0.5, -co)
        chin = chin * (smoothstep(0.35, 0.6, grid_fbm(H, W, 60, 40, seed + 14, 3)) * 0.5 + 0.5)
        col = _lerp(col, acc, chin)
        band = smoothstep(0.84, 0.87, t) * smoothstep(0.93, 0.9, t)
        col = _lerp(col, acc * 0.85, 0.6 * band)
    # mouth line + eye patch
    m = sp['mouth']
    for side in (1, -1):
        tt = np.clip((t - m['t0']) / (m['t1'] - m['t0']), 0, 1)
        thm = (m['th0'] + (m['th1'] - m['th0']) * tt - m['arch'] * np.sin(np.pi * tt)) * np.pi
        if side < 0:
            thm = TAU - thm
        inside = (t > m['t0']) & (t < m['t1'] + 0.006)
        d = np.abs(th - thm)
        mw = (0.010 if B else 0.007) * TAU
        mm = np.exp(-(d / mw) ** 2) * inside
        col = _lerp(col, mouthc, 0.85 * mm)
        th_e = (m['th1'] - 0.075) * np.pi
        if side < 0:
            th_e = TAU - th_e
        de = np.hypot((t - sp['eye_t']) * 8.0, (th - th_e) / TAU * 1.3)
        col = _lerp(col, col * 0.7, 0.6 * smoothstep(0.045, 0.02, de))
    # moss / earth stains spreading from the island onto the back
    x, y, z = body.point(t, th)
    rn = island.rnorm(x, y)
    stain = smoothstep(1.22, 1.0, rn) * (co > 0.05)
    sn = grid_fbm(H, W, 80, 40, seed + 20, 3)
    stain = stain * smoothstep(0.45, 0.6, sn + 0.25 * (1.15 - rn))
    moss = np.array(island.pal['moss'])
    col = _lerp(col, moss * 0.85, 0.85 * stain)
    body_reg = VV < 0.8

    # ---------------------------------------------------------------- fins (0.8..0.9)
    s = UU
    ph = np.clip((VV - 0.805) / 0.09, 0, 1) * TAU
    topside = smoothstep(-0.25, 0.25, np.sin(ph))
    fin_top = top; fin_bot = belly
    if 'fin' in pal:
        fin_top = _lerp(top, _c(pal['fin']), 0.75); fin_bot = _c(pal['fin'])
    fcol = _lerp(fin_bot, fin_top, topside)
    fcol = fcol * (1 + 0.12 * (n_str - 0.5))[..., None] if not B else fcol
    fv = smoothstep(0.9 if B else 0.92, 0.975, veins) * smoothstep(0.05, 0.2, s)
    fcol = _lerp(fcol, acc, (0.8 if B else 0.45) * fv)
    if 'band' in pal:
        bandm = smoothstep(0.3, 0.36, s) * smoothstep(0.62, 0.56, s) * topside
        fcol = _lerp(fcol, _c(pal['band']), bandm)
    fcol = _lerp(fcol, fcol * 0.75, smoothstep(0.85, 1.0, s) * 0.3)
    fin_reg = (VV >= 0.8) & (VV < 0.9)

    # ---------------------------------------------------------------- fluke (0.9..1.0)
    ph2 = np.clip((VV - 0.905) / 0.09, 0, 1) * TAU
    ts = smoothstep(-0.25, 0.25, np.sin(ph2))
    under = belly if 'fin' not in pal else _c(pal['fin'])
    kcol = _lerp(under, top, ts)
    xs = np.abs(UU - 0.5) * 2
    kv = smoothstep(0.9 if B else 0.93, 0.975, veins) * smoothstep(0.1, 0.3, xs)
    kcol = _lerp(kcol, acc, (0.85 if B else 0.5) * kv)
    kcol = _lerp(kcol, top * 0.7, smoothstep(0.8, 1.0, xs) * ts * 0.5)
    if 'fin' in pal:  # humpback: dark blotches on white underside
        bl = smoothstep(0.55, 0.65, grid_fbm(H, W, 30, 20, seed + 30, 3)) * (1 - ts)
        kcol = _lerp(kcol, top, 0.8 * bl)
    fl_reg = VV >= 0.9

    img = np.where(body_reg[..., None], col, np.where(fin_reg[..., None], fcol, kcol))
    img = np.clip(img, 0, 1)
    out = np.ones((H, W, 4)); out[..., :3] = img
    return out


def paint_water(col_hex, deep_hex, style, size=256, seed=5):
    c = _c(col_hex); d = _c(deep_hex)
    n = grid_fbm(size, size, 6, 6, seed, 4, wrap_v=True)
    n = 0.5 * (n + np.roll(n[:, ::-1], 0, axis=1))
    caust = 1 - np.abs(2 * grid_fbm(size, size, 10, 10, seed + 1, 3, wrap_v=True) - 1)
    k = smoothstep(0.86, 0.97, caust)
    col = _lerp(d, c, 0.55 + 0.45 * n)
    col = _lerp(col, np.ones(3), (0.55 if style == 'B' else 0.35) * k)
    out = np.ones((size, size, 4)); out[..., :3] = np.clip(col, 0, 1); out[..., 3] = 0.82
    return out


def paint_falls(col_hex, style, w=128, h=512, seed=9):
    c = _c(col_hex)
    rng = np.random.default_rng(seed)
    u = (np.arange(w) + 0.5) / w; v = (np.arange(h) + 0.5) / h
    UU, VV = np.meshgrid(u, v)
    streak = grid_fbm(h, w, 2, 24, seed, 4, wrap_v=False).T if False else None
    # vertical streaks: vary fast across u, slow along v
    base = np.zeros((h, w))
    for k in range(6):
        f = 3 + k * 4
        base += np.sin(UU * f * TAU + rng.uniform(0, TAU) + VV * rng.uniform(1, 4)) / (k + 1)
    base = (base - base.min()) / (base.max() - base.min())
    k = smoothstep(0.55, 0.85, base)
    col = _lerp(c, np.ones(3), 0.35 + 0.6 * k)
    alpha = (0.55 + 0.4 * k)
    edge = smoothstep(0.0, 0.18, UU) * smoothstep(1.0, 0.82, UU)
    fade = smoothstep(0.0, 0.25, VV)  # bottom (v=0) fades out into mist
    alpha = alpha * edge * fade
    out = np.ones((h, w, 4)); out[..., :3] = np.clip(col, 0, 1); out[..., 3] = np.clip(alpha, 0, 1)
    return out


def paint_ice(col_hex, size=256, seed=13):
    c = _c(col_hex)
    n = grid_fbm(size, size, 5, 5, seed, 4)
    cr = 1 - np.abs(2 * grid_fbm(size, size, 7, 7, seed + 1, 3) - 1)
    k = smoothstep(0.92, 0.985, cr)
    col = _lerp(c * 0.92, np.ones(3), 0.25 * n)
    col = _lerp(col, np.ones(3), 0.7 * k)
    out = np.ones((size, size, 4)); out[..., :3] = np.clip(col, 0, 1)
    return out
