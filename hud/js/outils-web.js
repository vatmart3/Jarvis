// Outils exécutés dans le navigateur quand Jarvis tourne en mode « en ligne » (Vercel, API Anthropic).
// En mode local, les mêmes outils sont exécutés par le serveur Python (hud/outils.py, widgets.py…).
import { memoire, notes } from "./memoire.js";
import { pont } from "./pont.js";

export const WEATHER = { 0: "ciel dégagé", 1: "plutôt dégagé", 2: "partiellement nuageux", 3: "couvert", 45: "brouillard", 48: "brouillard givrant",
  51: "bruine légère", 53: "bruine", 55: "bruine dense", 61: "pluie faible", 63: "pluie", 65: "forte pluie", 66: "pluie verglaçante",
  67: "forte pluie verglaçante", 71: "neige faible", 73: "neige", 75: "forte neige", 77: "grains de neige", 80: "averses", 81: "averses",
  82: "violentes averses", 85: "averses de neige", 86: "fortes averses de neige", 95: "orage", 96: "orage avec grêle", 99: "orage violent avec grêle" };
const VILLES = [["Lille", 50.63, 3.06], ["Paris", 48.86, 2.35], ["Strasbourg", 48.58, 7.75], ["Brest", 48.39, -4.49], ["Rennes", 48.11, -1.68],
  ["Caen", 49.18, -0.37], ["Reims", 49.26, 4.03], ["Nantes", 47.22, -1.55], ["Orléans", 47.9, 1.91], ["Dijon", 47.32, 5.04], ["Limoges", 45.83, 1.26],
  ["Lyon", 45.76, 4.84], ["Clermont-Ferrand", 45.78, 3.08], ["Grenoble", 45.19, 5.72], ["Bordeaux", 44.84, -0.58], ["Toulouse", 43.6, 1.44],
  ["Biarritz", 43.48, -1.56], ["Montpellier", 43.61, 3.88], ["Marseille", 43.3, 5.37], ["Nice", 43.7, 7.27], ["Perpignan", 42.7, 2.9], ["Ajaccio", 41.93, 8.74]];

const cache = new Map();
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }

export async function geocode(q) {
  const k = "g:" + q.toLowerCase();
  if (cache.has(k)) return cache.get(k);
  const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&name=${encodeURIComponent(q)}`);
  const r = d.results?.[0];
  const hit = r ? { nom: r.name, lat: r.latitude, lon: r.longitude, pays: r.country_code } : null;
  cache.set(k, hit); return hit;
}

export async function zoneOutline(q) {
  const k = "z:" + q.toLowerCase();
  if (cache.has(k)) return cache.get(k);
  let out = null;
  try {
    const res = await getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=1&polygon_geojson=1&polygon_threshold=0.02&accept-language=fr&q=${encodeURIComponent(q)}`);
    const g = res?.[0]?.geojson;
    if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) {
      let polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
      polys = polys.sort((a, b) => b[0].length - a[0].length).slice(0, 12).map((p) => [p[0].filter((_, i) => i % Math.ceil(p[0].length / 400 || 1) === 0)]);
      const main = polys[0][0], lats = main.map((c) => c[1]), lons = main.map((c) => c[0]);
      out = { type: "MultiPolygon", coordinates: polys, bbox: [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)], nom: res[0].display_name.split(",")[0] };
    }
  } catch (_) { /* contour indisponible */ }
  cache.set(k, out); return out;
}

const enFrance = (p) => p.lat > 41.2 && p.lat < 51.2 && p.lon > -5.3 && p.lon < 9.7;

async function meteo({ lieu = "" }) {
  const actions = [], textes = [];
  let focus = null;
  if (lieu && !/^(la )?france$/i.test(lieu)) {
    focus = await geocode(lieu);
    if (!focus) return { texte: `Lieu introuvable : ${lieu}.`, actions };
    const q = new URLSearchParams({ latitude: focus.lat, longitude: focus.lon, timezone: "auto", forecast_days: 4,
      current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" });
    const d = await getJSON("https://api.open-meteo.com/v1/forecast?" + q);
    const c = d.current, j = d.daily;
    const info = { lieu, temp: Math.round(c.temperature_2m), ressenti: Math.round(c.apparent_temperature), humidite: c.relative_humidity_2m,
      vent: Math.round(c.wind_speed_10m), code: c.weather_code, etat: WEATHER[c.weather_code] || "?",
      jours: j.time.map((t, i) => ({ date: t, code: j.weather_code[i], etat: WEATHER[j.weather_code[i]] || "?", max: Math.round(j.temperature_2m_max[i]), min: Math.round(j.temperature_2m_min[i]), pluie: j.precipitation_probability_max?.[i] })) };
    actions.push({ type: "weather", meteo: info });
    textes.push(`Météo à ${lieu} : ${info.temp} °C (ressenti ${info.ressenti}), ${info.etat}, vent ${info.vent} km/h. Prévisions : ` +
      info.jours.slice(1).map((x) => `${x.date} ${x.etat} ${x.min}–${x.max} °C`).join(" ; ") + ".");
  }
  if (!focus || enFrance(focus)) {
    const villes = VILLES.slice();
    if (focus && !villes.some((v) => v[0].toLowerCase() === focus.nom.toLowerCase())) villes.push([focus.nom, focus.lat, focus.lon]);
    const q = new URLSearchParams({ latitude: villes.map((v) => v[1]).join(","), longitude: villes.map((v) => v[2]).join(","), timezone: "auto",
      current: "temperature_2m,weather_code,precipitation,wind_speed_10m" });
    let d = await getJSON("https://api.open-meteo.com/v1/forecast?" + q);
    if (!Array.isArray(d)) d = [d];
    const liste = villes.map((v, i) => ({ nom: v[0], lat: v[1], lon: v[2], temp: Math.round(d[i].current.temperature_2m), code: d[i].current.weather_code,
      pluie: d[i].current.precipitation, vent: Math.round(d[i].current.wind_speed_10m), etat: WEATHER[d[i].current.weather_code] || "?" }));
    actions.push({ type: "meteo_carte", titre: "Météo · France", villes: liste, zone: await zoneOutline("France"), focus: focus ? focus.nom : null, radar: true });
    const chaud = liste.reduce((a, b) => (b.temp > a.temp ? b : a)), froid = liste.reduce((a, b) => (b.temp < a.temp ? b : a));
    const pluie = liste.filter((x) => x.pluie > 0 || x.code >= 51).map((x) => x.nom);
    textes.push(`France : de ${froid.temp} °C à ${froid.nom} à ${chaud.temp} °C à ${chaud.nom} ; ${pluie.length ? "pluie à " + pluie.slice(0, 6).join(", ") : "pas de pluie notable"}. Carte et radar affichés.`);
  } else actions.push({ type: "map", titre: lieu, points: [focus], relier: false, zone: null, radar: true });
  return { texte: textes.join(" "), actions };
}

async function afficherCarte({ lieux = [], zone = "", relier = false, titre = "" }) {
  const pts = (await Promise.all(lieux.slice(0, 15).map((l) => geocode(String(l)).then((g) => g && { ...g, nom: String(l) }).catch(() => null)))).filter(Boolean);
  const z = zone ? await zoneOutline(zone) : null;
  if (!pts.length && !z) return { texte: "Aucun lieu trouvé.", actions: [] };
  return { texte: `Carte affichée (${pts.length} lieux${z ? ", zone " + z.nom : ""}).`, actions: [{ type: "map", titre: titre || zone || lieux.slice(0, 3).join(", "), points: pts, relier, zone: z }] };
}

export const OUTILS = {
  meteo,
  afficher_carte: afficherCarte,
  minuteur: async ({ secondes = 60, libelle = "Minuteur" }) => ({ texte: `Minuteur ${libelle} lancé (${secondes} s).`, actions: [{ type: "timer", secondes: Math.max(1, Math.min(86400, +secondes || 60)), libelle: String(libelle).slice(0, 40) }] }),
  afficher_panneau: async ({ titre = "Information", lignes = [] }) => ({ texte: "Panneau affiché.", actions: [{ type: "panel", titre: String(titre).slice(0, 80), lignes: (Array.isArray(lignes) ? lignes : [String(lignes)]).slice(0, 14).map((l) => String(l).slice(0, 200)) }] }),
  afficher_schema: async (a) => ({ texte: `Schéma « ${a.titre || ""} » affiché, construit en animation.`, actions: [{ type: "schema", genre_schema: a.type || "flux", titre: a.titre || "", noeuds: (a.noeuds || []).slice(0, 30).map((n, i) => (typeof n === "string" ? { id: String(i), texte: n } : { id: String(n.id ?? n.texte ?? i), texte: String(n.texte || n.id || ""), detail: n.detail || "", date: n.date || "", forme: ["rect", "pilule", "losange"].includes(n.forme) ? n.forme : "rect", groupe: (+n.groupe || 0) % 4 })), liens: (a.liens || []).slice(0, 60), genre: a.genre || "barres", donnees: (a.donnees || []).slice(0, 16), unite: a.unite || "" }] }),
  prendre_note: async ({ texte }) => ({ texte: notes.ajouter(texte), actions: [{ type: "notes" }] }),
  lire_notes: async () => { const l = notes.lignes(10); return { texte: l.length ? l.join("\n") : "Aucune note.", actions: [{ type: "notes" }] }; },
  supprimer_note: async ({ motif }) => ({ texte: notes.supprimer(motif), actions: [{ type: "notes" }] }),
  memoriser: async ({ fait }) => ({ texte: memoire.ajouter(fait), actions: [] }),
  oublier: async ({ motif }) => ({ texte: memoire.oublier(motif), actions: [] }),
  accueil: async () => ({ texte: "Écran d'accueil.", actions: [{ type: "home" }] }),
  ouvrir_url: async ({ url }) => {
    const u = /^https?:\/\//.test(url) ? url : "https://" + url;
    if (pont.connecte) return { texte: await pont.envoyer({ type: "ouvrir_url", url: u }), actions: [] };
    window.open(u, "_blank", "noopener"); return { texte: `Page ${u} ouverte dans un nouvel onglet.`, actions: [] };
  },
  ouvrir_application: async ({ nom }) => pont.connecte
    ? { texte: await pont.envoyer({ type: "ouvrir_app", nom }), actions: [] }
    : { texte: "Le pont local n'est pas connecté : impossible d'ouvrir une application sur l'ordinateur depuis le navigateur.", actions: [] },
};

// Validation légère des entrées (les entrées d'outils arrivent en flux : on vérifie avant d'exécuter).
export function valider(nom, input) {
  if (!OUTILS[nom]) return "outil inconnu";
  if (input === null || typeof input !== "object" || Array.isArray(input)) return "entrée invalide";
  const req = { minuteur: ["secondes"], prendre_note: ["texte"], memoriser: ["fait"], ouvrir_url: ["url"], ouvrir_application: ["nom"], afficher_panneau: ["titre"], afficher_schema: ["titre"] }[nom] || [];
  const manque = req.filter((k) => input[k] === undefined || input[k] === "");
  return manque.length ? "paramètre manquant : " + manque.join(", ") : null;
}
