"""Whale body: lofted superellipse profile, pectoral fins, fluke, eyes, bone layout and spine weights."""
import math
import numpy as np
from .util import pchip, smoothstep, sstep, TAU, icosphere, s2l, hex2rgb

SPINE_FWD = [('chest', .38, .25), ('neck', .25, .12), ('head', .12, 0.0)]
SPINE_BACK = [('spine_1', .38, .48), ('spine_2', .48, .58), ('spine_3', .58, .67), ('tail_1', .67, .75),
              ('tail_2', .75, .82), ('tail_3', .82, .88), ('tail_4', .88, .94), ('tail_5', .94, 1.0)]
ANCHORS = [('head', .06), ('neck', .185), ('chest', .315), ('spine_1', .43), ('spine_2', .53), ('spine_3', .625),
           ('tail_1', .71), ('tail_2', .785), ('tail_3', .85), ('tail_4', .91), ('tail_5', .97), ('fluke', 1.03)]


class Body:
    def __init__(self, sp, style):
        self.sp = sp; self.style = style
        B = style == 'B'
        L = sp['L'] * (0.86 if B else 1.0)
        self.L = L
        self.U = L / 14.0  # "unit" used to scale props
        rows = np.array(sp['profile'], float)
        t = rows[:, 0]
        g = np.ones_like(t)
        if B:
            g = 1.10 * (1 + 0.17 * np.exp(-((t - 0.10) / 0.14) ** 2))
        self.W = pchip(t, rows[:, 1] * g * L)
        self.HT = pchip(t, rows[:, 2] * g * L)
        self.HB = pchip(t, rows[:, 3] * g * L)
        self.C = pchip(t, rows[:, 4] * L)
        self.N = pchip(t, rows[:, 5])
        self.y0 = -0.40 * L
        self.fin_scale = (1.25, 1.3) if B else (1.0, 1.0)
        self.fluke_scale = 1.18 if B else 1.0
        self.dorsal = sp['dorsal']
        self._fluke_cache = None

    # ------------------------------------------------------------ surface
    def y(self, t):
        return self.y0 + np.asarray(t) * self.L

    def t_of_y(self, y):
        return (np.asarray(y) - self.y0) / self.L

    def dorsal_bump(self, t):
        if not self.dorsal:
            return np.zeros_like(np.asarray(t, float))
        t0, h, wt = self.dorsal
        h = h * self.L * (1.25 if self.style == 'B' else 1.0)
        t = np.asarray(t, float)
        w = np.where(t < t0, wt * 1.7, wt * 0.55)
        return h * np.exp(-((t - t0) / w) ** 2)

    def point(self, t, th):
        t = np.asarray(t, float); th = np.asarray(th, float)
        W = self.W(t); HT = self.HT(t); HB = self.HB(t); C = self.C(t); n = self.N(t)
        s = np.sin(th); c = np.cos(th); e = 2.0 / n
        x = W * np.sign(s) * np.abs(s) ** e
        H = np.where(c > 0, HT, HB)
        z = C + H * np.sign(c) * np.abs(c) ** e
        z = z + self.dorsal_bump(t) * np.clip(c, 0, 1) ** 14
        y = self.y0 + t * self.L
        return x, y * np.ones_like(x), z

    def normal(self, t, th):
        x, y, z = self.point(t, th)
        x1, y1, z1 = self.point(t + 1e-3, th)
        x2, y2, z2 = self.point(t, th + 1e-3)
        a = np.array([x1 - x, y1 - y, z1 - z]); b = np.array([x2 - x, y2 - y, z2 - z])
        nrm = np.cross(b, a)
        nrm /= np.linalg.norm(nrm) + 1e-12
        # ensure outward
        C = float(self.C(t))
        if np.dot(nrm, np.array([x, 0, z - C])) < 0:
            nrm = -nrm
        return nrm

    def top_z(self, y, x):
        t = self.t_of_y(y)
        W = self.W(t); HT = self.HT(t); C = self.C(t); n = self.N(t)
        q = np.clip(np.abs(x) / np.maximum(W, 1e-6), 0, 0.999)
        return C + HT * (1 - q ** n) ** (1 / n)

    def side_x(self, y, z):
        t = self.t_of_y(y)
        W = self.W(t); HT = self.HT(t); HB = self.HB(t); C = self.C(t); n = self.N(t)
        H = np.where(z > C, HT, HB)
        q = np.clip(np.abs(z - C) / H, 0, 1)
        return W * (1 - q ** n) ** (1 / n)

    def centerline(self, t):
        return (0.0, float(self.y(t)), float(self.C(t)))

    # ------------------------------------------------------------ weights
    def spine_w(self, t):
        t = float(t)
        if t <= ANCHORS[0][1]:
            return {ANCHORS[0][0]: 1.0}
        for i in range(len(ANCHORS) - 1):
            a, ta = ANCHORS[i]; b, tb = ANCHORS[i + 1]
            if t <= tb:
                k = sstep(0, 1, (t - ta) / (tb - ta))
                d = {}
                if 1 - k > 1e-3: d[a] = 1 - k
                if k > 1e-3: d[b] = k
                return d
        return {ANCHORS[-1][0]: 1.0}

    def spine_w_y(self, y):
        return self.spine_w(self.t_of_y(y))

    def bone_for_t(self, t):
        """Deforming spine bone whose segment contains t (used as parent for props bones)."""
        for name, a, b in SPINE_FWD:
            if b <= t <= a:
                return name
        for name, a, b in SPINE_BACK:
            if a <= t <= b:
                return name
        return 'head' if t < 0.2 else 'tail_5'

    # ------------------------------------------------------------ meshes
    def build_body(self, mb):
        B = self.style == 'B'
        N = 92 if B else 104; M = 48
        ks = np.arange(1, N) / N
        ts = 0.55 * ks + 0.45 * (1 - np.cos(np.pi * ks)) / 2
        ths = np.arange(M) * TAU / M
        verts = []; weights = []
        for t in ts:
            x, y, z = self.point(np.full(M, t), ths)
            sw = self.spine_w(t)
            for j in range(M):
                verts.append((float(x[j]), float(y[j]), float(z[j])))
                w = dict(sw)
                # breathing swell: chest/belly region
                bw = 0.55 * math.exp(-((t - 0.30) / 0.09) ** 2) * (0.35 + 0.65 * (0.5 - 0.5 * math.cos(ths[j])))
                if bw > 0.01:
                    w = {k: v * (1 - bw) for k, v in w.items()}; w['breath'] = bw
                weights.append(w)
        nose = len(verts); verts.append(self.centerline(0.0)); weights.append({'head': 1.0})
        tail = len(verts); verts.append(self.centerline(1.0)); weights.append({'tail_5': 0.5, 'fluke': 0.5})
        faces = []; uvs = []
        V = lambda j: 0.005 + 0.79 * j / M
        R = len(ts)
        for i in range(R - 1):
            for j in range(M):
                j2 = (j + 1) % M
                a = i * M + j; b = i * M + j2; c = (i + 1) * M + j2; d = (i + 1) * M + j
                faces.append((a, b, c, d))
                uvs.append(((ts[i], V(j)), (ts[i], V(j + 1)), (ts[i + 1], V(j + 1)), (ts[i + 1], V(j))))
        for j in range(M):
            j2 = (j + 1) % M
            faces.append((nose, j2, j)); uvs.append(((0.0, V(j + 0.5)), (ts[0], V(j + 1)), (ts[0], V(j))))
            a = (R - 1) * M + j; b = (R - 1) * M + j2
            faces.append((a, b, tail)); uvs.append(((ts[-1], V(j)), (ts[-1], V(j + 1)), (1.0, V(j + 0.5))))
        cols = [(1, 1, 1)] * len(verts)
        mb.add(verts, faces, cols, weights, True, uvs)
        self.build_fin(mb, +1); self.build_fin(mb, -1)
        self.build_fluke(mb)

    # pectoral fin ------------------------------------------------------
    def fin_frame(self, side):
        p = self.sp['pec']
        ls, cs = self.fin_scale
        length = p['len'] * self.L * ls; c0 = p['chord'] * self.L * cs
        th = p['th'] * math.pi
        if side < 0:
            th = TAU - th
        P = np.array([float(v) for v in self.point(p['t'], th)])
        C = np.array(self.centerline(p['t']))
        P = P - 0.22 * (P - C)
        dr = math.radians(p['droop']); sw = math.radians(p['sweep'])
        d = np.array([side * math.cos(dr) * math.cos(sw), math.sin(sw), -math.sin(dr)]); d /= np.linalg.norm(d)
        cd = np.array([0, 1.0, 0]) - d * d[1]; cd /= np.linalg.norm(cd)
        n = np.cross(d, cd)
        if n[2] < 0: n = -n
        return P, d, cd, n, length, c0

    def fin_chord(self, s, c0):
        p = self.sp['pec']
        s = max(0.0, s)
        if p['shape'] == 'slender':
            c = 1.3 * c0 * (1 - 0.8 * s ** 1.2) * max(0.0, 1 - s ** 8) ** 0.5
        else:
            c = c0 * (0.85 + 0.55 * s * (1 - s)) * max(0.0, 1 - s ** 3.5) ** 0.5
        return max(c, 0.004 * self.L)

    def fin_le(self, s, c0):
        p = self.sp['pec']
        le = -0.35 * c0 + (0.32 * c0 * max(s, 0) if p['shape'] == 'slender' else 0.12 * c0 * max(s, 0))
        if p['scallop'] and s > 0.12:
            le -= p['scallop'] * 0.10 * c0 * max(0.0, math.sin(s * math.pi * 9)) ** 2
        return le

    def fin_pos(self, side, s, chi, sph):
        P, d, cd, n, length, c0 = self.fin_frame(side)
        ch = self.fin_chord(s, c0)
        th = ch * 0.20 * (1 - 0.45 * max(s, 0))
        curl = -0.06 * length * max(s, 0) ** 2
        return (P + d * length * s + cd * (self.fin_le(s, c0) + chi * ch)
                + n * (th * 0.5 * sph * (1 - chi) ** 0.6 + curl))

    def build_fin(self, mb, side):
        Ns = 20; Nc = 12
        ss = np.linspace(-0.15, 1.0, Ns)
        verts = []; weights = []; uvs_v = []
        prefix = 'fin_L' if side > 0 else 'fin_R'
        for s in ss:
            for k in range(Nc):
                ph = TAU * k / Nc
                chi = 0.5 - 0.5 * math.cos(ph)
                verts.append(tuple(self.fin_pos(side, s, chi, math.sin(ph))))
                w = {}
                chest = 1 - sstep(-0.10, 0.10, s)
                a1, a2, a3 = .165, .5, .83
                if s <= a1: ws = {1: 1.0}
                elif s <= a2: k2 = sstep(0, 1, (s - a1) / (a2 - a1)); ws = {1: 1 - k2, 2: k2}
                elif s <= a3: k2 = sstep(0, 1, (s - a2) / (a3 - a2)); ws = {2: 1 - k2, 3: k2}
                else: ws = {3: 1.0}
                for bi, wv in ws.items():
                    if wv * (1 - chest) > 1e-3: w[f'{prefix}_{bi}'] = wv * (1 - chest)
                if chest > 1e-3: w['chest'] = chest
                weights.append(w)
                uvs_v.append((0.01 + 0.98 * min(max(s, 0), 1), 0.805 + 0.09 * k / Nc))
        faces = []; uvs = []
        for i in range(Ns - 1):
            for k in range(Nc):
                k2 = (k + 1) % Nc
                a = i * Nc + k; b = i * Nc + k2; c = (i + 1) * Nc + k2; d = (i + 1) * Nc + k
                f = (a, d, c, b) if side > 0 else (a, b, c, d)
                faces.append(f)
                uu = [uvs_v[x] for x in f]
                if k2 == 0:  # seam
                    uu = [(u, 0.805 + 0.09 if (x % Nc == 0) else v) for (u, v), x in zip(uu, f)]
                uvs.append(tuple(uu))
        tipc = np.mean(np.array(verts[-Nc:]), axis=0)
        ti = len(verts); verts.append(tuple(tipc)); weights.append({f'{prefix}_3': 1.0}); uvs_v.append((0.99, 0.85))
        for k in range(Nc):
            k2 = (k + 1) % Nc
            a = (Ns - 1) * Nc + k; b = (Ns - 1) * Nc + k2
            f = (b, a, ti) if side > 0 else (a, b, ti)
            faces.append(f); uvs.append(tuple(uvs_v[x] for x in f))
        mb.add(verts, faces, [(1, 1, 1)] * len(verts), weights, True, uvs)

    def fin_bones(self, side):
        prefix = 'fin_L' if side > 0 else 'fin_R'
        pts = [self.fin_pos(side, s, 0.35, 0.0) for s in (0.0, 0.33, 0.66, 0.98)]
        return [(f'{prefix}_{i + 1}', tuple(pts[i]), tuple(pts[i + 1]), 'chest' if i == 0 else f'{prefix}_{i}')
                for i in range(3)]

    # fluke --------------------------------------------------------------
    def fluke_params(self):
        f = self.sp['fluke']
        S = f['span'] * self.L * self.fluke_scale
        c0 = f['chord'] * self.L * self.fluke_scale
        E = np.array(self.centerline(1.0))
        return f, S, c0, E

    def fluke_le_chord(self, x):
        f, S, c0, E = self.fluke_params()
        q = min(abs(x) / (S / 2), 0.995)
        le = E[1] - 0.22 * c0 + f['sweep'] * S * 0.5 * q ** 1.4
        ch = c0 * (1 - q ** 1.8) ** 0.55 * (1 - f['notch'] * math.exp(-(x / (0.06 * S)) ** 2))
        if f['serr']:
            ch *= 1 + 0.06 * f['serr'] * math.sin(q * 34) * q
        return le, max(ch, 0.003 * self.L), q

    def build_fluke(self, mb):
        f, S, c0, E = self.fluke_params()
        Nx = 41; Nc = 12
        us = np.cos(np.linspace(np.pi, 0, Nx))  # -1..1 cosine spaced
        verts = []; weights = []; uvs_v = []
        for u in us:
            x = u * S / 2 * 0.995
            le, ch, q = self.fluke_le_chord(x)
            th = ch * 0.15 * (1 - 0.6 * q) + 0.022 * self.L * math.exp(-(x / (0.06 * S)) ** 2)
            for k in range(Nc):
                ph = TAU * k / Nc; chi = 0.5 - 0.5 * math.cos(ph)
                z = E[2] + th * 0.5 * math.sin(ph) * (1 - chi) ** 0.5 + 0.02 * self.L * q ** 2 * 0
                verts.append((x, le + chi * ch, z))
                tip = sstep(0.35, 1.0, q)
                w = {}
                if 1 - tip > 1e-3: w['fluke'] = 1 - tip
                if tip > 1e-3: w['fluke_tip_L' if x > 0 else 'fluke_tip_R'] = tip
                weights.append(w)
                uvs_v.append((0.01 + 0.98 * (u * 0.5 + 0.5), 0.905 + 0.09 * k / Nc))
        faces = []; uvs = []
        for i in range(Nx - 1):
            for k in range(Nc):
                k2 = (k + 1) % Nc
                a = i * Nc + k; b = i * Nc + k2; c = (i + 1) * Nc + k2; d = (i + 1) * Nc + k
                fc = (a, d, c, b)
                faces.append(fc)
                uu = [uvs_v[x] for x in fc]
                if k2 == 0:
                    uu = [(uv[0], 0.995 if (x % Nc == 0) else uv[1]) for uv, x in zip(uu, fc)]
                uvs.append(tuple(uu))
        mb.add(verts, faces, [(1, 1, 1)] * len(verts), weights, True, uvs)

    def fluke_bones(self):
        f, S, c0, E = self.fluke_params()
        out = [('fluke', tuple(E), (E[0], E[1] + 0.8 * c0, E[2]), 'tail_5')]
        for side, nm in ((1, 'fluke_tip_L'), (-1, 'fluke_tip_R')):
            x0 = side * S * 0.22; x1 = side * S * 0.48
            le0, ch0, _ = self.fluke_le_chord(x0); le1, ch1, _ = self.fluke_le_chord(x1)
            out.append((nm, (x0, le0 + 0.4 * ch0, E[2]), (x1, le1 + 0.4 * ch1, E[2]), 'fluke'))
        return out

    # bones --------------------------------------------------------------
    def bone_layout(self):
        U = self.U
        bones = []
        c = self.centerline
        r = c(0.38)
        bones.append(('root', r, (r[0], r[1], r[2] + 0.6 * U), None))
        par = 'root'
        for name, a, b in SPINE_FWD:
            bones.append((name, c(a), c(b), par)); par = name
        par = 'root'
        for name, a, b in SPINE_BACK:
            bones.append((name, c(a), c(b), par)); par = name
        bones += self.fluke_bones()
        bones += self.fin_bones(1) + self.fin_bones(-1)
        b0 = c(0.30)
        bones.append(('breath', b0, (b0[0], b0[1], b0[2] + 0.4 * U), 'chest'))
        bt = self.sp['blow_t']
        bx, by, bz = [float(v) for v in self.point(bt, 0.0)]
        bones.append(('blowhole', (0.0, by, bz), (0.0, by, bz + 0.4 * U), 'neck' if bt > 0.12 else 'head'))
        return bones

    # eyes ---------------------------------------------------------------
    def build_eyes(self, mb):
        sp = self.sp; B = self.style == 'B'
        m = sp['mouth']
        for side in (1, -1):
            th = (m['th1'] - 0.075) * math.pi
            if side < 0: th = TAU - th
            t = sp['eye_t']
            P = np.array([float(v) for v in self.point(t, th)])
            n = self.normal(t, th)
            w = self.spine_w(t)
            if not B:
                r = 0.0075 * self.L
                ctr = P + n * (-0.25 * r)
                self._sphere(mb, ctr, r, (0.04, 0.04, 0.05), w, highlight=(n, (0.9, 0.9, 0.9)))
            else:
                r = 0.0135 * self.L
                ctr = P + n * (-0.35 * r)
                self._sphere(mb, ctr, r, (0.97, 0.97, 0.95), w)
                up = np.array([0, 0, 1.0])
                iris = ctr + n * 0.52 * r + up * 0.05 * r
                self._sphere(mb, iris, 0.62 * r, (0.05, 0.05, 0.07), w)
                self._sphere(mb, iris + n * 0.5 * r + up * 0.22 * r - np.array([0, 0.15 * r, 0]), 0.17 * r,
                             (1, 1, 1), w)

    def _sphere(self, mb, ctr, r, col, w, highlight=None, sub=2):
        v, f = icosphere(sub)
        verts = [tuple(ctr + np.array(p) * r) for p in v]
        cl = s2l(col)
        cols = []
        for p in v:
            c = tuple(cl)
            if highlight is not None:
                n, hc = highlight
                hd = np.array(n) * 0.7 + np.array([0, 0, 0.7])
                hd /= np.linalg.norm(hd)
                if np.dot(np.array(p), hd) > 0.86:
                    c = tuple(s2l(hc))
            cols.append(c)
        mb.add(verts, f, cols, [dict(w) for _ in verts], True)
