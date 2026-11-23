"""Thin or tiny parts (quill vane, compass face, gilt bands, ribbons) go to a second, unbaked mesh `dyn` that the
app lights with its scene lights: at lightmap resolution they would bake almost black.

Desk props built from primitives and curved grids (three.js coords, metres), merged into a lightmapped mesh:
an open book with curved, printed pages and a ribbon; closed books with boards, rounded spines and page blocks;
an inkwell with a feathered quill; a rolled chart with spiral ends and a tie; a spyglass; a compass on a sea chart."""
import math
import bmesh
from . import util


def grid(mb, f, nu, nv, mat, uv=lambda u, v: (u, v), flip=False, both=False, eps=0.0006, smooth=True, frame=None):
    """A curved sheet: f(u, v) -> (x, y, z) over u, v in 0..1. `both` adds a back face (offset along the normal)."""
    def sheet(offset, reverse):
        tb = bmesh.new()
        uvl = tb.loops.layers.uv.new('UVMap')
        pts = [[f(i / nu, j / nv) for i in range(nu + 1)] for j in range(nv + 1)]
        if offset:
            # push the back face slightly behind the front one (normal from neighbouring points)
            def nrm(i, j):
                a = pts[j][min(i + 1, nu)]; b = pts[j][max(i - 1, 0)]
                c = pts[min(j + 1, nv)][i]; d = pts[max(j - 1, 0)][i]
                du = [a[k] - b[k] for k in range(3)]; dv = [c[k] - d[k] for k in range(3)]
                n = (du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0])
                l = math.sqrt(sum(x * x for x in n)) or 1
                s = -1 if flip else 1
                return [s * x / l for x in n]
            pts = [[tuple(pts[j][i][k] - offset * nrm(i, j)[k] for k in range(3)) for i in range(nu + 1)] for j in range(nv + 1)]
        vs = [[tb.verts.new(p) for p in row] for row in pts]
        for j in range(nv):
            for i in range(nu):
                quad = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
                if flip != reverse:
                    quad.reverse()
                face = tb.faces.new([vs[b][a] for a, b in quad])
                for l, (a, b) in zip(face.loops, quad):
                    l[uvl].uv = uv(a / nu, b / nv)
        if frame is None:
            mb.raw(tb, mat, uv=None, smooth=smooth)
        else:
            with mb.frame(*frame):
                mb.raw(tb, mat, uv=None, smooth=smooth)
    sheet(0, False)
    if both:
        sheet(eps, True)


def closed_book(mb, pos, w, th, d, cover, yaw=0.0, gilt=True, dyn=None):
    """A closed book lying flat: spine on -x. pos is the centre of its base."""
    x, y, z = pos
    with mb.frame((x, y + th / 2, z), yaw=yaw):
        b = 0.0035
        for s in (-1, 1):
            mb.box((w, b, d), (0.002, s * (th / 2 - b / 2), 0), cover, bevel=0.0012)
        mb.cyl(th / 2, d, (-w / 2 + th * 0.12, 0, 0), cover, axis='z', segs=12)
        mb.box((w - 0.008, th - 2 * b, d - 0.008), (0.004, 0, 0), "PageEdge")
    if gilt and dyn is not None:
        with dyn.frame((x, y + th / 2, z), yaw=yaw):
            for zz in (-d / 2 + 0.018, d / 2 - 0.018):
                dyn.cyl(th / 2 + 0.0009, 0.005, (-w / 2 + th * 0.12, 0, zz), "Gilt", axis='z', segs=14)


def open_book(mb, pos, yaw=0.0, w=0.16, d=0.235, cover="BookRed", dyn=None):
    """An open book lying on the table: boards, page blocks with curved printed pages, a ribbon over the edge."""
    x, y, z = pos
    with mb.frame((x, y, z), yaw=yaw):
        for s in (-1, 1):
            mb.box((w + 0.008, 0.005, d + 0.012), (s * (w / 2 + 0.004), 0.0025, 0), cover, bevel=0.0015)
        mb.cyl(0.011, d + 0.012, (0, 0.004, 0), cover, axis='z', segs=12)
        base = 0.006
        def top(u):
            # pages rise out of the gutter, crest, and droop slightly at the fore-edge
            return base + 0.003 + 0.017 * math.sin(min(1.0, u * 1.7) * math.pi / 2) - 0.004 * u * u
        for s, (u0, u1) in ((-1, (0.5, 0.0)), (1, (0.5, 1.0))):
            X = lambda u, s=s: s * (0.003 + u * (w - 0.006))
            # printed page surface (left page shows the left half of the texture)
            grid(mb, lambda u, v, X=X: (X(u), top(u) + 0.0012 * math.sin(math.pi * v), (v - 0.5) * d),
                 14, 4, "PageText", uv=lambda u, v, u0=u0, u1=u1: (u0 + (u1 - u0) * u, 1 - v), flip=(s < 0))   # text top away from the reader
            # page block sides: fore-edge and the two ends
            grid(mb, lambda u, v, X=X: (X(1.0), base + v * (top(1.0) - base), (u - 0.5) * d), 2, 2, "PageEdge",
                 uv=lambda u, v: (u * 4, v * 0.4), flip=(s < 0))
            for e in (-1, 1):
                grid(mb, lambda u, v, X=X, e=e: (X(u), base + v * (top(u) - base), e * d / 2), 10, 2, "PageEdge",
                     uv=lambda u, v: (u * 3, v * 0.4), flip=((s * e) > 0))
        # a ribbon bookmark lying across the right page and over the bottom edge
        rib = lambda u, v: (0.05 + v * 0.008, top(0.3) + 0.0015 if u < 0.8 else top(0.3) - (u - 0.8) * 0.12,
                            -d / 2 + 0.06 - u * 0.09 if u < 0.8 else -d / 2 - 0.012)
    with (dyn or mb).frame((x, y, z), yaw=yaw):
        grid(dyn or mb, rib, 6, 1, "Ribbon", both=True)


def inkwell_and_quill(mb, pos, yaw=0.0, dyn=None):
    x, y, z = pos
    with mb.frame((x, y, z), yaw=yaw):
        mb.box((0.058, 0.042, 0.058), (0, 0.021, 0), "InkGlass", bevel=0.009, seg=2)
        mb.cyl(0.015, 0.012, (0, 0.047, 0), "Brass", segs=14, bevel=0.002)
        mb.cyl(0.0125, 0.002, (0, 0.0532, 0), "Ink", segs=14)
        # hinged lid tipped open behind the neck
        mb.cyl(0.018, 0.005, (0, 0.06, -0.019), "Brass", segs=14, bevel=0.0015, pitch=-70)
        mb.sphere(0.004, (0, 0.074, -0.024), "Brass", segs=8, rings=5)
    q = dyn or mb
    with q.frame((x, y, z), yaw=yaw):
        # the quill: tapered shaft out of the ink, leaning back and to the side, with a curved vane
        with q.frame((0, 0.052, 0), yaw=25, pitch=-28, roll=-12):
            L = 0.25
            q.cyl(0.0022, L, (0, L / 2 - 0.035, 0), "Feather", segs=6, r2=0.0009)
            def vane(side):
                def f(u, v):
                    t = 0.22 + u * 0.75
                    wv = 0.016 * math.sin(math.pi * min(1.0, (t - 0.22) / 0.75)) ** 0.6 * (1.15 if side > 0 else 0.75)
                    yy = t * L - 0.035
                    return (side * v * wv, yy + v * wv * 0.35, -0.004 * v * v * wv / 0.016)
                return f
            for side in (-1, 1):
                grid(q, vane(side), 12, 2, "Feather", flip=(side < 0), both=True, smooth=True)


def rolled_chart(mb, pos, length=0.42, r=0.026, yaw=0.0):
    x, y, z = pos
    with mb.frame((x, y + r, z), yaw=yaw):
        mb.cyl(r, length, (0, 0, 0), "Parchment", axis='x', segs=18, cap=False)
        # the spiral of rolled layers at each end, slightly proud
        for e in (-1, 1):
            for k, rr in enumerate((r * 0.95, r * 0.68, r * 0.42, r * 0.2)):
                mb.torus(rr, 0.0022 if k < 3 else 0.003, (e * (length / 2 - 0.002 * k), 0, 0), "Parchment",
                         axis='x', seg=22, rseg=5)
            mb.cyl(r * 0.96, 0.002, (e * length / 2, 0, 0), "PageEdge", axis='x', segs=18)
        # a loose outer flap and a red tie
        grid(mb, lambda u, v: (-length / 2 + u * length, -r + 0.0006 - v * 0.0002, r * 0.2 + v * 0.05), 6, 3, "Parchment",
             uv=lambda u, v: (u * 0.8, v * 0.1), flip=True, both=True)
        for o in (-0.03, 0.03):
            mb.torus(r + 0.0012, 0.0024, (o, 0, 0), "Ribbon", axis='x', seg=22, rseg=5)


def spyglass(mb, pos, yaw=0.0):
    x, y, z = pos
    with mb.frame((x, y, z), yaw=yaw):
        sections = [(0.022, 0.13, "Brass"), (0.019, 0.1, "Brass"), (0.016, 0.08, "Brass"), (0.0125, 0.035, "Brass")]
        xx = -0.17
        for i, (r, l, m) in enumerate(sections):
            mb.cyl(r, l, (xx + l / 2, 0.022, 0), m, axis='x', segs=16, bevel=0.0015)
            mb.torus(r + 0.0006, 0.0018, (xx + l, 0.022, 0), "Brass", axis='x', seg=16, rseg=4)
            if i == 0:
                mb.cyl(r + 0.0012, 0.075, (xx + 0.04 + 0.0375, 0.022, 0), "Leather", axis='x', segs=16)
                mb.cyl(0.0185, 0.002, (xx - 0.001, 0.022, 0), "InkGlass", axis='x', segs=16)
            xx += l - 0.004


def compass(mb, pos):
    """Pass the unbaked mesh: the face and needle are too small to bake."""
    x, y, z = pos
    mb.cyl(0.042, 0.016, (x, y + 0.008, z), "Brass", segs=24, bevel=0.003)
    mb.cyl(0.035, 0.0012, (x, y + 0.0166, z), "Parchment", segs=24)
    mb.torus(0.0365, 0.0022, (x, y + 0.0168, z), "Brass", axis='y', seg=24, rseg=4)
    mb.torus(0.008, 0.0025, (x, y + 0.008, z - 0.046), "Brass", axis='z', seg=10, rseg=4)
    # needle: red north, dark south
    for s, m in ((1, "Ribbon"), (-1, "Iron")):
        mb.prism([(0, 0), (0.004, s * 0.014), (0, s * 0.03), (-0.004, s * 0.014)], 0.0012,
                 (x, y + 0.0185, z), m, plane='xz')
    mb.sphere(0.0025, (x, y + 0.0195, z), "Brass", segs=8, rings=4)


def sea_chart(mb, pos, w=0.42, d=0.31, yaw=0.0):
    """A flat chart with its corners curling up a touch."""
    x, y, z = pos
    def f(u, v):
        cu, cv = (2 * u - 1), (2 * v - 1)
        lift = 0.006 * (abs(cu) ** 6 + abs(cv) ** 8) + 0.004 * max(0, abs(cu) * abs(cv)) ** 4
        return ((u - 0.5) * w, 0.0008 + lift, (0.5 - v) * d)
    grid(mb, f, 12, 8, "Chart", flip=True, frame=((x, y, z), yaw))
