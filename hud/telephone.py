"""Lien iPhone ↔ Jarvis via ntfy (https://ntfy.sh) : gratuit, sans compte, sans clé.

- Notifications : Jarvis publie sur le sujet « notifications » ; l'app ntfy de
  l'iPhone, abonnée à ce sujet, affiche les messages.
- Ordres : un Raccourci iPhone (déclenché par « Hey Jarvis » grâce aux
  Raccourcis vocaux d'iOS 18) publie la demande sur le sujet « ordres ».
  Le Mac l'écoute (connexion sortante uniquement : aucun port ouvert), réveille
  Jarvis ou exécute la demande, puis renvoie la réponse en notification.

Les noms de sujets sont aléatoires et longs ; les ordres doivent en plus porter
la clé secrète en titre. Les messages transitent par le serveur ntfy (non
chiffrés de bout en bout) : ne pas y faire passer de mots de passe.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

OJ_HOME = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis"))
CONFIG_PATH = OJ_HOME / "hud-telephone.json"
USER_AGENT = "JarvisHUD/1.0"
_lock = threading.Lock()


def _alea(n: int) -> str:
    alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(n))


def config(create: bool = True) -> dict | None:
    """Charge la configuration, ou la crée (sujets et clé aléatoires) au premier appel."""
    with _lock:
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if cfg.get("notifs") and cfg.get("ordres") and cfg.get("cle"):
                cfg.setdefault("serveur", "https://ntfy.sh")
                return cfg
        except (OSError, ValueError):
            pass
        if not create:
            return None
        cfg = {
            "serveur": os.environ.get("JARVIS_NTFY_SERVER", "https://ntfy.sh"),
            "notifs": "jarvis-" + _alea(20),
            "ordres": "jarvis-" + _alea(20),
            "cle": _alea(24),
            "actif": True,
        }
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
        os.chmod(CONFIG_PATH, 0o600)
        return cfg


def _ascii_header(value: str) -> str:
    """Les en-têtes HTTP doivent rester en latin-1 : ntfy accepte l'encodage RFC 2047."""
    try:
        value.encode("latin-1")
        return value
    except UnicodeEncodeError:
        import base64
        return "=?UTF-8?B?" + base64.b64encode(value.encode("utf-8")).decode() + "?="


def notifier(message: str, titre: str = "Jarvis", priorite: str = "default",
             tags: str = "robot", quand: str | None = None) -> tuple[bool, str]:
    """Envoie une notification à l'iPhone. `quand` : délai ntfy (« 20m », « 2h ») ou horodatage Unix."""
    cfg = config()
    headers = {"Title": _ascii_header(titre[:120]), "Priority": priorite, "Tags": tags, "User-Agent": USER_AGENT}
    if quand:
        headers["At"] = str(quand)
    req = urllib.request.Request(f"{cfg['serveur'].rstrip('/')}/{cfg['notifs']}", data=message[:3500].encode("utf-8"),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
        return True, "Notification envoyée sur l'iPhone." if not quand else "Rappel programmé sur l'iPhone."
    except OSError as exc:
        return False, f"Notification impossible : {exc}"


# --------------------------------------------------------------------------
# Outils pour Jarvis
# --------------------------------------------------------------------------

PRIORITES = {"basse": "low", "normale": "default", "haute": "high", "urgente": "urgent"}


def _quand(args: dict) -> tuple[str | None, str]:
    """Calcule l'heure d'envoi d'un rappel : délai en minutes ou heure « HH:MM » (aujourd'hui ou demain)."""
    if args.get("dans_minutes") not in (None, ""):
        minutes = max(1, int(float(args["dans_minutes"])))
        return f"{minutes}m", f"dans {minutes} min"
    heure = str(args.get("heure") or "").strip().replace("h", ":").replace("H", ":")
    if heure:
        parts = [p for p in heure.split(":") if p != ""]
        h, m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
        now = datetime.now()
        when = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if when <= now:
            when += timedelta(days=1)
        return str(int(when.timestamp())), when.strftime("le %d/%m à %H:%M")
    return None, ""


def t_notifier(args: dict):
    ok, txt = notifier(str(args.get("message", "")), str(args.get("titre") or "Jarvis"),
                       PRIORITES.get(str(args.get("priorite", "normale")), "default"))
    return txt, []


def t_rappel(args: dict):
    try:
        quand, libelle = _quand(args)
    except (ValueError, IndexError):
        return "Heure ou délai invalide.", []
    if not quand:
        return "Indique dans_minutes ou heure (HH:MM).", []
    ok, txt = notifier(str(args.get("message", "")), "Rappel · Jarvis", "high", "alarm_clock", quand)
    return (f"Rappel programmé {libelle} sur l'iPhone." if ok else txt), []


def _fn(name, description, props, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": props, "required": required}}}


TOOLS = [
    _fn("notifier_telephone", "Envoie tout de suite une notification sur l'iPhone de l'utilisateur.",
        {"message": {"type": "string"}, "titre": {"type": "string"},
         "priorite": {"type": "string", "enum": list(PRIORITES)}}, ["message"]),
    _fn("rappel_telephone",
        "Programme une notification sur l'iPhone plus tard (jusqu'à 3 jours) : dans_minutes OU heure (HH:MM).",
        {"message": {"type": "string"}, "dans_minutes": {"type": "integer"}, "heure": {"type": "string"}},
        ["message"]),
]
HANDLERS = {"notifier_telephone": t_notifier, "rappel_telephone": t_rappel}


# --------------------------------------------------------------------------
# Réception des ordres envoyés depuis l'iPhone
# --------------------------------------------------------------------------

class Ecouteur(threading.Thread):
    """Suit le sujet « ordres » (flux JSON de ntfy) et appelle `on_ordre(texte)` pour chaque ordre valide."""

    def __init__(self, on_ordre) -> None:
        super().__init__(daemon=True, name="ecoute-telephone")
        self.on_ordre = on_ordre
        self.dernier: str | None = None

    def run(self) -> None:
        pause = 2
        while True:
            cfg = config()
            if not cfg.get("actif", True):
                time.sleep(30)
                continue
            url = f"{cfg['serveur'].rstrip('/')}/{cfg['ordres']}/json"
            if self.dernier:
                url += "?since=" + urllib.parse.quote(self.dernier)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=120) as resp:  # ntfy envoie un keepalive toutes les ~45 s
                    pause = 2
                    for raw in resp:
                        try:
                            msg = json.loads(raw.decode("utf-8"))
                        except ValueError:
                            continue
                        if msg.get("event") != "message":
                            continue
                        self.dernier = msg.get("id") or self.dernier
                        if msg.get("title", "") != cfg["cle"]:
                            continue  # sans la clé secrète, on ignore
                        threading.Thread(target=self.on_ordre, args=(str(msg.get("message", "")),), daemon=True).start()
            except Exception:  # noqa: BLE001 - réseau coupé, Mac en veille… on se reconnecte
                time.sleep(pause)
                pause = min(pause * 2, 60)


MOTS_REVEIL = {"", "triggered", "hey jarvis", "jarvis", "réveille-toi", "reveille-toi", "réveil", "ouvre-toi", "ouvre jarvis",
               "allume-toi", "réveille toi", "ouvre toi", "debout"}


def est_reveil(texte: str) -> bool:
    t = texte.strip().lower().strip(".!?, ")
    return t in MOTS_REVEIL


def guide() -> str:
    cfg = config()
    base = cfg["serveur"].rstrip("/")
    return f"""
JARVIS SUR L'IPHONE
===================

1) NOTIFICATIONS
   - Installe l'app « ntfy » (App Store), ouvre-la, touche « + » et abonne-toi au sujet :
         {cfg['notifs']}
     (serveur : {base} ; laisse le réglage par défaut si c'est ntfy.sh)
   - Autorise les notifications quand l'app le demande.

2) RACCOURCI « HEY JARVIS »
   Dans l'app Raccourcis, crée un raccourci nommé « Jarvis » avec ces 2 actions :
   a. « Dicter le texte » (Langue : Français ; Arrêter l'écoute : Après une pause).
   b. « Obtenir le contenu de l'URL »
        URL      : {base}/{cfg['ordres']}
        Méthode  : POST
        En-têtes : Title = {cfg['cle']}
        Corps    : Fichier → choisis la variable « Texte dicté »
   Ensuite : Réglages > Accessibilité > Raccourcis vocaux > ajoute une action, choisis
   ton raccourci « Jarvis », et enregistre la phrase « Hey Jarvis » (iOS 18 ou plus).
   Sans iOS 18 : « Dis Siri, Jarvis » lance aussi le raccourci.

3) UTILISATION
   « Hey Jarvis » sur l'iPhone, puis :
   - rien, ou « ouvre-toi » → Jarvis s'ouvre sur le Mac et t'écoute ;
   - une demande (« range mon bureau », « quel temps demain à Sète ? ») → Jarvis la fait
     sur le Mac et te répond en notification.

Garde ces noms et cette clé pour toi : ils servent de mot de passe.
Les messages passent par le serveur ntfy, non chiffrés de bout en bout : n'y dicte pas de mots de passe.
"""


if __name__ == "__main__":
    import sys
    print(guide())
    if "--test" in sys.argv:
        ok, txt = notifier("Si tu lis ceci, les notifications de Jarvis fonctionnent.", "Jarvis · test")
        print(txt)
