// Client du pont local (serveur Node WebSocket sur ws://127.0.0.1:8765, voir pont-local/).
// Permet à Jarvis ouvert dans le navigateur (y compris déployé sur Vercel) d'ouvrir des apps sur l'ordinateur.
const URL_PONT = "ws://127.0.0.1:8765";
let ws = null, ok = false, n = 0, attente = new Map(), essais = 0, onChange = () => {};

function code() { try { return localStorage.getItem("jarvis.pont.code") || ""; } catch (_) { return ""; } }

function connecter() {
  if (ws && ws.readyState <= 1) return;
  try { ws = new WebSocket(URL_PONT); } catch (_) { return; }
  ws.onopen = () => ws.send(JSON.stringify({ type: "auth", code: code() }));
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
    if (m.type === "auth") { ok = !!m.ok; essais = 0; onChange(ok, m.ok ? "" : "code d'appairage incorrect"); return; }
    const p = attente.get(m.id); if (p) { attente.delete(m.id); p(m.texte || (m.ok ? "Fait." : "Échec.")); }
  };
  ws.onclose = () => { const avant = ok; ok = false; if (avant) onChange(false, "déconnecté"); if (essais < 6) setTimeout(connecter, Math.min(60000, 3000 * 2 ** essais++)); };
  ws.onerror = () => {};
}

export const pont = {
  // On ne tente la connexion qu'une fois le pont appairé (évite des erreurs réseau inutiles).
  demarrer(cb) { if (cb) onChange = cb; if (code()) connecter(); },
  get connecte() { return ok; },
  definirCode(c) { try { localStorage.setItem("jarvis.pont.code", c); } catch (_) {} essais = 0; if (ws) ws.close(); else connecter(); },
  envoyer(cmd) {
    if (!ok) return Promise.resolve("Pont local non connecté.");
    const id = ++n;
    return new Promise((res) => { attente.set(id, res); ws.send(JSON.stringify({ ...cmd, id })); setTimeout(() => { if (attente.delete(id)) res("Le pont local n'a pas répondu."); }, 8000); });
  },
};
