// Menu des données (à gauche) : on attrape une tuile (pincer ou glisser à la souris) et on pose le module où l'on veut.
// Modules : météo, position GPS, radar pluie, heures du monde, système, notes, minuteur, calendrier.
// Les modules posés et leur position sont gardés d'une session à l'autre.
import { geocode, WEATHER } from "./outils-web.js";

const CLE_MODULES = "jarvis.modules", CLE_MODE = "jarvis.menu";
const lire = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
const ecrire = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const ICONES = {
  meteo: '<circle cx="10" cy="10" r="4"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4"/><path d="M13 21h9a3.5 3.5 0 0 0-1-6.9A5 5 0 0 0 12 15a3 3 0 0 0 1 6z"/>',
  gps: '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/><path d="M7 19l-1 3M12 19v3M17 19l1 3"/>',
  heure: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  systeme: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
  notes: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  minuteur: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>',
  calendrier: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
};
const MODULES = {
  meteo: { titre: "Météo", largeur: 300 },
  gps: { titre: "Position GPS", largeur: 320 },
  radar: { titre: "Radar pluie", largeur: 340 },
  heure: { titre: "Heures du monde", largeur: 280 },
  systeme: { titre: "Système", largeur: 300 },
  notes: { titre: "Notes", largeur: 300 },
  minuteur: { titre: "Minuteur", largeur: 300 },
  calendrier: { titre: "Calendrier", largeur: 290 },
};

export function createDonnees({ J, sfx, voix, cfg, deplacement, memoire, notes }) {
  const body = document.body;
  // ---------- menu ----------
  const menu = Object.assign(document.createElement("nav"), { id: "donnees" });
  menu.setAttribute("aria-label", "Données à placer");
  menu.innerHTML = `<div class="dn-titre">DONNÉES<small>pincez · glissez · posez</small></div><div class="dn-grille"></div>`;
  Object.entries(MODULES).forEach(([mod, m], i) => {
    const t = document.createElement("div");
    t.className = "tuile"; t.dataset.source = mod; t.tabIndex = 0; t.setAttribute("role", "button");
    t.setAttribute("aria-label", `Placer : ${m.titre}`);
    t.style.setProperty("--i", i);
    t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONES[mod]}</svg><span>${m.titre}</span>`;
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); placer(mod); } });
    menu.querySelector(".dn-grille").appendChild(t);
  });
  document.body.appendChild(menu);

  // mode : « auto » (avec la caméra), « on » (toujours), « off » ; force : ouverture/fermeture ponctuelle (voix, clin d'œil)
  let mode = lire(CLE_MODE, "auto"), cameraOuverte = false, force = null;
  function majMenu() {
    const montrer = force ?? (mode === "on" || (mode === "auto" && cameraOuverte));
    if (montrer === body.classList.contains("menu-on")) return;
    body.classList.toggle("menu-on", montrer);
    if (montrer) sfx.whoosh_inverse();
  }

  // ---------- modules ----------
  let liste = lire(CLE_MODULES, []);
  const sauver = () => ecrire(CLE_MODULES, liste.map(({ id, mod }) => ({ id, mod })));
  const libres = () => document.getElementById("libres");

  // Premier emplacement de la grille qui ne chevauche aucun module déjà posé (sauf « sauf »)
  function emplacementLibre(sauf = null) {
    const x0 = body.classList.contains("menu-on") ? 262 : 60, pasX = 330, pasY = 260;
    // obstacles : modules déjà posés, widgets de la colonne de gauche, horloge, panneaux ouverts
    const autres = [...document.querySelectorAll("#libres .module, #leftcol > * > *, #clock, #panels .panel")].filter((m) => m !== sauf && m.offsetParent)
      .map((m) => m.getBoundingClientRect()).filter((r) => r.width && r.height);
    const cols = Math.max(1, Math.floor((innerWidth - x0 - 200) / pasX)), lignes = Math.max(1, Math.floor((innerHeight - 220) / pasY));
    for (let k = 0; k < cols * lignes; k++) {
      const x = x0 + (k % cols) * pasX, y = 110 + Math.floor(k / cols) * pasY;
      if (!autres.some((r) => x < r.right && x + 300 > r.left && y < r.bottom && y + 220 > r.top)) return { x, y };
    }
    const n = autres.length; return { x: x0 + (n % 5) * 28, y: 110 + (n % 5) * 28 };
  }


  function creer(mod, id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), pos = null) {
    const def = MODULES[mod]; if (!def) return null;
    const el = document.createElement("section");
    el.className = "wcard module libre"; el.dataset.cle = "m:" + id; el.dataset.mod = mod;
    el.style.width = def.largeur + "px";
    const p = pos || emplacementLibre();
    el.style.left = p.x + "px"; el.style.top = p.y + "px";
    el.innerHTML = `<div class="wt">${esc(def.titre)}</div><button class="wx" data-act="module-fermer" aria-label="Retirer ${esc(def.titre)}">✕</button><div class="mc"></div>`;
    libres().appendChild(el);
    const timers = [];
    el._stop = () => { timers.forEach((t) => clearInterval(t)); el._carte?.remove(); };
    el._retirer = () => { el._stop(); liste = liste.filter((x) => x.id !== id); sauver(); };
    el._reinit = () => { const q = emplacementLibre(el); el.style.left = q.x + "px"; el.style.top = q.y + "px"; el.style.setProperty("--s", 1); el.style.setProperty("--ry", "0deg"); };
    el._apresPose = (dx, dy, x, y) => {
      if (Math.hypot(dx, dy) < 14 && el._neuf) { const q = emplacementLibre(el); el.style.left = q.x + "px"; el.style.top = q.y + "px"; deplacement.memoriser?.(el); }
      else if (!el._neuf && surMenu(x, y)) { retirer(el); return; }
      el._neuf = false;
      el._carte?.invalidateSize();
    };
    const rendu = RENDUS[mod];
    try { rendu(el.querySelector(".mc"), el, (fn, ms) => { fn(); timers.push(setInterval(fn, ms)); }); } catch (e) { console.warn("module", mod, e); }
    if (!liste.some((x) => x.id === id)) { liste.push({ id, mod }); sauver(); }
    requestAnimationFrame(() => el.classList.add("arrive"));
    return el;
  }
  function retirer(el) {
    el._retirer?.(); sfx.annulation();
    const pos = lire("jarvis.positions", {}); delete pos[el.dataset.cle]; ecrire("jarvis.positions", pos);
    el.classList.add("ejecte"); setTimeout(() => el.remove(), 400);
  }
  const surMenu = (x, y) => {
    if (!body.classList.contains("menu-on")) return false;
    const r = menu.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };
  // Placer sans glisser (clavier, clin d'œil, voix) : emplacement libre suivant
  function placer(mod) {
    const el = creer(mod); if (!el) return null;
    el._neuf = false; sfx.attrape(); deplacement.memoriser?.(el);
    return el;
  }
  // Glisser depuis le menu : le module naît sous la main et suit le curseur
  deplacement.source((tuile, x, y) => {
    const el = creer(tuile.dataset.source, undefined, { x: x - 40, y: y - 14 }); if (!el) return null;
    el._neuf = true; tuile.classList.add("pris"); setTimeout(() => tuile.classList.remove("pris"), 400);
    return el;
  });

  J.ACTS["module-fermer"] = (b) => { const m = b.closest(".module"); if (m) retirer(m); };
  J.ACTS["module-minuteur"] = (b) => {
    const s = +b.dataset.sec; sfx.confirmation();
    J.applyActions([{ type: "timer", secondes: s, libelle: s >= 60 ? `${s / 60} min` : `${s} s` }]);
    voix.say(`Minuteur de ${s >= 60 ? s / 60 + " minute" + (s >= 120 ? "s" : "") : s + " secondes"} lancé, Monsieur.`);
  };

  // ---------- position partagée (GPS) ----------
  let position = null, ecouteurs = [];
  function demanderPosition(force) {
    if (position && !force) return Promise.resolve(position);
    return new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => { position = { lat: p.coords.latitude, lon: p.coords.longitude, precision: Math.round(p.coords.accuracy) }; ecouteurs.forEach((f) => f(position)); res(position); },
        (e) => { position = position || { erreur: e.code === 1 ? "autorisation refusée" : "position indisponible" }; res(position); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    });
  }

  // ---------- rendus ----------
  const CARTE_FOND = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
  const CARTE_NOMS = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
  function miniCarte(div, el, centre, zoom) {
    if (!window.L) { div.textContent = "Carte indisponible."; return null; }
    const m = L.map(div, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: false })
      .setView(centre, zoom);
    L.tileLayer(CARTE_FOND, { maxNativeZoom: 16, maxZoom: 19 }).addTo(m);
    L.tileLayer(CARTE_NOMS, { maxNativeZoom: 16, maxZoom: 19, opacity: 0.8 }).addTo(m);
    el._carte = m; setTimeout(() => m.invalidateSize(), 300);
    return m;
  }

  const RENDUS = {
    async meteo(c, el, tous) {
      c.innerHTML = `<div class="sub">Chargement…</div>`;
      const charger = async () => {
        try {
          // ville mémorisée, sinon position GPS, sinon Paris
          let lieu = memoire.ville() ? await geocode(memoire.ville()) : null;
          if (!lieu) { const p = await demanderPosition(); lieu = p?.lat ? { nom: "Ma position", lat: p.lat, lon: p.lon } : await geocode("Paris"); }
          const q = new URLSearchParams({ latitude: lieu.lat, longitude: lieu.lon, timezone: "auto", forecast_days: 4,
            current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
            daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" });
          const d = await (await fetch("https://api.open-meteo.com/v1/forecast?" + q)).json(), m = d.current, j = d.daily;
          c.innerHTML = `<div class="sub">${esc(lieu.nom)}</div><div class="big">${Math.round(m.temperature_2m)}°</div>
            <div class="sub">${esc(WEATHER[m.weather_code] || "")} · ressenti ${Math.round(m.apparent_temperature)}°</div>
            <div class="sub" style="opacity:.6">Humidité ${m.relative_humidity_2m} % · vent ${Math.round(m.wind_speed_10m)} km/h</div>
            <div class="mj-jours">${j.time.slice(0, 4).map((t, i) => `<div><b>${new Date(t).toLocaleDateString("fr-FR", { weekday: "short" })}</b><span>${Math.round(j.temperature_2m_max[i])}° / ${Math.round(j.temperature_2m_min[i])}°</span><small>${j.precipitation_probability_max?.[i] ?? 0} %</small></div>`).join("")}</div>`;
        } catch (e) { c.innerHTML = `<div class="sub">Météo indisponible.</div>`; }
      };
      tous(charger, 10 * 60 * 1000);
    },
    gps(c, el, tous) {
      c.innerHTML = `<div class="mc-carte"></div><div class="mj-coord">Localisation…</div>`;
      const info = c.querySelector(".mj-coord"); let m = null, point = null, derniereAdresse = null;
      const maj = async (force) => {
        const p = await demanderPosition(force);
        if (!p || p.erreur) { info.innerHTML = `Position : ${esc(p?.erreur || "indisponible")}.<br><small>Autorisez la localisation pour ce site (icône à gauche de l'adresse) et, sur Mac, dans Réglages Système → Confidentialité → Service de localisation.</small>`; return; }
        if (!m) m = miniCarte(c.querySelector(".mc-carte"), el, [p.lat, p.lon], 14);
        if (m) {
          m.setView([p.lat, p.lon], 14, { animate: false });
          if (!point) point = L.circleMarker([p.lat, p.lon], { radius: 7, color: "#49c6ff", weight: 2, fillColor: "#49c6ff", fillOpacity: 0.6 }).addTo(m);
          else point.setLatLng([p.lat, p.lon]);
        }
        info.innerHTML = `<b>${p.lat.toFixed(5)}°, ${p.lon.toFixed(5)}°</b> · ± ${p.precision} m<span class="mj-adr"></span>`;
        const cle = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
        if (cle !== derniereAdresse) {
          derniereAdresse = cle;
          try {
            const d = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=fr&lat=${p.lat}&lon=${p.lon}`)).json();
            const a = d.address || {};
            el._adresse = [a.road, a.city || a.town || a.village || a.municipality].filter(Boolean).join(", ");
          } catch (_) {}
        }
        if (el._adresse) info.querySelector(".mj-adr").textContent = " — " + el._adresse;
      };
      tous(() => maj(true), 2 * 60 * 1000);
    },
    async radar(c, el, tous) {
      c.innerHTML = `<div class="mc-carte haute"></div><div class="mj-coord">Radar…</div>`;
      const m = miniCarte(c.querySelector(".mc-carte"), el, [46.6, 2.4], 5);
      const info = c.querySelector(".mj-coord"); if (!m) return;
      let couches = [], i = 0, temps = [];
      const charger = async () => {
        try {
          const d = await (await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" })).json();
          const images = (d.radar?.past || []).slice(-6);
          couches.forEach((l) => l.remove());
          couches = images.map((f) => L.tileLayer(`${d.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxNativeZoom: 7, maxZoom: 19 }).addTo(m));
          temps = images.map((f) => new Date(f.time * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
        } catch (_) { info.textContent = "Radar indisponible pour le moment."; }
      };
      await charger();
      tous(charger, 10 * 60 * 1000);
      tous(() => {
        if (!couches.length) return;
        couches.forEach((l, k) => l.setOpacity(k === i ? 0.75 : 0));
        info.textContent = `Pluie · ${temps[i]}${i === couches.length - 1 ? " (dernière image)" : ""}`;
        i = (i + 1) % couches.length;
      }, 700);
    },
    heure(c, el, tous) {
      const VILLES = [["Paris", "Europe/Paris"], ["New York", "America/New_York"], ["Tokyo", "Asia/Tokyo"], ["Dubaï", "Asia/Dubai"]];
      tous(() => {
        const n = new Date();
        c.innerHTML = `<div class="big">${n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
          <div class="sub">${n.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</div>
          <div class="mj-villes">${VILLES.map(([v, tz]) => `<div><span>${v}</span><b>${n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: tz })}</b></div>`).join("")}</div>`;
      }, 1000);
    },
    systeme(c, el, tous) {
      const barre = (nom, v, detail) => `<div class="mini"><span>${esc(nom)}</span><div class="bar"><i style="width:${Math.min(100, v)}%"></i></div><b>${Math.round(v)}%</b></div>${detail ? `<div class="mj-det">${esc(detail)}</div>` : ""}`;
      tous(async () => {
        if (cfg.mode === "local") {
          try { const d = await (await fetch("/api/widget/systeme", { cache: "no-store" })).json(); c.innerHTML = d.metriques.map((m) => barre(m.nom, m.valeur, m.detail)).join(""); return; } catch (_) {}
        }
        let h = "";
        try { const b = await navigator.getBattery?.(); if (b) h += barre("Batterie", b.level * 100, b.charging ? "en charge" : "sur batterie"); } catch (_) {}
        h += `<div class="mj-det">${navigator.hardwareConcurrency || "?"} cœurs${navigator.deviceMemory ? " · " + navigator.deviceMemory + " Go" : ""}${navigator.connection?.effectiveType ? " · réseau " + navigator.connection.effectiveType : ""}</div>`;
        c.innerHTML = h;
      }, 5000);
    },
    notes(c, el, tous) {
      tous(() => {
        const l = notes.lignes(6);
        c.innerHTML = l.length ? `<ul class="mj-notes">${l.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<div class="sub">Aucune note. Dites « Jarvis, note que… ».</div>`;
      }, 4000);
    },
    minuteur(c) {
      c.innerHTML = `<div class="mj-boutons">${[[60, "1 min"], [300, "5 min"], [600, "10 min"], [1500, "25 min"]].map(([s, l]) => `<button class="rg-opt" data-act="module-minuteur" data-sec="${s}">${l}</button>`).join("")}</div>`;
    },
    calendrier(c, el, tous) {
      tous(() => {
        const n = new Date(), y = n.getFullYear(), mo = n.getMonth(), premier = (new Date(y, mo, 1).getDay() + 6) % 7, jours = new Date(y, mo + 1, 0).getDate();
        let cases = "LMMJVSD".split("").map((j) => `<i>${j}</i>`).join("") + "<span></span>".repeat(premier);
        for (let d = 1; d <= jours; d++) cases += `<span class="${d === n.getDate() ? "auj" : ""}">${d}</span>`;
        c.innerHTML = `<div class="sub">${n.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</div><div class="mj-cal">${cases}</div>`;
      }, 60 * 1000);
    },
  };

  // ---------- restauration des modules posés ----------
  const positions = lire("jarvis.positions", {});
  for (const { id, mod } of liste) {
    const p = positions["m:" + id];
    const el = creer(mod, id, p ? { x: Math.min(p.x, innerWidth - 60), y: Math.min(p.y, innerHeight - 40) } : null);
    if (el && p?.s) el.style.setProperty("--s", p.s);
  }

  return {
    menu,
    placer,
    retirer,
    surMenu,
    camera(ouverte) { cameraOuverte = ouverte; force = null; majMenu(); },
    get mode() { return mode; },
    definirMode(m) { mode = m; force = null; ecrire(CLE_MODE, m); majMenu(); },
    ouvrir() { force = true; majMenu(); },
    fermer() { force = false; majMenu(); },
    basculer() { force = !body.classList.contains("menu-on"); majMenu(); },
    get ouvert() { return body.classList.contains("menu-on"); },
    titre: (mod) => MODULES[mod]?.titre,
  };
}
