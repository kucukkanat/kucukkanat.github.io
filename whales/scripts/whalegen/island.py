"""Island on the whale's back: footprint, terrain, lakes, waterfalls, water surfaces and prop placement."""
import math
import numpy as np
from .util import fbm, smoothstep, sstep, TAU, hex2rgb, s2l, mix, mul, boost


class Island:
    def __init__(self, body, biome_key, biome, style, rng):
        self.b = body; self.style = style; self.biome = biome; self.key = biome_key; self.rng = rng
        B = style == 'B'
        isl = body.sp['island']
        L = body.L; self.U = U = body.U
        self.yc = float(body.y(isl['tc'])); self.A = isl['a'] * L; self.frac = isl['frac']
        self.thick = isl['thick'] * L * (1.3 if B else 1.0)
        ph = rng.uniform(0, TAU, 4)
        self.Rc = [(3, 0.05, ph[0]), (5, 0.035, ph[1]), (8, 0.02, ph[2]), (13, 0.012, ph[3])]
        if B:
            self.Rc = [(k, a * 0.6, p) for k, a, p in self.Rc[:3]]
        self.lakes = []; self.pads = []; self.hills = []; self.stains = []; self.extra = None
        self.amp = 0.10 * U
        self.seed = int(rng.integers(1000))
        self.trees = []; self.items = []; self.occupied = []; self.falls = []
        self.pal = {k: (boost(hex2rgb(v)) if B else hex2rgb(v)) for k, v in biome.items()
                    if isinstance(v, str) and v.startswith('#')}

    # ------------------------------------------------------------ footprint
    def R(self, phi):
        return 1 + sum(a * np.sin(k * phi + p) for k, a, p in self.Rc)

    def Bw(self, y):
        return self.frac * self.b.W(self.b.t_of_y(y))

    def uv2xy(self, u, v):
        y = self.yc + self.A * u
        return float(self.Bw(y) * v), float(y)

    def polar(self, x, y):
        u = (y - self.yc) / self.A; v = x / np.maximum(self.Bw(y), 1e-6)
        return np.hypot(u, v), np.arctan2(v, u)

    def rnorm(self, x, y):
        r, phi = self.polar(x, y)
        return r / self.R(phi)

    def boundary(self, phi, scale=1.0):
        rr = self.R(phi) * scale
        u = rr * math.cos(phi); v = rr * math.sin(phi)
        return self.uv2xy(u, v)

    # ------------------------------------------------------------ terrain
    def H0(self, x, y):
        b = self.b; U = self.U
        x = np.asarray(x, float); y = np.asarray(y, float)
        base = 0.45 * b.top_z(y, x) + 0.55 * b.top_z(y, 0 * x) + self.thick
        n = fbm(x / (1.3 * U), y / (1.3 * U), self.seed)
        h = base + self.amp * (n - 0.5) * 2
        for hx, hy, hr, hh in self.hills:
            h = h + hh * np.exp(-((x - hx) ** 2 + (y - hy) ** 2) / hr ** 2)
        if self.extra is not None:
            h = h + self.extra(x, y)
        rn = self.rnorm(x, y)
        h = h - 0.06 * U * smoothstep(0.86, 1.0, rn)
        return h

    def H(self, x, y):
        U = self.U
        x = np.asarray(x, float); y = np.asarray(y, float)
        h = self.H0(x, y)
        for p in self.pads:
            d = np.hypot(x - p['x'], y - p['y'])
            m = smoothstep(p['r'], p['r'] * 0.65, d)
            h = h * (1 - m) + p['h'] * m
        for lk in self.lakes:
            d = np.hypot(x - lk['x'], y - lk['y']); r = lk['r']
            bank = smoothstep(r * 1.5, r * 1.0, d)
            h = np.maximum(h, h * (1 - bank) + (lk['level'] + 0.05 * U) * bank)
            m = smoothstep(r * 1.02, r * 0.72, d)
            bed = lk['level'] - 0.03 * U - lk['depth'] * np.clip(1 - (d / r) ** 2, 0, 1)
            h = h * (1 - m) + bed * m
        return h

    def ground(self, x, y):
        return float(self.H(np.array([x]), np.array([y]))[0])

    # ------------------------------------------------------------ feature api
    def add_hill(self, u, v, r, h):
        x, y = self.uv2xy(u, v); self.hills.append((x, y, r * self.U, h * self.U))

    def add_pad(self, u, v, r, dh=0.0):
        x, y = self.uv2xy(u, v)
        self.pads.append(dict(x=x, y=y, r=r * self.U, h=self.ground(x, y) + dh * self.U))
        return x, y

    def add_lake(self, u, v, r, depth=0.25, falls=0, kind='water', level_off=-0.04):
        x, y = self.uv2xy(u, v)
        r = r * self.U * (1.08 if self.style == 'B' else 1.0)
        if falls > 0:
            sx = 1.0 if v >= 0 else -1.0
            for _ in range(40):
                hit = any(math.hypot(bx - x, by - y) < r * 0.62
                          for bx, by in (self.boundary(TAU * k / 360, 0.985) for k in range(360)))
                if hit:
                    break
                x += sx * 0.03 * self.U
        lvl = self.ground(x, y) + level_off * self.U
        lk = dict(x=x, y=y, r=r, depth=depth * self.U, level=lvl, kind=kind, falls=falls, idx=len(self.lakes))
        self.lakes.append(lk)
        return lk

    def add_stain(self, x, y, r, col, strength=1.0, kind='patch'):
        self.stains.append(dict(x=x, y=y, r=r, col=col, s=strength, kind=kind))

    # ------------------------------------------------------------ placement
    def sample(self, n, min_d, r_lo=0.0, r_hi=0.85, lake_margin=0.18, region=None, tries=6000, avoid_pads=True):
        U = self.U; rng = self.rng
        pts = []
        for _ in range(tries):
            if len(pts) >= n:
                break
            r = math.sqrt(rng.uniform(r_lo ** 2, r_hi ** 2)); phi = rng.uniform(0, TAU)
            rr = r * float(self.R(phi))
            u, v = rr * math.cos(phi), rr * math.sin(phi)
            x, y = self.uv2xy(u, v)
            if region is not None and not region(u, v, x, y):
                continue
            ok = True
            for lk in self.lakes:
                if math.hypot(x - lk['x'], y - lk['y']) < lk['r'] + lake_margin * U:
                    ok = False; break
            if ok and avoid_pads:
                for p in self.pads:
                    if p.get('exclusive') and math.hypot(x - p['x'], y - p['y']) < p['r']:
                        ok = False; break
            if ok:
                for (ox, oy, orad) in self.occupied:
                    if math.hypot(x - ox, y - oy) < max(min_d, orad):
                        ok = False; break
            if ok:
                for (px, py) in pts:
                    if math.hypot(x - px, y - py) < min_d:
                        ok = False; break
            if ok:
                pts.append((x, y))
        return pts

    def _xf(self, parts, x, y, z, rot):
        cs, sn = math.cos(rot), math.sin(rot)
        out = []
        for v, f, c, hf, sm in parts:
            vv = [(x + px * cs - py * sn, y + px * sn + py * cs, z + pz) for px, py, pz in v]
            out.append((vv, f, c, hf, sm))
        return out

    def place(self, parts, x, y, rot=None, z_off=0.0, occ=0.0, weight='spine', z=None):
        rot = self.rng.uniform(0, TAU) if rot is None else rot
        z = self.ground(x, y) + z_off * self.U if z is None else z
        self.items.append(dict(parts=self._xf(parts, x, y, z, rot), x=x, y=y, z=z, weight=weight))
        if occ:
            self.occupied.append((x, y, occ * self.U))

    def place_tree(self, parts_H, x, y, occ=0.3, rot=None):
        parts, H = parts_H
        z = self.ground(x, y) - 0.03 * self.U
        rot = self.rng.uniform(0, TAU) if rot is None else rot
        self.trees.append(dict(parts=self._xf(parts, x, y, z, rot), x=x, y=y, z=z, H=H))
        self.occupied.append((x, y, occ * self.U * 0.65))

    # ------------------------------------------------------------ terrain mesh
    def terrain_color(self, x, y, h, slope):
        P = self.pal; B = self.style == 'B'; U = self.U
        n1 = float(fbm(x / (0.7 * U), y / (0.7 * U), self.seed + 5))
        k = sstep(0.38, 0.62, n1) if not B else (1.0 if n1 > 0.52 else 0.0)
        c = mix(P['ground'], P['ground2'], k)
        c = mul(c, 0.92 + 0.16 * float(fbm(x / (0.25 * U), y / (0.25 * U), self.seed + 9)) if not B else 1.0)
        rk = sstep(0.75, 1.3, slope)
        if rk > 0:
            c = mix(c, P['rock'], rk)
        for lk in self.lakes:
            d = math.hypot(x - lk['x'], y - lk['y']); r = lk['r']
            if lk['kind'] == 'ice':
                c = mix(c, P['shore'], sstep(r * 1.3, r * 1.0, d))
            else:
                c = mix(c, P['shore'], sstep(r * 1.3, r * 1.02, d))
                c = mix(c, mix(P['dirt'], P['water_deep'], 0.6), sstep(r * 0.98, r * 0.8, d))
        for st in self.stains:
            d = math.hypot(x - st['x'], y - st['y'])
            if d > st['r']:
                continue
            m = st['s'] * sstep(st['r'], st['r'] * 0.45, d)
            if st['kind'] == 'speckle':
                m *= 1.0 if float(fbm(x / (0.08 * U), y / (0.08 * U), self.seed + 21)) > 0.52 else 0.0
            col = st['col']
            if st['kind'] == 'raked':
                ring = 0.5 + 0.5 * math.cos(d * TAU / (0.11 * U))
                col = mul(col, 0.86 + 0.14 * ring)
            c = mix(c, col, m)
        return c

    def build_terrain(self, mb):
        B = self.style == 'B'; U = self.U; b = self.b
        NR = 26 if B else 32; NA = 112 if B else 136; K = 7
        phis = np.arange(NA) * TAU / NA
        Rp = self.R(phis)
        rs = np.linspace(1.0 / NR, 1.0, NR)
        X = np.zeros((NR, NA)); Y = np.zeros((NR, NA))
        for i, r in enumerate(rs):
            u = r * Rp * np.cos(phis); v = r * Rp * np.sin(phis)
            Y[i] = self.yc + self.A * u
            X[i] = self.Bw(Y[i]) * v
        Hm = self.H(X, Y)
        e = 0.02 * U
        gx = (self.H(X + e, Y) - self.H(X - e, Y)) / (2 * e)
        gy = (self.H(X, Y + e) - self.H(X, Y - e)) / (2 * e)
        slope = np.hypot(gx, gy)
        verts = []; cols = []; wts = []
        cx, cy = self.uv2xy(0, 0)
        verts.append((cx, cy, self.ground(cx, cy))); cols.append(self.terrain_color(cx, cy, 0, 0))
        wts.append(b.spine_w_y(cy))
        for i in range(NR):
            for j in range(NA):
                x, y, h = float(X[i, j]), float(Y[i, j]), float(Hm[i, j])
                verts.append((x, y, h)); cols.append(self.terrain_color(x, y, h, float(slope[i, j])))
                wts.append(b.spine_w_y(y))
        # skirt / cliff
        P = self.pal
        for k in range(1, K + 1):
            f = k / K
            for j in range(NA):
                phi = phis[j]
                xe, ye, he = float(X[-1, j]), float(Y[-1, j]), float(Hm[-1, j])
                nz = float(fbm(phi * 3.0, f * 2.5, self.seed + 31))
                sc = 1 + 0.035 * math.sin(f * math.pi) - 0.07 * f * f + (0.05 if not B else 0.025) * (nz - 0.5)
                rr = float(Rp[j]) * sc
                u = rr * math.cos(phi); v = rr * math.sin(phi)
                y = self.yc + self.A * u; x = float(self.Bw(y)) * v
                zb = float(b.top_z(y, x)) - 0.2 * U
                z = he + (zb - he) * f ** 0.85
                verts.append((x, y, z))
                if k == 1:
                    c = mix(P['moss'], P['rock'], 0.25)
                else:
                    st = 0.5 + 0.5 * math.sin(z / U * 7.0 + nz * 6)
                    c = mix(P['rock'], P['rock2'], st * (0.7 if not B else 0.5))
                    c = mul(c, 0.95 - 0.25 * f)
                    if self.key == 'tundra' and k == 2:
                        c = mix(c, (0.95, 0.97, 1.0), 0.6)
                cols.append(c); wts.append(b.spine_w_y(y))
        faces = []; smooth = []
        for j in range(NA):
            j2 = (j + 1) % NA
            faces.append((0, 1 + j2, 1 + j)); smooth.append(True)
        rows = NR + K
        for i in range(rows - 1):
            for j in range(NA):
                j2 = (j + 1) % NA
                a = 1 + i * NA + j; bb = 1 + i * NA + j2; c = 1 + (i + 1) * NA + j2; d = 1 + (i + 1) * NA + j
                faces.append((a, bb, c, d)); smooth.append(B or i < NR - 1)
        mb.add(verts, faces, [tuple(s2l(c)) for c in cols], wts, smooth)

    # ------------------------------------------------------------ water
    def water_bone_name(self, lk):
        return f"water_{lk['idx']}"

    def build_water(self, mb_water, mb_ice):
        U = self.U; b = self.b
        for lk in self.lakes:
            NR, NA = 7, 40
            verts = []; uvs_v = []; ring_out = []
            wname = self.water_bone_name(lk)
            wrule = {wname: 1.0} if lk['kind'] == 'water' else b.spine_w_y(lk['y'])
            verts.append((lk['x'], lk['y'], lk['level'])); uvs_v.append((lk['x'] / (2 * U), lk['y'] / (2 * U)))
            clipped = []
            for i in range(1, NR + 1):
                rr = lk['r'] * 0.985 * i / NR
                for j in range(NA):
                    a = TAU * j / NA
                    x = lk['x'] + rr * math.cos(a); y = lk['y'] + rr * math.sin(a)
                    rn = float(self.rnorm(x, y))
                    cl = False
                    if rn > 0.99:
                        r0, phi = self.polar(x, y)
                        sc = 0.99 / rn
                        u = float(r0) * sc * math.cos(float(phi)); v = float(r0) * sc * math.sin(float(phi))
                        x, y = self.uv2xy(u, v); cl = True
                    verts.append((x, y, lk['level'])); uvs_v.append((x / (2 * U), y / (2 * U)))
                    if i == NR:
                        clipped.append(cl)
            faces = []
            for j in range(NA):
                faces.append((0, 1 + j, 1 + (j + 1) % NA))
            for i in range(NR - 1):
                for j in range(NA):
                    j2 = (j + 1) % NA
                    a = 1 + i * NA + j; bb = 1 + i * NA + j2; c = 1 + (i + 1) * NA + j2; d = 1 + (i + 1) * NA + j
                    faces.append((a, d, c, bb))
            # overflow curtain where the lake meets the cliff edge
            if lk['kind'] == 'water' and any(clipped):
                base = 1 + (NR - 1) * NA
                cur0 = len(verts)
                for j in range(NA):
                    x, y, z = verts[base + j]
                    r0, phi = self.polar(x, y)
                    u = 1.03 * float(r0) * math.cos(float(phi)); v = 1.03 * float(r0) * math.sin(float(phi))
                    x2, y2 = self.uv2xy(u, v)
                    verts.append((x2, y2, z - 0.3 * U)); uvs_v.append((x2 / (2 * U), (y2 + 0.3 * U) / (2 * U)))
                for j in range(NA):
                    j2 = (j + 1) % NA
                    if clipped[j] and clipped[j2]:
                        faces.append((base + j, cur0 + j, cur0 + j2, base + j2))
            uvs = [tuple(uvs_v[i] for i in f) for f in faces]
            target = mb_water if lk['kind'] == 'water' else mb_ice
            target.add(verts, faces, [(1, 1, 1)] * len(verts), [dict(wrule) for _ in verts], True, uvs)

    def plan_falls(self):
        U = self.U
        for lk in self.lakes:
            if lk['falls'] <= 0 or lk['kind'] != 'water':
                continue
            cands = []
            for k in range(720):
                phi = TAU * k / 720
                x, y = self.boundary(phi, 0.985)
                if math.hypot(x - lk['x'], y - lk['y']) < lk['r'] * 0.8:
                    cands.append(phi)
            if not cands:
                continue
            # contiguous run (handle wrap)
            cands.sort()
            n = lk['falls']
            span = cands[-1] - cands[0]
            if span > math.pi:  # wrapped around 0
                cands = [c if c > math.pi else c + TAU for c in cands]; cands.sort()
            lo, hi = cands[0], cands[-1]
            for i in range(n):
                q = (i + 0.5) / n
                phi = (lo + (hi - lo) * (0.15 + 0.7 * q)) % TAU
                self.falls.append(dict(lake=lk, phi=phi, w=self.rng.uniform(0.26, 0.38) * U * (1.25 if self.style == 'B' else 1)))

    def build_falls(self, mb_falls):
        U = self.U; b = self.b
        for fl in self.falls:
            lk = fl['lake']; phi = fl['phi']
            x0, y0 = self.boundary(phi, 0.99)
            xa, ya = self.boundary(phi - 0.01, 0.99); xb, yb = self.boundary(phi + 0.01, 0.99)
            T = np.array([xb - xa, yb - ya, 0.0]); T /= np.linalg.norm(T)
            N = np.array([T[1], -T[0], 0.0])
            if np.dot(N, np.array([x0 - 0, y0 - self.yc, 0])) < 0:
                N = -N
            lateral = abs(N[0]) > 0.5
            t = float(b.t_of_y(y0))
            z_end = float(b.C(t)) - 0.3 * float(b.HB(t)) if lateral else lk['level'] - 1.6 * U
            level = lk['level'] + 0.004 * U
            K = 26
            pts = [np.array([x0, y0, level]) - N * 0.12 * U]
            for k in range(K + 1):
                q = k / K
                z = level - (level - z_end) * q
                o = min(0.55 * U, 0.3 * U * math.sqrt(max(0.0, (level - z) / U)))
                p = np.array([x0, y0, z]) + N * o
                if lateral:
                    sx = float(b.side_x(p[1], z)) + 0.06 * U
                    if abs(p[0]) < sx:
                        p[0] = math.copysign(sx, p[0] if p[0] != 0 else N[0])
                pts.append(p)
            verts = []; uvs_v = []; wts = []
            cum = [0.0]
            for i in range(1, len(pts)):
                cum.append(cum[-1] + float(np.linalg.norm(pts[i] - pts[i - 1])))
            total = cum[-1]
            for i, p in enumerate(pts):
                q = cum[i] / total
                w = fl['w'] * (1 + 0.45 * q)
                for c in (-1, 0, 1):
                    pp = p + T * c * w / 2 + N * 0.035 * U * (1 - c * c)
                    verts.append(tuple(pp)); uvs_v.append(((c + 1) / 2, 1 - q))
                    wts.append(b.spine_w_y(pp[1]))
            faces = []
            for i in range(len(pts) - 1):
                for c in range(2):
                    a = i * 3 + c
                    faces.append((a, a + 1, a + 4, a + 3))
            uvs = [tuple(uvs_v[i] for i in f) for f in faces]
            mb_falls.add(verts, faces, [(1, 1, 1)] * len(verts), wts, True, uvs)
            fl['end'] = tuple(pts[-1]); fl['dir'] = N
