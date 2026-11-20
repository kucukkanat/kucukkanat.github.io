"""Hull form, planking, decks, castles and the stern gallery."""
import math
from mathutils import Vector
import kit
from kit import MB, add, lerp, clamp, smooth

# ---- principal dimensions (m) ---------------------------------------------------
XC = -9.02          # centre of the stern-gallery arc (= cabin arc centre)
XT = -11.4          # lower transom; the gallery overhangs aft of it
XJ = -10.95         # castle side wall meets the gallery arc
XQ = -6.6           # quarterdeck break
XF = 7.2            # forecastle break
XB = 13.0           # stem
CAB_FLOOR = 4.45    # great cabin floor (cabin.glb y=0)
QD = 7.75           # quarterdeck
FC = 6.45           # forecastle deck
QD_WALL = 8.2       # top of the solid bulwark round the quarterdeck
FC_WALL = 6.95
PORTS = [-4.8, -2.4, 2.2, 4.6]      # gun port centres (both sides)
PORT_HALF, PORT_Z0, PORT_Z1 = 0.38, 0.28, 0.74
GATE = (-0.55, 0.55)                # entry gate, port side only
MAIN_X, FORE_X = -1.5, 8.2          # masts


def zs(x):
    """Sheer: deck edge height."""
    a = x + 1
    return 4.2 + (0.35 * (a / 12) ** 2 if a < 0 else 0.9 * (a / 14) ** 2)


def bs(x):
    """Half beam at the sheer."""
    if x <= -1:
        return 4.1 - 0.75 * ((-1 - x) / 10) ** 2.2
    return max(0.16, 4.1 * max(0., 1 - ((x + 1) / 14) ** 2.6) ** 0.7)


def keel(x):
    if x > 6:
        return 4.5 * ((x - 6) / 7) ** 2.2
    if x < -8.6:
        return 3.15 * ((-8.6 - x) / 2.8) ** 1.7
    return 0.0


def section(x, u):
    """Half section, u: 0 keel .. 1 sheer -> (y, z)."""
    k, s, b = keel(x), zs(x), bs(x)
    if x < -2: p = lerp(2.8, 0.85, smooth((-2 - x) / 8.5))
    elif x > 2: p = lerp(2.8, 1.15, smooth((x - 2) / 10.5))
    else: p = 2.8
    tumble = 0.24 * (1 - smooth((x - 4) / 8))
    bw = b + tumble
    u0 = 0.7
    if u <= u0:
        v = u / u0
        y = bw * (1 - (1 - v) ** p) ** (1 / p)
    else:
        y = bw - tumble * ((u - u0) / (1 - u0)) ** 2
    return max(y, 0.19), k + (s - k) * u


def stations():
    xs, x = [], XT
    while x < XB - 1e-6:
        xs.append(round(x, 4))
        x += 0.15 if x < -9.6 else (0.25 if x > 9.5 else (0.3 if x > 6 or x < -8 else 0.6))
    return xs + [XB]


def lean_aft(x): return lerp(0.30, 0.12, clamp((XQ - x) / (XQ - XJ)))
RB = math.hypot(XJ - XC, bs(XJ))
RT = math.hypot(XJ - XC, bs(XJ) - 0.12)
def cfrac(z): return clamp((z - 4.3) / (QD_WALL - 4.3))
def arc_r(z): return lerp(RB, RT, cfrac(z))
def arc_pt(a_deg, z, dr=0.0):
    a = math.radians(a_deg); r = arc_r(z) + dr
    return Vector((XC - r * math.cos(a), r * math.sin(a), z))


def castle_w(x, z, inset=0.0):
    """Half width of the aft castle (outer face) at height z."""
    if x >= XJ:
        return bs(x) - lean_aft(x) * cfrac(z) - inset
    r = arc_r(z) - inset
    d = r * r - (x - XC) ** 2
    return math.sqrt(d) if d > 0 else 0.0


def fc_w(x, z, inset=0.0):
    f = clamp((z - zs(x)) / (FC_WALL - zs(x)))
    return bs(x) + 0.18 * f - inset


def castle_outline(z, dr=0.0, side=1, n_arc=14):
    """Port-side outline from the quarterdeck break round to the centreline at the stern."""
    pts = [Vector((x, (castle_w(x, z) + dr) * side, z)) for x in (XQ, -7.3, -8.0, -8.7, -9.4, -10.2, XJ)]
    aj = math.degrees(math.atan2(castle_w(XJ, z), XC - XJ))
    for i in range(1, n_arc + 1):
        p = arc_pt(aj * (1 - i / n_arc), z, dr); p.y *= side
        pts.append(p)
    return pts


def full_outline(z, dr=0.0):
    a = castle_outline(z, dr, 1)
    b = castle_outline(z, dr, -1)
    return a + list(reversed(b))[1:]


# ---- hull -----------------------------------------------------------------------
ROWS = 15
def row_style(j):
    if j <= 5: return 'PaintCream', None
    if j == 6: return 'PaintOrange', None
    if j in (10, 14): return 'HullDark', None
    return 'HullWood', None


def build_hull(root):
    xs = stations()
    P = [[Vector((x, *section(x, j / ROWS))) for j in range(ROWS + 1)] for x in xs]
    ni = len(xs)
    N = [[None] * (ROWS + 1) for _ in range(ni)]
    for i in range(ni):
        for j in range(ROWS + 1):
            di = P[min(i + 1, ni - 1)][j] - P[max(i - 1, 0)][j]
            dj = P[i][min(j + 1, ROWS)] - P[i][max(j - 1, 0)]
            n = dj.cross(di)
            N[i][j] = n.normalized() if n.length > 1e-9 else Vector((0, 1, 0))
    mb = MB(3)
    for s in (1, -1):
        with mb.at(scale=(1, s, 1)):
            for j in range(ROWS):
                mat, _ = row_style(j)
                lap = 0.075 if mat == 'HullDark' else 0.04
                top = 0.035 if mat == 'HullDark' else 0.0
                col, nxt, st = None, 0, None
                for i in range(ni - 1):
                    if i >= nxt:
                        col = mb.tint(mat, None, .09); nxt = i + mb.rng.randint(4, 9); st = mb.strip_start(mat)
                    A, B = P[i][j] + N[i][j] * lap, P[i + 1][j] + N[i + 1][j] * lap
                    C, D = P[i + 1][j + 1] + N[i + 1][j + 1] * top, P[i][j + 1] + N[i][j + 1] * top
                    uv = mb.strip_uv(st, A, D, B, C)
                    mb.face([A, D, C, B], mat, col, uv=[uv['a0'], uv['a1'], uv['b1'], uv['b0']])
                    mb.face([P[i][j] + N[i][j] * .0, A, B, P[i + 1][j]], mat, col)       # lap step
                    if top:
                        mb.face([D, P[i][j + 1], P[i + 1][j + 1], C], mat, col)
    # lower transom
    x = xs[0]
    for j in range(ROWS):
        mat, _ = row_style(j)
        a, b = P[0][j], P[0][j + 1]
        mb.face([(x, a.y, a.z), (x, -a.y, a.z), (x, -b.y, b.z), (x, b.y, b.z)], mat, var=.09)
    add('Hull_planking', mb, root)

    # backbone: keel, stem, sternpost
    mb = MB(4)
    path = [(-10.0, 0, -0.14)] + [(x, 0, keel(x) - 0.14) for x in xs if x >= -8.6] + [(13.2, 0, 5.1), (13.42, 0, 6.0), (13.5, 0, 7.05)]
    mb.beam(path, 0.46, 0.6, 'HullDark')
    post = lambda x: -0.35 + (x + 9.9) / -1.46 * 3.55          # raked sternpost line
    mb.beam([(-9.9, 0, -0.35), (-11.36, 0, 3.2)], 0.46, 0.55, 'HullDark')
    dw = [x for x in xs if x <= -8.6] + [-8.6]                   # deadwood between the tuck and the post
    for a, b in zip(dw, dw[1:]):
        lo = lambda x: max(post(x), -0.3) if x < -9.9 else -0.3
        for sy in (1, -1):
            q = [(a, .2 * sy, lo(a)), (b, .2 * sy, lo(b)), (b, .2 * sy, keel(b) + .06), (a, .2 * sy, keel(a) + .06)]
            mb.face(q if sy < 0 else q[::-1], 'HullDark', var=.08)
    mb.box((0.5, 0.56, 0.5), (13.5, 0, 7.2), 'Gilt', top=(.6, .6))
    add('Hull_backbone', mb, root, bevel=.03)


def deck_planks(mb, xs, zfn, wfn, lane=0.36, mat='Deck', seed_break=(4, 9)):
    wmax = max(wfn(x) for x in xs)
    nl = int(math.ceil(wmax / lane))
    for k in range(-nl, nl):
        y0, y1 = k * lane, (k + 1) * lane
        col, nxt, st = None, 0, None
        for i in range(len(xs) - 1):
            if i >= nxt:
                col = mb.tint(mat, None, .1); nxt = i + mb.rng.randint(*seed_break); st = mb.strip_start(mat)
            xa, xb = xs[i], xs[i + 1]
            wa, wb = wfn(xa), wfn(xb)
            a0, a1, b0, b1 = clamp(y0, -wa, wa), clamp(y1, -wa, wa), clamp(y0, -wb, wb), clamp(y1, -wb, wb)
            if a1 - a0 < 1e-3 and b1 - b0 < 1e-3: continue
            q = [(xa, a0, zfn(xa)), (xb, b0, zfn(xb)), (xb, b1, zfn(xb)), (xa, a1, zfn(xa))]
            uv = mb.strip_uv(st, q[0], q[3], q[1], q[2])
            mb.face(q, mat, col, uv=[uv['a0'], uv['b0'], uv['b1'], uv['a1']])


def frange(a, b, step):
    n = max(1, int(round((b - a) / step)))
    return [a + (b - a) * i / n for i in range(n + 1)]


def rail(mb, path, h, post=0.56, w=0.11, cap=(0.2, 0.09), mat='Trim', capmat='HullDark'):
    """Open rail: turned posts on a path plus a cap."""
    path = [Vector(p) for p in path]
    d = [0.0]
    for a, b in zip(path, path[1:]): d.append(d[-1] + (b - a).length)
    n = max(1, int(round(d[-1] / post)))
    for k in range(n + 1):
        t = d[-1] * k / n
        i = max(j for j in range(len(d)) if d[j] <= t + 1e-9)
        i = min(i, len(path) - 2)
        p = path[i].lerp(path[i + 1], (t - d[i]) / max(1e-9, d[i + 1] - d[i]))
        mb.cyl(p, p + Vector((0, 0, h)), w / 2, mat, r1=w * .36, segs=6)
        mb.cyl(p + Vector((0, 0, h * .42)), p + Vector((0, 0, h * .58)), w * .62, mat, segs=6)
    mb.beam([p + Vector((0, 0, h + cap[1] / 2)) for p in path], cap[0], cap[1], capmat, side=None)


def build_decks(root):
    # main deck
    mb = MB(5)
    xs = [x for x in stations() if x <= 12.6]
    deck_planks(mb, xs, lambda x: zs(x) - 0.04, lambda x: bs(x) - 0.14)
    add('Deck_main', mb, root)
    # quarterdeck
    mb = MB(6)
    xa = XC - RT
    xs = frange(xa, xa + 0.6, 0.06) + frange(xa + 0.75, XJ, 0.2)[0:] + frange(XJ + 0.3, XQ + 0.3, 0.45)
    deck_planks(mb, xs, lambda x: QD, lambda x: castle_w(min(x, XQ), QD, 0.13), seed_break=(5, 12))
    w = castle_w(XQ, QD)
    mb.box((0.34, 2 * w, 0.32), (XQ + 0.2, 0, QD - 0.17), 'Trim')
    add('Deck_quarter', mb, root)
    # forecastle deck
    mb = MB(7)
    xs = frange(XF - 0.3, 9.5, 0.4) + frange(9.75, 12.9, 0.25)
    deck_planks(mb, xs, lambda x: FC, lambda x: fc_w(max(x, XF), FC, 0.13))
    w = fc_w(XF, FC)
    mb.box((0.34, 2 * w, 0.32), (XF - 0.2, 0, FC - 0.17), 'Trim')
    add('Deck_forecastle', mb, root)


# stern gallery windows: posts at these angles, 5 lights
WIN_POSTS = [-30, -18, -6, 6, 18, 30]
POST_HALF = 1.1
SILL, WTOP, TRANSOM = CAB_FLOOR + 0.95, CAB_FLOOR + 2.55, CAB_FLOOR + 2.15


def build_castle(root):
    ZR = [None, 4.95, SILL, 5.8, 6.2, 6.6, WTOP, 7.4, 7.85, QD_WALL]
    xcols = [XQ, -7.3, -8.0, -8.7, -9.4, -10.2, XJ]
    acols = [52, 44, 36, 31.1, 28.9, 19.1, 16.9, 7.1, 4.9, 0]
    ncol = len(xcols) + len(acols)

    def P(i, j):
        if i < len(xcols):
            x = xcols[i]
            z = ZR[j] if j else zs(x) - 0.03
            return Vector((x, castle_w(x, z), z))
        z = ZR[j] if j else 4.22
        return arc_pt(acols[i - len(xcols)], z)

    def inward(i):
        if i < len(xcols) - 1: return (0, -1, 0)
        if i == len(xcols) - 1: return Vector((0.4, -0.9, 0)).normalized()
        a = math.radians(acols[i - len(xcols)])
        return (math.cos(a), -math.sin(a), 0)
    holes = set()
    for a_hi in (28.9, 16.9, 4.9):
        i = len(xcols) + acols.index(a_hi)
        holes |= {(i, j) for j in (2, 3, 4, 5)}

    # bands, bottom to top: walnut planks, cream window band, orange stripe, mahogany top (each its own painted material)
    band = lambda i, j: 'PaintCream' if 2 <= j <= 5 else ('PaintOrange' if j == 6 else ('Trim' if j >= 7 else None))
    mb = MB(8)
    grid = [[P(i, j) for j in range(len(ZR))] for i in range(ncol)]
    for s in (1, -1):
        with mb.at(scale=(1, s, 1)):
            mb.wall(grid, inward, 0.15, 'HullWood', None, holes, caps='t', matfn=band)
    # front bulkhead with door and two windows
    ys = [-1, -2.6, -1.9, -0.5, 0.5, 1.9, 2.6, 1]
    zr = [zs(XQ) - 0.03, 5.1, 5.9, 6.4, 7.0, QD - 0.02]
    def PB(i, j):
        y = ys[i]
        if i in (0, len(ys) - 1): y *= castle_w(XQ, zr[j]) - 0.02
        return Vector((XQ, y, zr[j]))
    gb = [[PB(i, j) for j in range(len(zr))] for i in range(len(ys))]
    hb = {(3, 0), (3, 1), (3, 2), (1, 1), (5, 1)}
    mb.wall(gb, lambda i: (-1, 0, 0), 0.14, 'HullWood', None, hb, caps='', matfn=lambda i, j: 'Trim' if j == 3 else None)
    add('Castle_aft', mb, root)

    # gallery floor slab (overhang) and corbels
    mb = MB(9)
    at = math.degrees(math.acos((XC - XT) / RB))
    poly = [(XC - (RB + .06) * math.cos(math.radians(a)), (RB + .06) * math.sin(math.radians(a))) for a in frange(at, -at, 8)]
    mb.prism(poly, 4.06, 4.26, 'HullDark')
    for a in (-40, -20, 0, 20, 40):
        ar = math.radians(a)
        y = (RB - .25) * math.sin(ar)
        yt = min(abs(y), section(XT, .55)[0] * .8) * (1 if y >= 0 else -1)
        mb.beam([(XT + .05, yt, 3.25), (XT - .35, lerp(yt, y, .5), 3.55), (XC - (RB - .25) * math.cos(ar), y, 4.02)], .2, .26, 'Trim', side=(0, 1, 0))
    add('Gallery_floor', mb, root, bevel=.025)

    # mouldings, sills, frames, lattice
    mb = MB(10)
    for z, r, m in ((SILL - .05, .065, 'Gilt'), (WTOP + .05, .055, 'Gilt'), (7.86, .05, 'Gilt'), (4.3, .08, 'HullDark')):
        mb.tube(full_outline(z, .03), r, m, segs=6, caps=True)
    for a in WIN_POSTS:        # dark posts between the five lights with brass caps, as on the cabin's stern wall
        side = (math.sin(math.radians(a)), math.cos(math.radians(a)), 0)      # along the arc
        mb.beam([arc_pt(a, SILL - .1, .05), arc_pt(a, WTOP + .1, .05)], .2, .12, 'HullDark', side=side)
        for z0, z1 in ((WTOP - .06, WTOP + .12), (SILL - .12, SILL + .04)):
            mb.beam([arc_pt(a, z0, .07), arc_pt(a, z1, .07)], .25, .14, 'Brass', side=side)
    add('Gallery_trim', mb, root)
    # carved frieze round the castle (image tiles along the band) and the stern name board
    mb = MB(17)
    z0, z1 = WTOP + .1, 7.38
    tile = (z1 - z0) * 21 / 9
    lo, hi = castle_outline(z0, .012, n_arc=20), castle_outline(z1, .012, n_arc=20)
    for s in (1, -1):
        with mb.at(scale=(1, s, 1)):
            u = 0.0
            for k in range(len(lo) - 1):
                du = (lo[k + 1] - lo[k]).length / tile
                mb.face([lo[k], lo[k + 1], hi[k + 1], hi[k]], 'Frieze', (1, 1, 1), uv=[(u, 0), (u + du, 0), (u + du, 1), (u, 1)])
                u += du
    if kit.has_tex('Frieze'): add('Castle_frieze', mb, root)
    mb = MB(18)
    bz0, bz1 = 4.36, 5.28
    half_a = math.degrees((bz1 - bz0) * 21 / 9 / 2 / arc_r(4.85))
    n = 10
    for k in range(n):
        a0, a1 = lerp(half_a, -half_a, k / n), lerp(half_a, -half_a, (k + 1) / n)
        mb.face([arc_pt(a0, bz0, .05), arc_pt(a1, bz0, .05), arc_pt(a1, bz1, .05), arc_pt(a0, bz1, .05)], 'NameBoard', (1, 1, 1),
                uv=[(k / n, 0), ((k + 1) / n, 0), ((k + 1) / n, 1), (k / n, 1)])
    for z in (bz0, bz1):
        mb.tube([arc_pt(lerp(half_a, -half_a, k / n), z, .06) for k in range(n + 1)], .035, 'Gilt', segs=5)
    for a in (half_a, -half_a):
        mb.tube([arc_pt(a, bz0, .06), arc_pt(a, bz1, .06)], .035, 'Gilt', segs=5)
    if kit.has_tex('NameBoard'): add('Name_board', mb, root, note='stern name board: KANAT')
    mb = MB(11); gl = MB(12); gb2 = MB(19)
    for c in (-24, -12, 0, 12, 24):
        a0, a1 = c - 4.9, c + 4.9
        dr = -.08
        gl.grid([[arc_pt(a, z, dr) for z in (SILL, WTOP)] for a in frange(a0, a1, 3.3)], 'Glass', flip=True, var=.03)
        mb.beam([arc_pt(a0, TRANSOM, dr), arc_pt(c, TRANSOM, dr), arc_pt(a1, TRANSOM, dr)], .07, .07, 'HullDark', side=(0, 0, 1))
        mb.beam([arc_pt(c, SILL, dr), arc_pt(c, TRANSOM, dr)], .05, .05, 'HullDark')
        for f in (.33, .67):
            z = lerp(SILL, TRANSOM, f)
            mb.beam([arc_pt(a0, z, dr), arc_pt(c, z, dr), arc_pt(a1, z, dr)], .035, .035, 'HullDark', side=(0, 0, 1))
        n = 3
        for k in range(n):       # diamond lattice above the transom bar
            b0, b1 = lerp(a0, a1, k / n), lerp(a0, a1, (k + 1) / n)
            mb.beam([arc_pt(b0, TRANSOM, dr), arc_pt(b1, WTOP, dr)], .025, .025, 'HullDark')
            mb.beam([arc_pt(b1, TRANSOM, dr), arc_pt(b0, WTOP, dr)], .025, .025, 'HullDark')
    # bulkhead windows
    for sy in (1, -1):
        y0, y1 = 1.9 * sy, 2.6 * sy
        gb2.face([(XQ - .07, y0, 5.1), (XQ - .07, y1, 5.1), (XQ - .07, y1, 5.9), (XQ - .07, y0, 5.9)][::sy], 'Glass')
        for k in range(1, 3):
            y = lerp(y0, y1, k / 3)
            mb.beam([(XQ - .05, y, 5.1), (XQ - .05, y, 5.9)], .03, .03, 'HullDark')
        mb.beam([(XQ - .05, y0, 5.5), (XQ - .05, y1, 5.5)], .03, .03, 'HullDark')
    add('Gallery_frames', mb, root)
    add('Gallery_glass', gl, root, note='the five stern lights (warm emissive); hide or fade when the camera flies in or the cabin is loaded inside')
    add('Bulkhead_glass', gb2, root, note='the two windows of the cabin bulkhead facing the waist')

    # rails
    mb = MB(13)
    mb.beam(full_outline(QD_WALL + .03, -.07), .3, .07, 'HullDark', side=None)
    rail(mb, full_outline(QD_WALL + .06, -.07), .5)
    rail(mb, [(XQ + .2, y, QD) for y in (-2.25, 2.25)], .95)
    add('Rail_quarter', mb, root)


def build_topsides(root):
    # waist bulwarks with gun ports and the entry gate
    edges = {XQ, XF}
    for c in PORTS: edges |= {c - PORT_HALF, c + PORT_HALF}
    edges |= set(GATE)
    xs = sorted(edges)
    full = [xs[0]]
    for a, b in zip(xs, xs[1:]):
        full += frange(a, b, 0.8)[1:]
    xs = full
    RZ = [0, PORT_Z0, PORT_Z1, 0.86, 1.05]
    def P(i, j):
        x = xs[i]
        return Vector((x, bs(x) - 0.12 * RZ[j] / 1.05, zs(x) - 0.03 + RZ[j]))
    grid = [[P(i, j) for j in range(len(RZ))] for i in range(len(xs))]
    def cell(x0): return min(range(len(xs)), key=lambda i: abs(xs[i] - x0))
    ports = {(cell(c - PORT_HALF), 1) for c in PORTS}
    i0, i1 = cell(GATE[0]), cell(GATE[1])
    gate = {(i, j) for i in range(i0, i1) for j in range(4)}
    colfn = None
    stripe = lambda i, j: 'PaintOrange' if j == 2 else ('Trim' if j == 3 else None)
    mb = MB(14)
    mb.wall(grid, lambda i: (0, -1, 0), 0.16, 'HullWood', colfn, ports | gate, caps='t', matfn=stripe)
    with mb.at(scale=(1, -1, 1)):
        mb.wall(grid, lambda i: (0, -1, 0), 0.16, 'HullWood', colfn, ports, caps='t', matfn=stripe)
    capz = lambda x: zs(x) + 1.06
    for s in (1, -1):
        segs = [[x for x in xs if x <= GATE[0]], [x for x in xs if x >= GATE[1]]] if s == 1 else [xs]
        for seg in segs:
            mb.beam([(x, s * (bs(x) - 0.2), capz(x)) for x in seg], .34, .08, 'HullDark', side=(0, 1, 0))
    add('Bulwark_waist', mb, root)

    # forecastle sides
    xs = frange(XF, 12.4, 0.65) + [12.75, XB]
    FR = [0, .4, .72, .84, 1]
    def PF(i, j):
        x = xs[i]; z = lerp(zs(x) - .03, FC_WALL, FR[j])
        return Vector((x, fc_w(x, z), z))
    grid = [[PF(i, j) for j in range(len(FR))] for i in range(len(xs))]
    mb = MB(15)
    for s in (1, -1):
        with mb.at(scale=(1, s, 1)):
            mb.wall(grid, lambda i: (0, -1, 0), 0.16, 'HullWood', colfn, (), caps='t', matfn=stripe)
        mb.beam([(x, s * (fc_w(x, FC_WALL) - .08), FC_WALL + .04) for x in xs], .32, .08, 'HullDark', side=(0, 1, 0))
    # forecastle bulkhead + door opening
    w = lambda z: fc_w(XF, z) - .02
    ys = [-1, -.45, .45, 1]; zr = [zs(XF) - .03, 6.1, FC - .02]
    gb = [[Vector((XF, ys[i] * (w(zr[j]) if abs(ys[i]) == 1 else 1), zr[j])) for j in range(3)] for i in range(4)]
    mb.wall(gb, lambda i: (1, 0, 0), 0.14, 'HullWood', None, {(1, 0)}, caps='')
    rail(mb, [(XF - .2, y, FC) for y in (-1.9, -0.75)], .9)
    rail(mb, [(XF - .2, y, FC) for y in (0.75, 1.9)], .9)
    add('Forecastle', mb, root)


def stair(mb, x0, z0, x1, z1, y, width=0.85, n=9):
    """Ship's ladder from (x0, z0) up to (x1, z1) at lateral position y."""
    for k in range(1, n + 1):
        t = k / (n + 1)
        mb.box((0.3, width, 0.06), (lerp(x0, x1, t), y, lerp(z0, z1, t)), 'Deck')
    for s in (-1, 1):
        yy = y + s * (width / 2 + .04)
        mb.beam([(x0, yy, z0), (x1, yy, z1)], .09, .26, 'Trim', side=(0, 1, 0))
        top = [(x0, yy, z0 + .95), (x1, yy, z1 + .95)]
        mb.tube(top, .04, 'Brass', segs=6)
        for t in (0.02, .5, .98):
            p = Vector((lerp(x0, x1, t), yy, lerp(z0, z1, t)))
            mb.cyl(p, p + Vector((0, 0, .95)), .035, 'Brass', segs=6)


def build_fittings(root):
    mb = MB(16)
    for s in (1, -1):
        stair(mb, XQ + 2.5, zs(XQ + 2.5), XQ + .35, QD, s * 2.75, n=10)
        stair(mb, XF - 1.7, zs(XF - 1.7), XF - .35, FC, s * 2.4, n=6)
    add('Stairs', mb, root, bevel=.012)
    kit.joint('Cabin_anchor', (XC - 1.0, 0, CAB_FLOOR), (0, 0, 90), root,
              note='Parent the site cabin.glb scene to this node with an identity transform: its windows then sit in the stern gallery.')
