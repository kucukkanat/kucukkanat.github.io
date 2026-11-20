"""Masts, spars, sails, standing rigging, flags and the lookout kite."""
import math
from mathutils import Vector
import kit, hull
from kit import MB, add, joint, grid_obj, lerp, clamp, catenary, lin, MATS
from hull import zs, bs, fc_w, MAIN_X, FORE_X, FC, QD, XF, FC_WALL

CREAM, ORANGE = MATS['Sail']['col'], MATS['PaintOrange']['col']
MASTS = {  # x, deck z, top (platform) z, truck z
    'main': dict(x=MAIN_X, deck=4.2, top=14.0, truck=23.6),
    'fore': dict(x=FORE_X, deck=FC, top=13.0, truck=21.2),
}
YARDS = {  # name: mast, yard z, half width, foot z, foot half width, stripes
    'main_course': ('main', 13.0, 5.6, 6.7, 5.9, 'panels'),
    'main_topsail': ('main', 21.4, 3.6, 13.7, 5.3, 'band'),
    'fore_course': ('fore', 12.2, 4.9, 8.5, 5.1, 'panels'),
    'fore_topsail': ('fore', 19.2, 3.1, 12.9, 4.6, 'band'),
}


def mast(mb, m):
    x = m['x']
    mb.cyl((x, 0, m['deck'] - .3), (x, 0, m['top'] + .7), .42, 'Spar', r1=.3, segs=12)
    for z in [m['deck'] + .25] + [m['deck'] + 2.2 * k for k in range(1, int((m['top'] - m['deck']) / 2.2))]:
        mb.cyl((x, 0, z), (x, 0, z + .12), .45 - .12 * (z - m['deck']) / (m['top'] - m['deck']) + .02, 'Iron', segs=12)
    mb.box((.9, 1.3, .16), (x + .12, 0, m['top'] - .1), 'Trim')                       # trestle trees
    mb.cyl((x + .36, 0, m['top'] - .9), (x + .36, 0, m['truck']), .23, 'Spar', r1=.11, segs=10)
    mb.box((1.0, .5, .2), (x + .18, 0, m['top'] + .68), 'HullDark')                    # mast cap
    mb.ball((x + .36, 0, m['truck'] + .12), .17, 'Gilt')


def sail_grid(x0, zh, hw, zf, hwf, nu=12, nv=9, depth=None):
    depth = depth or .11 * (hw + hwf)
    P, F = [], []
    for i in range(nu + 1):
        u = i / nu
        rp, rf = [], []
        for j in range(nv + 1):
            v = j / nv
            w = lerp(hw, hwf, v)
            belly = (4 * u * (1 - u)) ** .8
            rp.append(Vector((x0 + depth * belly * v ** .6 * (1 - .3 * v),
                              w * (1 - 2 * u),
                              lerp(zh - .26, zf, v) + .5 * belly * v ** 3)))
            th = v * 3 * math.pi
            rf.append(Vector((x0 + .05 + .2 * math.cos(th) * (.4 + .6 * v), hw * (1 - 2 * u) * .97, zh - .3 + .2 * math.sin(th) * (.4 + .6 * v))))
        P.append(rp); F.append(rf)
    return P, F


def build(root):
    # ---- masts, tops, bowsprit --------------------------------------------------
    mb = MB(21)
    for m in MASTS.values(): mast(mb, m)
    mb.cyl((11.6, 0, 6.85), (18.8, 0, 9.4), .3, 'Spar', r1=.15, segs=10)                 # bowsprit
    mb.box((.5, .6, .9), (12.3, 0, 6.85), 'Trim')                                         # bitts
    mb.ball((18.9, 0, 9.44), .16, 'Gilt')
    f = MASTS['fore']
    with mb.at((f['x'] + .15, 0, f['top'])):
        mb.lathe([(1.0, 0), (1.05, .1), (0, .1)], 'Deck', segs=12)
        mb.lathe([(0, -.02), (1.0, 0)], 'Deck', segs=12)
    hull.rail(mb, [(f['x'] + .15 + .92 * math.cos(a), .92 * math.sin(a), f['top'] + .1) for a in [math.radians(d) for d in range(110, 251, 20)]], .8, post=.5)
    # crow's nest on the main top
    m = MASTS['main']
    with mb.at((m['x'] + .15, 0, m['top'])):
        mb.lathe([(.72, -.25), (.85, 0), (1.0, .95), (1.06, 1.0), (1.0, 1.05)], 'HullWood', segs=14)
        mb.lathe([(.93, 1.05), (.8, .12), (0, .12)], 'Deck', segs=14)
        mb.lathe([(0, -.25), (.72, -.25)], 'HullDark', segs=14)
        for z in (.2, .75):
            mb.lathe([(lerp(.85, 1.0, z / .95) + .005, z - .05), (lerp(.85, 1.0, z / .95) + .03, z), (lerp(.85, 1.0, z / .95) + .005, z + .05)], 'Brass', segs=14)
    # fife rail at the mainmast, channels
    hull.rail(mb, [(MAIN_X - .9, -.8, zs(MAIN_X)), (MAIN_X - .9, .8, zs(MAIN_X))], .8, post=.4)
    add('Masts', mb, root)

    # ---- standing rigging -------------------------------------------------------
    sr = MB(22); fit = MB(23)
    def land(x):
        if x >= XF: return fc_w(x, FC_WALL) + .28, FC_WALL + .06
        return bs(x) - .12 + .42, zs(x) + 1.06
    plan = {'main': [MAIN_X - .6 - .8 * k for k in range(4)], 'fore': [8.0, 7.45, 6.7, 6.0]}
    for name, m in MASTS.items():
        for s in (1, -1):
            lands = []
            for x in plan[name]:
                y, z = land(x)
                a, b = Vector((m['x'], .3 * s, m['top'] - .3)), Vector((x, y * s, z))
                sr.tube([a, b], .045, 'RopeDark', segs=5)
                lands.append((a, b))
                for t in (.035, .075):
                    p = b.lerp(a, t)
                    fit.cyl(p + Vector((0, -.05 * s, 0)), p + Vector((0, .05 * s, 0)), .11, 'HullDark', segs=8)
            xs = plan[name]
            for seg in ([xs[0], xs[1]], [xs[2], xs[3]]) if name == 'fore' else ([xs[0], xs[-1]],):
                y0, z0 = land(seg[0]); y1, z1 = land(seg[1])
                fit.beam([(seg[0] + .25, (y0 - .1) * s, z0 - .08), (seg[1] - .25, (y1 - .1) * s, z1 - .08)], .5, .09, 'HullDark', side=(0, 1, 0))
            zlo = max(b.z for a, b in lands) + 1.0
            z = zlo
            while z < m['top'] - 1.4:
                pts = [b.lerp(a, (z - b.z) / (a.z - b.z)) for a, b in lands]
                sr.tube(pts, .022, 'RopeDark', segs=3, caps=False)
                z += .5
            # topmast shrouds and backstay
            for dx in (-.25, .45):
                sr.tube([(m['x'] + .15 + dx, .98 * s, m['top'] + .08), (m['x'] + .36, .1 * s, m['truck'] - 2.6)], .035, 'RopeDark', segs=4)
            xb = m['x'] - 4.4
            yb, zb = land(xb)
            sr.tube([(m['x'] + .36, .08 * s, m['truck'] - 1.2), (xb, yb * s, zb)], .04, 'RopeDark', segs=4)
    M, F = MASTS['main'], MASTS['fore']
    for a, b in (((F['x'], 0, F['top'] - .2), (15.9, 0, 8.42)), ((F['x'] + .36, 0, F['truck'] - 1.4), (18.5, 0, 9.36)),
                 ((M['x'], 0, M['top'] - .2), (F['x'] - .55, 0, FC + .35)), ((M['x'] + .36, 0, M['truck'] - 1.4), (F['x'] + .1, 0, F['top'] + .3)),
                 ((18.4, 0, 9.1), (13.3, 0, 4.9))):
        sr.tube(catenary(a, b, .12, 6), .05, 'RopeDark', segs=5)
    add('Rigging_standing', sr, root)
    add('Rigging_fittings', fit, root)

    # ---- yards and square sails -------------------------------------------------
    for name, (mast_name, zy, hw, zf, hwf, style) in YARDS.items():
        m = MASTS[mast_name]
        top = 'top' in name
        xm = m['x'] + (.36 if top else 0)
        x0 = xm + (.42 if top else .6)
        Y = joint('Yard_' + name, (xm, 0, zy), parent=root, kind='hinge', axis='Z', lo=-40, hi=40,
                  label='Brace ' + name.replace('_', ' '), group='Sails')
        mb = MB(30)
        r = .17 if top else .21
        for s in (1, -1):
            mb.cyl((x0, 0, zy), (x0, s * (hw + .35), zy), r, 'Spar', r1=r * .5, segs=8)
            mb.cyl((x0, s * (hw - .3), zy), (x0, s * (hw - .2), zy), r * .78, 'Iron', segs=8)
            mb.tube(catenary((x0, s * .3, zy - .2), (x0, s * (hw + .1), zy - .12), .7, 6), .028, 'RopeDark', segs=4)   # footrope
            mb.tube([(x0, s * (hw + .25), zy + .1), (xm + .1, s * .12, zy + (2.2 if top else 1.6))], .025, 'Rope', segs=4)  # lift
        mb.box((x0 - xm + .1, .3, .28), ((x0 + xm) / 2, 0, zy), 'Iron')              # truss / parrel
        add(f'Yard_{name}_spar', mb, Y)
        P, K = sail_grid(x0 + .05, zy, hw, zf, hwf)
        nv = len(P[0]) - 1
        def colfn(i, j, style=style, nv=nv):
            if style == 'band' and j >= nv - 2: return ORANGE
            if style == 'panels' and i in (2, 9): return ORANGE
            return lin(CREAM) if i % 2 else tuple(c * .93 for c in lin(CREAM))
        emblem = name == 'main_course' and kit.has_tex('SailEmblem')
        grid_obj('Sail_' + name, P, 'SailEmblem' if emblem else 'Sail', Y, colfn=(lambda i, j: (1, 1, 1)) if emblem else colfn, keys={'furl': K},
                 uvsize=(1, 1) if emblem else (2 * hw / 2.5, (zy - zf) / 2.5), morph='furl', label='Furl ' + name.replace('_', ' '), group='Sails')

    # ---- jib --------------------------------------------------------------------
    H, T, C = Vector((F['x'] + .7, 0, F['truck'] - 2.0)), Vector((18.2, 0, 9.5)), Vector((9.9, 0, 9.9))
    n = 9
    P, K = [], []
    for i in range(n + 1):
        s_ = i / n
        luff, leech = H.lerp(T, s_), H.lerp(C, s_)
        row, rk = [], []
        for j in range(5):
            t = j / 4
            p = luff.lerp(leech, t)
            p.y -= .9 * math.sin(math.pi * t) * math.sin(math.pi * s_) ** .7
            row.append(p); rk.append(luff + (leech - luff) * t * .04)
        P.append(row); K.append(rk)
    grid_obj('Sail_jib', P, 'Sail', root, uvsize=(5, 3), colfn=lambda i, j: ORANGE if j < 3 else lin(CREAM), keys={'furl': K}, morph='furl', label='Furl jib', group='Sails')

    # ---- spanker (gaff sail on the mainmast) -----------------------------------
    S = joint('Spanker', (MAIN_X, 0, 9.3), parent=root, kind='hinge', axis='Z', lo=-35, hi=35, label='Spanker boom', group='Sails')
    mb = MB(31)
    throat, peak, tack, clew = Vector((MAIN_X - .5, 0, 12.5)), Vector((-7.2, 0, 16.3)), Vector((MAIN_X - .5, 0, 9.55)), Vector((-9.4, 0, 9.9))
    mb.cyl((MAIN_X - .4, 0, 9.3), (-9.8, 0, 9.72), .17, 'Spar', r1=.1, segs=8)
    mb.cyl(throat + Vector((.05, 0, .1)), peak + Vector((-.4, 0, .28)), .14, 'Spar', r1=.08, segs=8)
    for z in (9.3, 12.6):
        mb.cyl((MAIN_X, 0, z - .12), (MAIN_X, 0, z + .12), .5, 'Iron', segs=12)
    mb.tube([peak + Vector((-.3, 0, .3)), (MAIN_X + .2, 0, MASTS['main']['top'] + .5)], .028, 'Rope', segs=4)
    mb.tube([(-9.5, 0, 9.85), (MAIN_X + .1, 0, MASTS['main']['top'] - .4)], .025, 'Rope', segs=4)
    add('Spanker_spars', mb, S)
    P, K = [], []
    for i in range(9):
        u = i / 8
        head, foot = throat.lerp(peak, u), tack.lerp(clew, u)
        row, rk = [], []
        for j in range(8):
            v = j / 7
            p = head.lerp(foot, v)
            p.y -= .7 * math.sin(math.pi * v) * math.sin(math.pi * min(1, u * 1.15)) ** .8
            row.append(p)
            rk.append(Vector((throat.x - .25 * u, .12 * math.sin(v * 9) * u, lerp(throat.z, tack.z, v) + (peak.z - throat.z) * u * .12)))
        P.append(row); K.append(rk)
    grid_obj('Sail_spanker', P, 'Sail', S, uvsize=(3, 2.4), colfn=lambda i, j: ORANGE if i >= 7 else (lin(CREAM) if j % 2 else tuple(c * .93 for c in lin(CREAM))),
             keys={'furl': K}, morph='furl', label='Brail spanker', group='Sails')

    # ---- flags ------------------------------------------------------------------
    def flag(name, at, length, hoist, parent, tri=False, mat='Sail'):
        J = joint(name, at, parent=parent, kind='group', wave=True, label=name)
        n = 10
        P = [[Vector((at[0] - length * i / n, at[1] + .12 * math.sin(i * 1.3), at[2] - (hoist * (j / 2)) * (1 - (i / n if tri else 0)) - (hoist * .5 * i / n if tri else 0)))
              for j in range(3)] for i in range(n + 1)]
        grid_obj(name + '_cloth', P, mat, J, uvsize=(1, 1) if mat != 'Sail' else (length / 2.5, hoist / 2.5),
                 colfn=(lambda i, j: (1, 1, 1)) if mat != 'Sail' else (lambda i, j: ORANGE if (tri or j != 1) else lin(CREAM)))
    flag('Pennant_main', (MASTS['main']['x'] + .36, 0, MASTS['main']['truck'] + .1), 4.2, .55, root, True)
    flag('Pennant_fore', (MASTS['fore']['x'] + .36, 0, MASTS['fore']['truck'] + .1), 3.2, .45, root, True)
    flag('Flag_ensign', (peak.x - .5, 0, peak.z + .2), 3.0, 2.0, S, mat='FlagFalcon' if kit.has_tex('FlagFalcon') else 'Sail')

    # ---- lookout kite -----------------------------------------------------------
    nest = Vector((MAIN_X + .15, 0, MASTS['main']['top'] + 1.0))
    kpos = nest + Vector((-11.5, -3.0, 13.5))
    KR = joint('Kite_rig', nest, parent=root, kind='group', label='Lookout kite', note='line + kite; swing this node to fly the kite')
    mb = MB(40)
    mb.tube(catenary(nest, kpos, 1.6, 12), .018, 'Rope', segs=3)
    add('Kite_line', mb, KR)
    KJ = joint('Kite', kpos, (0, -35, 15), KR, kind='group', wave=True)
    mb = MB(41)
    with mb.at(M=kit.WORLD['Kite']):
        a, b, c, d = (0, 0, 1.3), (0, .85, .35), (0, 0, -1.3), (0, -.85, .35)
        mb.face([a, b, (0, 0, .35)], 'Sail', ORANGE); mb.face([a, (0, 0, .35), d], 'Sail', CREAM)
        mb.face([b, c, (0, 0, .35)], 'Sail', CREAM); mb.face([(0, 0, .35), c, d], 'Sail', ORANGE)
        mb.tube([a, c], .025, 'Spar', segs=4); mb.tube([b, d], .025, 'Spar', segs=4)
        tail = [Vector((-.25 * k, .1 * math.sin(k), -1.3 - .55 * k)) for k in range(7)]
        mb.tube(tail, .012, 'Rope', segs=3)
        for k, p in enumerate(tail[1:]):
            mb.box((.02, .32, .14), p, 'Sail', ORANGE if k % 2 else CREAM)
    add('Kite_mesh', mb, KJ)
