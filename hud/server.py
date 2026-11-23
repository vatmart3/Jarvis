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
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import outils  # noqa: E402
import cerveau_claude  # noqa: E402
import securite  # noqa: E402
import widgets  # noqa: E402
import telephone  # noqa: E402
import schemas  # noqa: E402
import rapide  # noqa: E402
import memoire  # noqa: E402
import secrets  # noqa: E402

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
Tu es un majordome britannique pince-sans-rire : tu appelles l'utilisateur « Monsieur », tu parles toujours en français,
avec un ton calme et élégant, et tu proposes la suite logique quand c'est utile.
Tes réponses sont lues à voix haute : 1 à 3 phrases courtes, sans markdown, sans listes, sans émojis.
Date et heure actuelles : {now}.

Tu contrôles un écran holographique plein écran et l'ordinateur grâce à tes outils :
- afficher_carte : carte animée, zone surlignée, plusieurs lieux nommés, lieux reliés ;
- itineraire, style_carte (sombre, satellite, plan), zoom_carte, accueil (efface tout) ;
- afficher_panneau : panneau à l'écran pour une liste, un résumé, des chiffres ou des étapes ;
- afficher_schema : schéma construit en animation (processus, organigramme, carte mentale, chronologie, cycle, graphique chiffré) ;
- meteo, minuteur, infos_systeme : affichés à l'écran ;
- notifier_telephone, rappel_telephone : notification sur l'iPhone, tout de suite ou plus tard ;
- ajouter_widget, retirer_widget : widgets permanents sur l'écran d'accueil (météo, état du Mac, note, horloge, compte à rebours) ;
- ouvrir_application, ouvrir_url, rechercher_web, regler_volume : exécutés directement ;
- executer_commande : commande shell zsh (mkdir, open, osascript…) ; les commandes sensibles demandent une validation.
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


TOOLS += outils.TOOLS + widgets.TOOLS + telephone.TOOLS + schemas.TOOLS + memoire.TOOLS

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
            elif any(name in m.HANDLERS for m in (outils, widgets, telephone, schemas, memoire)):
                try:
                    result, ui = execute_tool(name, args)
                except Exception as exc:  # noqa: BLE001 - signalé au modèle
                    result, ui = f"Échec de l'outil {name} : {exc}", []
                actions.extend(ui)
                self._tool_result(name, result)
            elif name == "executer_commande":
                cmd = str(args.get("commande", ""))
                risque = securite.analyser(cmd)
                if current_autonomy() == "proprietaire" and risque is None:
                    result = run_shell(cmd)
                    actions.append({"type": "shell", "commande": cmd, "result": result})
                    self._tool_result(name, result)
                    continue
                expl = str(args.get("explication", ""))
                self.pending = {
                    "id": uuid.uuid4().hex,
                    "commande": cmd,
                    "explication": (f"Action sensible ({risque}). " if risque else "") + expl,
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
rapide.ouvrir_application = tool_ouvrir_application
rapide.regler_volume = tool_regler_volume


def chemin_rapide(text: str) -> dict | None:
    """Demandes simples traitées sans le modèle (réponse quasi instantanée)."""
    try:
        r = rapide.route(text)
    except Exception:  # noqa: BLE001 - en cas de doute, le cerveau prend le relais
        return None
    if r is None:
        return None
    reply, actions = r
    return {"reply": reply, "actions": actions, "pending": None, "rapide": True}


def execute_tool(name: str, args: dict) -> tuple[str, list[dict]]:
    """Exécute un outil non sensible ; renvoie (texte pour le modèle, actions d'interface)."""
    if name in DIRECT_TOOLS:
        result = DIRECT_TOOLS[name](args)
        return result, [{"type": "tool", "name": name, "args": args, "result": result}]
    if name in outils.HANDLERS:
        return outils.HANDLERS[name](args)
    if name in widgets.HANDLERS:
        return widgets.HANDLERS[name](args)
    if name in telephone.HANDLERS:
        return telephone.HANDLERS[name](args)
    if name in schemas.HANDLERS:
        return schemas.HANDLERS[name](args)
    if name in memoire.HANDLERS:
        return memoire.HANDLERS[name](args)
    return f"Outil inconnu : {name}", []


# Réglages persistants (cerveau choisi)
SETTINGS_PATH = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis")) / "hud.json"


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_settings(data: dict) -> None:
    try:
        SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass


def current_autonomy() -> str:
    return "prudent" if load_settings().get("autonomie") == "prudent" else "proprietaire"


VITESSES = {"rapide": "haiku", "equilibre": "sonnet", "puissant": "opus"}


def current_speed() -> str:
    v = load_settings().get("vitesse")
    return v if v in VITESSES else "equilibre"


def current_brain() -> str:
    choice = load_settings().get("cerveau")
    if choice in ("local", "claude"):
        return choice
    return "claude" if cerveau_claude.find_claude() else "local"


INTERNAL_TOKEN = secrets.token_hex(16)
LAST_POLL = [0.0]  # dernier passage de l'interface (fenêtre ouverte ?)
WAKE_AT = [0.0]  # dernier « Hey Jarvis »


def reveiller_mac(ouvrir: bool = True) -> bool:
    """Réveille l'interface (« Hey Jarvis ») ; ouvre la fenêtre si elle est fermée. Renvoie True si elle était ouverte."""
    fenetre = time.time() - LAST_POLL[0] < 3
    WAKE_AT[0] = time.time()
    BUS.push("wake")
    if not fenetre and ouvrir:
        try:
            subprocess.Popen([str(HUD_DIR / "ouvrir-fenetre.sh")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            pass
    return fenetre


CONTEXTE_TELEPHONE = ("[Demande envoyée à distance depuis l'iPhone de l'utilisateur : il n'est peut-être pas devant le Mac. "
                      "Fais la tâche sur le Mac en autonomie ; ta réponse finale lui sera envoyée en notification, "
                      "donc résume ce que tu as fait et donne les informations utiles en quelques phrases.] ")


def ordre_telephone(texte: str) -> None:
    """Ordre reçu de l'iPhone (raccourci « Hey Jarvis »)."""
    texte = texte.strip()
    if telephone.est_reveil(texte):
        reveiller_mac()
        telephone.notifier("Je suis ouvert sur ton Mac et je t'écoute.", "Jarvis")
        return
    BUS.push("activity", outil="telephone")
    try:
        fast = chemin_rapide(texte)
        if fast:
            res = fast
        elif current_brain() == "claude":
            res = BRAIN.ask(CONTEXTE_TELEPHONE + texte)
        else:
            res = SESSION.ask(texte)
            if res.get("pending"):
                BUS.push("pending", pending=res["pending"])
    except Exception as exc:  # noqa: BLE001
        res = {"error": str(exc)}
    if res.get("actions"):
        BUS.push("actions", actions=res["actions"])
    if res.get("error"):
        telephone.notifier(res["error"], "Jarvis · problème", "high", "warning")
    elif res.get("pending"):
        telephone.notifier("Action sensible en attente : valide-la sur l'écran du Mac.\n" + res["pending"]["commande"],
                           "Jarvis · validation requise", "high", "lock")
    else:
        telephone.notifier(res.get("reply") or "C'est fait.", "Jarvis")


def write_token() -> None:
    """Partage le jeton interne avec le programme d'écoute « Hey Jarvis » (fichier lisible par l'utilisateur seul)."""
    try:
        path = SETTINGS_PATH.parent / "hud-token"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(INTERNAL_TOKEN)
        os.chmod(path, 0o600)
    except OSError:
        pass
BUS = cerveau_claude.EventBus()
BRAIN = cerveau_claude.ClaudeBrain(PORT, INTERNAL_TOKEN, execute_tool, run_shell, BUS, current_autonomy,
                                   lambda: VITESSES[current_speed()], memoire.resume)
memoire.on_change = lambda kind, liste: BUS.push("memoire_sync", genre=kind, liste=liste)


def secrets_locaux() -> dict:
    """Clés optionnelles (ElevenLabs, Picovoice) : variables d'environnement ou ~/.openjarvis/hud-secrets.json."""
    try:
        d = json.loads((SETTINGS_PATH.parent / "hud-secrets.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        d = {}
    return {
        "elevenlabs_api_key": os.environ.get("ELEVENLABS_API_KEY") or d.get("elevenlabs_api_key", ""),
        "elevenlabs_voice_id": os.environ.get("ELEVENLABS_VOICE_ID") or d.get("elevenlabs_voice_id", "JBFqnCBsd6RMkjVDRZzb"),
        "picovoice_access_key": os.environ.get("PICOVOICE_ACCESS_KEY") or d.get("picovoice_access_key", ""),
    }


def elevenlabs(text: str) -> bytes:
    sec = secrets_locaux()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(sec['elevenlabs_voice_id'])}/stream?output_format=mp3_44100_64&optimize_streaming_latency=3",
        data=json.dumps({"text": text[:800], "model_id": "eleven_flash_v2_5", "language_code": "fr",
                         "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.15}}).encode("utf-8"),
        headers={"xi-api-key": sec["elevenlabs_api_key"], "Content-Type": "application/json", "Accept": "audio/mpeg"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()



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
STATIC = {"/": ("index.html", "text/html; charset=utf-8"), "/schema.js": ("schema.js", "text/javascript; charset=utf-8")}
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
            return self._json(200, {"model": MODEL, "ollama": OLLAMA, "mac": IS_MAC, "cerveau": current_brain(),
                                    "autonomie": current_autonomy(), "vitesse": current_speed(), "claude": bool(cerveau_claude.find_claude()),
                                    "reveil": time.time() - WAKE_AT[0] < 15})
        if path == "/api/events":
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            try:
                last = int(q.get("after", ["0"])[0])
            except ValueError:
                last = 0
            LAST_POLL[0] = time.time()
            events, newest = BUS.after(last)
            return self._json(200, {"events": events, "last": newest})
        if path == "/api/internal/tools":
            if not secrets.compare_digest(self.headers.get("X-Jarvis-Token", ""), INTERNAL_TOKEN):
                return self._send(403, b"Forbidden", "text/plain")
            return self._json(200, {"tools": TOOLS})
        if path == "/api/config":
            sec = secrets_locaux()
            return self._json(200, {"mode": "local", "llm": True, "elevenlabs": bool(sec["elevenlabs_api_key"]),
                                    "picovoice": sec["picovoice_access_key"] or None, "codeRequis": False})
        if path == "/api/memoire":
            return self._json(200, memoire.tout())
        if path == "/api/widgets":
            return self._json(200, {"widgets": widgets.load()})
        if path == "/api/widget/meteo":
            lieu = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("lieu", [""])[0]
            info, err = outils.meteo_info(lieu)
            return self._json(200 if info else 502, {"meteo": info} if info else {"error": err})
        if path == "/api/widget/systeme":
            return self._json(200, {"metriques": outils.system_metrics()})
        if path == "/api/voices":
            return self._json(200, {"kokoro": kokoro_available(), "say": say_voices()})
        if path in STATIC:
            name, ctype = STATIC[path]
            return self._send(200, (HUD_DIR / name).read_bytes(), ctype)
        if path.startswith("/vendor/") or path.startswith("/js/"):
            target = (HUD_DIR / urllib.parse.unquote(path.lstrip("/"))).resolve()
            base = (HUD_DIR / path.strip("/").split("/")[0]).resolve()
            if base in target.parents and target.is_file():
                ctype = VENDOR_TYPES.get(target.suffix, "application/octet-stream")
                return self._send(200, target.read_bytes(), ctype)
        self._send(404, b"Not found", "text/plain")

    def do_POST(self) -> None:
        # En-tête personnalisé obligatoire : un autre site ne peut pas l'envoyer
        # sans requête préalable CORS, que ce serveur n'accepte jamais.
        path = urllib.parse.urlparse(self.path).path
        internal = path.startswith("/api/internal/")
        if not self._host_ok():
            return self._send(403, b"Forbidden", "text/plain")
        if internal:
            if not secrets.compare_digest(self.headers.get("X-Jarvis-Token", ""), INTERNAL_TOKEN):
                return self._send(403, b"Forbidden", "text/plain")
        elif self.headers.get("X-Jarvis") != "1":
            return self._send(403, b"Forbidden", "text/plain")
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 100_000)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "Requête invalide."})
        try:
            if path == "/api/internal/wake":
                return self._json(200, {"fenetre": reveiller_mac(bool(data.get("ouvrir", True)))})
            if path == "/api/internal/tool":
                text, is_error = BRAIN.tool_call(str(data.get("name", "")), data.get("args") or {})
                return self._json(200, {"text": text, "is_error": is_error})
            if path == "/api/ask":
                text = str(data.get("text", "")).strip()
                if not text:
                    return self._json(400, {"error": "Message vide."})
                fast = chemin_rapide(text)
                if fast:
                    return self._json(200, fast)
                if current_brain() == "claude":
                    res = BRAIN.ask(text)
                    return self._json(502 if "error" in res else 200, res)
                return self._json(200, SESSION.ask(text))
            if path == "/api/confirm":
                pid, approve = str(data.get("id", "")), bool(data.get("approve"))
                if BRAIN.confirm(pid, approve):
                    return self._json(200, {"reply": "", "actions": [], "pending": None, "async": True})
                return self._json(200, SESSION.confirm(pid, approve))
            if path == "/api/memoire/sync":
                d = memoire.fusionner(data.get("faits") or [], data.get("notes") or [])
                return self._json(200, d)
            if path == "/api/voix":
                if not secrets_locaux()["elevenlabs_api_key"]:
                    return self._json(501, {"error": "ElevenLabs non configuré."})
                try:
                    audio = elevenlabs(str(data.get("text", "")))
                except Exception as exc:  # noqa: BLE001
                    return self._json(502, {"error": f"ElevenLabs indisponible : {exc}"})
                return self._send(200, audio, "audio/mpeg")
            if path == "/api/widgets/remove":
                text, _ = widgets.t_retirer({"cible": str(data.get("id", ""))})
                return self._json(200, {"ok": True, "text": text})
            if path == "/api/settings":
                st = load_settings()
                if data.get("cerveau") in ("local", "claude"):
                    st["cerveau"] = data["cerveau"]
                if data.get("autonomie") in ("prudent", "proprietaire"):
                    st["autonomie"] = data["autonomie"]
                if data.get("vitesse") in VITESSES:
                    st["vitesse"] = data["vitesse"]
                save_settings(st)
                return self._json(200, {"cerveau": current_brain(), "autonomie": current_autonomy(), "vitesse": current_speed(),
                                        "claude": bool(cerveau_claude.find_claude())})
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
                BRAIN.reset()
                return self._json(200, {"ok": True})
        except OllamaError as exc:
            return self._json(502, {"error": str(exc)})
        self._json(404, {"error": "Introuvable."})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    write_token()
    if telephone.config(create=False):  # configuré avec hud/telephone.sh
        telephone.Ecouteur(ordre_telephone).start()
        print("Lien iPhone actif (ntfy).")
    print(f"Jarvis HUD : http://localhost:{PORT}  (cerveau : {current_brain()}, modèle local : {MODEL})")
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
