"""Outils « interface » de Jarvis HUD : carte, itinéraires, météo, panneaux,
minuteurs, état du système.

Chaque outil renvoie (texte_pour_le_modele, actions_pour_l_interface).
Services gratuits et sans clé : OpenStreetMap (Photon / Nominatim),
Open-Meteo, OSRM. Bibliothèque standard uniquement.
"""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

USER_AGENT = "JarvisHUD/1.0 (assistant local OpenJarvis)"
IS_MAC = platform.system() == "Darwin"
MAX_PLACES = 15
CACHE_PATH = Path(os.environ.get("OPENJARVIS_HOME", Path.home() / ".openjarvis")) / "hud-geocache.json"


class ToolError(RuntimeError):
    pass


def _get_json(url: str, timeout: float = 12):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --------------------------------------------------------------------------
# Géocodage (avec cache disque)
# --------------------------------------------------------------------------

_cache_lock = threading.Lock()
_nominatim_lock = threading.Lock()
_last_nominatim = 0.0
try:
    _cache: dict = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
except (OSError, ValueError):
    _cache = {}


def _save_cache() -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(_cache, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _nominatim(params: dict):
    """Nominatim impose au plus une requête par seconde."""
    global _last_nominatim
    with _nominatim_lock:
        wait = 1.05 - (time.monotonic() - _last_nominatim)
        if wait > 0:
            time.sleep(wait)
        try:
            return _get_json("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params))
        finally:
            _last_nominatim = time.monotonic()


def _photon(query: str) -> dict | None:
    data = _get_json(
        "https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": query, "limit": 1, "lang": "fr"}), timeout=8
    )
    feats = data.get("features") or []
    if not feats:
        return None
    f = feats[0]
    lon, lat = f["geometry"]["coordinates"]
    p = f.get("properties", {})
    ext = p.get("extent")  # [ouest, nord, est, sud]
    bbox = [ext[3], ext[1], ext[0], ext[2]] if ext else None
    label = p.get("name") or query
    return {"nom": label, "lat": lat, "lon": lon, "bbox": bbox}


def geocode(query: str) -> dict | None:
    """Renvoie {nom, lat, lon, bbox:[sud, nord, ouest, est]} ou None."""
    key = query.strip().lower()
    if not key:
        return None
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    hit = None
    try:
        hit = _photon(query)
    except Exception:  # noqa: BLE001 - on bascule sur Nominatim
        hit = None
    if hit is None:
        try:
            res = _nominatim({"q": query, "format": "json", "limit": 1, "accept-language": "fr"})
        except Exception:  # noqa: BLE001
            res = []
        if res:
            r = res[0]
            hit = {
                "nom": (r.get("name") or r.get("display_name", query).split(",")[0]),
                "lat": float(r["lat"]),
                "lon": float(r["lon"]),
                "bbox": [float(x) for x in r.get("boundingbox", [])] or None,
            }
    if hit:
        with _cache_lock:
            _cache[key] = hit
            _save_cache()
    return hit


def _simplify(coords: list, max_points: int) -> list:
    if len(coords) <= max_points:
        return coords
    step = len(coords) / max_points
    return [coords[int(i * step)] for i in range(max_points)] + [coords[-1]]


def zone_outline(query: str) -> dict | None:
    """Contour (GeoJSON simplifié) d'un pays, d'une région ou d'une ville."""
    key = "zone2:" + query.strip().lower()
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    try:
        res = _nominatim(
            {"q": query, "format": "json", "limit": 1, "polygon_geojson": 1, "polygon_threshold": 0.02, "accept-language": "fr"}
        )
    except Exception:  # noqa: BLE001
        return None
    if not res or "geojson" not in res[0]:
        return None
    geo = res[0]["geojson"]
    if geo.get("type") not in ("Polygon", "MultiPolygon"):
        return None
    polys = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
    polys = sorted(polys, key=lambda p: len(p[0]), reverse=True)[:12]  # garde les plus grands morceaux
    budget = 2500
    total = sum(len(p[0]) for p in polys) or 1
    simple = [[_simplify(p[0], max(20, int(budget * len(p[0]) / total)))] for p in polys]
    main = simple[0][0]  # plus grand morceau (ex. la France métropolitaine)
    lons, lats = [c[0] for c in main], [c[1] for c in main]
    out = {
        "type": "MultiPolygon",
        "coordinates": simple,
        "bbox": [min(lats), max(lats), min(lons), max(lons)],  # sud, nord, ouest, est
        "nom": res[0].get("display_name", query).split(",")[0],
    }
    with _cache_lock:
        _cache[key] = out
        _save_cache()
    return out


# --------------------------------------------------------------------------
# Outils
# --------------------------------------------------------------------------

def t_afficher_carte(args: dict):
    lieux = args.get("lieux") or []
    if isinstance(lieux, str):
        lieux = [x.strip() for x in re.split(r"[,;]", lieux) if x.strip()]
    lieux = [str(x) for x in lieux][:MAX_PLACES]
    zone = str(args.get("zone") or "").strip()
    relier = bool(args.get("relier", False))
    titre = str(args.get("titre") or zone or ", ".join(lieux[:3]))

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(geocode, q) for q in lieux]
        zone_f = pool.submit(zone_outline, zone) if zone else None
        hits = [f.result() for f in futures]
        outline = zone_f.result() if zone_f else None

    points = [dict(h, nom=lieux[i] if len(lieux[i]) < 40 else h["nom"]) for i, h in enumerate(hits) if h]
    missing = [lieux[i] for i, h in enumerate(hits) if not h]
    if not points and not outline:
        return f"Aucun lieu trouvé pour : {', '.join(lieux) or zone}.", []

    action = {"type": "map", "titre": titre, "points": points, "relier": relier, "zone": outline}
    parts = []
    if outline:
        parts.append(f"zone « {outline['nom']} » surlignée")
    if points:
        parts.append(f"{len(points)} lieu(x) affiché(s) : {', '.join(p['nom'] for p in points)}")
    if relier and len(points) > 1:
        parts.append("reliés dans l'ordre")
    msg = "Carte affichée : " + " ; ".join(parts) + "."
    if missing:
        msg += f" Introuvable(s) : {', '.join(missing)}."
    return msg, [action]


def t_itineraire(args: dict):
    depart, arrivee = str(args.get("depart", "")), str(args.get("arrivee", ""))
    mode = str(args.get("mode") or "voiture")
    profile = {"voiture": "driving", "velo": "cycling", "vélo": "cycling", "pied": "foot", "marche": "foot"}.get(mode, "driving")
    a, b = geocode(depart), geocode(arrivee)
    if not a or not b:
        return f"Impossible de localiser {'le départ' if not a else 'l arrivée'}.", []
    host = {"driving": "router.project-osrm.org/route/v1/driving",
            "cycling": "routing.openstreetmap.de/routed-bike/route/v1/driving",
            "foot": "routing.openstreetmap.de/routed-foot/route/v1/driving"}[profile]
    url = f"https://{host}/{a['lon']},{a['lat']};{b['lon']},{b['lat']}?overview=full&geometries=geojson"
    try:
        data = _get_json(url, timeout=15)
        route = data["routes"][0]
    except Exception:  # noqa: BLE001
        # Pas de calcul possible : ligne droite.
        action = {"type": "route", "depart": dict(a, nom=depart), "arrivee": dict(b, nom=arrivee),
                  "ligne": [[a["lon"], a["lat"]], [b["lon"], b["lat"]]], "km": None, "minutes": None}
        return "Service d'itinéraire indisponible : trajet affiché à vol d'oiseau.", [action]
    km = route["distance"] / 1000
    minutes = route["duration"] / 60
    line = _simplify(route["geometry"]["coordinates"], 1500)
    action = {"type": "route", "depart": dict(a, nom=depart), "arrivee": dict(b, nom=arrivee),
              "ligne": line, "km": round(km, 1), "minutes": round(minutes), "mode": mode}
    h, m = divmod(round(minutes), 60)
    duree = f"{h} h {m:02d}" if h else f"{m} min"
    return f"Itinéraire {depart} → {arrivee} ({mode}) : {km:.0f} km, environ {duree}.", [action]


def t_style_carte(args: dict):
    style = str(args.get("style", "sombre")).lower()
    style = {"satellite": "satellite", "sat": "satellite", "plan": "plan", "clair": "plan"}.get(style, "sombre")
    return f"Style de carte : {style}.", [{"type": "style", "style": style}]


def t_zoom_carte(args: dict):
    action = str(args.get("action", "avant")).lower()
    return f"Zoom {action}.", [{"type": "zoom", "action": action}]


def t_accueil(args: dict):
    return "Écran d'accueil affiché, carte et panneaux effacés.", [{"type": "home"}]


def t_afficher_panneau(args: dict):
    titre = str(args.get("titre", "Information"))[:80]
    lignes = args.get("lignes") or []
    if isinstance(lignes, str):
        lignes = [l for l in lignes.split("\n") if l.strip()]
    lignes = [str(l)[:200] for l in lignes][:14]
    return f"Panneau « {titre} » affiché.", [{"type": "panel", "titre": titre, "lignes": lignes}]


def t_minuteur(args: dict):
    try:
        sec = max(1, min(int(float(args.get("secondes", 60))), 24 * 3600))
    except (TypeError, ValueError):
        return "Durée invalide.", []
    libelle = str(args.get("libelle") or "Minuteur")[:40]
    m, s = divmod(sec, 60)
    return f"Minuteur « {libelle} » lancé pour {m} min {s:02d} s.", [{"type": "timer", "secondes": sec, "libelle": libelle}]


WEATHER = {
    0: "ciel dégagé", 1: "plutôt dégagé", 2: "partiellement nuageux", 3: "couvert", 45: "brouillard", 48: "brouillard givrant",
    51: "bruine légère", 53: "bruine", 55: "bruine dense", 61: "pluie faible", 63: "pluie", 65: "forte pluie",
    66: "pluie verglaçante", 67: "forte pluie verglaçante", 71: "neige faible", 73: "neige", 75: "forte neige", 77: "grains de neige",
    80: "averses", 81: "averses", 82: "violentes averses", 85: "averses de neige", 86: "fortes averses de neige",
    95: "orage", 96: "orage avec grêle", 99: "orage violent avec grêle",
}


def t_meteo(args: dict):
    lieu = str(args.get("lieu", "")).strip()
    place = geocode(lieu)
    if not place:
        return f"Lieu introuvable : {lieu}.", []
    q = urllib.parse.urlencode({
        "latitude": place["lat"], "longitude": place["lon"], "timezone": "auto", "forecast_days": 4,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    })
    try:
        d = _get_json("https://api.open-meteo.com/v1/forecast?" + q)
    except Exception:  # noqa: BLE001
        return "Service météo injoignable.", []
    cur, day = d["current"], d["daily"]
    jours = []
    for i in range(min(4, len(day["time"]))):
        jours.append({
            "date": day["time"][i], "code": day["weather_code"][i], "etat": WEATHER.get(day["weather_code"][i], "?"),
            "max": round(day["temperature_2m_max"][i]), "min": round(day["temperature_2m_min"][i]),
            "pluie": day.get("precipitation_probability_max", [None] * 4)[i],
        })
    info = {
        "lieu": lieu, "temp": round(cur["temperature_2m"]), "ressenti": round(cur["apparent_temperature"]),
        "humidite": cur["relative_humidity_2m"], "vent": round(cur["wind_speed_10m"]),
        "code": cur["weather_code"], "etat": WEATHER.get(cur["weather_code"], "?"), "jours": jours,
    }
    txt = (f"Météo à {lieu} : {info['temp']} °C (ressenti {info['ressenti']} °C), {info['etat']}, vent {info['vent']} km/h, "
           f"humidité {info['humidite']} %. Prévisions : "
           + "; ".join(f"{j['date']} {j['etat']} {j['min']}–{j['max']} °C" for j in jours[1:]) + ".")
    pt = dict(place, nom=lieu)
    return txt, [{"type": "weather", "meteo": info},
                 {"type": "map", "titre": lieu, "points": [pt], "relier": False, "zone": None, "silencieux": True}]


def _run(args: list[str]) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=8).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def t_infos_systeme(args: dict):
    metrics = []
    home = str(Path.home())
    du = shutil.disk_usage(home)
    metrics.append({"nom": "Disque", "valeur": round(du.used / du.total * 100),
                    "detail": f"{du.free / 1e9:.0f} Go libres sur {du.total / 1e9:.0f} Go"})
    try:
        load = os.getloadavg()[0]
        cpus = os.cpu_count() or 1
        metrics.append({"nom": "Processeur", "valeur": min(100, round(load / cpus * 100)),
                        "detail": f"charge {load:.2f} sur {cpus} cœurs"})
    except OSError:
        pass
    if IS_MAC:
        total = int((_run(["sysctl", "-n", "hw.memsize"]) or "0").strip() or 0)
        vm = _run(["vm_stat"])
        page = int(re.search(r"page size of (\d+)", vm).group(1)) if "page size of" in vm else 16384

        def pages(label: str) -> int:
            m = re.search(label + r":\s+(\d+)", vm)
            return int(m.group(1)) if m else 0

        used = (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page
        if total:
            metrics.append({"nom": "Mémoire", "valeur": round(used / total * 100),
                            "detail": f"{used / 1e9:.1f} Go utilisés sur {total / 1e9:.0f} Go"})
        batt = _run(["pmset", "-g", "batt"])
        m = re.search(r"(\d+)%;\s*([^;]+)", batt)
        if m:
            metrics.append({"nom": "Batterie", "valeur": int(m.group(1)), "detail": m.group(2).strip()})
    else:
        try:
            info = Path("/proc/meminfo").read_text()
            tot = int(re.search(r"MemTotal:\s+(\d+)", info).group(1))
            avail = int(re.search(r"MemAvailable:\s+(\d+)", info).group(1))
            metrics.append({"nom": "Mémoire", "valeur": round((tot - avail) / tot * 100),
                            "detail": f"{(tot - avail) / 1e6:.1f} Go utilisés sur {tot / 1e6:.0f} Go"})
        except (OSError, AttributeError):
            pass
    txt = "État du système : " + "; ".join(f"{m['nom']} {m['valeur']} % ({m['detail']})" for m in metrics) + "."
    return txt, [{"type": "system", "metriques": metrics}]


def _fn(name, description, props, required):
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": props, "required": required}}}


TOOLS = [
    _fn("afficher_carte",
        "Affiche une carte animée : surligne une zone (pays, région, ville) et/ou place plusieurs lieux avec leur nom. "
        "Exemple : zone « France » et lieux [Paris, Lyon, Marseille]. Utilise-le pour toute demande de carte ou de lieu.",
        {"lieux": {"type": "array", "items": {"type": "string"}, "description": "Villes, adresses ou monuments"},
         "zone": {"type": "string", "description": "Zone à surligner (pays, région, département, ville), optionnel"},
         "relier": {"type": "boolean", "description": "Relier les lieux par des lignes dans l'ordre (tournée, voyage)"},
         "titre": {"type": "string", "description": "Titre affiché"}},
        []),
    _fn("itineraire", "Calcule et trace un itinéraire réel entre deux lieux, avec distance et durée.",
        {"depart": {"type": "string"}, "arrivee": {"type": "string"},
         "mode": {"type": "string", "enum": ["voiture", "velo", "pied"]}},
        ["depart", "arrivee"]),
    _fn("style_carte", "Change l'apparence de la carte.",
        {"style": {"type": "string", "enum": ["sombre", "satellite", "plan"]}}, ["style"]),
    _fn("zoom_carte", "Zoome ou dézoome la carte.",
        {"action": {"type": "string", "enum": ["avant", "arriere", "monde"]}}, ["action"]),
    _fn("accueil", "Revient à l'écran d'accueil (efface la carte et les panneaux).", {}, []),
    _fn("afficher_panneau",
        "Affiche un panneau holographique avec un titre et des lignes de texte (liste, résumé, chiffres clés, étapes).",
        {"titre": {"type": "string"}, "lignes": {"type": "array", "items": {"type": "string"}}},
        ["titre", "lignes"]),
    _fn("minuteur", "Lance un minuteur visible à l'écran, qui prévient à la fin.",
        {"secondes": {"type": "integer"}, "libelle": {"type": "string"}}, ["secondes"]),
    _fn("meteo", "Donne la météo actuelle et les prévisions d'un lieu, et l'affiche à l'écran.",
        {"lieu": {"type": "string"}}, ["lieu"]),
    _fn("infos_systeme", "Affiche l'état de l'ordinateur : batterie, disque, mémoire, processeur.", {}, []),
]

HANDLERS = {
    "afficher_carte": t_afficher_carte,
    "afficher_lieu": lambda a: t_afficher_carte({"lieux": [a.get("lieu", "")]}),  # ancien nom
    "itineraire": t_itineraire,
    "style_carte": t_style_carte,
    "zoom_carte": t_zoom_carte,
    "accueil": t_accueil,
    "afficher_panneau": t_afficher_panneau,
    "minuteur": t_minuteur,
    "meteo": t_meteo,
    "infos_systeme": t_infos_systeme,
}
