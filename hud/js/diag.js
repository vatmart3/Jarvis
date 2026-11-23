// Panneau diagnostic : MICRO / CAMÉRA / VISION / MAINS / IA avec voyants, et alertes (iframe, file://, caméra).
const LIGNES = [["micro", "MICRO"], ["camera", "CAMÉRA"], ["vision", "VISION"], ["mains", "MAINS"], ["ia", "IA"]];

export function createDiag() {
  let onActiverCamera = null;
  const box = document.createElement("section");
  box.id = "diag"; box.setAttribute("aria-label", "Diagnostic");
  box.innerHTML = `<div class="dg-head"><span>DIAGNOSTIC</span><button class="dg-x" aria-label="Replier">–</button></div>
    <div class="dg-rows">${LIGNES.map(([k, l]) => `<div class="dg-row" data-k="${k}"><i class="dg-dot off"></i><b>${l}</b><span class="dg-txt">—</span></div>`).join("")}</div>
    <button class="dg-cam" data-act="camera" hidden>Ouvrir la caméra</button>`;
  document.body.appendChild(box);
  const mini = document.createElement("div"); mini.id = "diagmini"; mini.title = "Diagnostic (touche D)";
  mini.innerHTML = LIGNES.map(([k, l]) => `<i class="dg-dot off" data-k="${k}" title="${l}"></i>`).join("");
  document.getElementById("status")?.appendChild(mini);
  const camBtn = box.querySelector(".dg-cam");
  camBtn.onclick = () => onActiverCamera && onActiverCamera();
  const toggle = (v) => box.classList.toggle("open", v ?? !box.classList.contains("open"));
  box.querySelector(".dg-x").onclick = () => toggle(false);
  mini.onclick = () => toggle();
  document.addEventListener("keydown", (e) => { if ((e.key === "d" || e.key === "D") && document.activeElement?.tagName !== "INPUT") toggle(); });

  const api = {
    set(k, niveau, texte = "") {
      box.querySelector(`.dg-row[data-k="${k}"] .dg-dot`).className = `dg-dot ${niveau}`;
      box.querySelector(`.dg-row[data-k="${k}"] .dg-txt`).textContent = texte || "—";
      mini.querySelector(`[data-k="${k}"]`).className = `dg-dot ${niveau}`;
      if (niveau === "err") toggle(true);
    },
    boutonCamera(visible) { camBtn.hidden = false; camBtn.textContent = visible ? "Ouvrir la caméra" : "Fermer la caméra"; },
    onCamera(fn) { onActiverCamera = fn; },
    banner(message, titre = "Caméra et micro bloqués ici.") {
      document.getElementById("envbanner")?.remove();
      const b = document.createElement("div"); b.id = "envbanner"; b.setAttribute("role", "alert");
      b.innerHTML = `<b></b><span></span><button aria-label="Fermer" data-act="fermer-bandeau">✕</button>`;
      b.querySelector("b").textContent = titre;
      b.querySelector("span").textContent = message;
      setTimeout(() => b.remove(), 15000);
      b.querySelector("button").onclick = () => b.remove();
      document.body.appendChild(b);
    },
    ouvrir: () => toggle(true),
  };

  // Contexte d'exécution : la caméra et le micro exigent https:// ou localhost, hors iframe.
  const enIframe = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
  if (location.protocol === "file:") api.banner("Jarvis est ouvert comme fichier (file://). Lance-le par http://localhost:3000 (serveur local) ou par son adresse https:// (Vercel).");
  else if (!window.isSecureContext) api.banner("Cette adresse n'est pas sécurisée : il faut https:// ou http://localhost pour la caméra et le micro.");
  else if (enIframe) api.banner("Jarvis est affiché dans un cadre (iframe) : ouvre-le directement dans un onglet pour autoriser la caméra et le micro.");
  api.contexteOk = location.protocol !== "file:" && window.isSecureContext && !enIframe;
  return api;
}
