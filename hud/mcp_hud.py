#!/usr/bin/env python3
"""Serveur MCP (stdio) qui donne à Claude Code les outils de Jarvis HUD.

Lancé par Claude Code (voir cerveau_claude.py). Chaque appel d'outil est relayé
au serveur HTTP local de Jarvis HUD, qui l'exécute et met à jour l'interface.
Bibliothèque standard uniquement.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

PORT = os.environ.get("JARVIS_HUD_PORT", "3000")
TOKEN = os.environ.get("JARVIS_HUD_TOKEN", "")
BASE = f"http://127.0.0.1:{PORT}/api/internal"


def _hud(path: str, data: dict | None = None, timeout: float = 30):
    req = urllib.request.Request(
        BASE + path,
        data=None if data is None else json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Jarvis-Token": TOKEN},
        method="GET" if data is None else "POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _tools() -> list[dict]:
    tools = []
    for t in _hud("/tools")["tools"]:
        fn = t["function"]
        tools.append({"name": fn["name"], "description": fn.get("description", ""),
                      "inputSchema": fn.get("parameters") or {"type": "object", "properties": {}}})
    return tools


def _reply(msg_id, result=None, error=None) -> None:
    out = {"jsonrpc": "2.0", "id": msg_id}
    if error is not None:
        out["error"] = error
    else:
        out["result"] = result
    sys.stdout.write(json.dumps(out, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(msg: dict) -> None:
    method, msg_id, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if msg_id is None:  # notification (ex. notifications/initialized)
        return
    try:
        if method == "initialize":
            _reply(msg_id, {
                "protocolVersion": params.get("protocolVersion", "2025-06-18"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "jarvis-hud", "version": "1.0"},
            })
        elif method == "ping":
            _reply(msg_id, {})
        elif method == "tools/list":
            _reply(msg_id, {"tools": _tools()})
        elif method == "tools/call":
            res = _hud("/tool", {"name": params.get("name", ""), "args": params.get("arguments") or {}}, timeout=400)
            _reply(msg_id, {"content": [{"type": "text", "text": res.get("text", "")}], "isError": bool(res.get("is_error"))})
        else:
            _reply(msg_id, error={"code": -32601, "message": f"Méthode inconnue : {method}"})
    except (urllib.error.URLError, OSError, ValueError, KeyError) as exc:
        if method == "tools/call":
            _reply(msg_id, {"content": [{"type": "text", "text": f"Interface Jarvis injoignable : {exc}"}], "isError": True})
        else:
            _reply(msg_id, error={"code": -32603, "message": str(exc)})


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if isinstance(msg, list):
            for m in msg:
                handle(m)
        else:
            handle(msg)


if __name__ == "__main__":
    main()
