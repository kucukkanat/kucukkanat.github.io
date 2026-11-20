"""KANAT-1 handheld: original design. Chunky rounded orange slab, landscape.
Group `Handheld` (origin = body centre), children: Handheld_body, Handheld_screen (material Screen,
UV 0..1 over the screen), Handheld_slot (empty, +Y out of the cartridge slot)."""
import math
import bpy
from mathutils import Vector, Matrix
from . import util, layout as L
from .util import MB, empty, mat3, world_point


def rrect(w, h, r, n=5, cx=0.0, cy=0.0):
    pts = []
    for (qx, qy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
                         (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + qx + r * math.cos(a), cy + qy + r * math.sin(a)))
    return pts


def pose():
    """Handheld world transform (three space). Rests on the map, leaning back."""
    rot = mat3((0, 0, 0), pitch=L.HH_PITCH)
    # lowest point of the body (bottom edge, front/back) after rotation
    lows = []
    for z in (-L.HH_T / 2, L.HH_T / 2):
        v = rot @ Vector((0, -L.HH_H / 2, z))
        lows.append(v.y)
    y = L.MAP_Y - min(lows) + 0.001
    x, _, z = L.HH_POS
    return mat3((x, y, z), pitch=L.HH_PITCH)


def build(C):
    M = pose()
    center = world_point(M, (0, 0, 0))
    grp = empty("Handheld", center, pitch=L.HH_PITCH, collection=C, size=0.05)
    W, H, T = L.HH_W, L.HH_H, L.HH_T
    zf = T / 2                                # front face
    b = MB("Handheld_body", smooth_angle=40)
    # main shell: two slabs give a soft "pillow" edge
    b.prism(rrect(W, H, 0.034, 6), T * 0.8, (0, 0, 0), "OrangePlastic", plane='xy', bevel=0.006, seg=2)
    b.prism(rrect(W - 0.008, H - 0.008, 0.03, 6), T, (0, 0, 0), "OrangePlastic", plane='xy', bevel=0.005, seg=2)
    # back grip ridges
    for sx in (-1, 1):
        b.prism(rrect(0.05, H - 0.02, 0.02, 4), 0.012, (sx * 0.075, -0.004, -zf - 0.004), "OrangePlastic", plane='xy', bevel=0.004)
    # screen bezel (dark), slightly proud
    sy = L.HH_SCREEN_Y
    b.prism(rrect(L.HH_SCREEN_W + 0.016, L.HH_SCREEN_H + 0.014, 0.008, 3), 0.004, (0, sy, zf + 0.001), "BezelPlastic", plane='xy', bevel=0.0015, seg=1)
    # d-pad (cross) on the left, on a shallow round well
    dx, dy = -0.083, 0.008
    b.cyl(0.023, 0.002, (dx, dy, zf + 0.0005), "DarkPlastic", axis='z', segs=20)
    b.box((0.036, 0.012, 0.007), (dx, dy, zf + 0.004), "CreamPlastic", bevel=0.0025)
    b.box((0.012, 0.036, 0.007), (dx, dy, zf + 0.004), "CreamPlastic", bevel=0.0025)
    # three square buttons on the right (triangle layout)
    for (bx, by) in ((0.073, 0.02), (0.093, 0.02), (0.083, 0.0)):
        b.box((0.0125, 0.0125, 0.007), (bx, by, zf + 0.003), "CreamPlastic", bevel=0.0025)
    # small round start/select pills under the screen edge
    for sx in (-1, 1):
        b.box((0.012, 0.004, 0.003), (sx * 0.083, -0.03, zf + 0.0015), "BezelPlastic", bevel=0.0012)
    # speaker grilles: three slots under the d-pad and under the buttons
    for gx in (-0.083, 0.083):
        for k in range(3):
            b.box((0.016, 0.0022, 0.002), (gx, -0.038 - k * 0.0045, zf + 0.0005), "BezelPlastic")
    # cartridge slot on top
    b.box((0.074, 0.006, 0.02), (0, H / 2 - 0.001, 0), "BezelPlastic", bevel=0.0015)
    b.box((0.066, 0.004, 0.004), (0, H / 2 + 0.001, 0), "Iron")
    # shoulder bumpers
    for sx in (-1, 1):
        b.box((0.04, 0.008, 0.02), (sx * 0.07, H / 2 - 0.002, -0.004), "DarkPlastic", bevel=0.003)
    # fold-out kickstand behind (touches the table)
    hinge = Vector((0, 0.02, -zf - 0.002))
    Mi = mat3((0, 0, 0), pitch=L.HH_PITCH)
    hw = Mi @ hinge
    floor_y = L.MAP_Y - world_point(M, (0, 0, 0))[1]
    foot = Vector((0, floor_y + 0.003, hw.z - 0.05))
    leg_w = Mi.inverted() @ foot - hinge
    ln = leg_w.length
    ang = math.degrees(math.atan2(-leg_w.z, -leg_w.y))
    mid = hinge + leg_w / 2
    b.box((0.08, ln, 0.004), tuple(mid), "DarkPlastic", bevel=0.0015, pitch=ang)
    body = b.build(origin=(0, 0, 0), collection=C)
    body.parent = grp

    s = MB("Handheld_screen", smooth_angle=0)
    w2, h2 = L.HH_SCREEN_W / 2, L.HH_SCREEN_H / 2
    zs = zf + 0.0052
    s.quad([(-w2, sy - h2, zs), (w2, sy - h2, zs), (w2, sy + h2, zs), (-w2, sy + h2, zs)], "Screen")
    scr = s.build(origin=(0, 0, 0), collection=C)
    scr.parent = grp

    slot = empty("Handheld_slot", collection=C, size=0.02, kind='SINGLE_ARROW')
    slot.location = util.T(0, H / 2 + 0.003, 0)
    slot.parent = grp

    screen_c = world_point(M, (0, sy, zs))
    n = (M.to_3x3() @ Vector((0, 0, 1))).normalized()
    # 16:9 view at 50deg vertical FOV: visible height = 2 d tan(25)
    d = (L.HH_SCREEN_H * 1.06) / (2 * math.tan(math.radians(25)))
    screen_cam = tuple(Vector(screen_c) + n * d)
    cen = Vector(center)
    return {
        "center": center,
        "screen_c": screen_c,
        "screen_cam": screen_cam,
        "handheld_cam": tuple(cen + Vector((0.0, 0.14, 0.36))),
        "handheld_tgt": tuple(cen + Vector((0.0, -0.01, -0.05))),
    }
