"""Floating-island building blocks shared by sky.glb (SKY_island_*) and collectibles.glb (TPL_island).

Islands are authored with their grass top at y = 0 (three coords) and hang down to y = -depth.
Material names passed in `mats` are roles -> names: sky.py turns them into vertex colours afterwards,
collectibles.py uses real materials (Rock / Grass / ...).
"""
import math
import random
import bmesh
from mathutils import Vector, Matrix

ROLES = ("grass", "grass_hi", "lip", "soil", "rock1", "rock2", "rock3", "rock4", "root", "vine")


def outline(n, seed, amp=0.16):
    rnd = random.Random(seed)
    raw = [1 + amp * (rnd.random() * 2 - 1) for _ in range(n)]
    return [(raw[i - 1] + 2 * raw[i] + raw[(i + 1) % n]) / 4 for i in range(n)]


def _ring(n, o, R, y, rnd, rj=0.0, yj=0.0, phase=0.0, drip=None):
    pts = []
    for j in range(n):
        a = 2 * math.pi * (j + phase) / n
        rr = R * o[j] * (1 + rj * (rnd.random() * 2 - 1))
        yy = y + yj * (rnd.random() * 2 - 1)
        if drip:
            yy -= drip * (rnd.random() if j % 2 else 0.15 * rnd.random())
        pts.append(Vector((rr * math.cos(a), yy, rr * math.sin(a))))
    return pts


def _orient(f, want):
    f.normal_update()
    if f.normal.dot(want) < 0:
        f.normal_flip()


def band(mb, top, bot, mat):
    """Quad band between two rings (same count); faces point away from the Y axis."""
    tb = bmesh.new()
    n = len(top)
    vt = [tb.verts.new(p) for p in top]
    vb = [tb.verts.new(p) for p in bot]
    for j in range(n):
        k = (j + 1) % n
        f = tb.faces.new((vt[j], vt[k], vb[k], vb[j]))
        c = (top[j] + top[k] + bot[j] + bot[k]) / 4
        radial = Vector((c.x, 0, c.z))
        radial = radial.normalized() if radial.length > 1e-9 else Vector((1, 0, 0))
        tm, bm_ = (top[j] + top[k]) / 2, (bot[j] + bot[k]) / 2
        dr = Vector((bm_.x, 0, bm_.z)).length - Vector((tm.x, 0, tm.z)).length
        dy = bm_.y - tm.y
        # profile direction (dr, dy) turned by 90 deg -> away from the solid
        _orient(f, radial * (-dy) + Vector((0, 1, 0)) * dr)
    mb.raw(tb, mat, uv=None)


def fan(mb, ring, apex, mat, up=True):
    tb = bmesh.new()
    n = len(ring)
    vr = [tb.verts.new(p) for p in ring]
    va = tb.verts.new(apex)
    for j in range(n):
        f = tb.faces.new((vr[j], vr[(j + 1) % n], va))
        _orient(f, Vector((0, 1 if up else -1, 0)))
    mb.raw(tb, mat, uv=None)


def cap(mb, ring, mat, up=True):
    tb = bmesh.new()
    f = tb.faces.new([tb.verts.new(p) for p in ring])
    _orient(f, Vector((0, 1 if up else -1, 0)))
    mb.raw(tb, mat, uv=None)


class Island:
    """Body + helpers. r: top radius, depth: grass top -> tip."""

    def __init__(self, mb, r, depth, seed, mats, n=16, flat_base=None, strata=3, ledge=0.035):
        self.mb, self.r, self.D, self.mats, self.n = mb, r, depth, mats, n
        self.rnd = random.Random(seed)
        self.o = outline(n, seed)
        rnd, o, D = self.rnd, self.o, depth
        # grass cap: gentle dome, soft bevelled rim, a lip with little drips over the rock
        apex = Vector((0.03 * r * (rnd.random() - 0.5), 0.07 * r, 0.03 * r * (rnd.random() - 0.5)))
        mid = _ring(n, o, 0.55 * r, 0.045 * r, rnd, 0.04, 0.008 * r)
        top = _ring(n, o, 0.97 * r, 0.004 * r, rnd, 0.0, 0.006 * r)
        bev = _ring(n, o, 1.03 * r, -0.03 * r, rnd, 0.0, 0.004 * r)
        lip = _ring(n, o, 1.045 * r, -0.075 * r, rnd, 0.0, 0.0, drip=0.07 * r)
        fan(mb, mid, apex, mats["grass_hi"])
        band(mb, mid, top, mats["grass"])
        band(mb, top, bev, mats["grass"])
        band(mb, bev, lip, mats["lip"])
        # soil underside of the lip, then the rock strata tapering to a point
        k = [(-0.07 * r, 0.95)]
        if flat_base is not None:
            # figurine: gentler taper down to a flat foot
            k += [(-0.30 * D, 0.84), (-0.58 * D, 0.66), (-0.86 * D, 0.5)]
        elif strata == 3:
            k += [(-0.30 * D, 0.82), (-0.58 * D, 0.58), (-0.84 * D, 0.28)]
        else:
            k += [(-0.42 * D, 0.76), (-0.8 * D, 0.34)]
        self.knots = k
        rk = [mats["rock1"], mats["rock2"], mats["rock3"]]
        prev = _ring(n, o, k[0][1] * r, k[0][0], rnd, 0.02, 0.01 * r)
        band(mb, lip, prev, mats["soil"])
        for i in range(1, len(k)):
            y, s = k[i]
            bot = _ring(n, o, s * r, y, rnd, 0.07, 0.025 * D, phase=0.0)
            band(mb, prev, bot, rk[min(i - 1, 2)])
            if i < len(k) - 1:
                # strata ledge: the next layer starts a little wider
                nxt = [Vector((p.x * (1 + ledge), p.y - 0.012 * D, p.z * (1 + ledge))) for p in bot]
                band(mb, bot, nxt, rk[min(i, 2)])
                bot = nxt
            prev = bot
        if flat_base is not None:
            yb = -D
            base = [Vector((p.x * flat_base / max(k[-1][1], 1e-3), yb, p.z * flat_base / max(k[-1][1], 1e-3)))
                    for p in prev]
            band(mb, prev, base, mats["rock4"])
            cap(mb, base, mats["rock4"], up=False)
        else:
            tip = Vector((0.06 * r * (rnd.random() - 0.5), -D, 0.06 * r * (rnd.random() - 0.5)))
            fan(mb, prev, tip, mats["rock4"], up=False)

    # ---------------------------------------------------------------- queries
    def top_y(self, x, z):
        d = math.hypot(x, z) / self.r
        if d < 0.55:
            return 0.07 * self.r + (0.045 - 0.07) * self.r * d / 0.55
        return 0.045 * self.r + (0.0 - 0.045) * self.r * min(1.0, (d - 0.55) / 0.42)

    def on_top(self, x, z, sink=0.01):
        return (x, self.top_y(x, z) - sink * self.r, z)

    def surface_r(self, y):
        k = self.knots
        if y >= k[0][0]:
            return k[0][1] * self.r
        for (y0, s0), (y1, s1) in zip(k[:-1], k[1:]):
            if y1 <= y <= y0:
                t = (y0 - y) / (y0 - y1)
                return (s0 + (s1 - s0) * t) * self.r
        return k[-1][1] * self.r * max(0.0, (self.D + y) / (self.D + k[-1][0]))

    def outline_at(self, a):
        n = self.n
        f = (a / (2 * math.pi)) * n % n
        i = int(f)
        t = f - i
        return self.o[i] * (1 - t) + self.o[(i + 1) % n] * t

    # ---------------------------------------------------------------- dressing
    def roots(self, count, mat, length=(0.25, 0.6), thick=0.012, seed=1, segs=3):
        from .polish import tube
        rnd = random.Random(seed)
        r, D = self.r, self.D
        for i in range(count):
            a = 2 * math.pi * (i + rnd.uniform(-0.3, 0.3)) / count
            oa = self.outline_at(a)
            y0 = -0.06 * r - rnd.uniform(0, 0.12) * D
            R0 = self.surface_r(y0) * oa * 0.98
            L = rnd.uniform(*length) * D
            pts = []
            for k in range(4):
                t = k / 3
                y = y0 - L * t
                rr = max(R0 * (1 - 0.18 * t), self.surface_r(y) * oa + thick * r)
                sw = 0.04 * r * math.sin(t * 3.0 + i) * t
                aa = a + sw / max(rr, 1e-3)
                pts.append((rr * math.cos(aa), y, rr * math.sin(aa)))
            th = thick * r * rnd.uniform(0.7, 1.2)
            tube(self.mb, pts, lambda t, th=th: th * (1 - 0.75 * t), mat, segs=segs, cap=False)

    def tufts(self, count, mat, seed=2, avoid=(), s=1.0):
        rnd = random.Random(seed)
        r = self.r
        placed = 0
        tries = 0
        while placed < count and tries < count * 20:
            tries += 1
            a = rnd.uniform(0, 2 * math.pi)
            d = r * math.sqrt(rnd.uniform(0.05, 0.85))
            x, z = d * math.cos(a), d * math.sin(a)
            if any(math.hypot(x - ax, z - az) < ar for (ax, az, ar) in avoid):
                continue
            p = self.on_top(x, z, 0.004)
            for b in range(3):
                bb = rnd.uniform(0, 2 * math.pi)
                off = 0.025 * r * s
                self.mb.cyl(0.018 * r * s, 0.06 * r * s * rnd.uniform(0.7, 1.2),
                            (p[0] + off * math.cos(bb), p[1] + 0.025 * r * s, p[2] + off * math.sin(bb)), mat,
                            segs=3, r2=0.0, yaw=rnd.uniform(0, 120), pitch=rnd.uniform(-12, 12), cap=False)
            placed += 1


# -------------------------------------------------------------------- props (three coords, s = scale)

def ico(mb, center, radius, mat, scale=(1, 1, 1), jitter=0.0, seed=0, subdiv=1):
    rnd = random.Random(seed)
    tb = bmesh.new()
    bmesh.ops.create_icosphere(tb, subdivisions=subdiv, radius=1.0)
    for v in tb.verts:
        j = 1 + jitter * (rnd.random() * 2 - 1)
        v.co = Vector((v.co.x * scale[0] * j, v.co.z * scale[1] * j, v.co.y * scale[2] * j)) * radius
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    mb.raw(tb, mat, uv=None, local=Matrix.Translation(Vector(center)))


def pine(mb, p, s, mats, seed=0):
    rnd = random.Random(seed)
    x, y, z = p
    mb.cyl(0.022 * s, 0.14 * s, (x, y + 0.06 * s, z), mats["trunk"], segs=5)
    tiers = ((0.15, 0.24, 0.12), (0.12, 0.21, 0.24), (0.085, 0.18, 0.35))
    for i, (rr, hh, yy) in enumerate(tiers):
        mb.cyl(rr * s, hh * s, (x, y + yy * s + hh * s / 2 - 0.02 * s, z), mats["pine2" if i % 2 else "pine1"],
               segs=7, r2=0.0, yaw=rnd.uniform(0, 50), cap=False)


def round_tree(mb, p, s, mats, seed=0):
    rnd = random.Random(seed)
    x, y, z = p
    mb.cyl(0.024 * s, 0.2 * s, (x, y + 0.1 * s, z), mats["trunk"], segs=5)
    ico(mb, (x, y + 0.27 * s, z), 0.13 * s, mats["leaf"], (1, 0.9, 1), 0.1, seed)
    ico(mb, (x + 0.07 * s, y + 0.22 * s, z + 0.03 * s), 0.08 * s, mats["leaf2"], (1, 0.9, 1), 0.1, seed + 1, subdiv=1)


def cottage(mb, p, s, mats, yaw=0):
    with mb.frame(p, yaw=yaw):
        mb.box((0.34 * s, 0.24 * s, 0.26 * s), (0, 0.12 * s, 0), mats["wall"])
        mb.prism([(-0.21 * s, 0), (0.21 * s, 0), (0, 0.17 * s)], 0.32 * s, (0, 0.24 * s, 0), mats["roof"], plane='xy')
        mb.box((0.07 * s, 0.13 * s, 0.01 * s), (0.06 * s, 0.065 * s, 0.131 * s), mats["trunk"])
        mb.box((0.06 * s, 0.06 * s, 0.01 * s), (-0.09 * s, 0.14 * s, 0.131 * s), mats["window"])
        mb.box((0.05 * s, 0.13 * s, 0.05 * s), (-0.09 * s, 0.37 * s, -0.05 * s), mats["stone"])


def windmill(mb, p, s, mats, yaw=0, sail_rot=15):
    with mb.frame(p, yaw=yaw):
        mb.cyl(0.11 * s, 0.46 * s, (0, 0.23 * s, 0), mats["wall"], segs=8, r2=0.075 * s)
        mb.cyl(0.115 * s, 0.03 * s, (0, 0.015 * s, 0), mats["stone"], segs=8)
        mb.cyl(0.09 * s, 0.13 * s, (0, 0.52 * s, 0), mats["roof"], segs=8, r2=0.0)
        mb.box((0.06 * s, 0.11 * s, 0.01 * s), (0, 0.055 * s, 0.106 * s), mats["trunk"])
        mb.box((0.045 * s, 0.045 * s, 0.01 * s), (0, 0.28 * s, 0.092 * s), mats["window"], pitch=-4)
        hub = (0, 0.46 * s, 0.1 * s)
        mb.cyl(0.022 * s, 0.07 * s, hub, mats["trunk"], axis='z', segs=6)
        for i in range(4):
            with mb.frame(hub, roll=sail_rot + 90 * i):
                mb.box((0.012 * s, 0.36 * s, 0.012 * s), (0, 0.18 * s, 0.03 * s), mats["trunk"])
                mb.box((0.075 * s, 0.26 * s, 0.006 * s), (0.045 * s, 0.22 * s, 0.03 * s), mats["sail"])


def lighthouse(mb, p, s, mats, yaw=0):
    """Crooked lighthouse: stacked drums, each tilted a little more."""
    with mb.frame(p, yaw=yaw):
        mb.cyl(0.13 * s, 0.05 * s, (0, 0.025 * s, 0), mats["stone"], segs=9)
        tilts = ((0, 0, 5), (0, 7, -2), (0, 6, 8), (0, -3, 9))
        h = 0.14 * s
        r0 = 0.095 * s
        frames = []
        y = 0.05 * s
        # nested frames: each drum sits on the previous one's top, tilted a bit more
        def drum(i, rr):
            col = mats["red"] if i % 2 else mats["white"]
            mb.cyl(rr, h, (0, h / 2, 0), col, segs=10, r2=rr * 0.93)
        with mb.frame((0, y, 0), yaw=tilts[0][0], pitch=tilts[0][1], roll=tilts[0][2]):
            drum(0, r0)
            with mb.frame((0, h, 0), pitch=tilts[1][1], roll=tilts[1][2]):
                drum(1, r0 * 0.93)
                with mb.frame((0, h, 0), pitch=tilts[2][1], roll=tilts[2][2]):
                    drum(2, r0 * 0.86)
                    mb.box((0.035 * s, 0.05 * s, 0.01 * s), (0, 0.07 * s, r0 * 0.83), mats["window"])
                    with mb.frame((0, h, 0), pitch=tilts[3][1], roll=tilts[3][2]):
                        drum(3, r0 * 0.8)
                        with mb.frame((0, h, 0)):
                            mb.cyl(r0 * 1.05, 0.02 * s, (0, 0.01 * s, 0), mats["dark"], segs=10)
                            mb.cyl(0.05 * s, 0.075 * s, (0, 0.0575 * s, 0), mats["lamp"], segs=8)
                            for i in range(4):
                                a = math.pi / 4 + i * math.pi / 2
                                mb.box((0.008 * s, 0.075 * s, 0.008 * s),
                                       (0.05 * s * math.cos(a), 0.0575 * s, 0.05 * s * math.sin(a)), mats["dark"])
                            mb.cyl(0.075 * s, 0.07 * s, (0, 0.13 * s, 0), mats["red"], segs=10, r2=0.0)
                            mb.sphere(0.012 * s, (0, 0.17 * s, 0), mats["dark"], segs=6, rings=4)


def boulder(mb, p, s, mat, seed=0):
    ico(mb, (p[0], p[1] + 0.35 * s, p[2]), s, mat, (1.0, 0.7, 0.85), 0.18, seed)


def waterfall(mb, isl, a, mats, width=0.12, seed=0):
    """Pond near the rim, a stream to the edge and a sheet of water spilling over it, ending in mist."""
    r, D = isl.r, isl.D
    ca, sa = math.cos(a), math.sin(a)
    oa = isl.outline_at(a)
    # pond
    pd = 0.45 * r
    py = isl.top_y(pd * ca, pd * sa) + 0.004 * r
    mb.cyl(0.2 * r, 0.012 * r, (pd * ca, py - 0.004 * r, pd * sa), mats["water"], segs=10)
    mb.cyl(0.215 * r, 0.008 * r, (pd * ca, py - 0.009 * r, pd * sa), mats["stone"], segs=10)
    # stream: quad strip from the pond to the rim, hugging the grass
    w = width * r
    nx, nz = -sa, ca
    pts = []
    for k in range(5):
        t = k / 4
        d = pd + (oa * 1.04 * r - pd) * t
        y = isl.top_y(d * ca, d * sa) + 0.006 * r if t < 1 else -0.03 * r
        pts.append(Vector((d * ca, y, d * sa)))
    # fall: drops off the lip, bows outward, then straight down past the tip
    edge = oa * 1.07 * r
    for k in range(1, 8):
        t = k / 7
        d = edge + 0.12 * r * math.sin(min(1.0, t * 2.2) * math.pi / 2)
        y = -0.03 * r - 1.15 * D * t ** 1.15
        pts.append(Vector((d * ca, y, d * sa)))
    tb = bmesh.new()
    rows = []
    for i, c in enumerate(pts):
        ww = w * (1.0 + 0.6 * max(0, i - 4) / 7)
        rows.append([tb.verts.new(c + Vector((nx, 0, nz)) * ww * f) for f in (-0.5, 0.0, 0.5)])
    fm = []
    for i in range(len(rows) - 1):
        for j in range(2):
            f = tb.faces.new((rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j]))
            fm.append((f, i, j))
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    for f, i, j in fm:
        out = Vector((ca, 0.0, sa)) if i >= 4 else Vector((0, 1, 0))
        _orient(f, out)
    # material per face: streaks + foam at the bottom
    groups = {}
    for f, i, j in fm:
        m = mats["foam"] if i >= len(rows) - 2 else (mats["water2"] if j == 1 else mats["water"])
        groups.setdefault(m, []).append(f)
    for m, fs in groups.items():
        sub = bmesh.new()
        vmap = {}
        for f in fs:
            vs = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = sub.verts.new(v.co)
                vs.append(vmap[v])
            nf = sub.faces.new(vs)
            nf.normal_update()
            # back side
            bv = [sub.verts.new(v.co + f.normal * -0.004 * r) for v in f.verts]
            sub.faces.new(bv[::-1])
        mb.raw(sub, m, uv=None)
    tb.free()
    # mist puffs at the bottom
    bot = pts[-1]
    for k in range(3):
        ico(mb, (bot.x + 0.05 * r * (k - 1) * -sa, bot.y - 0.02 * r + 0.03 * r * (k % 2), bot.z + 0.05 * r * (k - 1) * ca),
            (0.07 + 0.02 * (k % 2)) * r, mats["foam"], (1, 0.7, 1), 0.15, seed + k)
