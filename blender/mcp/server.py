#!/usr/bin/env python3
"""Minimal stdio MCP server for Blender Lab's MCP extension (bl_ext.lab_blender_org.mcp).

The extension listens on localhost:9876 for null-byte-delimited JSON {"type": "execute", "code": ..., "strict_json": bool}.
Start it in Blender (sidebar → MCP → Start) or headless: blender --background --command blender_mcp
No dependencies. Registered for this project in .mcp.json.

Also usable as a CLI:  python3 blender/mcp/server.py run path/to/script.py
"""
import json, socket, sys, os

HOST = os.environ.get("BLENDER_MCP_HOST", "localhost")
PORT = int(os.environ.get("BLENDER_MCP_PORT", "9876"))


def blender_exec(code: str, timeout: float = 600) -> dict:
    with socket.create_connection((HOST, PORT), timeout=timeout) as s:
        s.sendall(json.dumps({"type": "execute", "code": code, "strict_json": False}).encode() + b"\0")
        buf = b""
        while not buf.endswith(b"\0"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    return json.loads(buf.rstrip(b"\0") or b"{}")


TOOLS = [
    {"name": "execute_blender_code",
     "description": "Run Python (bpy) inside the running Blender and return stdout/result. Use for building, inspecting and exporting the scene.",
     "inputSchema": {"type": "object", "properties": {"code": {"type": "string"}}, "required": ["code"]}},
    {"name": "run_blender_script",
     "description": "Run a Python script file from this repo (e.g. blender/build.py) inside the running Blender.",
     "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}},
    {"name": "scene_summary",
     "description": "List objects in the current Blender scene with type, location and dimensions.",
     "inputSchema": {"type": "object", "properties": {}}},
]

SUMMARY = """
import bpy
print('\\n'.join(f"{o.name}\\t{o.type}\\t{tuple(round(v,3) for v in o.location)}\\t{tuple(round(v,3) for v in o.dimensions)}" for o in bpy.context.scene.objects))
"""


def call(name, args):
    if name == "execute_blender_code":
        r = blender_exec(args["code"])
    elif name == "run_blender_script":
        path = os.path.abspath(args["path"])
        r = blender_exec(f"exec(compile(open({path!r}).read(), {path!r}, 'exec'), {{'__name__': '__main__', '__file__': {path!r}}})")
    elif name == "scene_summary":
        r = blender_exec(SUMMARY)
    else:
        raise ValueError(f"unknown tool {name}")
    return json.dumps(r, indent=1)[:60000]


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        msg = json.loads(line)
        mid, method = msg.get("id"), msg.get("method")
        if mid is None:
            continue  # notification
        try:
            if method == "initialize":
                res = {"protocolVersion": msg["params"].get("protocolVersion", "2025-06-18"),
                       "capabilities": {"tools": {}}, "serverInfo": {"name": "blender-lab-bridge", "version": "1.0"}}
            elif method == "tools/list":
                res = {"tools": TOOLS}
            elif method == "tools/call":
                try:
                    text, err = call(msg["params"]["name"], msg["params"].get("arguments", {})), False
                except ConnectionRefusedError:
                    text, err = f"Blender is not listening on {HOST}:{PORT}. In Blender: sidebar → MCP → Start server.", True
                except Exception as e:
                    text, err = f"{type(e).__name__}: {e}", True
                res = {"content": [{"type": "text", "text": text}], "isError": err}
            elif method == "ping":
                res = {}
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "not found"}}), flush=True)
                continue
            print(json.dumps({"jsonrpc": "2.0", "id": mid, "result": res}), flush=True)
        except Exception as e:
            print(json.dumps({"jsonrpc": "2.0", "id": mid, "error": {"code": -32000, "message": str(e)}}), flush=True)


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "run":
        print(call("run_blender_script", {"path": sys.argv[2]}))
    else:
        main()
