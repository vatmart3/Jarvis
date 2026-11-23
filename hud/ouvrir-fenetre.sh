#!/bin/bash
# Ouvre la fenêtre Jarvis en plein écran dans une instance Chrome dédiée (profil séparé),
# autorisée à parler et à jouer du son sans clic préalable. Repli : navigateur par défaut.
URL="http://localhost:${JARVIS_HUD_PORT:-3000}"
PROFILE="${OPENJARVIS_HOME:-$HOME/.openjarvis}/chrome-jarvis"
CHROME="/Applications/Google Chrome.app"
if [ -d "$CHROME" ]; then
    mkdir -p "$PROFILE"
    open -na "$CHROME" --args --user-data-dir="$PROFILE" --app="$URL" --start-fullscreen \
        --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check
else
    open "$URL"
fi
