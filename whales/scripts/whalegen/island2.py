"""v2 grown-in island.

The island is defined on the whale's own surface (t along the body, theta around it). Soil thickness tapers
to zero at the footprint edge, then a thin "mantle" of moss/soil drapes over the skin and ends in an irregular
fingered fringe that dives under the skin, so there is no seam. Roots, moss, barnacles, small plants and rocky
outcrops spill past the edge; waterfalls flow over the flank.
"""
import math
import numpy as np
from .util import fbm, smoothstep, sstep, TAU, s2l, mix, mul, rotate_axis
from .island import Island
from . import props as P

ISLAND = {
    'blue': dict(tc=0.43, a=0.195, frac=0.84, thick=0.020),
    'sperm': dict(tc=0.47, a=0.200, frac=0.82, thick=0.018),
    'beluga': dict(tc=0.41, a=0.190, frac=0.84, thick=0.022),
    'humpback': dict(tc=0.44, a=0.200, frac=0.84, thick=0.020),
    'bowhead': dict(tc=0.475, a=0.190, frac=0.84, thick=0.020),
    'minke': dict(tc=0.41, a=0.190, frac=0.84, thick=0.020),
}


class Island2(Island):
    def __init__(self, body, biome_key, biome, style, rng):
        sp = body.sp
        sp['island'] = ISLAND[body.key]
        super().__init__(body, biome_key, biome, style, rng)
        isl = sp['island']
        self.tc = isl['tc']; self.a = isl['a']
        n = float(body.N(self.tc))
        self.thmax = math.asin(min(0.999, isl['frac'] ** (n / 2)))
        self.thick = isl['thick'] * body.L * (1.15 if style == 'B' else 1.0)
        self.amp = 0.07 * self.U
        self.Rm = 1.55
        ph = rng.uniform(0, TAU, 3)
        self._fing = ph
        self.outcrops = []

    # ------------------------------------------------------------ footprint on the surface
    def uv2tth(self, u, v):
        return self.tc + self.a * np.asarray(u), np.asarray(v) * self.thmax

    def uv2xy(self, u, v):
        t, th = self.uv2tth(u, v)
        x, y, z = self.b.point(t, th)
        return float(x), float(y)

    def polar(self, x, y):
        b = self.b
        x = np.asarray(x, float); y = np.asarray(y, float)
        t = b.t_of_y(y)
        W = np.maximum(b.W(t), 1e-6); n = b.N(t)
        s = np.sign(x) * np.clip(np.abs(x) / W, 0, 1) ** (n / 2)
        th = np.arcsin(np.clip(s, -1, 1))
        u = (t - self.tc) / self.a; v = th / self.thmax
        return np.hypot(u, v), np.arctan2(v, u)

    def Bw(self, y):
        return self.frac * self.b.W(self.b.t_of_y(y))

    def edge_ext(self, phi):
        """fringe extent of the mantle (in footprint radii) - irregular moss tongues."""
        a, b2, c = self._fing
        n = (0.5 + 0.5 * np.sin(phi * 7 + a)) * (0.5 + 0.5 * np.sin(phi * 13 + b2)) + 0.35 * (0.5 + 0.5 * np.sin(phi * 23 + c))
        return 1.06 + 0.42 * np.clip(n, 0, 1.2) ** 1.6

    # ------------------------------------------------------------ skin height (exact, from the SDF)
    def skin_z(self, x, y):
        b = self.b
        x = np.atleast_1d(np.asarray(x, float)); y = np.atleast_1d(np.asarray(y, float))
        z = b.top_z(y, x) + 0.1 * self.U
        for _ in range(3):
            Pp = np.stack([x, y, z], 1)
            f = b.sample('final', Pp); g = b.grad(Pp)
            z = z - f / np.maximum(g[:, 2], 0.3)
        return z

    def H0(self, x, y):
        U = self.U
        x = np.asarray(x, float); y = np.asarray(y, float)
        shp = x.shape
        xf, yf = x.ravel(), y.ravel()
        skin = self.skin_z(xf, yf)
        rn = self.rnorm(xf, yf)
        prof = (1 - smoothstep(0.40, 1.0, rn)) ** 0.9
        relief = 1 - smoothstep(0.70, 0.98, rn)
        n = fbm(xf / (1.3 * U), yf / (1.3 * U), self.seed)
        h = self.thick * prof + 0.04 * U + self.amp * (n - 0.5) * 2 * relief
        for hx, hy, hr, hh in self.hills:
            h = h + hh * np.exp(-((xf - hx) ** 2 + (yf - hy) ** 2) / hr ** 2) * relief
        if self.extra is not None:
            h = h + self.extra(xf, yf) * relief
        return (skin + h).reshape(shp)

    # ------------------------------------------------------------ terrain + mantle mesh
    def build_terrain(self, mb):
        from .bodymesh import project_to_surface
        B = self.style == 'B'; U = self.U; b = self.b
        NR = 24 if B else 27; NM = 9; NA = 104 if B else 116
        phis = np.arange(NA) * TAU / NA
        Rp = self.R(phis)
        ext = self.edge_ext(phis)
        rs = np.concatenate([np.linspace(1.0 / NR, 1.0, NR), np.linspace(1.0 + (self.Rm - 1) / NM, self.Rm, NM)])
        X = np.zeros((len(rs), NA)); Y = np.zeros_like(X); Z = np.zeros_like(X); fade = np.zeros_like(X)
        for i, r in enumerate(rs):
            u = r * Rp * np.cos(phis); v = r * Rp * np.sin(phis)
            t, th = self.uv2tth(u, v)
            x, y, z = b.point(t, th)
            if r <= 1.0 + 1e-6:
                X[i], Y[i] = x, y
            else:
                Pp, Nn = project_to_surface(b, np.stack([x, y, z], 1) + 0.0)
                fd = smoothstep(ext - 0.06, ext, r)
                off = 0.035 * U * (1 - fd) - 0.06 * U * fd
                Pp = Pp + Nn * off[:, None]
                X[i], Y[i], Z[i] = Pp[:, 0], Pp[:, 1], Pp[:, 2]
                fade[i] = fd
        top = rs <= 1.0 + 1e-6
        Z[top] = self.H(X[top], Y[top])
        e = 0.02 * U
        Xt, Yt = X[top], Y[top]
        gx = (self.H(Xt + e, Yt) - self.H(Xt - e, Yt)) / (2 * e)
        gy = (self.H(Xt, Yt + e) - self.H(Xt, Yt - e)) / (2 * e)
        sk = self.skin_z(Xt.ravel(), Yt.ravel()).reshape(Xt.shape)
        slope = np.hypot(gx, gy) - 0.0 * sk
        verts = []; cols = []; wts = []
        cx, cy = self.uv2xy(0, 0)
        verts.append((cx, cy, self.ground(cx, cy))); cols.append(self.terrain_color(cx, cy, 0, 0)); wts.append(b.spine_w_y(cy))
        Pm = self.pal
        for i, r in enumerate(rs):
            for j in range(NA):
                x, y, z = float(X[i, j]), float(Y[i, j]), float(Z[i, j])
                verts.append((x, y, z))
                if top[i]:
                    c = self.terrain_color(x, y, z, float(slope[i, j]))
                    edge = sstep(0.82, 1.0, r)
                    c = mix(c, self.edge_color(x, y), 0.55 * edge)
                else:
                    c = self.edge_color(x, y)
                    k = (r - 1) / (self.Rm - 1)
                    c = mul(c, 0.92 + 0.12 * float(fbm(x / (0.2 * U), y / (0.2 * U), self.seed + 40)))
                    c = mix(c, Pm['moss'] if self.key not in ('tundra', 'desert') else c, 0.25 * k)
                cols.append(c); wts.append(b.spine_w_y(y))
        faces = []
        for j in range(NA):
            j2 = (j + 1) % NA
            faces.append((0, 1 + j2, 1 + j))
        for i in range(len(rs) - 1):
            for j in range(NA):
                j2 = (j + 1) % NA
                a = 1 + i * NA + j; bb = 1 + i * NA + j2; c = 1 + (i + 1) * NA + j2; d = 1 + (i + 1) * NA + j
                faces.append((a, bb, c, d))
        mb.add(verts, faces, [tuple(s2l(c)) for c in cols], wts, True)
        self.mantle = dict(X=X, Y=Y, Z=Z, rs=rs, phis=phis, ext=ext)

    def edge_color(self, x, y):
        Pm = self.pal; U = self.U
        n = float(fbm(x / (0.35 * U), y / (0.35 * U), self.seed + 33))
        if self.key == 'tundra':
            return mix((0.93, 0.96, 1.0), Pm['rock'], 0.25 * sstep(0.55, 0.75, n))
        if self.key == 'desert':
            return mix(Pm['ground2'], Pm['dirt'], 0.5 * n)
        base = mix(Pm['moss'], mul(Pm['moss'], 0.7), sstep(0.4, 0.7, n))
        return mix(base, Pm['dirt'], 0.35 * sstep(0.62, 0.8, n))

    # ------------------------------------------------------------ skin-aligned placement for spill-over props
    def skin_frame(self, u, v):
        from .bodymesh import project_to_surface
        t, th = self.uv2tth(u, v)
        x, y, z = self.b.point(t, th)
        p, n = project_to_surface(self.b, np.array([[float(x), float(y), float(z)]]))
        return p[0], n[0]

    def place_on_skin(self, parts, u, v, lift=0.0, rot=None, align=0.85):
        p, n = self.skin_frame(u, v)
        rot = self.rng.uniform(0, TAU) if rot is None else rot
        up = np.array([0, 0, 1.0]); nn = up * (1 - align) + n * align; nn /= np.linalg.norm(nn)
        axis = np.cross(up, nn); ang = math.acos(max(-1, min(1, float(np.dot(up, nn)))))
        out = []
        for vv, f, c, hf, sm in parts:
            vv = [(px * math.cos(rot) - py * math.sin(rot), px * math.sin(rot) + py * math.cos(rot), pz) for px, py, pz in vv]
            if np.linalg.norm(axis) > 1e-6:
                vv = rotate_axis(vv, axis, ang, (0, 0, 0))
            q = p + n * lift * self.U
            out.append(([(q[0] + a, q[1] + b_, q[2] + c_) for a, b_, c_ in vv], f, c, hf, sm))
        self.items.append(dict(parts=out, x=float(p[0]), y=float(p[1]), z=float(p[2]), weight='spine'))

    def spill_over(self):
        """roots, moss tongues, plants, barnacles and rock outcrops past the island edge."""
        rng = self.rng; U = self.U; B = self.style == 'B'; key = self.key; Pm = self.pal
        root_col = Pm['trunk']
        # rocky outcrops: either side of each waterfall lip + one feature rock
        for fl in self.falls:
            for dphi in (-0.19, 0.19):
                phi = fl['phi'] + dphi
                rr = float(self.R(phi)) * 0.97
                self.place_on_skin(P.boulder_stack(rng, U * 0.55, Pm['rock'], Pm['rock2'], self.style, moss=Pm['moss'] if self.key not in ('tundra', 'desert') else None),
                                   rr * math.cos(phi), rr * math.sin(phi), lift=-0.06, align=0.7)
        if not self.falls:
            phi = rng.uniform(0, TAU); rr = float(self.R(phi)) * 0.95
            self.place_on_skin(P.boulder_stack(rng, U * 1.0, Pm['rock'], Pm['rock2'], self.style, moss=Pm['moss'] if self.key not in ('tundra', 'desert') else None),
                               rr * math.cos(phi), rr * math.sin(phi), lift=-0.06, align=0.6)
        # roots gripping the flank
        if key not in ('tundra',):
            nroot = 14 if not B else 10
            for k in range(nroot):
                phi = rng.uniform(0, TAU)
                if abs(math.cos(phi)) > 0.85:   # keep roots on the flanks, not the island tips
                    continue
                r0 = 0.9; r1 = rng.uniform(1.2, 1.5)
                pts = []; rad = []
                wob = rng.uniform(-0.15, 0.15)
                for q in np.linspace(0, 1, 9):
                    r = r0 + (r1 - r0) * q; ph = phi + wob * q * q
                    rr = float(self.R(ph)) * r
                    p, n = self.skin_frame(rr * math.cos(ph), rr * math.sin(ph))
                    pts.append(tuple(p + n * 0.03 * U)); rad.append((0.055 - 0.04 * q) * U * (1.2 if B else 1))
                from .util import ring_tube
                v, f, tp = ring_tube(pts, rad, sides=5)
                col = root_col if key != 'desert' else (0.55, 0.42, 0.28)
                cols = [mix(col, Pm['moss'], 0.35 * (1 - tp[i])) for i in range(len(v))]
                self.items.append(dict(parts=[(v, f, cols, None, True)], x=pts[0][0], y=pts[0][1], z=pts[0][2], weight='spine'))
        # small plants / moss clumps on the mantle
        n = 38 if not B else 26
        for k in range(n):
            phi = rng.uniform(0, TAU); r = rng.uniform(0.98, 1.22)
            ext = float(self.edge_ext(phi))
            if r > ext - 0.05:
                continue
            rr = float(self.R(phi)) * r
            u, v = rr * math.cos(phi), rr * math.sin(phi)
            if key == 'tundra':
                parts = P.rock(rng, U * 0.5, (0.95, 0.97, 1.0), (0.85, 0.9, 0.95), self.style)
            elif key == 'desert':
                parts = P.grass(rng, U * 0.8, Pm['moss'])
            else:
                parts = (P.fern(rng, U * 0.6, Pm['moss']) if rng.random() < 0.4 else P.grass(rng, U * 0.9, Pm['moss']))
            self.place_on_skin(parts, u, v, lift=0.0)
        # barnacle / lichen clusters further out on the skin
        if key not in ('tundra',):
            for k in range(14 if not B else 9):
                phi = rng.uniform(0, TAU); r = rng.uniform(1.15, 1.6)
                if math.cos(phi) < -0.6:   # keep clear of the head / blowholes
                    continue
                rr = float(self.R(phi)) * r
                u, v = rr * math.cos(phi), rr * math.sin(phi)
                if abs(v) * self.thmax > 1.7:
                    continue
                parts = []
                for j in range(rng.integers(3, 7)):
                    ox, oy = rng.uniform(-0.08, 0.08, 2) * U
                    vv, ff, hf = P.cone((ox, oy, -0.01 * U), 0.03 * U, 0.035 * U, 6, 0, rng)
                    c = (0.82, 0.80, 0.74) if rng.random() < 0.7 else (0.6, 0.62, 0.58)
                    parts.append((vv, ff, [c] * len(vv), None, False))
                self.place_on_skin(parts, u, v, align=1.0)

    # ------------------------------------------------------------ waterfalls over the flank
    def build_falls(self, mb_falls):
        from .bodymesh import project_to_surface
        U = self.U; b = self.b
        self.fall_paths = []
        for fl in self.falls:
            lk = fl['lake']; phi = fl['phi']
            rr = float(self.R(phi))
            u0, v0 = rr * math.cos(phi), rr * math.sin(phi)
            t0, th0 = self.uv2tth(u0, v0)
            sgn = 1.0 if th0 >= 0 else -1.0
            th_end = sgn * 0.70 * math.pi if abs(math.sin(phi)) > 0.4 else th0 + sgn * 0.5
            K = 30
            path = []
            for k in range(K + 1):
                q = k / K
                th = float(th0) + (th_end - float(th0)) * q
                t = float(t0) + 0.01 * math.sin(q * 3) * (1 if fl['phi'] < math.pi else -1)
                x, y, z = b.point(t, th)
                path.append([float(x), float(y), float(z)])
            Pp, Nn = project_to_surface(b, np.array(path))
            lvl = lk['level']
            Pp = Pp + Nn * (0.028 * U)
            # first segment: lip, level with the lake surface, slightly inboard
            lip = Pp[0].copy(); lip[2] = max(lip[2], lvl + 0.004 * U)
            back = lip - Nn[0] * 0.0 + np.array([-np.sign(lip[0]) * 0.12 * U if abs(math.sin(phi)) > 0.4 else 0, 0, 0])
            back[2] = lvl + 0.004 * U
            Pp = np.vstack([back[None], lip[None], Pp[1:]]); Nn = np.vstack([Nn[:1], Nn[:1], Nn[1:]])
            T = np.array([0, 1.0, 0])
            verts = []; uvs_v = []; wts = []
            cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(Pp, axis=0), axis=1))])
            for i, p in enumerate(Pp):
                q = cum[i] / cum[-1]
                w = fl['w'] * (1.15 + 0.9 * q)
                side = np.cross(Nn[i], [1, 0, 0]) if abs(Nn[i][1]) < 0.9 else T
                side = np.array([0, 1.0, 0]) - Nn[i] * Nn[i][1]; side /= np.linalg.norm(side)
                for c in (-1, 0, 1):
                    pp = p + side * c * w / 2 + Nn[i] * 0.008 * U * (1 - c * c)
                    verts.append(tuple(pp)); uvs_v.append(((c + 1) / 2, 1 - q)); wts.append(b.spine_w_y(pp[1]))
            faces = []
            for i in range(len(Pp) - 1):
                for c in range(2):
                    a = i * 3 + c
                    faces.append((a, a + 1, a + 4, a + 3))
            uvs = [tuple(uvs_v[i] for i in f) for f in faces]
            mb_falls.add(verts, faces, [(1, 1, 1)] * len(verts), wts, True, uvs)
            fl['end'] = tuple(Pp[-1]); fl['dir'] = Nn[-1]
            self.fall_paths.append(Pp)
