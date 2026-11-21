"""v2 whale body: anatomical parts -> OpenVDB level sets -> smooth CSG -> one organic surface.

Junctions (flipper armpits, fluke/peduncle, jaw hinge, dorsal fin) get real fillets from smooth-min unions;
the mouth is a crease carved exactly along the junction between the skull/rostrum and the lower jaw.
"""
import math
import numpy as np
import openvdb as vdb
from .util import pchip, sstep, smoothstep, TAU, icosphere, s2l
from .anatomy import ANATOMY
from .body import ANCHORS, SPINE_FWD, SPINE_BACK


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def naca(chi, tau):
    return 5 * tau * (0.2969 * np.sqrt(chi) - 0.1260 * chi - 0.3516 * chi ** 2 + 0.2843 * chi ** 3 - 0.1036 * chi ** 4)


def _norm(v):
    v = np.asarray(v, float); return v / (np.linalg.norm(v) + 1e-12)


def _rot(v, axis, ang):
    axis = _norm(axis); v = np.asarray(v, float)
    return v * math.cos(ang) + np.cross(axis, v) * math.sin(ang) + axis * np.dot(axis, v) * (1 - math.cos(ang))


class SDFBody:
    def __init__(self, sp, key, style):
        self.sp = sp; self.key = key; self.style = style
        self.an = an = ANATOMY[key]
        self.L = L = sp['L']; self.U = L / 14.0
        r = np.array(an['trunk'], float); t = r[:, 0]
        self.W = pchip(t, r[:, 1] * L); self.HT = pchip(t, r[:, 2] * L); self.HB = pchip(t, r[:, 3] * L)
        self.C = pchip(t, r[:, 4] * L); self.N = pchip(t, r[:, 5])
        j = np.array(an['jaw'], float); self.jt0, self.jt1 = j[0, 0], j[-1, 0]
        self.JW = pchip(j[:, 0], j[:, 1] * L); self.JL = pchip(j[:, 0], j[:, 2] * L)
        self.JD = pchip(j[:, 0], j[:, 3] * L); self.JZ = pchip(j[:, 0], j[:, 4] * L)
        self.y0 = -0.40 * L
        self.vox = L / 430.0
        self.dorsal = None
        self.parts = {}

    # ------------------------------------------------------------ trunk surface helpers (used by island/paint)
    def y(self, t):
        return self.y0 + np.asarray(t) * self.L

    def t_of_y(self, y):
        return (np.asarray(y) - self.y0) / self.L

    def point(self, t, th):
        t = np.clip(np.asarray(t, float), 0, 1); th = np.asarray(th, float)
        W = self.W(t); HT = self.HT(t); HB = self.HB(t); C = self.C(t); n = self.N(t)
        s = np.sin(th); c = np.cos(th); e = 2.0 / n
        x = W * np.sign(s) * np.abs(s) ** e
        H = np.where(c > 0, HT, HB)
        z = C + H * np.sign(c) * np.abs(c) ** e
        return x, (self.y0 + t * self.L) * np.ones_like(x), z

    def normal(self, t, th):
        p = np.array([float(v) for v in self.point(t, th)])
        a = np.array([float(v) for v in self.point(t + 1e-3, th)]) - p
        b = np.array([float(v) for v in self.point(t, th + 1e-3)]) - p
        n = np.cross(b, a); n /= np.linalg.norm(n) + 1e-12
        if np.dot(n, np.array([p[0], 0, p[2] - float(self.C(t))])) < 0:
            n = -n
        return n

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

    def spine_w(self, t):
        t = float(t)
        if t <= ANCHORS[0][1]:
            return {ANCHORS[0][0]: 1.0}
        for i in range(len(ANCHORS) - 1):
            a, ta = ANCHORS[i]; b, tb = ANCHORS[i + 1]
            if t <= tb:
                k = sstep(0, 1, (t - ta) / (tb - ta)); d = {}
                if 1 - k > 1e-3: d[a] = 1 - k
                if k > 1e-3: d[b] = k
                return d
        return {ANCHORS[-1][0]: 1.0}

    def spine_w_y(self, y):
        return self.spine_w(self.t_of_y(y))

    def bone_for_t(self, t):
        for name, a, b in SPINE_FWD:
            if b <= t <= a:
                return name
        for name, a, b in SPINE_BACK:
            if a <= t <= b:
                return name
        return 'head' if t < 0.2 else 'tail_5'

    # ------------------------------------------------------------ part meshes (closed)
    def trunk_mesh(self):
        N, M = 190, 72
        ks = np.arange(1, N) / N
        ts = 0.5 * ks + 0.5 * (1 - np.cos(np.pi * ks)) / 2
        ths = np.arange(M) * TAU / M
        V = []
        for t in ts:
            x, y, z = self.point(np.full(M, t), ths)
            V += list(zip(x, y, z))
        V.append(self.centerline(0.0)); V.append(self.centerline(1.0))
        nose, tail = len(V) - 2, len(V) - 1
        F = []
        for i in range(len(ts) - 1):
            for j in range(M):
                j2 = (j + 1) % M
                F.append((i * M + j, i * M + j2, (i + 1) * M + j2, (i + 1) * M + j))
        last = (len(ts) - 1) * M
        for j in range(M):
            j2 = (j + 1) % M
            F.append((nose, j2, j)); F.append((last + j, last + j2, tail))
        return V, F

    def jaw_point(self, t, th):
        W = self.JW(t); Lp = self.JL(t); D = self.JD(t); Z = self.JZ(t)
        s, c = np.sin(th), np.cos(th); e = 2.0 / 2.2
        x = W * np.sign(s) * np.abs(s) ** e
        z = Z + np.where(c > 0, Lp, D) * np.sign(c) * np.abs(c) ** e
        return x, self.y(t) * np.ones_like(x), z

    def jaw_mesh(self):
        N, M = 70, 48
        ts = np.linspace(self.jt0, self.jt1, N)
        ths = np.arange(M) * TAU / M
        V = []
        for t in ts:
            x, y, z = self.jaw_point(np.full(M, t), ths)
            V += list(zip(x, y, z))
        V.append((0.0, float(self.y(self.jt0 - 0.004)), float(self.JZ(self.jt0)) - float(self.JD(self.jt0)) * 0.3))
        V.append((0.0, float(self.y(self.jt1)), float(self.JZ(self.jt1)) - float(self.JD(self.jt1)) * 0.5))
        a, b = len(V) - 2, len(V) - 1
        F = []
        for i in range(N - 1):
            for j in range(M):
                j2 = (j + 1) % M
                F.append((i * M + j, i * M + j2, (i + 1) * M + j2, (i + 1) * M + j))
        for j in range(M):
            j2 = (j + 1) % M
            F.append((a, j2, j)); F.append(((N - 1) * M + j, (N - 1) * M + j2, b))
        return V, F

    # flipper -----------------------------------------------------------------
    def fin_spec(self):
        f = self.an['fin']; L = self.L
        return f, f['len'] * L, f['chord'] * L

    def fin_chord(self, s):
        f, ln, c0 = self.fin_spec()
        tbl = {'slender': ([0, .15, .4, .7, .9, 1], [1.0, 1.05, .85, .55, .30, .06]),
               'humpback': ([0, .15, .4, .7, .9, 1], [1.0, .95, .80, .62, .40, .12]),
               'paddle': ([0, .2, .5, .75, .92, 1], [1.0, 1.1, 1.05, .88, .55, .15])}[f['shape']]
        return 1.18 * c0 * float(np.interp(max(s, 0.0), *tbl))

    def fin_le(self, s):
        f, ln, c0 = self.fin_spec()
        back = {'slender': 0.42, 'humpback': 0.25, 'paddle': 0.12}[f['shape']]
        le = -0.30 * c0 + back * c0 * max(s, 0) ** 1.3
        if f['scallops'] and s > 0.10:
            le -= 0.11 * c0 * max(0.0, math.sin((s - 0.1) * math.pi * f['scallops'])) ** 2
        return le

    def fin_frames(self, side, n=48):
        """centre-line frames along the span s in [-0.25, 1]."""
        f, ln, c0 = self.fin_spec()
        th = f['th'] * math.pi
        if side < 0:
            th = TAU - th
        P = np.array([float(v) for v in self.point(f['t'], th)])
        Cc = np.array(self.centerline(f['t']))
        P = P - 0.30 * (P - Cc)
        dr = math.radians(f['droop']); sw = math.radians(f['sweep'])
        d0 = _norm([side * math.cos(dr) * math.cos(sw), math.sin(sw), -math.sin(dr)])
        ss = np.linspace(-0.25, 1.0, n)
        frames = []
        pos = P - d0 * 0.25 * ln
        prev = None
        for s in ss:
            q = max(s, 0.0)
            d = _rot(d0, [0, 0, 1], side * math.radians(f['curve']) * q ** 1.5)      # bend back along span
            if f['tip_up']:
                d = _rot(d, np.cross(d, [0, 0, 1]), math.radians(f['tip_up']) * sstep(0.55, 1.0, q))
            cd = _norm(np.array([0, 1.0, 0]) - d * d[1])
            nn = np.cross(d, cd)
            if nn[2] < 0: nn = -nn
            if prev is not None:
                pos = pos + d * (s - prev) * ln
            prev = s
            frames.append((s, pos.copy(), d, cd, nn))
        return frames

    def fin_mesh(self, side):
        f, ln, c0 = self.fin_spec()
        frames = self.fin_frames(side)
        NC = 28
        tmin = 1.7 * self.vox
        V = []
        for s, pos, d, cd, nn in frames:
            ch = self.fin_chord(s); le = self.fin_le(s)
            for k in range(NC):
                ph = TAU * k / NC
                chi = 0.5 - 0.5 * math.cos(ph)
                yt = float(naca(chi, f['thick'])) * ch + tmin
                sg = 1 if ph <= math.pi else -1
                V.append(tuple(pos + cd * (le + chi * ch) + nn * sg * yt))
        F = []
        R = len(frames)
        for i in range(R - 1):
            for k in range(NC):
                k2 = (k + 1) % NC
                F.append((i * NC + k, i * NC + k2, (i + 1) * NC + k2, (i + 1) * NC + k))
        V.append(tuple(np.mean(np.array(V[:NC]), axis=0))); a = len(V) - 1
        V.append(tuple(np.mean(np.array(V[(R - 1) * NC:R * NC]), axis=0))); b = len(V) - 1
        for k in range(NC):
            k2 = (k + 1) % NC
            F.append((a, k2, k)); F.append(((R - 1) * NC + k, (R - 1) * NC + k2, b))
        return V, F

    def fin_param(self, side, P):
        """(s, chi, top) for points P (N,3) relative to the flipper frames (nearest frame)."""
        frames = self.fin_frames(side, 64)
        pos = np.array([fr[1] for fr in frames]); ss = np.array([fr[0] for fr in frames])
        d = np.array([fr[2] for fr in frames]); cd = np.array([fr[3] for fr in frames]); nn = np.array([fr[4] for fr in frames])
        # nearest frame along span: project onto span by minimising |dot(P-pos, d)|
        rel = P[:, None, :] - pos[None, :, :]
        along = np.einsum('nfk,fk->nf', rel, d)
        i = np.argmin(np.abs(along), axis=1)
        s = np.clip(ss[i] + along[np.arange(len(P)), i] / self.fin_spec()[1], -0.25, 1.0)
        rr = rel[np.arange(len(P)), i]
        c = np.einsum('nk,nk->n', rr, cd[i]); h = np.einsum('nk,nk->n', rr, nn[i])
        ch = np.array([self.fin_chord(v) for v in s]); le = np.array([self.fin_le(v) for v in s])
        chi = np.clip((c - le) / ch, 0, 1)
        return s, chi, h >= 0

    FIN_S = (-0.14, 0.18, 0.39, 0.60, 0.80, 0.985)   # shoulder (inside body) -> tip

    def fin_bones(self, side):
        pre = 'fin_L' if side > 0 else 'fin_R'
        frames = self.fin_frames(side, 81)
        pts = []
        for target in self.FIN_S:
            fr = min(frames, key=lambda F: abs(F[0] - target))
            s, pos, d, cd, nn = fr
            pts.append(tuple(pos + cd * (self.fin_le(s) + 0.38 * self.fin_chord(s))))
        n = len(pts) - 1
        return [(f'{pre}_{i + 1}', pts[i], pts[i + 1], 'chest' if i == 0 else f'{pre}_{i}') for i in range(n)]

    # fluke -------------------------------------------------------------------
    def fluke_spec(self):
        f = self.an['fluke']; L = self.L
        S = f['span'] * L; c0 = f['chord'] * L
        E = np.array(self.centerline(1.0))
        return f, S, c0, E

    def fluke_le_chord(self, x):
        f, S, c0, E = self.fluke_spec()
        q = min(abs(x) / (S / 2), 0.999)
        le = E[1] - 0.35 * c0 + f['sweep'] * (S / 2) * q ** f['tip']
        te = f['te']
        if te == 'straight':
            ch = c0 * (1 - q)
        elif te == 'convex':
            ch = c0 * (1 - q ** 2) ** 0.8
        else:
            ch = c0 * (1 - q) ** 1.15 * (1 + 0.3 * q)
        if te == 'serrated':
            ch *= 1 + 0.06 * math.sin(q * 46) * q
        ch *= 1 - f['notch'] * math.exp(-(x / (0.045 * S)) ** 2)
        return le, max(ch, 2.5 * self.vox), q

    def fluke_mesh(self):
        f, S, c0, E = self.fluke_spec()
        Nx, NC = 61, 24
        us = np.cos(np.linspace(np.pi, 0, Nx)) * 0.997
        tmin = 1.6 * self.vox
        V = []
        for u in us:
            x = u * S / 2
            le, ch, q = self.fluke_le_chord(x)
            thick = 0.20
            for k in range(NC):
                ph = TAU * k / NC; chi = 0.5 - 0.5 * math.cos(ph)
                yt = float(naca(chi, thick)) * ch + tmin + 0.010 * self.L * math.exp(-(x / (0.06 * S)) ** 2) * (1 - chi) ** 2
                sg = 1 if ph <= math.pi else -1
                V.append((x, le + chi * ch, E[2] + sg * yt))
        F = []
        for i in range(Nx - 1):
            for k in range(NC):
                k2 = (k + 1) % NC
                F.append((i * NC + k, (i + 1) * NC + k, (i + 1) * NC + k2, i * NC + k2))
        V.append(tuple(np.mean(np.array(V[:NC]), axis=0))); a = len(V) - 1
        V.append(tuple(np.mean(np.array(V[(Nx - 1) * NC:]), axis=0))); b = len(V) - 1
        for k in range(NC):
            k2 = (k + 1) % NC
            F.append((a, k, k2)); F.append(((Nx - 1) * NC + k2, (Nx - 1) * NC + k, b))
        return V, F

    def fluke_bones(self):
        f, S, c0, E = self.fluke_spec()
        out = [('fluke', tuple(E), (E[0], E[1] + 0.7 * c0, E[2]), 'tail_5')]
        for side, sd in ((1, 'L'), (-1, 'R')):
            pts = []
            for q in (0.18, 0.55, 0.97):
                x = side * q * S / 2; le, ch, _ = self.fluke_le_chord(x)
                pts.append((x, le + 0.4 * ch, E[2]))
            out.append((f'fluke_{sd}_1', pts[0], pts[1], 'fluke'))
            out.append((f'fluke_{sd}_2', pts[1], pts[2], f'fluke_{sd}_1'))
        return out

    # dorsal fin ----------------------------------------------------------------
    def dorsal_mesh(self):
        d = self.an.get('dorsal')
        if not d:
            return None
        L = self.L; h = d['h'] * L; base = d['base'] * L
        t0 = d['t']; y0 = float(self.y(t0)) - base * 0.5
        NF, NC = 22, 20
        tmin = 0.9 * self.vox
        V = []
        for i in range(NF):
            fz = -0.5 + 1.5 * i / (NF - 1)
            fq = max(fz, 0)
            ch = base * (1 - fq) ** 0.9 + 0.12 * base * (1 - fq ** 4)
            ch = max(ch, 2 * self.vox)
            le = y0 + d['rake'] * base * fq ** 1.4
            yy = le
            zc_base = float(self.top_z(np.array([y0 + base / 2]), np.array([0.0]))[0])
            z = zc_base + fz * h
            for k in range(NC):
                ph = TAU * k / NC; chi = 0.5 - 0.5 * math.cos(ph)
                xt = float(naca(chi, 0.26)) * ch + tmin
                sg = 1 if ph <= math.pi else -1
                V.append((sg * xt, yy + chi * ch, z))
        F = []
        for i in range(NF - 1):
            for k in range(NC):
                k2 = (k + 1) % NC
                F.append((i * NC + k, (i + 1) * NC + k, (i + 1) * NC + k2, i * NC + k2))
        V.append(tuple(np.mean(np.array(V[:NC]), axis=0))); a = len(V) - 1
        V.append(tuple(np.mean(np.array(V[(NF - 1) * NC:]), axis=0))); b = len(V) - 1
        for k in range(NC):
            k2 = (k + 1) % NC
            F.append((a, k, k2)); F.append(((NF - 1) * NC + k2, (NF - 1) * NC + k, b))
        return V, F

    # ------------------------------------------------------------ eye placement
    def eye_frame(self, side):
        e = self.an['eye']; L = self.L
        t = e['t']
        tj = min(max(t, self.jt0), self.jt1)
        z = float(self.JZ(tj) + self.JL(tj)) + e['up'] * L
        y = float(self.y(t))
        x = side * float(max(self.side_x(np.array([y]), np.array([z]))[0], 0.4 * float(self.JW(tj))))
        return np.array([x, y, z])

    # ------------------------------------------------------------ grid
    def _bbox(self, meshes):
        allv = np.concatenate([np.array(v) for v, f in meshes])
        lo = allv.min(0) - 0.05 * self.L; hi = allv.max(0) + 0.05 * self.L
        return lo, hi

    def _levelset(self, V, F, hw):
        V = np.asarray(V, np.float32)
        tris = np.array([f for f in F if len(f) == 3], np.int32).reshape(-1, 3)
        quads = np.array([f for f in F if len(f) == 4], np.int32).reshape(-1, 4)
        xf = vdb.createLinearTransform(voxelSize=self.vox)
        g = vdb.FloatGrid.createLevelSetFromPolygons(V, triangles=tris, quads=quads, transform=xf, halfWidth=hw)
        arr = np.full(self.shape, hw * self.vox, np.float32)
        g.copyToArray(arr, ijk=tuple(int(v) for v in self.i0))
        return arr

    def _coords(self, lo, hi):
        """index slices + world coordinate arrays for an axis-aligned sub-box."""
        a = np.maximum(np.floor(np.asarray(lo) / self.vox).astype(int) - self.i0, 0)
        b = np.minimum(np.ceil(np.asarray(hi) / self.vox).astype(int) - self.i0 + 1, np.array(self.shape))
        sl = tuple(slice(int(a[i]), int(b[i])) for i in range(3))
        ax = [(np.arange(a[i], b[i]) + self.i0[i]) * self.vox for i in range(3)]
        X, Y, Z = np.meshgrid(*ax, indexing='ij')
        return sl, X, Y, Z

    def build(self, log=print):
        L = self.L; vox = self.vox; an = self.an
        meshes = {'trunk': self.trunk_mesh(), 'jaw': self.jaw_mesh(), 'finL': self.fin_mesh(1),
                  'finR': self.fin_mesh(-1), 'fluke': self.fluke_mesh()}
        dm = self.dorsal_mesh()
        if dm: meshes['dorsal'] = dm
        lo, hi = self._bbox(meshes.values())
        self.i0 = np.floor(lo / vox).astype(int)
        self.shape = tuple((np.ceil(hi / vox).astype(int) - self.i0 + 1).tolist())
        log(f'grid {self.shape} vox={vox:.4f}')
        hw = 14.0
        self.band = hw * vox
        A = {k: self._levelset(*v, hw) for k, v in meshes.items() if k != 'dorsal'}
        trunk = A['trunk']; jaw = A['jaw']
        # skull/rostrum + lower jaw, then carve the mouth crease along their junction
        body = smin(trunk, jaw, 0.004 * L)
        sl, X, Y, Z = self._coords(np.array([-0.2 * L, self.y(self.jt0) - 0.03 * L, -0.3 * L]),
                                   np.array([0.2 * L, self.y(an['mouth_end']) + 0.03 * L, 0.2 * L]))
        dt_, dj_ = trunk[sl], jaw[sl]
        tt = (Y - self.y0) / L
        endfade = smoothstep(an['mouth_end'] + 0.006, an['mouth_end'] - 0.012, tt)
        near = np.exp(-(np.abs(dt_ - dj_) / (0.0045 * L)) ** 2) * np.exp(-(np.minimum(dt_, dj_) / (0.02 * L)) ** 2)
        body[sl] = body[sl] + an.get('crease', 0.0055) * L * near * endfade
        # features
        for kind, p in an['features']:
            self._feature(body, kind, p)
        # eye lids
        er = an['eye']['r'] * L
        for side in (1, -1):
            c = self.eye_frame(side)
            sl, X, Y, Z = self._coords(c - 4 * er, c + 4 * er)
            d = np.sqrt(((X - c[0]) / 1.7) ** 2 + ((Y - c[1]) / 2.1) ** 2 + ((Z - c[2]) / 1.5) ** 2) - er
            body[sl] = smin(body[sl], d.astype(np.float32), 1.6 * er)
        if dm:
            dor = self._levelset(*dm, hw)
            body = smin(body, dor, 0.010 * L)
            del dor
        self.A = {'body': body, 'finL': A['finL'], 'finR': A['finR'], 'fluke': A['fluke'],
                  'trunk': trunk, 'jaw': jaw}
        kf = 0.028 * L; kfl = 0.018 * L
        final = smin(body, A['finL'], kf)
        final = smin(final, A['finR'], kf)
        final = smin(final, A['fluke'], kfl)
        g = vdb.FloatGrid(background=float(hw * vox))
        g.copyFromArray(final.astype(np.float32), ijk=tuple(int(v) for v in self.i0))
        g.transform = vdb.createLinearTransform(voxelSize=vox)
        g.gridClass = vdb.GridClass.LEVEL_SET
        pts, quads = g.convertToQuads(isovalue=0.0)
        self.final = final
        self.A['final'] = final
        log(f'surface quads={len(quads)}')
        return np.asarray(pts, float), np.asarray(quads, int)

    def _feature(self, body, kind, p):
        L = self.L
        if kind == 'ellipsoid':
            t = p['t']; y = float(self.y(t))
            if p['z'] == 'top':
                z = float(self.top_z(np.array([y]), np.array([0.0]))[0])
            elif p['z'] == 'chin':
                tj = min(max(t, self.jt0), self.jt1); z = float(self.JZ(tj) - self.JD(tj))
            else:
                z = float(self.C(t)) + p['z'] * L
            c = np.array([p['x'] * L, y, z]); r = np.array(p['r']) * L
            sl, X, Y, Z = self._coords(c - r - 0.05 * L, c + r + 0.05 * L)
            q = np.sqrt(((X - c[0]) / r[0]) ** 2 + ((Y - c[1]) / r[1]) ** 2 + ((Z - c[2]) / r[2]) ** 2)
            d = (q - 1) * r.min()
            body[sl] = smin(body[sl], d.astype(np.float32), p['k'] * L)
        elif kind == 'ridge':
            ts = np.linspace(p['t0'], p['t1'], 40)
            pts = [(0.0, float(self.y(t)), float(self.top_z(np.array([float(self.y(t))]), np.array([0.0]))[0]) + p['h'] * L
                    * math.sin(math.pi * (t - p['t0']) / (p['t1'] - p['t0'])) ** 0.5) for t in ts]
            self._capsule_chain(body, pts, p['r'] * L, p['k'] * L, union=True)
        elif kind == 'knuckles':
            for t in np.linspace(p['t0'], p['t1'], p['n']):
                y = float(self.y(t)); z = float(self.top_z(np.array([y]), np.array([0.0]))[0])
                self._sphere(body, (0, y, z), p['r'] * L * (1.1 - 0.3 * (t - p['t0']) / (p['t1'] - p['t0'])), p['k'] * L)
        elif kind == 'tubercles':
            rng = np.random.default_rng(7)
            for t in np.linspace(p['t0'], p['t1'], p['n']):
                y = float(self.y(t))
                if p['where'] == 'rostrum':
                    W = float(self.W(t))
                    for row in range(p['rows']):
                        xs = [W * rng.uniform(-0.08, 0.08)] if row == 0 else [W * (0.3 * row + rng.uniform(-0.05, 0.05)), -W * (0.3 * row + rng.uniform(-0.05, 0.05))]
                        for x in xs:
                            if rng.random() < 0.2:
                                continue
                            z = float(self.top_z(np.array([y]), np.array([x]))[0])
                            self._sphere(body, (x, y + rng.uniform(-0.004, 0.004) * L, z), p['r'] * L * rng.uniform(0.8, 1.15), p['k'] * L)
                else:
                    tj = min(max(t, self.jt0), self.jt1)
                    for sgn in (1, -1):
                        x = sgn * float(self.JW(tj)) * 0.96; z = float(self.JZ(tj) - self.JD(tj) * 0.32)
                        self._sphere(body, (x, y, z), p['r'] * L * rng.uniform(0.8, 1.1), p['k'] * L)
        elif kind == 'blowholes':
            y = float(self.y(p['t']))
            for sgn in (1, -1):
                x = sgn * p['sep'] * L
                z = float(self.top_z(np.array([y]), np.array([x]))[0])
                self._capsule_chain(body, [(x * 0.6, y - 0.012 * L, z), (x, y + 0.006 * L, z)], p['r'] * L, 0.002 * L, union=False)
        elif kind == 'slit':
            y = float(self.y(p['t'])); x = p['x'] * L
            z = float(self.top_z(np.array([y]), np.array([x]))[0])
            self._capsule_chain(body, [(x - 0.006 * L, y - 0.004 * L, z), (x + 0.004 * L, y + 0.004 * L, z),
                                       (x + 0.010 * L, y + 0.012 * L, z)], p['r'] * L, 0.002 * L, union=False)
        elif kind == 'ring':
            y = float(self.y(p['t']))
            sl, X, Y, Z = self._coords(np.array([-0.3 * L, y - 3 * p['w'] * L, -0.3 * L]), np.array([0.3 * L, y + 3 * p['w'] * L, 0.3 * L]))
            body[sl] = body[sl] + (p['depth'] * L * np.exp(-((Y - y) / (p['w'] * L)) ** 2)).astype(np.float32)

    def _sphere(self, body, c, r, k):
        c = np.array(c, float)
        sl, X, Y, Z = self._coords(c - r - k - 0.01 * self.L, c + r + k + 0.01 * self.L)
        d = np.sqrt((X - c[0]) ** 2 + (Y - c[1]) ** 2 + (Z - c[2]) ** 2) - r
        body[sl] = smin(body[sl], d.astype(np.float32), k)

    def _capsule_chain(self, body, pts, r, k, union=True):
        P = np.array(pts, float)
        sl, X, Y, Z = self._coords(P.min(0) - r - k - 0.01 * self.L, P.max(0) + r + k + 0.01 * self.L)
        Q = np.stack([X, Y, Z], -1)
        d = np.full(X.shape, 1e9)
        for a, b in zip(P[:-1], P[1:]):
            ab = b - a; t = np.clip(((Q - a) @ ab) / (ab @ ab), 0, 1)
            d = np.minimum(d, np.linalg.norm(Q - (a + t[..., None] * ab), axis=-1))
        d = (d - r).astype(np.float32)
        body[sl] = smin(body[sl], d, k) if union else smax(body[sl], -d, k)

    # ------------------------------------------------------------ sampling the part fields at points
    def sample(self, name, P):
        A = self.A[name]
        idx = P / self.vox - self.i0
        i = np.floor(idx).astype(int); f = idx - i
        sh = np.array(A.shape)
        i = np.clip(i, 0, sh - 2)
        out = 0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                    out = out + w * A[i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
        return out

    def grad(self, P, name='final'):
        A = self.final if name == 'final' else self.A[name]
        self.A['_g'] = A
        e = self.vox
        g = np.stack([self.sample('_g', P + np.array([e, 0, 0])) - self.sample('_g', P - np.array([e, 0, 0])),
                      self.sample('_g', P + np.array([0, e, 0])) - self.sample('_g', P - np.array([0, e, 0])),
                      self.sample('_g', P + np.array([0, 0, e])) - self.sample('_g', P - np.array([0, 0, e]))], -1)
        return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-9)

    # ------------------------------------------------------------ bones
    def bone_layout(self):
        U = self.U; c = self.centerline
        r = c(0.38)
        bones = [('root', r, (r[0], r[1], r[2] + 0.6 * U), None)]
        par = 'root'
        for name, a, b in SPINE_FWD:
            bones.append((name, c(a), c(b), par)); par = name
        par = 'root'
        for name, a, b in SPINE_BACK:
            bones.append((name, c(a), c(b), par)); par = name
        bones += self.fluke_bones() + self.fin_bones(1) + self.fin_bones(-1)
        b0 = c(0.30)
        bones.append(('breath', b0, (b0[0], b0[1], b0[2] + 0.4 * U), 'chest'))
        bt = self.an['blow']; by = float(self.y(bt))
        bz = float(self.top_z(np.array([by]), np.array([0.0]))[0])
        bones.append(('blowhole', (0.0, by, bz), (0.0, by, bz + 0.4 * U), 'neck' if bt > 0.12 else 'head'))
        return bones
