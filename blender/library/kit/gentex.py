"""Textures drawn in numpy for the desk props: printed pages (two facing pages side by side), page edges seen from
the side, and a hand-drawn sea chart. Cached as blender/tex/gen_<name>.png."""
import os
import math
import numpy as np
import bpy
from . import paint

TEX = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tex"))


def _save(name, rgb):
    os.makedirs(TEX, exist_ok=True)
    path = os.path.join(TEX, f"gen_{name}.png")
    if os.path.exists(path):
        return path
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(f"gen_{name}", w, h, alpha=False)
    px = np.concatenate([np.flipud(rgb), np.ones((h, w, 1), np.float32)], axis=2)   # Blender rows run bottom-up
    img.pixels.foreach_set(px.astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return path


def _paper(h, w, seed, base="#EEE0BF", edge="#B99B67", fibre=0.05):
    n = paint._noise(h, w, 9, seed) * 0.6 + paint._noise(h, w, 31, seed + 3) * 0.4
    rgb = np.ones((h, w, 3), np.float32) * paint.hex_srgb(base)
    rgb *= (1 - fibre + fibre * 2 * n)[..., None]
    # darker, foxed edges
    y = np.linspace(-1, 1, h)[:, None]
    x = np.linspace(-1, 1, w)[None, :]
    e = np.clip(np.maximum(np.abs(x), np.abs(y)) * 1.0 - 0.82, 0, 1) / 0.18
    e = e + (paint._noise(h, w, 6, seed + 9) - 0.5) * 0.25
    rgb = rgb * (1 - 0.35 * np.clip(e, 0, 1))[..., None] + paint.hex_srgb(edge) * (0.35 * np.clip(e, 0, 1))[..., None] * 0.3
    return np.clip(rgb, 0, 1)


def page_text():
    """Two facing pages (left half, right half): a heading, ruled body text, a drop cap and a small figure."""
    W, H = 1536, 1152
    rgb = _paper(H, W, 21)
    ink = paint.hex_srgb("#2A1712")
    red = paint.hex_srgb("#8E2B22")
    rng = np.random.default_rng(5)
    yy, xx = np.mgrid[0:H, 0:W]
    shade = np.zeros((H, W), np.float32)
    col = np.zeros((H, W, 3), np.float32)

    def bar(x0, y0, x1, y1, c, a=0.85):
        x0, x1, y0, y1 = int(x0), int(x1), int(y0), int(y1)
        shade[y0:y1, x0:x1] = a
        col[y0:y1, x0:x1] = c

    for page in (0, 1):
        ox = page * W // 2
        m = 92
        x0, x1 = ox + m + (24 if page == 0 else 0), ox + W // 2 - m - (0 if page == 0 else 24)
        y = 120
        # running head
        bar((x0 + x1) / 2 - 90, y, (x0 + x1) / 2 + 90, y + 10, red, 0.7)
        y += 60
        if page == 1:
            # a small figure: framed engraving of a sphere and rays
            fx0, fx1, fy0, fy1 = x0 + 40, x1 - 40, y, y + 300
            for t in (0, 1):
                bar(fx0, fy0 + t * (fy1 - fy0 - 4), fx1, fy0 + 4 + t * (fy1 - fy0 - 4), ink, 0.8)
            bar(fx0, fy0, fx0 + 4, fy1, ink, 0.8)
            bar(fx1 - 4, fy0, fx1, fy1, ink, 0.8)
            cx, cy, r = (fx0 + fx1) / 2, (fy0 + fy1) / 2, 95
            d = np.hypot(xx - cx, yy - cy)
            ring = (np.abs(d - r) < 2.5) | ((np.abs(d - r * 0.55) < 1.6) & (yy > cy))
            for k in range(12):
                a = k * math.pi / 6
                ln = np.abs((xx - cx) * math.sin(a) - (yy - cy) * math.cos(a)) < 1.2
                ring |= ln & (d > r + 10) & (d < r + 55) & (xx > fx0 + 8) & (xx < fx1 - 8) & (yy > fy0 + 8) & (yy < fy1 - 8)
            shade[ring] = 0.85
            col[ring] = ink
            # hatching inside the lower half of the sphere
            hatch = (d < r) & (yy > cy + 10) & (((xx + yy) % 9) < 1.5)
            shade[hatch] = 0.6
            col[hatch] = ink
            y = fy1 + 50
        else:
            # drop cap
            bar(x0, y, x0 + 70, y + 84, red, 0.85)
        lh = 30
        while y < H - 150:
            xs = x0 + (90 if page == 0 and y < 300 else 0)
            # a line of words
            x = xs
            end = x1 - rng.integers(0, 120) if rng.random() < 0.12 else x1
            while x < end - 20:
                wl = int(rng.integers(18, 86))
                bar(x, y + 8, min(x + wl, end), y + 17, ink, 0.55 + 0.2 * rng.random())
                x += wl + 12
            y += lh
            if rng.random() < 0.07:
                y += lh // 2         # paragraph break
        # folio
        bar((x0 + x1) / 2 - 12, H - 100, (x0 + x1) / 2 + 12, H - 92, ink, 0.6)
    # the gutter shadow between the pages
    g = np.exp(-((xx - W / 2) / 40.0) ** 2) * 0.35
    rgb = rgb * (1 - shade[..., None]) + col * shade[..., None]
    rgb *= (1 - g)[..., None]
    return _save("pagetext", np.clip(rgb, 0, 1))


def page_edges():
    """The stacked edges of a page block: fine horizontal lines on cream (tileable)."""
    H = W = 512
    rgb = np.ones((H, W, 3), np.float32) * paint.hex_srgb("#E8D9B5")
    rows = np.arange(H)
    lines = (np.sin(rows * math.pi * 2 / 5.0) * 0.5 + 0.5) ** 6 * 0.18 + (paint._noise(H, 1, 64, 4)[:, 0] - 0.5) * 0.1
    rgb *= (1 - lines)[:, None, None]
    rgb *= (0.95 + 0.1 * paint._noise(H, W, 8, 7))[..., None]
    return _save("pageedge", np.clip(rgb, 0, 1))


def chart():
    """A hand-drawn sea chart: coastlines from noise, shallow-water stipple, a compass rose with rhumb lines."""
    H, W = 1024, 1366
    rgb = _paper(H, W, 33, base="#E9D7AE", edge="#A9874F", fibre=0.07)
    ink = paint.hex_srgb("#3B2416")
    land_c = paint.hex_srgb("#CDB27A")
    sea_c = paint.hex_srgb("#CBD2B8")
    yy, xx = np.mgrid[0:H, 0:W]
    n = paint._noise(H, W, 4, 3) * 0.55 + paint._noise(H, W, 9, 8) * 0.3 + paint._noise(H, W, 23, 2) * 0.15
    n = n + 0.22 * np.exp(-(((xx - W * 0.25) / (W * 0.25)) ** 2 + ((yy - H * 0.35) / (H * 0.3)) ** 2)) \
          + 0.18 * np.exp(-(((xx - W * 0.78) / (W * 0.2)) ** 2 + ((yy - H * 0.72) / (H * 0.25)) ** 2)) - 0.08
    land = n > 0.55
    coast = np.abs(n - 0.55) < 0.006
    shoal = (np.abs(n - 0.5) < 0.004) | (np.abs(n - 0.45) < 0.003)
    rgb = np.where(land[..., None], rgb * 0.55 + land_c * 0.45, rgb * 0.8 + sea_c * 0.2)
    # rhumb lines from a compass rose
    cx, cy = W * 0.56, H * 0.42
    a = np.arctan2(yy - cy, xx - cx)
    d = np.hypot(xx - cx, yy - cy)
    rhumb = np.zeros((H, W), bool)
    for k in range(16):
        ang = k * math.pi / 8
        rhumb |= np.abs((xx - cx) * math.sin(ang) - (yy - cy) * math.cos(ang)) < 0.9
    rhumb &= d > 120
    rose = (np.abs(d - 110) < 2) | (np.abs(d - 96) < 1.2)
    star = d < 100 * (0.25 + 0.75 * np.abs(np.cos(a * 4)) ** 8)
    hatch_land = land & (((xx - yy) % 11) < 1.2) & (n > 0.6)
    stip = (~land) & (n > 0.47) & (paint._noise(H, W, 180, 5) > 0.82)
    m = np.zeros((H, W), np.float32)
    m[rhumb & ~land] = 0.35
    m[shoal] = 0.45
    m[stip] = 0.4
    m[hatch_land] = 0.35
    m[coast] = 0.9
    m[rose] = 0.85
    m[star] = np.maximum(m[star], 0.75)
    # a border
    b = (np.minimum(np.minimum(xx, W - 1 - xx), np.minimum(yy, H - 1 - yy)))
    m[(b > 30) & (b < 34)] = 0.8
    m[(b > 40) & (b < 42)] = 0.6
    rgb = rgb * (1 - m[..., None]) + ink * m[..., None]
    return _save("chart", np.clip(rgb, 0, 1))


GENERATORS = {"PageText": page_text, "PageEdge": page_edges, "Chart": chart}


# ---------------------------------------------------------------- spine atlas for the shelf books
SPINE_COLS, SPINE_ROWS = 32, 4            # 128 spines, 64 x 512 px each in a 2048 x 2048 atlas
SPINE_MATS = ["BookRed", "BookBlue", "BookGreen", "BookOchre", "BookPlum", "BookTeal", "Leather"]


def spine_cell_mat(i):
    """The leather (DECO material) a spine cell is painted in, so the book's sides match."""
    return SPINE_MATS[i % len(SPINE_MATS)]


def spine_atlas():
    cw, ch = 64, 512
    W, H = cw * SPINE_COLS, ch * SPINE_ROWS
    out = np.zeros((H, W, 3), np.float32)
    rng = np.random.default_rng(13)
    grain = paint._noise(H, W, 160, 2) * 0.5 + paint._noise(H, W, 420, 6) * 0.5
    gilt = paint.hex_srgb("#E2B24E")
    gilt_dk = paint.hex_srgb("#8A6420")
    cream = paint.hex_srgb("#E9DCB8")
    ink = paint.hex_srgb("#2A1712")
    xs = (np.arange(cw) + 0.5) / cw
    round_ = (0.72 + 0.4 * np.sin(np.pi * xs)) ** 1.0                     # the rounded spine catches light in the middle
    for i in range(SPINE_COLS * SPINE_ROWS):
        r, c = divmod(i, SPINE_COLS)
        y0, x0 = r * ch, c * cw
        stops = paint.PALETTE[spine_cell_mat(i)][0]
        g = grain[y0:y0 + ch, x0:x0 + cw]
        cell = paint.ramp(stops, np.clip(0.42 + (g - 0.5) * 0.55 + rng.uniform(-0.08, 0.08), 0, 1))
        cell *= round_[None, :, None]
        m = np.zeros((ch, cw), np.float32)          # gilt mask
        dk = np.zeros((ch, cw), np.float32)         # dark (ridge shadow / ink) mask
        hi = np.zeros((ch, cw), np.float32)         # highlight
        def hband(y, th, mask, a=1.0, x0_=4, x1_=cw - 4):
            mask[int(y):int(y + th), x0_:x1_] = np.maximum(mask[int(y):int(y + th), x0_:x1_], a)
        style = rng.integers(0, 4)
        # head and tail bands
        for y in (14, ch - 22):
            hband(y, 3, m); hband(y + 6, 2, m)
        if style == 0:
            # raised bands with a gilt title panel
            ys = np.linspace(70, ch - 70, 5)
            for y in ys:
                hband(y - 4, 3, dk, 0.5); hband(y - 1, 5, hi, 0.5); hband(y + 4, 3, dk, 0.5)
                hband(y - 7, 1.5, m, 0.9); hband(y + 8, 1.5, m, 0.9)
            ty0 = int(ys[0] + 18)
            for k in range(rng.integers(2, 4)):
                yy = ty0 + k * 16
                xx = 10
                while xx < cw - 10:
                    wl = int(rng.integers(3, 8))
                    m[yy:yy + 7, xx:min(xx + wl, cw - 10)] = 1
                    xx += wl + 2
        elif style == 1:
            # a vertical gilt title between double rules
            for y in (60, ch - 70):
                hband(y, 2, m); hband(y + 6, 2, m)
            yy = 110
            stop = int(rng.integers(260, 380))
            while yy < stop:
                hl = int(rng.integers(6, 14))
                m[yy:yy + hl, cw // 2 - 6:cw // 2 + 6] = 1
                yy += hl + (int(rng.integers(6, 12)) if rng.random() < 0.18 else 3)
        elif style == 2:
            # a paper label with inked title
            ly0, ly1 = int(rng.integers(120, 170)), int(rng.integers(230, 290))
            lab = np.zeros((ch, cw), bool)
            lab[ly0:ly1, 9:cw - 9] = True
            cell[lab] = cream * (0.85 + 0.15 * g[lab][:, None])
            for k in range(3):
                yy = ly0 + 14 + k * 18
                if yy + 6 < ly1 - 6:
                    dk[yy:yy + 6, 15:cw - int(rng.integers(15, 28))] = 0.85
            for y in (ly0 - 6, ly1 + 3):
                hband(y, 2, m)
        else:
            # fleurons: small gilt diamonds between thin rules
            for y in np.linspace(80, ch - 90, 6):
                hband(y, 1.5, m, 0.9)
                cy, cx = int(y + 28), cw // 2
                for dy in range(-8, 9):
                    w = 8 - abs(dy)
                    m[cy + dy, cx - w // 2:cx + w // 2 + 1] = 1
        gl = gilt * (0.85 + 0.3 * g[..., None]) * round_[None, :, None]
        cell = cell * (1 - m[..., None]) + gl * m[..., None]
        cell = cell * (1 - 0.6 * dk[..., None]) + ink * (0.25 * dk[..., None])
        cell = cell + hi[..., None] * 0.08
        # worn, darker edges at head and tail
        ys = np.arange(ch)[:, None]
        cell *= (1 - 0.35 * np.clip(1 - np.minimum(ys, ch - 1 - ys) / 10.0, 0, 1))[..., None]
        out[y0:y0 + ch, x0:x0 + cw] = np.clip(cell, 0, 1)
    return _save("spines", out)


GENERATORS["SpineArt"] = spine_atlas
