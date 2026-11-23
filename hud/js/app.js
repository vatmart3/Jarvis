// Jarvis — orchestration des modules : voix en flux, cerveau (local ou en ligne), scène 3D, vision, gestes,
// salutation, briefing du matin, mémoire, diagnostic. Le cœur (index.html) reste fonctionnel sans ce module.
import { sfx, setEnabled as setSfx, audioContext } from "./sfx.js";
import { createVoice, startPorcupine } from "./voix.js";
import { memoire, notes } from "./memoire.js";
import { createCloudBrain } from "./llm.js";
import { OUTILS } from "./outils-web.js";
import { pont } from "./pont.js";
import { createDiag } from "./diag.js";

const J = window.JARVIS, ext = window.JARVIS_EXT;
if (!J) throw new Error("Cœur Jarvis absent");
const $ = J.$, body = document.body;
setSfx(() => J.voiceOn);

// ---------- configuration (local : serveur Python ; en ligne : fonctions Vercel) ----------
const diag = createDiag();
let cfg = null;
try { const r = await fetch("/api/config", { cache: "no-store" }); if (r.ok) cfg = await r.json(); } catch (_) { /* hors ligne */ }
cfg = cfg || { mode: "statique", llm: false };
ext.mode = cfg.mode;
const codeAcces = () => { try { return localStorage.getItem("jarvis.code") || ""; } catch (_) { return ""; } };
if (cfg.mode === "cloud" && cfg.codeRequis && !codeAcces()) {
  const c = window.prompt("Code d'accès Jarvis (défini dans Vercel : JARVIS_ACCESS_CODE)");
  if (c) try { localStorage.setItem("jarvis.code", c.trim()); } catch (_) {}
}

// ---------- voix en flux ----------
const choixVoix = () => {
  const c = J.currentChoice();
  const explicite = J.store.get("jarvis.voice");
  if (cfg.elevenlabs && (!explicite || explicite.engine === "elevenlabs")) return { engine: "elevenlabs", voice: "" };
  if (cfg.mode !== "local" && c.engine !== "browser") return { engine: "browser", voice: "" }; // say/Kokoro : serveur local uniquement
  return c;
};
const voix = createVoice({
  getChoice: choixVoix,
  endpoints: { elevenlabs: "/api/voix", local: "/api/tts", headers: () => ({ "Content-Type": "application/json", "X-Jarvis": "1", "x-jarvis-code": codeAcces() }) },
  onState: (parle) => { if (parle) J.setState("speaking"); else if (body.classList.contains("speaking")) J.setState(null); },
  onError: (e) => console.warn("voix", e),
});
ext.speak = (texte) => voix.say(texte);
ext.stop = () => voix.stop();
ext.isSpeaking = () => voix.speaking;
// Écho : ce que le micro entend ressemble à ce que Jarvis dit → ce n'est pas l'utilisateur.
const mots = (t) => new Set(String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) || []);
ext.isEcho = (entendu) => {
  const a = mots(entendu), b = mots(voix.currentText);
  if (!a.size || !b.size) return false;
  let c = 0; a.forEach((w) => b.has(w) && c++);
  return c / a.size > 0.5;
};
ext.bargeIn = () => { if (voix.speaking) { voix.stop(); sfx.fin_ecoute(); } };

// ---------- cerveau ----------
let parole = { active: false, recu: false };
const cloud = createCloudBrain({
  code: codeAcces,
  onDelta: (d) => { parole.recu = true; voix.feed(d); },
  onTool: (nom) => J.activity({ web_search: "Recherche sur le web…", meteo: "Météo…", afficher_schema: "Construction du schéma…" }[nom] || "Action en cours…"),
  onActions: (a) => J.applyActions(a),
  contexte: () => `${new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}${memoire.ville() ? " ; ville : " + memoire.ville() : ""}`,
});
const ACCUSES = ["Bien, Monsieur.", "Je m'en occupe.", "Un instant, Monsieur.", "Tout de suite.", "Voyons cela."];
ext.ask = async (texte) => {
  parole = { active: true, recu: false };
  // Accusé de réception immédiat si la réponse tarde : la latence perçue reste sous la seconde.
  const accuse = setTimeout(() => { if (!parole.recu && !voix.speaking) voix.say(ACCUSES[Math.floor(Math.random() * ACCUSES.length)]); }, 700);
  try {
    if (cfg.mode === "cloud") {
      if (!cfg.llm) throw new Error("Le cerveau en ligne n'est pas configuré (ANTHROPIC_API_KEY).");
      const r = await cloud.ask(texte);
      voix.end();
      return { reply: r.reply, actions: [], pending: null, streamed: parole.recu };
    }
    const r = await J.api("/api/ask", { text: texte });
    if (r.streamed || parole.recu) { voix.end(); r.streamed = true; }
    return r;
  } finally { clearTimeout(accuse); parole.active = false; }
};
ext.event = (e) => {
  if (e.type === "parole") { if (parole.active) { parole.recu = true; voix.feed(e.texte); } return true; }
  if (e.type === "memoire_sync") { (e.genre === "notes" ? notes : memoire).remplacer(e.liste); if (e.genre === "notes") afficherNotes(false); return true; }
  return false;
};
ext.action = (a) => {
  if (a.type === "notes") { afficherNotes(true); return true; }
  return false;
};
function afficherNotes(montrer) {
  const ouvert = document.querySelector('#panels .panel[data-notes]');
  if (!montrer && !ouvert) return;
  ouvert?.remove();
  const lignes = notes.lignes(8);
  J.applyActions([{ type: "panel", titre: "Notes", lignes: lignes.length ? lignes : ["Aucune note pour le moment."] }]);
  const p = document.querySelector("#panels .panel"); if (p) p.dataset.notes = "1";
}
// Synchronisation mémoire/notes avec le serveur local (le navigateur garde une copie)
if (cfg.mode === "local") {
  J.api("/api/memoire/sync", { faits: memoire.faits(), notes: notes.toutes() })
    .then((d) => { memoire.remplacer(d.faits); notes.remplacer(d.notes); }).catch(() => {});
}
diag.set("ia", cfg.mode === "local" ? "ok" : cfg.llm ? "ok" : "err",
  cfg.mode === "local" ? "serveur local" : cfg.llm ? "Claude (proxy en ligne)" : cfg.mode === "cloud" ? "clé API manquante" : "aucun serveur");
if (cfg.mode === "cloud") {
  $("srv").textContent = cfg.llm ? "Système en ligne" : "Cerveau non configuré";
  $("srvdot").className = "dot " + (cfg.llm ? "on" : "err");
  $("model").textContent = "Claude";
}

// ---------- scène 3D ----------
let holo = null;
try {
  const { supportsWebGL, createHolo } = await import("./holo.js");
  if (supportsWebGL()) {
    holo = createHolo({ orbElement: $("orb") });
    holo.setLevelSource(() => voix.level());
    ext.onState = (s) => holo.setState(s);
  }
} catch (e) { console.warn("3D indisponible, interface 2D conservée", e); }

// ---------- micro et mot d'éveil ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) diag.set("micro", "err", "reconnaissance vocale absente (Chrome ou Safari)");
else if (!diag.contexteOk) diag.set("micro", "err", "contexte non sécurisé");
else {
  diag.set("micro", "warn", "en attente");
  navigator.permissions?.query({ name: "microphone" }).then((p) => {
    const maj = () => diag.set("micro", p.state === "granted" ? "ok" : p.state === "denied" ? "err" : "warn", { granted: "écoute « Jarvis »", denied: "refusé", prompt: "autorisation à donner" }[p.state]);
    maj(); p.onchange = maj;
  }).catch(() => {});
}
async function motEveil() {
  if (cfg.picovoice) {
    try {
      await startPorcupine(cfg.picovoice, () => { if (!ext.canListen || ext.canListen()) { sfx.ecoute(); voix.stop(); J.startRec(); } });
      diag.set("micro", "ok", "mot d'éveil Porcupine");
      return;
    } catch (e) { console.warn("Porcupine indisponible, repli sur la reconnaissance continue", e); }
  }
  if (SR && diag.contexteOk) J.setHandsFree(true); // reconnaissance continue qui filtre « Jarvis »
}
motEveil();

// ---------- vision (ouverte à la voix : « ouvre la caméra », « active la vision », « ferme la caméra ») ----------
let vision = null;
ext.canListen = () => !vision || !vision.ouverte || !vision.visage || vision.regarde;
const norm = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9' ]+/g, " ").trim();
const RX_FERMER = /\b(ferme|fermer|eteins|eteindre|coupe|couper|desactive|desactiver|arrete|arreter|stop)\b.*\b(camera|webcam|vision)\b/;
const RX_OUVRIR = /\b(ouvre|ouvrir|allume|allumer|active|activer|lance|lancer|demarre|demarrer)\b.*\b(camera|webcam|vision)\b/;
// Interception AVANT l'appel à l'IA
ext.intercept = (texte) => {
  const t = norm(texte);
  if (/\b(connecte|connecter|appaire|appairer|relie|relier)\b.*\bpont\b/.test(t)) {
    const c = window.prompt("Code d'appairage affiché par le pont local (node pont-local/pont.mjs) :");
    if (c) { pont.definirCode(c.trim()); voix.say("Je me connecte au pont local, Monsieur."); }
    return true;
  }
  if (RX_FERMER.test(t)) { fermerCamera(true); return true; }
  if (RX_OUVRIR.test(t)) { ouvrirCamera(true); return true; }
  return false;
};
const ERREURS_CAMERA = {
  NotAllowedError: ["refusée", "Je n'ai pas accès à la caméra, Monsieur : l'autorisation a été refusée. Vous pouvez la rétablir depuis l'icône à gauche de l'adresse."],
  SecurityError: ["refusée", "La caméra est bloquée dans ce contexte, Monsieur. Il faut ouvrir Jarvis en https ou sur localhost."],
  NotFoundError: ["introuvable", "Je ne trouve aucune caméra branchée sur cet ordinateur, Monsieur."],
  OverconstrainedError: ["introuvable", "Aucune caméra compatible n'a été trouvée, Monsieur."],
  NotReadableError: ["déjà utilisée", "La caméra est déjà utilisée par une autre application, Monsieur. Fermez-la puis redemandez-moi."],
  AbortError: ["déjà utilisée", "La caméra n'a pas pu démarrer, Monsieur : elle est peut-être utilisée ailleurs."],
  NotSupportedError: ["non prise en charge", "Ce navigateur ne permet pas d'utiliser la caméra, Monsieur."],
  VisionError: ["modèles indisponibles", "La caméra fonctionne, mais je n'ai pas pu charger la vision des mains, Monsieur. Vérifiez la connexion internet."],
};
async function ouvrirCamera(parler) {
  if (!diag.contexteOk) { const m = ERREURS_CAMERA.SecurityError; diag.set("camera", "err", m[0]); diag.banner(m[1], "Caméra indisponible."); if (parler) voix.say(m[1]); return; }
  if (vision?.ouverte) { if (parler) voix.say("La vision est déjà active, Monsieur."); return; }
  try {
    if (!vision) { const { createVision } = await import("./vision.js"); vision = createVision({ onStatus: (k, n, t) => diag.set(k, n, t) }); brancherVision(); }
    if (parler) voix.say("J'active la vision, Monsieur.");
    await vision.ouvrir();
    sfx.reveil(); diag.boutonCamera(false);
  } catch (e) {
    const [court, phrase] = ERREURS_CAMERA[e.name] || ["erreur", "La caméra n'a pas pu démarrer, Monsieur."];
    if (e.name !== "VisionError") { vision?.fermer(); diag.set("camera", "err", court); diag.set("vision", "off", "mode sans caméra"); }
    diag.banner(phrase, "Caméra : " + court + ".");
    sfx.erreur(); voix.stop(); voix.say(phrase);
    diag.boutonCamera(true);
  }
}
function fermerCamera(parler) {
  if (!vision?.ouverte) { if (parler) voix.say("La caméra est déjà fermée, Monsieur."); return; }
  vision.fermer(); sfx.veille(); holo?.resetEye(); body.classList.remove("veille", "regard");
  if (parler) voix.say("Caméra fermée, Monsieur.");
}
diag.onCamera(() => (vision?.ouverte ? fermerCamera(false) : ouvrirCamera(false)));

// ---------- gestes sur MES panneaux (.panel) et boutons [data-act] ----------
const curseurs = {}, prises = {};
let vise = null, zoomRef = null, mapDrag = null, zoomAcc = 0, zTop = 10;
function curseur(main) {
  return (curseurs[main] ||= Object.assign(document.body.appendChild(document.createElement("div")), { className: "hand-cursor" }));
}
function sous(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.classList.contains("hand-cursor")) continue;
    const a = el.closest("[data-act]"), p = el.closest("#panels .panel");
    if (a || p) return { act: a, panel: p };
  }
  return {};
}
const echelle = (p) => parseFloat(getComputedStyle(p).getPropertyValue("--s")) || 1;
function ejecter(p, vx, vy) {
  const n = Math.hypot(vx, vy) || 1, dist = Math.max(window.innerWidth, window.innerHeight) * 1.2;
  p.classList.remove("drag"); p.classList.add("ejecte");
  p.style.setProperty("--tx", `${(vx / n) * dist}px`); p.style.setProperty("--ty", `${(vy / n) * dist}px`);
  sfx.whoosh(); setTimeout(() => { p.remove(); J.layoutPanels(); }, 560);
}
function brancherVision() {
  vision.on("tete", (t) => {
    holo?.setEye(t.x, t.y, t.distance);
    $("panels").style.perspectiveOrigin = `${50 - t.x * 35}% ${50 + t.y * 35}%`; // parallaxe des panneaux
  });
  vision.on("visage", (v) => { if (!v) { holo?.resetEye(); $("panels").style.perspectiveOrigin = ""; } });
  vision.on("regard", (r) => body.classList.toggle("regard", r));
  vision.on("veille", () => { body.classList.add("veille"); holo?.setDim(1); sfx.veille(); J.setHandsFree(false); });
  vision.on("reveil", () => { body.classList.remove("veille"); holo?.setDim(0); sfx.reveil(); motEveil(); });
  vision.on("assis", () => saluer());
  vision.on("perdue", () => { diag.banner("La caméra s'est déconnectée.", "Caméra perdue."); voix.say("J'ai perdu la caméra, Monsieur."); });
  vision.on("curseur", (c) => {
    const el = curseur(c.main);
    if (c.x === null) { el.classList.remove("on"); return; }
    el.classList.add("on"); el.classList.toggle("pince", !!c.pince);
    el.style.transform = `translate(${c.x}px, ${c.y}px)`;
    const prise = prises[c.main];
    if (prise?.panel) {
      prise.panel.style.left = `${c.x - prise.dx}px`; prise.panel.style.top = `${c.y - prise.dy}px`;
    } else if (prise?.map && J.map) {
      J.map.panBy([prise.map.x - c.x, prise.map.y - c.y], { animate: false }); prise.map = { x: c.x, y: c.y };
    } else if (!c.pince) {
      const { act, panel } = sous(c.x, c.y), cible = act || panel || null;
      if (cible !== vise) { vise?.classList.remove("vise"); vise = cible; vise?.classList.add("vise"); if (act) sfx.tick(); }
    }
  });
  vision.on("pince", (c) => {
    const { act, panel } = sous(c.x, c.y);
    if (act) { sfx.bip(); J.act(act); return; }                     // pincer = clic sur [data-act]
    if (panel) {                                                     // pincer = saisir le panneau
      const r = panel.getBoundingClientRect();
      panel.classList.add("drag", "place"); panel.style.zIndex = ++zTop;
      prises[c.main] = { panel, dx: c.x - parseFloat(panel.style.left || r.left), dy: c.y - parseFloat(panel.style.top || r.top) };
      sfx.attrape(); J.layoutPanels(); return;
    }
    if (body.classList.contains("map-on")) prises[c.main] = { map: { x: c.x, y: c.y } };
  });
  vision.on("relache", (c) => {
    const prise = prises[c.main]; delete prises[c.main];
    if (!prise?.panel) return;
    const v = Math.hypot(c.vx, c.vy);
    if (v > 1400) ejecter(prise.panel, c.vx, c.vy);                // lâcher vite = éjecter
    else { prise.panel.classList.remove("drag"); sfx.lache(); }      // glisser = déplacer
  });
  vision.on("rotation", (r) => {
    const p = Object.values(prises).find((x) => x.panel)?.panel;
    if (p) { const ry = parseFloat(p.style.getPropertyValue("--ry")) || -7; p.style.setProperty("--ry", `${Math.max(-55, Math.min(55, ry - r.delta * 60))}deg`); }
    else holo?.spin(-r.delta);
  });
  vision.on("deuxMains", (m) => {                                    // deux mains = zoom (--s entre 0,6 et 1,9)
    if (!m || !m.pinces) { zoomRef = null; return; }
    const cible = Object.values(prises).find((x) => x.panel)?.panel || sous(m.cx, m.cy).panel;
    if (cible) {
      if (!zoomRef || zoomRef.el !== cible) zoomRef = { el: cible, d: m.d, s: echelle(cible) };
      cible.style.setProperty("--s", Math.max(0.6, Math.min(1.9, zoomRef.s * (m.d / zoomRef.d))).toFixed(3));
    } else if (body.classList.contains("map-on") && J.map) {
      if (zoomRef?.d) { zoomAcc += Math.log2(m.d / zoomRef.d) * 1.5; if (Math.abs(zoomAcc) > 0.15) { J.map.setZoom(J.map.getZoom() + zoomAcc, { animate: false }); zoomAcc = 0; } }
      zoomRef = { el: null, d: m.d };
    }
  });
  vision.on("poing", (c) => {                                        // poing tenu 0,9 s = fermer le panneau
    if (J.pending) { sfx.annulation(); J.decide(false); return; }
    const p = sous(c.x, c.y).panel || Object.values(prises).find((x) => x.panel)?.panel || document.querySelector("#panels .panel");
    if (p) { sfx.annulation(); J.closeCard(p); }
  });
  vision.on("pouce", () => { sfx.confirmation(); if (J.pending) J.decide(true); });
  vision.on("paume", () => { if (voix.speaking) { voix.stop(); sfx.fin_ecoute(); } });
}
diag.set("camera", "off", "dites « ouvre la caméra »"); diag.set("vision", "off", "non chargée"); diag.set("mains", "off", "—");
diag.boutonCamera(true);

// ---------- salutation et briefing du matin ----------
const aujourdhui = () => new Date().toISOString().slice(0, 10);
let derniereSalutation = 0;
async function saluer() {
  if (Date.now() - derniereSalutation < 10 * 60 * 1000 || J.busy) return;
  derniereSalutation = Date.now();
  sfx.reveil();
  const h = new Date().getHours();
  const salut = h < 5 ? "Bonsoir, Monsieur. Vous travaillez tard." : h < 12 ? "Bonjour, Monsieur." : h < 18 ? "Bon après-midi, Monsieur." : "Bonsoir, Monsieur.";
  let premiere = false;
  try { premiere = localStorage.getItem("jarvis.briefing") !== aujourdhui(); localStorage.setItem("jarvis.briefing", aujourdhui()); } catch (_) {}
  if (premiere && h >= 5 && h < 14) return briefing(salut);
  voix.say(`${salut} Que puis-je pour vous ?`);
}
async function briefing(salut) {
  const n = new Date(), ville = memoire.ville() || "Paris";
  const date = n.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  voix.say(`${salut} Nous sommes ${date}, il est ${n.getHours()} heures ${String(n.getMinutes()).padStart(2, "0")}.`);
  try {
    let meteo = null;
    if (cfg.mode === "local") {
      const r = await J.api("/api/ask", { text: `météo à ${ville}` });
      J.applyActions(r.actions); meteo = r.actions?.find((a) => a.type === "weather")?.meteo;
    } else {
      const r = await OUTILS.meteo({ lieu: ville });
      J.applyActions(r.actions); meteo = r.actions.find((a) => a.type === "weather")?.meteo;
    }
    if (meteo) voix.say(`À ${ville}, ${meteo.temp} degrés, ${meteo.etat}. Aujourd'hui, entre ${meteo.jours[0].min} et ${meteo.jours[0].max}.`);
  } catch (_) { /* météo indisponible */ }
  const nb = notes.toutes().length;
  if (nb) { afficherNotes(true); voix.say(`Vous avez ${nb} note${nb > 1 ? "s" : ""} en attente.`); }
  voix.say("Souhaitez-vous les actualités du jour ?");
}
// Sans caméra, un clic ou une touche au démarrage vaut « présence » pour la salutation.
const premierGeste = () => { audioContext(); if (!vision) setTimeout(saluer, 400); window.removeEventListener("pointerdown", premierGeste); window.removeEventListener("keydown", premierGeste); };
window.addEventListener("pointerdown", premierGeste); window.addEventListener("keydown", premierGeste);

// ---------- pont local (ouverture d'apps depuis la version en ligne) ----------
if (cfg.mode !== "local") pont.demarrer((ok, msg) => { if (ok) J.toast?.("Pont local connecté : Jarvis peut ouvrir vos applications."); else if (msg) console.info("pont local :", msg); });

window.JARVIS_APP = { voix, vision: () => vision, holo: () => holo, diag, cfg, ouvrirCamera, fermerCamera };
