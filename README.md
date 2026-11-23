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

Interface façon film : orbe lumineux, carte animée, panneaux holographiques. Tu parles à Jarvis, il te répond
à voix haute, pilote l'écran et agit sur ton Mac. Il utilise le même modèle local qu'OpenJarvis.

### Installer l'application (une seule fois)

```bash
cd ~/jarvis-kit && git pull && ./hud/installer-app.sh
```

Ensuite, plus besoin du Terminal : ouvre **Jarvis** depuis le Launchpad, le Dock ou Spotlight (Cmd+Espace, « Jarvis »).
L'installeur propose aussi de l'ajouter au Dock et de l'ouvrir au démarrage du Mac.
Pour tout retirer : `./hud/installer-app.sh --desinstaller`.

### Le cerveau : Claude (recommandé) ou modèle local

Par défaut, Jarvis utilise **Claude via Claude Code**, avec ton abonnement Claude (Pro ou Max) : **aucune clé API**.
Il peut alors chercher sur le web, lire tes fichiers, enchaîner les actions et répondre à n'importe quelle question.
Installation, une seule fois, dans le Terminal :

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Puis tape `claude`, connecte-toi avec ton compte Claude dans le navigateur, et quitte avec `/exit`.

**Vitesse :** les demandes simples (météo, carte d'un lieu, minuteur, volume, ouvrir une app, heure, satellite, zoom,
accueil, état du Mac) sont traitées instantanément, sans passer par Claude. Pour le reste, le bouton **Rapide / Équilibré /
Puissant** choisit le modèle Claude (Haiku, Sonnet ou Opus) : « Équilibré » par défaut.

Le bouton **« Cerveau »** bascule entre Claude et le modèle local d'Ollama (gratuit, hors ligne, moins intelligent).
Avec Claude, les requêtes comptent dans les limites de ton abonnement.

**Sécurité :** Claude peut lire tes fichiers et chercher sur le web, mais ne peut **ni modifier ni supprimer** quoi que ce soit
directement. Toute commande sur l'ordinateur passe par la fenêtre orange et attend ton « oui ».

### Vision, gestes et interface 3D

- **Scène 3D** : orbe holographique animé par la voix de Jarvis, particules, halo lumineux, perspective qui suit ta tête.
- **Caméra** : dis « **ouvre la caméra** » ou « active la vision », et « **ferme la caméra** » pour l'arrêter.
  La vidéo passe en fond (miroir, filtre holographique) et Jarvis suit tes deux mains (MediaPipe, tout reste sur le Mac).
- **Gestes sur les panneaux** :
  - **pincer** un bouton pour cliquer, ou un panneau pour le saisir ;
  - **glisser** pour déplacer, **lâcher vite** pour éjecter ;
  - **deux mains** pour zoomer ;
  - **poing** tenu 0,9 s pour fermer ;
  - **pouce levé** pour valider ;
  - **main ouverte** pour couper la parole.
- **Visage** (caméra ouverte) : Jarvis te salue quand tu t'assois (briefing météo et notes le matin), n'écoute « Jarvis »
  que si tu regardes l'écran, et se met en veille après 2 minutes sans personne.
- **Voix en flux** : Jarvis commence à parler dès la première phrase prête, et se tait si tu lui coupes la parole.
- **Mémoire et notes** : « retiens que j'habite à Sète », « note : rappeler Paul » ; c'est gardé entre les sessions.
- **Réglages** : « ouvre les réglages » ou bouton Réglages. Gros boutons utilisables en pinçant : cerveau, vitesse,
  autonomie, voix, écoute, caméra, suivi du visage, menu des données, commandes des yeux, affichage, disposition, diagnostic.
- **Tout se déplace** : panneaux, widgets, minuteurs, horloge. Pince et glisse avec la main, ou glisse le titre à la souris.
  Les widgets et l'horloge restent là où tu les poses (« Réinitialiser » dans les réglages pour tout remettre).
- **Suivi du visage affiché** (caméra ouverte) : cadre, contours des yeux, iris, clignements, direction du regard.
- **Caméra ouverte** : Jarvis se range en bas à droite et le **menu des données** s'ouvre à gauche
  (météo, position GPS, radar pluie, heures du monde, système, notes, minuteur, calendrier).
  Pince une tuile, glisse-la, lâche : le module est posé là, et il y reste après redémarrage.
  Pour le retirer : le reposer sur le menu, poing tenu dessus, lancer vite, ou ✕.
  À la voix : « ouvre le menu », « ferme le menu », « place le module radar ».
- **Commandes des yeux** (réglables dans Réglages) :
  - **clin d'œil** = cliquer ce que vise ta main (sans main : ouvrir ou fermer le menu) ;
  - **deux clignements rapides** = Jarvis t'écoute ;
  - **yeux fermés 1 s** = Jarvis se tait.

  Un clignement naturel ne déclenche rien.
- **Diagnostic** : touche **D** (voyants MICRO, CAMÉRA, VISION, MAINS, IA).
- Clés optionnelles (ElevenLabs pour la voix, Picovoice pour le mot d'éveil) : fichier `~/.openjarvis/hud-secrets.json`
  avec `elevenlabs_api_key`, `elevenlabs_voice_id`, `picovoice_access_key`.
- **Version en ligne** (Vercel, API Anthropic) : voir [`hud/README-DEPLOIEMENT.md`](hud/README-DEPLOIEMENT.md).

### « Hey Jarvis »

L'installeur propose d'activer le réveil vocal : dis **« Hey Jarvis »** à tout moment, même Jarvis fermé.
La fenêtre s'ouvre (ou se réveille), un petit son retentit et Jarvis t'écoute.
La détection tourne en local (openWakeWord) : le son n'est ni enregistré ni envoyé, mais le point orange du micro
reste allumé dans la barre des menus. macOS demande l'accès au micro pour « Jarvis Ecoute » la première fois : accepte.
Si Jarvis se réveille trop ou pas assez, règle la sensibilité avec `JARVIS_WAKE_THRESHOLD` (0.5 par défaut).

### Jarvis sur l'iPhone (notifications et « Hey Jarvis » à distance)

Passe par **ntfy** (app gratuite, sans compte ni clé). Configuration :

```bash
~/jarvis-kit/hud/telephone.sh
```

Le script crée des identifiants secrets, envoie une notification de test et affiche le guide pas à pas
(abonnement dans l'app ntfy, raccourci iPhone « Jarvis », phrase « Hey Jarvis » dans Réglages > Accessibilité >
Raccourcis vocaux, iOS 18+). Ensuite :

- « Hey Jarvis » sur l'iPhone sans rien ajouter (ou « ouvre-toi ») → Jarvis s'ouvre sur le Mac et t'écoute ;
- « Hey Jarvis » puis une demande → Jarvis la fait sur le Mac et te répond en notification ;
- Jarvis peut te prévenir de lui-même : « préviens-moi sur mon téléphone quand c'est fini », « rappelle-moi à 18 h 30 d'appeler maman ».

Le Mac doit être allumé (pas forcément devant toi). Les messages passent par le serveur ntfy.sh, sans chiffrement de bout
en bout : n'y dicte pas de mots de passe. Les identifiants sont dans `~/.openjarvis/hud-telephone.json`
(et le guide dans `~/.openjarvis/hud-telephone-guide.txt`) : garde-les pour toi.

### Mode propriétaire et widgets

- **Propriétaire** (par défaut) : Jarvis agit seul, comme toi : créer des dossiers et des fichiers, ranger, piloter les apps
  (Notes, Rappels, Calendrier, Musique, Finder…), lancer tes Raccourcis, faire des captures d'écran.
  Il ne demande ton accord que pour les actions **sensibles** : supprimer, écraser un fichier, `sudo`, envoyer un message,
  modifier des réglages système, installer un logiciel. Ce filet de sécurité repère les cas courants, sans garantie absolue.
- **Prudent** : il demande avant chaque commande. Bouton « Propriétaire / Prudent ».
- **Widgets** : « ajoute un widget météo pour Sète », « une horloge de Tokyo », « un compte à rebours jusqu'à Noël »,
  « une note : appeler le client à 15 h », « l'état du Mac ». Ils restent sur l'écran d'accueil, même après redémarrage.
  Survole un widget et clique sur ✕ pour le retirer, ou demande-le à Jarvis.
  Ce sont des widgets de l'écran Jarvis : macOS ne permet pas de créer des widgets du Centre de notifications par script.

### Utiliser

| Action | Comment |
|---|---|
| Parler | Clique sur l'orbe ou appuie sur **Espace**, puis parle |
| Mains libres | Bouton « Mains libres », puis dis « **Jarvis**, … » quand tu veux |
| Écrire | Touche **/** puis Entrée |
| Voix | Bouton « Voix » pour choisir, « Son on/off » pour couper |
| Afficher / masquer la conversation écrite | Touche **T** (masquée par défaut : écran épuré) |

Les boutons et le statut se cachent après 4 secondes sans bouger la souris, et reviennent au moindre mouvement.

### Exemples de demandes

- « Affiche une carte de la France avec les grandes villes » → la France s'illumine, les villes apparaissent une à une
- « Montre-moi un tour de l'Italie : Rome, Florence, Venise, Milan » → villes numérotées et reliées
- « Trajet de Sète à Paris » → itinéraire réel tracé, distance et durée
- « Passe en vue satellite », « zoome », « montre le monde », « reviens à l'accueil »
- « Quelle est la météo ? », « quel temps fait-il à Sète ? » → la France s'affiche avec 20 villes (icônes animées,
  températures en couleur du froid au chaud), le radar de pluie animé des deux dernières heures par-dessus,
  et le détail de la ville demandée avec ses prévisions sur 3 jours
- « Mets un minuteur de 10 minutes pour les pâtes » → compte à rebours à l'écran, annonce à la fin
- « Comment va mon Mac ? » → jauges batterie, disque, mémoire, processeur
- « Donne-moi 5 idées de sorties ce week-end » → panneau avec la liste
- « Fais-moi un schéma de comment fonctionne un site e-commerce » → les blocs apparaissent un à un, les flèches se tracent,
  le texte s'écrit, puis des particules lumineuses circulent dans le schéma
- « Une carte mentale pour lancer mon agence », « la chronologie de l'iPhone », « le cycle de l'eau »,
  « un graphique de mes ventes de janvier à juin » (barres, courbe ou camembert, avec les valeurs qui défilent)
- « Ouvre Spotify », « mets le volume à 30 », « cherche des recettes de risotto »
- « Combien de place prend mon dossier Téléchargements ? » → commande Terminal, **exécutée seulement après ton « oui »**

**Bon à savoir :**

- En cerveau local, le modèle `qwen3.5:9b` comprend bien mieux les demandes d'action que `qwen3.5:4b`.
- Cartes, lieux, météo et itinéraires utilisent des services gratuits sans clé (Esri, OpenStreetMap, Open-Meteo, OSRM) :
  il faut internet pour eux, mais le modèle reste local.
- Chrome demandera l'accès au micro la première fois : accepte.
- La reconnaissance vocale de Chrome envoie l'audio aux serveurs de Google. Le modèle, lui, reste local.
- **Changer de voix** : bouton « Voix » en bas de l'écran → clique sur une voix pour l'écouter et la garder.
  - Voix macOS « Premium » (gratuites, naturelles) : Réglages Système → Accessibilité → Contenu énoncé →
    Voix du système → Gérer les voix → Français → télécharge « Audrey (Premium) » ou « Thomas (Premium) ».
  - Voix neuronale locale **Siwis** (optionnelle, ~2 Go à télécharger) :
    `cd ~/.openjarvis/src && uv pip install --python ~/.openjarvis/.venv/bin/python -e '.[voice]'`
    puis relance le HUD (`pkill -f hud/server.py` puis le lanceur).

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
