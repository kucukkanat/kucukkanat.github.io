"""Mesh-building helpers.

Everything in this package is authored in **three.js coordinates** (metres, +Y up,
+Z toward the visitor). Conversion to Blender (Z-up) happens only when an object is
created: three (x, y, z) -> Blender (x, -z, y). The glTF exporter converts back, so
names/positions in docs/SCENE_CONTRACT.md can be typed here verbatim.
"""
import math
import random
import zlib
import bpy
import bmesh
from mathutils import Matrix, Vector

# three -> blender rotation (det +1)
C3B = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def T(x, y, z):
    """three.js point -> Blender Vector."""
    return Vector((x, -z, y))


def mat3(pos=(0, 0, 0), yaw=0.0, pitch=0.0, roll=0.0, scale=1.0):
    """4x4 transform in three.js space. Angles in degrees.
    Applied as roll(Z) -> pitch(X) -> yaw(Y)."""
    m = (Matrix.Translation(Vector(pos))
         @ Matrix.Rotation(math.radians(yaw), 4, 'Y')
         @ Matrix.Rotation(math.radians(pitch), 4, 'X')
         @ Matrix.Rotation(math.radians(roll), 4, 'Z'))
    if scale != 1.0:
        m = m @ Matrix.Scale(scale, 4)
    return m


def euler_b(yaw=0.0, pitch=0.0, roll=0.0):
    """Blender rotation_euler for a three.js yaw/pitch/roll (deg)."""
    m = mat3((0, 0, 0), yaw, pitch, roll)
    return (C3B @ m @ C3B.inverted()).to_euler('XYZ')


# ---------------------------------------------------------------- materials

TILE = {}          # material name -> metres per texture repeat (for box UVs)


def tile_of(matname):
    return TILE.get(matname, 1.0)


# ---------------------------------------------------------------- builder

class MB:
    """Accumulates primitives (in three.js coords) into one mesh object."""

    def __init__(self, name, smooth_angle=35, flat=False):
        self.name = name
        self.flat = flat
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []
        self.stack = [Matrix.Identity(4)]
        self.smooth_angle = smooth_angle
        self.rng = random.Random(zlib.crc32(name.encode()))

    # frames ---------------------------------------------------------
    class _Frame:
        def __init__(self, mb, m):
            self.mb, self.m = mb, m

        def __enter__(self):
            self.mb.stack.append(self.mb.stack[-1] @ self.m)
            return self.mb

        def __exit__(self, *a):
            self.mb.stack.pop()

    def frame(self, pos=(0, 0, 0), yaw=0, pitch=0, roll=0):
        return MB._Frame(self, mat3(pos, yaw, pitch, roll))

    def mat_index(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    # core: merge a temp bmesh ---------------------------------------
    def _merge(self, tb, mat, local=Matrix.Identity(4), uv='box', grain='y',
               tile=None, smooth=True, uvfix=None):
        """tb: temp bmesh in primitive-local three coords."""
        uvl = tb.loops.layers.uv.get('UVMap') or tb.loops.layers.uv.new('UVMap')
        mi = self.mat_index(mat)
        t = tile or tile_of(mat)
        off = (self.rng.random(), self.rng.random())
        if uv == 'box':
            # fix round: untextured materials get no UV seams at all (fewer split vertices); small brass
            # parts get a seamless position-based mapping
            m_ = bpy.data.materials.get(mat)
            if m_ is not None and m_.node_tree and not m_.node_tree.nodes.get("BaseTex"):
                uv = 'zero'
            elif mat in ("Brass", "Gilt"):
                uv = 'pos'
        if uv == 'zero':
            for f in tb.faces:
                for l in f.loops:
                    l[uvl].uv = (0.0, 0.0)
        elif uv == 'pos':
            for f in tb.faces:
                for l in f.loops:
                    co = l.vert.co
                    l[uvl].uv = ((co.x + 0.55 * co.z) / t + off[0], (co.y - 0.35 * co.z) / t + off[1])
        elif uv == 'box':
            for f in tb.faces:
                n = f.normal
                ax = max(range(3), key=lambda i: abs(n[i]))
                for l in f.loops:
                    co = l.vert.co
                    if ax == 0:      # side faces: (z, y)
                        a, b = co.z, co.y
                        ga = 'z'
                    elif ax == 2:    # front/back: (x, y)
                        a, b = co.x, co.y
                        ga = 'x'
                    else:            # top/bottom: (x, z)
                        a, b = co.x, co.z
                        ga = 'x'
                    # texture grain runs along v. put the grain axis on v.
                    if grain == ga:
                        a, b = b, a
                    l[uvl].uv = (a / t + off[0], b / t + off[1])
        elif callable(uv):
            for f in tb.faces:
                for l in f.loops:
                    l[uvl].uv = uv(l.vert.co, f)
        for f in tb.faces:
            f.material_index = mi
            f.smooth = smooth and not self.flat
        if uvfix:
            uvfix(tb, uvl)
        tb.transform(self.stack[-1] @ local)
        tmp = bpy.data.meshes.new("tmp")
        tb.to_mesh(tmp)
        tb.free()
        # bm.from_mesh appends; uv layer named UVMap carries over
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    # primitives ------------------------------------------------------
    def box(self, size, center=(0, 0, 0), mat="Wood", bevel=0.0, seg=1,
            yaw=0, pitch=0, roll=0, grain='y', tile=None, uv='box'):
        tb = bmesh.new()
        bmesh.ops.create_cube(tb, size=1.0)
        bmesh.ops.scale(tb, vec=Vector(size), verts=tb.verts)
        if bevel > 0:
            bw = min(bevel, min(size) * 0.45)
            bmesh.ops.bevel(tb, geom=list(tb.edges), offset=bw, segments=seg,
                            affect='EDGES', profile=0.5, clamp_overlap=True)
        bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
        self._merge(tb, mat, mat3(center, yaw, pitch, roll), uv=uv, grain=grain, tile=tile)

    def cyl(self, r, h, center=(0, 0, 0), mat="Brass", segs=12, r2=None,
            axis='y', yaw=0, pitch=0, roll=0, bevel=0.0, cap=True, grain='y', tile=None,
            smooth=True):
        """Cylinder/cone along local axis, centred at center."""
        tb = bmesh.new()
        bmesh.ops.create_cone(tb, cap_ends=cap, cap_tris=False, segments=segs,
                              radius1=r, radius2=(r if r2 is None else r2), depth=h)
        # bmesh cone axis is Z -> make it Y (three up)
        bmesh.ops.rotate(tb, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'),
                         verts=tb.verts)
        if bevel > 0 and cap:
            rim = [e for e in tb.edges if not e.is_manifold or
                   (len(e.link_faces) == 2 and e.link_faces[0].normal.angle(e.link_faces[1].normal) > 0.8)]
            bmesh.ops.bevel(tb, geom=rim, offset=bevel, segments=2, affect='EDGES',
                            profile=0.5, clamp_overlap=True)
        if axis == 'x':
            bmesh.ops.rotate(tb, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'Z'), verts=tb.verts)
        elif axis == 'z':
            bmesh.ops.rotate(tb, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'), verts=tb.verts)
        bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
        self._merge(tb, mat, mat3(center, yaw, pitch, roll), grain=grain, tile=tile, smooth=smooth)

    def sphere(self, r, center=(0, 0, 0), mat="Brass", segs=10, rings=6, sy=1.0):
        tb = bmesh.new()
        bmesh.ops.create_uvsphere(tb, u_segments=segs, v_segments=rings, radius=r)
        bmesh.ops.scale(tb, vec=(1, 1, sy), verts=tb.verts)
        bmesh.ops.rotate(tb, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'), verts=tb.verts)
        self._merge(tb, mat, mat3(center))

    def torus(self, R, r, center=(0, 0, 0), mat="Brass", seg=24, rseg=8, axis='z',
              yaw=0, pitch=0, roll=0, arc=360.0, a0=0.0):
        """Torus in the plane perpendicular to `axis` (default: ring in XY plane, facing +Z)."""
        tb = bmesh.new()
        full = abs(arc - 360.0) < 1e-6
        n = seg if full else seg + 1
        rings = []
        for i in range(n):
            a = math.radians(a0 + arc * i / seg)
            ring = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                rr = R + r * math.cos(b)
                ring.append(tb.verts.new((rr * math.cos(a), rr * math.sin(a), r * math.sin(b))))
            rings.append(ring)
        rng = range(n) if full else range(n - 1)
        for i in rng:
            r0, r1 = rings[i], rings[(i + 1) % n]
            for j in range(rseg):
                tb.faces.new((r0[j], r1[j], r1[(j + 1) % rseg], r0[(j + 1) % rseg]))
        if not full:
            tb.faces.new(rings[0][::-1])
            tb.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
        if axis == 'y':
            bmesh.ops.rotate(tb, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, 'X'), verts=tb.verts)
        elif axis == 'x':
            bmesh.ops.rotate(tb, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=tb.verts)
        self._merge(tb, mat, mat3(center, yaw, pitch, roll))

    def prism(self, pts2d, depth, center=(0, 0, 0), mat="Wood", plane='xy', bevel=0.0,
              yaw=0, pitch=0, roll=0, grain='y', tile=None, uv='box', seg=2):
        """Extrude a 2D polygon (CCW) by depth. plane 'xy': polygon in XY, extruded along Z.
        plane 'xz': polygon in XZ (x, z), extruded along Y."""
        tb = bmesh.new()
        vs = []
        for (a, b) in pts2d:
            if plane == 'xy':
                vs.append(tb.verts.new((a, b, -depth / 2)))
            else:
                vs.append(tb.verts.new((a, -depth / 2, b)))
        f = tb.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(tb, geom=[f])
        nv = [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]
        d = Vector((0, 0, depth)) if plane == 'xy' else Vector((0, depth, 0))
        bmesh.ops.translate(tb, vec=d, verts=nv)
        bmesh.ops.recalc_face_normals(tb, faces=tb.faces)
        if bevel > 0:
            bmesh.ops.bevel(tb, geom=list(tb.edges), offset=bevel, segments=seg,
                            affect='EDGES', profile=0.5, clamp_overlap=True)
        self._merge(tb, mat, mat3(center, yaw, pitch, roll), uv=uv, grain=grain, tile=tile)

    def quad(self, corners, mat, uvs=((0, 0), (1, 0), (1, 1), (0, 1))):
        """Single quad with explicit UVs; corners CCW seen from the front."""
        tb = bmesh.new()
        vs = [tb.verts.new(c) for c in corners]
        f = tb.faces.new(vs)
        uvl = tb.loops.layers.uv.get('UVMap') or tb.loops.layers.uv.new('UVMap')
        for l, uvv in zip(f.loops, uvs):
            l[uvl].uv = uvv
        self._merge(tb, mat, uv=None, smooth=False)

    def raw(self, tb, mat, uv='box', grain='y', tile=None, smooth=True, local=Matrix.Identity(4)):
        self._merge(tb, mat, local, uv=uv, grain=grain, tile=tile, smooth=smooth)

    # finish ----------------------------------------------------------
    def build(self, origin=(0, 0, 0), collection=None, parent=None, materials=None):
        """Create the Blender object. origin (three, world) becomes the object origin."""
        self.bm.transform(Matrix.Translation(-Vector(origin)))
        self.bm.transform(C3B)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for f in me.polygons:
            pass
        if self.smooth_angle:
            try:
                me.set_sharp_from_angle(angle=math.radians(self.smooth_angle))
            except Exception:
                pass
        for mn in self.mats:
            me.materials.append(materials(mn) if materials else bpy.data.materials.get(mn))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        ob.location = T(*origin)
        if parent:
            bpy.context.view_layer.update()
            ob.parent = parent
            ob.matrix_parent_inverse = parent.matrix_world.inverted()
        return ob


def empty(name, pos=(0, 0, 0), yaw=0, pitch=0, roll=0, size=0.1, collection=None,
          parent=None, kind='PLAIN_AXES'):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    (collection or bpy.context.scene.collection).objects.link(ob)
    ob.location = T(*pos)
    ob.rotation_euler = euler_b(yaw, pitch, roll)
    if parent:
        bpy.context.view_layer.update()
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob


def world_point(m, p):
    """Apply a three-space 4x4 to a point (tuple) -> tuple."""
    v = m @ Vector(p)
    return (v.x, v.y, v.z)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
