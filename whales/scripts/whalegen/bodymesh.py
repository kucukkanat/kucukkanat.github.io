"""Turn the fused SDF surface into a game-ready body: decimate, part-aware UVs, soft skin weights, eyes."""
import math
import numpy as np
import bpy
from .util import MB, sstep, smoothstep, TAU, icosphere, s2l

REG_BODY, REG_FINL, REG_FINR, REG_FLUKE = 0, 1, 2, 3


def decimate(P, Q, target_tris, keep=None):
    """decimate to ~target_tris while protecting the flipper/fluke region (inverted vertex group)."""
    return _decimate_once(P, Q, min(1.0, target_tris / (2 * len(Q))), keep, 10.0)


def _decimate_once(P, Q, ratio, keep=None, factor=10.0, invert=True):
    me = bpy.data.meshes.new('tmp'); me.from_pydata(P.tolist(), [], Q.tolist()); me.update()
    ob = bpy.data.objects.new('tmp', me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    m = ob.modifiers.new('d', 'DECIMATE'); m.ratio = ratio
    m.use_symmetry = True; m.symmetry_axis = 'X'
    if keep is not None:   # protect flippers/fluke + their junctions from heavy decimation (they must bend)
        vg = ob.vertex_groups.new(name='detail'); vg.add(np.nonzero(keep)[0].tolist(), 1.0, 'REPLACE')
        m.vertex_group = 'detail'; m.invert_vertex_group = invert; m.vertex_group_factor = factor
    bpy.ops.object.modifier_apply(modifier='d')
    tri = ob.modifiers.new('t', 'TRIANGULATE'); bpy.ops.object.modifier_apply(modifier='t')
    V = np.array([v.co[:] for v in me.vertices]); F = np.array([p.vertices[:] for p in me.polygons])
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return V, F[:, ::-1].copy()   # OpenVDB quads wind inward; flip so normals face out


def _hat(x, anchors):
    """partition-of-unity weights over sorted anchor positions."""
    if x <= anchors[0]:
        return {0: 1.0}
    for i in range(len(anchors) - 1):
        if x <= anchors[i + 1]:
            k = sstep(0, 1, (x - anchors[i]) / (anchors[i + 1] - anchors[i]))
            return {i: 1 - k, i + 1: k}
    return {len(anchors) - 1: 1.0}


def _top4(w):
    items = sorted(((k, v) for k, v in w.items() if v > 1e-3), key=lambda kv: -kv[1])[:4]
    s = sum(v for _, v in items) or 1.0
    return {k: v / s for k, v in items}


def smooth_weights(weights, F, mask, iters=6):
    """Laplacian smoothing of skin weights over the mesh (only where mask) - removes stretch seams."""
    names = sorted({k for w in weights for k in w}); col = {n: i for i, n in enumerate(names)}
    Wm = np.zeros((len(weights), len(names)))
    for i, w in enumerate(weights):
        for k, v in w.items(): Wm[i, col[k]] = v
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    E = np.concatenate([E, E[:, ::-1]])
    deg = np.bincount(E[:, 0], minlength=len(weights)).astype(float)
    for _ in range(iters):
        acc = np.zeros_like(Wm); np.add.at(acc, E[:, 0], Wm[E[:, 1]])
        avg = acc / np.maximum(deg, 1)[:, None]
        Wm[mask] = 0.5 * Wm[mask] + 0.5 * avg[mask]
    out = []
    for i in range(len(weights)):
        nz = np.nonzero(Wm[i] > 1e-3)[0]
        out.append(_top4({names[j]: Wm[i, j] for j in nz}))
    return out


def taubin(V, F, mask, iters=12, lam=0.5, mu=-0.53):
    """volume-preserving smoothing of the masked vertices (removes voxel stair-steps on thin fin edges)."""
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]); E = np.concatenate([E, E[:, ::-1]])
    deg = np.maximum(np.bincount(E[:, 0], minlength=len(V)), 1).astype(float)[:, None]
    V = V.copy(); m = mask[:, None].astype(float)
    for _ in range(iters):
        for f in (lam, mu):
            acc = np.zeros_like(V); np.add.at(acc, E[:, 0], V[E[:, 1]])
            V = V + f * m * (acc / deg - V)
    return V


def build_body_mb(b, P, Q, target_tris=30000):
    dfin = np.minimum(b.sample('finL', P), b.sample('finR', P)); dfl = b.sample('fluke', P); db = b.sample('body', P)
    dpart = np.minimum(dfin, dfl)
    keep = (dpart < 0.6 * b.band) & ((dpart - np.minimum(db, b.band)) < 0.05 * b.L)
    if b.an['fin']['len'] > 0.2:
        # very long flippers (humpback ~1/3 L): protect only the shoulder/fluke junctions; the blades are simple
        # shapes that decimate well and are Taubin-smoothed afterwards
        sh = [np.array(b.fin_bones(sd)[0][1]) for sd in (1, -1)]
        near_sh = np.minimum(np.linalg.norm(P - sh[0], axis=1), np.linalg.norm(P - sh[1], axis=1)) < 0.075 * b.L
        fl = b.sample('fluke', P)
        keep = keep & (near_sh | ((fl < 0.6 * b.band) & (fl <= dfin)))
    V, F = decimate(P, Q, target_tris, keep)
    L = b.L
    dp = np.minimum(np.minimum(b.sample('finL', V), b.sample('finR', V)), b.sample('fluke', V))
    app = (dp < 0.6 * b.band) & ((dp - np.minimum(b.sample('body', V), b.band)) < 0.022 * L)
    V = taubin(V, F, app, iters=14)
    d = {k: b.sample(k, V) for k in ('body', 'finL', 'finR', 'fluke', 'trunk', 'jaw')}
    nrm = b.grad(V)
    stack = np.stack([d['body'], d['finL'], d['finR'], d['fluke']], 1)
    owner = np.argmin(stack, axis=1)
    # --- per-vertex parameters
    t = np.clip(b.t_of_y(V[:, 1]), 0, 1.0)
    C = b.C(t)
    th = np.mod(np.arctan2(V[:, 0], V[:, 2] - C), TAU)
    finp = {}
    for side, reg in ((1, REG_FINL), (-1, REG_FINR)):
        s, chi, top = b.fin_param(side, V)
        finp[reg] = (s, chi, top)
    f, S, c0, E = b.fluke_spec()
    lec = np.array([b.fluke_le_chord(x) for x in V[:, 0]])
    fl_chi = np.clip((V[:, 1] - lec[:, 0]) / lec[:, 1], 0, 1); fl_q = lec[:, 2]; fl_top = V[:, 2] >= E[2]

    def uv_of(reg, i, top_face=None):
        """body: cylindrical (t, theta). flippers/fluke: span x chord, with the leading edge in the middle of the
        island (continuous over the rounded edge) and the seam on the thin trailing edge."""
        if reg == REG_BODY:
            return np.array([0.004 + 0.992 * t[i], 0.005 + 0.78 * th[i] / TAU]), th[i]
        if reg in (REG_FINL, REG_FINR):
            s, chi, top = finp[reg]
            tp = top[i] if top_face is None else top_face
            c = min(chi[i], 0.985)
            return np.array([0.01 + 0.98 * min(max(s[i], 0), 1), 0.805 + 0.09 * (0.5 + 0.5 * (c if tp else -c))]), 0.0
        tp = fl_top[i] if top_face is None else top_face
        c = min(fl_chi[i], 0.985)
        return np.array([0.01 + 0.98 * (V[i, 0] / S + 0.5), 0.905 + 0.09 * (0.5 + 0.5 * (c if tp else -c))]), 0.0

    faces = []; uvs = []; freg = []
    for tri in F:
        regs = owner[tri]
        vals, cnt = np.unique(regs, return_counts=True)
        reg = int(vals[np.argmax(cnt)]) if cnt.max() > 1 else int(REG_BODY if REG_BODY in regs else regs[0])
        # leading edge: per-vertex signed chord (continuous, no overlap); only faces at the thin trailing-edge
        # seam use the face majority side
        top_face = None
        if reg in (REG_FINL, REG_FINR):
            if finp[reg][1][tri].max() > 0.6:
                top_face = bool(finp[reg][2][tri].sum() >= 2)
        elif reg == REG_FLUKE:
            if fl_chi[tri].max() > 0.6:
                top_face = bool(fl_top[tri].sum() >= 2)
        res = [uv_of(reg, i, top_face) for i in tri]
        angs = np.array([r[1] for r in res]); uv = np.array([r[0] for r in res])
        if reg == REG_BODY and angs.max() - angs.min() > math.pi:  # wrap seam on the dorsal midline
            for k in range(3):
                if angs[k] > math.pi:
                    uv[k, 1] -= 0.78
        faces.append(tuple(int(x) for x in tri)); uvs.append(tuple(map(tuple, uv))); freg.append(reg)

    # --- weights
    kf = 0.028 * L; kfl = 0.018 * L
    band = 0.9 * b.band

    def member(dp, dbody, k):
        """how much a vertex belongs to a part. Level sets are clipped outside a narrow band, so a vertex that is
        far from BOTH the part and the body must not be blended 50/50 - it only belongs if it is near the part."""
        if dp > 0.45 * band:
            return 0.0
        return sstep(1.3 * k, -0.6 * k, dp - min(dbody, band))
    weights = []
    for i in range(len(V)):
        w = b.spine_w(t[i])
        bw = 0.55 * math.exp(-((t[i] - 0.30) / 0.09) ** 2) * (0.35 + 0.65 * (0.5 - 0.5 * math.cos(th[i])))
        if bw > 0.01:
            w = {k: v * (1 - bw) for k, v in w.items()}; w['breath'] = bw
        out = dict(w)
        # skin around the shoulders follows the flippers' parent (chest), not the neck, so head bob can't shear it
        prox = max(member(d['finL'][i], d['body'][i], 4 * kf), member(d['finR'][i], d['body'][i], 4 * kf))
        if prox > 0:
            for sb in ('neck', 'head', 'spine_1', 'breath'):
                if sb in out:
                    nv = out.pop(sb); out['chest'] = out.get('chest', 0) + nv * prox
                    if nv * (1 - prox) > 1e-3: out[sb] = nv * (1 - prox)
        for reg, pre, dd in ((REG_FINL, 'fin_L', d['finL']), (REG_FINR, 'fin_R', d['finR'])):
            m = member(dd[i], d['body'][i], kf)
            if m > 1e-3:
                s = finp[reg][0][i]
                FS = b.FIN_S
                # skin in the armpit/fillet follows the shoulder bone; the flipper blade follows the chain
                s = FS[0] + (s - FS[0]) * sstep(0.35, 0.9, m) if s > FS[0] else s
                hw = _hat(s, [(FS[k] + FS[k + 1]) / 2 for k in range(len(FS) - 1)])
                ch = 1 - sstep(-0.30, 0.0, s)
                fw = {f'{pre}_{k + 1}': v * (1 - ch) for k, v in hw.items()}
                if ch > 0: fw['chest'] = fw.get('chest', 0) + ch
                out = {k: v * (1 - m) for k, v in out.items()}
                for k, v in fw.items(): out[k] = out.get(k, 0) + v * m
        m = member(d['fluke'][i], d['body'][i], kfl)
        if m > 1e-3:
            q = fl_q[i]; sd = 'L' if V[i, 0] > 0 else 'R'
            hw = _hat(q, [0.0, 0.37, 0.76])
            names = ['fluke', f'fluke_{sd}_1', f'fluke_{sd}_2']
            out = {k: v * (1 - m) for k, v in out.items()}
            for k, v in hw.items(): out[names[k]] = out.get(names[k], 0) + v * m
        if 'breath' in out:
            mf = max(member(d['finL'][i], d['body'][i], 2 * kf), member(d['finR'][i], d['body'][i], 2 * kf))
            if mf > 0:
                bwv = out.pop('breath') * (1 - mf); out['chest'] = out.get('chest', 0) + out.get('breath', 0)
                if bwv > 1e-3: out['breath'] = bwv
                tot = sum(out.values()); out = {k: v / tot for k, v in out.items()}
        weights.append(_top4(out))

    dpart = np.minimum(np.minimum(d['finL'], d['finR']), d['fluke'])
    rel = dpart - np.minimum(d['body'], band)
    fln = b.an['fin']['len'] * L
    near = (dpart < 0.8 * band) & (rel < min(3.5 * kf, 0.3 * fln)) & (rel > -min(1.0 * kf, 0.07 * fln))   # fillet band only
    weights = smooth_weights(weights, np.array(faces), near, iters=12)
    mb = MB()
    mb.add([tuple(v) for v in V], faces, [(1, 1, 1)] * len(V), weights, True, uvs)
    attrs = dict(V=V, F=np.array(faces), N=nrm, owner=owner, freg=np.array(freg), t=t, th=th,
                 crease=np.exp(-(np.abs(d['trunk'] - d['jaw']) / (0.006 * L)) ** 2) * smoothstep(b.an['mouth_end'] + 0.01, b.an['mouth_end'] - 0.01, t) * smoothstep(0.004, 0.03, t),
                 jaw=(d['jaw'] < d['trunk']).astype(float), fin_s=np.where(owner == REG_FINL, finp[REG_FINL][0], finp[REG_FINR][0]),
                 fin_chi=np.where(owner == REG_FINL, finp[REG_FINL][1], finp[REG_FINR][1]),
                 fin_top=np.where(owner == REG_FINL, finp[REG_FINL][2], finp[REG_FINR][2]).astype(float),
                 fl_q=fl_q, fl_top=fl_top.astype(float), fl_chi=fl_chi)
    return mb, attrs


def project_to_surface(b, P, iters=4):
    P = np.array(P, float)
    for _ in range(iters):
        f = b.sample('final', P); g = b.grad(P)
        P = P - f[:, None] * g
    return P, b.grad(P)


def build_eyes(b, mb, style):
    B = style == 'B'
    er = b.an['eye']['r'] * b.L * (0.85 if not B else 1.05)
    for side in (1, -1):
        c = b.eye_frame(side)
        c = c + np.array([side * 0.02 * b.L, 0, 0])
        p, n = project_to_surface(b, c[None, :])
        p, n = p[0], n[0]
        ctr = p - n * 0.72 * er
        w = b.spine_w(float(b.t_of_y(ctr[1])))
        v, f = icosphere(2)
        hd = n * 0.6 + np.array([0, -0.3, 0.75]); hd /= np.linalg.norm(hd)
        cols = []
        for q in v:
            q = np.array(q)
            c_ = (0.03, 0.025, 0.03)
            if np.dot(q, n) > 0.55:
                c_ = (0.16, 0.10, 0.06) if not B else (0.14, 0.09, 0.05)
            if np.dot(q, hd) > (0.95 if not B else 0.90):
                c_ = (0.95, 0.95, 0.95)
            cols.append(tuple(s2l(c_)))
        mb.add([tuple(ctr + np.array(q) * er) for q in v], f, cols, [dict(w) for _ in v], True)
