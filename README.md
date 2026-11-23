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

## Jarvis HUD : interface vocale plein écran

Interface façon film : orbe lumineux, carte sombre, horloge. Tu parles à Jarvis et il agit sur ton Mac.
Elle utilise le même modèle local qu'OpenJarvis (lu dans `~/.openjarvis/config.toml`).

**Lancer :** double-clique sur `hud/lancer-jarvis.command` dans le Finder, ou :

```bash
~/jarvis-kit/hud/lancer-jarvis.command
```

| Action | Comment |
|---|---|
| Parler | Clique sur l'orbe ou appuie sur **Espace**, puis parle |
| Mains libres | Bouton « Mains libres », puis dis « **Jarvis**, … » quand tu veux |
| Écrire | Touche **/** puis Entrée |
| Couper sa voix | Bouton « Voix on/off », ou Échap pendant qu'il parle |
| Arrêter | `pkill -f hud/server.py` |

**Ce que Jarvis peut faire sur ton ordinateur :**

- sans demander : ouvrir une application, une page web ou une recherche, régler le volume, afficher un lieu sur la carte ;
- **avec ta validation** (fenêtre orange, réponds « oui » ou « non ») : exécuter une commande dans le Terminal
  (trouver un fichier, ranger un dossier, connaître l'espace disque…).

**Bon à savoir :**

- Le modèle `qwen3.5:9b` comprend bien mieux les demandes d'action que `qwen3.5:4b`.
- Chrome demandera l'accès au micro la première fois : accepte.
- La reconnaissance vocale de Chrome envoie l'audio aux serveurs de Google. Le modèle, lui, reste local.
- Pour une plus belle voix : Réglages Système → Accessibilité → Contenu énoncé → Voix du système →
  Gérer les voix → Français → télécharge « Thomas (Premium) » ou « Audrey (Premium) ».
- La carte et la recherche de lieux utilisent internet (OpenStreetMap / CARTO).

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
