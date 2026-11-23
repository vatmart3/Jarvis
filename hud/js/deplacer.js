// Tout est déplaçable : panneaux, widgets, minuteurs, horloge — à la main (pincer) ou à la souris (glisser le titre).
// Le mouvement passe par transform (accéléré par la carte graphique) ; les positions des widgets et de l'horloge sont gardées.
const MOBILES = "#panels .panel, .wcard, #timers .timer, #clock";
const POIGNEES = "#panels .panel h4, .wcard .wt, #timers .timer, #clock, .tuile[data-source]";
const SOURCES = ".tuile[data-source]"; // tuiles du menu des données : attraper = créer un module
const CLE_POS = "jarvis.positions";
const lire = () => { try { return JSON.parse(localStorage.getItem(CLE_POS)) || {}; } catch (_) { return {}; } };
const ecrire = (v) => { try { localStorage.setItem(CLE_POS, JSON.stringify(v)); } catch (_) {} };

export function createDeplacement({ J, sfx }) {
  const libres = Object.assign(document.createElement("div"), { id: "libres" });
  document.body.appendChild(libres);
  let prise = null, zTop = 20, fabrique = null;

  const cle = (el) => el.dataset.cle || (el.id === "clock" ? "horloge" : null);
  const echelle = (el) => parseFloat(el.style.getPropertyValue("--s")) || 1;

  // Sortir un élément de sa colonne pour le poser librement à l'écran
  function liberer(el) {
    if (el.closest("#panels") || el.parentElement === libres) return el;
    const r = el.getBoundingClientRect();
    el.style.width = r.width + "px";
    el.style.left = r.left + "px"; el.style.top = r.top + "px";
    el.classList.add("libre");
    libres.appendChild(el);
    return el;
  }

  function prendre(el, x, y) {
    if (!el) return false;
    if (el.matches?.(SOURCES)) { el = fabrique?.(el, x, y); if (!el) return false; }
    liberer(el);
    const r = el.getBoundingClientRect();
    el.classList.add("drag", "place"); el.style.zIndex = ++zTop;
    prise = { el, x0: x, y0: y, left: parseFloat(el.style.left) || r.left, top: parseFloat(el.style.top) || r.top, vx: 0, vy: 0, t: performance.now(), x, y };
    sfx.attrape();
    if (el.closest("#panels")) J.layoutPanels();
    return true;
  }
  function bouger(x, y) {
    if (!prise) return;
    const now = performance.now(), dt = Math.max(1, now - prise.t) / 1000;
    prise.vx = 0.6 * ((x - prise.x) / dt) + 0.4 * prise.vx; prise.vy = 0.6 * ((y - prise.y) / dt) + 0.4 * prise.vy;
    prise.x = x; prise.y = y; prise.t = now;
    prise.el.style.setProperty("--tx", `${x - prise.x0}px`); prise.el.style.setProperty("--ty", `${y - prise.y0}px`);
  }
  function lacher(vx = prise?.vx || 0, vy = prise?.vy || 0) {
    if (!prise) return null;
    const { el } = prise, dx = prise.x - prise.x0, dy = prise.y - prise.y0, prise_x = prise.x, prise_y = prise.y;
    prise = null;
    el.classList.remove("drag");
    if (Math.hypot(vx, vy) > 1400 && el.id !== "clock") { ejecter(el, vx, vy); return "ejecte"; }
    // on fige la position : left/top définitifs, translation remise à zéro
    el.style.left = `${(parseFloat(el.style.left) || 0) + dx}px`; el.style.top = `${(parseFloat(el.style.top) || 0) + dy}px`;
    el.style.setProperty("--tx", "0px"); el.style.setProperty("--ty", "0px");
    memoriser(el); sfx.lache();
    el._apresPose?.(dx, dy, prise_x, prise_y);
    return "pose";
  }
  function ejecter(el, vx, vy) {
    const n = Math.hypot(vx, vy) || 1, d = Math.max(innerWidth, innerHeight) * 1.2;
    el.classList.add("ejecte");
    el.style.setProperty("--tx", `${(vx / n) * d}px`); el.style.setProperty("--ty", `${(vy / n) * d}px`);
    sfx.whoosh();
    setTimeout(() => {
      const x = el.querySelector("[data-act='fermer'], [data-act='widget-retirer']");
      const k = cle(el); if (k) { const p = lire(); delete p[k]; ecrire(p); }
      el._retirer?.();
      if (x && el.classList.contains("wcard")) x.click(); // retirer le widget pour de bon
      el.remove(); J.layoutPanels();
    }, 560);
  }
  function zoomer(el, s) {
    el.style.setProperty("--s", Math.max(0.6, Math.min(1.9, s)).toFixed(3));
    memoriser(el);
  }
  function tourner(el, delta) {
    const ry = parseFloat(el.style.getPropertyValue("--ry")) || (el.closest("#panels") ? -7 : 0);
    el.style.setProperty("--ry", `${Math.max(-55, Math.min(55, ry - delta * 60))}deg`);
  }
  function memoriser(el) {
    const k = cle(el); if (!k) return;
    const p = lire(); p[k] = { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, s: echelle(el), w: el.style.width };
    ecrire(p);
  }
  // Replace les widgets et l'horloge là où on les avait laissés (après chaque affichage des widgets)
  function restaurer() {
    const p = lire();
    for (const [k, pos] of Object.entries(p)) {
      const el = k === "horloge" ? document.getElementById("clock") : document.querySelector(`#widgets [data-cle="${CSS.escape(k)}"], #libres [data-cle="${CSS.escape(k)}"]`);
      if (!el) continue;
      libres.querySelectorAll(`[data-cle="${CSS.escape(k)}"]`).forEach((x) => x !== el && x.remove());
      liberer(el);
      el.style.left = Math.min(pos.x, innerWidth - 60) + "px"; el.style.top = Math.min(pos.y, innerHeight - 40) + "px";
      if (pos.w) el.style.width = pos.w;
      el.style.setProperty("--s", pos.s || 1);
    }
  }
  function reinitialiser() {
    ecrire({});
    libres.querySelectorAll(".libre").forEach((el) => { if (el.id === "clock") { el.classList.remove("libre"); el.removeAttribute("style"); document.body.appendChild(el); } else if (el._reinit) el._reinit(); else el.remove(); });
    document.querySelectorAll("#panels .panel").forEach((el) => { el.classList.remove("place"); el.style.removeProperty("--s"); el.style.removeProperty("--ry"); });
    J.loadWidgets(); J.layoutPanels();
  }

  // ---------- souris : glisser par le titre ----------
  let souris = null;
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input, [data-act]")) return;
    const h = e.target.closest(POIGNEES); if (!h) return;
    const el = h.closest(MOBILES) || h;
    souris = e.pointerId; e.preventDefault();
    prendre(el, e.clientX, e.clientY);
  });
  addEventListener("pointermove", (e) => { if (souris === e.pointerId) bouger(e.clientX, e.clientY); });
  addEventListener("pointerup", (e) => { if (souris === e.pointerId) { souris = null; lacher(); } });
  addEventListener("pointercancel", () => { if (souris !== null) { souris = null; lacher(0, 0); } });

  return {
    // Ce que vise le curseur. « Aimant » : un bouton à quelques pixels est préféré au vide ou au fond d'un panneau
    // (plus facile à viser avec la main). Les boutons de fermeture ne sont jamais aimantés (pas de fermeture par erreur).
    sous(x, y) {
      const essai = (px, py) => {
        for (const el of document.elementsFromPoint(px, py)) {
          if (el.classList.contains("hand-cursor")) continue;
          const act = el.closest("[data-act]"), mobile = el.closest(MOBILES) || el.closest(SOURCES);
          if (act || mobile) return { act, mobile };
        }
        return null;
      };
      const direct = essai(x, y);
      if (direct?.act) return direct;
      const rayon = direct?.mobile ? [12, 20] : [16, 30];
      for (const r of rayon) for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4, q = essai(x + r * Math.cos(a), y + r * Math.sin(a));
        if (q?.act && !q.act.matches(".x, .wx, [data-act='fermer'], [data-act='module-fermer'], [data-act='widget-retirer']") && (!direct?.mobile || q.mobile === direct.mobile)) return q;
      }
      return direct || {};
    },
    prendre, bouger, lacher, zoomer, tourner, restaurer, reinitialiser, echelle, memoriser,
    source(fn) { fabrique = fn; },
    get prise() { return prise?.el || null; },
  };
}
