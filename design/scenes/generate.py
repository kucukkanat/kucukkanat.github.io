"""Generate scene concept art via OpenRouter.
Key: OPENROUTER_API_KEY env var, or a file path in OPENROUTER_KEY_FILE. Never commit the key.
Usage: python3 generate.py [option-id ...]   (default: all)"""
import base64, json, os, sys, urllib.request, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("OPENROUTER_IMAGE_MODEL", "openai/gpt-5.4-image-2")
key = os.environ.get("OPENROUTER_API_KEY") or open(os.environ["OPENROUTER_KEY_FILE"]).read().strip()
cfg = json.load(open(os.path.join(HERE, "prompts.json")))
want = set(sys.argv[1:])

def gen(opt):
    body = {"model": MODEL, "modalities": ["image", "text"],
            "messages": [{"role": "user", "content": cfg["shared"] + "\n\n" + opt["prompt"]}],
            "image_config": {"aspect_ratio": "16:9"}}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", json.dumps(body).encode(),
        {"Authorization": "Bearer " + key, "Content-Type": "application/json", "X-Title": "personal-site-concepts"})
    data = json.load(urllib.request.urlopen(req, timeout=300))
    imgs = data["choices"][0]["message"].get("images") or []
    if not imgs: return opt["id"], "no image: " + json.dumps(data)[:300]
    url = imgs[0]["image_url"]["url"]
    out = os.path.join(HERE, opt["id"] + ".png")
    open(out, "wb").write(base64.b64decode(url.split(",", 1)[1]))
    cost = data.get("usage", {}).get("cost")
    return opt["id"], f"saved {out} (cost {cost})"

opts = [o for o in cfg["options"] if not want or o["id"] in want]
with cf.ThreadPoolExecutor(4) as ex:
    for oid, msg in ex.map(gen, opts): print(oid, msg)
