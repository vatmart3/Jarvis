#!/bin/bash
# Lance Jarvis HUD : démarre Ollama, le serveur local, puis ouvre l'interface en plein écran.
# Utilisé par l'application Jarvis.app ; peut aussi être lancé à la main (double-clic ou Terminal).
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HUD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${JARVIS_HUD_PORT:-3000}"
URL="http://localhost:$PORT"
OJ_HOME="${OPENJARVIS_HOME:-$HOME/.openjarvis}"
LOG="$OJ_HOME/hud.log"
SERVICE="local.jarvis.hud.server"
AGENT="$HOME/Library/LaunchAgents/$SERVICE.plist"
mkdir -p "$OJ_HOME"

up() { curl -s -o /dev/null -m 2 "$URL/api/status"; }

# 1. Ollama (moteur du modèle local)
if ! curl -s -o /dev/null -m 2 http://localhost:11434/api/tags; then
    echo "Démarrage d'Ollama…"
    if [ -d /Applications/Ollama.app ]; then open -g -a Ollama; else (nohup ollama serve >/dev/null 2>&1 &); fi
    for _ in $(seq 1 30); do curl -s -o /dev/null -m 2 http://localhost:11434/api/tags && break; sleep 1; done
fi

# 2. Serveur de l'interface (redémarré à chaque lancement pour prendre les mises à jour)
if [ -f "$AGENT" ]; then
    # Service installé par installer-app.sh : launchd le garde en vie.
    launchctl kickstart -k "gui/$(id -u)/$SERVICE" 2>/dev/null || { launchctl unload "$AGENT" 2>/dev/null; launchctl load "$AGENT"; }
else
    pkill -f "hud/server.py" 2>/dev/null && sleep 0.5
    PY="$OJ_HOME/.venv/bin/python"
    [ -x "$PY" ] || PY="$(command -v python3)"
    nohup "$PY" "$HUD_DIR/server.py" >"$LOG" 2>&1 &
fi
sleep 0.4
for _ in $(seq 1 30); do up && break; sleep 0.5; done
if ! up; then
    echo "Le serveur n'a pas démarré. Détails : $LOG"; tail -n 20 "$LOG"; exit 1
fi

# 3. Interface plein écran (instance Chrome dédiée à Jarvis)
"$HUD_DIR/ouvrir-fenetre.sh"
echo "Jarvis est prêt : $URL"
