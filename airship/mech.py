"""Moving parts. Every mover is an empty at its hinge/slide axis (custom props describe the joint) with mesh children.
Props: joint = hinge | slide | spin, axis (glTF space, local), min/max (deg or m), sign (multiply the value: mirrored twins
then share one control), label, group."""
import math
from mathutils import Vector, Matrix
import kit, hull
from kit import MB, add, joint, grid_obj, lerp, clamp, catenary, lin, MATS, TR, R, WORLD
from hull import (zs, bs, section, castle_w, fc_w, arc_pt, XQ, XF, XC, QD, FC, QD_WALL, FC_WALL, PORTS, PORT_HALF,
                  PORT_Z0, PORT_Z1, GATE, MAIN_X)

CREAM, ORANGE = MATS['Sail']['col'], MATS['PaintOrange']['col']
SIDES = ((1, 'L'), (-1, 'R'))
rad = math.radians


def P3(a, r, up):
    a = rad(a)
    return Vector((r * math.sin(a), r * math.cos(a), r * math.tan(rad(up))))


def fan(mb, ribs, up=7, r_in=.7, rib_r=.1):
    """Ribbed membrane fin in a local frame: root at the origin, +Y outboard, +X forward."""
    for a, L in ribs:
        mb.tube([P3(a, .15, up), P3(a, L * .6, up), P3(a, L + .15, up)], [rib_r, rib_r * .75, rib_r * .3], 'Spar', segs=6)
    for (a0, L0), (a1, L1) in zip(ribs, ribs[1:]):
        n = 4
        def pt(t, f):
            L = lerp(L0, L1, t) * (1 - .1 * math.sin(math.pi * t))
            p = P3(lerp(a0, a1, t), lerp(r_in, L, f), up)
            p.z -= .12 * math.sin(math.pi * t) * f
            return p
        for k in range(n):
            ta, tb = k / n, (k + 1) / n
            for f0, f1, col in ((0, .36, CREAM), (.36, .7, CREAM), (.7, 1, ORANGE)):
                mb.face([pt(ta, f0), pt(tb, f0), pt(tb, f1), pt(ta, f1)], 'Sail', col, var=.04)
    mb.ball((0, 0, 0), .26, 'Brass')


def lantern(mb, p, k=1.0):
    with mb.at(p):
        mb.lathe([(0, 0), (.17 * k, 0), (.19 * k, .05 * k), (.14 * k, .1 * k)], 'Brass', segs=6)
        mb.lathe([(.14 * k, .1 * k), (.19 * k, .3 * k), (.15 * k, .5 * k)], 'LanternGlow', segs=6, var=0)
        mb.lathe([(.22 * k, .5 * k), (.11 * k, .62 * k), (.05 * k, .74 * k), (0, .78 * k)], 'Brass', segs=6)
        for i in range(6):
            a = math.pi / 3 * i
            c, s = math.cos(a), math.sin(a)
            mb.tube([(.145 * k * c, .145 * k * s, .1 * k), (.2 * k * c, .2 * k * s, .3 * k), (.155 * k * c, .155 * k * s, .5 * k)], .016 * k, 'Brass', segs=4)
        mb.torus(.06 * k, .012 * k, 'Brass', segs=8, tsegs=4)


def build(root):
    # ================= rudder + steering wheel ===================================
    tilt = -math.degrees(math.atan2(1.46, 3.55))
    base = TR((-9.9, 0, -.35), (0, tilt, 0))
    J = joint('Rudder', base @ Vector((-.3, 0, .12)), (0, tilt, 0), root, kind='hinge', axis='Z', lo=-35, hi=35,
              label='Rudder', group='Flight controls', note='hinge line = aft face of the raked sternpost')
    mb = MB(50)
    with mb.at(M=WORLD['Rudder']):
        with mb.at(rot=(90, 0, 0)):
            mb.prism([(0, 0), (-1.7, -.1), (-2.3, .5), (-2.4, 2.2), (-1.5, 3.1), (0, 3.3)], -.12, .12, 'HullDark')
        mb.cyl((.02, 0, 3.2), (.02, 0, 4.3), .13, 'Iron', segs=8)
        for z in (.35, 1.25, 2.15, 3.0):
            mb.box((1.3, .3, .1), (-.55, 0, z), 'Iron')
        hub = Vector((-1.6, 0, 1.6))
        tips = [Vector((-4.3, 0, 3.4)), Vector((-4.9, 0, 2.3)), Vector((-4.7, 0, 1.1)), Vector((-3.9, 0, 0.0))]
        for t in tips:
            mb.tube([hub, hub.lerp(t, .6), t], [.1, .07, .03], 'Spar', segs=6)
        for a, b in zip(tips, tips[1:]):
            m = (a + b) / 2; m = m.lerp(hub, .12)
            for f0, f1, col in ((.25, .7, CREAM), (.7, 1, ORANGE)):
                q = lambda p, f: hub.lerp(p, f)
                mb.face([q(a, f0), q(m, f0), q(m, f1), q(a, f1)], 'Sail', col, var=.04)
                mb.face([q(m, f0), q(b, f0), q(b, f1), q(m, f1)], 'Sail', col, var=.04)
    add('Rudder_blade', mb, J, bevel=0)

    wx, wz = -8.2, QD + 1.22
    J = joint('Wheel', (wx, 0, wz), parent=root, kind='spin', axis='X', lo=-540, hi=540, label='Helm wheel', group='Flight controls',
              drives='Rudder', ratio=35 / 540, note='tiller ropes: 5 turns on the barrel, down through the deck to the tiller under the cabin floor')
    mb = MB(51)
    with mb.at((wx, 0, wz), (0, 90, 0)):
        with mb.at((0, 0, -.05)): mb.torus(.66, .06, 'Trim', segs=24)
        mb.lathe([(0, -.14), (.15, -.14), (.17, 0), (.15, .1), (0, .1)], 'Brass', segs=10)
        for i in range(8):
            a = math.pi / 4 * i
            d = Vector((math.cos(a), math.sin(a), 0))
            z = Vector((0, 0, -.05))
            mb.tube([d * .12 + z, d * .62 + z, d * .72 + z, d * .98 + z], [.04, .035, .055, .03], 'Trim' if i else 'Brass', segs=6)
    add('Wheel_mesh', mb, J)

    st = MB(52)   # static deck fittings
    for dx in (-.3, .22):
        st.box((.14, .24, 1.3), (wx + dx, 0, QD + .65), 'Trim', top=(1, .6))
    st.cyl((wx - .34, 0, wz), (wx + .26, 0, wz), .1, 'Spar', segs=10)
    st.box((.55, .6, .95), (wx + 1.0, 0, QD + .47), 'Trim', top=(.8, .8))          # binnacle
    st.ball((wx + 1.0, 0, QD + .97), .2, 'Brass', sz=.7)

    # ================= lift stone, gyro rings and keel fin ========================
    C = Vector((-0.8, 0, -1.95)); RR = 1.5
    arc = lambda a0, a1, n: [(C.x + (RR + .12) * math.cos(rad(lerp(a0, a1, k / n))), C.z + (RR + .12) * math.sin(rad(lerp(a0, a1, k / n)))) for k in range(n + 1)]
    mb = MB(53)
    with mb.at(rot=(90, 0, 0)):
        mb.prism(arc(80, -65, 10) + [(2.0, -3.6), (5.8, -.42), (-.3, -.42)], -.13, .13, 'HullWood')
        mb.prism(arc(100, 245, 10) + [(-3.6, -3.55), (-7.4, -.42), (-1.3, -.42)], -.13, .13, 'HullWood')
        mb.prism([(5.8, -.42), (2.0, -3.6), (2.5, -3.6), (6.5, -.42)], -.15, .15, 'PaintOrange')
        mb.prism([(-7.4, -.42), (-3.6, -3.55), (-4.1, -3.55), (-8.1, -.42)], -.15, .15, 'PaintOrange')
    mb.beam([(-4.0, 0, -3.62), (2.4, 0, -3.68)], .36, .2, 'Brass', side=(0, 1, 0))
    with mb.at(C, (90, 0, 0)):
        mb.torus(RR, .14, 'Brass', segs=28)
    add('Keel_fin', mb, root, bevel=.02, note='ventral fin = lateral plane for weathervane stability; bottom skid is the landing shoe')
    G1 = joint('Gyro_ring', C, parent=root, kind='spin', axis='X', rpm=18, label='Gyro ring', group='Lift',
               note='heavy brass flywheel ring: gyroscopic roll stabiliser (the lift acts below the centre of mass)')
    mb = MB(54)
    with mb.at(C, (90, 0, 0)): mb.torus(1.27, .1, 'Brass', segs=24)
    for s in (1, -1): mb.cyl(C + Vector((s * 1.2, 0, 0)), C + Vector((s * 1.45, 0, 0)), .07, 'Iron', segs=6)
    for k in range(8):
        a = math.pi / 4 * k
        mb.ball(C + Vector((1.27 * math.cos(a), 0, 1.27 * math.sin(a))), .16, 'Iron', segs=6, rings=4)
    add('Gyro_ring_mesh', mb, G1)
    G2 = joint('Stone_cradle', C, parent=G1, kind='hinge', axis='Z', lo=-180, hi=180, label='Stone cradle', group='Lift')
    mb = MB(55)
    with mb.at(C, (90, 0, 0)): mb.torus(1.02, .07, 'Gilt', segs=22)
    for s in (1, -1):
        mb.cyl(C + Vector((0, 0, s * .96)), C + Vector((0, 0, s * 1.22)), .06, 'Iron', segs=6)
        mb.tube([C + Vector((0, 0, s * .96)), C + Vector((0, 0, s * .78))], [.1, .16], 'Gilt', segs=6)
    add('Stone_cradle_mesh', mb, G2)
    G3 = joint('Lift_stone', C, parent=G2, kind='spin', axis='Z', rpm=4, label='Lift stone', group='Lift', light=True, color='#7DF2DC', intensity=40)
    mb = MB(56)
    with mb.at(C):
        mb.lathe([(0, -.8), (.42, -.3), (.56, .1), (.34, .55), (0, .8)], 'LiftStone', segs=6, var=0)
    add('Lift_stone_mesh', mb, G3, sharp=5)

    # ================= outrigger propellers =======================================
    px, pz, py = -3.6, 2.5, 7.6
    for s, n in SIDES:
        y0 = section(px, .42)[0]
        st.cyl((px, s * (y0 - .2), 2.0), (px, s * py, pz), .2, 'Iron', r1=.16, segs=8)
        for dx in (-2.3, 2.3):
            st.cyl((px + dx, s * (section(px + dx, .72)[0] - .1), 3.3), (px, s * (py - 1.3), pz - .05), .08, 'Brass', segs=6)
        st.tube([(px, s * (py - 2.6), pz - .1), (px, s * (bs(px) - .1), zs(px) + 1.0)], .03, 'RopeDark', segs=4)
        N = joint('Nacelle_' + n, (px, s * py, pz), parent=root, kind='hinge', axis='Y', lo=-90, hi=30, label='Tilt propellers',
                  group='Propulsion', note='swivels about the drive-shaft boom like USS Akron: 0 = cruise thrust, -90 = thrust straight down (lift), +30 = braking/descent')
        mb = MB(57)
        with mb.at((px, s * py, pz), (0, 90, 0)):
            mb.lathe([(0, -1.25), (.3, -1.2), (.5, -.75), (.56, 0), (.5, .7), (.32, 1.15), (0, 1.3)], 'Brass', segs=12)
            for z in (-.6, .15, .8):
                mb.lathe([(.535, z - .06), (.6, z), (.535, z + .06)], 'HullDark', segs=12)
        mb.box((1.1, .06, .7), (px - .2, s * py, pz + .75), 'PaintOrange', top=(.5, 1))
        lantern(mb, (px + .3, s * (py + .62), pz - .2), .6)
        add(f'Nacelle_{n}_pod', mb, N)
        Pj = joint('Prop_' + n, (px - 1.3, s * py, pz), parent=N, kind='spin', axis='X', rpm=240 * s, label='Propellers', group='Propulsion',
                   note='pusher, 4 wooden blades, 3.8 m')
        mb = MB(58)
        o = Vector((px - 1.3, s * py, pz))
        with mb.at(o, (0, -90, 0)):
            mb.lathe([(0, -.05), (.24, -.05), (.26, .1), (.2, .45), (0, .62)], 'Brass', segs=10)
        for k in range(4):
            ph = math.pi / 2 * k
            e, t = Vector((0, math.cos(ph), math.sin(ph))), Vector((0, -math.sin(ph), math.cos(ph)))
            st_ = [(.22, .26, 58), (.7, .52, 42), (1.3, .6, 28), (1.75, .5, 21), (1.9, .25, 19)]
            pts = []
            for r_, c_, b_ in st_:
                d = (t * math.cos(rad(b_)) + Vector((s, 0, 0)) * math.sin(rad(b_))) * c_ / 2
                pts.append((o + e * r_ - d + Vector((-.25, 0, 0)), o + e * r_ + d + Vector((-.25, 0, 0))))
            for i, (a, b) in enumerate(zip(pts, pts[1:])):
                m, c = ('Brass', None) if i == 3 else ('Spar', None)
                mb.face([a[0], a[1], b[1], b[0]], m, c, var=.05); mb.face([a[0], b[0], b[1], a[1]], m, c, var=.05)
        add(f'Prop_{n}_blades', mb, Pj)

    # ================= wing fins and elevators ====================================
    for s, n in SIDES:
        fx, fz = 3.6, 3.3
        fy = section(fx, .7)[0] + .15
        st.box((.9, .4, .5), (fx, s * (fy - .12), fz), 'Brass', top=(.7, .7))
        SW = joint(f'Fin_{n}_sweep', (fx, s * fy, fz), parent=root, kind='hinge', axis='Z', lo=0, hi=65, sign=s, label='Sweep wing fins',
                   group='Flight controls', note='0 = spread, 65 = folded back along the hull (mooring, storm)')
        FL = joint(f'Fin_{n}', (fx, s * fy, fz), parent=SW, kind='hinge', axis='X', lo=-30, hi=30, sign=s, label='Flap wing fins',
                   group='Flight controls', note='ribbed membrane wing sail; both up = climb trim, differential = roll')
        mb = MB(59)
        with mb.at(scale=(1, s, 1)):
            with mb.at((fx, fy, fz)):
                fan(mb, [(40, 5.0), (20, 6.3), (0, 7.0), (-20, 6.9), (-40, 6.0), (-58, 4.4)])
        add(f'Fin_{n}_fan', mb, FL)
        ex, ez = -10.3, 3.75
        ey = section(ex, .86)[0] + .1
        E = joint(f'Elevator_{n}', (ex, s * ey, ez), parent=root, kind='hinge', axis='Y', lo=-25, hi=25, label='Elevators', group='Flight controls',
                  note='tail planes aft of the centre of mass; pitch control')
        mb = MB(60)
        with mb.at(scale=(1, s, 1)):
            with mb.at((ex, ey, ez)):
                fan(mb, [(-12, 3.3), (-32, 3.9), (-52, 3.8), (-70, 3.0)], up=3, r_in=.5, rib_r=.08)
        add(f'Elevator_{n}_fan', mb, E)

    # ================= guns, port lids ============================================
    for s, n in SIDES:
        for k, c in enumerate(PORTS):
            rot = (0, 0, 0) if s > 0 else (0, 0, 180)
            zd = zs(c) - .04
            yb, zt = bs(c) - .12 * PORT_Z1 / 1.05, zs(c) - .03 + PORT_Z1
            L = joint(f'Port_lid_{n}{k + 1}', (c, s * (yb + .02), zt), rot, root, kind='hinge', axis='X', lo=0, hi=100, label='Gun port lids', group='Guns')
            mb = MB(61 + k)
            with mb.at(scale=(1, s, 1)):
                h = PORT_Z1 - PORT_Z0 - .03
                mb.box((2 * PORT_HALF - .04, .07, h), (c, yb + .05, zt - h / 2 - .01), 'Trim')
                for dx in (-.2, .2): mb.box((.06, .03, h + .06), (c + dx, yb + .1, zt - h / 2), 'Iron')
                mb.cyl((c - .34, yb + .06, zt), (c + .34, yb + .06, zt), .03, 'Iron', segs=6)
            add(f'Port_lid_{n}{k + 1}_mesh', mb, L)
            yc = bs(c) - 1.38
            G = joint(f'Cannon_{n}{k + 1}', (c, s * yc, zd), rot, root, kind='slide', axis='Y', lo=0, hi=.75, label='Run out guns', group='Guns')
            mb = MB(70 + k)
            with mb.at(scale=(1, s, 1)):
                mb.box((.66, 1.15, .1), (c, yc, zd + .3), 'Trim')
                for dx in (-.28, .28):
                    mb.box((.1, 1.05, .32), (c + dx, yc + .03, zd + .46), 'Trim', top=(1, .7))
                    for dy in (-.36, .34):
                        mb.cyl((c + dx * 1.2 - .05, yc + dy, zd + .17), (c + dx * 1.2 + .05, yc + dy, zd + .17), .17, 'HullDark', segs=10)
                with mb.at((c, yc - .6, zd + .58), (-90, 0, 0)):
                    mb.lathe([(0, -.12), (.08, -.08), (.09, 0), (.2, .02), (.2, .12), (.16, .6), (.13, 1.38), (.165, 1.4), (.165, 1.52), (.09, 1.52), (.09, 1.3), (0, 1.3)], 'Brass', segs=10)
            add(f'Cannon_{n}{k + 1}_mesh', mb, G, bevel=.01)

    # ================= gate, gangway, hatch, doors ================================
    gx, gz = GATE[0], zs(0) - .03
    J = joint('Gate', (gx, bs(gx) - .2, gz), parent=root, kind='hinge', axis='Z', lo=0, hi=110, sign=-1, label='Entry gate', group='Doors & hatches')
    mb = MB(80)
    mb.box((1.08, .1, .84), (0, bs(0) - .2, gz + .44), 'HullWood')
    mb.box((1.08, .11, .1), (0, bs(0) - .2, gz + .8), 'PaintOrange')
    mb.box((1.08, .12, .12), (0, bs(0) - .2, gz + .95), 'Trim')
    for z in (.2, .6): mb.box((.9, .13, .05), (-.08, bs(0) - .2, gz + z), 'Iron')
    add('Gate_leaf', mb, J)
    J = joint('Gangway', (0, 0, gz), parent=root, kind='slide', axis='Y', lo=0, hi=3.3, label='Gangway', group='Doors & hatches',
              note='boarding plank; slides out through the open gate')
    mb = MB(81)
    y1 = bs(0) - .35
    mb.box((.9, 3.1, .07), (0, y1 - 1.55, gz + .09), 'Deck')
    for k in range(8): mb.box((.8, .06, .04), (0, y1 - .2 - .4 * k, gz + .14), 'Trim')
    for sx in (-.42, .42): mb.box((.06, 3.1, .1), (sx, y1 - 1.55, gz + .12), 'Trim')
    add('Gangway_plank', mb, J)

    hx0, hx1, hw = 0.9, 3.3, 1.1
    hz = zs(2.1) - .03
    for sx in (hx0, hx1): st.box((.14, 2 * hw + .14, .3), (sx, 0, hz + .15), 'Trim')
    for sy in (-hw, hw): st.box((hx1 - hx0, .14, .3), ((hx0 + hx1) / 2, sy, hz + .15), 'Trim')
    st.box((hx1 - hx0, 2 * hw, .02), ((hx0 + hx1) / 2, 0, hz + .03), 'Dark', var=0)
    for s, n in SIDES:
        J = joint('Hatch_' + n, ((hx0 + hx1) / 2, s * hw, hz + .31), (0, 0, 180 if s > 0 else 0), root, kind='hinge', axis='X', lo=0, hi=110,
                  label='Cargo hatch', group='Doors & hatches')
        mb = MB(82)
        for k in range(6):
            x = lerp(hx0 + .2, hx1 - .2, k / 5)
            mb.box((.3, hw - .02, .06), (x, s * (hw / 2), hz + .34), 'Deck')
        for dy in (.12, hw - .14): mb.box((hx1 - hx0, .1, .05), ((hx0 + hx1) / 2, s * dy, hz + .39), 'Trim')
        add(f'Hatch_{n}_leaf', mb, J)

    def door(name, x, w, h, z0, sign, face, glass):
        J = joint(name, (x, -w / 2, z0), parent=root, kind='hinge', axis='Z', lo=0, hi=110, sign=sign, label=name.replace('_', ' '), group='Doors & hatches')
        mb = MB(83)
        n = 4
        for k in range(n):
            mb.box((.07, w / n - .012, h), (x, -w / 2 + (k + .5) * w / n, z0 + h / 2), 'Trim')
        for z in (.25, h - .3):
            mb.box((.03, w * .8, .09), (x + face * .05, -w * .08, z0 + z), 'Iron')
        with mb.at((x + face * .06, w / 2 - .14, z0 + h * .48), (0, 90 * face, 0)): mb.torus(.07, .015, 'Brass', segs=10, tsegs=4)
        if glass:
            with mb.at((x + face * .045, 0, z0 + h * .72), (0, 90 * face, 0)):
                mb.torus(.19, .035, 'Brass', segs=14, tsegs=5)
                mb.lathe([(.18, 0), (0, 0)], 'Glass', segs=14, var=0)
        add(name + '_leaf', mb, J)
    door('Door_cabin', XQ + .02, .98, 2.08, zs(XQ) - .03, -1, 1, True)
    door('Door_forecastle', XF - .02, .88, 1.58, zs(XF) - .03, 1, -1, False)

    # ================= capstan, anchors, bell, chimney ============================
    cx = 4.7
    J = joint('Capstan', (cx, 0, zs(cx) - .04), parent=root, kind='spin', axis='Z', rpm=6, label='Capstan', group='Deck gear', drives='Anchor_L,Anchor_R')
    mb = MB(84)
    with mb.at((cx, 0, zs(cx) - .04)):
        mb.lathe([(.44, 0), (.44, .1), (.27, .2), (.22, .72), (.4, .84), (.42, 1.04), (.3, 1.1), (0, 1.1)], 'Trim', segs=12)
        for k in range(6):
            a = math.pi / 3 * k
            d = Vector((math.cos(a), math.sin(a), 0))
            mb.cyl(d * .3 + Vector((0, 0, .94)), d * 1.55 + Vector((0, 0, .94)), .05, 'Spar', r1=.035, segs=6)
            mb.box((.08, .1, .5), d * .27 + Vector((0, 0, .46)), 'HullDark', rot=(0, 0, math.degrees(a)))
    add('Capstan_mesh', mb, J)
    for s, n in SIDES:
        w = fc_w(11.0, FC_WALL)
        st.beam([(10.9, s * (w - .5), FC_WALL + .12), (11.5, s * (w + 1.0), FC_WALL + .3)], .28, .3, 'HullDark', side=(0, 0, 1))
        top = Vector((11.5, s * (w + .9), FC_WALL + .1))
        J = joint('Anchor_' + n, top, parent=root, kind='slide', axis='Z', lo=-30, hi=0, label='Anchors', group='Deck gear', note='hangs from the cathead; cable runs to the capstan')
        mb = MB(85)
        with mb.at(top):
            with mb.at((0, 0, -.25), (90, 0, 0)): mb.torus(.16, .035, 'Iron', segs=10, tsegs=5)
            mb.cyl((0, 0, -.4), (0, 0, -2.5), .07, 'Iron', r1=.09, segs=6)
            mb.beam([(0, -.85, -.62), (0, .85, -.62)], .16, .16, 'HullDark', side=(1, 0, 0))
            mb.tube([(-.8, 0, -1.95), (-.5, 0, -2.38), (0, 0, -2.55), (.5, 0, -2.38), (.8, 0, -1.95)], .07, 'Iron', segs=6)
            for sx in (-1, 1): mb.box((.34, .05, .36), (sx * .72, 0, -2.02), 'Iron', rot=(0, sx * -35, 0), top=(.3, 1))
        add(f'Anchor_{n}_mesh', mb, J)
        st.tube(catenary(top + Vector((0, 0, .1)), (12.3, s * (fc_w(12.3, 5.9) + .02), 5.9), .35, 6), .05, 'Iron', segs=5)
    bx = XF + .25
    for sy in (-.35, .35): st.box((.14, .14, 1.45), (bx, sy, FC + .72), 'Trim')
    st.box((.2, 1.0, .14), (bx, 0, FC + 1.5), 'Trim')
    J = joint('Bell', (bx, 0, FC + 1.42), parent=root, kind='hinge', axis='Y', lo=-30, hi=30, label='Ship bell', group='Deck gear')
    mb = MB(86)
    with mb.at((bx, 0, FC + 1.42)):
        mb.lathe([(.22, -.46), (.23, -.42), (.15, -.22), (.12, -.1), (.05, -.03), (0, 0)], 'Brass', segs=12)
        mb.cyl((0, 0, -.1), (0, 0, -.5), .02, 'Iron', segs=4); mb.ball((0, 0, -.5), .05, 'Iron', segs=6, rings=4)
    add('Bell_mesh', mb, J)
    st.cyl((9.6, 1.3, FC), (9.6, 1.3, FC + 1.5), .13, 'Brass', segs=8)
    with st.at((9.6, 1.3, FC + 1.5)): st.lathe([(.14, 0), (.26, .06), (.05, .3), (0, .32)], 'Brass', segs=8)
    joint('Smoke_emitter', (9.6, 1.3, FC + 1.6), parent=root, note='galley stove pipe: spawn smoke here')
    # portholes on the lower deck
    for s in (1, -1):
        with st.at(scale=(1, s, 1)):
            for x in (-8.2, -6.2, -1.2, 1.0, 5.8, 7.8):
                y, z = section(x, .6)
                with st.at((x, y + .06, z), (-90, 0, 0)):
                    st.torus(.24, .055, 'Brass', segs=12, tsegs=5)
                    st.lathe([(.23, .0), (0, .0)], 'Glass', segs=12, var=0)
    add('Deck_fittings', st, root, bevel=.012)

    # ================= lanterns ===================================================
    def lamp(name, p, k, pole=None):
        mb = MB(90)
        if pole: mb.tube(pole + [p], .035 * k, 'Brass', segs=6)
        lantern(mb, p, k)
        add(name, mb, root, light=True, color='#FFC66B', intensity=12 * k, group='Lights', label='Lanterns')
    for a, nm in ((0, 'C'), (33, 'L'), (-33, 'R')):
        b = arc_pt(a, QD_WALL + .1, -.07)
        o = Vector((-math.cos(rad(a)), math.sin(rad(a)), 0))
        k = 1.7 if a == 0 else 1.25
        lamp('Lantern_stern_' + nm, b + o * .45 + Vector((0, 0, 1.25 if a == 0 else 1.0)), k, [b, b + Vector((0, 0, .6)) , b + o * .3 + Vector((0, 0, 1.0 if a == 0 else .8))])
    for sy, nm in ((1, 'L'), (-1, 'R')):
        lamp('Lantern_door_' + nm, Vector((XQ + .4, sy * 1.15, 6.25)), .8, [Vector((XQ, sy * 1.15, 6.05)), Vector((XQ + .4, sy * 1.15, 6.05))])
        lamp('Lantern_bow_' + nm, Vector((XF - .4, sy * 1.1, 5.75)), .7, [Vector((XF, sy * 1.1, 5.6)), Vector((XF - .4, sy * 1.1, 5.6))])

    # ================= skiff on the starboard quarter davits ======================
    sy, sz, sxc = -5.35, 7.25, -9.05
    mb = MB(91)
    for xd in (sxc - 1.25, sxc + 1.25):
        cw = castle_w(xd, QD_WALL)
        mb.tube([(xd, -(cw - .1), 7.9), (xd, -(cw + .1), 9.2), (xd, -(cw + .7), 9.85), (xd, sy, 9.75), (xd, sy - .1, 9.6)], .08, 'Iron', segs=6)
        mb.tube([(xd, sy, 9.7), (xd, sy, sz + .05)], .025, 'Rope', segs=4)
    add('Davits', mb, root, note='falls (ropes) are static: scale or redraw them when the skiff is lowered')
    J = joint('Skiff', (sxc, sy, sz), parent=root, kind='slide', axis='Z', lo=-16, hi=0, label='Lower the skiff', group='Deck gear')
    mb = MB(92)
    ni, nj = 10, 5
    def sp(i, j, k=1.0):
        t = -1 + 2 * i / ni
        b = .72 * max(.0, 1 - abs(t) ** 2.6) ** .55 if t > -1 else 0
        b = max(b, .34 if t < 0 else .03)
        u = j / nj
        return Vector((sxc + 1.85 * t, sy + k * b * (1 - (1 - u) ** 2.2) ** .5, sz - .62 * (1 - u) * (1 - .35 * max(0, t) ** 2) + (0 if k == 1 else .04 * (1 - u))))
    for s in (1, -1):
        with mb.at((0, sy, 0)):
            with mb.at(scale=(1, s, 1)):
                with mb.at((0, -sy, 0)):
                    mb.grid([[sp(i, j) for j in range(nj + 1)] for i in range(ni + 1)], 'HullWood', flip=True,
                            colfn=lambda i, j: ORANGE if j == nj - 1 else None, var=.08)
                    mb.grid([[sp(i, j, .9) for j in range(nj + 1)] for i in range(ni + 1)], 'Deck', var=.08)
    a = sp(0, nj); b0 = sp(0, 0)
    mb.face([(a.x, sy + .34, a.z), (a.x, sy - .34, a.z), (b0.x, sy - .34, b0.z), (b0.x, sy + .34, b0.z)], 'HullWood')
    for t in (-.5, .25): mb.box((.22, 1.25, .05), (sxc + 1.85 * t, sy, sz - .18), 'Deck')
    mb.beam([(sxc - 1.85, sy, sz - .66), (sxc + 1.9, sy, sz - .45)], .1, .12, 'HullDark', side=(0, 1, 0))
    mb.ball((sxc, sy, sz - .85), .15, 'LiftStone', segs=6, rings=4)
    with mb.at((sxc, sy, sz - .85), (90, 0, 0)): mb.torus(.2, .03, 'Brass', segs=10, tsegs=4)
    for s in (1, -1):
        with mb.at((0, sy, 0)):
            with mb.at(scale=(1, s, 1)):
                with mb.at((sxc - .2, .72, sz - .12)):
                    fan(mb, [(-15, 1.1), (-45, 1.25), (-72, .95)], up=4, r_in=.2, rib_r=.03)
    add('Skiff_hull', mb, J)

    # ================= figurehead ==================================================
    fo = Vector((13.95, 0, 6.15))
    mb = MB(93)
    with mb.at(fo, (0, 68, 0)):
        mb.lathe([(0, -1.1), (.2, -.85), (.36, -.25), (.38, .2), (.27, .6), (.16, .85), (.2, 1.0), (.19, 1.14), (.08, 1.28), (0, 1.3)], 'Gilt', segs=10)
        mb.tube([(-.1, 0, 1.12), (-.42, 0, 1.2)], [.09, .01], 'PaintOrange', segs=5)       # beak (local -X = down/forward)
        mb.sweep([(.25, 0, -.6), (.75, 0, -1.9)], [(-.3, -.03), (.3, -.03), (.3, .03), (-.3, .03)], 'Gilt', side=(0, 1, 0), scale=[.7, 1.1])
    add('Figurehead', mb, root, note='gilt bird: kanat = wing')
    for s, n in SIDES:
        sh = fo + Vector((.1, s * .3, .25))
        J = joint('Figurehead_wing_' + n, sh, parent=root, kind='hinge', axis='X', lo=-15, hi=40, sign=s, label='Figurehead wings', group='Deck gear')
        mb = MB(94)
        for k in range(6):
            d = Vector((-.95 + .12 * k, s * (.35 + .16 * k), .78 - .2 * k)).normalized()
            L = 2.6 - .25 * k
            mb.sweep([sh + d * .1, sh + d * L * .6, sh + d * L], [(-.2, -.03), (.2, -.03), (.2, .03), (-.2, .03)], 'Gilt', side=(0, s * .5, 1), scale=[.7, 1, .3], var=.1)
        mb.ball(sh, .2, 'Gilt', segs=8, rings=5)
        add(f'Figurehead_wing_{n}_feathers', mb, J)
