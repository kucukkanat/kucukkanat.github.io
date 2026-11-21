"""Blender -b --python scripts/contact_sheet.py -- out.png cols scale img1 img2 ..."""
import sys, bpy, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
out, cols, scale, files = a[0], int(a[1]), float(a[2]), a[3:]
imgs = []
for f in files:
    im = bpy.data.images.load(f); w, h = im.size
    px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
    step = int(round(1 / scale)); imgs.append(px[::step, ::step])
h, w = imgs[0].shape[:2]; rows = (len(imgs) + cols - 1) // cols
sheet = np.ones((rows * h, cols * w, 4), np.float32)
for i, px in enumerate(imgs):
    r = rows - 1 - i // cols; c = i % cols
    sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] = px[:h, :w]
img = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
img.pixels.foreach_set(sheet.ravel()); img.filepath_raw = out; img.file_format = 'PNG'; img.save()
print('SHEET', out)
