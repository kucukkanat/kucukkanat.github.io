"""Polish round (2026-11-20): Letter, Portrait, Bottle, Tengwar_note, Slate, Bell, Rope_fg, busier ceiling,
VP_portrait / VP_letter. See docs/SCENE_CONTRACT.md "Polish round additions".

Everything is authored in three.js coordinates like the rest of the kit.
Interactive props are groups (empties) with mesh children built in group-local coordinates;
static decoration goes into STATIC_* meshes (lightmapped)."""
import math
import bmesh
from mathutils import Vector, Matrix
from . import util, layout as L
from .util import MB, empty, mat3, world_point

# ----------------------------------------------------------------- placements (three.js)

# Letter: on the chart table, front-right of the handheld, partly on the map
LETTER_POS = (0.27, L.MAP_Y + 0.0008, 0.205)
LETTER_YAW = -12.0
LETTER_W, LETTER_D = 0.17, 0.115

# Portrait: above the logbook rack (rack frame local coords), hangs tilted forward
PORTRAIT_BOTTOM = 2.05
PORTRAIT_TILT = 5.0
CANVAS_W, CANVAS_H = 0.36, 0.36          # 1:1 (captain round: square painting)
FRAME_BAR = 0.055

# Bottle: lying on the sill of the window right of the wheel (18..30 deg)
BOTTLE_A, BOTTLE_R = 25.0, 3.48
BOTTLE_YAW_EXTRA = 12.0

# Tengwar note: on the stern wall left of the bookshelf, eye height
TENGWAR_A, TENGWAR_Y = -53.5, 1.6
TENG_W, TENG_H = 0.18, 0.12              # 3:2

# Slate: leaning on the chest top against the hutch (chest frame local coords)
SLATE_BASE = (0.28, 0.9, 0.05)
SLATE_LEAN = -18.0
SLATE_W, SLATE_H = 0.20, 0.15            # 4:3 board
SLATE_BAR = 0.025

# Bell: bracket on the window post at -18 deg, arm diagonally into the -30..-18 window
BELL_POST_A = -18.0
BELL_PIVOT_LOCAL = (-0.22, 2.035, 0.32)  # in the post frame (local +Z into the room)
# fix round: eye bolt under the arm (bottom wire just below the pivot) + 3-link chain down to the crown loop
BELL_EYE_R, BELL_EYE_Y = 0.0105, 0.0085
LINK_A, LINK_B, LINK_R = 0.016, 0.0085, 0.0026     # link half-length / half-width (wire centres), wire radius



def post_frame(a, r=L.R + 0.01):
    return mat3(L.arc_pt(a, r), yaw=-a)


def chest_frame():
    return mat3(L.CHEST_POS, yaw=L.CHEST_YAW)


def rack_frame():
    return mat3(L.RACK_POS, yaw=L.RACK_YAW)


def portrait_frame():
    """Frame-local space: origin at the bottom-back centre of the picture frame, +Y up the frame, +Z out."""
    return rack_frame() @ mat3((0, PORTRAIT_BOTTOM, 0.0), pitch=PORTRAIT_TILT)


def portrait_canvas_m():
    return portrait_frame() @ mat3((0, FRAME_BAR + CANVAS_H / 2, 0.012))


def slate_m():
    """Slate group transform (origin = board centre)."""
    base = chest_frame() @ mat3(SLATE_BASE, pitch=SLATE_LEAN)
    return base @ mat3((0, SLATE_H / 2 + SLATE_BAR, 0.0))


def bell_m():
    a = BELL_POST_A
    p = world_point(post_frame(a), BELL_PIVOT_LOCAL)
    return mat3(p, yaw=-a - 135.0)       # local +X along the bracket arm (swing axis)


def tengwar_m():
    return mat3(L.arc_pt(TENGWAR_A, L.R - 0.007, TENGWAR_Y), yaw=-TENGWAR_A, roll=-3.0)


def letter_m():
    return mat3(LETTER_POS, yaw=LETTER_YAW)


def bottle_m():
    p = L.arc_pt(BOTTLE_A, BOTTLE_R, L.SILL_Y + 0.04)
    return mat3(p, yaw=-BOTTLE_A + BOTTLE_YAW_EXTRA)


def _pos(m):
    t = m.translation
    return (t.x, t.y, t.z)


def _ypr(m):
    """yaw/pitch/roll (deg) of a three-space rotation built as Ry @ Rx @ Rz."""
    r = m.to_3x3().normalized()
    # r = Ry(y) Rx(p) Rz(r): r[1][2] = -sin p
    p = math.asin(max(-1.0, min(1.0, -r[1][2])))
    y = math.atan2(r[0][2], r[2][2])
    rr = math.atan2(r[1][0], r[1][1])
    return math.degrees(y), math.degrees(p), math.degrees(rr)


# ----------------------------------------------------------------- geometry helpers

def tube(mb, pts, r, mat, segs=8, tile=0.18, cap=True, local=None):
    """Swept tube along a polyline (three coords). r: float or f(t in 0..1). UV: u around, v along."""
    tb = bmesh.new()
    uvl = tb.loops.layers.uv.new('UVMap')
    P = [Vector(p) for p in pts]
    n = len(P)
    tans = [(P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized() for i in range(n)]
    up = Vector((0, 1, 0)) if abs(tans[0].y) < 0.9 else Vector((1, 0, 0))
    nrm = (up - tans[0] * up.dot(tans[0])).normalized()
    rings, lens = [], []
    acc = 0.0
    for i in range(n):
        if i > 0:
            nrm = tans[i - 1].rotation_difference(tans[i]) @ nrm
            acc += (P[i] - P[i - 1]).length
        lens.append(acc)
        b = tans[i].cross(nrm)
        rad = r(i / (n - 1)) if callable(r) else r
        ring = []
        for j in range(segs + 1):
            a = 2 * math.pi * j / segs
            ring.append(tb.verts.new(P[i] + rad * (math.cos(a) * nrm + math.sin(a) * b)))
        rings.append(ring)
    for i in range(n - 1):
        for j in range(segs):
            f = tb.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]))
            uvs = ((j / segs, lens[i] / tile), (j / segs, lens[i + 1] / tile),
                   ((j + 1) / segs, lens[i + 1] / tile), ((j + 1) / segs, lens[i] / tile))
            for l, uv in zip(f.loops, uvs):
                l[uvl].uv = uv
    if cap:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            vs = ring[:segs]
            f = tb.faces.new(vs[::-1] if rev else vs)
            for l in f.loops:
                l[uvl].uv = (0.5, 0.5)
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    mb.raw(tb, mat, uv=None, local=local or Matrix.Identity(4))


def lathe(mb, profile, mat, segs=20, local=None, uv='box'):
    """Revolve a (r, y) profile around local Y. r == 0 entries become poles."""
    tb = bmesh.new()
    rings = []
    for (r, y) in profile:
        if r < 1e-7:
            rings.append([tb.verts.new((0, y, 0))])
        else:
            rings.append([tb.verts.new((r * math.cos(2 * math.pi * j / segs), y,
                                        r * math.sin(2 * math.pi * j / segs))) for j in range(segs)])
    for a, b in zip(rings[:-1], rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for j in range(segs):
            jn = (j + 1) % segs
            if len(a) == 1:
                tb.faces.new((a[0], b[jn], b[j]))
            elif len(b) == 1:
                tb.faces.new((a[j], a[jn], b[0]))
            else:
                tb.faces.new((a[j], a[jn], b[jn], b[j]))
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    mb.raw(tb, mat, uv=uv, local=local or Matrix.Identity(4))


def sheet(mb, w, h, mat, nx=8, ny=6, bend=None, thick=0.0006, local=None, back=True):
    """Paper sheet in local XY facing +Z, UV 0..1 over the front face (v=1 at +Y).
    bend(x, y) -> z offset."""
    tb = bmesh.new()
    uvl = tb.loops.layers.uv.new('UVMap')
    f_ = bend or (lambda x, y: 0.0)

    def grid(dz):
        g = []
        for i in range(nx + 1):
            col = []
            for k in range(ny + 1):
                x, y = -w / 2 + w * i / nx, -h / 2 + h * k / ny
                col.append(tb.verts.new((x, y, f_(x, y) + dz)))
            g.append(col)
        return g

    def uv(i, k, mirror=False):
        u = i / nx
        return (1 - u if mirror else u, k / ny)

    front = grid(0.0)
    for i in range(nx):
        for k in range(ny):
            f = tb.faces.new((front[i][k], front[i + 1][k], front[i + 1][k + 1], front[i][k + 1]))
            for l, ij in zip(f.loops, ((i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1))):
                l[uvl].uv = uv(*ij)
    if back:
        bk = grid(-thick)
        for i in range(nx):
            for k in range(ny):
                f = tb.faces.new((bk[i][k], bk[i][k + 1], bk[i + 1][k + 1], bk[i + 1][k]))
                for l, ij in zip(f.loops, ((i, k), (i, k + 1), (i + 1, k + 1), (i + 1, k))):
                    l[uvl].uv = uv(*ij, mirror=True)
    mb.raw(tb, mat, uv=None, smooth=True, local=local or Matrix.Identity(4))


def catenary(p0, p1, sag, n=10):
    out = []
    for i in range(n + 1):
        t = i / n
        p = Vector(p0).lerp(Vector(p1), t)
        p.y -= sag * 4 * t * (1 - t)
        out.append(tuple(p))
    return out


def group(C, name, m, size=0.05):
    y, p, r = _ypr(m)
    return empty(name, _pos(m), yaw=y, pitch=p, roll=r, collection=C, size=size)


def child(mb, grp, C):
    ob = mb.build(origin=(0, 0, 0), collection=C)
    ob.location = (0, 0, 0)
    ob.parent = grp
    return ob


# ----------------------------------------------------------------- interactive props

def build_letter(C):
    m = letter_m()
    grp = group(C, "Letter", m)
    # folded letter lying on the table: build in XY then lay flat (front face up, image top toward -Z)
    lay = mat3(pitch=-90)
    hw = LETTER_W / 2

    def bend(x, y):
        # soft ridge along the middle fold + one corner lifting
        ridge = 0.0028 * (1 - abs(x) / hw)
        curl = 0.0045 * max(0.0, (x / hw) * 0.6 + (-y / (LETTER_D / 2)) * 0.6 - 0.6) ** 2 * 4
        return ridge + curl

    p = MB("Letter_paper")
    sheet(p, LETTER_W, LETTER_D, "LetterPaper", nx=8, ny=4, bend=bend, local=lay)
    child(p, grp, C)
    s = MB("Letter_seal")
    # wax seal at the middle of the flap, slightly toward the visitor
    sy = 0.0028 + 0.0012
    s.cyl(0.0145, 0.003, (0.0, sy, 0.012), "WaxSeal", segs=14, bevel=0.0012)
    s.torus(0.0105, 0.0016, (0.0, sy + 0.0016, 0.012), "WaxSeal", seg=14, rseg=3, axis='y')
    # drips of wax
    s.sphere(0.004, (0.013, sy - 0.0006, 0.019), "WaxSeal", segs=6, rings=3, sy=0.35)
    s.sphere(0.003, (-0.012, sy - 0.0008, 0.002), "WaxSeal", segs=6, rings=3, sy=0.35)
    child(s, grp, C)
    return grp


def portrait_frame_static(p):
    """Gilded frame + nail + hanging cords (static, STATIC_props)."""
    F = portrait_frame()
    fw, fh = CANVAS_W + 2 * FRAME_BAR, CANVAS_H + 2 * FRAME_BAR
    with p.frame(F.translation, *_ypr(F)):
        D = 0.042
        b = FRAME_BAR
        # four mitred-looking bars (overlapping boxes) + inner bead + outer roll
        p.box((fw, b, D), (0, b / 2, D / 2), "Gilt", bevel=0.01, grain='x')
        p.box((fw, b, D), (0, fh - b / 2, D / 2), "Gilt", bevel=0.01, grain='x')
        for sx in (-1, 1):
            p.box((b, fh - 0.002, D), (sx * (fw / 2 - b / 2), fh / 2, D / 2), "Gilt", bevel=0.01)
        cyc = FRAME_BAR + CANVAS_H / 2
        for sy in (-1, 1):
            p.cyl(0.011, fw + 0.004, (0, cyc + sy * (fh / 2 - 0.004), D + 0.002), "Gilt", axis='x', segs=6)
        for sx in (-1, 1):
            p.cyl(0.011, fh + 0.004, (sx * (fw / 2 - 0.004), cyc, D + 0.002), "Gilt", segs=6)
        # corner rosettes + a crest on top
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.sphere(0.017, (sx * (fw / 2 - b / 2), cyc + sy * (fh / 2 - b / 2), D + 0.006), "Gilt", segs=8, rings=4, sy=0.6)
        p.sphere(0.03, (0, fh + 0.012, D / 2 + 0.004), "Gilt", segs=10, rings=5, sy=0.7)
        p.box((0.09, 0.02, 0.02), (0, fh + 0.004, D / 2 + 0.004), "Gilt", bevel=0.006)
        # backing board
        p.box((CANVAS_W + 0.02, CANVAS_H + 0.02, 0.008), (0, cyc, 0.006), "DarkWood")
    # nail + two cords from the top corners
    rf = rack_frame()
    nail = world_point(rf, (0, 2.7, 0.0))
    p.cyl(0.006, 0.035, world_point(rf, (0, 2.7, 0.012)), "Brass", axis='z', segs=8, yaw=L.RACK_YAW)
    p.sphere(0.01, world_point(rf, (0, 2.7, 0.03)), "Brass", segs=8, rings=5, sy=0.6)
    for sx in (-1, 1):
        a = world_point(F, (sx * (CANVAS_W / 2 - 0.02), fh - 0.03, 0.008))
        from .fix import rope
        rope(p, [a, world_point(rf, (0, 2.7, 0.022))], 0.0035, sides=6, spline=False)


def build_portrait(C):
    grp = group(C, "Portrait", portrait_canvas_m())
    c = MB("Portrait_canvas", smooth_angle=0)
    w2, h2 = CANVAS_W / 2, CANVAS_H / 2
    c.quad([(-w2, -h2, 0), (w2, -h2, 0), (w2, h2, 0), (-w2, h2, 0)], "PortraitCanvas")
    child(c, grp, C)
    return grp


def build_bottle(C):
    grp = group(C, "Bottle", bottle_m())
    lay = mat3(roll=-90)       # lathe axis (+Y) -> +X (bottle lies along local X, neck toward +X)
    prof = [(0, -0.095), (0.034, -0.095), (0.04, -0.088), (0.041, -0.06), (0.041, 0.035), (0.037, 0.055),
            (0.026, 0.072), (0.016, 0.084), (0.0135, 0.098), (0.0135, 0.118), (0.0165, 0.121), (0.0165, 0.13),
            (0.012, 0.132), (0.0, 0.132)]
    g = MB("Bottle_glass")
    lathe(g, prof, "BottleGlass", segs=14, local=lay)
    child(g, grp, C)
    # rolled note resting on the bottom of the glass (local +X of `lay` frame points down)
    n = MB("Bottle_note")
    with n.frame((0.0, 0.0, 0.0), roll=-90):
        n.cyl(0.017, 0.12, (0.019, -0.022, 0), "Parchment", segs=12)
        n.cyl(0.011, 0.122, (0.019, -0.022, 0), "Parchment", segs=10)
        n.torus(0.0178, 0.0018, (0.019, -0.022, 0), "Rope", seg=12, rseg=4, axis='y')
    child(n, grp, C)
    k = MB("Bottle_cork")
    with k.frame((0.0, 0.0, 0.0), roll=-90):
        k.cyl(0.0125, 0.032, (0, 0.135, 0), "Cork", segs=10, r2=0.0145)
    child(k, grp, C)
    return grp


def build_tengwar(C):
    grp = group(C, "Tengwar_note", tengwar_m())
    hh = TENG_H / 2

    def bend(x, y):
        # pinned at the top centre: bottom corners curl away from the wall
        t = max(0.0, (hh - 0.02 - y) / (TENG_H - 0.02))
        return 0.002 + 0.006 * t * t * (0.6 + 0.4 * abs(x) / (TENG_W / 2))

    p = MB("Tengwar_paper")
    sheet(p, TENG_W, TENG_H, "TengwarPaper", nx=6, ny=4, bend=bend)
    child(p, grp, C)
    t = MB("Tengwar_tack")
    t.sphere(0.0075, (0, hh - 0.014, 0.0035), "Brass", segs=8, rings=4, sy=0.55)
    t.cyl(0.0085, 0.0012, (0, hh - 0.014, 0.0028), "Brass", axis='z', segs=8)
    child(t, grp, C)
    return grp


def build_slate(C):
    grp = group(C, "Slate", slate_m())
    b = MB("Slate_board", smooth_angle=0)
    w2, h2 = SLATE_W / 2, SLATE_H / 2
    b.quad([(-w2, -h2, 0.003), (w2, -h2, 0.003), (w2, h2, 0.003), (-w2, h2, 0.003)], "SlateBoard")
    child(b, grp, C)
    f = MB("Slate_frame")
    T_ = 0.018
    ow, oh = SLATE_W + 2 * SLATE_BAR, SLATE_H + 2 * SLATE_BAR
    for sy in (-1, 1):
        f.box((ow, SLATE_BAR, T_), (0, sy * (oh / 2 - SLATE_BAR / 2), 0), "Mahogany", bevel=0.004, grain='x')
    for sx in (-1, 1):
        f.box((SLATE_BAR, oh - 0.002, T_), (sx * (ow / 2 - SLATE_BAR / 2), 0, 0), "Mahogany", bevel=0.004)
    f.box((SLATE_W + 0.01, SLATE_H + 0.01, 0.006), (0, 0, -0.004), "DarkWood")
    # hanging string hole + chalk stub on the bottom bar
    f.cyl(0.004, 0.02, (0, oh / 2 - SLATE_BAR / 2, 0), "Iron", axis='z', segs=6)
    f.cyl(0.0055, 0.045, (0.04, -oh / 2 + SLATE_BAR + 0.006, 0.01), "Chalk", axis='x', segs=8, yaw=-8)
    child(f, grp, C)
    return grp


def bell_bracket(p):
    """Static wall bracket on the window post (STATIC_props)."""
    a = BELL_POST_A
    with p.frame(L.arc_pt(a, L.R + 0.01), yaw=-a):
        # back plate on the post face
        p.box((0.08, 0.24, 0.015), (0, 2.0, 0.108), "Brass", bevel=0.005)
        for yy in (1.91, 2.09):
            p.sphere(0.008, (0, yy, 0.117), "Brass", segs=6, rings=4, sy=0.6)
        # arm + diagonal brace toward the pivot
        px, py, pz = BELL_PIVOT_LOCAL
        a0 = Vector((0.0, py + 0.03, 0.115))
        a1 = Vector((px, py + 0.03, pz))
        tube(p, [tuple(a0), tuple(a0.lerp(a1, 0.5) + Vector((0, 0.01, 0))), tuple(a1)], 0.011, "Brass", segs=8, tile=0.35)
        tube(p, [(0, 1.9, 0.115), (px * 0.45, 1.97, 0.115 + (pz - 0.115) * 0.45), (px * 0.75, py + 0.03, 0.115 + (pz - 0.115) * 0.75)],
             0.007, "Brass", segs=6, tile=0.35)
        p.sphere(0.016, (px, py + 0.03, pz), "Brass", segs=10, rings=6)
        # eye bolt under the arm end: the bell's chain hangs from it (built in the bell frame below)
        p.torus(0.02, 0.004, (px * 1.08, py + 0.045, pz + 0.02), "Brass", seg=12, rseg=4, axis='x', yaw=-45)
    bm_ = bell_m()
    with p.frame(bm_.translation, *_ypr(bm_)):
        p.cyl(0.0045, 0.022, (0, 0.026, 0), "Brass", segs=8)
        p.cyl(0.008, 0.005, (0, 0.0205, 0), "Brass", segs=10, bevel=0.0015)
        p.torus(BELL_EYE_R, 0.0028, (0, BELL_EYE_Y, 0), "Brass", seg=14, rseg=6, axis='z')


def chain_link(mb, cy, plane, mat="Brass"):
    """Stadium-shaped chain link centred at (0, cy, 0); plane 'xy' (normal Z) or 'yz' (normal X)."""
    from .fix import rope
    pts = []
    a, b = LINK_A - LINK_B, LINK_B
    for k in range(7):
        th = math.pi * k / 6
        pts.append((b * math.cos(th), cy + a + b * math.sin(th)))
    for k in range(7):
        th = math.pi + math.pi * k / 6
        pts.append((b * math.cos(th), cy - a + b * math.sin(th)))
    P = [(u, v, 0.0) if plane == 'xy' else (0.0, v, u) for (u, v) in pts]
    rope(mb, P, LINK_R, sides=6, closed=True, spline=False, mat=mat)


def bell_drop():
    """y of the chain bottom (crown loop top wire centre) in Bell-local coords, and the body offset."""
    eye_bottom = BELL_EYE_Y - BELL_EYE_R
    y_top = eye_bottom + 0.0028 + LINK_R          # link 1 top wire rests on the eye's bottom wire
    y = y_top
    for i in range(3):
        y_bottom = y - 2 * LINK_A
        y = y_bottom + 2 * LINK_R                  # next link's top wire sits on this one's bottom wire
    crown_top = y_bottom + LINK_R + 0.0045
    return y_top, crown_top - 0.004               # body offset: old crown-loop top was at +0.004


def build_bell(C):
    grp = group(C, "Bell", bell_m())
    y_top, d = bell_drop()
    # chain (swings with the bell): 3 links, alternating planes; link 1 passes through the bracket eye
    ch = MB("Bell_chain")
    y = y_top
    for i in range(3):
        chain_link(ch, y - LINK_A, 'yz' if i % 2 == 0 else 'xy')
        y = y - 2 * LINK_A + 2 * LINK_R
    child(ch, grp, C)
    b = MB("Bell_body")
    prof = [(0.0, -0.032), (0.03, -0.032), (0.04, -0.04), (0.046, -0.06), (0.048, -0.1), (0.053, -0.14),
            (0.063, -0.175), (0.075, -0.196), (0.081, -0.206), (0.081, -0.214), (0.072, -0.214),
            (0.064, -0.203), (0.054, -0.18), (0.044, -0.14), (0.04, -0.09), (0.035, -0.055), (0.0, -0.048)]
    with b.frame((0, d, 0)):
        lathe(b, prof, "Brass", segs=16)
        # crown loop: ring in the XY plane so it hangs on link 3 (YZ plane)
        b.torus(0.016, 0.0045, (0, -0.012, 0), "Brass", seg=12, rseg=5, axis='z')
        b.cyl(0.02, 0.012, (0, -0.028, 0), "Brass", segs=14, bevel=0.002)
        # raised bands
        for yy, rr in ((-0.07, 0.0475), (-0.188, 0.07)):
            b.torus(rr, 0.0028, (0, yy, 0), "Brass", seg=16, rseg=3, axis='y')
    child(b, grp, C)
    # clapper: own pivot inside the bell's crown
    from .fix import rope, knot
    k = MB("Bell_clapper")
    k.cyl(0.004, 0.13, (0, -0.065, 0), "Iron", segs=6)
    k.sphere(0.016, (0, -0.135, 0), "Iron", segs=10, rings=6)
    rope(k, [(0, -0.15, 0), (0.002, -0.24, 0.001), (0.0, -0.33, 0.002)], 0.0055, sides=8, spline=False)
    k.sphere(0.0095, (0.0, -0.338, 0.002), "Rope", segs=8, rings=5, sy=1.4)
    # Bell_clapper is an empty at the clapper pivot (meshopt quantisation rewrites mesh-node transforms,
    # so anything the app rotates must be an empty); the mesh hangs under it.
    piv = empty("Bell_clapper", collection=C, size=0.02)
    piv.parent = grp
    piv.location = util.T(0, -0.05 + d, 0)
    k.name = "Bell_clapper_mesh"
    kob = k.build(origin=(0, -0.05, 0), collection=C)
    kob.parent = piv
    kob.location = (0, 0, 0)
    return grp


# ----------------------------------------------------------------- static: ceiling + foreground rope

def build_ceiling(C):
    c = MB("STATIC_ceiling", smooth_angle=50)
    yb = L.CEIL - 0.08
    # extra transverse beam over the stern + carlins between the transverse beams
    zb = -1.25
    half = math.sqrt(L.R ** 2 - (zb - L.ARC_CZ) ** 2) - 0.02
    c.box((2 * half, 0.16, 0.14), (0, yb, zb), "DarkWood", bevel=0.02, grain='x')
    for xx in (-2.0, -1.05, 1.05, 2.0):
        c.box((0.09, 0.11, 1.8), (xx, L.CEIL - 0.055, 1.45), "DarkWood", grain='z')
    # knees under the transverse beams at the side walls
    for z in (-0.35, 0.55, 1.45, 2.35):
        for sx in (-1, 1):
            c.box((0.09, 0.42, 0.1), (sx * (L.X_HALF - 0.16), L.CEIL - 0.3, z), "DarkWood", roll=sx * 45)
    # knees under the radial beams where they meet the stern wall
    for a in [-45] + L.WIN_EDGES + [45]:
        with c.frame(L.arc_pt(a, L.R - 0.02), yaw=-a):
            c.box((0.08, 0.4, 0.09), (0, L.CEIL - 0.3, 0.14), "DarkWood", pitch=45)
    # furled sail lashed under the stern beam (left of centre)
    x0, x1, ys = -1.7, -0.35, 2.56
    pts = [(x0 + (x1 - x0) * i / 14, ys - 0.03 * math.sin(math.pi * i / 14), zb + 0.01 * math.sin(i * 1.7)) for i in range(15)]

    def rr(t):
        end = min(1.0, math.sin(math.pi * t) * 3.0) ** 0.5
        return (0.085 + 0.007 * math.sin(t * math.pi * 11.0) + 0.012 * math.sin(t * math.pi * 3.0 + 1.0)) * (0.35 + 0.65 * end)

    tube(c, pts, rr, "Sailcloth", segs=10, tile=0.9)
    # pulley block (right, in front of the rack's window corner); its ropes are in `Rigging`
    px, pz = PULLEY
    c.box((0.05, 0.03, 0.05), (px, yb - 0.095, pz), "Iron", bevel=0.006)
    c.torus(0.022, 0.006, (px, yb - 0.13, pz), "Iron", seg=10, rseg=4, axis='z')
    # (physics round: the block itself hangs from the ring as the swing pivot `SWING_pulley`, see build_swings)
    # cleat on the face of the 30 deg window post (moved off the wall: the clock hangs there now)
    with c.frame(L.arc_pt(CLEAT_A, L.R - 0.085, CLEAT_Y), yaw=-CLEAT_A):
        c.box((0.04, 0.16, 0.03), (0, 0, 0.0), "Brass", bevel=0.008)
        c.cyl(0.008, 0.05, (0, 0, 0.03), "Brass", axis='z', segs=8)
        c.cyl(0.011, 0.17, (0, 0, 0.05), "Brass", segs=10, bevel=0.003)
    # second block on the left (rope bights in `Rigging`)
    c.box((0.05, 0.03, 0.05), (-0.4, L.CEIL - 0.19, -0.35 - 0.02), "Iron", bevel=0.006)
    # hanging lamp canopy + eye bolt (the lamp itself is the swingable `Hanging_lamp` group)
    from . import fix
    fix.lamp_static(c)
    return c.build(collection=C)


ROPE_FG = (-0.62, 0.0, 1.55)
PULLEY = (1.6, -1.25)
CLEAT_A, CLEAT_Y = 30.0, 2.36
SAIL_ZB = -1.25


def build_rope_fg(C):
    """Foreground rope: ceiling block (SWING_fg_block), standing part (ROPE_fg_main, skinned, pinned at the coil)
    straight down into a neat stacked coil on the floor (static, Rope_fg_mesh), plus a thinner rope with a
    stopper knot (ROPE_fg_tail, free end). Not lightmapped (smooth, normal-mapped strands)."""
    from .fix import rope, floor_coil, knot
    from . import phys
    grp = empty("Rope_fg", ROPE_FG, collection=C, size=0.1)
    r = MB("Rope_fg_mesh", smooth_angle=60)
    rr = 0.024
    # neat stacked coil on the floor; the standing part rises from the end of its top turn
    cc = (-0.58, 0.0, 1.62)
    R0, turns, shrink = 0.2, 3.0, 0.01
    aim = math.atan2(1.45 - cc[2], -0.74 - cc[0])          # top turn ends on the side of the old standing part
    yaw0 = math.degrees(aim) - 360 * turns - 25
    coil = floor_coil(r, cc, R=R0, turns=turns, r=rr, yaw=yaw0, sides=10, per_turn=14, shrink=shrink)
    e = Vector(coil[-1])
    tdir = (Vector(coil[-1]) - Vector(coil[-2]))
    tdir.y = 0
    tdir.normalize()
    base = e + tdir * 0.05
    top = (base.x, L.CEIL - 0.26, base.z)
    # ceiling plate + eye stay static; the block swings (SWING_fg_block)
    with r.frame(top):
        r.box((0.12, 0.03, 0.12), (0, 0.245, 0), "Iron", bevel=0.008)
        r.torus(0.012, 0.0035, (0, 0.222, 0), "Iron", seg=10, rseg=5, axis='z')
    piv = (top[0], top[1] + 0.21, top[2])
    sw = phys.swing_group(C, "fg_block", piv, length=0.16, mass=2.5)
    b = MB("Fg_block", smooth_angle=40)
    b.torus(0.011, 0.0033, (0, -0.012, 0), "Iron", seg=10, rseg=5, axis='x')
    b.cyl(0.006, 0.08, (0, -0.06, 0), "Iron", segs=8)
    b.box((0.09, 0.18, 0.11), (0, -0.15, 0), "DarkWood", bevel=0.025)
    b.cyl(0.04, 0.03, (0, -0.16, 0), "Brass", axis='z', segs=16)
    b.cyl(0.008, 0.124, (0, -0.16, 0), "Iron", axis='z', segs=8)
    phys.swing_child(C, sw, b)
    # standing part: from the block down into the coil (both ends fixed -> pinned_end)
    stand = [tuple(Vector(coil[-2])), tuple(e), tuple(e + tdir * 0.035 + Vector((0, 0.03, 0))),
             (base.x, e.y + 0.09, base.z), (base.x + 0.004, 0.45, base.z + 0.006),
             (base.x + 0.003, 1.6, base.z + 0.003), (top[0], top[1] - 0.03, top[2])]
    phys.skinned_rope(C, "fg_main", stand[::-1], rr, sides=10, pinned=True, nbones=12, step=0.02)
    # thinner rope alongside: from a ceiling ring, stopper knot at chest height, back-spliced end (free end)
    xt, zt = -0.86, 1.52

    def tail_extras(m):
        knot(m, (xt, 1.235, zt + 0.06), 0.016, sides=6)
        m.sphere(0.019, (xt - 0.004, 0.99, zt + 0.07), "Rope", segs=10, rings=6, sy=1.5)

    phys.skinned_rope(C, "fg_tail", [(xt, L.CEIL - 0.03, zt), (xt + 0.004, 2.0, zt + 0.03), (xt, 1.26, zt + 0.06),
                                      (xt + 0.003, 1.08, zt + 0.064), (xt - 0.004, 0.99, zt + 0.07)],
                      0.016, sides=8, pinned=False, nbones=10, step=0.03, extras=tail_extras)
    r.cyl(0.03, 0.03, (xt, L.CEIL - 0.015, zt), "Iron", segs=12, bevel=0.004)
    ob = r.build(origin=ROPE_FG, collection=C, parent=grp)
    return grp


def build_swings(C):
    """SWING_pulley: the pulley block on the right hangs from the ceiling ring (ring + plate stay in
    STATIC_ceiling)."""
    from . import phys
    px, pz = PULLEY
    yb = L.CEIL - 0.08
    ring_y = yb - 0.13
    piv = (px, ring_y - 0.016, pz)
    sw = phys.swing_group(C, "pulley", piv, length=0.2, mass=3.0)
    k = MB("Pulley_block", smooth_angle=40)
    k.torus(0.012, 0.0045, (0, -0.006, 0), "Iron", seg=10, rseg=5, axis='x')     # link through the ring
    k.cyl(0.0065, 0.1, (0, -0.065, 0), "Iron", segs=8)                           # shank
    with k.frame((0, 2.56 - piv[1], 0)):
        k.box((0.07, 0.17, 0.09), (0, 0, 0), "DarkWood", bevel=0.025)
        k.cyl(0.045, 0.03, (0, -0.005, 0), "Brass", axis='z', segs=14, bevel=0.004)
        k.cyl(0.012, 0.1, (0, -0.005, 0), "Iron", axis='z', segs=8)
        k.box((0.076, 0.02, 0.096), (0, 0.06, 0), "Iron", bevel=0.004)
        k.box((0.076, 0.02, 0.096), (0, -0.07, 0), "Iron", bevel=0.004)
    phys.swing_child(C, sw, k)
    return sw


def build_rigging(C):
    """Every other rope in the cabin, one non-lightmapped mesh `Rigging` (smooth round sections,
    3-strand texture + normal map, catenary sag on spans)."""
    from .fix import rope, floor_coil, hanging_coil, knot, seizing
    g = MB("Rigging", smooth_angle=60)
    yb = L.CEIL - 0.08
    zb = SAIL_ZB
    # sail lashings: loops around the furled sail, two legs up to the stern beam each
    x0, x1, ys = -1.7, -0.35, 2.56

    def sail_r(t):
        end = min(1.0, math.sin(math.pi * t) * 3.0) ** 0.5
        return (0.085 + 0.007 * math.sin(t * math.pi * 11.0) + 0.012 * math.sin(t * math.pi * 3.0 + 1.0)) * (0.35 + 0.65 * end)

    for xl in (-1.5, -1.0, -0.55):
        k = (xl - x0) / (x1 - x0)
        yc = ys - 0.03 * math.sin(math.pi * k)
        r0 = sail_r(k) + 0.008
        loop = [(xl + 0.004 * math.sin(3 * t), yc + r0 * math.cos(t), zb + r0 * math.sin(t))
                for t in [2 * math.pi * i / 8 for i in range(8)]]
        rope(g, loop, 0.008, sides=6, closed=True, spline=False)
        for dz in (-0.05, 0.05):
            rope(g, [(xl, yc + r0 * 0.8, zb + dz), (xl, yb - 0.08, zb + dz * 0.6)], 0.008, sides=6, spline=False)
    # pulley falls (skinned, swing): one hangs free to a stopper knot, the other runs (with sag) to the cleat
    from . import phys
    px, pz = PULLEY

    def fall_extras(m):
        m.sphere(0.019, (px - 0.04, 2.015, pz + 0.01), "Rope", segs=10, rings=6, sy=1.2)
        m.sphere(0.0135, (px - 0.041, 1.925, pz + 0.011), "Rope", segs=8, rings=5, sy=1.3)

    phys.skinned_rope(C, "pulley_fall", [(px - 0.045, 2.55, pz), (px - 0.043, 2.3, pz + 0.006), (px - 0.04, 2.03, pz + 0.01),
                                         (px - 0.041, 1.93, pz + 0.011)], 0.011, sides=8, nbones=6, step=0.03,
                      extras=fall_extras)
    cleat = L.arc_pt(CLEAT_A, L.R - 0.085 - 0.05, CLEAT_Y)
    span = catenary((px + 0.045, 2.53, pz), (cleat[0], cleat[1] + 0.02, cleat[2]), 0.08, 14)
    phys.skinned_rope(C, "pulley_span", span, 0.0095, sides=8, pinned=True, nbones=10, spline=False)
    # tail: a few turns round the cleat horn (static) then a short hanging end (skinned)
    cm = mat3(L.arc_pt(CLEAT_A, L.R - 0.085, CLEAT_Y), yaw=-CLEAT_A)
    wraps = []
    for j in range(15 + 1):
        a = 2 * math.pi * j / 10
        wraps.append(world_point(cm, (0.02 * math.cos(a), 0.035 - 0.07 * j / 15, 0.05 + 0.02 * math.sin(a))))
    rope(g, wraps, 0.0085, sides=6, spline=False)
    phys.skinned_rope(C, "cleat_tail", [world_point(cm, (0.02, -0.04, 0.05)), world_point(cm, (0.022, -0.12, 0.058)),
                                        world_point(cm, (0.012, -0.24, 0.05))], 0.0095, sides=8, nbones=6, step=0.02,
                      extras=lambda m: m.sphere(0.012, world_point(cm, (0.012, -0.243, 0.05)), "Rope", segs=8, rings=5, sy=1.3))
    # rope bights sagging between the left block and the stern beam (tied at both ends)
    phys.skinned_rope(C, "bight_a", catenary((-0.4, L.CEIL - 0.2, -0.38), (-0.4, L.CEIL - 0.18, zb + 0.08), 0.32, 16),
                      0.01, sides=8, pinned=True, nbones=8, spline=False)
    phys.skinned_rope(C, "bight_b", catenary((-0.25, L.CEIL - 0.2, -0.36), (-0.12, L.CEIL - 0.18, zb + 0.08), 0.22, 16),
                      0.008, sides=8, pinned=True, nbones=8, spline=False)
    # left wall: belaying-pin rail with three neatly hanked coils (static; replaces the old rope + hanging coil)
    phys.hanks(g)
    # (the two floor coils in the front-left corner are gone: no viewpoint sees that corner)
    ob = g.build(collection=C)
    return ob


# ----------------------------------------------------------------- nodes

def static_props(p):
    """Static decoration that belongs to STATIC_props (called from cabin.build_props before p.build)."""
    portrait_frame_static(p)
    bell_bracket(p)
    from . import phys
    phys.pin_rail_static(p)


def build(C):
    from .cabin import vp, hit
    build_letter(C)
    build_portrait(C)
    build_bottle(C)
    build_tengwar(C)
    build_slate(C)
    build_bell(C)
    build_ceiling(C)
    build_rope_fg(C)
    build_rigging(C)
    build_swings(C)

    # viewpoints
    rf = rack_frame()
    canvas_c = _pos(portrait_canvas_m())
    vp(C, "VP_portrait", world_point(rf, (0.0, 1.98, 1.08)), canvas_c)
    lm = letter_m()
    d = 0.27
    vp(C, "VP_letter", world_point(lm, (0.0, 0.004 + d * math.sin(math.radians(62)), d * math.cos(math.radians(62)))),
       world_point(lm, (0.0, 0.0, 0.004)))

    # hit boxes
    ly = _ypr(lm)[0]
    hit(C, "HIT_letter", world_point(lm, (0, 0.035, 0)), (LETTER_W + 0.03, 0.075, LETTER_D + 0.03), yaw=ly)
    pm = portrait_canvas_m()
    py_, pp, _ = _ypr(pm)
    hit(C, "HIT_portrait", world_point(pm, (0, 0.0, 0.02)), (CANVAS_W + 2 * FRAME_BAR + 0.02, CANVAS_H + 2 * FRAME_BAR + 0.04, 0.07),
        yaw=py_, pitch=pp)
    bm_ = bottle_m()
    hit(C, "HIT_bottle", world_point(bm_, (0.02, 0.0, 0.0)), (0.3, 0.1, 0.1), yaw=_ypr(bm_)[0])
    tm = tengwar_m()
    hit(C, "HIT_tengwar", world_point(tm, (0, 0, 0.01)), (TENG_W + 0.03, TENG_H + 0.03, 0.04), yaw=_ypr(tm)[0])
    sm = slate_m()
    sy_, sp, _ = _ypr(sm)
    hit(C, "HIT_slate", world_point(sm, (0, 0, 0.005)), (SLATE_W + 2 * SLATE_BAR + 0.02, SLATE_H + 2 * SLATE_BAR + 0.02, 0.05),
        yaw=sy_, pitch=sp)
    bl = bell_m()
    hit(C, "HIT_bell", world_point(bl, (0, -0.215, 0)), (0.19, 0.45, 0.19), yaw=_ypr(bl)[0])
