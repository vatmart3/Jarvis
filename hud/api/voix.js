// Proxy ElevenLabs (synthèse vocale en flux, faible latence). Clé ELEVENLABS_API_KEY côté serveur uniquement.
import { autorise, erreurJson } from "./_securite.js";

const VOIX = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // « George » : voix masculine britannique, parle français
const MODELE = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";       // modèle multilingue à faible latence

export async function POST(request) {
  if (!process.env.ELEVENLABS_API_KEY) return erreurJson(501, "ElevenLabs non configuré.");
  if (!autorise(request)) return erreurJson(401, "Code d'accès incorrect.");
  let body;
  try { body = await request.json(); } catch (_) { return erreurJson(400, "Requête invalide."); }
  const text = String(body.text || "").slice(0, 800);
  if (!text.trim()) return erreurJson(400, "Texte vide.");
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOIX}/stream?output_format=mp3_44100_64&optimize_streaming_latency=3`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODELE, language_code: "fr", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15 } }),
  });
  if (!r.ok || !r.body) return erreurJson(502, `ElevenLabs a répondu ${r.status}.`);
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
