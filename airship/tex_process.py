"""Run inside Blender (numpy):  Blender --background --python tex_process.py
Turns tex/src/*.png (and the cabin's art/textures/*.png) into the galleon's painted textures in tex/.

Same look as the cabin interior: every tileable goes through blender/kit/paint.py (long brush blur along the grain,
soft posterise into paint bands, palette ramp), so no photographic grain is left and the colours come from the
shared PALETTE / ACCENT. No normal maps: a painted diorama is flat-lit.

Tileables are stored as 'relative' paint maps: painted / brightest tone (per channel, linear light). The model
multiplies them with a vertex colour, and kit.py divides every vertex colour by the map's mean (tex/detail.json),
so a face whose colour is the material's own colour shows exactly the painted palette texture, while per-plank
tints, stripes and other colours on the same material keep the brush strokes and bands.
Art pieces (sail emblem, flag, name board, frieze) are smoothed a little and pulled toward the palette."""
import bpy, os, sys, json, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, 'blender', 'kit'))
sys.modules.pop('paint', None)
import paint
SRC, OUT, CABIN = os.path.join(HERE, 'tex', 'src'), os.path.join(HERE, 'tex'), os.path.join(ROOT, 'art', 'textures')

# extra ramps for surfaces the cabin only has as flat accents (built round ACCENT, same four-stop scheme)
A = paint.ACCENT
PAL = dict(paint.PALETTE)
PAL['ShipOrange'] = (("#B04420", "#D25526", A['orange'], "#F58A4C"), 'v', 22, 4)
PAL['ShipCream'] = (("#C4B18C", "#DBCBA6", A['cream'], "#F6EDD4"), 'v', 22, 4)
PAL['ShipIron'] = (("#17161B", A['iron'], "#3F3D47", "#5C5964"), None, 9, 4)
PAL['ShipSpar'] = (("#55341F", "#7E5230", "#A2703F", "#C28E55"), 'v', 26, 5)      # between Planks and WallPlanks

# output -> (source file, palette, wood grain?, size, calm: contrast kept round the mean, 1 = as painted)
TILES = {
    'wood_hull': (os.path.join(SRC, 'weathered_wood.png'), 'WallPlanks', True, 512, 1),
    'wood_dark': (os.path.join(CABIN, 'dark_wood.png'), 'DarkWood', True, 512, 1),
    'wood_trim': (os.path.join(CABIN, 'mahogany.png'), 'Mahogany', True, 512, 1),
    'wood_deck': (os.path.join(SRC, 'deck_wood.png'), 'Planks', True, 512, 0.7),
    'wood_spar': (os.path.join(SRC, 'weathered_wood.png'), 'ShipSpar', True, 512, 0.8),
    'paint_orange': (os.path.join(SRC, 'chipped_paint.png'), 'ShipOrange', True, 512, 0.6),
    'paint_cream': (os.path.join(SRC, 'chipped_paint.png'), 'ShipCream', True, 512, 0.6),
    'canvas': (os.path.join(SRC, 'canvas.png'), 'Sailcloth', False, 512, 0.5),
    'brass': (os.path.join(CABIN, 'brass.png'), 'Brass', False, 256, 0.85),
    'gilt': (os.path.join(CABIN, 'brass.png'), 'Gilt', False, 256, 0.85),
    'iron': (os.path.join(SRC, 'wrought_iron.png'), 'ShipIron', False, 256, 1),
}
# art -> (wrap left-right, output width, anchor colours it is pulled toward, pull strength)
st = lambda n: list(PAL[n][0])
ART = {
    'sail_emblem': (0, 1024, st('Sailcloth') + st('ShipOrange'), .55),
    'falcon_flag': (0, 512, [A['ink'], "#241A1C"] + st('Parchment') + [A['orange']], .5),
    'name_board': (0, 768, st('DarkWood') + st('Mahogany')[:2] + st('Gilt') + st('ShipOrange')[1:3] + [A['cream']], .5),
    'frieze': (1, 768, st('Gilt') + st('ShipOrange') + st('DarkWood')[:2], .5),
}


def load(path, width=None):
    im = bpy.data.images.load(path)
    w, h = im.size
    if width and width < w:
        im.scale(width, round(h * width / w)); w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(im)
    return a


def save(a, path, quality=93):
    h, w = a.shape[:2]
    im = bpy.data.images.new('tmp', w, h, alpha=False)
    rgba = np.concatenate([np.clip(a, 0, 1).astype(np.float32), np.ones((h, w, 1), np.float32)], axis=2)
    im.pixels.foreach_set(rgba.ravel())
    s = bpy.context.scene.render.image_settings
    keep = (s.file_format, s.quality, s.color_mode)
    s.file_format, s.quality, s.color_mode = 'JPEG', quality, 'RGB'
    bpy.context.scene.view_settings.view_transform = 'Standard'
    im.save_render(path)
    s.file_format, s.quality, s.color_mode = keep
    bpy.data.images.remove(im)


def shrink(a, size):
    while a.shape[1] >= size * 2:
        a = (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4
    return a


def seamless(a, edge=110, axes=(0, 1)):
    h, w = a.shape[:2]
    m = np.ones((h, w), np.float32)
    ramp = lambda n: np.clip(np.minimum(np.arange(n), n - 1 - np.arange(n)) / edge, 0, 1)
    sm = lambda t: t * t * (3 - 2 * t)
    if 0 in axes: m *= sm(ramp(h))[:, None]
    if 1 in axes: m *= sm(ramp(w))[None, :]
    r = a
    if 0 in axes: r = np.roll(r, h // 2, 0)
    if 1 in axes: r = np.roll(r, w // 2, 1)
    return a * m[..., None] + r * (1 - m[..., None])


def to_lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def to_srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.maximum(c, 1e-9) ** (1 / 2.4) - 0.055)


def grain_vertical(a):
    """True if the streaks of the image run top-bottom (tones change faster across x than along y)."""
    lum = a @ np.array([.3, .59, .11], np.float32)
    return np.abs(np.diff(lum, axis=1)).mean() > np.abs(np.diff(lum, axis=0)).mean()


def pull(a, anchors, k, soft=0.012):
    """Grade toward a set of palette colours: each pixel moves a fraction k toward a soft blend of its nearest anchors."""
    C = np.stack([paint.hex_srgb(h) for h in anchors])                       # n x 3
    d = ((a[:, :, None, :] - C[None, None]) ** 2).sum(-1)                    # h x w x n
    w = np.exp(-(d - d.min(-1, keepdims=True)) / soft)
    t = (w[..., None] * C[None, None]).sum(2) / w.sum(-1, keepdims=True)
    return a + (t - a) * k


def painterly(a, sigma=1.3, bands=9):
    """Small blur and a soft posterise of the luminance, so the art has paint steps instead of photo grain."""
    b = paint._gauss(paint._gauss(a, sigma, 0), sigma, 1)
    lum = b @ np.array([.3, .59, .11], np.float32)
    q = lum * bands
    f = np.floor(q)
    e = np.clip((q - f - .5) / .5 + .5, 0, 1)
    e = e * e * (3 - 2 * e)
    return b * (((f + e) / bands + 1e-3) / (lum + 1e-3))[..., None]


paint.PALETTE.update(PAL)       # only in this process; paint.py itself is not changed
detail = {}
for seed, (name, (src, pal, wood, size, calm)) in enumerate(TILES.items()):
    if not os.path.exists(src): print('missing', src); continue
    a = load(src)
    if a.shape[0] != a.shape[1]:
        n = min(a.shape[:2]); a = a[:n, :n]
    a = seamless(a)
    if wood and not grain_vertical(a): a = np.rot90(a).copy()                # paint() brushes along the image's vertical
    p = paint.paint(a, pal, seed=seed + 3)
    if wood: p = np.rot90(p, -1).copy()                                      # the galleon's U runs along the plank
    p = shrink(p, size)
    p = np.clip(p.reshape(-1, 3).mean(0) + (p - p.reshape(-1, 3).mean(0)) * calm, 0, 1)
    L = to_lin(p)
    top = np.percentile(L.reshape(-1, 3), 99.7, axis=0)
    d = np.clip(L / top, 0, 1)
    detail[name] = {'mean': [round(float(x), 4) for x in d.reshape(-1, 3).mean(0)],
                    'col': [round(float(x), 4) for x in L.reshape(-1, 3).mean(0)], 'palette': pal}
    save(to_srgb(d), os.path.join(OUT, name + '.jpg'))
    save(p, os.path.join(OUT, 'check_' + name + '.jpg'), 85)                 # the colours as they will appear (for review only)
    print('tile', name, pal, detail[name])
for name, (wrap, width, anchors, k) in ART.items():
    p = os.path.join(SRC, name + '.png')
    if not os.path.exists(p): print('missing', name); continue
    a = load(p, width)
    if wrap: a = seamless(a, 50, axes=(1,))
    a = pull(painterly(a), anchors, k)
    if name == 'sail_emblem' and 'canvas' in detail:         # its cloth must match the plain sails: flatten and balance the ground
        sat = a.max(-1) - a.min(-1)
        ground = (sat < np.percentile(sat, 55))[..., None]
        g = np.median(a[ground[..., 0]], axis=0)
        a = np.where(ground, g + (a - g) * .5, a) * (to_srgb(np.array(detail['canvas']['col'])) / g)
    save(a, os.path.join(OUT, name + '.jpg'), 92)
    print('art', name, a.shape)
json.dump(detail, open(os.path.join(OUT, 'detail.json'), 'w'), indent=1)
