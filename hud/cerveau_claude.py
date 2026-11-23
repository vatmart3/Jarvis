"""Cerveau « Claude » de Jarvis HUD : passe chaque demande à Claude Code en mode
non interactif (`claude -p`), connecté avec l'abonnement Claude de l'utilisateur
(aucune clé API).

Claude reçoit les outils de l'interface via un petit serveur MCP (mcp_hud.py),
qui rappelle ce serveur HTTP local. Bash, Edit et Write de Claude Code sont
désactivés : les commandes système passent par l'outil `executer_commande`,
qui demande la validation de l'utilisateur dans l'interface.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import uuid
from datetime import datetime
from pathlib import Path

import securite

HUD_DIR = Path(__file__).resolve().parent
OJ_HOME = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis"))
APPROVAL_TIMEOUT = 180
RUN_TIMEOUT = 900

PROMPT = """Tu es JARVIS, l'assistant personnel de l'utilisateur, affiché sur un écran holographique plein écran de son Mac.
Tu parles toujours en français, avec un ton calme, élégant et une pointe d'humour britannique.
Ta réponse finale est lue à voix haute : 1 à 3 phrases courtes, naturelles, sans markdown, sans listes, sans émojis, sans URL.
Les détails (listes, chiffres, étapes, comparaisons, sources) vont à l'écran avec l'outil mcp__hud__afficher_panneau.

Tes outils d'interface (serveur MCP « hud ») : afficher_carte (zone surlignée, plusieurs lieux nommés, reliés), itineraire,
style_carte, zoom_carte, accueil, afficher_panneau, meteo, minuteur, infos_systeme, ouvrir_application, ouvrir_url,
rechercher_web (ouvre le navigateur), regler_volume, executer_commande.
Sois visuel : dès qu'une réponse peut se montrer, montre-la, et enchaîne plusieurs outils si besoin.
Pour expliquer un fonctionnement, un processus, une organisation, une comparaison, une histoire ou des chiffres, utilise
mcp__hud__afficher_schema : l'écran le construit en animation sous les yeux de l'utilisateur. Textes courts dans les blocs,
8 à 16 éléments idéalement, liens nommés quand c'est utile, groupes de couleur pour les familles d'éléments.
Pour toute information récente ou que tu ne connais pas, utilise WebSearch / WebFetch avant de répondre.
Tu peux lire les fichiers (Read, Glob, Grep). Pour agir sur l'ordinateur, utilise mcp__hud__executer_commande
(zsh sur macOS) : mkdir, fichiers, open, osascript (AppleScript pour piloter Finder, Notes, Rappels, Calendrier, Musique,
Safari, réglages…), shortcuts run (raccourcis de l'utilisateur), screencapture, etc.
Tu peux aussi ajouter des widgets permanents sur ton propre écran avec mcp__hud__ajouter_widget.
Tu peux prévenir l'utilisateur sur son iPhone : mcp__hud__notifier_telephone (tout de suite) et
mcp__hud__rappel_telephone (plus tard, ex. « rappelle-moi à 18 h »). Utilise-les quand il le demande, ou pour signaler
la fin d'une tâche longue lancée depuis son téléphone.
{autonomie}
Pour déplacer ou copier, utilise mv -n / cp -n (jamais d'écrasement). Si une commande est refusée, n'insiste pas.
N'invente jamais un résultat : vérifie ce que tu as fait. Date et heure : {now}."""

AUTONOMIE = {
    "proprietaire": ("MODE PROPRIÉTAIRE : l'utilisateur t'a confié son Mac. Agis directement comme s'il le faisait lui-même : "
                     "ne demande pas de confirmation à l'oral, fais la tâche en entier puis dis ce que tu as fait. "
                     "Les commandes sensibles (suppression, écrasement, sudo, envoi de messages, réglages système) "
                     "déclenchent automatiquement une demande de validation à l'écran."),
    "prudent": "MODE PRUDENT : l'utilisateur valide chaque commande à l'écran ; explique-la en une phrase.",
}

ALLOWED = "mcp__hud__*,Read,Glob,Grep,WebSearch,WebFetch"
DISALLOWED = "Bash,Edit,Write,NotebookEdit"


def find_claude() -> str | None:
    for cand in (
        os.environ.get("JARVIS_CLAUDE_BIN", ""),
        shutil.which("claude") or "",
        str(Path.home() / ".local/bin/claude"),
        str(Path.home() / ".claude/local/claude"),
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
    ):
        if cand and os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


class EventBus:
    """File d'événements lue par l'interface (GET /api/events)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: list[dict] = []
        self._next = 1

    def push(self, kind: str, **data) -> None:
        with self._lock:
            self._events.append({"id": self._next, "type": kind, **data})
            self._next += 1
            del self._events[:-200]

    def after(self, last: int) -> tuple[list[dict], int]:
        with self._lock:
            return [e for e in self._events if e["id"] > last], self._next - 1


class ClaudeBrain:
    def __init__(self, port: int, token: str, execute_tool, run_shell, bus: EventBus, get_autonomy=lambda: "prudent",
                 get_model=lambda: "") -> None:
        self.port, self.token = port, token
        self.get_autonomy, self.get_model = get_autonomy, get_model
        self.execute_tool, self.run_shell, self.bus = execute_tool, run_shell, bus
        self.session_id: str | None = None
        self.lock = threading.Lock()
        self.approvals: dict[str, dict] = {}
        self.model = os.environ.get("JARVIS_CLAUDE_MODEL", "")
        self.proc: subprocess.Popen | None = None

    # ---- outils appelés par mcp_hud.py ----
    def tool_call(self, name: str, args: dict) -> tuple[str, bool]:
        if name == "executer_commande":
            return self._shell_with_approval(args)
        try:
            text, ui = self.execute_tool(name, args)
        except Exception as exc:  # noqa: BLE001
            return f"Échec de l'outil {name} : {exc}", True
        if ui:
            self.bus.push("actions", actions=ui)
        return text, False

    def _shell_with_approval(self, args: dict) -> tuple[str, bool]:
        pid = uuid.uuid4().hex
        cmd = str(args.get("commande", ""))
        risque = securite.analyser(cmd)
        if self.get_autonomy() == "proprietaire" and risque is None:
            self.bus.push("activity", outil="executer_commande")
            result = self.run_shell(cmd)
            self.bus.push("actions", actions=[{"type": "shell", "commande": cmd, "result": result}])
            return result, False
        if risque:
            args = dict(args, explication=f"Action sensible ({risque}). " + str(args.get("explication", "")))
        slot = {"event": threading.Event(), "approve": False}
        self.approvals[pid] = slot
        self.bus.push("pending", pending={"id": pid, "commande": cmd, "explication": str(args.get("explication", ""))})
        try:
            if not slot["event"].wait(APPROVAL_TIMEOUT):
                self.bus.push("pending_closed", id=pid)
                return "Pas de réponse de l'utilisateur : commande annulée.", True
        finally:
            self.approvals.pop(pid, None)
        if not slot["approve"]:
            return "Commande refusée par l'utilisateur. Ne la relance pas sans nouvelle demande.", True
        result = self.run_shell(cmd)
        self.bus.push("actions", actions=[{"type": "shell", "commande": cmd, "result": result}])
        return result, False

    def confirm(self, pid: str, approve: bool) -> bool:
        slot = self.approvals.get(pid)
        if not slot:
            return False
        slot["approve"] = approve
        slot["event"].set()
        return True

    # ---- conversation ----
    def reset(self) -> None:
        self.session_id = None

    def _mcp_config(self) -> str:
        OJ_HOME.mkdir(parents=True, exist_ok=True)
        path = OJ_HOME / "hud-mcp.json"
        cfg = {"mcpServers": {"hud": {
            "command": sys.executable,
            "args": [str(HUD_DIR / "mcp_hud.py")],
            "env": {"JARVIS_HUD_PORT": str(self.port), "JARVIS_HUD_TOKEN": self.token},
        }}}
        path.write_text(json.dumps(cfg), encoding="utf-8")
        os.chmod(path, 0o600)
        return str(path)

    def ask(self, text: str) -> dict:
        claude = find_claude()
        if not claude:
            return {"error": "Claude Code n'est pas installé. Dans le Terminal : curl -fsSL https://claude.ai/install.sh | bash, "
                             "puis tape « claude » une fois pour te connecter."}
        if not self.lock.acquire(blocking=False):
            return {"error": "Je travaille encore sur la demande précédente."}
        try:
            now = datetime.now().strftime("%A %d %B %Y, %H:%M")
            cmd = [claude, "-p", text.lstrip("-").strip() or "?", "--output-format", "stream-json", "--verbose",
                   "--mcp-config", self._mcp_config(), "--strict-mcp-config",
                   "--allowedTools", ALLOWED, "--disallowedTools", DISALLOWED,
                   "--append-system-prompt", PROMPT.format(now=now, autonomie=AUTONOMIE.get(self.get_autonomy(), AUTONOMIE["prudent"])), "--max-turns", "30"]
            model = self.model or self.get_model()
            if model:
                cmd += ["--model", model]
            if self.session_id:
                cmd += ["--resume", self.session_id]
            env = dict(os.environ)
            env.pop("ANTHROPIC_API_KEY", None)  # on utilise l'abonnement, pas une clé
            return self._run(cmd, env)
        finally:
            self.lock.release()

    def _run(self, cmd: list[str], env: dict) -> dict:
        try:
            self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                         cwd=str(Path.home()), env=env, bufsize=1)
        except OSError as exc:
            return {"error": f"Impossible de lancer Claude Code : {exc}"}
        killer = threading.Timer(RUN_TIMEOUT, lambda: self.proc and self.proc.kill())
        killer.start()
        result, err_lines, last_text = None, [], ""
        try:
            for line in self.proc.stdout:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    msg = json.loads(line)
                except ValueError:
                    continue
                if msg.get("session_id"):
                    self.session_id = msg["session_id"]
                if msg.get("type") == "assistant":
                    for block in (msg.get("message") or {}).get("content") or []:
                        if block.get("type") == "text" and block.get("text", "").strip():
                            last_text = block["text"].strip()
                        elif block.get("type") == "tool_use":
                            self.bus.push("activity", outil=str(block.get("name", "")))
                elif msg.get("type") == "result":
                    result = msg
            self.proc.wait(timeout=30)
            err_lines = (self.proc.stderr.read() or "").strip().splitlines()[-5:]
        finally:
            killer.cancel()
        if result and not result.get("is_error") and result.get("subtype", "success") == "success":
            return {"reply": (result.get("result") or last_text).strip(), "actions": [], "pending": None}
        detail = " ".join(err_lines) or (result or {}).get("result") or " ".join((result or {}).get("errors") or [])
        low = (detail or "").lower()
        if any(k in low for k in ("login", "log in", "authenticat", "not logged", "credential", "oauth")):
            return {"error": "Claude Code n'est pas connecté. Ouvre le Terminal, tape « claude » et connecte-toi avec ton compte Claude."}
        if (result or {}).get("subtype") == "error_max_turns":
            return {"reply": last_text or "J'ai atteint ma limite d'étapes pour cette demande.", "actions": [], "pending": None}
        if self.session_id and "session" in low:
            self.session_id = None  # session introuvable : on repart de zéro la prochaine fois
        return {"error": "Claude n'a pas pu répondre : " + (detail or "erreur inconnue")[:300]}
