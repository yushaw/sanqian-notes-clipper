#!/usr/bin/env python3
"""Manual test harness: frame a native-messaging request, run the host, parse the reply."""
import json
import struct
import subprocess
import sys

HOST = "bin/native-host-darwin-arm64"


def call(msg: dict) -> dict:
    payload = json.dumps(msg).encode("utf-8")
    framed = struct.pack("<I", len(payload)) + payload
    proc = subprocess.run([HOST], input=framed, capture_output=True)
    out = proc.stdout
    if len(out) < 4:
        raise RuntimeError(f"no response (stderr: {proc.stderr!r})")
    n = struct.unpack("<I", out[:4])[0]
    return json.loads(out[4 : 4 + n])


if __name__ == "__main__":
    tests = [
        {"action": "ping"},
        {"action": "get_connection"},
        {
            "action": "proxy_tool",
            "tool": "create_note",
            "args": {
                "title": "Clipper M0 test note",
                "content": "# Hello from the clipper\n\nThis note was created via the native host -> MCP bridge.\n\n- item one\n- item two\n",
            },
        },
    ]
    for t in tests:
        print(f"\n>>> {t['action']}" + (f" / {t.get('tool')}" if t.get("tool") else ""))
        print(json.dumps(call(t), ensure_ascii=False, indent=2))
