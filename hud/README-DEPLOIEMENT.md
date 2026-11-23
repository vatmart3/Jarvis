# Jarvis en ligne — déploiement Vercel

Le dossier `hud/` se déploie tel quel sur Vercel : l'interface (`index.html`, `js/`, `vendor/`, `schema.js`) est servie
en statique, et trois fonctions serverless font le lien avec les services payants **sans jamais exposer de clé au navigateur**.

| Fichier | Rôle |
|---|---|
| `api/chat.js` | Proxy vers l'API Anthropic (Claude), en streaming. Les outils (météo, minuteurs, notes, carte, schémas…) s'exécutent dans le navigateur ; la recherche web tourne chez Anthropic. |
| `api/voix.js` | Proxy ElevenLabs (voix de synthèse en flux, faible latence). Optionnel. |
| `api/config.js` | Indique au navigateur ce qui est disponible (jamais de clé secrète). |
| `vercel.json` | Durée maximale des fonctions, en-têtes (autorisation caméra et micro). |

## 1. Déployer

1. Crée un compte sur [vercel.com](https://vercel.com) et importe ton dépôt GitHub.
2. Dans **Settings → General → Root Directory**, choisis `hud`.
3. Dans **Settings → Environment Variables**, ajoute :

| Variable | Obligatoire | Valeur |
|---|---|---|
| `ANTHROPIC_API_KEY` | oui | Clé créée sur [console.anthropic.com](https://console.anthropic.com) (facturée à l'usage) |
| `JARVIS_ACCESS_CODE` | **fortement conseillé** | Un code secret : sans lui, toute personne connaissant l'adresse peut utiliser ta clé |
| `ANTHROPIC_MODEL` | non | Par défaut `claude-opus-5-5`. Pour un premier mot plus rapide : `claude-haiku-5-5` ou `claude-sonnet-5-5` |
| `ANTHROPIC_EFFORT` | non | `low` par défaut (réponses rapides). `medium` ou `high` pour plus de réflexion |
| `ELEVENLABS_API_KEY` | non | Voix ElevenLabs (sinon voix du navigateur) |
| `ELEVENLABS_VOICE_ID` | non | Par défaut « George » (voix britannique qui parle français) |
| `PICOVOICE_ACCESS_KEY` | non | Mot d'éveil « Jarvis » détecté localement par Porcupine (sinon reconnaissance continue) |

4. Redéploie. Ouvre l'adresse `https://…vercel.app` dans **Chrome**, en onglet direct (pas dans un cadre).
   Si tu as défini `JARVIS_ACCESS_CODE`, Jarvis le demande une fois.

## 2. Utiliser

- Dis « **Jarvis**, … » : il répond en streaming (le premier mot part dès la première phrase prête).
- Coupe-le en parlant : il se tait (barge-in).
- « **Ouvre la caméra** » / « active la vision » : vidéo holographique en fond, mains suivies.
  « **Ferme la caméra** » pour arrêter.
- Gestes :
  - **pincer** un bouton pour cliquer, ou un panneau pour le saisir ;
  - **glisser** pour déplacer, **lâcher vite** pour éjecter ;
  - **deux mains** qui pincent puis s'écartent pour zoomer ;
  - **poing** tenu 0,9 s pour fermer ;
  - **pouce levé** pour valider ;
  - **main ouverte** pour couper la parole.
- Touche **D** : diagnostic (MICRO, CAMÉRA, VISION, MAINS, IA).

## 3. Ouvrir des applications depuis la version en ligne (pont local)

Le navigateur ne peut pas lancer d'application tout seul. Sur ton ordinateur (Node.js 20+) :

```bash
node hud/pont-local/pont.mjs
```

Le pont affiche un code à 6 chiffres. Dans Jarvis, dis ou tape « **connecte le pont** » et saisis-le.
Il écoute uniquement en local (`ws://127.0.0.1:8765`) et n'accepte que les pages `localhost` et `*.vercel.app`
(variable `PONT_ORIGINES` pour un autre domaine).

## Coûts et confidentialité

- Chaque question consomme des crédits de l'API Anthropic (et d'ElevenLabs si activé).
- La vision (caméra, mains, visage) tourne **entièrement dans le navigateur** (MediaPipe) : aucune image n'est envoyée.
- La mémoire et les notes sont gardées dans le navigateur (localStorage). Seul un résumé de la mémoire accompagne chaque question.
