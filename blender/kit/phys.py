"""Physics round (2026-11-20): swinging ropes and hanging things. See docs/SCENE_CONTRACT.md
"Physics round additions".

- `skinned_rope()` builds a `ROPE_<name>` skinned mesh (smooth twisted-strand rope from fix.rope) with an
  armature `Rig_<name>` whose bones `ROPE_<name>_0..N` run from the fixed top end down the rope.
  Weights blend linearly between neighbouring bone heads along the rope's arc length, so it bends smoothly.
  Sagging spans tied at both ends get `pinned_end = 1` (glTF extras) and their last bone head sits on the tie.
- `swing_group()` makes a `SWING_<name>` empty at the hanging point with custom props `length` / `mass`.
- `pin_rail_static()` / `hanks()`: belaying-pin rail on the left wall with neatly hanked coils (replaces the
  old left-wall rope + hanging coil, which read as a noose).

Authored in three.js coordinates like the rest of the kit."""
import math
import random
import bpy
import numpy as np
from mathutils import Vector, Matrix
from . import util, layout as L
from .util import MB, empty, mat3, world_point, T, C3B

ROPES = []      # dicts for NOTES / logs
SWINGS = []

C3 = C3B.to_3x3()

# belaying-pin rail on the left wall (three coords): rail centre
RAIL_C = (-L.X_HALF + 0.09, 1.5, -0.45)
RAIL_LEN = 0.68
RAIL_H, RAIL_D = 0.05, 0.055
PIN_DZ = (-0.235, 0.0, 0.235)


# ----------------------------------------------------------------- skinned ropes

def _dense(pts, step, spline):
    from .fix import _catmull
    P = _catmull(pts, step) if spline else [Vector(p) for p in pts]
    out = [P[0]]
    for a, b in zip(P[:-1], P[1:]):
        n = max(1, int(math.ceil((b - a).length / 0.01)))
        for k in range(1, n + 1):
            out.append(a.lerp(b, k / n))
    return out


def _arc(P):
    s = [0.0]
    for a, b in zip(P[:-1], P[1:]):
        s.append(s[-1] + (b - a).length)
    return s


def _at(P, S, s):
    for i in range(1, len(S)):
        if S[i] >= s - 1e-9:
            seg = S[i] - S[i - 1]
            t = 0.0 if seg < 1e-12 else (s - S[i - 1]) / seg
            return P[i - 1].lerp(P[i], t), (P[i] - P[i - 1]).normalized()
    return P[-1].copy(), (P[-1] - P[-2]).normalized()


def skinned_rope(C, name, pts, r, sides=10, pinned=False, nbones=None, step=0.02, spline=True, extras=None, ring_len=0.12):
    """pts: control points from the FIXED TOP END down the rope (three coords)."""
    from .fix import rope
    full = "ROPE_" + name
    mb = MB(full, smooth_angle=60)
    # skinned ropes need rings along straight runs too, or they cannot bend
    rope(mb, pts, r, sides=sides, spline=spline, step=step, max_len=ring_len)
    if extras:
        extras(mb)
    P = _dense(pts, step, spline)
    S = _arc(P)
    Lt = S[-1]
    nb = nbones or max(6, min(12, int(round(Lt / 0.2)) + 1))
    if pinned:
        hs = [Lt * i / (nb - 1) for i in range(nb)]
    else:
        hs = [Lt * i / nb for i in range(nb)]
    heads = [_at(P, S, s)[0] for s in hs]
    tails = heads[1:]
    if pinned:
        p, d = _at(P, S, Lt)
        tails.append(p + d * (Lt / (nb - 1)) * 0.5)
    else:
        tails.append(P[-1].copy())
    top = heads[0].copy()
    ob = mb.build(origin=tuple(top), collection=C)
    # armature at the top end
    ad = bpy.data.armatures.new("Rig_" + name)
    arm = bpy.data.objects.new("Rig_" + name, ad)
    C.objects.link(arm)
    arm.location = T(*top)
    ad.display_type = 'STICK'
    arm.show_in_front = True
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    prev = None
    for i in range(nb):
        eb = ad.edit_bones.new(f"{full}_{i}")
        eb.head = C3 @ (heads[i] - top)
        eb.tail = C3 @ (tails[i] - top)
        if prev is not None:
            eb.parent = prev
            eb.use_connect = True
        prev = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    arm.select_set(False)
    # weights: project each vertex on the rope path -> arc length -> blend between neighbouring heads
    me = ob.data
    V = np.array([C3.inverted() @ v.co for v in me.vertices]) + np.array(top)
    A = np.array([tuple(p) for p in P[:-1]])
    B = np.array([tuple(p) for p in P[1:]])
    AB = B - A
    l2 = np.maximum((AB * AB).sum(1), 1e-12)
    best_s = np.zeros(len(V))
    Sa = np.array(S[:-1])
    seg_len = np.sqrt(l2)
    for k0 in range(0, len(V), 512):
        v = V[k0:k0 + 512]
        t = np.clip(((v[:, None, :] - A[None]) * AB[None]).sum(2) / l2[None], 0, 1)
        q = A[None] + t[:, :, None] * AB[None]
        d = ((v[:, None, :] - q) ** 2).sum(2)
        j = d.argmin(1)
        best_s[k0:k0 + 512] = Sa[j] + t[np.arange(len(v)), j] * seg_len[j]
    groups = [ob.vertex_groups.new(name=f"{full}_{i}") for i in range(nb)]
    sp = hs[1] - hs[0]
    for vi, s in enumerate(best_s):
        f = s / sp
        i = int(math.floor(f))
        t = f - i
        if i >= nb - 1:
            groups[nb - 1].add([vi], 1.0, 'REPLACE')
            continue
        i = max(i, 0)
        if t < 1e-4:
            groups[i].add([vi], 1.0, 'REPLACE')
        else:
            groups[i].add([vi], 1.0 - t, 'REPLACE')
            groups[i + 1].add([vi], t, 'REPLACE')
    ob.parent = arm
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.location = (0, 0, 0)
    mod = ob.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm
    if pinned:
        ob["pinned_end"] = 1
    ROPES.append({"name": full, "top": tuple(round(c, 3) for c in top),
                  "end": tuple(round(c, 3) for c in P[-1]), "length": round(Lt, 3), "bones": nb,
                  "pinned_end": 1 if pinned else 0, "r": r})
    return arm, ob


# ----------------------------------------------------------------- swing pivots

def swing_group(C, name, pivot, length, mass):
    grp = empty("SWING_" + name, pivot, collection=C, size=0.05)
    grp["length"] = float(length)
    grp["mass"] = float(mass)
    SWINGS.append({"name": "SWING_" + name, "pivot": tuple(round(c, 3) for c in pivot), "length": length, "mass": mass})
    return grp


def swing_child(C, grp, mb):
    ob = mb.build(origin=(0, 0, 0), collection=C)
    ob.parent = grp
    ob.location = (0, 0, 0)
    return ob


# ----------------------------------------------------------------- belaying-pin rail + hanked coils

def _pin_profile():
    """Turned belaying pin, y relative to the rail top (rail is RAIL_H thick)."""
    return [(0.0, -RAIL_H - 0.12), (0.006, -RAIL_H - 0.118), (0.0085, -RAIL_H - 0.1), (0.0095, -RAIL_H),
            (0.0095, 0.0), (0.017, 0.0), (0.018, 0.006), (0.012, 0.012), (0.0105, 0.03), (0.0135, 0.07),
            (0.0145, 0.1), (0.0125, 0.115), (0.0055, 0.123), (0.0, 0.124)]


def pin_rail_static(p):
    """Rail, brackets and pins (STATIC_props, lightmapped)."""
    from .polish import lathe
    cx, cy, cz = RAIL_C
    wall = -L.X_HALF
    p.box((RAIL_D, RAIL_H, RAIL_LEN), (cx, cy - RAIL_H / 2, cz), "DarkWood", bevel=0.01, grain='z')
    for dz in (-RAIL_LEN / 2 + 0.06, RAIL_LEN / 2 - 0.06):
        # shaped knee bracket: wall plate + diagonal brace under the rail
        p.box((0.022, 0.16, 0.05), (wall + 0.011, cy - 0.07, cz + dz), "DarkWood", bevel=0.006)
        p.prism([(0.0, 0.0), (cx - wall + RAIL_D / 2 - 0.022, 0.0), (0.0, -0.13)], 0.04,
                (wall + 0.022, cy - RAIL_H, cz + dz), "DarkWood", plane='xy', bevel=0.004)
        p.sphere(0.006, (cx + RAIL_D / 2 + 0.001, cy - RAIL_H / 2, cz + dz), "Brass", segs=6, rings=3, sy=0.5)
    for dz in PIN_DZ:
        with p.frame((cx, cy, cz + dz)):
            lathe(p, _pin_profile(), "Mahogany", segs=8)


def _hank(mb, pin, n, D, r, dx0, seed, sides=6, npts=12):
    """Neat hank hung flat on a vertical belaying pin: n round loops of slightly varying size, their tops
    gathered over the pin's neck, the hank hanging in front of the rail. No loose ends, no wraps."""
    from .fix import rope
    rnd = random.Random(seed)
    px, py, pz = pin
    yn = py + 0.022                   # neck of the pin, just above the rail
    for i in range(n):
        k = i - (n - 1) / 2
        d = D * (1.0 + 0.06 * rnd.uniform(-1, 1) - 0.02 * abs(k))
        a = 0.5 * d * (1.0 + 0.04 * rnd.uniform(-1, 1))          # half-width (z)
        b = 0.5 * d * 1.3                                        # half-height (y): a hung oval hank
        dx = dx0 + i * 1.75 * r                                  # stack the loops toward the room
        tilt = math.radians(rnd.uniform(-5, 5) + k * 1.2)
        shift = rnd.uniform(-0.008, 0.008)
        pts = []
        for j in range(npts):
            th = 2 * math.pi * j / npts                          # 0 = top (at the pin)
            w = (0.5 + 0.5 * math.cos(th)) ** 10                  # 1 at the top, 0 elsewhere
            z = a * math.sin(th) * (1 - 0.55 * w)
            y = -b * (1 - math.cos(th)) * (1 - 0.06 * w)
            zz = z * math.cos(tilt) - y * math.sin(tilt) + shift * (1 - w)
            yy = z * math.sin(tilt) + y * math.cos(tilt)
            # in front of the rail, but the very top goes back round the pin's neck
            x = dx * (1 - w) + (-0.004 - 0.6 * r + 0.004 * i) * w
            pts.append((px + x, yn + yy, pz + zz))
        rope(mb, pts, r, sides=sides, closed=True, spline=False)


def hanks(mb):
    cx, cy, cz = RAIL_C
    px = cx
    _hank(mb, (px, cy, cz + PIN_DZ[0]), 6, 0.25, 0.0095, 0.05, seed=5)
    _hank(mb, (px, cy, cz + PIN_DZ[1]), 5, 0.2, 0.0085, 0.05, seed=9)
    _hank(mb, (px, cy, cz + PIN_DZ[2]), 6, 0.24, 0.0095, 0.05, seed=13)
