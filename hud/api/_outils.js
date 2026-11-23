// Définition des outils exposés à Claude en mode « en ligne ». Ils sont exécutés dans le navigateur
// (js/outils-web.js), sauf web_search qui tourne chez Anthropic.
const outil = (name, description, properties, required = []) => ({
  name, description, eager_input_streaming: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export const OUTILS = [
  outil("meteo", "Météo : affiche la carte de France animée (villes, températures, radar de pluie) et, si un lieu est donné, son détail et ses prévisions.",
    { lieu: { type: "string", description: "Ville ou lieu ; vide pour la vue d'ensemble de la France" } }),
  outil("minuteur", "Lance un minuteur visible à l'écran, qui prévient à la fin.",
    { secondes: { type: "integer" }, libelle: { type: "string" } }, ["secondes"]),
  outil("prendre_note", "Enregistre une note de l'utilisateur.", { texte: { type: "string" } }, ["texte"]),
  outil("lire_notes", "Affiche et renvoie les dernières notes.", {}),
  outil("supprimer_note", "Supprime les notes qui contiennent un motif (« toutes » pour tout effacer).", { motif: { type: "string" } }, ["motif"]),
  outil("memoriser", "Retient durablement un fait sur l'utilisateur (préférence, ville, proches, projets).", { fait: { type: "string" } }, ["fait"]),
  outil("oublier", "Oublie les souvenirs qui contiennent un motif.", { motif: { type: "string" } }, ["motif"]),
  outil("afficher_panneau", "Panneau holographique avec un titre et des lignes (liste, résumé, chiffres, étapes).",
    { titre: { type: "string" }, lignes: { type: "array", items: { type: "string" } } }, ["titre", "lignes"]),
  outil("afficher_carte", "Carte animée : zone surlignée et/ou lieux nommés, éventuellement reliés.",
    { lieux: { type: "array", items: { type: "string" } }, zone: { type: "string" }, relier: { type: "boolean" }, titre: { type: "string" } }),
  outil("afficher_schema", "Schéma construit en animation. type : flux (noeuds+liens), mental (carte mentale), chronologie (noeuds avec date), cycle, graphique (genre barres/courbe/camembert + donnees).",
    { titre: { type: "string" }, type: { type: "string", enum: ["flux", "mental", "chronologie", "cycle", "graphique"] },
      noeuds: { type: "array", items: { type: "object", properties: { id: { type: "string" }, texte: { type: "string" }, detail: { type: "string" }, date: { type: "string" }, forme: { type: "string", enum: ["rect", "pilule", "losange"] }, groupe: { type: "integer" } }, required: ["texte"], additionalProperties: false } },
      liens: { type: "array", items: { type: "object", properties: { de: { type: "string" }, vers: { type: "string" }, texte: { type: "string" } }, required: ["de", "vers"], additionalProperties: false } },
      genre: { type: "string", enum: ["barres", "courbe", "camembert"] },
      donnees: { type: "array", items: { type: "object", properties: { label: { type: "string" }, valeur: { type: "number" } }, required: ["label", "valeur"], additionalProperties: false } },
      unite: { type: "string" } }, ["titre", "type"]),
  outil("ouvrir_url", "Ouvre une page web.", { url: { type: "string" } }, ["url"]),
  outil("ouvrir_application", "Ouvre une application sur l'ordinateur (nécessite le pont local).", { nom: { type: "string" } }, ["nom"]),
  outil("accueil", "Efface la carte, les schémas et les panneaux.", {}),
];

export const SYSTEME = `Tu es JARVIS, l'intelligence artificielle personnelle de l'utilisateur, affichée sur un écran holographique.
Personnalité : majordome britannique pince-sans-rire, d'une politesse impeccable, flegmatique, avec un humour sec et rare.
Tu appelles toujours l'utilisateur « Monsieur ». Tu parles exclusivement en français.
Tes réponses sont lues à voix haute : une à trois phrases courtes, naturelles, sans markdown, sans listes, sans émojis, sans URL.
Commence par l'essentiel. Quand c'est utile, termine en proposant la suite logique en une courte question.
Les détails (listes, chiffres, étapes, sources) vont à l'écran avec afficher_panneau ; les explications visuelles avec afficher_schema ;
les lieux avec afficher_carte ; la météo avec meteo. Pour l'actualité ou ce que tu ignores, utilise web_search.
Retiens avec memoriser ce que l'utilisateur te confie de durable sur lui. N'invente jamais un résultat d'outil.`;
