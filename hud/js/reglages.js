// Panneau « Réglages » : gros boutons [data-act], utilisables à la souris, au clavier ou en pinçant avec la main.
export function createReglages({ J, voix, sfx, cfg, camera, suivi, deplacement, diag }) {
  const GROUPES = () => [
    cfg.mode === "local" && ["Cerveau", "cerveau", [["claude", "Claude"], ["local", "Local"]]],
    cfg.mode === "local" && ["Vitesse", "vitesse", [["rapide", "Rapide"], ["equilibre", "Équilibré"], ["puissant", "Puissant"]]],
    cfg.mode === "local" && ["Autonomie", "autonomie", [["proprietaire", "Propriétaire"], ["prudent", "Prudent"]]],
    ["Voix", "son", [["on", "Activée"], ["off", "Coupée"], ["choisir", "Choisir…"]]],
    ["Écoute « Jarvis »", "ecoute", [["on", "Mains libres"], ["off", "Sur demande"]]],
    ["Caméra", "camera", [["on", "Ouverte"], ["off", "Fermée"]]],
    ["Suivi du visage", "suivi", [["on", "Affiché"], ["off", "Masqué"]]],
    ["Affichage", "affichage", [["epure", "Épuré"], ["texte", "Conversation"]]],
    ["Disposition", "disposition", [["reset", "Réinitialiser"]]],
    ["Diagnostic", "diag", [["ouvrir", "Ouvrir"]]],
  ].filter(Boolean);

  let etatServeur = {};
  async function etat() {
    if (cfg.mode === "local") { try { etatServeur = await (await fetch("/api/status", { cache: "no-store" })).json(); } catch (_) {} }
    return {
      cerveau: etatServeur.cerveau, vitesse: etatServeur.vitesse, autonomie: etatServeur.autonomie,
      son: J.voiceOn ? "on" : "off", ecoute: J.handsFree ? "on" : "off", camera: camera.ouverte() ? "on" : "off",
      suivi: suivi.visible ? "on" : "off", affichage: document.body.classList.contains("clean") ? "epure" : "texte",
    };
  }

  async function remplir(panel) {
    const e = await etat();
    panel.querySelector(".rg-corps")?.remove();
    const corps = document.createElement("div"); corps.className = "rg-corps";
    for (const [titre, cle, options] of GROUPES()) {
      const ligne = document.createElement("div"); ligne.className = "rg-ligne";
      const t = document.createElement("span"); t.className = "rg-titre"; t.textContent = titre; ligne.appendChild(t);
      const boutons = document.createElement("div"); boutons.className = "rg-opts";
      for (const [val, label] of options) {
        const b = document.createElement("button");
        b.className = "rg-opt" + (e[cle] === val ? " actif" : ""); b.textContent = label;
        Object.assign(b.dataset, { act: "reglage", cle, val });
        boutons.appendChild(b);
      }
      ligne.appendChild(boutons); corps.appendChild(ligne);
    }
    panel.appendChild(corps);
    requestAnimationFrame(J.layoutPanels);
  }

  async function appliquer(el) {
    const { cle, val } = el.dataset, panel = el.closest(".panel");
    sfx.bip();
    switch (cle) {
      case "cerveau": case "vitesse": case "autonomie": await J.api("/api/settings", { [cle]: val }).catch(() => {}); break;
      case "son": if (val === "choisir") J.$("voicebtn").click(); else if ((val === "on") !== J.voiceOn) J.$("mute").click(); break;
      case "ecoute": J.setHandsFree(val === "on"); break;
      case "camera": if (val === "on") await camera.ouvrir(); else camera.fermer(); break;
      case "suivi": suivi.afficher(val === "on"); try { localStorage.setItem("jarvis.suivi", val); } catch (_) {} break;
      case "affichage": document.body.classList.toggle("clean", val === "epure"); J.store.set("jarvis.clean", val === "epure"); break;
      case "disposition": deplacement.reinitialiser(); voix.say("Disposition réinitialisée, Monsieur."); break;
      case "diag": diag.ouvrir(); break;
    }
    if (panel?.isConnected) remplir(panel);
  }
  J.ACTS.reglage = appliquer;

  const api = {
    ouvrir() {
      const existant = document.querySelector('#panels .panel[data-kind="reglages"]');
      if (existant) { existant.style.zIndex = 99; return existant; }
      const p = J.card("Réglages", "reglages");
      p.classList.add("reglages");
      sfx.whoosh_inverse();
      remplir(p);
      return p;
    },
    fermer() { const p = document.querySelector('#panels .panel[data-kind="reglages"]'); if (p) J.closeCard(p); },
  };
  J.ACTS.reglages = () => api.ouvrir();
  return api;
}
