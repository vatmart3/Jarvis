#!/usr/bin/env bash
# Installe OpenJarvis (https://github.com/open-jarvis/OpenJarvis) puis applique
# la configuration de ce dépôt. macOS, Linux et WSL2.
#
#   ./install.sh                 # installation complète
#   ./install.sh --no-analytics  # options transmises à l'installeur officiel
#
# À lancer en utilisateur normal (pas avec sudo) : l'installeur officiel refuse root.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="qwen3.5:4b"

if [[ -n "${OPENJARVIS_HOME:-}" ]]; then
    OJ_HOME="$OPENJARVIS_HOME"
elif [[ -n "${XDG_DATA_HOME:-}" ]]; then
    OJ_HOME="$XDG_DATA_HOME/openjarvis"
else
    OJ_HOME="$HOME/.openjarvis"
fi

echo "==> 1/3 Installation d'OpenJarvis (uv, Python, Ollama, modèle de départ)…"
curl -fsSL https://open-jarvis.github.io/OpenJarvis/install.sh | bash -s -- "$@"

echo "==> 2/3 Application de la configuration (config/config.toml)…"
mkdir -p "$OJ_HOME"
if [[ -f "$OJ_HOME/config.toml" ]]; then
    backup="$OJ_HOME/config.toml.bak.$(date +%Y%m%d-%H%M%S)"
    cp "$OJ_HOME/config.toml" "$backup"
    echo "    Ancienne configuration sauvegardée : $backup"
fi
cp "$REPO_DIR/config/config.toml" "$OJ_HOME/config.toml"

echo "==> 3/3 Téléchargement du modèle $MODEL…"
if command -v ollama >/dev/null 2>&1; then
    ollama pull "$MODEL" || echo "    Échec du téléchargement ; relance plus tard : ollama pull $MODEL"
else
    echo "    Ollama introuvable dans le PATH ; ouvre un nouveau terminal puis : ollama pull $MODEL"
fi

cat <<MSG

OpenJarvis est installé. Ouvre un nouveau terminal (ou : source ~/.bashrc), puis :

    jarvis doctor        # vérifier l'installation
    jarvis               # discuter avec Jarvis
MSG
