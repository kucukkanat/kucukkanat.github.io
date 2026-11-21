"""Procedural animation clips.

All rotations are authored in ARMATURE space (Blender: nose = -Y, up = +Z, whale's left = +X) and converted to
bone-local quaternions, so the maths doesn't depend on bone roll/direction.

Clips
  cruise           8 s seamless swim loop (2 fluke strokes, 1 breath), incl. secondary motion of trees & water
  rest             bind pose (reference for additive blending)
  body_<r>/eco_<r> static reaction poses, r in bankL, bankR, climb, dive, accel. "body" = spine/fins,
                   "eco" = trees/water. The three.js controller makes them additive and drives them with springs.
"""
import math
import bpy
from mathutils import Quaternion, Vector

FPS = 30
CRUISE = 240
X = Vector((1, 0, 0)); Y = Vector((0, 1, 0)); Z = Vector((0, 0, 1))
D = math.radians

BACK = [('spine_1', .43, 1.1), ('spine_2', .53, 1.7), ('spine_3', .625, 2.3), ('tail_1', .71, 3.2),
        ('tail_2', .785, 4.2), ('tail_3', .85, 5.1), ('tail_4', .91, 5.9), ('tail_5', .97, 6.8), ('fluke', 1.03, 11.0)]
FWD = [('chest', .315, 0.5), ('neck', .185, 0.7), ('head', .06, 0.9)]


class Animator:
    def __init__(self, arm, body, clusters, lakes):
        self.arm = arm; self.body = body; self.clusters = clusters; self.lakes = lakes
        self.rest = {b.name: b.matrix_local.to_quaternion() for b in arm.data.bones}
        self.names = [b.name for b in arm.data.bones]
        self.k = 2 * math.pi * 0.9  # spatial wave number (per body length)
        # per-bone rest axes in armature space: span (along the bone) and flap (bends the bone tip up/down)
        self.span = {}; self.flap = {}
        for bn in arm.data.bones:
            d = (bn.tail_local - bn.head_local).normalized()
            f = d.cross(Z)
            self.span[bn.name] = d
            self.flap[bn.name] = f.normalized() if f.length > 1e-4 else X.copy()
        self.nfin = len([b for b in self.names if b.startswith('fin_L_')])

    # -------------------------------------------------------------- helpers
    def q(self, rots):
        q = Quaternion()
        for axis, deg in rots:
            q = Quaternion(axis, D(deg)) @ q
        return q

    def apply(self, pose):
        for pb in self.arm.pose.bones:
            pb.rotation_quaternion = Quaternion(); pb.location = Vector(); pb.scale = Vector((1, 1, 1))
        for name, p in pose.items():
            if name not in self.rest:
                continue
            pb = self.arm.pose.bones[name]
            Rb = self.rest[name]
            if 'rot' in p:
                pb.rotation_quaternion = Rb.inverted() @ self.q(p['rot']) @ Rb
            if 'loc' in p:
                pb.location = Rb.inverted() @ Vector(p['loc'])
            if 'scale' in p:
                s = p['scale']; pb.scale = Vector((s, s, s))

    def key_all(self, f, names=None, loc=(), scale=()):
        for pb in self.arm.pose.bones:
            if names is not None and pb.name not in names:
                continue
            pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
            if pb.name in loc:
                pb.keyframe_insert('location', frame=f, group=pb.name)
            if pb.name in scale:
                pb.keyframe_insert('scale', frame=f, group=pb.name)

    def make_action(self, name, frames, pose_fn, loc=(), scale=()):
        ad = self.arm.animation_data or self.arm.animation_data_create()
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        for f in frames:
            self.apply(pose_fn(f))
            self.key_all(f, loc=loc, scale=scale)
        tr = ad.nla_tracks.new(); tr.name = name
        st = tr.strips.new(name, int(frames[0]), act)
        st.name = name
        tr.mute = True
        ad.action = None
        self.apply({})
        return act

    # -------------------------------------------------------------- cruise
    def cruise_pose(self, f):
        B = self.body
        w = 2 * math.pi * 2 * f / CRUISE  # two strokes per loop
        k = self.k
        p = {}
        for name, s, A in BACK:
            p[name] = {'rot': [(X, A * math.sin(w - k * s))]}
        for name, s, A in FWD:
            p[name] = {'rot': [(X, A * math.sin(w - k * s + math.pi))]}
        p['root'] = {'rot': [(X, 1.1 * math.sin(w + 0.9))],
                     'loc': (0, 0, 0.006 * B.L * math.sin(w + 2.2))}
        # flippers: a travelling bend wave from shoulder to tip (each segment lags), plus a quarter-phase
        # feathering twist - the flipper sculls like soft tissue instead of swinging as a rigid paddle.
        nf = self.nfin
        for side, pre in ((1, 'fin_L'), (-1, 'fin_R')):
            for i in range(nf):
                bn = f'{pre}_{i + 1}'
                q = i / max(nf - 1, 1)
                ph = w + 0.9 - 0.62 * i
                bend = (1.6 if i == 0 else 2.2 + 1.2 * q) * math.sin(ph)
                twist = (1.5 + 5.0 * q) * math.sin(ph + math.pi / 2)
                rots = [(self.flap[bn], bend), (self.span[bn], side * twist)]
                if i == 0:
                    rots.append((Z, side * 1.5 * math.sin(w + 0.3)))      # gentle fore-aft scull at the shoulder
                p[bn] = {'rot': rots}
        # fluke blades: flex behind the stroke, more toward the tips, with a slight twist
        for i, (A, lag, T) in enumerate(((3.5, 0.65, 1.5), (6.0, 1.2, 3.0))):
            for sd, sg in (('L', 1), ('R', -1)):
                bn = f'fluke_{sd}_{i + 1}'
                ph = w - k * 1.06 - lag
                p[bn] = {'rot': [(self.flap[bn], A * math.sin(ph)), (self.span[bn], sg * T * math.sin(ph + math.pi / 2))]}
        p['breath'] = {'scale': 1.0 + 0.032 * (0.5 - 0.5 * math.cos(2 * math.pi * f / CRUISE))}
        for c in self.clusters:
            s = c['t']; ph = c['phase']
            lean = 2.2 * math.sin(w - k * s - 1.3)
            wind = 1.6 * math.sin(2 * math.pi * 3 * f / CRUISE + ph) + 0.8 * math.sin(2 * math.pi * 5 * f / CRUISE + 2 * ph)
            p[c['a']] = {'rot': [(X, lean), (Y, wind)]}
            p[c['b']] = {'rot': [(X, 1.5 * 2.2 * math.sin(w - k * s - 1.9)), (Y, 1.4 * wind)]}
        for lk in self.lakes:
            s = float(self.body.t_of_y(lk['y']))
            p[lk['bone']] = {'rot': [(X, 2.0 * math.sin(w - k * s - 1.7)),
                                     (Y, 1.2 * math.sin(2 * math.pi * f / CRUISE + lk['idx']))]}
        return p

    # -------------------------------------------------------------- reaction poses (additive deltas)
    def body_pose(self, kind):
        p = {}
        if kind in ('bankL', 'bankR'):
            sg = 1 if kind == 'bankL' else -1
            for name, deg in (('chest', 4), ('neck', 5), ('head', 5)):
                p[name] = {'rot': [(Z, sg * deg)]}
            for name, deg in (('spine_1', 2), ('spine_2', 3), ('spine_3', 4), ('tail_1', 5), ('tail_2', 5),
                              ('tail_3', 5), ('tail_4', 4), ('tail_5', 3), ('fluke', 3)):
                p[name] = {'rot': [(Z, -sg * deg)]}
            # inside flipper raised, outside lowered - curved along the whole flipper, not hinged at the shoulder
            for seg, deg in enumerate((4, 3, 2.5, 2, 1.5)):
                for pre in ('fin_L', 'fin_R'):
                    bn = f'{pre}_{seg + 1}'
                    if bn in self.flap:
                        sgn = sg if pre == 'fin_L' else -sg
                        p[bn] = {'rot': [(self.flap[bn], sgn * deg)]}
        elif kind in ('climb', 'dive'):
            sg = 1 if kind == 'climb' else -1
            for name, deg in (('chest', 2), ('neck', 3), ('head', 3)):
                p[name] = {'rot': [(X, -sg * deg)]}
            for name, deg in (('spine_1', 1), ('spine_2', 2), ('spine_3', 2.5), ('tail_1', 3), ('tail_2', 3),
                              ('tail_3', 3), ('tail_4', 2.5), ('tail_5', 2), ('fluke', 5)):
                p[name] = {'rot': [(X, sg * deg)]}
            for side, pre in ((1, 'fin_L'), (-1, 'fin_R')):   # flippers pitch like elevators (twist), tips lead
                for seg, deg in enumerate((3, 3, 2.5, 2, 1.5)):
                    bn = f'{pre}_{seg + 1}'
                    if bn in self.span:
                        p[bn] = {'rot': [(self.span[bn], side * sg * deg)]}
        elif kind == 'accel':
            # flippers tuck back along the flank, the sweep spread over all segments
            for side, pre in ((1, 'fin_L'), (-1, 'fin_R')):
                for seg, (sw, fl) in enumerate(((6, -1.5), (5, -1), (4, -1), (3, 0), (2, 0))):
                    bn = f'{pre}_{seg + 1}'
                    if bn in self.flap:
                        p[bn] = {'rot': [(Z, side * sw), (self.flap[bn], fl)]}
            for sd in ('L', 'R'):
                p[f'fluke_{sd}_2'] = {'rot': [(self.flap[f'fluke_{sd}_2'], 4)]}
            for name, deg in (('tail_3', 2), ('tail_4', 3), ('tail_5', 3), ('fluke', 4)):
                p[name] = {'rot': [(X, -deg)]}
        return p

    def eco_pose(self, kind):
        p = {}
        if kind in ('bankL', 'bankR'):
            sg = 1 if kind == 'bankL' else -1
            tree = [(Y, -sg * 10)]; tree2 = [(Y, -sg * 8)]; water = [(Y, sg * 8)]
        elif kind in ('climb', 'dive'):
            sg = 1 if kind == 'climb' else -1
            tree = [(X, -sg * 9)]; tree2 = [(X, -sg * 7)]; water = [(X, sg * 7)]
        else:  # accel
            tree = [(X, -12)]; tree2 = [(X, -9)]; water = [(X, 9)]
        for c in self.clusters:
            p[c['a']] = {'rot': tree}; p[c['b']] = {'rot': tree2}
        for lk in self.lakes:
            p[lk['bone']] = {'rot': water}
        return p

    def build_all(self):
        bpy.context.scene.render.fps = FPS
        self.make_action('cruise', list(range(0, CRUISE + 1)), self.cruise_pose, loc=('root',), scale=('breath',))
        self.make_action('rest', [0, 1], lambda f: {})
        for kind in ('bankL', 'bankR', 'climb', 'dive', 'accel'):
            bp = self.body_pose(kind); ep = self.eco_pose(kind)
            self.make_action(f'body_{kind}', [0, 1], lambda f, bp=bp: bp)
            self.make_action(f'eco_{kind}', [0, 1], lambda f, ep=ep: ep)
        bpy.context.scene.frame_start = 0; bpy.context.scene.frame_end = CRUISE
