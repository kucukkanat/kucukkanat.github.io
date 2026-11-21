"""v2 skin painter: rasterise the final mesh into UV space (position/normal/part per texel), then paint
species-true markings + island stains, and derive a tangent-space normal map from a painted height field."""
import math
import numpy as np
from .util import smoothstep, hex2rgb, TAU, fbm, boost
from .paint import _c, _lerp


def rasterize(F, uv_faces, A, res, depth_fn=None):
    """barycentric UV-space rasteriser. Where UV triangles overlap (e.g. the inside of the mouth crease),
    the texel keeps the surface with the largest depth_fn value (outermost skin)."""
    H = W = res
    C = A.shape[1]
    img = np.zeros((H, W, C), np.float32); reg = np.full((H, W), -1, np.int16)
    zbuf = np.full((H, W), -np.inf, np.float32)
    for fi, (tri, uv) in enumerate(zip(F, uv_faces)):
        p = np.array(uv, float) * [W, H]
        x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        x0 = max(x0, 0); y0 = max(y0, 0); x1 = min(x1, W - 1); y1 = min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not m.any():
            continue
        vals = w0[..., None] * A[tri[0]] + w1[..., None] * A[tri[1]] + w2[..., None] * A[tri[2]]
        if depth_fn is not None:
            dz = depth_fn(vals)
            zs = zbuf[y0:y1 + 1, x0:x1 + 1]
            m = m & (dz > zs)
            zs[m] = dz[m]
        sub = img[y0:y1 + 1, x0:x1 + 1]; sub[m] = vals[m]
        rsub = reg[y0:y1 + 1, x0:x1 + 1]; rsub[m] = 0
    filled = np.zeros((H, W), bool)
    for fi, (tri, uv) in enumerate(zip(F, uv_faces)):
        pass
    return img, reg >= 0


def rasterize_regions(F, uv_faces, freg, res):
    H = W = res
    reg = np.full((H, W), -1, np.int16)
    for tri, uv, r in zip(F, uv_faces, freg):
        p = np.array(uv, float) * [W, H]
        x0, y0 = np.floor(p.min(0)).astype(int); x1, y1 = np.ceil(p.max(0)).astype(int)
        x0 = max(x0, 0); y0 = max(y0, 0); x1 = min(x1, W - 1); y1 = min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        (ax, ay), (bx, by), (cx, cy) = p
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        w0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
        w1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
        m = (w0 >= -0.02) & (w1 >= -0.02) & (1 - w0 - w1 >= -0.02)
        sub = reg[y0:y1 + 1, x0:x1 + 1]; sub[m] = r
    return reg


def dilate(img, mask, iters=6):
    img = img.copy(); mask = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(img); cnt = np.zeros(mask.shape, np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sm = np.roll(np.roll(mask, dy, 0), dx, 1)
            si = np.roll(np.roll(img, dy, 0), dx, 1)
            acc += si * sm[..., None]; cnt += sm
        new = (~mask) & (cnt > 0)
        img[new] = acc[new] / cnt[new][:, None]
        mask = mask | new
    return img, mask


def dilate_index(mask, iters=8):
    H, W = mask.shape
    idx = np.where(mask.ravel(), np.arange(H * W, dtype=np.int64), -1).reshape(H, W)
    for _ in range(iters):
        emp = idx < 0
        if not emp.any():
            break
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(idx, dy, 0), dx, 1)
            take = emp & (sh >= 0) & (idx < 0)
            idx[take] = sh[take]
    idx[idx < 0] = 0
    return idx


def vnoise3(P, scale, seed):
    """cheap 3D-ish noise from two 2D fbm planes."""
    return 0.5 * (fbm(P[..., 0] / scale + P[..., 2] / scale * 0.37, P[..., 1] / scale, seed)
                  + fbm(P[..., 1] / scale * 0.71 + 3.1, P[..., 2] / scale + P[..., 0] / scale * 0.29, seed + 5))


def paint_skin(b, isl, attrs, uv_faces, style, res=2048):
    an = b.an; sp = b.sp; B = style == 'B'; L = b.L; U = b.U
    pal = sp['colors'][style]
    top = _c(pal['top']); belly = _c(pal['belly']); acc = _c(pal['accent'])
    rim = _c(pal.get('rim', pal['accent']))
    V = attrs['V']; F = attrs['F']
    chans = np.concatenate([V, attrs['N'], attrs['crease'][:, None], attrs['jaw'][:, None], attrs['fin_s'][:, None],
                            attrs['fin_chi'][:, None], attrs['fin_top'][:, None], attrs['fl_q'][:, None],
                            attrs['fl_top'][:, None], attrs['fl_chi'][:, None]], 1).astype(np.float32)
    def radial(vals):
        tt = np.clip(b.t_of_y(vals[..., 1]), 0, 1)
        return np.hypot(vals[..., 0], vals[..., 2] - b.C(tt))
    img, mask = rasterize(F, uv_faces, chans, res, radial)
    reg = rasterize_regions(F, uv_faces, attrs['freg'], res)
    didx = dilate_index(mask, 8)
    img = img.reshape(-1, img.shape[-1])[didx.ravel()].reshape(img.shape)
    reg = reg.ravel()[dilate_index(reg >= 0, 8).ravel()].reshape(reg.shape).astype(int)
    out = np.ones((res, res, 4), np.float32); heights = np.zeros((res, res), np.float32)
    BAND = 256
    for r0 in range(0, res, BAND):
        sl = slice(r0, min(res, r0 + BAND))
        col_b, h_b = _paint_band(b, isl, img[sl], reg[sl], style, attrs)
        out[sl, :, :3] = col_b; heights[sl] = h_b
    gy, gx = np.gradient(heights)
    # no relief across UV-island borders (body / flippers / fluke): those texels are not neighbours on the mesh
    same_x = (np.roll(reg, 1, 1) == reg) & (np.roll(reg, -1, 1) == reg)
    same_y = (np.roll(reg, 1, 0) == reg) & (np.roll(reg, -1, 0) == reg)
    gx = np.where(same_x, gx, 0.0); gy = np.where(same_y, gy, 0.0)
    tv = (np.arange(res) + 0.5) / res
    edge_rows = (np.abs(tv - 0.805) < 0.004) | (np.abs(tv - 0.895) < 0.004) | (np.abs(tv - 0.905) < 0.004) | (tv > 0.993) | (np.abs(tv - 0.80) < 0.004)
    gy[edge_rows] = 0.0; gx[edge_rows] *= 0.3
    k = 0.9 if not B else 0.5
    n = np.stack([-gx * k, -gy * k, np.ones_like(heights)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    nm = np.ones((res, res, 4), np.float32); nm[..., :3] = n * 0.5 + 0.5
    return out, nm


def _paint_band(b, isl, img, reg, style, attrs):
    an = b.an; sp = b.sp; B = style == 'B'; L = b.L; U = b.U
    pal = sp['colors'][style]
    top = _c(pal['top']); belly = _c(pal['belly']); acc = _c(pal['accent'])
    rim = _c(pal.get('rim', pal['accent']))
    Pp = img[..., 0:3]; Nn = img[..., 3:6]; crease = img[..., 6]; jaw = img[..., 7]
    fs, fchi, ftop = img[..., 8], img[..., 9], img[..., 10]; fq, ftp = img[..., 11], img[..., 12]
    x, y, z = Pp[..., 0], Pp[..., 1], Pp[..., 2]
    t = np.clip(b.t_of_y(y), 0, 1)
    co = np.cos(np.arctan2(x, z - b.C(t)))
    seed = sp['seed'] + (100 if B else 0)
    n_big = vnoise3(Pp, 1.4 * U, seed); n_mid = vnoise3(Pp, 0.45 * U, seed + 1); n_fine = vnoise3(Pp, 0.12 * U, seed + 2)
    height = np.zeros(t.shape, np.float32)

    # ---------------------------------------------------------------- countershading
    line = an.get('belly_line', -sp['belly_line']) + 0.12 * (n_big - 0.5)
    eps = 0.035 if B else 0.13
    bm = smoothstep(line - eps, line + eps, -co)
    bm = np.maximum(bm, jaw * smoothstep(-0.1, 0.4, -Nn[..., 2]) * 0.9)
    if B:
        bm = np.round(bm * 2) / 2
    col = _lerp(top, belly, bm)
    if B:
        lum = 1 + 0.10 * (np.round((n_mid - 0.5) * 3) / 3) + 0.05 * (np.round(n_big * 3) / 3 - 0.5)
        col = _lerp(col, rim, 0.45 * smoothstep(0.12, 0.0, np.abs(co - 0.35)) * (1 - bm))
    else:
        lum = 1 + 0.20 * (n_big - 0.5) + 0.16 * (n_mid - 0.5) + 0.08 * (n_fine - 0.5)
        col = _lerp(col, top * 0.8, smoothstep(0.6, 1.0, co) * 0.3)
    col = col * lum[..., None]
    # mottling (blue whale / minke style dappling)
    mott = smoothstep(0.62, 0.72, vnoise3(Pp, 0.18 * U, seed + 7))
    col = _lerp(col, _lerp(top, belly, 0.55), (0.35 if not B else 0.25) * mott * (1 - bm))

    # ---------------------------------------------------------------- species markings
    key = b.key
    eye = np.array([b.eye_frame(1), b.eye_frame(-1)])
    de = np.min(np.stack([np.linalg.norm(Pp - e, axis=-1) for e in eye]), 0)
    col = _lerp(col, col * 0.7, 0.45 * smoothstep(0.012 * L, 0.005 * L, de))       # soft eyelid shade
    col = _lerp(col, col * 0.45, 0.85 * smoothstep(0.25, 0.8, crease))                   # mouth crease line
    if an.get('white_lips'):
        lips = smoothstep(0.15, 0.5, crease) + jaw * smoothstep(0.32, 0.25, t)
        col = _lerp(col, acc, 0.9 * np.clip(lips, 0, 1))
    if key == 'sperm':
        wr = np.sin(y / (0.022 * L) * TAU + 6 * n_mid) * smoothstep(0.30, 0.36, t)
        height += 0.6 * wr + 0.4 * np.sin(z / (0.03 * L) * TAU + 4 * n_fine) * smoothstep(0.30, 0.36, t)
        col = col * (1 - 0.06 * wr * (1 - bm))[..., None]
    if key == 'humpback':
        patch = smoothstep(0.45, 0.6, vnoise3(Pp, 0.6 * U, seed + 11)) * smoothstep(0.1, 0.5, -co)
        col = _lerp(col, belly, 0.85 * patch)
    if an.get('chin_patch'):
        chin = jaw * smoothstep(0.17, 0.11, t) * smoothstep(-0.2, 0.3, -Nn[..., 2] + 0.3)
        col = _lerp(col, acc, 0.95 * chin)
        spots = smoothstep(0.80, 0.86, vnoise3(Pp, 0.035 * U, seed + 13)) * chin
        col = _lerp(col, top * 0.6, 0.9 * spots); height -= 0.8 * spots
    if an.get('peduncle_band'):
        band = smoothstep(0.84, 0.865, t) * smoothstep(0.925, 0.90, t) * (0.6 + 0.4 * n_mid)
        col = _lerp(col, acc * 0.9, 0.8 * band)
    if key == 'minke':
        chev = smoothstep(0.22, 0.26, t) * smoothstep(0.36, 0.30, t) * smoothstep(0.0, 0.25, co) * smoothstep(0.75, 0.45, co)
        col = _lerp(col, _lerp(top, belly, 0.7), 0.55 * chev)
    if key == 'beluga':
        col = _lerp(col, col * 0.92, smoothstep(0.55, 0.7, n_mid) * 0.5)
    # pleats (rorquals): grooves from chin to navel on the throat
    pl = an.get('pleats')
    if pl:
        thp = np.arctan2(x, -(z - b.C(t)))
        pm = smoothstep(pl['t0'], pl['t0'] + 0.03, t) * smoothstep(pl['t1'], pl['t1'] - 0.06, t) * smoothstep(0.15, 0.55, -co)
        groove = smoothstep(0.55, 0.95, np.cos(thp * pl['n'] + 1.8 * (n_fine - 0.5)))
        height -= 1.4 * groove * pm
        col = col * (1 - (0.16 if not B else 0.10) * groove * pm)[..., None]
    # scars / rake marks
    sc = 1 - np.abs(2 * vnoise3(Pp * np.array([1, 0.25, 1]), 0.3 * U, seed + 17) - 1)
    scm = smoothstep(0.975, 0.993, sc) * (1 - bm) * (0.5 if key in ('sperm', 'humpback', 'bowhead') else 0.12)
    col = _lerp(col, _lerp(top, acc, 0.6), scm); height += 0.4 * scm
    # accent veins (style continuity with the reference; subtle in A)
    veins = 1 - np.abs(2 * vnoise3(Pp, 0.9 * U, seed + 3) - 1)
    vm = smoothstep(0.93 if B else 0.955, 0.985, veins) * smoothstep(0.85, 0.2, np.abs(co)) * smoothstep(0.14, 0.3, t)
    col = _lerp(col, acc, (0.65 if B else 0.0) * vm)

    # tail stock: shade by surface normal like the fluke, so peduncle and fluke meet without a seam
    up = smoothstep(-0.35, 0.35, Nn[..., 2])
    tailcol = _lerp(belly, top, up) * lum[..., None]
    col = _lerp(col, tailcol, smoothstep(0.90, 0.97, t))
    # ---------------------------------------------------------------- flippers (coloured from the real surface
    # normal so top/underside blend smoothly over the rounded edges; the root fades into the body colour)
    finreg = (reg == 1) | (reg == 2)
    up = smoothstep(-0.65, 0.65, Nn[..., 2])   # wide, soft transition over the rounded flipper edges
    fcol = _lerp(belly, top, up)
    if key == 'humpback':
        fcol = _lerp(_c(pal['fin']), _c(pal['fin']) * 0.9, 0.3 * n_mid)
        fcol = _lerp(fcol, top, 0.6 * smoothstep(0.7, 0.85, vnoise3(Pp, 0.08 * U, seed + 21)) * up)
    if an.get('flipper_band'):
        bandm = smoothstep(0.30, 0.36, fs) * smoothstep(0.62, 0.56, fs) * up
        fcol = _lerp(fcol, _c(pal['band']), 0.95 * bandm)
    fcol = fcol * (1 + 0.1 * (n_mid - 0.5))[..., None]
    fcol = _lerp(fcol, acc, (0.5 if B else 0.0) * smoothstep(0.95, 0.985, veins))
    fcol = _lerp(col, fcol, smoothstep(0.0, 0.16, fs))
    col = np.where(finreg[..., None], fcol, col)

    # ---------------------------------------------------------------- fluke
    flreg = reg == 3
    kcol = _lerp(belly, top, up)
    if key == 'humpback':
        pat = smoothstep(0.5, 0.6, vnoise3(Pp, 0.25 * U, seed + 30))
        kcol = _lerp(_lerp(_c(pal['fin']), top, pat), top, up)
    kcol = kcol * lum[..., None]
    kcol = _lerp(tailcol, kcol, smoothstep(0.03, 0.14, fq))
    col = np.where(flreg[..., None], kcol, col)

    # ---------------------------------------------------------------- island continuity
    r, phi = isl.polar(x, y)
    ext = isl.edge_ext(phi) * isl.R(phi)
    upper = smoothstep(-0.35, 0.0, co)
    soil = smoothstep(ext + 0.35, ext - 0.05, r * isl.R(phi) / isl.R(phi) * 1.0) * upper
    soil = soil * smoothstep(0.35, 0.65, n_mid + 0.35 * (ext + 0.2 - r))
    moss = np.array(isl.pal['moss']) * 0.85
    dirt = np.array(isl.pal['dirt'])
    stain_col = _lerp(moss, dirt, smoothstep(0.4, 0.7, n_fine) * 0.6)
    if isl.key == 'tundra':
        stain_col = _lerp(np.array([0.92, 0.95, 1.0]), np.array(isl.pal['rock']), 0.2)
    col = _lerp(col, stain_col, 0.9 * np.clip(soil, 0, 1))
    # algae drips running down from the island
    drip_n = vnoise3(Pp * np.array([1.0, 6.0, 1.0]), 0.5 * U, seed + 40)
    drip = smoothstep(ext + 1.0, ext, r) * smoothstep(0.6, 0.75, drip_n) * smoothstep(-0.6, 0.1, co) * (1 - soil)
    col = _lerp(col, _lerp(col, moss * 0.7, 0.8), 0.6 * drip)
    # barnacle speckles near the island
    barn = smoothstep(0.86, 0.9, vnoise3(Pp, 0.03 * U, seed + 41)) * smoothstep(ext + 1.4, ext + 0.2, r) * upper
    if isl.key != 'tundra':
        col = _lerp(col, np.array([0.85, 0.83, 0.78]), 0.8 * barn); height += 1.2 * barn
    height += 0.8 * soil * (n_fine - 0.5)
    # wet streaks under waterfalls
    for path in getattr(isl, 'fall_paths', []):
        d = np.full(t.shape, 1e9)
        for a_, b_ in zip(path[:-1], path[1:]):
            ab = b_ - a_; tt = np.clip(((Pp - a_) @ ab) / (ab @ ab), 0, 1)
            d = np.minimum(d, np.linalg.norm(Pp - (a_ + tt[..., None] * ab), axis=-1))
        wet = smoothstep(0.55 * U, 0.15 * U, d)
        col = _lerp(col, _lerp(col * 0.6, moss * 0.6, 0.4), 0.75 * wet)

    # ---------------------------------------------------------------- micro relief
    # flippers/fluke keep only a soft skin grain (no pleats/wrinkles/stains) - and fade the body relief out at
    # the root so the normal map is continuous across the junction
    appendage = np.where(finreg, smoothstep(0.0, 0.12, fs), 0.0) + np.where(flreg, smoothstep(0.03, 0.12, fq), 0.0)
    height = height * (1 - np.clip(appendage, 0, 1))
    height += 0.25 * (n_fine - 0.5) + 0.12 * (vnoise3(Pp, 0.04 * U, seed + 50) - 0.5)
    col = np.clip(col, 0, 1)
    return col, height
