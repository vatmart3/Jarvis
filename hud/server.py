#!/usr/bin/env python3
"""Jarvis HUD — serveur local de l'interface vocale.

Sert l'interface (hud/index.html) sur http://localhost:3000 et fait le lien
avec le modèle local d'Ollama (le même que celui d'OpenJarvis). Le modèle peut
demander des actions sur l'ordinateur :

  - ouvrir une application, une page web ou une recherche ;
  - piloter l'écran : carte animée, itinéraires, météo, panneaux, minuteurs (voir outils.py) ;
  - régler le volume ;
  - exécuter une commande shell, UNIQUEMENT après ta validation dans l'interface.

Aucune dépendance : bibliothèque standard Python 3.9+.
Le serveur n'écoute que sur 127.0.0.1 et refuse les requêtes d'autres sites.
"""

from __future__ import annotations

import json
import os
import platform
import re
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import outils  # noqa: E402

HUD_DIR = Path(__file__).resolve().parent
PORT = int(os.environ.get("JARVIS_HUD_PORT", "3000"))
OLLAMA = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
if not OLLAMA.startswith("http"):
    OLLAMA = "http://" + OLLAMA
IS_MAC = platform.system() == "Darwin"
MAX_TOOL_ROUNDS = 8
MAX_HISTORY = 30
SHELL_TIMEOUT = 60
OUTPUT_LIMIT = 4000


def _config_model() -> str:
    """Modèle : $JARVIS_MODEL, sinon celui de ~/.openjarvis/config.toml."""
    if os.environ.get("JARVIS_MODEL"):
        return os.environ["JARVIS_MODEL"]
    home = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis"))
    try:
        text = (home / "config.toml").read_text(encoding="utf-8")
        section = re.search(r"^\[intelligence\](.*?)(?=^\[|\Z)", text, re.M | re.S)
        if section:
            m = re.search(r'^\s*default_model\s*=\s*"([^"]+)"', section.group(1), re.M)
            if m:
                return m.group(1)
    except OSError:
        pass
    return "qwen3.5:4b"


MODEL = _config_model()

SYSTEM_PROMPT = """Tu es JARVIS, l'assistant IA personnel de l'utilisateur, qui tourne en local sur son ordinateur ({os}).
Tu parles toujours en français, avec un ton calme, élégant et une pointe d'humour britannique.
Tes réponses sont lues à voix haute : 1 à 3 phrases courtes, sans markdown, sans listes, sans émojis.
Date et heure actuelles : {now}.

Tu contrôles un écran holographique plein écran et l'ordinateur grâce à tes outils :
- afficher_carte : carte animée, zone surlignée, plusieurs lieux nommés, lieux reliés ;
- itineraire, style_carte (sombre, satellite, plan), zoom_carte, accueil (efface tout) ;
- afficher_panneau : panneau à l'écran pour une liste, un résumé, des chiffres ou des étapes ;
- meteo, minuteur, infos_systeme : affichés à l'écran ;
- ouvrir_application, ouvrir_url, rechercher_web, regler_volume : exécutés directement ;
- executer_commande : commande shell ; l'utilisateur doit la valider avant exécution.
Sois visuel : dès qu'une réponse peut se montrer (lieux, listes, chiffres, comparaisons), utilise l'outil d'affichage adapté,
et enchaîne plusieurs outils si la demande le demande. Si l'utilisateur dit « tu veux » ou « ce que tu veux », choisis toi-même
des exemples pertinents. Après les actions, confirme brièvement à l'oral sans relire tout le contenu affiché.
Pour executer_commande, choisis des commandes sûres et explique en une phrase ce qu'elles font.
N'invente jamais le résultat d'une action."""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "ouvrir_application",
            "description": "Ouvre une application installée (ex. Safari, Spotify, Notes, Calendrier, Finder).",
            "parameters": {
                "type": "object",
                "properties": {"nom": {"type": "string", "description": "Nom de l'application"}},
                "required": ["nom"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ouvrir_url",
            "description": "Ouvre une adresse web (http ou https) dans le navigateur.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rechercher_web",
            "description": "Lance une recherche web dans le navigateur.",
            "parameters": {
                "type": "object",
                "properties": {"requete": {"type": "string"}},
                "required": ["requete"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "regler_volume",
            "description": "Règle le volume sonore de l'ordinateur, de 0 (muet) à 100.",
            "parameters": {
                "type": "object",
                "properties": {"niveau": {"type": "integer", "minimum": 0, "maximum": 100}},
                "required": ["niveau"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "executer_commande",
            "description": (
                "Exécute une commande shell (zsh/bash) sur l'ordinateur et renvoie sa sortie. "
                "L'utilisateur doit la valider avant exécution."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "commande": {"type": "string"},
                    "explication": {"type": "string", "description": "Ce que fait la commande, en une phrase"},
                },
                "required": ["commande", "explication"],
            },
        },
    },
]


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------

def _run(args: list[str]) -> tuple[bool, str]:
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, str(exc)
    out = (proc.stdout + proc.stderr).strip()
    return proc.returncode == 0, out


def _open_target(target: str, app: bool = False) -> tuple[bool, str]:
    if IS_MAC:
        return _run(["open", "-a", target] if app else ["open", target])
    if app:
        return _run([target])
    return _run(["xdg-open", target])


def tool_ouvrir_application(nom: str) -> str:
    ok, out = _open_target(nom, app=True)
    return f"Application « {nom} » ouverte." if ok else f"Impossible d'ouvrir « {nom} » : {out}"


def tool_ouvrir_url(url: str) -> str:
    url = url.strip()
    if not re.match(r"^https?://", url):
        url = "https://" + url
    if urllib.parse.urlparse(url).scheme not in ("http", "https"):
        return "Adresse refusée : seules les adresses http et https sont autorisées."
    ok, out = _open_target(url)
    return f"Page {url} ouverte." if ok else f"Échec : {out}"


def tool_rechercher_web(requete: str) -> str:
    url = "https://www.google.com/search?q=" + urllib.parse.quote(requete)
    ok, out = _open_target(url)
    return f"Recherche « {requete} » ouverte." if ok else f"Échec : {out}"


def tool_regler_volume(niveau) -> str:
    try:
        level = max(0, min(100, int(niveau)))
    except (TypeError, ValueError):
        return "Niveau de volume invalide."
    if not IS_MAC:
        return "Réglage du volume disponible uniquement sur macOS."
    ok, out = _run(["osascript", "-e", f"set volume output volume {level}"])
    return f"Volume réglé à {level} %." if ok else f"Échec : {out}"


def run_shell(commande: str) -> str:
    shell = os.environ.get("SHELL", "/bin/zsh" if IS_MAC else "/bin/bash")
    try:
        proc = subprocess.run(
            [shell, "-lc", commande],
            capture_output=True,
            text=True,
            timeout=SHELL_TIMEOUT,
            cwd=str(Path.home()),
        )
    except subprocess.TimeoutExpired:
        return f"La commande a dépassé {SHELL_TIMEOUT} secondes et a été arrêtée."
    except OSError as exc:
        return f"Échec : {exc}"
    out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
    out = out.strip() or "(aucune sortie)"
    if len(out) > OUTPUT_LIMIT:
        out = out[:OUTPUT_LIMIT] + "\n… (sortie tronquée)"
    return f"Code de sortie {proc.returncode}.\n{out}"


TOOLS += outils.TOOLS

DIRECT_TOOLS = {
    "ouvrir_application": lambda a: tool_ouvrir_application(str(a.get("nom", ""))),
    "ouvrir_url": lambda a: tool_ouvrir_url(str(a.get("url", ""))),
    "rechercher_web": lambda a: tool_rechercher_web(str(a.get("requete", ""))),
    "regler_volume": lambda a: tool_regler_volume(a.get("niveau")),
}


# --------------------------------------------------------------------------
# Conversation avec Ollama
# --------------------------------------------------------------------------

class OllamaError(RuntimeError):
    pass


_think_supported = True


def ollama_chat(messages: list[dict]) -> dict:
    global _think_supported
    payload = {"model": MODEL, "messages": messages, "tools": TOOLS, "stream": False}
    if _think_supported:
        payload["think"] = False
    req = urllib.request.Request(
        OLLAMA + "/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            return json.loads(resp.read().decode("utf-8"))["message"]
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        if _think_supported and "think" in body.lower():
            _think_supported = False
            return ollama_chat(messages)
        raise OllamaError(f"Ollama a répondu {exc.code} : {body[:300]}") from exc
    except (urllib.error.URLError, OSError) as exc:
        raise OllamaError(
            "Ollama est injoignable. Ouvre l'application Ollama ou lance « ollama serve »."
        ) from exc


def _parse_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


class Session:
    """Une seule conversation (usage personnel, un seul utilisateur)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        self.history: list[dict] = []
        self.pending: dict | None = None  # appel executer_commande en attente
        self.queue: list[dict] = []  # appels d'outils restants du même tour

    def _messages(self) -> list[dict]:
        now = datetime.now().strftime("%A %d %B %Y, %H:%M")
        system = SYSTEM_PROMPT.format(os="macOS" if IS_MAC else platform.system(), now=now)
        return [{"role": "system", "content": system}] + self.history[-MAX_HISTORY:]

    def _tool_result(self, name: str, content: str) -> None:
        self.history.append({"role": "tool", "tool_name": name, "content": content})

    def _process_queue(self, actions: list[dict]) -> dict | None:
        """Exécute les appels en file. Renvoie une demande de validation si besoin."""
        while self.queue:
            call = self.queue.pop(0)
            fn = call.get("function", {})
            name = fn.get("name", "")
            args = _parse_args(fn.get("arguments"))
            if name in DIRECT_TOOLS:
                result = DIRECT_TOOLS[name](args)
                actions.append({"type": "tool", "name": name, "args": args, "result": result})
                self._tool_result(name, result)
            elif name in outils.HANDLERS:
                try:
                    result, ui = outils.HANDLERS[name](args)
                except Exception as exc:  # noqa: BLE001 - signalé au modèle
                    result, ui = f"Échec de l'outil {name} : {exc}", []
                actions.extend(ui)
                self._tool_result(name, result)
            elif name == "executer_commande":
                self.pending = {
                    "id": uuid.uuid4().hex,
                    "commande": str(args.get("commande", "")),
                    "explication": str(args.get("explication", "")),
                }
                return self.pending
            else:
                self._tool_result(name, f"Outil inconnu : {name}")
        return None

    def _loop(self, actions: list[dict]) -> dict:
        for _ in range(MAX_TOOL_ROUNDS):
            pending = self._process_queue(actions)
            if pending:
                return {"reply": "", "actions": actions, "pending": pending}
            msg = ollama_chat(self._messages())
            calls = msg.get("tool_calls") or []
            entry = {"role": "assistant", "content": msg.get("content", "") or ""}
            if calls:
                entry["tool_calls"] = calls
            self.history.append(entry)
            if not calls:
                reply = re.sub(r"<think>.*?</think>", "", entry["content"], flags=re.S).strip()
                return {"reply": reply, "actions": actions, "pending": None}
            self.queue = list(calls)
        return {
            "reply": "J'ai atteint ma limite d'actions pour cette demande.",
            "actions": actions,
            "pending": None,
        }

    def ask(self, text: str) -> dict:
        with self.lock:
            if self.pending:
                self._tool_result("executer_commande", "Commande annulée : l'utilisateur est passé à autre chose.")
                self.pending, self.queue = None, []
            self.history.append({"role": "user", "content": text})
            return self._loop([])

    def confirm(self, pending_id: str, approve: bool) -> dict:
        with self.lock:
            if not self.pending or self.pending["id"] != pending_id:
                return {"reply": "Aucune commande en attente.", "actions": [], "pending": None}
            cmd = self.pending["commande"]
            self.pending = None
            actions: list[dict] = []
            if approve:
                result = run_shell(cmd)
                actions.append({"type": "shell", "commande": cmd, "result": result})
            else:
                result = "Commande refusée par l'utilisateur. Ne la relance pas sans nouvelle demande."
                self.queue = []
            self._tool_result("executer_commande", result)
            return self._loop(actions)


SESSION = Session()



# --------------------------------------------------------------------------
# Voix (synthèse côté serveur)
# --------------------------------------------------------------------------

_kokoro = None
_kokoro_lock = threading.Lock()


def kokoro_available() -> bool:
    """Kokoro (voix neuronale locale d'OpenJarvis) est-il installé ?"""
    import importlib.util

    try:
        return bool(importlib.util.find_spec("kokoro")) and bool(
            importlib.util.find_spec("openjarvis.speech.kokoro_tts")
        )
    except (ImportError, ValueError):
        return False


def say_voices() -> list[dict]:
    """Voix macOS (commande say), françaises en premier."""
    if not IS_MAC:
        return []
    ok, out = _run(["say", "-v", "?"])
    if not ok:
        return []
    voices = []
    for line in out.splitlines():
        m = re.match(r"^(.+?)\s+([a-z]{2}[_-][A-Z]{2})\s+#", line)
        if m:
            name, lang = m.group(1).strip(), m.group(2).replace("_", "-")
            voices.append({"name": name, "lang": lang})
    voices.sort(key=lambda v: (not v["lang"].startswith("fr"), v["name"]))
    return voices


def tts_say(text: str, voice: str, rate: int) -> bytes:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "voix.wav"
        args = ["say", "-o", str(out), "--file-format=WAVE", "--data-format=LEI16@22050", "-r", str(rate)]
        if voice:
            args += ["-v", voice]
        proc = subprocess.run(args + ["--", text], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0 or not out.exists():
            raise RuntimeError(proc.stderr.strip() or "say a échoué")
        return out.read_bytes()


def tts_kokoro(text: str, voice: str, speed: float) -> bytes:
    global _kokoro
    with _kokoro_lock:
        if _kokoro is None:
            from openjarvis.speech.kokoro_tts import KokoroTTSBackend

            _kokoro = KokoroTTSBackend()
        result = _kokoro.synthesize(text, voice_id=voice or "ff_siwis", speed=speed, output_format="wav")
    if not result.audio:
        raise RuntimeError("Kokoro n'a produit aucun son.")
    return result.audio

# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

ALLOWED_HOSTS = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
STATIC = {"/": ("index.html", "text/html; charset=utf-8")}
VENDOR_TYPES = {".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"}


class Handler(BaseHTTPRequestHandler):
    server_version = "JarvisHUD/1.0"

    def log_message(self, fmt: str, *args) -> None:  # silence
        if os.environ.get("JARVIS_HUD_DEBUG"):
            super().log_message(fmt, *args)

    def _host_ok(self) -> bool:
        return self.headers.get("Host", "") in ALLOWED_HOSTS

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, data: dict) -> None:
        self._send(code, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def do_GET(self) -> None:
        if not self._host_ok():
            return self._send(403, b"Forbidden", "text/plain")
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/status":
            return self._json(200, {"model": MODEL, "ollama": OLLAMA, "mac": IS_MAC})
        if path == "/api/voices":
            return self._json(200, {"kokoro": kokoro_available(), "say": say_voices()})
        if path in STATIC:
            name, ctype = STATIC[path]
            return self._send(200, (HUD_DIR / name).read_bytes(), ctype)
        if path.startswith("/vendor/"):
            target = (HUD_DIR / urllib.parse.unquote(path.lstrip("/"))).resolve()
            vendor = (HUD_DIR / "vendor").resolve()
            if vendor in target.parents and target.is_file():
                ctype = VENDOR_TYPES.get(target.suffix, "application/octet-stream")
                return self._send(200, target.read_bytes(), ctype)
        self._send(404, b"Not found", "text/plain")

    def do_POST(self) -> None:
        # En-tête personnalisé obligatoire : un autre site ne peut pas l'envoyer
        # sans requête préalable CORS, que ce serveur n'accepte jamais.
        if not self._host_ok() or self.headers.get("X-Jarvis") != "1":
            return self._send(403, b"Forbidden", "text/plain")
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 100_000)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "Requête invalide."})
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/ask":
                text = str(data.get("text", "")).strip()
                if not text:
                    return self._json(400, {"error": "Message vide."})
                return self._json(200, SESSION.ask(text))
            if path == "/api/confirm":
                return self._json(200, SESSION.confirm(str(data.get("id", "")), bool(data.get("approve"))))
            if path == "/api/tts":
                text = str(data.get("text", "")).strip()[:3000]
                engine = data.get("engine")
                voice = str(data.get("voice", ""))
                if not text:
                    return self._json(400, {"error": "Texte vide."})
                try:
                    if engine == "kokoro":
                        audio = tts_kokoro(text, voice, float(data.get("speed", 1.0)))
                    elif engine == "say" and IS_MAC:
                        audio = tts_say(text, voice, int(data.get("rate", 185)))
                    else:
                        return self._json(400, {"error": "Moteur de voix inconnu."})
                except Exception as exc:  # noqa: BLE001 - renvoyé à l'interface
                    return self._json(500, {"error": f"Synthèse vocale impossible : {exc}"})
                return self._send(200, audio, "audio/wav")
            if path == "/api/reset":
                with SESSION.lock:
                    SESSION.reset()
                return self._json(200, {"ok": True})
        except OllamaError as exc:
            return self._json(502, {"error": str(exc)})
        self._json(404, {"error": "Introuvable."})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Jarvis HUD : http://localhost:{PORT}  (modèle : {MODEL}, Ollama : {OLLAMA})")
    print("Ctrl+C pour arrêter.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    if sys.version_info < (3, 9):
        sys.exit("Python 3.9 ou plus récent est requis.")
    main()
