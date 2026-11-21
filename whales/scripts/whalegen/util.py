"""Math, noise, colour and mesh-building helpers (no bpy dependency except Vector)."""
import math
import colorsys
import numpy as np

TAU = math.pi * 2


# ----------------------------------------------------------------- interpolation
def pchip(xs, ys):
    xs = np.asarray(xs, float); ys = np.asarray(ys, float)
    h = np.diff(xs); d = np.diff(ys) / h
    m = np.zeros_like(ys)
    m[0], m[-1] = d[0], d[-1]
    for k in range(1, len(xs) - 1):
        if d[k - 1] * d[k] <= 0:
            m[k] = 0.0
        else:
            w1 = 2 * h[k] + h[k - 1]; w2 = h[k] + 2 * h[k - 1]
            m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k])

    def f(t):
        t = np.clip(np.asarray(t, float), xs[0], xs[-1])
        k = np.clip(np.searchsorted(xs, t) - 1, 0, len(xs) - 2)
        hk = h[k]; s = (t - xs[k]) / hk
        h00 = 2 * s**3 - 3 * s**2 + 1; h10 = s**3 - 2 * s**2 + s
        h01 = -2 * s**3 + 3 * s**2; h11 = s**3 - s**2
        return h00 * ys[k] + h10 * hk * m[k] + h01 * ys[k + 1] + h11 * hk * m[k + 1]
    return f


def smoothstep(e0, e1, x):
    x = np.clip((np.asarray(x, float) - e0) / (e1 - e0), 0.0, 1.0)
    return x * x * (3 - 2 * x)


def sstep(e0, e1, x):  # scalar version
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    x = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return x * x * (3 - 2 * x)


# ----------------------------------------------------------------- noise
def _hash(ix, iy, seed):
    v = np.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453
    return v - np.floor(v)


def vnoise(x, y, seed=0):
    x = np.asarray(x, float); y = np.asarray(y, float)
    ix = np.floor(x); iy = np.floor(y)
    fx = x - ix; fy = y - iy
    ux = fx * fx * (3 - 2 * fx); uy = fy * fy * (3 - 2 * fy)
    a = _hash(ix, iy, seed); b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed); d = _hash(ix + 1, iy + 1, seed)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def fbm(x, y, seed=0, octaves=4, lac=2.0, gain=0.5):
    s = 0.0; amp = 0.5; norm = 0.0; f = 1.0
    for o in range(octaves):
        s = s + amp * vnoise(x * f, y * f, seed + o * 13)
        norm += amp; amp *= gain; f *= lac
    return s / norm


def grid_fbm(h, w, cells_u, cells_v, seed=0, octaves=5, wrap_v=True):
    """fbm image (h rows = v, w cols = u), periodic along v if wrap_v."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w)); amp = 0.5; norm = 0
    cu, cv = cells_u, cells_v
    for o in range(octaves):
        g = rng.random((cv + 1, cu + 1))
        if wrap_v:
            g[-1, :] = g[0, :]
        vv = np.linspace(0, cv, h, endpoint=not wrap_v) if not wrap_v else np.arange(h) * cv / h
        uu = np.linspace(0, cu, w)
        iv = np.clip(np.floor(vv).astype(int), 0, cv - 1); fv = vv - iv
        iu = np.clip(np.floor(uu).astype(int), 0, cu - 1); fu = uu - iu
        fv = fv * fv * (3 - 2 * fv); fu = fu * fu * (3 - 2 * fu)
        a = g[iv][:, iu]; b = g[iv][:, iu + 1]; c = g[iv + 1][:, iu]; d = g[iv + 1][:, iu + 1]
        fu2 = fu[None, :]; fv2 = fv[:, None]
        layer = a * (1 - fu2) * (1 - fv2) + b * fu2 * (1 - fv2) + c * (1 - fu2) * fv2 + d * fu2 * fv2
        out += amp * layer; norm += amp; amp *= 0.5; cu *= 2; cv *= 2
    return out / norm


# ----------------------------------------------------------------- colour
def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def s2l(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def jitter(rgb, rng, dh=0.02, ds=0.08, dv=0.10):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    h = (h + rng.uniform(-dh, dh)) % 1.0
    s = min(1, max(0, s * (1 + rng.uniform(-ds, ds))))
    v = min(1, max(0, v * (1 + rng.uniform(-dv, dv))))
    return colorsys.hsv_to_rgb(h, s, v)


def boost(rgb, sat=1.25, val=1.08):
    h, s, v = colorsys.rgb_to_hsv(*rgb)
    return colorsys.hsv_to_rgb(h, min(1, s * sat), min(1, v * val))


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def mul(a, k):
    return tuple(min(1.0, x * k) for x in a)


# ----------------------------------------------------------------- mesh builder
class MB:
    """Accumulates geometry with per-vertex colour and per-vertex weight dicts."""

    def __init__(self):
        self.v = []; self.f = []; self.col = []; self.w = []
        self.smooth = []; self.uv = []  # uv: per face list of (u,v) or None

    def add(self, verts, faces, colors, weights, smooth=True, uvs=None):
        o = len(self.v)
        self.v.extend(verts)
        self.col.extend(colors)
        self.w.extend(weights)
        for i, fc in enumerate(faces):
            self.f.append(tuple(x + o for x in fc))
            self.smooth.append(smooth if isinstance(smooth, bool) else smooth[i])
            self.uv.append(uvs[i] if uvs is not None else None)
        return o

    def tri_count(self):
        return sum(len(f) - 2 for f in self.f)


# ----------------------------------------------------------------- primitive geometry (local)
_ICO = {}


def icosphere(sub=1):
    if sub in _ICO:
        return _ICO[sub]
    t = (1 + 5 ** 0.5) / 2
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
         (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    v = [tuple(np.array(p) / np.linalg.norm(p)) for p in v]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
         (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10),
         (8, 6, 7), (9, 8, 1)]
    for _ in range(sub):
        cache = {}; nf = []

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                p = (np.array(v[a]) + np.array(v[b])) / 2
                v.append(tuple(p / np.linalg.norm(p))); cache[k] = len(v) - 1
            return cache[k]
        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        f = nf
    _ICO[sub] = (v, f)
    return v, f


def blob(center, radii, sub, rng, noise=0.15, flat_bottom=0.0):
    """Displaced ellipsoid. returns verts, faces, local height fraction per vert (0 bottom .. 1 top)."""
    v, f = icosphere(sub)
    cx, cy, cz = center; rx, ry, rz = radii
    ph = rng.uniform(0, 100, 3)
    out = []; hf = []
    for (x, y, z) in v:
        n = 1 + noise * (math.sin(x * 3.1 + ph[0]) * math.sin(y * 2.7 + ph[1]) * math.sin(z * 3.3 + ph[2]) * 1.6
                         + rng.uniform(-0.3, 0.3))
        zz = z
        if flat_bottom and z < -flat_bottom:
            zz = -flat_bottom + (z + flat_bottom) * 0.35
        out.append((cx + x * rx * n, cy + y * ry * n, cz + zz * rz * n))
        hf.append((z + 1) / 2)
    return out, list(f), hf


def ring_tube(path, radii, sides=6, cap_top=True, cap_bottom=False):
    """Tube along a list of 3D points with per-point radius. Returns verts, faces, t-param per vert."""
    verts = []; faces = []; tp = []
    n = len(path)
    P = [np.array(p, float) for p in path]
    for i in range(n):
        if i == 0:
            d = P[1] - P[0]
        elif i == n - 1:
            d = P[-1] - P[-2]
        else:
            d = P[i + 1] - P[i - 1]
        d /= (np.linalg.norm(d) + 1e-9)
        a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
        u = np.cross(d, a); u /= np.linalg.norm(u); w = np.cross(d, u)
        for k in range(sides):
            an = TAU * k / sides
            verts.append(tuple(P[i] + radii[i] * (math.cos(an) * u + math.sin(an) * w)))
            tp.append(i / (n - 1))
    for i in range(n - 1):
        for k in range(sides):
            a = i * sides + k; b = i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if cap_top:
        verts.append(tuple(P[-1])); tp.append(1.0); c = len(verts) - 1
        for k in range(sides):
            faces.append(((n - 1) * sides + k, (n - 1) * sides + (k + 1) % sides, c))
    if cap_bottom:
        verts.append(tuple(P[0])); tp.append(0.0); c = len(verts) - 1
        for k in range(sides):
            faces.append(((k + 1) % sides, k, c))
    return verts, faces, tp


def cone(base, radius, height, sides=8, droop=0.0, rng=None, tilt=(0, 0)):
    bx, by, bz = base
    verts = []; faces = []; hf = []
    for k in range(sides):
        an = TAU * k / sides + (rng.uniform(-0.15, 0.15) if rng else 0)
        r = radius * (1 + (rng.uniform(-0.12, 0.12) if rng else 0))
        verts.append((bx + r * math.cos(an), by + r * math.sin(an), bz - droop)); hf.append(0.0)
    verts.append((bx + tilt[0] * height, by + tilt[1] * height, bz + height)); hf.append(1.0)
    verts.append((bx, by, bz)); hf.append(0.0)
    tip = sides; c = sides + 1
    for k in range(sides):
        faces.append((k, (k + 1) % sides, tip))
        faces.append(((k + 1) % sides, k, c))
    return verts, faces, hf


def box(center, size, rot_z=0.0, taper=1.0):
    cx, cy, cz = center; sx, sy, sz = [s / 2 for s in size]
    cs, sn = math.cos(rot_z), math.sin(rot_z)
    verts = []
    for z, tp in ((-sz, 1.0), (sz, taper)):
        for x, y in ((-sx, -sy), (sx, -sy), (sx, sy), (-sx, sy)):
            x *= tp; y *= tp
            verts.append((cx + x * cs - y * sn, cy + x * sn + y * cs, cz + z))
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    hf = [0, 0, 0, 0, 1, 1, 1, 1]
    return verts, faces, hf


def cylinder(base, radius, height, sides=8, r_top=None):
    r_top = radius if r_top is None else r_top
    bx, by, bz = base
    verts = []
    for z, r in ((0, radius), (height, r_top)):
        for k in range(sides):
            an = TAU * k / sides
            verts.append((bx + r * math.cos(an), by + r * math.sin(an), bz + z))
    faces = []
    for k in range(sides):
        faces.append((k, (k + 1) % sides, sides + (k + 1) % sides, sides + k))
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, 2 * sides)))
    hf = [0] * sides + [1] * sides
    return verts, faces, hf


def rotate_z(verts, ang, about):
    cs, sn = math.cos(ang), math.sin(ang)
    ax, ay = about[0], about[1]
    return [(ax + (x - ax) * cs - (y - ay) * sn, ay + (x - ax) * sn + (y - ay) * cs, z) for x, y, z in verts]


def rotate_axis(verts, axis, ang, about):
    axis = np.array(axis, float); axis /= np.linalg.norm(axis)
    K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    R = np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K
    a = np.array(about, float)
    return [tuple(R @ (np.array(p) - a) + a) for p in verts]
