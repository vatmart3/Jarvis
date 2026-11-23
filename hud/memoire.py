"""Mémoire persistante et notes de Jarvis (mode local).

Source de vérité : ~/.openjarvis/hud-memoire.json ; le navigateur en garde une copie (localStorage),
synchronisée par événements. Un résumé de la mémoire est injecté dans le prompt de Claude.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path

PATH = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis")) / "hud-memoire.json"
_lock = threading.Lock()
on_change = lambda kind, data: None  # noqa: E731 — branché par server.py (événement vers l'interface)


def _load() -> dict:
    try:
        d = json.loads(PATH.read_text(encoding="utf-8"))
        return {"faits": d.get("faits", []), "notes": d.get("notes", [])}
    except (OSError, ValueError):
        return {"faits": [], "notes": []}


def _save(d: dict) -> None:
    PATH.parent.mkdir(parents=True, exist_ok=True)
    PATH.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def tout() -> dict:
    with _lock:
        return _load()


def fusionner(faits: list, notes: list) -> dict:
    """Fusionne la copie du navigateur (ex. après une session en ligne) avec le fichier."""
    with _lock:
        d = _load()
        connus = {f["fait"].lower() for f in d["faits"]}
        for f in faits or []:
            if isinstance(f, dict) and f.get("fait") and f["fait"].lower() not in connus:
                d["faits"].append({"fait": str(f["fait"])[:300], "date": str(f.get("date", ""))[:10]}); connus.add(f["fait"].lower())
        vues = {(n["texte"], n.get("date")) for n in d["notes"]}
        for n in notes or []:
            if isinstance(n, dict) and n.get("texte") and (n["texte"], n.get("date")) not in vues:
                d["notes"].append({"texte": str(n["texte"])[:500], "date": str(n.get("date", ""))})
        d["faits"], d["notes"] = d["faits"][-60:], d["notes"][-200:]
        _save(d)
        return d


def resume() -> str:
    faits = tout()["faits"][::-1]
    out = ""
    for f in faits:
        s = f"- {f['fait']}\n"
        if len(out) + len(s) > 1500:
            break
        out += s
    return out.strip()


def _modif(kind: str, fn):
    with _lock:
        d = _load()
        msg = fn(d)
        _save(d)
    on_change(kind, d[kind])
    return msg


def t_memoriser(args: dict):
    fait = str(args.get("fait", "")).strip()[:300]
    if not fait:
        return "Rien à retenir.", []

    def f(d):
        d["faits"] = [x for x in d["faits"] if x["fait"].lower() != fait.lower()] + [{"fait": fait, "date": datetime.now().strftime("%Y-%m-%d")}]
        d["faits"] = d["faits"][-60:]
        return f"Retenu : {fait}"
    return _modif("faits", f), []


def t_oublier(args: dict):
    motif = str(args.get("motif", "")).lower()

    def f(d):
        avant = len(d["faits"]); d["faits"] = [x for x in d["faits"] if motif not in x["fait"].lower()]
        return f"{avant - len(d['faits'])} souvenir(s) effacé(s)."
    return _modif("faits", f), []


def t_prendre_note(args: dict):
    texte = str(args.get("texte", "")).strip()[:500]
    if not texte:
        return "Note vide.", []

    def f(d):
        d["notes"].append({"texte": texte, "date": datetime.now().isoformat(timespec="seconds")}); d["notes"] = d["notes"][-200:]
        return f"Note enregistrée ({len(d['notes'])} au total)."
    return _modif("notes", f), [{"type": "notes"}]


def t_lire_notes(args: dict):
    notes = tout()["notes"][-10:][::-1]
    txt = "\n".join(f"{n['date'][:10]} — {n['texte']}" for n in notes) or "Aucune note."
    return txt, [{"type": "notes"}]


def t_supprimer_note(args: dict):
    motif = str(args.get("motif", "")).lower()

    def f(d):
        avant = len(d["notes"]); d["notes"] = [] if motif == "toutes" else [n for n in d["notes"] if motif not in n["texte"].lower()]
        return f"{avant - len(d['notes'])} note(s) supprimée(s)."
    return _modif("notes", f), [{"type": "notes"}]


def _fn(name, description, props, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": props, "required": required}}}


TOOLS = [
    _fn("memoriser", "Retient durablement un fait sur l'utilisateur (préférence, ville, proches, projets).", {"fait": {"type": "string"}}, ["fait"]),
    _fn("oublier", "Oublie les souvenirs qui contiennent un motif.", {"motif": {"type": "string"}}, ["motif"]),
    _fn("prendre_note", "Enregistre une note de l'utilisateur.", {"texte": {"type": "string"}}, ["texte"]),
    _fn("lire_notes", "Affiche et renvoie les dernières notes.", {}, []),
    _fn("supprimer_note", "Supprime les notes contenant un motif (« toutes » pour tout effacer).", {"motif": {"type": "string"}}, ["motif"]),
]
HANDLERS = {"memoriser": t_memoriser, "oublier": t_oublier, "prendre_note": t_prendre_note, "lire_notes": t_lire_notes, "supprimer_note": t_supprimer_note}
