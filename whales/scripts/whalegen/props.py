"""Low-poly procedural props. Every generator works in local space (ground at z=0) and returns a list of
parts: (verts, faces, colors_srgb, height_frac, smooth). height_frac is used for tree bending weights."""
import math
import numpy as np
from .util import blob, ring_tube, cone, box, cylinder, jitter, hex2rgb, mix, mul, TAU, rotate_axis, rotate_z


def _c(h):
    return hex2rgb(h) if isinstance(h, str) else h


def _ao(col, hf, lo=0.62):
    return mul(col, lo + (1 - lo) * hf)


def _part(v, f, col_fn, hf, smooth=True):
    return (v, f, [col_fn(i) for i in range(len(v))], hf, smooth)


def _norm_hf(parts, H):
    out = []
    for v, f, c, _, sm in parts:
        out.append((v, f, c, [max(0.0, min(1.0, p[2] / H)) for p in v], sm))
    return out


# ------------------------------------------------------------------ trees
def round_tree(rng, s, foliage, trunk, style, n_blobs=None, wide=1.0, maple=False):
    B = style == 'B'
    H = s * rng.uniform(1.7, 2.3) * (1.05 if B else 1.0)
    parts = []
    lean = rng.uniform(-0.12, 0.12, 2) * s
    path = [(lean[0] * k * k / 9, lean[1] * k * k / 9, H * 0.58 * k / 3) for k in range(4)]
    tr = s * (0.085 if B else 0.07)
    v, f, tp = ring_tube(path, [tr * 1.3, tr, tr * 0.85, tr * 0.7], sides=6)
    tc = _c(trunk)
    parts.append(_part(v, f, lambda i: mul(tc, 0.75 + 0.25 * tp[i]), None))
    # small branches
    for k in range(2 if not B else 1):
        a = rng.uniform(0, TAU)
        p0 = np.array(path[2]); p1 = p0 + np.array([math.cos(a) * 0.35 * s, math.sin(a) * 0.35 * s, 0.25 * s])
        v, f, _ = ring_tube([tuple(p0), tuple(p1)], [tr * 0.6, tr * 0.35], sides=5)
        parts.append(_part(v, f, lambda i: tc, None))
    nb = n_blobs or (rng.integers(2, 4) if B else rng.integers(3, 6))
    top = np.array(path[-1])
    base_col = _c(foliage[rng.integers(len(foliage))])
    for k in range(nb):
        if k == 0:
            ctr = top + np.array([0, 0, 0.18 * s])
            r = s * (0.62 if B else 0.5) * wide
        else:
            a = TAU * k / nb + rng.uniform(-0.4, 0.4)
            d = s * rng.uniform(0.28, 0.42) * wide
            ctr = top + np.array([math.cos(a) * d, math.sin(a) * d, rng.uniform(-0.15, 0.25) * s])
            r = s * rng.uniform(0.34, 0.46) * (1.15 if B else 1.0) * wide
        col = jitter(base_col if not maple else _c(foliage[rng.integers(len(foliage))]), rng, 0.02, 0.1, 0.12)
        v, f, hfb = blob(tuple(ctr), (r, r, r * (0.85 if B else 0.78)), 1, rng, noise=0.06 if B else 0.14)
        parts.append(_part(v, f, lambda i, col=col, hfb=hfb: _ao(col, hfb[i], 0.55 if not B else 0.7), None))
    return _norm_hf(parts, H + 0.5 * s), H


def conifer(rng, s, cols, trunk, style, snow=False):
    B = style == 'B'
    H = s * rng.uniform(2.1, 3.0)
    parts = []
    tc = _c(trunk)
    v, f, _ = cylinder((0, 0, 0), 0.07 * s, 0.35 * H, 6, 0.05 * s)
    parts.append(_part(v, f, lambda i: tc, None))
    tiers = 3 if B else 4
    col = jitter(_c(cols[rng.integers(len(cols))]), rng, 0.02, 0.1, 0.1)
    for k in range(tiers):
        fr = k / tiers
        z0 = 0.18 * H + fr * 0.62 * H
        r = s * (0.62 if B else 0.52) * (1 - 0.65 * fr)
        h = 0.42 * H * (1 - 0.3 * fr)
        v, f, hfc = cone((0, 0, z0), r, h, sides=9 if B else 8, droop=0.08 * s, rng=rng)
        cc = mul(col, 0.8 + 0.2 * fr)
        def cf(i, hfc=hfc, cc=cc, fr=fr):
            c = _ao(cc, hfc[i], 0.6)
            if snow and fr > 0.3:
                if hfc[i] > 0.7 or (hfc[i] < 0.05 and rng.random() < 0.35):
                    c = mix(c, (0.95, 0.97, 1.0), 0.8)
            return c
        parts.append(_part(v, f, cf, None, smooth=B))
    return _norm_hf(parts, H), H


def palm(rng, s, foliage, trunk, style):
    B = style == 'B'
    H = s * rng.uniform(2.2, 3.0)
    lean_a = rng.uniform(0, TAU); lean = rng.uniform(0.15, 0.45) * H
    n = 7
    path = [(math.cos(lean_a) * lean * (k / (n - 1)) ** 2, math.sin(lean_a) * lean * (k / (n - 1)) ** 2, H * k / (n - 1))
            for k in range(n)]
    tr = s * (0.075 if B else 0.06)
    v, f, tp = ring_tube(path, [tr * (1.25 - 0.4 * k / (n - 1)) for k in range(n)], sides=6)
    tc = _c(trunk)
    parts = [_part(v, f, lambda i: mul(tc, 0.8 + 0.25 * ((int(tp[i] * 12)) % 2)), None)]
    top = np.array(path[-1])
    nf = 8 if B else 9
    for k in range(nf):
        a = TAU * k / nf + rng.uniform(-0.2, 0.2)
        dirv = np.array([math.cos(a), math.sin(a), 0])
        side = np.array([-math.sin(a), math.cos(a), 0])
        Lf = s * rng.uniform(0.9, 1.2) * (1.1 if B else 1.0)
        col = jitter(_c(foliage[rng.integers(len(foliage))]), rng)
        verts = []; hfl = []
        segs = 6
        for j in range(segs + 1):
            q = j / segs
            ctr = top + dirv * q * Lf + np.array([0, 0, 0.28 * s * math.sin(q * math.pi * 0.7) - 0.75 * s * q * q])
            w = s * (0.2 if B else 0.15) * math.sin(math.pi * (0.08 + 0.9 * q)) + 0.01 * s
            verts += [tuple(ctr - side * w), tuple(ctr + side * w)]
            hfl += [q, q]
        faces = [(2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2) for j in range(segs)]
        parts.append(_part(verts, faces, lambda i, col=col, hfl=hfl: mul(col, 1.05 - 0.35 * hfl[i]), None))
    for k in range(3):
        a = rng.uniform(0, TAU)
        v, f, _ = blob(tuple(top + np.array([math.cos(a) * 0.08 * s, math.sin(a) * 0.08 * s, -0.08 * s])),
                       (0.06 * s,) * 3, 0, rng, 0.05)
        parts.append(_part(v, f, lambda i: (0.42, 0.28, 0.14), None))
    return _norm_hf(parts, H), H


def jungle_tree(rng, s, foliage, trunk, style):
    B = style == 'B'
    H = s * rng.uniform(2.6, 3.4)
    tc = _c(trunk)
    path = [(0, 0, 0), (0.05 * s, 0, 0.35 * H), (-0.03 * s, 0.04 * s, 0.7 * H), (0, 0, 0.86 * H)]
    tr = s * 0.09
    v, f, tp = ring_tube(path, [tr * 2.0, tr, tr * 0.85, tr * 0.7], sides=7)
    parts = [_part(v, f, lambda i: mul(tc, 0.7 + 0.3 * tp[i]), None)]
    # buttress roots
    for k in range(4):
        a = TAU * k / 4 + rng.uniform(-0.3, 0.3)
        p1 = (math.cos(a) * 0.35 * s, math.sin(a) * 0.35 * s, -0.02 * s)
        v, f, _ = ring_tube([(0, 0, 0.3 * s), p1], [0.06 * s, 0.03 * s], sides=4)
        parts.append(_part(v, f, lambda i: mul(tc, 0.8), None))
    base_col = _c(foliage[rng.integers(len(foliage))])
    layers = [(0.82, 0.75), (0.98, 0.55)] if not B else [(0.86, 0.85), (1.02, 0.6)]
    for zf, rf in layers:
        nb = 3
        for k in range(nb):
            a = TAU * k / nb + rng.uniform(-0.3, 0.3)
            d = s * rf * 0.45
            ctr = (math.cos(a) * d, math.sin(a) * d, zf * H)
            col = jitter(base_col, rng, 0.02, 0.1, 0.12)
            r = s * rf * 0.6
            v, f, hfb = blob(ctr, (r, r, r * 0.45), 1, rng, 0.1)
            parts.append(_part(v, f, lambda i, col=col, hfb=hfb: _ao(col, hfb[i], 0.55), None))
    return _norm_hf(parts, H * 1.1), H


def sakura_tree(rng, s, foliage, trunk, style):
    B = style == 'B'
    H = s * rng.uniform(1.6, 2.0)
    tc = _c(trunk)
    parts = []
    path = [(0, 0, 0), (0.05 * s, 0.02 * s, 0.25 * H), (0.0, 0.0, 0.45 * H)]
    v, f, _ = ring_tube(path, [0.12 * s, 0.09 * s, 0.08 * s], sides=7)
    parts.append(_part(v, f, lambda i: tc, None))
    top = np.array(path[-1])
    nb = 4
    base = _c(foliage[rng.integers(len(foliage))])
    for k in range(nb):
        a = TAU * k / nb + rng.uniform(-0.35, 0.35)
        reach = s * rng.uniform(0.55, 0.8)
        end = top + np.array([math.cos(a) * reach, math.sin(a) * reach, rng.uniform(0.25, 0.5) * H])
        mid = (top + end) / 2 + np.array([0, 0, 0.1 * s])
        v, f, _ = ring_tube([tuple(top), tuple(mid), tuple(end)], [0.07 * s, 0.05 * s, 0.03 * s], sides=5)
        parts.append(_part(v, f, lambda i: tc, None))
        for j in range(2):
            ctr = end + rng.uniform(-0.2, 0.2, 3) * s * np.array([1, 1, 0.5])
            r = s * rng.uniform(0.32, 0.45) * (1.2 if B else 1.0)
            col = jitter(base, rng, 0.015, 0.12, 0.06)
            vv, ff, hfb = blob(tuple(ctr), (r, r, r * 0.7), 1, rng, 0.08 if B else 0.15)
            parts.append(_part(vv, ff, lambda i, col=col, hfb=hfb: _ao(col, hfb[i], 0.72), None))
    return _norm_hf(parts, H * 1.25), H


# ------------------------------------------------------------------ ground cover
def grass(rng, s, col):
    parts = []
    c = jitter(_c(col), rng, 0.03, 0.15, 0.15)
    for k in range(4):
        a = rng.uniform(0, TAU); r = 0.08 * s
        b = (math.cos(a) * r, math.sin(a) * r, 0)
        tip = (b[0] + math.cos(a) * 0.12 * s, b[1] + math.sin(a) * 0.12 * s, rng.uniform(0.25, 0.4) * s)
        w = 0.035 * s
        v = [(b[0] - math.sin(a) * w, b[1] + math.cos(a) * w, 0), (b[0] + math.sin(a) * w, b[1] - math.cos(a) * w, 0), tip]
        parts.append((v, [(0, 1, 2)], [mul(c, 0.7), mul(c, 0.7), mul(c, 1.15)], None, False))
    return parts


def flower(rng, s, col):
    c = jitter(_c(col), rng, 0.02, 0.1, 0.05)
    v, f, _ = blob((0, 0, 0.12 * s), (0.06 * s,) * 3, 0, rng, 0.1)
    stalk = [(0, 0, 0), (0.01 * s, 0, 0.12 * s), (-0.01 * s, 0.0, 0.12 * s)]
    return [(v, f, [c] * len(v), None, True), (stalk, [(0, 1, 2)], [(0.2, 0.45, 0.15)] * 3, None, False)]


def fern(rng, s, col):
    parts = []
    c = jitter(_c(col), rng)
    for k in range(6):
        a = TAU * k / 6 + rng.uniform(-0.2, 0.2)
        d = np.array([math.cos(a), math.sin(a), 0]); sd = np.array([-math.sin(a), math.cos(a), 0])
        verts = []
        for j in range(5):
            q = j / 4
            ctr = d * q * 0.45 * s + np.array([0, 0, 0.32 * s * math.sin(q * math.pi * 0.8)])
            w = 0.07 * s * math.sin(math.pi * (0.1 + 0.85 * q)) + 0.005 * s
            verts += [tuple(ctr - sd * w), tuple(ctr + sd * w)]
        faces = [(2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2) for j in range(4)]
        parts.append((verts, faces, [mul(c, 0.75 + 0.1 * (i // 2)) for i in range(len(verts))], None, True))
    return parts


def rock(rng, s, col1, col2, style, snow=False, sub=1):
    B = style == 'B'
    r = s * rng.uniform(0.18, 0.35)
    v, f, hfb = blob((0, 0, r * 0.35), (r * rng.uniform(1, 1.5), r, r * rng.uniform(0.6, 0.9)), sub, rng,
                     noise=0.12 if B else 0.25, flat_bottom=0.4)
    c1 = jitter(_c(col1), rng, 0.01, 0.05, 0.08); c2 = _c(col2)

    def cf(i):
        c = mix(c2, c1, hfb[i])
        if snow and hfb[i] > 0.62:
            c = (0.93, 0.96, 1.0)
        return c
    return [(v, f, [cf(i) for i in range(len(v))], None, B)]


def boulder_stack(rng, s, col1, col2, style, moss=None):
    parts = []
    for k in range(3):
        p = rock(rng, s * (1.3 - 0.3 * k), col1, col2, style)
        v, f, c, hf, sm = p[0]
        if moss is not None:
            zs = [q[2] for q in v]; z0, z1 = min(zs), max(zs)
            c = [mix(cc, _c(moss), 0.85 if (q[2] - z0) / max(z1 - z0, 1e-6) > 0.62 else 0.0) for cc, q in zip(c, v)]
        off = (rng.uniform(-0.1, 0.1) * s, rng.uniform(-0.1, 0.1) * s, k * 0.22 * s)
        parts.append(([(x + off[0], y + off[1], z + off[2]) for x, y, z in v], f, c, hf, sm))
    return parts


def cactus(rng, s, col, style):
    c = jitter(_c(col), rng)
    H = s * rng.uniform(0.9, 1.4)
    r = 0.11 * s * (1.25 if style == 'B' else 1.0)
    v, f, tp = ring_tube([(0, 0, 0), (0, 0, H * 0.5), (0, 0, H)], [r, r, r * 0.85], sides=8)
    parts = [(v, f, [mul(c, 0.8 + 0.2 * tp[i]) for i in range(len(v))], None, True)]
    for k in range(rng.integers(1, 3)):
        a = rng.uniform(0, TAU); z0 = H * rng.uniform(0.35, 0.6); L = 0.3 * s
        d = np.array([math.cos(a), math.sin(a), 0])
        p0 = np.array([0, 0, z0]); p1 = p0 + d * L; p2 = p1 + np.array([0, 0, 0.35 * s])
        v, f, _ = ring_tube([tuple(p0), tuple(p1 - d * 0.02 * s + np.array([0, 0, 0.05 * s])), tuple(p2)],
                            [r * 0.7, r * 0.65, r * 0.6], sides=7)
        parts.append((v, f, [c] * len(v), None, True))
    if rng.random() < 0.5:
        v, f, _ = blob((0, 0, H + 0.02 * s), (0.06 * s,) * 3, 0, rng)
        parts.append((v, f, [(1.0, 0.45, 0.55)] * len(v), None, True))
    return parts


def mesa(rng, s, col1, col2, style):
    parts = []
    tiers = 3
    z = 0
    for k in range(tiers):
        r0 = s * (0.75 - 0.18 * k) * rng.uniform(0.9, 1.1)
        h = s * rng.uniform(0.35, 0.55)
        v, f, hf = cylinder((0, 0, z), r0, h, 9, r0 * 0.85)
        v = [(x * rng.uniform(0.92, 1.08), y * rng.uniform(0.92, 1.08), zz) for x, y, zz in v]
        c = mix(_c(col1), _c(col2), 0.5 + 0.5 * math.sin(k * 2.1)) if k % 2 else _c(col1)
        parts.append((v, f, [mul(c, 0.85 + 0.15 * hf[i]) for i in range(len(v))], None, False))
        z += h * 0.92
    return parts


def arch(rng, s, col1, col2, style):
    parts = []
    R = 0.8 * s; n = 9
    for k in range(n):
        a0 = math.pi * k / n; a1 = math.pi * (k + 1) / n; am = (a0 + a1) / 2
        ctr = (R * math.cos(am), 0, 0.9 * s + R * math.sin(am))
        v, f, _ = box((0, 0, 0), (R * math.pi / n * 1.15, 0.35 * s, 0.32 * s))
        v = rotate_axis(v, (0, 1, 0), -am + math.pi / 2, (0, 0, 0))
        v = [(x + ctr[0], y + ctr[1], z + ctr[2]) for x, y, z in v]
        c = mix(_c(col1), _c(col2), (k % 3) / 3)
        parts.append((v, f, [c] * len(v), None, False))
    for sx in (-R, R):
        v, f, _ = box((sx, 0, 0.45 * s), (0.36 * s, 0.38 * s, 0.95 * s))
        parts.append((v, f, [_c(col2)] * len(v), None, False))
    return parts


def pillar(rng, s, col, style, broken=False):
    c = _c(col); parts = []
    H = s * (1.6 if not broken else rng.uniform(0.6, 1.1))
    v, f, _ = box((0, 0, 0.06 * s), (0.42 * s, 0.42 * s, 0.14 * s))
    parts.append((v, f, [mul(c, 0.85)] * len(v), None, False))
    v, f, hf = cylinder((0, 0, 0.12 * s), 0.14 * s, H, 10, 0.125 * s)
    if broken:
        v = [(x, y, z + (rng.uniform(-0.12, 0.05) * s if hf[i] == 1 else 0)) for i, (x, y, z) in enumerate(v)]
    parts.append((v, f, [mul(c, 0.9 + 0.1 * hf[i]) for i in range(len(v))], None, True))
    if not broken:
        v, f, _ = box((0, 0, 0.12 * s + H + 0.06 * s), (0.4 * s, 0.4 * s, 0.12 * s))
        parts.append((v, f, [c] * len(v), None, False))
    return parts


def fallen_pillar(rng, s, col, style):
    c = _c(col)
    v, f, hf = cylinder((0, 0, 0), 0.13 * s, 1.1 * s, 10)
    v = rotate_axis(v, (0, 1, 0), math.pi / 2, (0, 0, 0))
    v = [(x - 0.55 * s, y, z + 0.11 * s) for x, y, z in v]
    return [(v, f, [mul(c, 0.85)] * len(v), None, True)]


def torii(rng, s, red, style):
    r = _c(red); dark = (0.12, 0.1, 0.1); parts = []
    H = 1.6 * s; span = 1.1 * s
    for sx in (-span / 2, span / 2):
        v, f, _ = cylinder((sx, 0, 0), 0.075 * s, H, 10, 0.065 * s)
        parts.append((v, f, [r] * len(v), None, True))
        v, f, _ = cylinder((sx, 0, 0), 0.095 * s, 0.12 * s, 10)
        parts.append((v, f, [dark] * len(v), None, True))
    v, f, _ = box((0, 0, H * 0.78), (span * 1.25, 0.09 * s, 0.1 * s))
    parts.append((v, f, [r] * len(v), None, False))
    v, f, _ = box((0, 0, H + 0.04 * s), (span * 1.55, 0.16 * s, 0.12 * s))
    v = [(x, y, z + 0.12 * s * (abs(x) / (span * 0.775)) ** 3) for x, y, z in v]
    parts.append((v, f, [r] * len(v), None, False))
    v, f, _ = box((0, 0, H + 0.14 * s), (span * 1.65, 0.2 * s, 0.07 * s))
    v = [(x, y, z + 0.16 * s * (abs(x) / (span * 0.825)) ** 3) for x, y, z in v]
    parts.append((v, f, [dark] * len(v), None, False))
    v, f, _ = box((0, 0, H * 0.89), (0.1 * s, 0.07 * s, 0.22 * s))
    parts.append((v, f, [dark] * len(v), None, False))
    return parts


def lantern(rng, s, col, style):
    c = _c(col); parts = []
    v, f, _ = box((0, 0, 0.05 * s), (0.28 * s, 0.28 * s, 0.1 * s)); parts.append((v, f, [c] * len(v), None, False))
    v, f, _ = cylinder((0, 0, 0.1 * s), 0.06 * s, 0.35 * s, 6); parts.append((v, f, [c] * len(v), None, False))
    v, f, _ = box((0, 0, 0.5 * s), (0.24 * s, 0.24 * s, 0.2 * s))
    parts.append((v, f, [(1.0, 0.85, 0.5)] * len(v), None, False))
    v, f, _ = box((0, 0, 0.66 * s), (0.42 * s, 0.42 * s, 0.14 * s), taper=0.15)
    parts.append((v, f, [mul(c, 0.85)] * len(v), None, False))
    v, f, _ = blob((0, 0, 0.76 * s), (0.04 * s,) * 3, 0, rng)
    parts.append((v, f, [c] * len(v), None, True))
    return parts


def bridge(rng, length, width, col, rail_col):
    c = _c(col); rc = _c(rail_col); parts = []
    n = 9
    for k in range(n):
        q = (k + 0.5) / n
        x = (q - 0.5) * length
        z = 0.18 * length * math.sin(math.pi * q)
        v, f, _ = box((x, 0, z), (length / n * 1.05, width, 0.06 * width / 0.5))
        ang = math.atan(0.18 * length * math.pi * math.cos(math.pi * q) / length)
        v = rotate_axis(v, (0, 1, 0), -ang, (x, 0, z))
        parts.append((v, f, [mul(c, 0.9 + 0.1 * (k % 2))] * len(v), None, False))
    for side in (-1, 1):
        for k in range(0, n + 1, 2):
            q = k / n; x = (q - 0.5) * length; z = 0.18 * length * math.sin(math.pi * q)
            v, f, _ = cylinder((x, side * width * 0.45, z), 0.02 * length / 1.2, 0.22 * width / 0.5, 5)
            parts.append((v, f, [rc] * len(v), None, False))
        pts = [((q - 0.5) * length, side * width * 0.45, 0.18 * length * math.sin(math.pi * q) + 0.2 * width / 0.5)
               for q in np.linspace(0, 1, 7)]
        v, f, _ = ring_tube(pts, [0.018 * length / 1.2] * 7, sides=4, cap_top=False)
        parts.append((v, f, [rc] * len(v), None, True))
    return parts


def icicle(rng, s):
    L = s * rng.uniform(0.25, 0.6)
    v, f, hf = cone((0, 0, 0), 0.05 * s, -L, 6, 0, rng)
    return [(v, f, [mix((0.75, 0.9, 1.0), (1, 1, 1), 1 - hf[i]) for i in range(len(v))], None, True)]


def crystal(rng, s, col, style):
    c = _c(col); parts = []
    for k in range(rng.integers(3, 6)):
        h = s * rng.uniform(0.4, 0.9); r = s * rng.uniform(0.06, 0.12)
        v, f, hf = cylinder((0, 0, 0), r, h, 6)
        tip = len(v); v.append((0, 0, h + r * 1.6)); hf = list(hf) + [1]
        top = list(range(6, 12))
        f = [x for x in f if tuple(x) != tuple(top)]
        for j in range(6):
            f.append((6 + j, 6 + (j + 1) % 6, tip))
        ax = (rng.uniform(-1, 1), rng.uniform(-1, 1), 0)
        v = rotate_axis(v, ax if any(ax) else (1, 0, 0), rng.uniform(0, 0.5), (0, 0, 0))
        v = [(x + rng.uniform(-0.1, 0.1) * s, y + rng.uniform(-0.1, 0.1) * s, z) for x, y, z in v]
        cc = jitter(c, rng, 0.03, 0.1, 0.05)
        parts.append((v, f, [mix(cc, (1, 1, 1), 0.5 * hf[i]) for i in range(len(v))], None, False))
    return parts


def igloo(rng, s, style):
    parts = []
    v, f, hfb = blob((0, 0, 0), (0.6 * s, 0.6 * s, 0.5 * s), 2, rng, 0.02, flat_bottom=0.02)
    parts.append((v, f, [mix((0.82, 0.88, 0.95), (1, 1, 1), hfb[i]) for i in range(len(v))], None, True))
    v, f, _ = ring_tube([(0.45 * s, 0, 0.12 * s), (0.78 * s, 0, 0.12 * s)], [0.2 * s, 0.2 * s], sides=8)
    parts.append((v, f, [(0.92, 0.95, 1.0)] * len(v), None, True))
    v, f, _ = blob((0.79 * s, 0, 0.1 * s), (0.02 * s, 0.13 * s, 0.13 * s), 1, rng, 0.0)
    parts.append((v, f, [(0.15, 0.2, 0.3)] * len(v), None, True))
    return parts


def hut(rng, s, wood, roof, style):
    parts = []
    w = _c(wood); r = _c(roof)
    v, f, _ = box((0, 0, 0.3 * s), (0.8 * s, 0.6 * s, 0.6 * s)); parts.append((v, f, [w] * len(v), None, False))
    v = [(-0.5 * s, -0.4 * s, 0.6 * s), (0.5 * s, -0.4 * s, 0.6 * s), (0.5 * s, 0.4 * s, 0.6 * s), (-0.5 * s, 0.4 * s, 0.6 * s),
         (-0.5 * s, 0, 0.95 * s), (0.5 * s, 0, 0.95 * s)]
    f = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    parts.append((v, f, [r] * len(v), None, False))
    v, f, _ = box((0.41 * s, 0, 0.22 * s), (0.02 * s, 0.18 * s, 0.32 * s))
    parts.append((v, f, [(0.25, 0.15, 0.08)] * len(v), None, False))
    v, f, _ = box((0.25 * s, -0.25 * s, 0.95 * s), (0.1 * s, 0.1 * s, 0.3 * s))
    parts.append((v, f, [(0.45, 0.42, 0.4)] * len(v), None, False))
    return parts


def step_pyramid(rng, s, col1, col2, style):
    parts = []
    for k in range(4):
        w = s * (1.2 - 0.25 * k)
        v, f, _ = box((0, 0, 0.18 * s * k + 0.09 * s), (w, w, 0.2 * s))
        c = mix(_c(col1), _c(col2), (k % 2) * 0.5)
        parts.append((v, f, [c] * len(v), None, False))
    v, f, _ = box((0, 0, 0.18 * s * 4 + 0.1 * s), (0.35 * s, 0.35 * s, 0.3 * s))
    parts.append((v, f, [_c(col2)] * len(v), None, False))
    return parts


def lilypad(rng, s, flower_col=None):
    n = 10; r = s * rng.uniform(0.08, 0.14)
    verts = [(0, 0, 0)]
    for k in range(n + 1):
        a = 0.35 + (TAU - 0.7) * k / n
        verts.append((r * math.cos(a), r * math.sin(a), 0))
    faces = [(0, k + 1, k + 2) for k in range(n)]
    parts = [(verts, faces, [(0.25, 0.55, 0.2)] * len(verts), None, True)]
    if flower_col:
        v, f, _ = blob((0.02 * s, 0, 0.03 * s), (0.04 * s,) * 3, 0, rng)
        parts.append((v, f, [_c(flower_col)] * len(v), None, True))
    return parts


def koi(rng, s):
    v, f, hf = blob((0, 0, 0), (0.12 * s, 0.045 * s, 0.035 * s), 1, rng, 0.0)
    base = (1.0, 0.45, 0.1) if rng.random() < 0.6 else (1, 1, 1)
    spot = (1, 1, 1) if base[1] < 0.9 else (1.0, 0.35, 0.1)
    cols = [spot if (math.sin(x * 60 / s) > 0.4) else base for (x, y, z) in v]
    tail = [(-0.11 * s, 0, 0), (-0.19 * s, 0.05 * s, 0), (-0.19 * s, -0.05 * s, 0)]
    return [(v, f, cols, None, True), (tail, [(0, 1, 2)], [base] * 3, None, False)]


def splash(rng, s):
    parts = []
    for k in range(5):
        a = rng.uniform(0, TAU); d = rng.uniform(0, 0.12) * s
        r = s * rng.uniform(0.07, 0.13)
        v, f, hfb = blob((math.cos(a) * d, math.sin(a) * d, rng.uniform(-0.05, 0.05) * s), (r, r, r), 1, rng, 0.2)
        parts.append((v, f, [mix((0.75, 0.9, 0.95), (1, 1, 1), hfb[i]) for i in range(len(v))], None, True))
    return parts
