"""Build one sky whale (model + rig + animation) and export .blend + .glb.

Usage:
  Blender -b --python whales/scripts/build_whale2.py -- <species> <A|B> whales
"""
import sys, os, json, math, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import bpy

from whalegen.config import SPECIES, BIOMES
from whalegen.util import MB, sstep, TAU
from whalegen.sdfbody import SDFBody
from whalegen.island2 import Island2
from whalegen.bodymesh import build_body_mb, build_eyes
from whalegen.paint2 import paint_skin
from whalegen.biomes import PLAN, POPULATE
from whalegen import props as P
from whalegen import paint, rig
from whalegen.anim import Animator, CRUISE, FPS


def cluster_trees(trees, kmax):
    if not trees:
        return np.zeros(0, int), []
    pts = np.array([(t['x'], t['y']) for t in trees])
    n = len(pts); k = min(kmax, max(1, int(math.ceil(n / 2.6))))
    cent = [pts[int(np.argmax(np.abs(pts[:, 1] - pts[:, 1].mean())))]]
    for _ in range(1, k):
        d = np.min(np.stack([np.linalg.norm(pts - c, axis=1) for c in cent]), axis=0)
        cent.append(pts[int(np.argmax(d))])
    cent = np.array(cent)
    for _ in range(20):
        lab = np.argmin(np.stack([np.linalg.norm(pts - c, axis=1) for c in cent]), axis=0)
        for i in range(k):
            if np.any(lab == i):
                cent[i] = pts[lab == i].mean(axis=0)
    lab = np.argmin(np.stack([np.linalg.norm(pts - c, axis=1) for c in cent]), axis=0)
    used = sorted(set(lab.tolist()))
    remap = {o: i for i, o in enumerate(used)}
    return np.array([remap[l] for l in lab]), [cent[o] for o in used]


def to_gltf(p):
    x, y, z = p
    return [round(float(x), 4), round(float(z), 4), round(float(-y), 4)]


def main(species, style, proj):
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sp = SPECIES[species]; bkey = sp['biome']; biome = BIOMES[bkey]
    B = style == 'B'
    rng = np.random.default_rng(sp['seed'] * 10 + (1 if B else 0))
    body = SDFBody(sp, species, style); U = body.U
    P_, Q_ = body.build(log=lambda m: print('  sdf', m, flush=True))
    mb_body, attrs = build_body_mb(body, P_, Q_, 27500 if body.an['fin']['len'] > 0.2 else 30000)
    print('  body mesh', len(mb_body.v), time.time() - t0, flush=True)
    isl = Island2(body, bkey, biome, style, rng); isl.grown = True
    PLAN[bkey](isl)
    isl.plan_falls()
    POPULATE[bkey](isl)
    isl.spill_over()

    print('  island planned', time.time() - t0, flush=True)
    # ---------------------------------------------------------- geometry
    mb_props = MB(); isl.build_terrain(mb_props); build_eyes(body, mb_props, style)
    mb_water = MB(); mb_ice = MB(); isl.build_water(mb_water, mb_ice)
    mb_falls = MB(); isl.build_falls(mb_falls)
    for fl in isl.falls:
        ex, ey, ez = fl['end']
        isl.place(P.splash(rng, U * (1.2 if B else 1.0)), ex, ey, z=ez, rot=0.0)

    # ---------------------------------------------------------- bones
    labels, cents = cluster_trees(isl.trees, kmax=14)
    clusters = []
    tree_bones = []
    for i, c in enumerate(cents):
        members = [t for t, l in zip(isl.trees, labels) if l == i]
        zg = float(np.mean([m['z'] for m in members])); Hm = float(np.mean([m['H'] for m in members]))
        tpos = float(body.t_of_y(c[1]))
        par = body.bone_for_t(tpos)
        a, b = f'tree_{i:02d}_a', f'tree_{i:02d}_b'
        tree_bones.append((a, (c[0], c[1], zg), (c[0], c[1], zg + 0.5 * Hm), par))
        tree_bones.append((b, (c[0], c[1], zg + 0.5 * Hm), (c[0], c[1], zg + Hm), a))
        clusters.append(dict(a=a, b=b, t=tpos, phase=float(rng.uniform(0, TAU))))
    water_bones = []; wlakes = []
    for lk in isl.lakes:
        if lk['kind'] != 'water':
            continue
        lk['bone'] = isl.water_bone_name(lk)
        par = body.bone_for_t(float(body.t_of_y(lk['y'])))
        water_bones.append((lk['bone'], (lk['x'], lk['y'], lk['level']), (lk['x'], lk['y'], lk['level'] + 0.4 * U), par))
        wlakes.append(lk)
    bones = body.bone_layout() + tree_bones + water_bones

    # ---------------------------------------------------------- props + trees into the island mesh
    from whalegen.util import s2l
    for it in isl.items:
        if it['weight'] == 'spine':
            w = body.spine_w_y(it['y'])
        else:
            w = {f"water_{it['weight'][1]}": 1.0}
        for v, f, c, hf, sm in it['parts']:
            mb_props.add(v, f, [tuple(s2l(cc)) for cc in c], [dict(w) for _ in v], sm)
    for tr, l in zip(isl.trees, labels):
        cl = clusters[l]
        sw = body.spine_w_y(tr['y'])
        for v, f, c, hf, sm in tr['parts']:
            ws = []
            for i, p in enumerate(v):
                h = hf[i] if hf else max(0.0, min(1.0, (p[2] - tr['z']) / tr['H']))
                a = sstep(0.04, 0.5, h); bb = sstep(0.45, 1.0, h)
                w = {k: val * (1 - a) for k, val in sw.items()} if a < 1 else {}
                if a * (1 - bb) > 1e-3: w[cl['a']] = a * (1 - bb)
                if a * bb > 1e-3: w[cl['b']] = a * bb
                ws.append(w)
            mb_props.add(v, f, [tuple(s2l(cc)) for cc in c], ws, sm)

    # ---------------------------------------------------------- textures + materials
    texdir = os.path.join(proj, 'out', 'textures'); os.makedirs(texdir, exist_ok=True)
    tag = f'{species}_{style}'
    print('  geometry done', time.time() - t0, flush=True)
    skin, nrm = paint_skin(body, isl, attrs, mb_body.uv, style)
    print('  painted', time.time() - t0, flush=True)
    body_img = rig.new_image(f'T_{tag}_body', skin, os.path.join(texdir, f'{tag}_body.png'))
    nrm_img = rig.new_image(f'T_{tag}_normal', nrm, os.path.join(texdir, f'{tag}_normal.png'))
    pal = isl.pal
    def hx(c): return '#%02x%02x%02x' % tuple(int(max(0, min(1, x)) * 255) for x in c)
    m_body = rig.make_material('M_body', 'body', style, body_img, rough=0.55 if not B else 0.8, normal=nrm_img)
    m_props = rig.make_material('M_props', 'vcol', style, rough=0.88, double=True)
    arm = rig.make_armature(bones)
    objs = [rig.mesh_from_mb('Whale_Body', mb_body, m_body, arm, with_uv=True),
            rig.mesh_from_mb('Whale_Island', mb_props, m_props, arm, with_col=True)]
    if mb_water.v:
        wimg = rig.new_image(f'T_{tag}_water', paint.paint_water(hx(pal['water']), hx(pal['water_deep']), style),
                             os.path.join(texdir, f'{tag}_water.png'))
        m_water = rig.make_material('M_water', 'water', style, wimg, rough=0.08, blend=True)
        objs.append(rig.mesh_from_mb('Whale_Water', mb_water, m_water, arm, with_uv=True))
    if mb_falls.v:
        fimg = rig.new_image(f'T_{tag}_falls', paint.paint_falls(hx(pal['water']), style),
                             os.path.join(texdir, f'{tag}_falls.png'))
        m_falls = rig.make_material('M_waterfall', 'waterfall', style, fimg, rough=0.2, double=True, blend=True)
        objs.append(rig.mesh_from_mb('Whale_Falls', mb_falls, m_falls, arm, with_uv=True))
    if mb_ice.v:
        iimg = rig.new_image(f'T_{tag}_ice', paint.paint_ice(hx(pal['ice'])), os.path.join(texdir, f'{tag}_ice.png'))
        m_ice = rig.make_material('M_ice', 'ice', style, iimg, rough=0.15)
        objs.append(rig.mesh_from_mb('Whale_Ice', mb_ice, m_ice, arm, with_uv=True))

    # ---------------------------------------------------------- animation
    anim = Animator(arm, body, clusters, wlakes)
    anim.build_all()

    # ---------------------------------------------------------- metadata (glTF scene extras)
    tris = sum(m.tri_count() for m in (mb_body, mb_props, mb_water, mb_falls, mb_ice))
    blow = next(b for b in bones if b[0] == 'blowhole')
    top = max(v[2] for v in mb_props.v)
    info = dict(
        species=species, name=sp['name'], biome=bkey, biomeLabel=biome['label'], style=style,
        styleLabel='Stylized-realistic' if not B else 'Ghibli-like painterly',
        length=round(body.L, 3), toon=B,
        particles=biome['particles'],
        island=dict(center=to_gltf((0, isl.yc, top - 0.6 * U)), halfLength=round(isl.A, 3),
                    halfWidth=round(float(isl.frac * body.W(isl.tc)), 3),
                    top=round(top, 3)),
        blowhole='blowhole', spoutEvery=12.0,
        clips=dict(base='cruise', reactions=['bankL', 'bankR', 'climb', 'dive', 'accel']),
        stats=dict(triangles=int(tris), bones=len(bones), treeClusters=len(clusters), lakes=len(isl.lakes),
                   waterfalls=len(isl.falls), trees=len(isl.trees)),
        forward='+Z', up='+Y',
    )
    bpy.context.scene['whale'] = json.dumps(info)

    # ---------------------------------------------------------- save + export
    os.makedirs(os.path.join(proj, 'out', 'blend'), exist_ok=True); os.makedirs(os.path.join(proj, 'out', 'glb'), exist_ok=True)
    blend_path = os.path.join(proj, 'out', 'blend', f'{tag}.blend')
    glb_path = os.path.join(proj, 'out', 'glb', f'{tag}.glb')
    bpy.ops.wm.save_as_mainfile(filepath=blend_path, compress=True)
    bpy.ops.export_scene.gltf(
        filepath=glb_path, export_format='GLB', export_image_format='WEBP', export_image_quality=82,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_extras=True, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=True, export_optimize_animation_size=True, export_skins=True,
        export_def_bones=False, export_rest_position_armature=True, export_yup=True)
    print(f'BUILT {tag}: tris={tris} bones={len(bones)} clusters={len(clusters)} lakes={len(isl.lakes)} '
          f'falls={len(isl.falls)} trees={len(isl.trees)} items={len(isl.items)} '
          f'glb={os.path.getsize(glb_path) / 1e6:.2f}MB time={time.time() - t0:.1f}s')


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    main(argv[0], argv[1], os.path.abspath(argv[2]))
