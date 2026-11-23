"""Filet de sécurité du mode « propriétaire ».

En mode propriétaire, Jarvis exécute les commandes sans demander, SAUF celles
que cette analyse juge risquées (suppression, écrasement, droits administrateur,
envoi de messages, réglages système…), qui passent par la fenêtre de validation.

C'est une heuristique : elle repère les cas courants, elle ne garantit pas
qu'aucune commande risquée ne passera. Le mode « prudent » demande tout.
"""

from __future__ import annotations

import os
import re
import shlex

# (motif, raison) — recherché sans tenir compte de la casse
RISQUES = [
    (r"\b(rm|rmdir|unlink|shred|srm)\b", "suppression de fichiers"),
    (r"-delete\b|-exec\s+rm\b", "suppression de fichiers"),
    (r"\btrash\b|\.Trash\b|empty\s+(the\s+)?trash|vider\s+la\s+corbeille", "corbeille"),
    (r"\bdelete\b|\bremove\b|\bsupprim", "suppression"),
    (r"\bsudo\b|\bsu\s|\bdoas\b", "droits administrateur"),
    (r"\b(diskutil|fdisk|mkfs|newfs|dd)\b\s", "disques"),
    (r"\b(shutdown|reboot|halt)\b|restart\b|shut\s+down|log\s+out", "arrêt ou redémarrage"),
    (r"\b(kill|killall|pkill)\b", "arrêt de programmes"),
    (r"\blaunchctl\b|\bcrontab\b", "services système"),
    (r"\b(defaults\s+delete|tccutil|csrutil|spctl|systemsetup|networksetup|scutil|pmset|nvram|dscl)\b", "réglages système"),
    (r"\bsecurity\b\s+\w|keychain", "trousseau / mots de passe"),
    (r"\b(chmod|chown|chflags)\b", "permissions de fichiers"),
    (r"(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b", "exécution d'un script téléchargé"),
    (r"\bgit\s+(push|reset\s+--hard|clean|checkout\s+--)", "dépôt git"),
    (r"\b(pip|pip3|npm|brew|gem|cargo)\s+(install|uninstall|remove)\b", "installation de logiciels"),
    (r"\b(send|envoy)\w*\b.*\b(mail|message|imessage|sms|whatsapp)|\b(mail|messages)\b.*\bsend\b", "envoi de message"),
    (r"\b(scp|rsync|sftp|ftp)\b|curl\b.*(-T|--upload-file|-F|--data|-d)\s", "envoi de fichiers sur internet"),
    (r"\b(open|osascript)\b.*\b(buy|purchase|achat|payer|checkout)\b", "achat"),
]


def _existing_redirect_targets(cmd: str) -> list[str]:
    """Fichiers existants qu'une redirection « > » écraserait."""
    found = []
    for m in re.finditer(r"(?<![>&0-9])>(?!>|&)\s*([^\s;&|]+)", cmd):
        target = m.group(1).strip("'\"")
        if target.startswith("/dev/"):
            continue
        path = os.path.expanduser(target)
        if not os.path.isabs(path):
            path = os.path.join(os.path.expanduser("~"), path)
        if os.path.exists(path):
            found.append(target)
    return found


def _clobbering_move(cmd: str) -> bool:
    """mv / cp sans -n (pourraient écraser un fichier existant)."""
    for part in re.split(r"[;&|]+", cmd):
        try:
            words = shlex.split(part)
        except ValueError:
            words = part.split()
        if words and words[0] in ("mv", "cp", "ditto"):
            flags = "".join(w for w in words[1:] if w.startswith("-") and not w.startswith("--"))
            if "n" not in flags and "i" not in flags:
                return True
    return False


def analyser(commande: str) -> str | None:
    """Renvoie la raison du risque, ou None si la commande peut s'exécuter directement."""
    cmd = commande.strip()
    if not cmd:
        return "commande vide"
    for motif, raison in RISQUES:
        if re.search(motif, cmd, re.IGNORECASE):
            return raison
    cibles = _existing_redirect_targets(cmd)
    if cibles:
        return "écrasement de " + ", ".join(cibles[:2])
    if _clobbering_move(cmd):
        return "déplacement ou copie qui pourrait écraser un fichier (utiliser -n)"
    return None
