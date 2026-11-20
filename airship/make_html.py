#!/usr/bin/env python3
"""Build the single-file preview: out/sky_galleon.glb + preview/ -> sky_galleon_preview.html.
With bun and three installed (the site's node_modules), three.js is bundled in and the page works offline.
Otherwise the page loads three.js from a CDN."""
import base64, os, shutil, subprocess
here = os.path.dirname(os.path.abspath(__file__))
glb = base64.b64encode(open(os.path.join(here, 'out', 'sky_galleon.glb'), 'rb').read()).decode()
main = os.path.join(here, 'preview', 'main.js')
bundle = os.path.join(here, 'out', 'preview_bundle.js')
script = None
if shutil.which('bun'):
    r = subprocess.run(['bun', 'build', main, '--minify', '--format=esm', '--target=browser', '--outfile', bundle], cwd=here, capture_output=True, text=True)
    if r.returncode == 0:
        script = '<script type="module">\n' + open(bundle).read().replace('</script', '<\\/script') + '\n</script>'
        mode = 'three.js bundled (offline)'
    else:
        print('bun build failed, falling back to the CDN:', r.stderr.strip()[-300:])
if script is None:
    script = ('<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js",'
              '"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/"}}</script>\n'
              '<script type="module">\n' + open(main).read() + '</script>')
    mode = 'three.js from CDN'
html = open(os.path.join(here, 'preview', 'template.html')).read()
assert '__GLB__' in html and '__SCRIPT__' in html
html = html.replace('__GLB__', glb).replace('__SCRIPT__', script)
out = os.path.join(here, 'sky_galleon_preview.html')
open(out, 'w').write(html)
print(out, round(len(html) / 1e6, 2), 'MB,', mode)
