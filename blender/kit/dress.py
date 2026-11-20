"""Dressing round: fuller bookshelves and props for the bare right side (all static, lightmapped via STATIC_props /
STATIC_chest). Authored in three.js coordinates like the rest of the kit."""
import math
import random
import bmesh
from . import layout as L
from .util import mat3

BOOK_MATS = ["BookRed", "BookBlue", "BookGreen", "BookOchre", "BookPlum", "BookTeal", "Leather"]

# telescope on a tripod in front of the 18..30 deg window pane (clear of the wheel and of the bottle on the sill)
SCOPE_A, SCOPE_R = 20.5, 2.95
# rack frame (see cabin.rack_frame): the sea chest sits at local z 0.35, lid top at y 0.46
CHEST_LID_Y = 0.46


def deco_books(c, x0, x1, y, z, hmin, hmax, seed):
    """A run of books standing on a shelf between x0 and x1 (chest frame). Varied colours and heights, gilt bands,
    paper spine labels, and now and then a book leaning on its neighbour."""
    rnd = random.Random(seed)
    x = x0
    last = None
    while True:
        t = rnd.uniform(0.022, 0.05)
        if x + t > x1:
            break
        h = rnd.uniform(hmin, hmax)
        d = rnd.uniform(0.15, 0.19)
        mt = rnd.choice([m for m in BOOK_MATS if m != last])
        last = mt
        zc = z - (0.19 - d) / 2
        lean = 0.0
        if rnd.random() < 0.12 and x + t + 0.05 < x1:
            lean = -rnd.uniform(7, 11)
        with c.frame((x + t / 2, y, zc), roll=lean):
            c.box((t, h, d), (0, h / 2, 0), mt, bevel=0.003)
            c.box((t * 0.84, h * 0.97, d * 0.96), (0, h / 2 + 0.002, -0.004), "Paper")
            zf = d / 2 + 0.0009
            bands = [(0.028, 0.006), (h - 0.028, 0.006)]
            style = rnd.random()
            if style < 0.45:
                bands += [(h * 0.33, 0.004), (h * 0.66, 0.004)]
            for by, bh in bands:
                xa, xb = -t * 0.47, t * 0.47
                c.quad([(xa, by - bh, zf), (xb, by - bh, zf), (xb, by + bh, zf), (xa, by + bh, zf)], "Brass",
                       uvs=((0, 0), (0.3, 0), (0.3, 0.05), (0, 0.05)))
            if 0.45 <= style < 0.8 and t > 0.03:
                ya, yb = h * 0.58, h * 0.8
                xa, xb = -t * 0.36, t * 0.36
                c.quad([(xa, ya, zf), (xb, ya, zf), (xb, yb, zf), (xa, yb, zf)], "Paper")
        x += t + rnd.uniform(0.0, 0.004) + (0.035 if lean else 0.0)


def bookend(c, x, y, z):
    """Small brass anchor-ish bookend."""
    c.box((0.012, 0.11, 0.1), (x, y + 0.055, z), "Brass", bevel=0.004)
    c.box((0.06, 0.012, 0.1), (x + 0.024, y + 0.006, z), "Brass", bevel=0.004)
    c.sphere(0.022, (x + 0.02, y + 0.075, z), "Brass", segs=8, rings=5)


def hourglass(c, x, y, z):
    for yy in (0.0, 0.15):
        c.cyl(0.04, 0.012, (x, y + yy + 0.006, z), "Mahogany", segs=10, bevel=0.003)
    c.cyl(0.03, 0.065, (x, y + 0.045, z), "Glass", segs=10, r2=0.006)
    c.cyl(0.006, 0.065, (x, y + 0.117, z), "Glass", segs=10, r2=0.03)
    c.cyl(0.024, 0.02, (x, y + 0.024, z), "Parchment", segs=8, r2=0.012)
    for a in (0, 120, 240):
        ar = math.radians(a)
        c.cyl(0.004, 0.14, (x + 0.034 * math.cos(ar), y + 0.081, z + 0.034 * math.sin(ar)), "Brass", segs=5)


def shelf_dressing(c, hzc):
    """Extra objects on the bookshelf (chest frame; shelf tops at y 1.29, 1.69, 1.99)."""
    hourglass(c, 0.4, 1.99, hzc + 0.02)
    bookend(c, 0.125, 1.29, hzc + 0.02)


def globe(p, pos, r=0.14):
    x, y, z = pos
    p.cyl(0.09, 0.02, (x, y + 0.01, z), "Mahogany", segs=14, bevel=0.005)
    p.cyl(0.018, 0.07, (x, y + 0.055, z), "Mahogany", segs=8)
    cy = y + 0.09 + r
    with p.frame((x, cy, z), roll=23.5):
        p.sphere(r, (0, 0, 0), "SkyMapGlobe", segs=18, rings=12)
        p.torus(r + 0.012, 0.007, (0, 0, 0), "Brass", seg=28, rseg=6, axis='z', arc=200, a0=-100)
        for sy in (-1, 1):
            p.cyl(0.008, 0.03, (0, sy * (r + 0.01), 0), "Brass", segs=6)
    p.torus(0.035, 0.008, (x, y + 0.09, z), "Brass", seg=12, rseg=6, axis='y')


def chart_basket(p, pos):
    x, y, z = pos
    p.cyl(0.15, 0.42, (x, y + 0.21, z), "Leather", segs=14, r2=0.17)
    for yy in (0.03, 0.39):
        p.cyl(0.165 if yy < 0.1 else 0.178, 0.03, (x, y + yy, z), "Brass", segs=14)
    rolls = [(-0.05, 0.03, 0.62, 8, 5), (0.06, -0.04, 0.7, -10, 9), (0.02, 0.07, 0.55, 5, -12), (-0.07, -0.05, 0.66, -6, -7)]
    for dx, dz, ln, pt, rl in rolls:
        with p.frame((x + dx, y + 0.08, z + dz), pitch=pt, roll=rl):
            p.cyl(0.028, ln, (0, ln / 2, 0), "Parchment", segs=10)
            p.cyl(0.011, ln + 0.03, (0, ln / 2, 0), "Mahogany", segs=6)
            p.cyl(0.0295, 0.02, (0, ln * 0.55, 0), "Cloth", segs=10)


def telescope(p):
    bx, _, bz = L.arc_pt(SCOPE_A, SCOPE_R)
    H = 1.22
    with p.frame((bx, 0, bz), yaw=-SCOPE_A):
        for a in (90, 210, 330):
            ar = math.radians(a)
            fx, fz = 0.36 * math.cos(ar), 0.36 * math.sin(ar)
            ln = math.hypot(H, 0.36)
            tilt = math.degrees(math.atan2(0.36, H))
            with p.frame((0, H, 0), yaw=-a):
                with p.frame((0, 0, 0), roll=-tilt):
                    p.cyl(0.017, ln, (0, -ln / 2, 0), "Mahogany", segs=8, r2=0.022)
                    p.cyl(0.024, 0.04, (0, -ln + 0.02, 0), "Brass", segs=8)
                    p.cyl(0.026, 0.03, (0, -ln * 0.45, 0), "Brass", segs=8)
        p.cyl(0.05, 0.05, (0, H, 0), "Brass", segs=12, bevel=0.006)
        p.cyl(0.02, 0.1, (0, H + 0.07, 0), "Brass", segs=8)
        # tube: eyepiece toward the room (+Z), objective up and out of the window (-Z)
        with p.frame((0, H + 0.14, 0), pitch=-16):
            p.cyl(0.045, 0.52, (0, 0, -0.1), "Leather", axis='z', segs=14)
            p.cyl(0.036, 0.3, (0, 0, 0.28), "Brass", axis='z', segs=14)
            p.cyl(0.026, 0.16, (0, 0, 0.48), "Brass", axis='z', segs=12)
            p.cyl(0.034, 0.03, (0, 0, 0.565), "Brass", axis='z', segs=12, bevel=0.004)
            for zz in (-0.36, 0.15):
                p.cyl(0.052, 0.035, (0, 0, zz), "Brass", axis='z', segs=14, bevel=0.004)
            p.cyl(0.05, 0.02, (0, 0, -0.37), "Glass", axis='z', segs=14)
            p.box((0.03, 0.05, 0.06), (0, -0.05, 0), "Brass", bevel=0.006)


# ----------------------------------------------------------------- keepsakes on the right wall
# Peg board with a hat shelf between the two forward posts (wall bay z -0.82..0.22). Frame: origin on the wall at the
# board centre, local +X = world +Z (toward the stern / the visitor), local +Z = into the room.
#   left  : Deniz Harp Okulu cadet white dress tunic on a hanger, class-I shoulder boards (Roman "I" + fouled anchor)
#   shelf : the cadet's peaked cap
#   right : sage-green pilot's flight jacket; its squadron patch is the separate node Jacket_patch / Patch_filo
KEEP_POS = (L.X_HALF - 0.005, 1.72, -0.3)
KEEP_YAW = -90
TUNIC_O = (-0.275, -0.14, 0.075)      # shoulder-top centre of the tunic (board frame)
JACKET_O = (0.25, -0.14, 0.085)
CAP_O = (-0.19, 0.07, 0.125)
CAP_YAW = 30
SUPER_E = 0.75
SLEEVE_J = (0.205, 0.058, 0.060, 0.012)    # jacket sleeve at patch height: centre x, rx, rz, centre z
PATCH_D = 0.09
PATCH_Y = -0.165                      # patch centre below the jacket's shoulder line


def _sz(x, rx, rz, e=SUPER_E):
    """Front surface depth of the super-ellipse cross-section (rx, rz) at lateral offset x."""
    c = min(1.0, abs(x) / rx) ** (1.0 / e)
    return rz * max(0.0, 1.0 - c * c) ** (e / 2.0)


def _loft(p, rings, mat, n=12, e=SUPER_E, caps=(True, True)):
    """Skin horizontal super-ellipse rings (cx, cy, cz, rx, rz), listed top to bottom."""
    tb = bmesh.new()
    vr = []
    for (cx, cy, cz, rx, rz) in rings:
        ring = []
        for k in range(n):
            a = 2 * math.pi * (k + 0.5) / n
            ca, sa = math.cos(a), math.sin(a)
            ring.append(tb.verts.new((cx + rx * math.copysign(abs(ca) ** e, ca), cy,
                                      cz + rz * math.copysign(abs(sa) ** e, sa))))
        vr.append(ring)
    for r0, r1 in zip(vr, vr[1:]):
        for k in range(n):
            tb.faces.new((r0[k], r0[(k + 1) % n], r1[(k + 1) % n], r1[k]))
    if caps[0]:
        tb.faces.new(vr[0])
    if caps[1]:
        tb.faces.new(vr[-1][::-1])
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    p.raw(tb, mat)


def _sweep(p, prof, a0, a1, n, mat):
    """Sweep a closed (r, y) section around the Y axis from angle a0 to a1 (deg, 0 = +Z, 90 = +X). prof(a) -> pts."""
    tb = bmesh.new()
    secs = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        secs.append([tb.verts.new((r * math.sin(a), y, r * math.cos(a))) for (r, y) in prof(math.degrees(a))])
    m = len(secs[0])
    for s0, s1 in zip(secs, secs[1:]):
        for j in range(m):
            tb.faces.new((s0[j], s0[(j + 1) % m], s1[(j + 1) % m], s1[j]))
    tb.faces.new(secs[0])
    tb.faces.new(secs[-1][::-1])
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    p.raw(tb, mat)


def _plate(p, pts, t, mat, z0=0.0):
    """Flat emblem piece: polygon fan (pts around the centroid) in XY, thickness t toward +Z."""
    tb = bmesh.new()
    cx = sum(q[0] for q in pts) / len(pts)
    cy = sum(q[1] for q in pts) / len(pts)
    c = tb.verts.new((cx, cy, z0 + t))
    top = [tb.verts.new((x, y, z0 + t)) for x, y in pts]
    bot = [tb.verts.new((x, y, z0)) for x, y in pts]
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        tb.faces.new((c, top[i], top[j]))
        tb.faces.new((top[i], bot[i], bot[j], top[j]))
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    p.raw(tb, mat, smooth=False)


def _star(p, r, c, mat, t, z0=0.0, rot=90.0):
    pts = []
    for i in range(10):
        a = math.radians(rot + 36 * i)
        rr = r if i % 2 == 0 else r * 0.42
        pts.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)))
    _plate(p, pts, t, mat, z0)


def _crescent(p, R, c, mat, t, z0=0.0, n=10):
    """Crescent opening toward +X (as on the flag): outer circle R, inner circle 0.8 R shifted 0.28 R."""
    ri, d = 0.8 * R, 0.28 * R
    xi = (R * R - ri * ri + d * d) / (2 * d)
    ah, bh = math.acos(xi / R), math.acos((xi - d) / ri)
    tb = bmesh.new()
    rows = []
    for i in range(n + 1):
        a = ah + (2 * math.pi - 2 * ah) * i / n
        b = bh + (2 * math.pi - 2 * bh) * i / n
        o = (c[0] + R * math.cos(a), c[1] + R * math.sin(a))
        q = (c[0] + d + ri * math.cos(b), c[1] + ri * math.sin(b))
        rows.append((tb.verts.new((o[0], o[1], z0 + t)), tb.verts.new((q[0], q[1], z0 + t)),
                     tb.verts.new((o[0], o[1], z0)), tb.verts.new((q[0], q[1], z0))))
    for r0, r1 in zip(rows, rows[1:]):
        tb.faces.new((r0[0], r1[0], r1[1], r0[1]))
        tb.faces.new((r0[0], r0[2], r1[2], r1[0]))
        tb.faces.new((r0[1], r1[1], r1[3], r0[3]))
    bmesh.ops.remove_doubles(tb, verts=tb.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    p.raw(tb, mat, smooth=False)


def fouled_anchor(p, h, mat, t, rope=0.026):
    """Fouled anchor in the XY plane facing +Z, centred on the origin, total height h: ring, stock, shank, curved
    arms with flukes, and a rope wound across the shank."""
    from .polish import tube
    w = 0.105 * h
    p.torus(0.07 * h, 0.03 * h, (0, 0.40 * h, t * 0.5), mat, seg=8, rseg=4)
    p.box((0.44 * h, 0.075 * h, t), (0, 0.255 * h, t / 2), mat)
    for sx in (-1, 1):
        p.box((0.075 * h, 0.12 * h, t), (sx * 0.22 * h, 0.255 * h, t / 2), mat)
    p.box((w, 0.78 * h, t), (0, -0.06 * h, t / 2), mat)
    Ra = 0.36 * h
    cy = -0.47 * h + Ra
    p.torus(Ra, 0.05 * h, (0, cy, t * 0.5), mat, seg=8, rseg=4, arc=130, a0=205)
    for sx in (-1, 1):
        ex, ey = sx * Ra * math.cos(math.radians(25)), cy - Ra * math.sin(math.radians(25))
        _plate(p, [(ex + sx * 0.03 * h, ey + 0.19 * h), (ex + sx * 0.10 * h, ey - 0.03 * h),
                   (ex - sx * 0.11 * h, ey + 0.01 * h)][::sx], t, mat)
    # crown point under the shank
    _plate(p, [(-0.07 * h, -0.45 * h), (0, -0.53 * h), (0.07 * h, -0.45 * h)], t, mat)
    path = [(0.07, 0.42), (-0.05, 0.33), (-0.17, 0.16), (0.0, 0.07), (0.17, -0.02), (0.0, -0.12), (-0.17, -0.2),
            (-0.03, -0.3), (0.2, -0.34)]
    tube(p, [(x * h, y * h, t * 1.15) for x, y in path], rope * h, mat, segs=4, cap=True)


def roman_one(p, h, mat, t):
    """Class mark: a single upright bar with serifs."""
    p.box((0.27 * h, h, t), (0, 0, t / 2), mat)
    for sy in (-1, 1):
        p.box((0.68 * h, 0.2 * h, t), (0, sy * 0.4 * h, t / 2), mat)


BOARD_L, BOARD_W, BOARD_T, BOARD_R = 0.14, 0.066, 0.007, 0.22


def shoulder_board(p):
    """Black cadet shoulder board in its own frame: +Y toward the collar, +Z = top face. Slightly curved along its
    length. From the collar end: small gold button, Roman "I", fouled anchor."""
    def zb(y):
        return -y * y / (2 * BOARD_R)

    tb = bmesh.new()
    rows = []
    ys = [-BOARD_L / 2 + BOARD_L * i / 6 for i in range(7)]
    ys.insert(6, BOARD_L / 2 - 0.016)
    for i, y in enumerate(ys):
        hw = BOARD_W / 2 * (0.42 if i == len(ys) - 1 else 1.0)
        rows.append([tb.verts.new((sx * hw, y, zb(y) + zz)) for sx, zz in
                     ((-1, 0), (1, 0), (1, BOARD_T), (-1, BOARD_T))])
    for r0, r1 in zip(rows, rows[1:]):
        for j in range(4):
            tb.faces.new((r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]))
    tb.faces.new(rows[0])
    tb.faces.new(rows[-1][::-1])
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    p.raw(tb, "BoardBlack", smooth=False)

    def at(y):
        return p.frame((0, y, zb(y) + BOARD_T), pitch=math.degrees(math.atan(-y / BOARD_R)))

    with at(0.05):
        p.cyl(0.009, 0.005, (0, 0, 0.0025), "BrightGold", segs=8, r2=0.006, axis='z')
    with at(0.017):
        roman_one(p, 0.032, "PaleGold", 0.003)
    with at(-0.036):
        fouled_anchor(p, 0.05, "PaleGold", 0.003, rope=0.02)


def hanger_hook(p, peg_y, mat="Brass"):
    """Wire hook from a garment's neck (origin) up and over the peg at height peg_y."""
    from .polish import tube
    pts = [(0, 0.0, 0.0), (0, peg_y - 0.035, 0.0)]
    for a in (-60, -20, 20, 60, 100, 140, 180, 215):
        ar = math.radians(a)
        pts.append((0.024 * math.cos(ar), peg_y + 0.024 * math.sin(ar), 0.0))
    tube(p, pts, 0.0045, mat, segs=5)


def cadet_tunic(p, peg_y):
    """White stand-collar dress tunic, five gold buttons, two flapped breast pockets, plain cuffs."""
    W, S, G = "TunicWhite", "TunicShade", "BrightGold"
    rz = 0.055
    _loft(p, [(0, 0.0, 0, 0.07, 0.04), (0, -0.012, 0, 0.135, 0.047), (0, -0.035, 0, 0.18, 0.052),
              (0, -0.08, 0, 0.185, rz), (0, -0.38, 0, 0.172, rz), (0, -0.70, 0, 0.19, rz)], W, n=14)
    # hem shadow line and the fly edge of the front
    p.box((0.003, 0.69, 0.002), (0.02, -0.355, rz + 0.0005), S)
    # stand collar, closed at the throat
    _loft(p, [(0, 0.055, 0, 0.06, 0.047), (0, -0.004, 0, 0.066, 0.051)], W, n=12, caps=(False, False))
    _loft(p, [(0, 0.05, 0, 0.052, 0.04), (0, 0.049, 0, 0.052, 0.04)], S, n=12)
    _loft(p, [(0, 0.055, 0, 0.06, 0.047), (0, 0.05, 0, 0.052, 0.04)], W, n=12, caps=(False, False))
    p.box((0.004, 0.056, 0.003), (0, 0.026, 0.0505), S)
    # wooden hanger: neck block inside the collar + brass hook to the peg
    p.box((0.06, 0.03, 0.022), (0, 0.045, 0), "Planks", bevel=0.006)
    with p.frame((0, 0.05, 0)):
        hanger_hook(p, peg_y - 0.05)
    # sleeves hang straight, just in front of the side seams
    for sx in (-1, 1):
        _loft(p, [(sx * 0.176, -0.022, 0.004, 0.028, 0.034), (sx * 0.185, -0.055, 0.006, 0.045, 0.048),
                  (sx * 0.192, -0.32, 0.008, 0.045, 0.046), (sx * 0.195, -0.615, 0.008, 0.042, 0.042)], W, n=10)
        p.box((0.07, 0.003, 0.002), (sx * 0.195, -0.545, 0.008 + 0.0425), S)
    # five gold buttons
    for i in range(5):
        p.cyl(0.0125, 0.007, (0, -0.075 - i * 0.135, rz + 0.0035), G, segs=10, r2=0.008, axis='z')
    # breast pockets with pointed flaps and a small button
    for sx in (-1, 1):
        with p.frame((sx * 0.1, -0.2, rz - 0.004)):
            p.box((0.103, 0.118, 0.002), (0, -0.05, 0.001), S)
            p.box((0.096, 0.112, 0.004), (0, -0.05, 0.002), W)
            _plate(p, [(-0.054, 0.012), (-0.054, -0.024), (0, -0.04), (0.054, -0.024), (0.054, 0.012)], 0.005, S)
            _plate(p, [(-0.05, 0.012), (-0.05, -0.021), (0, -0.035), (0.05, -0.021), (0.05, 0.012)], 0.007, W)
            p.cyl(0.007, 0.004, (0, -0.02, 0.009), G, segs=8, r2=0.0045, axis='z')
    # shoulder boards: on the front slope of each shoulder, collar end up, tilted so the face shows from the room
    for sx in (-1, 1):
        with p.frame((sx * 0.14, -0.02, 0.05), pitch=-45, roll=sx * 80):
            shoulder_board(p)


def cadet_cap(p):
    """Peaked cap standing on the shelf: white cover wider than the black band, gold chin strap over a glossy
    black visor, badge on a black backing: gold fouled anchor under a small crescent and star."""
    R = 0.09
    p.cyl(R, 0.044, (0, 0.022, 0), "BoardBlack", segs=18)
    with p.frame((0, 0.04, 0), pitch=-5):
        p.cyl(R + 0.002, 0.05, (0, 0.023, 0), "TunicWhite", segs=18, r2=0.126)
        p.cyl(0.126, 0.014, (0, 0.055, 0), "TunicWhite", segs=18, r2=0.117)
        p.cyl(0.117, 0.004, (0, 0.064, 0), "TunicWhite", segs=18, r2=0.09)

    def visor(a):
        k = max(0.0, math.cos(math.radians(a) * 90 / 66)) ** 0.7
        ro = R + 0.058 * k
        return [(R - 0.004, 0.006), (ro, 0.006 - 0.45 * (ro - R)), (ro, 0.011 - 0.45 * (ro - R)), (R - 0.004, 0.012)]
    _sweep(p, visor, -66, 66, 12, "CapVisor")
    _sweep(p, lambda a: [(R - 0.002, 0.013), (R + 0.0045, 0.013), (R + 0.0045, 0.026), (R - 0.002, 0.026)],
           -70, 70, 10, "BrightGold")
    for sa in (-70, 70):
        ar = math.radians(sa)
        p.sphere(0.0075, ((R + 0.004) * math.sin(ar), 0.0195, (R + 0.004) * math.cos(ar)), "BrightGold", segs=6, rings=4)
    # badge
    with p.frame((0, 0.054, R + 0.011), pitch=20):
        pts = [(0.029 * math.cos(math.radians(a)), 0.002 + 0.039 * math.sin(math.radians(a))) for a in range(0, 360, 30)]
        _plate(p, pts, 0.022, "BoardBlack", z0=-0.012)
        with p.frame((0, -0.012, 0.01)):
            fouled_anchor(p, 0.04, "BrightGold", 0.003)
        _crescent(p, 0.008, (-0.004, 0.024), "BrightGold", 0.003, z0=0.01)
        _star(p, 0.0046, (0.0075, 0.024), "BrightGold", 0.003, z0=0.01, rot=180)


def flight_jacket(p, peg_y):
    """Sage-green nylon pilot's jacket: short body, fold-down collar, front zip, slanted flap pockets, ribbed knit
    waistband and cuffs. The squadron patch on the upper sleeve is a separate node (build_patch)."""
    N, K, KH = "FlightNylon", "KnitRib", "KnitRibHi"
    _loft(p, [(0, 0.0, 0, 0.075, 0.05), (0, -0.012, 0, 0.15, 0.058), (0, -0.04, 0, 0.195, 0.068),
              (0, -0.12, 0, 0.2, 0.075), (0, -0.40, 0, 0.202, 0.077), (0, -0.455, 0, 0.196, 0.072),
              (0, -0.48, 0, 0.18, 0.064)], N, n=14)
    # knit waistband with ribs
    wr = (0.176, 0.061)
    _loft(p, [(0, -0.47, 0, 0.178, 0.062), (0, -0.55, 0, wr[0], wr[1])], K, n=14)
    for i in range(13):
        x = -0.162 + 0.027 * i
        p.box((0.011, 0.074, 0.004), (x, -0.513, _sz(x, *wr) + 0.0005), KH,
              yaw=math.degrees(math.atan2(_sz(x - 0.004, *wr) - _sz(x + 0.004, *wr), 0.008)))
    # collar: stand at the back, two points folded onto the chest; dark lining in the neck opening
    _loft(p, [(0, 0.04, -0.008, 0.07, 0.045), (0, -0.004, 0, 0.08, 0.056)], N, n=12, caps=(False, False))
    _loft(p, [(0, 0.03, -0.008, 0.06, 0.036), (0, 0.029, -0.008, 0.06, 0.036)], K, n=12)
    _loft(p, [(0, 0.04, -0.008, 0.07, 0.045), (0, 0.03, -0.008, 0.06, 0.036)], N, n=12, caps=(False, False))
    for sx in (-1, 1):
        with p.frame((0, 0, 0.058), pitch=-14):
            _plate(p, [(sx * 0.02, 0.03), (sx * 0.035, -0.075), (sx * 0.118, -0.04), (sx * 0.082, 0.03)][::sx],
                   0.004, K, z0=0.001)
            _plate(p, [(sx * 0.016, 0.034), (sx * 0.034, -0.068), (sx * 0.11, -0.036), (sx * 0.078, 0.034)][::sx],
                   0.011, N, z0=0.001)
    p.box((0.06, 0.03, 0.022), (0, 0.02, -0.005), "Planks", bevel=0.006)
    with p.frame((0, 0.03, -0.005)):
        hanger_hook(p, peg_y - 0.03)
    # zip
    p.box((0.02, 0.475, 0.003), (0, -0.2925, 0.0775), K)
    p.box((0.006, 0.475, 0.003), (0, -0.2925, 0.0795), "Brass")
    p.box((0.012, 0.03, 0.005), (0, -0.085, 0.0825), "Brass", bevel=0.002)
    # slanted flap pockets
    for sx in (-1, 1):
        with p.frame((sx * 0.105, -0.33, _sz(0.105, 0.202, 0.077) - 0.002), roll=sx * 20):
            p.box((0.136, 0.046, 0.003), (0, 0, 0.0015), K)
            p.box((0.128, 0.038, 0.007), (0, 0, 0.0035), N, bevel=0.002)
            p.cyl(0.006, 0.004, (0, -0.008, 0.008), K, segs=8, axis='z')
    # sleeves + knit cuffs
    cx, rx, rz, cz = SLEEVE_J
    for sx in (-1, 1):
        _loft(p, [(sx * 0.19, -0.02, cz - 0.004, 0.03, 0.04), (sx * 0.2, -0.06, cz, 0.056, rz),
                  (sx * cx, -0.3, cz, rx, rz), (sx * cx, -0.47, cz, 0.054, 0.054),
                  (sx * cx, -0.505, cz, 0.04, 0.042)], N, n=12)
        _loft(p, [(sx * cx, -0.495, cz, 0.037, 0.038), (sx * cx, -0.565, cz, 0.035, 0.036)], K, n=10)
        for i in range(4):
            x = -0.027 + 0.018 * i
            p.box((0.008, 0.062, 0.004), (sx * cx + x, -0.532, cz + _sz(x, 0.036, 0.037) + 0.0005), KH)


def keepsakes(p):
    """Right wall, between the two forward posts: peg board + hat shelf with the Naval Academy cadet tunic and cap
    and the pilot's flight jacket."""
    with p.frame(KEEP_POS, yaw=KEEP_YAW):
        p.box((1.0, 0.1, 0.03), (0, 0, 0.015), "Mahogany", bevel=0.01, grain='x')
        # hat shelf on top (stops short of the wall pipe at local x -0.39)
        p.box((0.85, 0.02, 0.19), (0.085, 0.06, 0.095), "Mahogany", bevel=0.006, grain='x')
        for sx in (-0.3, 0.47):
            p.prism([(0, 0), (0.15, 0), (0, -0.09)], 0.02, (sx, 0.05, 0.03), "Mahogany", yaw=-90)
        for sx in (TUNIC_O[0], JACKET_O[0]):
            p.cyl(0.011, 0.11, (sx, 0, 0.08), "Brass", axis='z', segs=8)
            p.sphere(0.018, (sx, 0, 0.14), "Brass", segs=8, rings=5)
        with p.frame(TUNIC_O):
            cadet_tunic(p, -TUNIC_O[1])
        with p.frame(JACKET_O):
            flight_jacket(p, -JACKET_O[1])
        with p.frame(CAP_O, yaw=CAP_YAW):
            cadet_cap(p)


def patch_m():
    """Jacket_patch frame: centre of the squadron patch on the jacket's upper sleeve, local +Z = out of the sleeve
    (into the room), +X to the viewer's right, +Y up."""
    cx, rx, rz, cz = SLEEVE_J
    return (mat3(KEEP_POS, yaw=KEEP_YAW) @ mat3(JACKET_O) @ mat3((cx, PATCH_Y, cz + rz + 0.003)))


def _patch_placeholder(m):
    """Neutral stand-in until the app draws the real art: navy ring, stitched gold border, grey centre."""
    import os
    import numpy as np
    import bpy
    from . import materials
    n = 128
    path = os.path.join(materials.TEX, "squadron_patch_placeholder.png")
    yy, xx = np.mgrid[0:n, 0:n]
    dx, dy = (xx + 0.5) / n - 0.5, (yy + 0.5) / n - 0.5
    r = np.hypot(dx, dy) * 2
    ang = np.arctan2(dy, dx)
    px = np.zeros((n, n, 4), np.float32)
    px[..., :3] = (0.07, 0.10, 0.22)
    px[r < 0.62, :3] = (0.5, 0.52, 0.55)
    gold = (r > 0.86) & (r < 0.97) & (np.sin(ang * 40) > -0.5)
    px[gold, :3] = (0.9, 0.72, 0.25)
    px[(r > 0.60) & (r < 0.65), :3] = (0.9, 0.72, 0.25)
    px[..., 3] = 1.0
    os.makedirs(materials.TEX, exist_ok=True)
    img = bpy.data.images.new("squadron_patch_placeholder", n, n, alpha=False)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    nt = m.node_tree
    if not nt.nodes.get("BaseTex"):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.name = "BaseTex"
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "UVMap"
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])


def build_patch(C):
    """Squadron patch (1. Filo) as its own node so the app can swap the art: empty `Jacket_patch` > mesh `Patch_filo`,
    a round disc 0.09 m across wrapped slightly round the sleeve, material `SquadronPatch`, UV 0..1 over the disc's
    bounding square (u to the viewer's right, v up)."""
    import bpy
    from .util import MB
    from .polish import group, child
    _patch_placeholder(bpy.data.materials["SquadronPatch"])
    grp = group(C, "Jacket_patch", patch_m())
    cx, rx, rz, cz = SLEEVE_J
    R = PATCH_D / 2
    tb = bmesh.new()
    uvl = tb.loops.layers.uv.new('UVMap')

    def v(x, y):
        return tb.verts.new((x, y, _sz(x, rx, rz) - rz))
    c = v(0, 0)
    seg = 24
    rings = [[v(rr * math.cos(2 * math.pi * i / seg), rr * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
             for rr in (R * 0.5, R)]
    for i in range(seg):
        j = (i + 1) % seg
        tb.faces.new((c, rings[0][i], rings[0][j]))
        tb.faces.new((rings[0][i], rings[1][i], rings[1][j], rings[0][j]))
    for f in tb.faces:
        for l in f.loops:
            l[uvl].uv = (l.vert.co.x / PATCH_D + 0.5, l.vert.co.y / PATCH_D + 0.5)
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    tb.faces.ensure_lookup_table()
    if tb.faces[0].normal.z < 0:
        bmesh.ops.reverse_faces(tb, faces=tb.faces)
    mb = MB("Patch_filo")
    mb.raw(tb, "SquadronPatch", uv=None)
    child(mb, grp, C)
    return grp


def sea_chest_dressing(p):
    """Things on and beside the sea chest under the logbook rack."""
    with p.frame(L.RACK_POS, yaw=L.RACK_YAW):
        globe(p, (-0.2, CHEST_LID_Y, 0.36))
        # a few books lying on the lid + a rolled chart
        hs = [0.04, 0.032, 0.036]
        for i, (h, mt) in enumerate(zip(hs, ["BookTeal", "BookOchre", "BookPlum"])):
            p.box((0.24 - i * 0.02, h, 0.18 - i * 0.012), (0.24, CHEST_LID_Y + sum(hs[:i]) + h / 2, 0.36), mt,
                  bevel=0.006, yaw=(i - 1) * 9)
        p.cyl(0.024, 0.3, (0.22, CHEST_LID_Y + sum(hs) + 0.024, 0.37), "Parchment", axis='x', segs=10, yaw=20)
        chart_basket(p, (0.66, 0.0, 0.3))


def static_dressing(p):
    telescope(p)
    keepsakes(p)
    sea_chest_dressing(p)
