#!/usr/bin/env python3
"""Écoute « Hey Jarvis » en arrière-plan et réveille Jarvis.

Tourne en permanence (lancé par « Jarvis Écoute.app » à l'ouverture de session).
Tout reste local : le son du micro est analysé sur le Mac par openWakeWord,
rien n'est enregistré ni envoyé.

Quand « Hey Jarvis » est détecté :
  - si le serveur Jarvis ne tourne pas, il est lancé (lancer-jarvis.command) ;
  - la fenêtre Jarvis est ouverte si elle ne l'est pas ;
  - Jarvis se met à écouter la demande.

Dépendances (installées par installer-app.sh) : openwakeword, sounddevice, numpy.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HUD_DIR = Path(__file__).resolve().parent
PORT = os.environ.get("JARVIS_HUD_PORT", "3000")
URL = f"http://localhost:{PORT}"
OJ_HOME = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis"))
SEUIL = float(os.environ.get("JARVIS_WAKE_THRESHOLD", "0.5"))
PAUSE = 4.0  # secondes minimum entre deux réveils
RATE, BLOCK = 16000, 1280  # 80 ms à 16 kHz, format attendu par openWakeWord


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def _token() -> str:
    try:
        return (OJ_HOME / "hud-token").read_text().strip()
    except OSError:
        return ""


def server_up() -> bool:
    try:
        urllib.request.urlopen(URL + "/api/status", timeout=2).read()
        return True
    except OSError:
        return False


def wake_server(ouvrir: bool = True) -> dict:
    req = urllib.request.Request(URL + "/api/internal/wake", data=json.dumps({"ouvrir": ouvrir}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Jarvis-Token": _token()})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def open_window() -> None:
    subprocess.Popen([str(HUD_DIR / "ouvrir-fenetre.sh")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def reveil() -> None:
    log("« Hey Jarvis » détecté")
    lance = False
    if not server_up():
        lance = True  # le lanceur ouvre déjà la fenêtre
        subprocess.run([str(HUD_DIR / "lancer-jarvis.command")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
        for _ in range(20):
            if server_up():
                break
            time.sleep(0.5)
    try:
        wake_server(ouvrir=not lance)  # le serveur réveille l'interface et ouvre la fenêtre si besoin
    except OSError as exc:
        log(f"Serveur Jarvis injoignable : {exc}")
        open_window()


def charger_modele():
    import openwakeword
    from openwakeword.model import Model

    try:
        return Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    except Exception:  # noqa: BLE001 - modèles absents : on les télécharge une fois
        log("Téléchargement du modèle « hey jarvis »…")
        openwakeword.utils.download_models(["hey_jarvis"])
        return Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")


def main() -> None:
    import numpy as np
    import sounddevice as sd

    model = charger_modele()
    cle = next(iter(model.models.keys()))
    log(f"À l'écoute de « Hey Jarvis » (modèle {cle}, seuil {SEUIL})")
    dernier = 0.0
    while True:
        try:
            with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=BLOCK) as stream:
                while True:
                    audio, _ = stream.read(BLOCK)
                    score = model.predict(np.squeeze(audio)).get(cle, 0.0)
                    if score >= SEUIL and time.monotonic() - dernier > PAUSE:
                        dernier = time.monotonic()
                        model.reset()
                        reveil()
        except KeyboardInterrupt:
            return
        except Exception as exc:  # noqa: BLE001 - micro débranché, permission refusée…
            log(f"Micro indisponible ({exc}) ; nouvel essai dans 10 s")
            time.sleep(10)


if __name__ == "__main__":
    if "--test" in sys.argv:
        reveil()
    else:
        main()
