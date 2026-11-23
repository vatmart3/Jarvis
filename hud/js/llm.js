// Cerveau « en ligne » : API Anthropic via le proxy /api/chat (streaming), outils exécutés dans le navigateur.
import { OUTILS, valider } from "./outils-web.js";
import { memoire } from "./memoire.js";

const IDLE_RESET = 15 * 60 * 1000;   // nouvelle conversation après 15 min d'inactivité (la mémoire assure la continuité)
const MAX_ENTRIES = 40;              // au-delà : nouvelle conversation plutôt que de modifier l'historique

// Après un repli en cours de réponse, ce qui précède le dernier bloc « fallback » (réflexion, appels d'outils,
// blocs internes non appariés) ne doit pas être renvoyé ; le bloc fallback reste à sa place.
function nettoyer(content) {
  const k = content.map((b) => b.type).lastIndexOf("fallback");
  if (k < 0) return content;
  const avant = content.slice(0, k), apres = content.slice(k);
  const serverIds = new Set(avant.filter((b) => b.type?.endsWith("_tool_result")).map((b) => b.tool_use_id));
  return [...avant.filter((b) => b.type === "text" || (b.type?.endsWith("_tool_result")) || (b.type === "server_tool_use" && serverIds.has(b.id))), ...apres];
}

export function createCloudBrain({ code = () => "", onDelta = () => {}, onTool = () => {}, onActions = () => {}, contexte = () => "" }) {
  let history = [], last = 0;

  async function tour(signal) {
    const r = await fetch("/api/chat", {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-jarvis-code": code() },
      body: JSON.stringify({ messages: history, memoire: memoire.resume(), contexte: contexte() }),
    });
    if (r.status === 401) throw new Error("Code d'accès incorrect.");
    if (!r.ok || !r.body) throw new Error(`Le cerveau ne répond pas (${r.status}).`);
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = "", fin = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch (_) { continue; }
        if (m.t === "text") onDelta(m.d);
        else if (m.t === "tool") onTool(m.name);
        else if (m.t === "done") fin = m;
        else if (m.t === "error") throw new Error(m.message);
      }
    }
    if (!fin) throw new Error("Réponse incomplète.");
    return fin;
  }

  return {
    async ask(texte, signal) {
      if (Date.now() - last > IDLE_RESET || history.length > MAX_ENTRIES) history = [];
      last = Date.now();
      history.push({ role: "user", content: texte });
      let reponse = "";
      for (let i = 0; i < 8; i++) {
        const fin = await tour(signal);
        if (fin.stop_reason === "refusal") {
          history.pop(); // la demande refusée n'entre pas dans l'historique
          return { reply: "Je crains de ne pas pouvoir vous aider sur ce point, Monsieur.", refus: true };
        }
        const content = nettoyer(fin.content || []);
        history.push({ role: "assistant", content });
        const k = content.map((b) => b.type).lastIndexOf("fallback");
        const utiles = content.slice(k + 1);
        reponse = utiles.filter((b) => b.type === "text").map((b) => b.text).join(" ").trim() || reponse;
        if (fin.stop_reason === "pause_turn") continue;
        const appels = utiles.filter((b) => b.type === "tool_use");
        if (fin.stop_reason === "max_tokens" && appels.length) throw new Error("Réponse tronquée.");
        if (fin.stop_reason !== "tool_use" || !appels.length) break;
        // outils exécutés dans le navigateur, résultats renvoyés en un seul message
        const resultats = [];
        for (const b of appels) {
          const err = valider(b.name, b.input);
          if (err) { resultats.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: JSON.stringify({ INVALID_INPUT: err }) }); continue; }
          onTool(b.name);
          try {
            const { texte: t, actions } = await OUTILS[b.name](b.input);
            if (actions?.length) onActions(actions);
            resultats.push({ type: "tool_result", tool_use_id: b.id, content: String(t || "Fait.") });
          } catch (e) {
            resultats.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: "Échec : " + (e.message || e) });
          }
        }
        history.push({ role: "user", content: resultats });
      }
      return { reply: reponse };
    },
    reset() { history = []; },
  };
}
