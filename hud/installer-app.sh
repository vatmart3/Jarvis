#!/bin/bash
# Crée l'application « Jarvis » (macOS) : ouvrable depuis le Launchpad, Spotlight (Cmd+Espace « Jarvis ») ou le Dock.
#   ./hud/installer-app.sh
# À relancer si tu déplaces le dossier jarvis-kit. Aucun mot de passe administrateur nécessaire.
# Pour tout désinstaller : ./hud/installer-app.sh --desinstaller
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then echo "Ce script est pour macOS."; exit 1; fi

ask() {  # question oui/non lue au clavier, « non » si aucun terminal
    local a=""
    [ -n "${JARVIS_INSTALL_YES:-}" ] && return 0  # réponses automatiques (tests)
    if { exec 3</dev/tty; } 2>/dev/null; then read -r -p "$1 [o/N] " a <&3 || a=""; exec 3<&-; fi
    [[ "$a" =~ ^[oOyY] ]]
}

HUD_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Applications/Jarvis.app"
LABEL="local.jarvis.hud"

if [[ "${1:-}" == "--desinstaller" ]]; then
    for f in "$HOME/Library/LaunchAgents/$LABEL.server.plist" "$HOME/Library/LaunchAgents/$LABEL.plist" "$HOME/Library/LaunchAgents/$LABEL.ecoute.plist"; do
        [ -f "$f" ] && { launchctl unload "$f" 2>/dev/null || true; rm -f "$f"; }
    done
    pkill -f "hud/server.py" 2>/dev/null || true
    pkill -f "hud/ecoute.py" 2>/dev/null || true
    rm -rf "$APP_DIR" "$HOME/Applications/Jarvis Ecoute.app"
    echo "Jarvis.app, l'écoute « Hey Jarvis » et leurs services ont été supprimés (pense à retirer l'icône du Dock si besoin)."
    exit 0
fi

echo "==> Création de $APP_DIR"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

cat > "$APP_DIR/Contents/MacOS/Jarvis" <<SCRIPT
#!/bin/bash
export PATH="\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LOG="\${OPENJARVIS_HOME:-\$HOME/.openjarvis}/hud-app.log"
mkdir -p "\$(dirname "\$LOG")"
if [ ! -x "$HUD_DIR/lancer-jarvis.command" ]; then
    osascript -e 'display alert "Jarvis" message "Dossier jarvis-kit introuvable ($HUD_DIR). Relance hud/installer-app.sh depuis son nouvel emplacement."'
    exit 1
fi
"$HUD_DIR/lancer-jarvis.command" >"\$LOG" 2>&1 || osascript -e 'display alert "Jarvis n a pas pu démarrer" message "Détails dans ~/.openjarvis/hud-app.log"'
SCRIPT
chmod +x "$APP_DIR/Contents/MacOS/Jarvis"

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Jarvis</string>
  <key>CFBundleDisplayName</key><string>Jarvis</string>
  <key>CFBundleIdentifier</key><string>$LABEL</string>
  <key>CFBundleExecutable</key><string>Jarvis</string>
  <key>CFBundleIconFile</key><string>Jarvis</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

echo "==> Service Jarvis (serveur local géré par macOS)"
SERVICE="$LABEL.server"
SERVICE_PLIST="$HOME/Library/LaunchAgents/$SERVICE.plist"
OJ_HOME="${OPENJARVIS_HOME:-$HOME/.openjarvis}"
PY="$OJ_HOME/.venv/bin/python"
[ -x "$PY" ] || PY="$(command -v python3)"
mkdir -p "$HOME/Library/LaunchAgents" "$OJ_HOME"
launchctl unload "$SERVICE_PLIST" 2>/dev/null || true
pkill -f "hud/server.py" 2>/dev/null || true
cat > "$SERVICE_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$SERVICE</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$HUD_DIR/server.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$OJ_HOME/hud.log</string>
  <key>StandardErrorPath</key><string>$OJ_HOME/hud.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>SHELL</key><string>/bin/zsh</string>
    <key>OPENJARVIS_HOME</key><string>$OJ_HOME</string>
  </dict>
</dict>
</plist>
PLIST
launchctl load "$SERVICE_PLIST"

echo "==> Icône"
TMP="$(mktemp -d)"
ICONSET="$TMP/Jarvis.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
    sips -z $size $size "$HUD_DIR/icon.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    double=$((size * 2))
    sips -z $double $double "$HUD_DIR/icon.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/Jarvis.icns"
rm -rf "$TMP"
touch "$APP_DIR"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR" >/dev/null 2>&1 || true

if defaults read com.apple.dock persistent-apps 2>/dev/null | grep -q "Jarvis.app"; then
    echo "    Jarvis est déjà dans le Dock."
elif ask "Ajouter Jarvis au Dock ?"; then
    defaults write com.apple.dock persistent-apps -array-add \
        "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://$APP_DIR/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
    killall Dock
    echo "    Ajouté au Dock."
fi

AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
if ask "Ouvrir Jarvis automatiquement au démarrage du Mac ?"; then
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$APP_DIR/Contents/MacOS/Jarvis</string></array>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
</dict>
</plist>
PLIST
    launchctl unload "$AGENT" 2>/dev/null || true
    launchctl load "$AGENT"
    echo "    Jarvis s'ouvrira à chaque démarrage (pour annuler : rm \"$AGENT\")."
fi

# ---------- « Hey Jarvis » ----------
if ask "Activer « Hey Jarvis » (Jarvis s'ouvre et t'écoute quand tu dis « Hey Jarvis ») ?"; then
    echo "==> Installation de la détection « Hey Jarvis » (locale, ~150 Mo)"
    if command -v uv >/dev/null 2>&1 && [ -x "$OJ_HOME/.venv/bin/python" ]; then
        uv pip install --python "$OJ_HOME/.venv/bin/python" -q openwakeword sounddevice numpy
    else
        "$PY" -m pip install -q --user openwakeword sounddevice numpy
    fi
    "$PY" -c "import openwakeword.utils as u; u.download_models(['hey_jarvis'])"

    ECOUTE_APP="$HOME/Applications/Jarvis Ecoute.app"
    rm -rf "$ECOUTE_APP"
    mkdir -p "$ECOUTE_APP/Contents/MacOS" "$ECOUTE_APP/Contents/Resources"
    cp "$APP_DIR/Contents/Resources/Jarvis.icns" "$ECOUTE_APP/Contents/Resources/"
    cat > "$ECOUTE_APP/Contents/MacOS/JarvisEcoute" <<SCRIPT
#!/bin/bash
# Le script reste parent du programme d'écoute : macOS attribue ainsi l'accès au micro à « Jarvis Ecoute ».
export PATH="\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export OPENJARVIS_HOME="$OJ_HOME"
pkill -f "hud/ecoute.py" 2>/dev/null
"$PY" "$HUD_DIR/ecoute.py" >>"$OJ_HOME/ecoute.log" 2>&1
SCRIPT
    chmod +x "$ECOUTE_APP/Contents/MacOS/JarvisEcoute"
    cat > "$ECOUTE_APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Jarvis Ecoute</string>
  <key>CFBundleIdentifier</key><string>$LABEL.ecoute</string>
  <key>CFBundleExecutable</key><string>JarvisEcoute</string>
  <key>CFBundleIconFile</key><string>Jarvis</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Jarvis écoute « Hey Jarvis » pour se réveiller. Le son est analysé sur ce Mac et n'est jamais enregistré ni envoyé.</string>
</dict>
</plist>
PLIST
    codesign --force --deep -s - "$ECOUTE_APP" >/dev/null 2>&1 || true

    ECOUTE_AGENT="$HOME/Library/LaunchAgents/$LABEL.ecoute.plist"
    cat > "$ECOUTE_AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL.ecoute</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>-a</string><string>$ECOUTE_APP</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
    launchctl unload "$ECOUTE_AGENT" 2>/dev/null || true
    launchctl load "$ECOUTE_AGENT"
    echo "    « Hey Jarvis » activé. macOS va demander l'accès au micro pour « Jarvis Ecoute » : accepte."
    echo "    (Pour le désactiver : launchctl unload \"$ECOUTE_AGENT\" ; pkill -f hud/ecoute.py)"
fi

echo
echo "C'est prêt. Ouvre Jarvis depuis le Launchpad, le Dock, ou Cmd+Espace puis « Jarvis »."
open "$APP_DIR"
