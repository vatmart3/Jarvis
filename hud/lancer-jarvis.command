#!/bin/bash
# Lance Jarvis HUD : démarre Ollama, le serveur local, puis ouvre l'interface en plein écran.
# Double-clique sur ce fichier dans le Finder, ou lance-le depuis le Terminal.
HUD_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${JARVIS_HUD_PORT:-3000}"
URL="http://localhost:$PORT"
LOG="${OPENJARVIS_HOME:-$HOME/.openjarvis}/hud.log"
mkdir -p "$(dirname "$LOG")"

# 1. Ollama (moteur du modèle local)
if ! curl -s -o /dev/null http://localhost:11434/api/tags; then
    echo "Démarrage d'Ollama…"
    if [ -d /Applications/Ollama.app ]; then open -g -a Ollama; else (ollama serve >/dev/null 2>&1 &); fi
    for _ in $(seq 1 30); do curl -s -o /dev/null http://localhost:11434/api/tags && break; sleep 1; done
fi

# 2. Serveur de l'interface
if curl -s -o /dev/null "$URL/api/status"; then
    echo "Jarvis HUD tourne déjà."
else
    PY="${OPENJARVIS_HOME:-$HOME/.openjarvis}/.venv/bin/python"
    [ -x "$PY" ] || PY="$(command -v python3)"
    echo "Démarrage de Jarvis HUD…"
    nohup "$PY" "$HUD_DIR/server.py" >"$LOG" 2>&1 &
    for _ in $(seq 1 20); do curl -s -o /dev/null "$URL/api/status" && break; sleep 0.5; done
    if ! curl -s -o /dev/null "$URL/api/status"; then
        echo "Le serveur n'a pas démarré. Détails : $LOG"; tail -n 20 "$LOG"; exit 1
    fi
fi

# 3. Interface plein écran (Chrome en mode application, sinon navigateur par défaut)
if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="$URL" --start-fullscreen
else
    open "$URL"
fi
echo "Jarvis est prêt : $URL"
echo "Pour l'arrêter : pkill -f hud/server.py"
