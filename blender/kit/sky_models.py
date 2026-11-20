"""Sky set pieces: hot-air balloons, airships, crags, towers and the big hero islands.

Authored in three.js coordinates on a util.MB whose 'materials' are palette roles (sky_paint.M);
sky_paint.paint() turns them into vertex colours. Every builder works inside mb.frame(), so pieces can be
nested (a moored balloon on an island's pier, islets around a big island...).
Glow points (night lights for the app's full tier) are collected in GLOW in model space.
"""
import math
import random
import bmesh
from mathutils import Vector, Matrix
from . import islands as I
from .sky_paint import M
from .polish import tube

GLOW = []


def glow(mb, p, size):
    v = mb.stack[-1] @ Vector(p)
    GLOW.append([round(v.x, 3), round(v.y, 3), round(v.z, 3), round(size, 3)])


def take_glow():
    g = list(GLOW)
    GLOW.clear()
    return g


def lathe_cells(mb, profile, nseg, role_fn, local=None, phase=0.0):
    """Surface of revolution about +Y. profile: [(h, r)] with h increasing; role_fn(ring, seg) -> role name.
    Cells of the same role share vertices. Faces point away from the axis."""
    groups = {}
    n = len(profile)

    def pt(i, j):
        h, r = profile[i]
        a = 2 * math.pi * (j + phase) / nseg
        return Vector((r * math.cos(a), h, r * math.sin(a)))

    for i in range(n - 1):
        dh = profile[i + 1][0] - profile[i][0]
        dr = profile[i + 1][1] - profile[i][1]
        for j in range(nseg):
            quad = [pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)]
            pts = []
            for q in quad:
                if not pts or (q - pts[-1]).length > 1e-7:
                    pts.append(q)
            if len(pts) > 1 and (pts[0] - pts[-1]).length < 1e-7:
                pts.pop()
            if len(pts) < 3:
                continue
            am = 2 * math.pi * (j + 0.5 + phase) / nseg
            want = Vector((math.cos(am), 0, math.sin(am))) * dh - Vector((0, 1, 0)) * dr
            groups.setdefault(role_fn(i, j), []).append((pts, want))
    for role, faces in groups.items():
        tb = bmesh.new()
        vmap = {}
        for pts, want in faces:
            vs = []
            for q in pts:
                k = (round(q.x, 6), round(q.y, 6), round(q.z, 6))
                if k not in vmap:
                    vmap[k] = tb.verts.new(q)
                vs.append(vmap[k])
            try:
                f = tb.faces.new(vs)
            except ValueError:
                continue
            f.normal_update()
            if f.normal.dot(want) < 0:
                f.normal_flip()
        mb.raw(tb, M[role], uv=None, local=local or Matrix.Identity(4))


# -------------------------------------------------------------------- balloons

BALLOON_PROFILE = [(0.0, 0.13), (0.09, 0.21), (0.22, 0.34), (0.38, 0.45), (0.55, 0.50), (0.71, 0.47), (0.84, 0.38),
                   (0.94, 0.23), (1.0, 0.0)]


def balloon(mb, p, s, style="stripes", cols=("orange", "cream"), nseg=12, basket="wood_lt", profile=None):
    """Hot-air balloon; p = centre of the envelope, s = envelope height (m)."""
    prof = profile or BALLOON_PROFILE
    nr = len(prof) - 1

    def role(i, j):
        if style == "stripes":
            return cols[j % 2] if i < nr - 1 else cols[0]
        if style == "bands":
            return cols[i % len(cols)]
        if style == "checker":
            return cols[(i + j) % 2]
        if style == "swirl":
            return cols[((j + i) // 2) % len(cols)]
        if style == "crown":       # plain body, contrasting belt and cap
            return cols[1] if i in (3, nr - 1) else (cols[2 % len(cols)] if i == 4 and j % 2 else cols[0])
        return cols[0]

    with mb.frame((p[0], p[1] - 0.55 * s, p[2])):
        lathe_cells(mb, [(h * s, r * s) for h, r in prof], nseg, role)
        lathe_cells(mb, [(-0.06 * s, 0.105 * s), (0.0, 0.13 * s)], nseg, lambda i, j: "dark")
        # burner + its glow inside the mouth
        mb.cyl(0.045 * s, 0.05 * s, (0, -0.13 * s, 0), M["brass"], segs=6)
        mb.cyl(0.035 * s, 0.07 * s, (0, -0.075 * s, 0), M["burner"], segs=5, r2=0.008 * s)
        glow(mb, (0, -0.07 * s, 0), 0.5 * s)
        # basket
        by = -0.4 * s
        mb.box((0.17 * s, 0.12 * s, 0.17 * s), (0, by, 0), M[basket])
        mb.box((0.19 * s, 0.025 * s, 0.19 * s), (0, by + 0.065 * s, 0), M["wood_dk"])
        for sx in (-1, 1):
            for sz in (-1, 1):
                tube(mb, [(sx * 0.085 * s, by + 0.07 * s, sz * 0.085 * s), (sx * 0.075 * s, -0.06 * s, sz * 0.075 * s)],
                     0.006 * s, M["rope"], segs=3, cap=False)
        mb.box((0.05 * s, 0.07 * s, 0.035 * s), (0.105 * s, by - 0.02 * s, 0.03 * s), M["cream"])
        mb.box((0.035 * s, 0.07 * s, 0.05 * s), (-0.03 * s, by - 0.02 * s, 0.105 * s), M["rope"])


# -------------------------------------------------------------------- airships

def _envelope(mb, c, L, R, cols, nseg=12, rings=10, fat=0.15):
    prof = []
    for k in range(rings + 1):
        th = math.pi * k / rings
        x = -math.cos(th)
        prof.append((x * L, R * (math.sin(th) ** 0.75) * (1 + fat * x) if 0 < k < rings else 0.0))

    def role(i, j):
        if i == 0 or i == rings - 1:
            return cols[1]
        if i in (2, rings - 3):
            return cols[2]
        return cols[0] if j % 2 == 0 else cols[1]

    lathe_cells(mb, prof, nseg, role, local=Matrix.Translation(Vector(c)) @ Matrix.Rotation(-math.pi / 2, 4, 'Z'))


def airship(mb, p, s, cols=("orange", "orange_dk", "cream"), twin=False, sails=False, roof="red"):
    """Small airship, nose toward +X, origin at the keel line under the envelope. s ~ half length (m)."""
    with mb.frame(p):
        ey = 0.8 * s
        if twin:
            for sz in (-1, 1):
                _envelope(mb, (0, ey, sz * 0.27 * s), 0.95 * s, 0.3 * s, cols, nseg=10, rings=9)
            mb.box((0.9 * s, 0.03 * s, 0.5 * s), (0, ey - 0.02 * s, 0), M["wood_dk"])
        else:
            _envelope(mb, (0, ey, 0), 1.0 * s, 0.4 * s, cols)
        # tail fins
        for a in (0, 90, 180, 270):
            with mb.frame((-0.8 * s, ey, 0), pitch=a):
                mb.prism([(0, 0), (-0.35 * s, 0), (-0.38 * s, 0.32 * s), (-0.1 * s, 0.12 * s)], 0.02 * s,
                         (0, 0.12 * s, 0), M[cols[2]], plane='xy')
        # gondola: boat-like hull, deck, cabin
        hl = 1.25 if sails else 1.0
        hull = [(-0.55 * hl * s, 0.08 * s), (0.55 * hl * s, 0.08 * s), (0.48 * hl * s, -0.08 * s),
                (0.3 * hl * s, -0.16 * s), (-0.35 * hl * s, -0.16 * s), (-0.5 * hl * s, -0.06 * s)]
        mb.prism(hull, 0.32 * s, (0, 0.22 * s, 0), M["wood"], plane='xy')
        mb.box((1.06 * hl * s, 0.035 * s, 0.36 * s), (0, 0.31 * s, 0), M["wood_lt"])
        mb.box((0.36 * s, 0.17 * s, 0.24 * s), (0.02 * s, 0.41 * s, 0), M["wall"])
        mb.prism([(-0.22 * s, 0), (0.22 * s, 0), (0, 0.12 * s)], 0.3 * s, (0.02 * s, 0.495 * s, 0), M[roof], plane='xy')
        for sz in (-1, 1):
            for x in (-0.09, 0.03, 0.13):
                mb.box((0.06 * s, 0.065 * s, 0.012 * s), (x * s, 0.42 * s, sz * 0.121 * s), M["window"])
        glow(mb, (0.02 * s, 0.42 * s, 0), 0.55 * s)
        # rigging
        for sx in (-1, 1):
            for sz in (-1, 1):
                top = (sx * 0.5 * s, ey - (0.22 if twin else 0.31) * s, sz * (0.27 if twin else 0.12) * s)
                tube(mb, [(sx * 0.44 * hl * s, 0.32 * s, sz * 0.14 * s), top], 0.008 * s, M["rope"], segs=3, cap=False)
        # propeller
        mb.cyl(0.03 * s, 0.12 * s, (-0.6 * hl * s, 0.2 * s, 0), M["brass"], axis='x', segs=6)
        for a in (0, 120, 240):
            with mb.frame((-0.67 * hl * s, 0.2 * s, 0), pitch=a + 15):
                mb.box((0.02 * s, 0.22 * s, 0.05 * s), (0, 0.11 * s, 0), M["wood_dk"])
        # bow lantern on a short sprit
        bx = 0.55 * hl * s
        tube(mb, [(bx - 0.06 * s, 0.31 * s, 0), (bx + 0.12 * s, 0.37 * s, 0)], 0.01 * s, M["wood_dk"], segs=3)
        mb.box((0.05 * s, 0.065 * s, 0.05 * s), (bx + 0.11 * s, 0.31 * s, 0), M["lamp"])
        glow(mb, (bx + 0.11 * s, 0.31 * s, 0), 0.4 * s)
        # pennant
        mb.cyl(0.007 * s, 0.2 * s, (-0.55 * s, ey + 0.42 * s, 0), M["dark"], segs=3)
        mb.prism([(0, 0), (-0.2 * s, 0.035 * s), (0, 0.07 * s)], 0.006 * s, (-0.55 * s, ey + 0.45 * s, 0),
                 M["orange" if cols[0] != "orange" else "cream"], plane='xy')
        if sails:
            for sz in (-1, 1):
                mb.prism([(-0.35 * s, 0.17 * s * sz), (0.3 * s, 0.17 * s * sz), (-0.25 * s, 0.62 * s * sz)][::sz],
                         0.012 * s, (0, 0.3 * s, 0), M["sail"], plane='xz')
                tube(mb, [(-0.3 * s, 0.3 * s, sz * 0.17 * s), (-0.25 * s, 0.3 * s, sz * 0.62 * s)], 0.008 * s,
                     M["wood_dk"], segs=3)
            mb.prism([(0, 0), (-0.26 * s, -0.02 * s), (-0.28 * s, 0.2 * s), (-0.02 * s, 0.14 * s)], 0.015 * s,
                     (-0.6 * hl * s, 0.0, 0), M["sail"], plane='xy')
            mb.box((0.3 * s, 0.12 * s, 0.22 * s), (-0.4 * s, 0.385 * s, 0), M["wood_lt"])
            mb.box((0.16 * s, 0.1 * s, 0.16 * s), (0.42 * s, 0.375 * s, 0), M["rope"])


# -------------------------------------------------------------------- rocks + buildings

def crag(mb, p, r, h, seed, n=8, levels=3, top="grass_hi", rocks=("rock1", "rock2")):
    """Rocky peak standing on the grass: stacked tapering tiers with small terraces. Returns (top point, top radius)."""
    rnd = random.Random(seed)
    o = I.outline(n, seed, amp=0.24)
    rt = r
    with mb.frame(p):
        prev = [Vector((v.x, -0.05 * h, v.z)) for v in I._ring(n, o, r, 0.0, rnd, 0.05, 0.0)]
        for k in range(1, levels + 1):
            t = k / levels
            rr = r * (1 - 0.7 * t ** 1.15)
            ring = I._ring(n, o, rr, h * t, rnd, 0.10, 0.035 * h)
            I.band(mb, ring, prev, M[rocks[k % 2]])
            if k < levels:
                nxt = [Vector((v.x * 0.86, v.y + 0.012 * h, v.z * 0.86)) for v in ring]
                I.band(mb, nxt, ring, M[top])
                prev = nxt
            else:
                prev = ring
            rt = rr
        I.fan(mb, prev, Vector((0, h * 1.03, 0)), M[top])
    return (p[0], p[1] + h, p[2]), rt


def tower(mb, p, s, roof="roof2", wall="wall", h=0.6, r=0.1, yaw=0, flag="orange"):
    with mb.frame(p, yaw=yaw):
        mb.cyl(r * s, h * s, (0, h * s / 2, 0), M[wall], segs=8, r2=r * 0.85 * s)
        mb.cyl(r * 0.9 * s, 0.05 * s, (0, h * s, 0), M["stone"], segs=8, r2=r * 1.08 * s)
        mb.cyl(r * 1.2 * s, 0.32 * s, (0, h * s + 0.185 * s, 0), M[roof], segs=8, r2=0.0)
        for a, hh, rr in ((0, 0.66, 0.93), (75, 0.66, 0.93), (-75, 0.66, 0.93), (35, 0.3, 0.98), (-40, 0.42, 0.96)):
            with mb.frame((0, 0, 0), yaw=a):
                mb.box((0.045 * s, 0.075 * s, 0.014 * s), (0, h * hh * s, r * rr * s), M["window"])
        glow(mb, (0, h * 0.66 * s, 0), 0.5 * s)
        if flag:
            top = h * s + 0.345 * s
            mb.cyl(0.006 * s, 0.16 * s, (0, top + 0.07 * s, 0), M["dark"], segs=3)
            mb.prism([(0, 0), (0.11 * s, 0.03 * s), (0, 0.06 * s)], 0.005 * s, (0, top + 0.09 * s, 0), M[flag], plane='xy')


def hall(mb, p, s, yaw=0, roof="roof2"):
    """Big gabled house, front (+Z local) with a door and lit windows."""
    with mb.frame(p, yaw=yaw):
        mb.box((0.5 * s, 0.28 * s, 0.32 * s), (0, 0.14 * s, 0), M["wall"])
        mb.prism([(-0.3 * s, 0), (0.3 * s, 0), (0, 0.24 * s)], 0.38 * s, (0, 0.28 * s, 0), M[roof], plane='xy')
        mb.box((0.08 * s, 0.15 * s, 0.012 * s), (0, 0.075 * s, 0.161 * s), M["trunk"])
        for x in (-0.16, 0.16):
            mb.box((0.07 * s, 0.08 * s, 0.012 * s), (x * s, 0.16 * s, 0.161 * s), M["window"])
        mb.box((0.06 * s, 0.06 * s, 0.012 * s), (0, 0.36 * s, 0.191 * s), M["window"])
        for z in (-0.08, 0.06):
            mb.box((0.012 * s, 0.07 * s, 0.06 * s), (0.251 * s, 0.16 * s, z * s), M["window"])
        mb.box((0.07 * s, 0.2 * s, 0.07 * s), (-0.14 * s, 0.46 * s, -0.08 * s), M["stone"])
        glow(mb, (0, 0.18 * s, 0.17 * s), 0.6 * s)


def cottage(mb, p, s, yaw=0, roof="roof"):
    """islands.cottage with a choice of roof colour + a glow point at its window."""
    mats = dict(M)
    mats["roof"] = M[roof]
    I.cottage(mb, p, s, mats, yaw=yaw)
    with mb.frame(p, yaw=yaw):
        glow(mb, (-0.09 * s, 0.14 * s, 0.14 * s), 0.35 * s)


def observatory(mb, p, s):
    with mb.frame(p):
        mb.cyl(0.16 * s, 0.2 * s, (0, 0.1 * s, 0), M["wall"], segs=10)
        mb.cyl(0.175 * s, 0.03 * s, (0, 0.205 * s, 0), M["stone"], segs=10)
        prof = [(0.22 * s + 0.16 * s * math.sin(math.pi / 2 * k / 4), 0.16 * s * math.cos(math.pi / 2 * k / 4))
                for k in range(5)]
        prof[-1] = (prof[-1][0], 0.0)
        lathe_cells(mb, prof, 10, lambda i, j: "window" if j == 2 else "brass")
        mb.box((0.06 * s, 0.1 * s, 0.012 * s), (0, 0.05 * s, 0.158 * s), M["trunk"])
        mb.box((0.05 * s, 0.05 * s, 0.012 * s), (0.09 * s, 0.12 * s, 0.13 * s), M["window"])
        glow(mb, (0.05 * s, 0.3 * s, 0.12 * s), 0.5 * s)


def islet(mb, p, r, depth, seed, n=9, pine=0.0, tufts=3):
    """Small floating rock with a grass top; optional pine (scale)."""
    with mb.frame(p):
        isl = I.Island(mb, r, depth, seed, M, n=n, strata=2)
        if pine:
            I.pine(mb, isl.on_top(0.1 * r, -0.1 * r), pine, M, seed=seed)
        if tufts:
            isl.tufts(tufts, M["grass_hi"], seed=seed)
        isl.roots(3, M["root"], seed=seed + 1, thick=0.04, length=(0.3, 0.6))
    return isl


def big_tree(mb, p, s, seed=0):
    x, y, z = p
    mb.cyl(0.03 * s, 0.24 * s, (x, y + 0.11 * s, z), M["trunk"], segs=6, r2=0.02 * s)
    rnd = random.Random(seed)
    for k, (dx, dy, dz, rr) in enumerate(((0, 0.33, 0, 0.16), (0.11, 0.27, 0.04, 0.11), (-0.1, 0.28, -0.03, 0.11),
                                          (0.02, 0.26, 0.11, 0.10), (-0.02, 0.42, -0.02, 0.10))):
        I.ico(mb, (x + dx * s, y + dy * s, z + dz * s), rr * s, M["leaf" if k % 2 == 0 else "leaf2"],
              (1, 0.85, 1), 0.12, seed + k)


def flowers(mb, isl, count, seed, avoid=()):
    rnd = random.Random(seed)
    for k in range(count):
        a = rnd.uniform(0, 2 * math.pi)
        d = isl.r * math.sqrt(rnd.uniform(0.1, 0.8))
        x, z = d * math.cos(a), d * math.sin(a)
        if any(math.hypot(x - ax, z - az) < ar for (ax, az, ar) in avoid):
            continue
        mb.cyl(0.022 * isl.r, 0.03 * isl.r, isl.on_top(x, z, -0.012), M["flower" if k % 2 else "flower2"], segs=3,
               r2=0.0, pitch=180, yaw=k * 37, cap=True)


# -------------------------------------------------------------------- hero islands

def dress_citadel(m, isl):
    """Island 5: a crag with a tall orange-roofed tower, a second peak, a village and a waterfall."""
    r = isl.r
    c1 = isl.on_top(-0.38 * r, -0.34 * r)
    top1, rt1 = crag(m, c1, 0.5 * r, 1.25, 51, n=9, levels=4)
    tower(m, (top1[0], top1[1] - 0.06, top1[2]), 1.9, roof="roof2", r=min(0.11, rt1 / 1.9 * 0.95))
    # turret on the crag's first terrace, toward the viewer
    tower(m, (c1[0] + 0.5, c1[1] + 0.28, c1[2] + 0.42), 1.05, roof="roof", flag=None)
    c2 = isl.on_top(0.45 * r, -0.45 * r)
    top2, rt2 = crag(m, c2, 0.4 * r, 0.7, 52, n=8, levels=3)
    tower(m, (top2[0], top2[1] - 0.05, top2[2]), 1.25, roof="roof3", flag="cream")
    I.waterfall(m, isl, math.radians(40), M, width=0.13, seed=5)
    cottage(m, isl.on_top(0.02 * r, 0.52 * r), 1.5, yaw=-10)
    cottage(m, isl.on_top(-0.42 * r, 0.6 * r), 1.3, yaw=20, roof="roof2")
    cottage(m, isl.on_top(-0.74 * r, 0.22 * r), 1.2, yaw=40)
    cottage(m, isl.on_top(0.78 * r, -0.02 * r), 1.15, yaw=-35, roof="roof3")
    for k, (x, z, s) in enumerate(((-0.86, -0.05, 1.7), (-0.62, 0.72, 1.4), (0.2, 0.85, 1.5), (0.9, -0.3, 1.6),
                                   (0.08, -0.82, 1.9), (-0.2, -0.86, 1.5))):
        I.pine(m, isl.on_top(x * r, z * r), s, M, seed=k)
    for k, (x, z, s) in enumerate(((-0.12, 0.28, 1.5), (0.6, 0.62, 1.3), (-0.9, 0.42, 1.2))):
        I.round_tree(m, isl.on_top(x * r, z * r), s, M, seed=20 + k)
    av = ((c1[0], c1[2], 0.5 * r), (c2[0], c2[2], 0.4 * r), (0.35 * r, 0.29 * r, 0.4))
    isl.tufts(14, M["grass_hi"], seed=31, avoid=av)
    flowers(m, isl, 14, 32, avoid=av)
    isl.roots(13, M["root"], seed=33, thick=0.018)
    isl.roots(9, M["vine"], seed=34, length=(0.18, 0.42), thick=0.014)
    islet(m, (1.45 * r, -0.75, 0.3 * r), 0.3, 0.62, 61, pine=0.95)
    islet(m, (-1.4 * r, -0.35, 0.45 * r), 0.22, 0.5, 62, n=8)
    islet(m, (0.85 * r, -2.0, 0.55 * r), 0.15, 0.36, 63, n=7, tufts=0)


def dress_mesa(m, isl):
    """Island 6: wide town plateau, a great tree, a windmill, a pier with a moored balloon, and a bridge to
    a tower islet."""
    r = isl.r
    hall(m, isl.on_top(0.02 * r, -0.12 * r), 2.1, yaw=5)
    big_tree(m, isl.on_top(-0.52 * r, -0.4 * r), 4.2, seed=3)
    I.windmill(m, isl.on_top(0.58 * r, -0.45 * r), 2.0, M, yaw=-25, sail_rot=25)
    cottage(m, isl.on_top(-0.55 * r, 0.38 * r), 1.4, yaw=25)
    cottage(m, isl.on_top(0.48 * r, 0.42 * r), 1.4, yaw=-20, roof="roof3")
    cottage(m, isl.on_top(0.76 * r, -0.02 * r), 1.2, yaw=-55)
    cottage(m, isl.on_top(-0.08 * r, 0.62 * r), 1.25, yaw=5, roof="roof2")
    cottage(m, isl.on_top(-0.82 * r, -0.02 * r), 1.1, yaw=60)
    for k, (x, z) in enumerate(((0.2, 0.3), (0.29, 0.36), (0.16, 0.42))):
        m.cyl(0.07, 0.13, isl.on_top(x * r, z * r, -0.03), M["ochre"], segs=6, r2=0.015)
    for k, (x, z, s) in enumerate(((-0.25, -0.78, 1.7), (0.15, -0.8, 1.5), (0.86, 0.3, 1.4), (-0.88, 0.3, 1.3),
                                   (0.3, 0.8, 1.2))):
        I.pine(m, isl.on_top(x * r, z * r), s, M, seed=k)
    for k, (x, z, s) in enumerate(((-0.3, 0.12, 1.4), (0.9, -0.3, 1.3), (-0.4, 0.8, 1.2))):
        I.round_tree(m, isl.on_top(x * r, z * r), s, M, seed=30 + k)
    # fence
    for k in range(7):
        m.box((0.016, 0.09, 0.016), isl.on_top((0.1 + 0.07 * k) * r, 0.56 * r, -0.03), M["trunk"])
    m.box((0.42 * r + 0.05, 0.014, 0.012), isl.on_top(0.31 * r, 0.56 * r, -0.045), M["trunk"])
    av = ((0.02 * r, -0.12 * r, 0.7), (0.58 * r, -0.45 * r, 0.35), (-0.52 * r, -0.4 * r, 0.3))
    isl.tufts(16, M["grass_hi"], seed=41, avoid=av)
    flowers(m, isl, 16, 42, avoid=av)
    isl.roots(14, M["root"], seed=43, thick=0.016)
    isl.roots(10, M["vine"], seed=44, length=(0.2, 0.45), thick=0.012)
    # pier on the right rim + moored balloon
    px = 1.02 * r
    m.box((0.95, 0.035, 0.24), (px + 0.36, -0.02, 0.22 * r), M["wood_lt"])
    for dx in (0.1, 0.45, 0.8):
        for dz in (-0.1, 0.1):
            m.cyl(0.018, 0.3, (px + dx, -0.14, 0.22 * r + dz), M["wood_dk"], segs=4)
    bx, by = px + 0.78, 0.95
    balloon(m, (bx, by, 0.22 * r), 0.75, style="stripes", cols=("teal", "cream"), nseg=10)
    tube(m, [(bx - 0.02, 0.0, 0.22 * r), (bx - 0.05, 0.3, 0.22 * r), (bx, by - 0.75 * 0.55 - 0.35, 0.22 * r)], 0.006,
         M["rope"], segs=3, cap=False)
    m.box((0.1, 0.09, 0.1), (px + 0.3, 0.045, 0.22 * r + 0.04), M["rope"])
    m.box((0.08, 0.07, 0.12), (px + 0.42, 0.035, 0.22 * r - 0.05), M["wood"])
    # tower islet on the left, joined by a plank bridge
    ax, ay, az, ar = -1.75 * r, -0.22, 0.12 * r, 0.42 * r
    with m.frame((ax, ay, az)):
        sub = I.Island(m, ar, 1.15, 71, M, n=12, strata=2)
        tower(m, sub.on_top(-0.1 * ar, -0.15 * ar), 1.7, roof="roof3", flag="orange")
        I.pine(m, sub.on_top(0.5 * ar, 0.3 * ar), 1.3, M, seed=1)
        I.pine(m, sub.on_top(-0.6 * ar, 0.35 * ar), 1.0, M, seed=2)
        cottage(m, sub.on_top(0.3 * ar, 0.55 * ar), 0.95, yaw=-15)
        sub.tufts(5, M["grass_hi"], seed=72)
        sub.roots(6, M["root"], seed=73, thick=0.03)
    x0, x1 = -1.0 * r, ax + ar * 0.98
    n = 7
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append((x0 + (x1 - x0) * t, -0.01 + (ay + 0.01) * t - 0.1 * math.sin(math.pi * t), az * (0.4 + 0.6 * t)))
    for k in range(n):
        a, b = Vector(pts[k]), Vector(pts[k + 1])
        d = b - a
        mid = (a + b) / 2
        m.box((d.length * 0.9, 0.018, 0.13), tuple(mid), M["wood_lt"],
              roll=math.degrees(math.atan2(d.y, d.x)) if d.x > 0 else 180 + math.degrees(math.atan2(d.y, d.x)))
    for dz in (-0.07, 0.07):
        tube(m, [(p[0], p[1] + 0.1, p[2] + dz) for p in pts], 0.006, M["rope"], segs=3, cap=False)


def dress_needle(m, isl):
    """Island 7 (full tier): a tall needle with an observatory dome and a long waterfall."""
    r = isl.r
    c = isl.on_top(-0.12 * r, -0.2 * r)
    top, rt = crag(m, c, 0.62 * r, 1.9, 81, n=8, levels=5, rocks=("rock2", "rock1"))
    observatory(m, (top[0], top[1] - 0.05, top[2]), min(1.3, rt / 0.16 * 0.95))
    I.waterfall(m, isl, math.radians(65), M, width=0.14, seed=7)
    cottage(m, isl.on_top(0.55 * r, -0.2 * r), 1.1, yaw=-30, roof="roof2")
    cottage(m, isl.on_top(-0.62 * r, 0.4 * r), 1.0, yaw=30)
    for k, (x, z, s) in enumerate(((0.7, 0.3, 1.2), (-0.8, -0.1, 1.3), (-0.3, 0.75, 1.0), (0.3, -0.8, 1.3))):
        I.pine(m, isl.on_top(x * r, z * r), s, M, seed=k)
    isl.tufts(8, M["grass_hi"], seed=82, avoid=((c[0], c[2], 0.62 * r),))
    isl.roots(9, M["root"], seed=83, thick=0.03, length=(0.3, 0.7))
    isl.roots(6, M["vine"], seed=84, length=(0.25, 0.5), thick=0.022)
    islet(m, (1.5 * r, 0.4, -0.2 * r), 0.2, 0.45, 85, n=7, pine=0.7)
    islet(m, (-1.4 * r, -1.0, 0.3 * r), 0.16, 0.4, 86, n=7, tufts=0)


def rocks(m):
    """Loose cluster of small floating rocks (full tier foreground / filler)."""
    for k, (x, y, z, r, d, pine) in enumerate(((0, 0, 0, 0.42, 0.85, 1.1), (1.1, 0.5, -0.4, 0.26, 0.5, 0.0),
                                               (-1.0, -0.4, 0.3, 0.3, 0.62, 0.8), (0.5, -0.9, 0.5, 0.17, 0.4, 0.0),
                                               (-0.45, 0.75, -0.6, 0.14, 0.3, 0.0), (1.7, -0.2, 0.2, 0.12, 0.28, 0.0))):
        islet(m, (x, y, z), r, d, 90 + k, n=8 if r > 0.2 else 6, pine=pine, tufts=2 if r > 0.2 else 0)
