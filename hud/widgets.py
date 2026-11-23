"""Widgets permanents de l'écran Jarvis (météo, état du Mac, note, horloge, compte à rebours).

Ajoutés à la voix (« ajoute un widget météo pour Sète »), ils restent affichés
sur l'écran d'accueil et sont conservés entre deux lancements.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path

PATH = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis")) / "hud-widgets.json"
TYPES = ("meteo", "systeme", "note", "horloge", "compte_a_rebours")
MAX_WIDGETS = 8
_lock = threading.Lock()


def load() -> list[dict]:
    try:
        data = json.loads(PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save(items: list[dict]) -> None:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")


def t_ajouter(args: dict):
    kind = str(args.get("type", "")).strip().lower()
    if kind not in TYPES:
        return f"Type de widget inconnu. Types possibles : {', '.join(TYPES)}.", []
    w = {"id": uuid.uuid4().hex[:8], "type": kind, "titre": str(args.get("titre") or "")[:40]}
    for key in ("lieu", "texte", "fuseau", "date"):
        if args.get(key):
            w[key] = str(args[key])[:300]
    if kind == "meteo" and not w.get("lieu"):
        return "Il faut un lieu pour un widget météo.", []
    if kind == "horloge" and not w.get("fuseau"):
        return "Il faut un fuseau horaire IANA (ex. Asia/Tokyo) pour une horloge.", []
    if kind == "compte_a_rebours" and not w.get("date"):
        return "Il faut une date (AAAA-MM-JJ) pour un compte à rebours.", []
    with _lock:
        items = load()
        if len(items) >= MAX_WIDGETS:
            return f"L'écran a déjà {MAX_WIDGETS} widgets : retire-en un d'abord.", []
        items.append(w)
        _save(items)
    return f"Widget {kind} ajouté (id {w['id']}).", [{"type": "widgets"}]


def t_retirer(args: dict):
    cible = str(args.get("cible", "")).strip().lower()
    with _lock:
        items = load()
        if cible in ("tous", "tout", "all"):
            kept = []
        else:
            kept = [w for w in items if cible not in (w["id"], w["type"], w.get("titre", "").lower(), w.get("lieu", "").lower())]
        removed = len(items) - len(kept)
        _save(kept)
    if not removed:
        listing = ", ".join(f"{w['type']} {w.get('titre') or w.get('lieu') or ''} ({w['id']})".strip() for w in items) or "aucun"
        return f"Aucun widget ne correspond à « {cible} ». Widgets actuels : {listing}.", []
    return f"{removed} widget(s) retiré(s).", [{"type": "widgets"}]


def _fn(name, description, props, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": props, "required": required}}}


TOOLS = [
    _fn("ajouter_widget",
        "Ajoute un widget permanent sur l'écran d'accueil de Jarvis : meteo (lieu), systeme (état du Mac), "
        "note (texte), horloge (fuseau IANA, ex. America/New_York), compte_a_rebours (date AAAA-MM-JJ).",
        {"type": {"type": "string", "enum": list(TYPES)}, "titre": {"type": "string"}, "lieu": {"type": "string"},
         "texte": {"type": "string"}, "fuseau": {"type": "string"}, "date": {"type": "string"}},
        ["type"]),
    _fn("retirer_widget", "Retire un widget de l'écran (par id, type, titre ou lieu), ou « tous ».",
        {"cible": {"type": "string"}}, ["cible"]),
]

HANDLERS = {"ajouter_widget": t_ajouter, "retirer_widget": t_retirer}
