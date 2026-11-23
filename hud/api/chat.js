// Proxy serverless (Vercel) vers l'API Anthropic, en streaming. La clé ANTHROPIC_API_KEY reste côté serveur.
// Le navigateur envoie l'historique ; le proxy diffuse le texte au fil de l'eau (lignes JSON) puis le message final.
// Les outils « client » sont exécutés par le navigateur, qui rappelle ce proxy avec les résultats.
import Anthropic from "@anthropic-ai/sdk";
import { OUTILS, SYSTEME } from "./_outils.js";
import { autorise, erreurJson } from "./_securite.js";

const client = new Anthropic(); // lit ANTHROPIC_API_KEY dans l'environnement
const MODELE = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const EFFORT = process.env.ANTHROPIC_EFFORT || "low"; // « low » : premier mot plus rapide
// Repli côté serveur en cas de refus de sécurité (non disponible pour Haiku).
const AVEC_REPLI = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(MODELE);

export async function POST(request) {
  if (!autorise(request)) return erreurJson(401, "Code d'accès incorrect.");
  let body;
  try { body = await request.json(); } catch (_) { return erreurJson(400, "Requête invalide."); }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-60) : [];
  if (!messages.length || JSON.stringify(messages).length > 400_000) return erreurJson(400, "Historique invalide.");
  const memoire = String(body.memoire || "").slice(0, 2000);
  const contexte = String(body.contexte || "").slice(0, 500);

  const params = {
    model: MODELE,
    max_tokens: 4096,
    // Partie fixe mise en cache ; mémoire et contexte (heure, ville) ensuite, car ils changent.
    system: [
      { type: "text", text: SYSTEME, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Contexte : ${contexte}\nCe que tu sais de l'utilisateur :\n${memoire || "(rien pour l'instant)"}` },
    ],
    tools: [...OUTILS, { type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    output_config: { effort: EFFORT },
    messages,
  };
  if (AVEC_REPLI) Object.assign(params, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });

  const enc = new TextEncoder();
  const flux = new ReadableStream({
    async start(controller) {
      const send = (o) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const stream = client.beta.messages.stream(params);
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") send({ t: "text", d: ev.delta.text });
          else if (ev.type === "content_block_start" && (ev.content_block.type === "tool_use" || ev.content_block.type === "server_tool_use")) send({ t: "tool", name: ev.content_block.name });
        }
        const msg = await stream.finalMessage();
        send({ t: "done", content: msg.content, stop_reason: msg.stop_reason, stop_details: msg.stop_details || null });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) send({ t: "error", message: "Clé API Anthropic invalide (variable ANTHROPIC_API_KEY)." });
        else if (err instanceof Anthropic.RateLimitError) send({ t: "error", message: "Trop de requêtes, réessayez dans un instant." });
        else if (err instanceof Anthropic.APIError) send({ t: "error", message: `Erreur de l'API (${err.status}).` });
        else send({ t: "error", message: "Réponse interrompue, réessayez." }); // ex. entrée d'outil illisible ou connexion coupée
      } finally {
        controller.close();
      }
    },
  });
  return new Response(flux, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
