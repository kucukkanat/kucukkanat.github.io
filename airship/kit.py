"""Mesh kit for the sky galleon. Blender coords: +X bow, +Y port, +Z up, metres.
Every face is authored with its final albedo (linear) and a UV in metres with U along the grain; the stored vertex colour
is that albedo divided by the mean of the material's paint map, so texture x vertex colour gives the albedo back."""
import bpy, bmesh, math, random, contextlib
from mathutils import Vector, Matrix, Euler


def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


# Colours and brush textures come from the cabin's painted-diorama style (blender/kit/paint.py PALETTE / ACCENT) through
# tex_process.py: each texture in tex/ is a 'relative' paint map (painted / brightest tone) and tex/detail.json holds its
# mean and the mean painted colour. 'col' None = the painted palette colour itself. No normal maps (flat-lit paint).
MATS = {
    'HullWood': dict(col=None, rough=.85, tex='wood_hull', tile=3.2),          # WallPlanks (walnut)
    'HullDark': dict(col=None, rough=.85, tex='wood_dark', tile=3.2),          # DarkWood (cool umber wales, caps, frames)
    'Deck': dict(col=None, rough=.9, tex='wood_deck', tile=3.0),               # Planks (honey)
    'Trim': dict(col=None, rough=.8, tex='wood_trim', tile=2.6),               # Mahogany (wine brown)
    'Spar': dict(col=None, rough=.85, tex='wood_spar', tile=3.0),              # between Planks and WallPlanks
    'PaintOrange': dict(col=None, rough=.8, tex='paint_orange', tile=3.4),     # ACCENT orange
    'PaintCream': dict(col=None, rough=.85, tex='paint_cream', tile=3.4),      # ACCENT cream
    'Brass': dict(col=None, rough=.5, metal=.35, tex='brass', tile=.6),
    'Gilt': dict(col=None, rough=.5, metal=.35, tex='gilt', tile=.6),
    'Iron': dict(col=None, rough=.6, metal=.3, tex='iron', tile=1.4),          # ACCENT iron
    'Sail': dict(col=None, rough=.95, double=True, tex='canvas', tile=3.0),    # Sailcloth
    'SailEmblem': dict(col='#FFFFFF', rough=.95, double=True, tex='sail_emblem'),
    'FlagFalcon': dict(col='#FFFFFF', rough=.95, double=True, tex='falcon_flag'),
    'NameBoard': dict(col='#FFFFFF', rough=.8, tex='name_board'),
    'Frieze': dict(col='#FFFFFF', rough=.8, tex='frieze'),
    'Rope': dict(col='#A98A5C', rough=.95),
    'RopeDark': dict(col='#2E2026', rough=.95),
    'Glass': dict(col='#FFD08A', rough=.3, emit=1.6),
    'LanternGlow': dict(col='#FFC66B', rough=.3, emit=5),
    'LiftStone': dict(col='#4FE0C8', rough=.3, emit=2.2),                      # ACCENT teal
    'Dark': dict(col='#17110E', rough=1),                                      # ACCENT ink
}
import os, json
TEXDIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tex')
def has_tex(mat):
    return os.path.exists(os.path.join(TEXDIR, MATS[mat].get('tex', '-') + '.jpg'))


def _hex(c):
    s = [x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055 for x in c]
    return '#' + ''.join('%02X' % max(0, min(255, round(v * 255))) for v in s)


try: DETAIL = json.load(open(os.path.join(TEXDIR, 'detail.json')))
except Exception: DETAIL = {}
FALLBACK = {'HullWood': '#6C4230', 'HullDark': '#3A282B', 'Deck': '#AC7640', 'Trim': '#713526', 'Spar': '#906138', 'PaintOrange': '#E8652B',
            'PaintCream': '#EADBB8', 'Brass': '#C19035', 'Gilt': '#D5A63E', 'Iron': '#2B2A30', 'Sail': '#E0D2AE'}
for _n, _d in MATS.items():
    _t = DETAIL.get(_d.get('tex')) if has_tex(_n) else None
    _d['norm'] = tuple(_t['mean']) if _t else (1, 1, 1)      # vertex colours are divided by this (see add / grid_obj)
    if _d['col'] is None: _d['col'] = _hex(_t['col']) if _t else FALLBACK[_n]


def vcol(mat, c):
    """Vertex colour that gives albedo c (linear) once multiplied with the material's relative paint map."""
    n = MATS[mat]['norm']
    return (min(c[0] / n[0], 1.0), min(c[1] / n[1], 1.0), min(c[2] / n[2], 1.0))


WORLD = {}   # object name -> world matrix (tracked here; depsgraph is not updated while building)
STATS = {}


def make_materials():
    for n, d in MATS.items():
        m = bpy.data.materials.get(n) or bpy.data.materials.new(n)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        a = nt.nodes.new('ShaderNodeVertexColor')
        a.layer_name = 'Col'
        nt.links.new(b.outputs[0], out.inputs[0])
        nt.links.new(a.outputs['Color'], b.inputs['Base Color'])
        tp = os.path.join(TEXDIR, d.get('tex', '-') + '.jpg')
        if os.path.exists(tp):
            def img(path, noncolor=False):
                im = bpy.data.images.get(os.path.basename(path)) or bpy.data.images.load(path)
                im.filepath = path
                im.reload()
                if noncolor: im.colorspace_settings.name = 'Non-Color'
                t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
                return t
            t = img(tp)
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
            mx.inputs[0].default_value = 1.0
            nt.links.new(t.outputs['Color'], mx.inputs[6]); nt.links.new(a.outputs['Color'], mx.inputs[7])
            nt.links.new(mx.outputs[2], b.inputs['Base Color'])
        b.inputs['Roughness'].default_value = d.get('rough', .8)
        b.inputs['Metallic'].default_value = d.get('metal', 0)
        if d.get('emit'):
            b.inputs['Emission Color'].default_value = (*lin(d['col']), 1)
            b.inputs['Emission Strength'].default_value = d['emit']
        m.use_backface_culling = not d.get('double', False)


def R(rot):
    return Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()


def TR(loc=(0, 0, 0), rot=(0, 0, 0)):
    return Matrix.Translation(loc) @ R(rot)


class MB:
    def __init__(self, seed=1):
        self.v, self.f, self.fm, self.lc, self.luv = [], [], [], [], []
        self.rng = random.Random(seed)
        self.stack = [Matrix.Identity(4)]
        self.flip = [False]

    @contextlib.contextmanager
    def at(self, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), M=None):
        m = M if M is not None else TR(loc, rot) @ Matrix.Diagonal((*scale, 1))
        self.stack.append(self.stack[-1] @ m)
        self.flip.append(self.flip[-1] ^ (m.to_3x3().determinant() < 0))
        try:
            yield
        finally:
            self.stack.pop(); self.flip.pop()

    def tint(self, mat, col=None, var=.07):
        c = lin(col) if isinstance(col, str) else (col or lin(MATS[mat]['col']))
        k = 1 + self.rng.uniform(-var, var)
        w = self.rng.uniform(-var, var) * .35
        return (c[0] * k * (1 + w), c[1] * k, c[2] * k * (1 - w))

    def face(self, pts, mat, col=None, uv=None, var=.0):
        """pts: counter-clockwise seen from outside. col: linear rgb or '#hex' or None (material colour)."""
        M = self.stack[-1]
        P = [M @ Vector(p) for p in pts]
        if self.flip[-1]:
            P.reverse()
            if uv: uv = list(reversed(uv))
        if col is None or isinstance(col, str) or var:
            col = self.tint(mat, col, var)
        if uv is None:
            uv = self._uv(P, MATS[mat].get('tile', 1.0))
        n = len(self.v)
        self.v += P
        self.f.append(list(range(n, n + len(P))))
        self.fm.append(mat)
        self.lc += [col] * len(P)
        self.luv += uv

    def _uv(self, P, tile=1.0):
        o = P[0]
        e1 = P[1] - P[0]
        e2 = P[-1] - P[0]
        if e2.length > e1.length:
            e1, e2 = e2, e1
        if e1.length < 1e-9:
            return [(0, 0)] * len(P)
        u = e1.normalized()
        nrm = u.cross(e2)
        w = nrm.cross(u).normalized() if nrm.length > 1e-12 else Vector((0, 0, 1))
        ou, ov = self.rng.random() * 7, self.rng.random() * 7
        return [(((p - o).dot(u) + ou) / tile, ((p - o).dot(w) + ov) / tile) for p in P]

    def strip_start(self, mat):
        """Random origin (and direction) for a plank: returns state for strip_uv."""
        return {'t': MATS[mat].get('tile', 1.0), 'u': self.rng.random() * 9, 'v': self.rng.random() * 9, 'f': self.rng.choice((1, -1)), 'd': 0.0}

    def strip_uv(self, st, a0, a1, b0, b1):
        """UVs for quad corners (a0 lower-start, b0 lower-end, b1 upper-end, a1 upper-start), U running along the plank."""
        L = ((Vector(b0) - Vector(a0)).length + (Vector(b1) - Vector(a1)).length) / 2
        h0, h1 = (Vector(a1) - Vector(a0)).length, (Vector(b1) - Vector(b0)).length
        t, f, u0, u1, v = st['t'], st['f'], st['u'] + st['d'], st['u'] + st['d'] + L, st['v']
        st['d'] += L
        return {'a0': (f * u0 / t, v / t), 'b0': (f * u1 / t, v / t), 'b1': (f * u1 / t, (v + h1) / t), 'a1': (f * u0 / t, (v + h0) / t)}

    # ---- primitives -------------------------------------------------------
    def box(self, size, c=(0, 0, 0), mat='HullWood', col=None, rot=None, top=(1, 1), var=.07):
        x, y, z = size[0] / 2, size[1] / 2, size[2] / 2
        tx, ty = top
        v = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
             (-x * tx, -y * ty, z), (x * tx, -y * ty, z), (x * tx, y * ty, z), (-x * tx, y * ty, z)]
        col = self.tint(mat, col, var)
        with self.at(c, rot or (0, 0, 0)):
            for q in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
                self.face([v[i] for i in q], mat, col)

    def sweep(self, path, section, mat, col=None, side=None, caps=True, closed=False, scale=None, var=.05):
        """Sweep a 2D section (list of (a,b), CCW) along a path. side: fixed reference for the section's a axis
        (None = parallel transport). scale: per-point multiplier."""
        P = [Vector(p) for p in path]
        n = len(P)
        T = []
        for i in range(n):
            a = P[(i - 1) % n] if (closed or i > 0) else P[i]
            b = P[(i + 1) % n] if (closed or i < n - 1) else P[i]
            t = (b - a)
            T.append(t.normalized() if t.length > 1e-9 else Vector((0, 0, 1)))
        frames = []
        if side is None:
            s = T[0].orthogonal().normalized()
        for i in range(n):
            t = T[i]
            if side is not None:
                s = Vector(side)
            s = (s - t * s.dot(t))
            s = s.normalized() if s.length > 1e-6 else t.orthogonal().normalized()
            frames.append((s, t.cross(s)))
        col = self.tint(mat, col, var)
        rings = []
        for i in range(n):
            k = scale[i] if scale else 1
            s, w = frames[i]
            rings.append([P[i] + (s * a + w * b) * k for a, b in section])
        m = len(section)
        tile = MATS[mat].get('tile', 1.0)
        per = [0.0]
        for k in range(m):
            a, b = section[k], section[(k + 1) % m]
            per.append(per[-1] + math.hypot(b[0] - a[0], b[1] - a[1]) * (scale[0] if scale else 1))
        ou, ov, d = self.rng.random() * 9, self.rng.random() * 9, 0.0
        for i in range(n if closed else n - 1):
            r0, r1 = rings[i], rings[(i + 1) % n]
            L = (P[(i + 1) % n] - P[i]).length
            for k in range(m):
                k2 = (k + 1) % m
                uv = [((ou + d) / tile, (ov + per[k]) / tile), ((ou + d) / tile, (ov + per[k + 1]) / tile),
                      ((ou + d + L) / tile, (ov + per[k + 1]) / tile), ((ou + d + L) / tile, (ov + per[k]) / tile)]
                self.face([r0[k], r0[k2], r1[k2], r1[k]], mat, col, uv=uv)
            d += L
        if caps and not closed:
            self.face(list(reversed(rings[0])), mat, col)
            self.face(rings[-1], mat, col)

    def tube(self, path, r, mat, segs=6, **kw):
        sec = [(math.cos(2 * math.pi * k / segs), math.sin(2 * math.pi * k / segs)) for k in range(segs)]
        if isinstance(r, (list, tuple)):
            self.sweep(path, sec, mat, scale=list(r), **kw)
        else:
            self.sweep(path, [(a * r, b * r) for a, b in sec], mat, **kw)

    def cyl(self, p0, p1, r0, mat, r1=None, segs=10, **kw):
        self.tube([p0, p1], [r0, r0 if r1 is None else r1], mat, segs=segs, **kw)

    def beam(self, path, w, h, mat, side=(0, 1, 0), **kw):
        self.sweep(path, [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)], mat, side=side, **kw)

    def lathe(self, prof, mat, segs=12, col=None, var=.05, arc=(0, 360)):
        """Revolve (r, z) profile (ordered bottom to top for an outward surface) about local Z."""
        col = self.tint(mat, col, var)
        a0, a1 = math.radians(arc[0]), math.radians(arc[1])
        full = abs(arc[1] - arc[0]) >= 360
        ns = segs if full else segs + 1
        ang = [a0 + (a1 - a0) * k / segs for k in range(ns)]
        for i in range(len(prof) - 1):
            (ra, za), (rb, zb) = prof[i], prof[i + 1]
            for k in range(segs):
                t0, t1 = ang[k], ang[(k + 1) % ns]
                A = (ra * math.cos(t0), ra * math.sin(t0), za); B = (ra * math.cos(t1), ra * math.sin(t1), za)
                C = (rb * math.cos(t1), rb * math.sin(t1), zb); D = (rb * math.cos(t0), rb * math.sin(t0), zb)
                if ra < 1e-6 and rb < 1e-6: continue
                if ra < 1e-6: self.face([A, C, D], mat, col)
                elif rb < 1e-6: self.face([A, B, D], mat, col)
                else: self.face([A, B, C, D], mat, col)

    def grid(self, P, mat, col=None, flip=False, var=.06, colfn=None):
        for i in range(len(P) - 1):
            for j in range(len(P[0]) - 1):
                q = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]]
                if flip: q.reverse()
                c = colfn(i, j) if colfn else col
                if c == 'skip': continue
                self.face(q, mat, c, var=var)

    def prism(self, poly, z0, z1, mat, col=None, var=.06):
        col = self.tint(mat, col, var)
        n = len(poly)
        if sum(poly[k][0] * poly[(k + 1) % n][1] - poly[(k + 1) % n][0] * poly[k][1] for k in range(n)) < 0:
            poly = list(reversed(poly))
        self.face([(x, y, z1) for x, y in poly], mat, col)
        self.face([(x, y, z0) for x, y in reversed(poly)], mat, col)
        for k in range(n):
            a, b = poly[k], poly[(k + 1) % n]
            self.face([(*a, z0), (*b, z0), (*b, z1), (*a, z1)], mat, col)

    def torus(self, R, r, mat, segs=20, tsegs=6, col=None):
        self.lathe([(R + r * math.cos(2 * math.pi * k / tsegs), r * math.sin(2 * math.pi * k / tsegs)) for k in range(tsegs + 1)], mat, segs=segs, col=col)

    def ball(self, c, r, mat, segs=10, rings=6, col=None, sz=1.0):
        prof = [(r * math.sin(math.pi * i / rings), -r * sz * math.cos(math.pi * i / rings)) for i in range(rings + 1)]
        with self.at(c):
            self.lathe(prof, mat, segs=segs, col=col)

    def wall(self, P, inward, thick, mat, colfn=None, holes=(), caps='tbse', var=.07, matfn=None):
        """Planked wall with openings. P[i][j]: outer points (i along, j up). inward(i): unit vector.
        holes: set of (i, j) cells left open (reveals are added). caps: t top, b bottom, s start, e end."""
        ni, nj = len(P) - 1, len(P[0]) - 1
        Q = [[Vector(P[i][j]) + Vector(inward(i)) * thick for j in range(nj + 1)] for i in range(ni + 1)]
        P = [[Vector(p) for p in row] for row in P]
        a, b, d = P[0][0], P[1][0], P[0][1]
        fl = (b - a).cross(d - a).dot(Vector(inward(0))) > 0
        holes = set(holes)

        cur = [mat]

        rows = {}

        def quad(q, c, inner=False, uv=None):
            if fl ^ inner:
                q = list(reversed(q))
                if uv: uv = list(reversed(uv))
            self.face(q, cur[0], c, var=var, uv=uv)
        solid = lambda i, j: 0 <= i < ni and 0 <= j < nj and (i, j) not in holes
        for i in range(ni):
            for j in range(nj):
                if (i, j) in holes: continue
                c = colfn(i, j) if colfn else None
                cur[0] = (matfn(i, j) if matfn else None) or mat
                key = (j, cur[0])
                if key not in rows or (i - 1, j) in holes: rows[key] = self.strip_start(cur[0])
                uv = self.strip_uv(rows[key], P[i][j], P[i][j + 1], P[i + 1][j], P[i + 1][j + 1])
                uv = [uv['a0'], uv['b0'], uv['b1'], uv['a1']]
                quad([P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]], c, uv=uv)
                quad([Q[i][j], Q[i + 1][j], Q[i + 1][j + 1], Q[i][j + 1]], c, True, uv=uv)
                # edges: (di, dj, corner pairs)
                for di, dj, e in ((0, -1, ((i, j), (i + 1, j))), (1, 0, ((i + 1, j), (i + 1, j + 1))),
                                  (0, 1, ((i + 1, j + 1), (i, j + 1))), (-1, 0, ((i, j + 1), (i, j)))):
                    if solid(i + di, j + dj): continue
                    edge = (i + di < 0 and 's') or (i + di >= ni and 'e') or (j + dj < 0 and 'b') or (j + dj >= nj and 't') or 'h'
                    if edge != 'h' and edge not in caps: continue
                    (i0, j0), (i1, j1) = e
                    quad([P[i1][j1], P[i0][j0], Q[i0][j0], Q[i1][j1]], c)


# ---- objects ------------------------------------------------------------------
def collection():
    c = bpy.data.collections.get('Ship')
    if not c:
        c = bpy.data.collections.new('Ship')
        bpy.context.scene.collection.children.link(c)
    return c


def _place(ob, parent, world):
    WORLD[ob.name] = world
    collection().objects.link(ob)
    if parent:
        p = bpy.data.objects[parent] if isinstance(parent, str) else parent
        ob.parent = p
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_local = WORLD[p.name].inverted() @ world
    else:
        ob.matrix_local = world


AX = {'X': (1, 0, 0), 'Y': (0, 0, -1), 'Z': (0, 1, 0), '-X': (-1, 0, 0), '-Y': (0, 0, 1), '-Z': (0, -1, 0)}


def joint(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None, kind=None, axis=None, lo=None, hi=None, **props):
    """Empty used as a pivot. kind: hinge | slide | spin | group. axis: Blender-local letter, stored in glTF space."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = .4
    ob.empty_display_type = 'ARROWS'
    _place(ob, parent, TR(loc, rot))
    if kind:
        ob['joint'] = kind
        if axis: ob['axis'] = list(AX[axis])
        if lo is not None: ob['min'] = lo
        if hi is not None: ob['max'] = hi
    for k, v in props.items():
        ob[k] = v
    return ob


def add(name, mb, parent=None, pivot=None, bevel=0, sharp=38, merge=1e-4, **props):
    """Turn a builder into an object. Geometry is authored in ship space; pivot = the object's world matrix."""
    if isinstance(parent, bpy.types.Object): parent = parent.name
    world = pivot if pivot is not None else (WORLD[parent] if parent else Matrix.Identity(4))
    inv = world.inverted()
    me = bpy.data.meshes.new(name)
    me.from_pydata([inv @ v for v in mb.v], [], mb.f)
    names = []
    for m in mb.fm:
        if m not in names: names.append(m)
    for m in names: me.materials.append(bpy.data.materials[m])
    me.polygons.foreach_set('material_index', [names.index(m) for m in mb.fm])
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    lm = [m for m, f in zip(mb.fm, mb.f) for _ in f]
    ca.data.foreach_set('color', [x for m, c in zip(lm, mb.lc) for x in (*vcol(m, c), 1.0)])
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', [x for t in mb.luv for x in t])
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
    if bevel:
        ed = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(50)]
        bmesh.ops.bevel(bm, geom=ed, offset=bevel, segments=1, affect='EDGES', clamp_overlap=True, profile=.5)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle(0) < math.radians(sharp)
    bm.to_mesh(me)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    bm.free()
    STATS[name] = tris
    ob = bpy.data.objects.new(name, me)
    _place(ob, parent, world)
    for k, v in props.items(): ob[k] = v
    return ob


def grid_obj(name, P, mat, parent=None, pivot=None, colfn=None, keys=None, flip=False, uvsize=(1, 1), **props):
    """Shared-vertex cloth grid with optional shape keys (same shape as P)."""
    if isinstance(parent, bpy.types.Object): parent = parent.name
    world = pivot if pivot is not None else (WORLD[parent] if parent else Matrix.Identity(4))
    inv = world.inverted()
    ni, nj = len(P), len(P[0])
    idx = lambda i, j: i * nj + j
    verts = [inv @ Vector(P[i][j]) for i in range(ni) for j in range(nj)]
    faces, cols, uvs = [], [], []
    base = lin(MATS[mat]['col'])
    for i in range(ni - 1):
        for j in range(nj - 1):
            q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if flip: q.reverse()
            faces.append([idx(*t) for t in q])
            c = colfn(i, j) if colfn else base
            c = lin(c) if isinstance(c, str) else c
            cols += [c] * 4
            uvs += [(a / (ni - 1) * uvsize[0], (1 - b / (nj - 1)) * uvsize[1]) for a, b in q]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(bpy.data.materials[mat])
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    ca.data.foreach_set('color', [x for c in cols for x in (*vcol(mat, c), 1.0)])
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', [x for t in uvs for x in t])
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    _place(ob, parent, world)
    if keys:
        ob.shape_key_add(name='Basis')
        for kn, K in keys.items():
            sk = ob.shape_key_add(name=kn)
            for i in range(ni):
                for j in range(nj):
                    sk.data[idx(i, j)].co = inv @ Vector(K[i][j])
            sk.value = 0.0
    STATS[name] = len(faces) * 2
    for k, v in props.items(): ob[k] = v
    return ob


def lerp(a, b, t): return a + (b - a) * t
def clamp(x, a=0., b=1.): return max(a, min(b, x))
def smooth(x): x = clamp(x); return x * x * (3 - 2 * x)
def vl(a, b, t): return Vector(a).lerp(Vector(b), t)


def catenary(a, b, sag, n=8):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / n) - Vector((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]
