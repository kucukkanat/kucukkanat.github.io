"""Fix round (2026-11-20): rope system, ship's bulkhead clock, swingable hanging lamp, ship's lantern,
bell chain. See docs/SCENE_CONTRACT.md "Fix round additions".

Authored in three.js coordinates like the rest of the kit."""
import math
import os
import bmesh
import bpy
import numpy as np
from mathutils import Vector, Matrix
from . import util, layout as L
from .util import MB, empty, mat3, world_point

TEX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tex")

# ----------------------------------------------------------------- placements (three.js)

# Clock: on the curved wall between the 30 deg window post and the logbook rack, beside the rack
CLOCK_A = 33.7
CLOCK_Y = 1.80
CLOCK_PLATE_D = 0.0625            # dial plane -> wall
CLOCK_R_DIAL = 0.099
CLOCK_R_CASE = 0.124              # outer bezel radius (diameter ~0.25 m)

# Hanging lamp: hangs from the -0.35 transverse beam
LAMP_X, LAMP_Z = 0.75, -0.35
LAMP_BEAM_Y = L.CEIL - 0.18       # beam underside
LAMP_PIVOT = (LAMP_X, LAMP_BEAM_Y - 0.03, LAMP_Z)

# Rope lay: one texture tile (= one full turn of a strand) every LAY_K * diameter
LAY_K = 3.4


def clock_m():
    return mat3(L.arc_pt(CLOCK_A, L.R - CLOCK_PLATE_D, CLOCK_Y), yaw=-CLOCK_A)


# ----------------------------------------------------------------- rope texture (procedural)

def _save_png(name, arr):
    """arr: HxWx3 float 0..1 (stored as-is, sRGB for colour / raw for data)."""
    os.makedirs(TEX, exist_ok=True)
    path = os.path.join(TEX, name)
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[:, :, :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return path


def rope_textures(size=256, nsize=128):
    """3-strand laid rope, tileable. u (s) = around the rope (one tile = full circumference, 3 strands),
    v (t) = along the rope (one tile = one lay length). Returns (colour path, normal path)."""
    col_p = os.path.join(TEX, f"rope_strands_{size}.png")
    nrm_p = os.path.join(TEX, f"rope_strands_n_{nsize}.png")
    if os.path.exists(col_p) and os.path.exists(nrm_p):
        return col_p, nrm_p
    n = size
    t, s = np.meshgrid(np.arange(n) / n, np.arange(n) / n, indexing='ij')   # rows = t (v), cols = s (u)
    phase = 3.0 * (s + t)                       # strands spiral: constant phase along the helix
    k = np.floor(phase) % 3
    p = phase - np.floor(phase)
    h = np.sqrt(np.clip(1.0 - (2.0 * p - 1.0) ** 2, 0.0, 1.0))      # round strand profile
    # yarns inside each strand twist the other way (integer frequencies keep it tileable)
    yarn = 0.5 + 0.5 * np.sin(2 * np.pi * (18 * s - 30 * t) + k * 1.7)
    fibre = 0.5 + 0.5 * np.sin(2 * np.pi * (75 * s - 120 * t))
    rng = np.random.default_rng(7)
    noise = rng.random((n, n)).astype(np.float32)
    noise = (noise + np.roll(noise, 1, 0) + np.roll(noise, 1, 1) + np.roll(noise, (1, 1), (0, 1))) / 4
    height = h * (0.82 + 0.12 * yarn + 0.06 * fibre)
    shade = 0.32 + 0.68 * h ** 0.7
    shade *= 0.86 + 0.1 * yarn + 0.06 * fibre + 0.08 * (noise - 0.5)
    shade *= 1.0 + 0.05 * (k - 1)               # slight strand-to-strand variation
    base = np.array([0.80, 0.66, 0.45], dtype=np.float32)   # hemp (sRGB)
    col = base[None, None, :] * shade[:, :, None]
    # pixel row 0 is the bottom of a Blender image (v = 0): our rows are t ascending -> fine
    _save_png(os.path.basename(col_p), col)
    # normal map (tangent space, +X = u, +Y = v)
    k_ = 2.2
    dhs = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5 * n / 24.0
    dht = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5 * n / 24.0
    nx, ny, nz = -dhs * k_, -dht * k_, np.ones_like(height)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    nrm = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5
    _save_png(os.path.basename(nrm_p), nrm[::size // nsize, ::size // nsize])
    return col_p, nrm_p


def setup_rope_material(m):
    """Replace the Rope material's texture with the procedural strand texture (+ normal map)."""
    col_p, nrm_p = rope_textures()
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.get("BaseTex")
    if not tex:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = "BaseTex"
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "UVMap"
        nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    tex.image = bpy.data.images.load(col_p, check_existing=True)
    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = bpy.data.images.load(nrm_p, check_existing=True)
    ntex.image.colorspace_settings.name = 'Non-Color'
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    nt.links.new(uvn.outputs["UV"], ntex.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.uv_map = "UVMap"
    nm.inputs["Strength"].default_value = 1.0
    nt.links.new(ntex.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])


# ----------------------------------------------------------------- rope geometry

def _catmull(pts, step):
    """Centripetal-ish Catmull-Rom through pts, sampled ~every `step` metres."""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        out = []
        a, b = P[0], P[-1]
        n = max(1, int(math.ceil((b - a).length / step)))
        return [a.lerp(b, i / n) for i in range(n + 1)]
    ext = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = [P[0]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        n = max(1, int(math.ceil((p2 - p1).length / step)))
        for j in range(1, n + 1):
            t = j / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return out


def _decimate(P, max_angle=10.0, max_len=0.6):
    """Drop samples on nearly straight runs (the texture carries the twist, not the geometry)."""
    if len(P) < 3:
        return P
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a = (P[i] - out[-1])
        b = (P[i + 1] - P[i])
        if a.length < 1e-6:
            continue
        ang = math.degrees(a.angle(b)) if b.length > 1e-6 else 0.0
        if ang > max_angle or (P[i + 1] - out[-1]).length > max_len:
            out.append(P[i])
    out.append(P[-1])
    return out


def rope(mb, pts, r, sides=12, mat="Rope", closed=False, spline=True, step=None, cap=True,
         local=None, max_angle=10.0, max_len=0.6):
    """Smooth round rope along a path. UV: u = around (0..1), v = length / lay -> 3 diagonal strands.
    closed: pts form a loop (do not repeat the first point)."""
    lay = LAY_K * 2 * r
    if spline:
        src = list(pts) + ([pts[0], pts[1], pts[2]] if closed else [])
        P = _catmull(src, step or max(0.6 * r, 0.006))
        if closed:
            # keep one period: from the 2nd control point back around to it
            seg = _catmull(list(pts) + [pts[0]], step or max(0.6 * r, 0.006))
            P = seg[:-1]
    else:
        P = [Vector(p) for p in pts]
    if not closed:
        P = _decimate(P, max_angle, max_len)
    else:
        P = _decimate(P + [P[0]], max_angle)[:-1] if spline else P
        P = P + [P[0]]
    n = len(P)
    tb = bmesh.new()
    uvl = tb.loops.layers.uv.new('UVMap')

    def tan(i):
        if closed:
            a = P[i - 1] if i > 0 else P[-2]
            b = P[i + 1] if i < n - 1 else P[1]
        else:
            a, b = P[max(i - 1, 0)], P[min(i + 1, n - 1)]
        return (b - a).normalized()

    tans = [tan(i) for i in range(n)]
    up = Vector((0, 1, 0)) if abs(tans[0].y) < 0.9 else Vector((1, 0, 0))
    nrm = (up - tans[0] * up.dot(tans[0])).normalized()
    frames, lens = [], []
    acc = 0.0
    for i in range(n):
        if i > 0:
            nrm = tans[i - 1].rotation_difference(tans[i]) @ nrm
            nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
            acc += (P[i] - P[i - 1]).length
        frames.append(nrm.copy())
        lens.append(acc)
    total = lens[-1] if lens[-1] > 0 else 1.0
    twist = 0.0
    vscale = 1.0 / lay
    if closed:
        # parallel-transport mismatch at the seam: distribute it along the loop
        b0 = tans[0].cross(frames[0])
        twist = math.atan2(frames[-1].dot(b0), frames[-1].dot(frames[0]))
        # whole number of lays around the loop so the texture closes seamlessly
        k = max(1, round(total / lay))
        vscale = k / total
    rings = []
    for i in range(n):
        t = tans[i]
        a0 = -twist * lens[i] / total if closed else 0.0
        nn = frames[i]
        bb = t.cross(nn)
        rad = r(i / (n - 1)) if callable(r) else r
        ring = []
        for j in range(sides + 1):
            a = 2 * math.pi * j / sides + a0
            ring.append(tb.verts.new(P[i] + rad * (math.cos(a) * nn + math.sin(a) * bb)))
        rings.append(ring)
    for i in range(n - 1):
        for j in range(sides):
            f = tb.faces.new((rings[i][j], rings[i][j + 1], rings[i + 1][j + 1], rings[i + 1][j]))
            uvs = ((j / sides, lens[i] * vscale), ((j + 1) / sides, lens[i] * vscale),
                   ((j + 1) / sides, lens[i + 1] * vscale), (j / sides, lens[i + 1] * vscale))
            for l, uv in zip(f.loops, uvs):
                l[uvl].uv = uv
    if cap and not closed:
        for ring, rev in ((rings[0], False), (rings[-1], True)):
            c = tb.verts.new(sum((v.co for v in ring[:sides]), Vector()) / sides)
            for j in range(sides):
                vs = (ring[j], ring[j + 1], c) if not rev else (ring[j + 1], ring[j], c)
                f = tb.faces.new(vs)
                for l in f.loops:
                    co = l.vert.co - c.co
                    l[uvl].uv = (0.5 + co.x * 8, 0.5 + co.z * 8)
    bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
    mb.raw(tb, mat, uv=None, smooth=True, local=local or Matrix.Identity(4))


def floor_coil(mb, centre, R=0.17, turns=3.5, r=0.022, yaw=0.0, sides=10, per_turn=20, shrink=0.012,
               lead=None):
    """Neat flat coil lying on the floor: a stacked helix (bottom turn widest). Returns the top end
    point + tangent so a standing part can continue from it. lead: optional list of points the rope
    continues through after leaving the top of the coil."""
    cx, cy, cz = centre
    pts = []
    N = int(turns * per_turn)
    for i in range(N + 1):
        u = i / per_turn
        a = math.radians(yaw) + 2 * math.pi * u
        rr = R - shrink * u
        y = cy + 0.95 * r + 1.8 * r * u
        pts.append((cx + rr * math.cos(a), y, cz + rr * math.sin(a)))
    if lead:
        pts = pts + [tuple(p) for p in lead]
        rope(mb, pts, r, sides=sides, spline=True, step=0.03)
    else:
        rope(mb, pts, r, sides=sides, spline=False)
    return pts


def hanging_coil(mb, top, n=4, length=0.42, width=0.32, r=0.012, yaw=0.0, sides=8, per_loop=14, seed=3):
    """Sailor's hanging coil: n loops hanging from `top`, gathered and seized with a few wraps."""
    import random
    rnd = random.Random(seed)
    m = mat3(top, yaw=yaw)
    for i in range(n):
        k = i - (n - 1) / 2
        ln = length * (1 + 0.05 * rnd.uniform(-1, 1) - 0.015 * abs(k))
        w = width * (1 + 0.08 * rnd.uniform(-1, 1))
        dz = k * r * 1.9
        tilt = rnd.uniform(-5, 5)
        pts = []
        for j in range(per_loop):
            th = 2 * math.pi * j / per_loop
            x = 0.5 * w * math.sin(th) * (1 - math.cos(th)) / 2
            y = -0.5 * ln * (1 - math.cos(th))
            z = dz + 0.015 * math.sin(th) * k / max(n, 1)
            p = mat3(roll=tilt) @ Vector((x, y, z))
            pts.append(world_point(m, tuple(p)))
        rope(mb, pts, r, sides=sides, closed=True, spline=False)
    # seizing: a few tight wraps around the gathered loops just under the peg
    seiz = []
    rx, rz = 0.026, n * r * 1.9 / 2 + r * 1.4
    for j in range(2 * 8 + 1):
        a = 2 * math.pi * j / 8
        seiz.append(world_point(m, (rx * math.cos(a), -0.035 - 0.018 * j / 16, rz * math.sin(a))))
    rope(mb, seiz, r * 0.9, sides=6, spline=False)


def knot(mb, p, r, axis=(0, -1, 0), sides=10):
    """Stopper knot (reads as an overhand/figure-eight lump): three tilted loops around the rope axis."""
    p = Vector(p)
    for i in range(3):
        a = 2 * math.pi * i / 3
        pts = []
        for j in range(8):
            th = 2 * math.pi * j / 8
            R = r * 1.25
            x = R * math.cos(th)
            z = R * math.sin(th)
            y = 0.9 * r * math.sin(th + a) + (i - 1) * r * 0.5
            v = Matrix.Rotation(a, 3, 'Y') @ Vector((x, y, z))
            pts.append(tuple(p + v))
        rope(mb, pts, r * 0.95, sides=sides, closed=True, spline=False)


def seizing(mb, p, r_rope, d=(0, 1, 0), turns=4, w=0.012):
    """Whipping on a (vertical) rope end: a thin twine band."""
    p = Vector(p)
    mb.cyl(r_rope + 0.0016, w, tuple(p + Vector(d).normalized() * (w / 2)), "Twine", segs=10, cap=False)
    mb.torus(r_rope + 0.0012, 0.0016, tuple(p + Vector(d).normalized() * w), "Twine", seg=10, rseg=3, axis='y')


# ----------------------------------------------------------------- clock

def _r(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# Roman capitals with thick/thin strokes and bracket-less serifs, cap height 1, centred on x = 0
GLYPHS = {
    "I": ([_r(-0.08, 0, 0.08, 1), _r(-0.2, 0, 0.2, 0.065), _r(-0.2, 0.935, 0.2, 1)], 0.4),
    "V": ([[(-0.07, 0), (0.05, 0), (-0.22, 1), (-0.39, 1)], [(-0.03, 0), (0.03, 0), (0.40, 1), (0.33, 1)],
           _r(-0.47, 0.935, -0.15, 1), _r(0.25, 0.935, 0.47, 1)], 0.92),
    "X": ([[(0.22, 0), (0.40, 0), (-0.2, 1), (-0.38, 1)], [(-0.37, 0), (-0.30, 0), (0.37, 1), (0.30, 1)],
           _r(-0.46, 0, -0.2, 0.065), _r(0.16, 0, 0.47, 0.065), _r(-0.46, 0.935, -0.13, 1), _r(0.22, 0.935, 0.45, 1)], 0.92),
}


def clock_static(p):
    """Case, bezel, screws, plaque (STATIC_props, lightmapped). Local +Z into the room, dial at z=0."""
    m = clock_m()
    from .polish import _ypr
    with p.frame(m.translation, *_ypr(m)):
        zb = -CLOCK_PLATE_D
        # wooden plaque with rounded corners
        W, H, Dp, rc = 0.27, 0.30, 0.018, 0.035
        pts = []
        for (cx, cy, a0) in ((W / 2 - rc, -H / 2 + rc, -90), (W / 2 - rc, H / 2 - rc, 0),
                             (-W / 2 + rc, H / 2 - rc, 90), (-W / 2 + rc, -H / 2 + rc, 180)):
            for k in range(5):
                a = math.radians(a0 + 90 * k / 4)
                pts.append((cx + rc * math.cos(a), cy + rc * math.sin(a)))
        p.prism(pts, Dp, center=(0, 0, zb + Dp / 2 + 0.001), mat="Mahogany", plane='xy', bevel=0.005, seg=2)
        # four small brass screws in the plaque corners
        for sx in (-1, 1):
            for sy in (-1, 1):
                p.sphere(0.0065, (sx * (W / 2 - 0.024), sy * (H / 2 - 0.024), zb + Dp + 0.001), "Brass", segs=6, rings=3, sy=0.5)
        # brass case + bevelled bezel (lathe around local Z)
        prof = [(0.0, zb + Dp - 0.002), (0.116, zb + Dp - 0.002), (0.118, zb + Dp + 0.004),
                (0.109, zb + Dp + 0.009), (0.109, -0.012),
                (0.121, -0.011), (CLOCK_R_CASE, -0.006), (CLOCK_R_CASE, 0.002), (0.121, 0.009),
                (0.113, 0.0145), (0.106, 0.016), (0.1015, 0.0135), (0.0995, 0.006), (0.0995, -0.001), (0.0, -0.002)]
        from .polish import lathe
        lathe(p, [(r_, z_) for (r_, z_) in prof], "Brass", segs=24, local=mat3(pitch=90))
        # six slotted screws on the bezel
        for i in range(6):
            a = math.radians(30 + 60 * i)
            x, y = 0.1105 * math.cos(a), 0.1105 * math.sin(a)
            p.sphere(0.0048, (x, y, 0.0135), "Brass", segs=6, rings=3, sy=0.55)
            p.box((0.0075, 0.0011, 0.0012), (x, y, 0.0162), "Iron", roll=math.degrees(a) + 45)
        # porthole hinge lug (left) and dog/latch knob (right)
        p.box((0.022, 0.03, 0.012), (-0.128, 0.0, -0.004), "Brass", bevel=0.004)
        p.cyl(0.005, 0.034, (-0.136, 0.0, -0.004), "Brass", segs=8)
        p.box((0.018, 0.016, 0.01), (0.127, 0.0, -0.004), "Brass", bevel=0.003)
        p.sphere(0.008, (0.137, 0.0, 0.0), "Brass", segs=10, rings=6)


def build_clock(C):
    from .polish import group, child, _ypr
    from .cabin import hit
    m = clock_m()
    grp = group(C, "Clock", m, size=0.06)
    # dial + numerals + chapter ring (not lightmapped; hands sit on it)
    f = MB("Clock_face", smooth_angle=0)
    f.cyl(CLOCK_R_DIAL + 0.0005, 0.004, (0, 0, -0.002), "ClockDial", axis='z', segs=36)
    zi = 0.0003

    def flat_quad(x0, x1, y0, y1, ang):
        ca, sa = math.cos(ang), math.sin(ang)
        cs = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        f.quad([(x * ca - y * sa, x * sa + y * ca, zi) for (x, y) in cs], "ClockInk")

    # minute track: 60 ticks + two thin rings
    for i in range(60):
        ang = -2 * math.pi * i / 60
        big = i % 5 == 0
        w = 0.0024 if big else 0.0009
        flat_quad(-w / 2, w / 2, 0.0905 if not big else 0.0855, 0.0955, ang)
    for rr, w in ((0.0958, 0.0009), (0.0845, 0.0006)):
        segs = 40
        for i in range(segs):
            a0, a1 = 2 * math.pi * i / segs, 2 * math.pi * (i + 1) / segs
            ri, ro = rr - w / 2, rr + w / 2
            f.quad([(ri * math.cos(a0), ri * math.sin(a0), zi), (ro * math.cos(a0), ro * math.sin(a0), zi),
                    (ro * math.cos(a1), ro * math.sin(a1), zi), (ri * math.cos(a1), ri * math.sin(a1), zi)], "ClockInk")
    # Roman numerals (serif strokes as flat quads), radial: tops toward the rim
    names = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"]
    rn, cap_h = 0.0715, 0.0118
    for h, txt in enumerate(names):
        th = 2 * math.pi * h / 12
        polys, x = [], 0.0
        for ch in txt:
            gl, adv = GLYPHS[ch]
            polys += [[(px_ + x + adv / 2, py_) for (px_, py_) in poly] for poly in gl]
            x += adv + 0.07
        x -= 0.07
        rot = Matrix.Rotation(-th, 3, 'Z')
        cen = Vector((rn * math.sin(th), rn * math.cos(th), 0))
        for poly in polys:
            vs = []
            for (px_, py_) in poly:
                v = rot @ Vector(((px_ - x / 2) * cap_h, (py_ - 0.5) * cap_h, 0)) + cen
                vs.append((v.x, v.y, zi + 0.0001))
            f.quad(vs, "ClockInk")
    child(f, grp, C)

    # hands: empties at the dial centre (rest = 12 o'clock = local +Y), meshes under them
    def hand(name, polys, z, mat, extra=None):
        e = empty(name, collection=C, size=0.02)
        e.parent = grp
        e.location = (0, 0, 0)
        mb = MB(name + "_mesh", smooth_angle=0)
        for poly in polys:
            mb.prism(poly, 0.0012, center=(0, 0, z), mat=mat, plane='xy', uv=None)
        if extra:
            extra(mb)
        ob = mb.build(origin=(0, 0, 0), collection=C)
        ob.parent = e
        ob.location = (0, 0, 0)
        return e

    def circle(cx, cy, r, n=14):
        return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]

    def rect(x0, x1, y0, y1):
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

    hour = [rect(-0.0024, 0.0024, -0.012, 0.034),
            [(0.0, 0.029), (0.0085, 0.040), (0.0, 0.054), (-0.0085, 0.040)],
            circle(0, 0, 0.0065)]
    minute = [rect(-0.0017, 0.0017, -0.016, 0.07),
              [(0.0, 0.066), (0.0042, 0.072), (0.0, 0.086), (-0.0042, 0.072)],
              circle(0, 0, 0.0052)]
    second = [rect(-0.0006, 0.0006, -0.02, 0.089), circle(0, -0.022, 0.0058, 12), circle(0, 0, 0.0032, 10)]

    def cap(mb):
        mb.sphere(0.0034, (0, 0, 0.0074), "Brass", segs=10, rings=5, sy=0.6)

    hand("Clock_hour", hour, 0.0016, "ClockHand")
    hand("Clock_minute", minute, 0.0034, "ClockHand")
    hand("Clock_second", second, 0.0052, "ClockRed", extra=cap)
    hit(C, "HIT_clock", world_point(m, (0, 0, -0.02)), (0.28, 0.31, 0.09), yaw=_ypr(m)[0])
    return grp


# ----------------------------------------------------------------- hanging lamp (swingable)

def lamp_static(c):
    """Ceiling canopy + eye bolt (stays in STATIC_ceiling)."""
    lx, lz, ytop = LAMP_X, LAMP_Z, LAMP_BEAM_Y
    c.cyl(0.032, 0.012, (lx, ytop - 0.006, lz), "Brass", segs=16, bevel=0.003)
    c.cyl(0.005, 0.014, (lx, ytop - 0.017, lz), "Iron", segs=8)
    c.torus(0.0085, 0.0028, (lx, ytop - 0.03 + 0.0085, lz), "Iron", seg=12, rseg=6, axis='z')


def build_hanging_lamp(C):
    from .polish import group, child, lathe
    grp = group(C, "Hanging_lamp", mat3(LAMP_PIVOT), size=0.05)
    b = MB("Hanging_lamp_body", smooth_angle=40)
    # top link (through the eye bolt, swings about X) + rod
    b.torus(0.0085, 0.0026, (0, -0.0085, 0), "Iron", seg=12, rseg=6, axis='x')
    yl = 2.47 - LAMP_PIVOT[1]          # lamp top (group local)
    b.cyl(0.0035, -yl - 0.03, (0, (yl + 0.012) / 2 - 0.006, 0), "Iron", segs=8, cap=False)
    b.torus(0.009, 0.0026, (0, yl + 0.036, 0), "Iron", seg=12, rseg=6, axis='x')
    with b.frame((0, yl, 0)):
        b.torus(0.014, 0.0035, (0, 0.016, 0), "Brass", seg=14, rseg=6, axis='z')
        lathe(b, [(0.0, 0.0), (0.02, 0.0), (0.02, -0.03), (0.07, -0.08), (0.078, -0.09), (0.078, -0.1),
                  (0.0, -0.1)], "Brass", segs=12)
        lathe(b, [(0.0, -0.229), (0.072, -0.229), (0.072, -0.25), (0.03, -0.26), (0.008, -0.29), (0.0, -0.295)],
              "Brass", segs=12)
        for i in range(4):
            a = math.pi / 4 + i * math.pi / 2
            b.box((0.007, 0.13, 0.007), (0.06 * math.cos(a), -0.165, 0.06 * math.sin(a)), "Brass")
    child(b, grp, C)
    g = MB("Hanging_lamp_glass", smooth_angle=60)
    with g.frame((0, yl, 0)):
        lathe(g, [(0.0, -0.1), (0.05, -0.1), (0.056, -0.13), (0.057, -0.165), (0.055, -0.2), (0.05, -0.229),
                  (0.0, -0.229)], "LampGlass", segs=12)
    child(g, grp, C)
    return grp


# ----------------------------------------------------------------- ship's lantern

def build_lantern(C):
    from .polish import lathe, tube
    px, py, pz = L.LANTERN_POS
    grp = empty("Lantern", (px, py, pz), collection=C, size=0.05)
    body = MB("Lantern_body", smooth_angle=40)
    S = 18
    # solid stepped base + oil font
    lathe(body, [(0.0, 0.0), (0.077, 0.0), (0.077, 0.006), (0.066, 0.018), (0.062, 0.03), (0.062, 0.056),
                 (0.066, 0.062), (0.0, 0.066)], "Brass", segs=S)
    # candle + flame inside the globe
    body.cyl(0.026, 0.006, (0, 0.069, 0), "Brass", segs=12)
    body.cyl(0.016, 0.07, (0, 0.107, 0), "Candle", segs=10)
    body.sphere(0.006, (0.012, 0.137, 0.006), "Candle", segs=6, rings=3, sy=1.6)   # wax drip
    body.cyl(0.0012, 0.008, (0, 0.146, 0), "Iron", segs=4)
    body.sphere(0.0065, (0, 0.159, 0), "LanternFlame", segs=8, rings=5, sy=2.3)
    # lower + upper collar around the globe
    lathe(body, [(0.05, 0.064), (0.06, 0.064), (0.06, 0.076), (0.05, 0.079)], "Brass", segs=S)
    lathe(body, [(0.05, 0.204), (0.06, 0.207), (0.06, 0.218), (0.05, 0.218)], "Brass", segs=S)
    # bowed guard wires (cage) + two guard rings
    for i in range(4):
        a = 2 * math.pi * (i + 0.5) / 4
        pts = []
        for k in range(7):
            t = k / 6
            y = 0.074 + (0.209 - 0.074) * t
            rr = 0.0585 + 0.0075 * math.sin(math.pi * t)
            pts.append((rr * math.cos(a), y, rr * math.sin(a)))
        tube(body, pts, 0.0034, "Brass", segs=5, tile=0.35)
    for yy, rr in ((0.115, 0.0645), (0.167, 0.0645)):
        body.torus(rr, 0.0028, (0, yy, 0), "Brass", seg=S, rseg=4, axis='y')
    # ventilated top: dome, vent holes, chimney, hat on posts
    lathe(body, [(0.06, 0.218), (0.064, 0.222), (0.062, 0.228), (0.05, 0.246), (0.032, 0.263), (0.0, 0.266)],
          "Brass", segs=S)
    for i in range(6):
        a = 2 * math.pi * (i + 0.5) / 6
        rr, yy = 0.0492, 0.2475
        body.cyl(0.0055, 0.004, (rr * math.cos(a), yy, rr * math.sin(a)), "Iron", segs=6,
                 yaw=90 - math.degrees(a), pitch=50)
    body.cyl(0.02, 0.022, (0, 0.276, 0), "Brass", segs=12, cap=False)
    body.cyl(0.0205, 0.004, (0, 0.287, 0), "Brass", segs=12)
    for i in range(4):
        a = 2 * math.pi * i / 4 + math.pi / 4
        body.cyl(0.0022, 0.012, (0.017 * math.cos(a), 0.294, 0.017 * math.sin(a)), "Brass", segs=4, cap=False)
    lathe(body, [(0.0, 0.299), (0.034, 0.299), (0.035, 0.302), (0.02, 0.312), (0.0, 0.319)], "Brass", segs=16)
    body.sphere(0.0055, (0, 0.322, 0), "Brass", segs=6, rings=4)
    # bail handle: lugs on both sides of the dome, wire arch over the hat
    ly, lx = 0.236, 0.056
    for sx in (-1, 1):
        body.box((0.014, 0.022, 0.009), (sx * (lx + 0.001), ly, 0), "Brass", bevel=0.003, roll=sx * 35)
        body.cyl(0.0042, 0.016, (sx * (lx + 0.008), ly, 0), "Brass", axis='x', segs=8)
    arch = []
    a_, h_ = lx + 0.011, 0.105
    for k in range(13):
        th = math.pi * k / 12
        arch.append((a_ * math.cos(th), ly + h_ * math.sin(th) ** 0.85, 0.0))
    tube(body, [(lx + 0.004, ly, 0)] + arch + [(-lx - 0.004, ly, 0)], 0.0033, "Brass", segs=6, tile=0.35)
    # grip on top of the bail
    body.cyl(0.0055, 0.03, (0, ly + h_, 0), "Brass", axis='x', segs=8)
    ob = body.build(origin=(0, 0, 0), collection=C)
    ob.location = (0, 0, 0)
    ob.parent = grp
    # glass globe (fresnel-ribbed), LanternGlow
    g = MB("Lantern_glass", smooth_angle=60)
    prof = []
    for k in range(9):
        t = k / 8
        y = 0.078 + (0.205 - 0.078) * t
        rr = 0.05 + 0.0075 * math.sin(math.pi * t) + (0.0012 if k % 2 else 0.0)
        prof.append((rr, y))

    lathe(g, prof, "LanternGlow", segs=18)
    gob = g.build(origin=(0, 0, 0), collection=C)
    gob.location = (0, 0, 0)
    gob.parent = grp
    lt = empty("Lantern_light", collection=C, size=0.03)
    lt.location = util.T(0, 0.155, 0)
    lt.parent = grp
    return grp
