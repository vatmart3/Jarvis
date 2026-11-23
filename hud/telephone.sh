#!/bin/bash
# Configure le lien iPhone (notifications + raccourci « Hey Jarvis ») et affiche le guide.
#   ./hud/telephone.sh
HUD_DIR="$(cd "$(dirname "$0")" && pwd)"
OJ_HOME="${OPENJARVIS_HOME:-$HOME/.openjarvis}"
PY="$OJ_HOME/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
"$PY" "$HUD_DIR/telephone.py" --test
# Redémarre le serveur Jarvis pour qu'il écoute les ordres de l'iPhone.
SERVICE="local.jarvis.hud.server"
if [ -f "$HOME/Library/LaunchAgents/$SERVICE.plist" ]; then
    launchctl kickstart -k "gui/$(id -u)/$SERVICE" 2>/dev/null && echo "Serveur Jarvis redémarré : le lien iPhone est actif."
else
    echo "Relance Jarvis pour activer la réception des ordres de l'iPhone."
fi
echo "Guide gardé dans : $OJ_HOME/hud-telephone-guide.txt"
"$PY" "$HUD_DIR/telephone.py" > "$OJ_HOME/hud-telephone-guide.txt"
