"""Blender -b <blend> --python scripts/measure_stretch.py : edge stretch of flipper/fluke skin over all clips."""
import bpy, numpy as np
ob = bpy.data.objects['Whale_Body']; arm = bpy.data.objects['WhaleRig']; me = ob.data
gi = {g.index: g.name for g in ob.vertex_groups}
part = np.array([sum(g.weight for g in v.groups if gi[g.group].startswith(('fin_', 'fluke'))) > 0.05 for v in me.vertices])
E = np.array([e.vertices[:] for e in me.edges]); E = E[part[E[:, 0]] | part[E[:, 1]]]
rest = np.array([v.co[:] for v in me.vertices]); L0 = np.linalg.norm(rest[E[:, 0]] - rest[E[:, 1]], axis=1)
ok = L0 > 0.5 * np.median(L0); E = E[ok]; L0 = L0[ok]
ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
dg = bpy.context.evaluated_depsgraph_get()
res = {}
for act in bpy.data.actions:
    ad.action = act
    try: ad.action_slot = act.slots[0]
    except Exception: pass
    fr = range(0, 240, 8) if act.name == 'cruise' else [0]
    worst = []
    for f in fr:
        bpy.context.scene.frame_set(f); dg.update()
        ev = ob.evaluated_get(dg); P = np.array([v.co[:] for v in ev.data.vertices])
        r = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1) / np.maximum(L0, 1e-6)
        worst.append((np.percentile(np.abs(r - 1), 99), np.abs(r - 1).max()))
    w = np.array(worst); res[act.name] = (w[:, 0].max(), w[:, 1].max())
print('STRETCH edges=%d' % len(E))
for k, (p99, mx) in sorted(res.items()):
    print('STRETCH %-12s p99=%5.1f%%  max=%5.1f%%' % (k, 100 * p99, 100 * mx))
