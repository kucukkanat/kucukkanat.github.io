"""Round 2: overview per concept, then 3 interaction views that use the overview as a visual reference.
Key: OPENROUTER_API_KEY env or OPENROUTER_KEY_FILE. Usage: python3 generate.py [overviews|views|all] [concept-id ...]"""
import base64, json, os, sys, urllib.request, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.environ.get("OPENROUTER_IMAGE_MODEL", "openai/gpt-5.4-image-2")
key = os.environ.get("OPENROUTER_API_KEY") or open(os.path.expanduser(os.environ.get("OPENROUTER_KEY_FILE", "~/.config/openrouter/key"))).read().strip()
cfg = json.load(open(os.path.join(HERE, "prompts.json")))
mode = sys.argv[1] if len(sys.argv) > 1 else "all"
only = set(sys.argv[2:])
concepts = [c for c in cfg["concepts"] if not only or c["id"] in only]

def call(content, out):
    body = {"model": MODEL, "modalities": ["image", "text"], "messages": [{"role": "user", "content": content}],
            "image_config": {"aspect_ratio": "16:9"}}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", json.dumps(body).encode(),
        {"Authorization": "Bearer " + key, "Content-Type": "application/json", "X-Title": "personal-site-concepts"})
    try:
        data = json.load(urllib.request.urlopen(req, timeout=400))
    except Exception as e:
        return f"{os.path.basename(out)} ERROR {e}", 0
    imgs = data["choices"][0]["message"].get("images") or []
    if not imgs: return f"{os.path.basename(out)} no image: {json.dumps(data)[:200]}", 0
    open(out, "wb").write(base64.b64decode(imgs[0]["image_url"]["url"].split(",", 1)[1]))
    c = data.get("usage", {}).get("cost") or 0
    return f"{os.path.basename(out)} ok (${c:.3f})", c

def overview(c):
    return call(cfg["shared"] + "\n\n" + c["overview"], os.path.join(HERE, f"{c['id']}-0-overview.png"))

def view(args):
    c, v = args
    ref = base64.b64encode(open(os.path.join(HERE, f"{c['id']}-0-overview.png"), "rb").read()).decode()
    text = cfg["shared"] + "\n\nReference image: the overview of this scene. Keep the same world, materials, palette and object designs.\n\n" + v["prompt"].format(place=c["place"])
    content = [{"type": "text", "text": text}, {"type": "image_url", "image_url": {"url": "data:image/png;base64," + ref}}]
    return call(content, os.path.join(HERE, f"{c['id']}-{v['id']}.png"))

total = 0
with cf.ThreadPoolExecutor(6) as ex:
    if mode in ("overviews", "all"):
        for msg, c in ex.map(overview, concepts): print(msg, flush=True); total += c
    if mode in ("views", "all"):
        jobs = [(c, v) for c in concepts for v in cfg["views"] if os.path.exists(os.path.join(HERE, f"{c['id']}-0-overview.png"))]
        for msg, c in ex.map(view, jobs): print(msg, flush=True); total += c
print(f"total ${total:.2f}")
