import bpy, numpy as np, collections
ob = bpy.data.objects['Whale_Body']; arm = bpy.data.objects['WhaleRig']; me = ob.data
gi = {g.index: g.name for g in ob.vertex_groups}
ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
part = np.array([sum(g.weight for g in v.groups if gi[g.group].startswith(('fin_', 'fluke'))) > 0.05 for v in me.vertices])
E = np.array([e.vertices[:] for e in me.edges]); E = E[part[E[:, 0]] | part[E[:, 1]]]
rest = np.array([v.co[:] for v in me.vertices])
L0 = np.linalg.norm(rest[E[:, 0]] - rest[E[:, 1]], axis=1); ok = L0 > 0.5 * np.median(L0)
for act, f in (('cruise', 40), ('body_accel', 0), ('body_bankL', 0)):
    ad.action = bpy.data.actions[act]; ad.action_slot = ad.action.slots[0]
    bpy.context.scene.frame_set(f); dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    P = np.array([v.co[:] for v in ob.evaluated_get(dg).data.vertices])
    r = np.abs(np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1) / np.maximum(L0, 1e-6) - 1); r[~ok] = 0
    top = np.argsort(-r)[:150]; cnt = collections.Counter()
    for k in top:
        for v in E[k]:
            ws = {gi[g.group]: g.weight for g in me.vertices[v].groups}; cnt[max(ws, key=ws.get)] += 1
    k = top[0]; a, b = E[k]
    print('ATTR', act, cnt.most_common(5), '| worst', round(r[k], 2), np.round(rest[a], 2),
          {gi[g.group]: round(g.weight, 2) for g in me.vertices[a].groups}, {gi[g.group]: round(g.weight, 2) for g in me.vertices[b].groups})
