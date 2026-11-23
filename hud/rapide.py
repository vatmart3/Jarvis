"""Chemin rapide : les demandes simples sont traitées tout de suite, sans passer par le modèle.

Météo, carte d'un lieu, minuteur, volume, ouvrir une app, heure, style de carte, zoom,
écran d'accueil, état du Mac. Tout ce qui n'est pas reconnu avec certitude part au
cerveau (Claude ou modèle local) : l'aiguillage est volontairement prudent.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime

import outils

# Branchés par server.py au démarrage (évite un import circulaire)
ouvrir_application = lambda nom: "Indisponible."  # noqa: E731
regler_volume = lambda niveau: "Indisponible."  # noqa: E731

APPS = {
    "calendrier": "Calendar", "agenda": "Calendar", "musique": "Music", "apple music": "Music", "reglages": "System Settings",
    "reglages systeme": "System Settings", "plans": "Maps", "rappels": "Reminders", "photos": "Photos", "notes": "Notes",
    "mail": "Mail", "messages": "Messages", "finder": "Finder", "safari": "Safari", "terminal": "Terminal",
    "app store": "App Store", "facetime": "FaceTime", "chrome": "Google Chrome", "google chrome": "Google Chrome",
    "spotify": "Spotify", "whatsapp": "WhatsApp", "notion": "Notion", "excel": "Microsoft Excel", "word": "Microsoft Word",
    "figma": "Figma", "slack": "Slack", "discord": "Discord", "vscode": "Visual Studio Code", "visual studio code": "Visual Studio Code",
    "calculatrice": "Calculator", "contacts": "Contacts", "horloge": "Clock", "meteo": "Weather", "podcasts": "Podcasts",
    "tv": "TV", "pages": "Pages", "numbers": "Numbers", "keynote": "Keynote", "preview": "Preview", "apercu": "Preview",
}
JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
# Mots qui signalent une demande plus riche : on laisse le cerveau s'en occuper.
COMPLEXE = re.compile(r"\b(et|puis|ensuite|pourquoi|comment|schema|graphique|compare|explique|resume|liste|cherche|trouve|"
                      r"envoie|ecris|cree|range|supprime|deplace|rappelle|previens|si |quand|avec|sans)\b")


def _norm(t: str) -> str:
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"^(hey |ok |dis )?jarvis[ ,]*", "", t.strip())
    t = re.sub(r"\b(s'il te plait|stp|svp|merci)\b", "", t)
    return re.sub(r"[?!.,;]+", " ", t).strip()


def _clean_place(p: str) -> str:
    p = re.sub(r"\b(aujourd'?hui|demain|ce soir|ce matin|maintenant|en ce moment|actuellement|cette semaine|ce week-?end)\b", "", p)
    p = re.sub(r"^(la |le |les |l'|a |au |aux |en |sur |pour |de |du |des |d')+", "", p.strip())
    return p.strip(" -'")


def _meteo(t: str, original: str):
    if not re.search(r"\b(meteo|quel temps|temps qu.il fait|temps fait.il|il fait (beau|chaud|froid)|il pleut|pleuvoir|pluie|"
                     r"temperature|fait.il (beau|chaud|froid))\b", t):
        return None
    m = re.search(r"\b(?:a|au|aux|en|sur|pour|vers|dans)\s+([a-z' -]{2,40})$", t)
    lieu = _clean_place(m.group(1)) if m else ""
    if lieu in ("", "france", "la france", "chez moi", "ici", "dehors"):
        lieu = ""
    # Garder l'orthographe d'origine (accents) pour l'affichage
    if lieu:
        m2 = re.search(re.escape(lieu).replace(r"\ ", r"[\s-]"), _sans_accents_mais_casse(original), re.IGNORECASE)
        lieu_aff = original[m2.start():m2.end()] if m2 else lieu.title()
    else:
        lieu_aff = ""
    txt, actions = outils.t_meteo({"lieu": lieu_aff})
    if not actions:
        return txt, []
    info = next((a["meteo"] for a in actions if a["type"] == "weather"), None)
    carte = next((a for a in actions if a["type"] == "meteo_carte"), None)
    if info:
        demain = info["jours"][1] if len(info["jours"]) > 1 else None
        rep = f"À {lieu_aff}, il fait {info['temp']} degrés, {info['etat']}"
        rep += f", ressenti {info['ressenti']}." if abs(info["ressenti"] - info["temp"]) >= 2 else "."
        if demain:
            rep += f" Demain, {demain['etat']}, entre {demain['min']} et {demain['max']} degrés."
    elif carte:
        v = carte["villes"]
        chaud, froid = max(v, key=lambda x: x["temp"]), min(v, key=lambda x: x["temp"])
        pluie = [x["nom"] for x in v if (x["pluie"] or 0) > 0 or x["code"] >= 51]
        rep = (f"Sur la France, de {froid['temp']} degrés à {froid['nom']} jusqu'à {chaud['temp']} à {chaud['nom']}. "
               + (f"Il pleut notamment à {', '.join(pluie[:3])}." if pluie else "Pas de pluie sur les grandes villes."))
    else:
        rep = txt
    return rep, actions


def _sans_accents_mais_casse(t: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn")


def route(texte: str):
    """Renvoie (réponse à dire, actions) si la demande est simple, sinon None."""
    t = _norm(texte)
    if not t or len(t) > 90:
        return None
    try:
        r = _meteo(t, texte)
        if r:
            return r
    except Exception:  # noqa: BLE001 - en cas de doute, le cerveau prend le relais
        return None

    if re.fullmatch(r"(quelle heure (est.il|il est)|il est quelle heure|l.heure)", t):
        n = datetime.now()
        return f"Il est {n.hour} heures {n.minute:02d}.", []
    if re.fullmatch(r"(on est|nous sommes) quel jour|quel jour (on est|sommes.nous|est.on)|quelle (est la )?date.*", t):
        n = datetime.now()
        return f"Nous sommes le {JOURS[n.weekday()]} {n.day} {MOIS[n.month - 1]} {n.year}.", []

    m = re.fullmatch(r"(?:mets? (?:un |le )?)?(?:minuteur|timer|chrono|compte a rebours)(?: de| pour| a)? (\d+) ?(secondes?|s|sec|minutes?|min|mn|heures?|h)(?: (?:pour|pour les|pour le|pour la) (.+))?", t) \
        or re.fullmatch(r"(?:mets? )?(\d+) ?(secondes?|s|sec|minutes?|min|mn|heures?|h) (?:de )?(?:minuteur|timer)(?: (?:pour|pour les|pour le|pour la) (.+))?", t)
    if m:
        n, unite, quoi = int(m.group(1)), m.group(2), (m.group(3) or "").strip()
        sec = n * (3600 if unite.startswith("h") else 60 if unite.startswith("m") else 1)
        txt, act = outils.t_minuteur({"secondes": sec, "libelle": quoi.capitalize() if quoi else "Minuteur"})
        return f"Minuteur lancé pour {n} {unite if len(unite) > 2 else ('heures' if unite == 'h' else 'minutes' if unite.startswith('m') else 'secondes')}.", act

    m = re.fullmatch(r"(?:mets |regle |monte |baisse )?(?:le )?(?:son|volume) (?:a |au )?(\d{1,3}) ?(?:%|pour ?cent)?", t)
    if m:
        res = regler_volume(int(m.group(1)))
        return ("C'est fait." if "réglé" in res else res), [{"type": "tool", "name": "regler_volume", "result": res}]
    if re.fullmatch(r"(coupe le son|silence|mute|mets en sourdine)", t):
        res = regler_volume(0)
        return "Son coupé.", [{"type": "tool", "name": "regler_volume", "result": res}]

    m = re.fullmatch(r"(?:ouvre|lance|demarre)(?: moi)? (?:l'application |l'appli |l'app |application )?([a-z0-9 .'-]{2,30})", t)
    nom = re.sub(r"^(le |la |les |l')", "", m.group(1).strip()) if m else ""
    premier = nom.split(" ")[0] if nom else ""
    if m and nom not in ("toi", "jarvis") and premier not in ("carte", "fichier", "dossier", "document", "page", "site", "lien",
                                                             "photo", "photos", "image", "video", "mail", "un", "une", "mes", "mon", "ma") \
            and not COMPLEXE.search(nom):
        app = APPS.get(nom)
        if app is None and len(nom.split()) <= 2:
            app = nom.title()
        if app:
            res = ouvrir_application(app)
            ok = "ouverte" in res
            return (f"J'ouvre {nom.title()}." if ok else res), [{"type": "tool", "name": "ouvrir_application", "result": res}]

    if re.fullmatch(r"(accueil|ecran d.accueil|retour (a l.accueil)?|efface (tout|l.ecran)|nettoie l.ecran|ferme (la carte|tout|le schema))", t):
        return "Voilà.", [{"type": "home"}]
    m = re.fullmatch(r"(?:passe en |mets la |mode |vue |affichage )?(?:vue |mode )?(satellite|plan|sombre)", t)
    if m:
        return "", outils.t_style_carte({"style": m.group(1)})[1]
    if re.fullmatch(r"(zoome?|zoom avant|rapproche.toi|plus pres)", t):
        return "", [{"type": "zoom", "action": "avant"}]
    if re.fullmatch(r"(dezoome?|zoom arriere|recule|plus loin)", t):
        return "", [{"type": "zoom", "action": "arriere"}]
    if re.fullmatch(r"(montre|affiche)(.moi)? le monde|vue du monde|le monde", t):
        return "", [{"type": "zoom", "action": "monde"}]
    if re.fullmatch(r"(etat|infos?) (du|de mon) (mac|systeme|ordinateur|ordi)|(comment va|ca va) (mon|le) (mac|ordi|ordinateur)|(niveau de )?batterie", t):
        txt, act = outils.t_infos_systeme({})
        m2 = next((x for x in act[0]["metriques"] if x["nom"] == "Batterie"), None) if act else None
        return (f"Tout va bien. Batterie à {m2['valeur']} pour cent." if m2 else "Voici l'état de ton Mac."), act

    m = re.fullmatch(r"(?:montre|affiche)(?:.moi)? (?:sur la carte |la carte (?:de |du |des |d')?)?(.{2,40})|(?:ou (?:est|se trouve|se situe)) (.{2,40})", t)
    if m and not COMPLEXE.search(m.group(1) or m.group(2)):
        lieu = _clean_place(m.group(1) or m.group(2))
        if lieu and len(lieu.split()) <= 4 and not re.search(r"\b(un|une|des|mes|mon|ma|tes|ton|photo|fichier|dossier|liste|meteo)\b", lieu):
            m2 = re.search(re.escape(lieu).replace(r"\ ", r"[\s-]"), _sans_accents_mais_casse(texte), re.IGNORECASE)
            aff = texte[m2.start():m2.end()] if m2 else lieu.title()
            txt, act = outils.t_afficher_carte({"zone": aff, "lieux": [aff], "titre": aff})
            return ((f"Voici {aff}." if act else txt), act)
    return None
