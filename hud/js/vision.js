// Vision Jarvis : caméra en fond plein écran (miroir + filtre holographique), mains (MediaPipe HandLandmarker, 2 mains),
// visage (FaceLandmarker : regard, position de la tête, présence assise) et présence par différence d'images.
// MediaPipe est chargé à la première ouverture de la caméra : CDN jsdelivr puis unpkg, GPU puis CPU.
import { OneEuro } from "./oneeuro.js";

const MP_VERSION = "0.10.14";
const CDNS = [`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`, `https://unpkg.com/@mediapipe/tasks-vision@${MP_VERSION}`];
const HAND_MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const PINCH_IN = 0.30, PINCH_OUT = 0.45, PINCH_FRAMES = 2;  // hystérésis + 2 images consécutives
const FIST_HOLD = 900, PALM_HOLD = 500, THUMB_HOLD = 150;
const LOOK_IN = 22, LOOK_OUT = 28, SLEEP_AFTER = 2 * 60 * 1000;

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

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// indices FaceMesh : ovale du visage, contours des yeux (iris : 468-472 et 473-477)
const OVALE = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const OEIL_G = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const OEIL_D = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
// doigt tendu : bout plus loin du poignet que l'articulation intermédiaire
const tendu = (lm, tip, pip) => d2(lm[tip], lm[0]) > d2(lm[pip], lm[0]) * 1.12;

export function createVision({ onStatus = () => {} } = {}) {
  const listeners = {};
  const emit = (ev, data) => (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
  let video = null, fx = null, stream = null, running = false, hands = null, face = null;
  const mains = {};
  let lastFace = 0, faceSince = 0, regard = false, regardCand = false, regardSince = 0, assis = false;
  let lastMotion = 0, present = false, absentSince = performance.now(), endormi = false;
  const tete = [new OneEuro({ minCutoff: 0.8, beta: 0.05 }), new OneEuro({ minCutoff: 0.8, beta: 0.05 }), new OneEuro({ minCutoff: 0.5, beta: 0.02 })];

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
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false });
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
    running = true;
    onStatus("camera", "ok", `${video.videoWidth}×${video.videoHeight}`);
    stream.getVideoTracks()[0].addEventListener("ended", () => { onStatus("camera", "err", "caméra déconnectée"); fermer(); emit("perdue"); });
    boucleSmall();
    if (!hands) {
      onStatus("vision", "warn", "chargement des modèles…");
      try {
        const h = await creer(lib?.m.HandLandmarker || (await chargerLib()).m.HandLandmarker, HAND_MODEL, { numHands: 2, minHandDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
        hands = h.tache;
        onStatus("vision", "ok", `MediaPipe (${h.delegate})`);
      } catch (e) { onStatus("vision", "err", "modèles indisponibles"); onStatus("mains", "err", "—"); throw Object.assign(new Error("vision"), { name: "VisionError", cause: e }); }
      creer(lib.m.FaceLandmarker, FACE_MODEL, { numFaces: 1, outputFacialTransformationMatrixes: true, outputFaceBlendshapes: true })
        .then((f) => { face = f.tache; }).catch((e) => console.warn("Visage indisponible", e));
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
    for (const k of Object.keys(mains)) { emit("curseur", { main: k, x: null, y: null }); delete mains[k]; }
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
    const now = performance.now(), p = now - lastMotion < 4000 || now - lastFace < 4000;
    if (p && !present) { present = true; emit("presence", true); if (endormi) { endormi = false; emit("reveil"); } }
    if (!p && present) { present = false; absentSince = now; emit("presence", false); }
    if (!present && !endormi && now - absentSince > SLEEP_AFTER) { endormi = true; emit("veille"); }
  }

  // ---------- détection ----------
  let n = 0, lastTs = 0;
  function boucle() {
    if (!running) return;
    const suite = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(boucle) : requestAnimationFrame(boucle));
    if (endormi || document.hidden || video.readyState < 2) { setTimeout(suite, 250); return; }
    const now = performance.now(), ts = Math.max(lastTs + 1, Math.round(now)); lastTs = ts; n++;
    try {
      mainsFrame(hands.detectForVideo(video, ts), now);
      if (face && n % 2 === 0) visageFrame(face.detectForVideo(video, ts), now);
    } catch (e) { console.warn("vision", e); }
    suite();
  }

  function mainsFrame(res, now) {
    const vues = new Set();
    (res.landmarks || []).forEach((lm, i) => {
      const cle = res.handednesses?.[i]?.[0]?.categoryName || res.handedness?.[i]?.[0]?.categoryName || `main${i}`;
      vues.add(cle);
      const h = (mains[cle] ||= { fx: new OneEuro({ minCutoff: 1.3, beta: 0.006 }), fy: new OneEuro({ minCutoff: 1.3, beta: 0.006 }), pince: false, cpt: 0, geste: null, depuis: 0, fait: false, roll: null });
      h.vu = now;
      // curseur : milieu pouce / index, ramené à l'écran avec le cadrage de la vidéo, filtré One Euro
      const brut = versEcran((lm[4].x + lm[8].x) / 2, (lm[4].y + lm[8].y) / 2);
      const x = h.fx.filter(brut.x, now), y = h.fy.filter(brut.y, now);
      if (h.x !== undefined) { const dt = Math.max(1, now - h.t) / 1000; h.vx = 0.6 * ((x - h.x) / dt) + 0.4 * (h.vx || 0); h.vy = 0.6 * ((y - h.y) / dt) + 0.4 * (h.vy || 0); }
      h.x = x; h.y = y; h.t = now;
      // pincement : distance pouce-index / taille de la main, hystérésis 0,30 / 0,45 confirmée sur 2 images
      const ratio = d2(lm[4], lm[8]) / (d2(lm[0], lm[9]) || 0.1);
      const veut = h.pince ? ratio < PINCH_OUT : ratio < PINCH_IN;
      h.cpt = veut !== h.pince ? h.cpt + 1 : 0;
      if (h.cpt >= PINCH_FRAMES) { h.pince = veut; h.cpt = 0; emit(h.pince ? "pince" : "relache", { main: cle, x, y, vx: h.vx || 0, vy: h.vy || 0 }); }
      // roulis du poignet (rotation d'un panneau tenu)
      const roll = Math.atan2(lm[9].y - lm[0].y, -(lm[9].x - lm[0].x));
      if (h.roll !== null && h.pince) { let d = roll - h.roll; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; if (Math.abs(d) > 0.012) emit("rotation", { main: cle, delta: d }); }
      h.roll = roll;
      emit("curseur", { main: cle, x, y, pince: h.pince });
      // gestes : poing (tenu 0,9 s), main ouverte (0,5 s), pouce levé
      const doigts = [[8, 6], [12, 10], [16, 14], [20, 18]].map(([t, p]) => tendu(lm, t, p));
      const pouceHaut = lm[4].y < lm[3].y && lm[3].y < lm[2].y && d2(lm[4], lm[5]) > d2(lm[0], lm[5]) * 0.55;
      const geste = h.pince ? null : doigts.every((v) => !v) ? (pouceHaut ? "pouce" : "poing") : doigts.every(Boolean) ? "paume" : null;
      if (geste !== h.geste) { h.geste = geste; h.depuis = now; h.fait = false; }
      const tenue = { poing: FIST_HOLD, paume: PALM_HOLD, pouce: THUMB_HOLD }[geste];
      if (geste && !h.fait && now - h.depuis >= tenue) { h.fait = true; emit(geste, { main: cle, x, y }); }
    });
    for (const [k, h] of Object.entries(mains)) {
      if (!vues.has(k) && now - h.vu > 300) {
        if (h.pince) emit("relache", { main: k, x: h.x, y: h.y, vx: 0, vy: 0 });
        emit("curseur", { main: k, x: null, y: null });
        delete mains[k];
      }
    }
    const liste = Object.values(mains);
    onStatus("mains", liste.length ? "ok" : "warn", liste.length ? `${liste.length} main${liste.length > 1 ? "s" : ""}` : "aucune main");
    // deux mains : écartement (zoom)
    if (liste.length === 2) emit("deuxMains", { d: Math.hypot(liste[0].x - liste[1].x, liste[0].y - liste[1].y), pinces: liste[0].pince && liste[1].pince,
      cx: (liste[0].x + liste[1].x) / 2, cy: (liste[0].y + liste[1].y) / 2 });
    else emit("deuxMains", null);
  }

  function visageFrame(res, now) {
    const lm = res.faceLandmarks?.[0];
    if (!lm) {
      if (faceSince && now - lastFace > 1500) { faceSince = 0; emit("visage", null); }
      if (now - lastFace > 30000) assis = false;
      majRegard(false, now);
      return;
    }
    lastFace = now; if (!faceSince) faceSince = now;
    const m = res.facialTransformationMatrixes?.[0]?.data;
    let yaw = 0, pitch = 0;
    if (m) { yaw = (Math.atan2(m[8], m[10]) * 180) / Math.PI; pitch = (Math.atan2(-m[9], Math.hypot(m[8], m[10])) * 180) / Math.PI; }
    const pire = Math.max(Math.abs(yaw), Math.abs(pitch + 8));
    majRegard(regard ? pire < LOOK_OUT : pire < LOOK_IN, now);
    // contours du visage et des yeux, iris, clignements : pour l'affichage du suivi à l'écran
    const bs = Object.fromEntries((res.faceBlendshapes?.[0]?.categories || []).map((c) => [c.categoryName, c.score]));
    const pt = (i) => versEcran(lm[i].x, lm[i].y);
    emit("visagePoints", {
      ovale: OVALE.map(pt), oeilG: OEIL_G.map(pt), oeilD: OEIL_D.map(pt),
      irisG: lm[468] ? [pt(468), pt(469), pt(471)] : null, irisD: lm[473] ? [pt(473), pt(474), pt(476)] : null,
      clignG: bs.eyeBlinkLeft || 0, clignD: bs.eyeBlinkRight || 0, sourire: ((bs.mouthSmileLeft || 0) + (bs.mouthSmileRight || 0)) / 2,
      yaw, pitch, regard,
    });
    const l = lm[33], r = lm[263];
    emit("tete", { x: tete[0].filter((1 - (l.x + r.x) / 2 - 0.5) * 2, now), y: tete[1].filter(-((l.y + r.y) / 2 - 0.45) * 2, now),
      distance: tete[2].filter(0.11 / Math.max(0.03, d2(l, r)), now), yaw, pitch });
    if (!assis && now - faceSince > 1500) { assis = true; emit("assis"); }
  }
  function majRegard(v, now) {
    if (v !== regardCand) { regardCand = v; regardSince = now; }
    if (regardCand !== regard && now - regardSince >= 150) { regard = regardCand; emit("regard", regard); }
  }

  const api = {
    on(ev, fn) { (listeners[ev] ||= []).push(fn); return api; },
    ouvrir, fermer,
    get ouverte() { return running; },
    get regarde() { return regard; },
    get visage() { return !!face && running; },
    simuler: emit, // tests : rejoue un événement (geste, curseur…) sans caméra
  };
  return api;
}
