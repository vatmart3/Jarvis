# Jarvis — mon installation d'OpenJarvis

Ce dépôt installe et configure [OpenJarvis](https://github.com/open-jarvis/OpenJarvis),
un assistant IA personnel qui tourne **en local sur ton ordinateur** (via Ollama).
Tes conversations restent sur ta machine.

## Installation

### macOS, Linux ou WSL2

```bash
git clone https://github.com/vatmart3/jarvis.git
cd jarvis
./install.sh
```

### Windows (PowerShell)

```powershell
git clone https://github.com/vatmart3/jarvis.git
cd jarvis
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Le script :

1. lance l'installeur officiel d'OpenJarvis (uv, Python, Ollama, modèle de départ — environ 3 minutes) ;
2. copie `config/config.toml` dans `~/.openjarvis/config.toml` (l'ancienne config est sauvegardée en `.bak`) ;
3. télécharge le modèle `qwen3.5:4b` (~3 Go).

L'installeur pose une question sur le partage de statistiques anonymes : `Entrée`/`Y` pour accepter,
`N` pour refuser. Pour refuser sans question : `./install.sh --no-analytics`.

## Utilisation

Ouvre un **nouveau terminal** après l'installation, puis :

| Commande | Effet |
|---|---|
| `jarvis doctor` | Vérifie que tout est en place |
| `jarvis` | Discussion dans le terminal |
| `jarvis ask "Résume-moi la relativité"` | Une question, une réponse |
| `jarvis gui` | Interface graphique dans le navigateur (Node.js 22+) |
| `jarvis serve` | API compatible OpenAI sur http://127.0.0.1:8000 |
| `jarvis self-update` | Mettre OpenJarvis à jour |
| `jarvis-uninstall` | Tout désinstaller |

## Personnaliser

Modifie `config/config.toml` puis relance `./install.sh` (ou édite directement `~/.openjarvis/config.toml`).

- **Modèle** : `qwen3.5:2b` pour une petite machine, `qwen3.5:9b` pour plus de qualité (16 Go de RAM conseillés).
  Pense à le télécharger : `ollama pull qwen3.5:9b`.
- **Agent avec outils** : `default_agent = "orchestrator"`.
- **Presets prêts à l'emploi** : `jarvis init --preset <nom> --force`, avec
  `morning-digest-mac`, `morning-digest-linux`, `deep-research`, `code-assistant`, `scheduled-monitor`, `chat-simple`.
- **Modèle dans le cloud** (si ta machine est trop juste) : définis `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
  ou `OPENROUTER_API_KEY` dans ton environnement avant `jarvis init`.

## Dépannage

- `command not found: jarvis` : ouvre un nouveau terminal ou lance `source ~/.bashrc` (ou `~/.zshrc`).
- `jarvis doctor` signale Ollama injoignable : lance `ollama serve`, puis `ollama pull qwen3.5:4b`.
- Documentation complète : https://open-jarvis.github.io/OpenJarvis/
