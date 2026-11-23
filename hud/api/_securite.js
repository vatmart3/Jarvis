// Code d'accès optionnel (JARVIS_ACCESS_CODE) : sans lui, n'importe qui connaissant l'URL pourrait utiliser votre clé.
import { timingSafeEqual } from "node:crypto";

export function autorise(request) {
  const attendu = process.env.JARVIS_ACCESS_CODE || "";
  if (!attendu) return true;
  const recu = request.headers.get("x-jarvis-code") || "";
  const a = Buffer.from(attendu), b = Buffer.from(recu);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function erreurJson(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
