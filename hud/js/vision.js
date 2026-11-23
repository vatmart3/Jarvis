// Vision Jarvis : caméra en fond plein écran (miroir + filtre holographique) et suivi des deux mains (MediaPipe HandLandmarker).
// Tout se fait avec les mains : pas de suivi du visage ni des yeux (la puissance de calcul va entièrement aux mains).
// MediaPipe est chargé à la première ouverture de la caméra : CDN jsdelivr puis unpkg, GPU puis CPU.
//
// Événements émis : curseur, pince, relache, rotation, deuxMains, poing (tenu), poingProgres, paume, pouce, victoire,
// presence, assis, veille, reveil, perdue.
import { OneEuro } from "./oneeuro.js";

const MP_VERSION = "0.10.14";
const CDNS = [`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`, `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}`];
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Pincement : distance pouce-index (3D) / taille de la main, avec hystérésis, confirmé sur 2 images.
const PINCH_IN = 0.28, PINCH_OUT = 0.42, PINCH_FRAMES = 2, PINCH_PRES = 0.75, INDEX_PINCE = 0.42;
// Gestes tenus (ms). Le poing est montré par un anneau qui se remplit autour du curseur.
const TENUE = { poing: 650, paume: 500, pouce: 350, victoire: 450 };
const TOLERANCE = 140;            // un geste peut « sauter » une image ou deux sans être annulé
const PERTE = 350;                // une main disparue moins de 0,35 s garde son identité (pas de saut)
const SLEEP_AFTER = 2 * 60 * 1000;

let lib = null; // module MediaPipe partagé entre ouvertures successives
async function chargerLib() {
  if (lib) return lib;
  let err;
  for (const base of CDNS) {
    try {
      const m = await import(/* webpackIgnore: true */ `${base}/vision_bundle.mjs`);
      const files = await m.FilesetResolver.forVisionTasks(`${base}/wasm`);
      lib = { m, files }; return lib;
    } catch (e) { err = e; console.warn("MediaPipe indisponible sur", base, e); }
  }
  throw err || new Error("MediaPipe introuvable");
}
async function creer(Klass, model, extra) {
  const { files } = await chargerLib();
  for (const delegate of ["GPU", "CPU"]) {
    try { return { tache: await Klass.createFromOptions(files, { baseOptions: { modelAssetPath: model, delegate }, runningMode: "VIDEO", ...extra }), delegate }; }
    catch (e) { console.warn(`MediaPipe ${delegate} indisponible`, e); }
  }
  throw new Error("MediaPipe : ni GPU ni CPU");
}

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
// angle (degrés) de flexion entre les segments a→b et b→c (0 = droit)
function flexion(a, b, c) {
  const u = [b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0)], v = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const nu = Math.hypot(...u), nv = Math.hypot(...v); if (!nu || !nv) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv)))) * 180) / Math.PI;
}
// État d'un doigt (index, majeur, annulaire, auriculaire) : « tendu », « plie » ou null (entre les deux)
const DOIGTS = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
function doigt(lm, [mcp, pip, dip, tip]) {
  const f = flexion(lm[mcp], lm[pip], lm[dip]) + flexion(lm[pip], lm[dip], lm[tip]);
  const loin = d3(lm[tip], lm[0]) / (d3(lm[pip], lm[0]) || 1e-3);
  if (f < 50 && loin > 1.12) return "tendu";
  if (f > 110 || loin < 0.95) return "plie";
  return null;
}
// Taille de la main robuste à la rotation : poignet→base du majeur, ou largeur de la paume si la main est de profil
const taille = (lm) => Math.max(d3(lm[0], lm[9]), d3(lm[5], lm[17]) * 1.25, 1e-3);

export function createVision({ onStatus = () => {} } = {}) {
  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
  let video = null, fx = null, stream = null, running = false, hands = null;
  const mains = new Map(); let prochainId = 1;
  let lastMotion = 0, present = false, absentSince = performance.now(), endormi = false, salue = false, presentDepuis = 0;

  // ---------- cadrage identique à la vidéo (object-fit: cover, miroir) ----------
  function versEcran(nx, ny) {
    const W = window.innerWidth, H = window.innerHeight, vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    const s = Math.max(W / vw, H / vh), dw = vw * s, dh = vh * s;
    return { x: W - ((W - dw) / 2 + nx * dw), y: (H - dh) / 2 + ny * dh };
  }

  // ---------- ouverture ----------
  async function ouvrir() {
    if (running) return api;
    if (!navigator.mediaDevices?.getUserMedia) { const e = new Error("getUserMedia indisponible"); e.name = "NotSupportedError"; throw e; }
    onStatus("camera", "warn", "autorisation…");
    // 60 images/s si la caméra le permet : le curseur suit la main avec moins de retard
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 }, facingMode: "user" }, audio: false });
    } catch (e) {
      if (e.name !== "OverconstrainedError") throw e;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    }
    if (!video) {
      video = Object.assign(document.createElement("video"), { id: "visionvideo", muted: true, playsInline: true, autoplay: true });
      video.setAttribute("playsinline", "");
      fx = Object.assign(document.createElement("div"), { id: "visionfx" });
      fx.innerHTML = '<div class="vx-scan"></div><div class="vx-label">VISION ACTIVE</div>';
      document.body.append(video, fx);
    }
    video.srcObject = stream;
    await video.play();
    document.body.classList.add("vision-on");
    running = true; salue = false;
    const fps = Math.round(stream.getVideoTracks()[0].getSettings?.().frameRate || 0);
    onStatus("camera", "ok", `${video.videoWidth}×${video.videoHeight}${fps ? " · " + fps + " i/s" : ""}`);
    stream.getVideoTracks()[0].addEventListener("ended", () => { onStatus("camera", "err", "caméra déconnectée"); fermer(); emit("perdue"); });
    boucleSmall();
    if (!hands) {
      onStatus("vision", "warn", "chargement du modèle des mains…");
      try {
        const h = await creer(lib?.m.HandLandmarker || (await chargerLib()).m.HandLandmarker, HAND_MODEL,
          { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
        hands = h.tache;
        onStatus("vision", "ok", `MediaPipe (${h.delegate})`);
      } catch (e) { onStatus("vision", "err", "modèles indisponibles"); onStatus("mains", "err", "—"); throw Object.assign(new Error("vision"), { name: "VisionError", cause: e }); }
    }
    onStatus("mains", "warn", "aucune main");
    boucle();
    return api;
  }

  function fermer() {
    running = false;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
    document.body.classList.remove("vision-on");
    if (video) video.srcObject = null;
    for (const h of mains.values()) { if (h.geste === "poing") emit("poingProgres", { main: h.id, p: 0 }); emit("curseur", { main: h.id, x: null, y: null }); }
    mains.clear();
    onStatus("camera", "off", "fermée"); onStatus("mains", "off", "—");
    if (hands) onStatus("vision", "off", "en pause");
  }

  // ---------- présence : différence d'images 64×48 à ~5 i/s ----------
  const small = Object.assign(document.createElement("canvas"), { width: 64, height: 48 });
  const sctx = small.getContext("2d", { willReadFrequently: true }); let prev = null;
  function boucleSmall() {
    if (!running) return;
    setTimeout(boucleSmall, 200);
    if (video.readyState < 2) return;
    sctx.drawImage(video, 0, 0, 64, 48);
    const d = sctx.getImageData(0, 0, 64, 48).data, g = new Uint8Array(3072);
    for (let i = 0; i < 3072; i++) g[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
    if (prev) { let c = 0; for (let i = 0; i < 3072; i++) if (Math.abs(g[i] - prev[i]) > 18) c++; if (c / 3072 > 0.015) lastMotion = performance.now(); }
    prev = g;
    const now = performance.now(), p = now - lastMotion < 4000 || mains.size > 0;
    if (p && !present) { present = true; presentDepuis = now; emit("presence", true); if (endormi) { endormi = false; emit("reveil"); } }
    if (!p && present) { present = false; absentSince = now; emit("presence", false); }
    if (present && !salue && now - presentDepuis > 1500) { salue = true; emit("assis"); }
    if (!present && !endormi && now - absentSince > SLEEP_AFTER) { endormi = true; emit("veille"); }
  }

  // ---------- détection, à chaque image de la caméra ----------
  let lastTs = 0;
  function boucle() {
    if (!running) return;
    const suite = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(boucle) : requestAnimationFrame(boucle));
    if (endormi || document.hidden || video.readyState < 2) { setTimeout(suite, 250); return; }
    const now = performance.now(), ts = Math.max(lastTs + 1, Math.round(now)); lastTs = ts;
    try { mainsFrame(hands.detectForVideo(video, ts), now); } catch (e) { console.warn("vision", e); }
    suite();
  }

  // Associe chaque main détectée à une main suivie, par proximité (l'étiquette gauche/droite de MediaPipe peut s'inverser)
  function associer(liste, now) {
    const libres = new Set([...mains.values()].filter((h) => now - h.vu < PERTE));
    return liste.map((lm) => {
      const c = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
      let best = null, bd = 0.25;
      for (const h of libres) { const d = Math.hypot(h.c.x - c.x, h.c.y - c.y); if (d < bd) { bd = d; best = h; } }
      if (best) libres.delete(best);
      else {
        best = { id: "main" + prochainId++, fx: new OneEuro({ minCutoff: 1.4, beta: 0.008 }), fy: new OneEuro({ minCutoff: 1.4, beta: 0.008 }),
          pince: false, cpt: 0, geste: null, depuis: 0, vuGeste: 0, fait: false, roll: null, hist: [] };
        mains.set(best.id, best);
      }
      best.c = c; best.vu = now;
      return [best, lm];
    });
  }

  function mainsFrame(res, now) {
    for (const [h, lm] of associer(res.landmarks || [], now)) {
      const s = taille(lm), ratio = d3(lm[4], lm[8]) / s;
      // Mode précision : quand les doigts se rapprochent, le curseur est plus lissé (pas de dérive au moment du clic)
      const prec = !h.pince && ratio < PINCH_PRES && d3(lm[8], lm[5]) / s > INDEX_PINCE;
      h.fx.minCutoff = h.fy.minCutoff = prec ? 0.5 : 1.4;
      // Curseur : milieu pouce/index, ramené à l'écran avec le cadrage de la vidéo, filtré One Euro
      const brut = versEcran((lm[4].x + lm[8].x) / 2, (lm[4].y + lm[8].y) / 2);
      const x = h.fx.filter(brut.x, now), y = h.fy.filter(brut.y, now);
      if (h.x !== undefined) { const dt = Math.max(1, now - h.t) / 1000; h.vx = 0.6 * ((x - h.x) / dt) + 0.4 * (h.vx || 0); h.vy = 0.6 * ((y - h.y) / dt) + 0.4 * (h.vy || 0); }
      h.x = x; h.y = y; h.t = now;
      h.hist.push({ x, y, t: now }); while (h.hist.length && now - h.hist[0].t > 200) h.hist.shift();

      // Pincement avec hystérésis. L'index doit rester avancé (bout loin de sa base) : un poing fermé n'est pas un pincement.
      const indexAvance = d3(lm[8], lm[5]) / s > INDEX_PINCE;
      const veut = indexAvance && (h.pince ? ratio < PINCH_OUT : ratio < PINCH_IN);
      h.cpt = veut !== h.pince ? h.cpt + 1 : 0;
      if (h.cpt >= PINCH_FRAMES) {
        h.pince = veut; h.cpt = 0;
        if (h.pince) {
          // le clic vise là où était le curseur juste avant que les doigts se referment (~90 ms)
          const avant = h.hist.find((p) => now - p.t <= 90) || h.hist[0] || { x, y };
          emit("pince", { main: h.id, x: avant.x, y: avant.y });
        } else emit("relache", { main: h.id, x, y, vx: h.vx || 0, vy: h.vy || 0 });
      }
      // Roulis du poignet (rotation d'un panneau tenu)
      const roll = Math.atan2(lm[9].y - lm[0].y, -(lm[9].x - lm[0].x));
      if (h.roll !== null && h.pince) { let d = roll - h.roll; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; if (Math.abs(d) > 0.012) emit("rotation", { main: h.id, delta: d }); }
      h.roll = roll;
      emit("curseur", { main: h.id, x, y, pince: h.pince, precision: prec });

      // Gestes : poing, main ouverte, pouce levé, « V » (index + majeur)
      const etats = DOIGTS.map((f) => doigt(lm, f));
      const pouceSorti = d3(lm[4], lm[9]) > s * 0.75 && d3(lm[4], lm[5]) > d3(lm[3], lm[5]);
      const pouceHaut = pouceSorti && lm[4].y < lm[3].y && lm[3].y < lm[2].y && lm[4].y < lm[6].y;
      const replies = etats.every((e) => e === "plie");
      let geste = null;
      if (!h.pince) {
        if (replies) geste = pouceHaut ? "pouce" : "poing";   // poing : pouce replié, même s'il touche l'index
        else if (ratio > PINCH_OUT && etats.every((e) => e === "tendu") && pouceSorti) geste = "paume";
        else if (ratio > PINCH_OUT && etats[0] === "tendu" && etats[1] === "tendu" && etats[2] === "plie" && etats[3] === "plie") geste = "victoire";
      }
      if (geste) h.vuGeste = now;
      if (geste !== h.geste && (geste || now - h.vuGeste > TOLERANCE)) {
        if (h.geste === "poing" && !h.fait) emit("poingProgres", { main: h.id, p: 0 });
        h.geste = geste; h.depuis = now; h.fait = false;
      }
      if (h.geste && !h.fait) {
        const p = Math.min(1, (now - h.depuis) / TENUE[h.geste]);
        if (h.geste === "poing") emit("poingProgres", { main: h.id, p });
        if (p >= 1) { h.fait = true; emit(h.geste, { main: h.id, x, y }); if (h.geste === "poing") emit("poingProgres", { main: h.id, p: 0 }); }
      }
    }
    // Mains perdues depuis plus de 0,35 s
    for (const [id, h] of mains) {
      if (now - h.vu <= PERTE) continue;
      if (h.pince) emit("relache", { main: id, x: h.x, y: h.y, vx: 0, vy: 0 });
      if (h.geste === "poing" && !h.fait) emit("poingProgres", { main: id, p: 0 });
      emit("curseur", { main: id, x: null, y: null });
      mains.delete(id);
    }
    const visibles = [...mains.values()].filter((h) => now - h.vu < 60);
    onStatus("mains", visibles.length ? "ok" : "warn", visibles.length ? `${visibles.length} main${visibles.length > 1 ? "s" : ""}` : "aucune main");
    // Deux mains : écartement (zoom)
    if (visibles.length === 2) {
      const [a, b] = visibles;
      emit("deuxMains", { d: Math.hypot(a.x - b.x, a.y - b.y), pinces: a.pince && b.pince, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });
    } else emit("deuxMains", null);
  }

  const api = {
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return api; },
    ouvrir, fermer,
    get ouverte() { return running; },
    simuler: emit, // tests : rejoue un événement (geste, curseur…) sans caméra
    _test: { mainsFrame, video: (v) => { video = v; } },
  };
  return api;
}
export const _interne = { doigt, taille, flexion, DOIGTS }; // tests
