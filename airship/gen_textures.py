#!/usr/bin/env python3
"""Generate the ship textures through OpenRouter. Key: OPENROUTER_API_KEY or ~/.config/openrouter/key (never printed).
Usage: python3 gen_textures.py [id ...]   FORCE=1 to regenerate.  CAP=5.0 dollars total (tracked in tex/src/cost.json)."""
import json, os, sys, base64, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tex', 'src')
MODEL = os.environ.get('OPENROUTER_IMAGE_MODEL', 'openai/gpt-5.4-image-2')
CAP = float(os.environ.get('CAP', '5.0'))
key = os.environ.get('OPENROUTER_API_KEY') or open(os.path.expanduser('~/.config/openrouter/key')).read().strip()
spec = json.load(open(os.path.join(HERE, 'textures.json')))
ledger_path = os.path.join(OUT, 'cost.json')
ledger = json.load(open(ledger_path)) if os.path.exists(ledger_path) else {'total': 0.0, 'calls': []}
only = sys.argv[1:]
for job in spec['jobs']:
    if only and job['id'] not in only: continue
    out = os.path.join(OUT, job['id'] + '.png')
    if os.path.exists(out) and os.environ.get('FORCE') != '1':
        print(job['id'], 'exists, skip'); continue
    if ledger['total'] >= CAP - 0.4:
        print('STOP: spend', round(ledger['total'], 2), 'is too close to the cap', CAP); break
    body = {'model': MODEL, 'modalities': ['image', 'text'],
            'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': spec['style_' + job['style']] + '\n\n' + job['prompt']}]}],
            'image_config': {'aspect_ratio': job['aspect']}}
    req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'ship-textures'})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=300))
        url = data['choices'][0]['message']['images'][0]['image_url']['url']
        open(out, 'wb').write(base64.b64decode(url.split(',')[1]))
        cost = (data.get('usage') or {}).get('cost') or 0
        ledger['total'] += cost; ledger['calls'].append({'id': job['id'], 'cost': cost})
        json.dump(ledger, open(ledger_path, 'w'), indent=1)
        print(job['id'], 'ok', f'${cost:.3f}', 'total', f"${ledger['total']:.2f}")
    except Exception as e:
        msg = e.read().decode()[:300] if hasattr(e, 'read') else str(e)[:300]
        print(job['id'], 'FAILED', msg)
