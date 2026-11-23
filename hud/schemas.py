"""Outil « afficher_schema » : schémas et graphiques construits en animation sur l'écran Jarvis.

Le modèle décrit le contenu (nœuds, liens, données) ; l'interface (schema.js)
calcule la mise en page et anime la construction élément par élément.
"""

from __future__ import annotations

TYPES = ("flux", "mental", "chronologie", "cycle", "graphique")
GENRES = ("barres", "courbe", "camembert")
FORMES = ("rect", "pilule", "losange")
MAX_NOEUDS, MAX_LIENS, MAX_DONNEES = 30, 60, 16


def _txt(v, n: int) -> str:
    return " ".join(str(v or "").split())[:n]


def t_afficher_schema(args: dict):
    kind = str(args.get("type") or "flux").lower()
    if kind not in TYPES:
        kind = "flux"
    titre = _txt(args.get("titre"), 80)
    action = {"type": "schema", "genre_schema": kind, "titre": titre}

    if kind == "graphique":
        genre = str(args.get("genre") or "barres").lower()
        donnees = []
        for d in (args.get("donnees") or [])[:MAX_DONNEES]:
            if not isinstance(d, dict):
                continue
            try:
                valeur = float(d.get("valeur"))
            except (TypeError, ValueError):
                continue
            donnees.append({"label": _txt(d.get("label"), 28), "valeur": valeur})
        if not donnees:
            return "Aucune donnée chiffrée valide pour le graphique.", []
        action.update(genre=genre if genre in GENRES else "barres", donnees=donnees, unite=_txt(args.get("unite"), 12))
        return f"Graphique « {titre} » affiché ({len(donnees)} valeurs), construit en animation.", [action]

    noeuds, ids = [], set()
    for i, n in enumerate((args.get("noeuds") or [])[:MAX_NOEUDS]):
        if isinstance(n, str):
            n = {"texte": n}
        if not isinstance(n, dict):
            continue
        nid = _txt(n.get("id") or n.get("texte") or i, 40) or str(i)
        if nid in ids:
            nid = f"{nid}_{i}"
        ids.add(nid)
        forme = str(n.get("forme") or "rect").lower()
        try:
            groupe = int(n.get("groupe") or 0) % 4
        except (TypeError, ValueError):
            groupe = 0
        noeuds.append({"id": nid, "texte": _txt(n.get("texte") or nid, 60), "detail": _txt(n.get("detail"), 90),
                       "date": _txt(n.get("date"), 24), "forme": forme if forme in FORMES else "rect", "groupe": groupe})
    if not noeuds:
        return "Aucun élément à afficher dans le schéma.", []

    liens = []
    by_text = {n["texte"].lower(): n["id"] for n in noeuds}
    for l in (args.get("liens") or [])[:MAX_LIENS]:
        if not isinstance(l, dict):
            continue
        de, vers = _txt(l.get("de"), 60), _txt(l.get("vers"), 60)
        de, vers = (de if de in ids else by_text.get(de.lower())), (vers if vers in ids else by_text.get(vers.lower()))
        if de and vers and de != vers:
            liens.append({"de": de, "vers": vers, "texte": _txt(l.get("texte"), 30)})
    if kind == "mental" and not liens and len(noeuds) > 1:  # par défaut : tout part du premier élément
        liens = [{"de": noeuds[0]["id"], "vers": n["id"], "texte": ""} for n in noeuds[1:]]
    if kind == "flux" and not liens and len(noeuds) > 1:  # par défaut : enchaînement dans l'ordre
        liens = [{"de": a["id"], "vers": b["id"], "texte": ""} for a, b in zip(noeuds, noeuds[1:])]

    action.update(noeuds=noeuds, liens=liens)
    return f"Schéma « {titre} » ({kind}) affiché : {len(noeuds)} éléments et {len(liens)} liens, construits en animation.", [action]


TOOLS = [{
    "type": "function",
    "function": {
        "name": "afficher_schema",
        "description": (
            "Affiche un schéma qui se construit en animation à l'écran. type : "
            "flux (processus, organigramme, architecture, arbre de décision : noeuds + liens ; forme losange pour une question, "
            "pilule pour début/fin), mental (carte mentale : premier noeud = sujet central, liens parent→enfant), "
            "chronologie (noeuds dans l'ordre avec 'date'), cycle (noeuds dans l'ordre, bouclés), "
            "graphique (genre barres/courbe/camembert avec donnees [{label, valeur}] et unite). "
            "Textes courts (2 à 6 mots), 'detail' pour une précision ; 'groupe' 0-3 pour colorer des familles."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "titre": {"type": "string"},
                "type": {"type": "string", "enum": list(TYPES)},
                "noeuds": {"type": "array", "items": {"type": "object", "properties": {
                    "id": {"type": "string"}, "texte": {"type": "string"}, "detail": {"type": "string"},
                    "date": {"type": "string"}, "forme": {"type": "string", "enum": list(FORMES)},
                    "groupe": {"type": "integer"}}, "required": ["texte"]}},
                "liens": {"type": "array", "items": {"type": "object", "properties": {
                    "de": {"type": "string"}, "vers": {"type": "string"}, "texte": {"type": "string"}},
                    "required": ["de", "vers"]}},
                "genre": {"type": "string", "enum": list(GENRES)},
                "donnees": {"type": "array", "items": {"type": "object", "properties": {
                    "label": {"type": "string"}, "valeur": {"type": "number"}}, "required": ["label", "valeur"]}},
                "unite": {"type": "string"},
            },
            "required": ["titre", "type"],
        },
    },
}]

HANDLERS = {"afficher_schema": t_afficher_schema}
