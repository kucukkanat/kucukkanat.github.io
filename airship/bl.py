#!/usr/bin/env python3
"""Run a script of this package inside a live Blender through the Blender MCP extension's socket bridge
(Blender: sidebar > MCP > Start, or `Blender --background --command blender_mcp`).
Usage: python3 bl.py build.py "side,quarter;export"      env: BLENDER_MCP_HOST, BLENDER_MCP_PORT (default localhost:9876)"""
import sys, os, json, socket
HOST, PORT = os.environ.get('BLENDER_MCP_HOST', 'localhost'), int(os.environ.get('BLENDER_MCP_PORT', '9876'))


def blender_exec(code, timeout=900):
    with socket.create_connection((HOST, PORT), timeout=timeout) as s:
        s.sendall(json.dumps({'type': 'execute', 'code': code, 'strict_json': False}).encode() + b'\0')
        buf = b''
        while not buf.endswith(b'\0'):
            chunk = s.recv(65536)
            if not chunk: break
            buf += chunk
    return json.loads(buf.rstrip(b'\0') or b'{}')


if __name__ == '__main__':
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, sys.argv[1]) if not os.path.isabs(sys.argv[1]) else sys.argv[1]
    args = sys.argv[2] if len(sys.argv) > 2 else 'side,quarter'
    code = (f"import os\nos.environ['SHIP_ARGS']={args!r}\n"
            f"exec(compile(open({path!r}).read(), {path!r}, 'exec'), {{'__name__': '__main__', '__file__': {path!r}}})")
    try:
        r = blender_exec(code)
    except ConnectionRefusedError:
        sys.exit(f'Blender is not listening on {HOST}:{PORT}. Start the MCP bridge in Blender, or run headless: '
                 'SHIP_ARGS=";export" Blender --background --python build.py')
    print(r.get('status'), (r.get('stdout') or '')[-3000:])
    if r.get('status') != 'ok':
        print(json.dumps(r)[-4000:]); sys.exit(1)
