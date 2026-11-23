#!/usr/bin/env node
// Pont local Jarvis : petit serveur WebSocket (ws://127.0.0.1:8765), sans dépendance, qui laisse Jarvis
// — même déployé sur Vercel — ouvrir des applications et des pages sur CET ordinateur.
//   node pont-local/pont.mjs
// Sécurité : écoute uniquement en local, origines autorisées limitées, code d'appairage à saisir une fois dans Jarvis.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

const PORT = Number(process.env.PONT_PORT || 8765);
const CONF = path.join(os.homedir(), ".jarvis-pont.json");
const ORIGINES = (process.env.PONT_ORIGINES || "").split(",").map((s) => s.trim()).filter(Boolean);
const origineOk = (o) => !o || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o) || ORIGINES.includes(o);

let conf = {};
try { conf = JSON.parse(fs.readFileSync(CONF, "utf8")); } catch (_) { /* premier lancement */ }
if (!conf.code) { conf.code = crypto.randomInt(100000, 999999).toString(); fs.writeFileSync(CONF, JSON.stringify(conf), { mode: 0o600 }); }

// ---------- actions ----------
function lancer(cmd, args) {
  return new Promise((res) => execFile(cmd, args, { timeout: 10000 }, (err) => res(!err)));
}
async function ouvrirApp(nom) {
  nom = String(nom || "").slice(0, 80);
  if (!/^[\p{L}\p{N} .'&+-]+$/u.test(nom)) return "Nom d'application invalide.";
  const ok = process.platform === "darwin" ? await lancer("open", ["-a", nom])
    : process.platform === "win32" ? await lancer("cmd", ["/c", "start", "", nom])
    : await lancer("gtk-launch", [nom.toLowerCase()]) || await lancer(nom.toLowerCase(), []);
  return ok ? `Application ${nom} ouverte.` : `Impossible d'ouvrir ${nom}.`;
}
async function ouvrirUrl(url) {
  let u; try { u = new URL(String(url)); } catch (_) { return "Adresse invalide."; }
  if (!/^https?:$/.test(u.protocol)) return "Seules les adresses http et https sont autorisées.";
  const ok = process.platform === "darwin" ? await lancer("open", [u.href]) : process.platform === "win32" ? await lancer("cmd", ["/c", "start", "", u.href]) : await lancer("xdg-open", [u.href]);
  return ok ? `Page ${u.href} ouverte.` : "Impossible d'ouvrir la page.";
}
const ACTIONS = { ouvrir_app: (m) => ouvrirApp(m.nom), ouvrir_url: (m) => ouvrirUrl(m.url), ping: async () => "pong" };

// ---------- WebSocket minimal (RFC 6455, messages texte) ----------
function envoyer(sock, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  const head = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
  sock.write(Buffer.concat([head, data]));
}
function lireTrames(buf, onTexte, onFermeture) {
  while (buf.length >= 2) {
    const op = buf[0] & 15, masque = buf[1] & 128; let len = buf[1] & 127, off = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { onFermeture(); return Buffer.alloc(0); }
    if (!masque || len > 65536) { onFermeture(); return Buffer.alloc(0); }
    if (buf.length < off + 4 + len) break;
    const cle = buf.subarray(off, off + 4), donnees = Buffer.from(buf.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < donnees.length; i++) donnees[i] ^= cle[i % 4];
    buf = buf.subarray(off + 4 + len);
    if (op === 8) { onFermeture(); return Buffer.alloc(0); }
    if (op === 1) onTexte(donnees.toString("utf8"));
  }
  return buf;
}

const serveur = http.createServer((_, res) => { res.writeHead(426); res.end("WebSocket uniquement"); });
serveur.on("upgrade", (req, sock) => {
  if (!origineOk(req.headers.origin) || req.headers.upgrade?.toLowerCase() !== "websocket") { sock.destroy(); return; }
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let buf = Buffer.alloc(0), authentifie = false;
  sock.on("data", (d) => {
    buf = lireTrames(Buffer.concat([buf, d]), async (texte) => {
      let m; try { m = JSON.parse(texte); } catch (_) { return; }
      if (m.type === "auth") {
        authentifie = crypto.timingSafeEqual(Buffer.from(String(m.code || "").padEnd(6).slice(0, 6)), Buffer.from(conf.code));
        envoyer(sock, { type: "auth", ok: authentifie });
        console.log(authentifie ? `✓ Jarvis connecté (${req.headers.origin || "local"})` : "✗ code d'appairage incorrect");
        return;
      }
      if (!authentifie || !ACTIONS[m.type]) { envoyer(sock, { id: m.id, ok: false, texte: "Non autorisé." }); return; }
      const texteRep = await ACTIONS[m.type](m);
      console.log(`→ ${m.type} ${m.nom || m.url || ""} : ${texteRep}`);
      envoyer(sock, { id: m.id, ok: true, texte: texteRep });
    }, () => sock.end());
  });
  sock.on("error", () => {});
});
serveur.listen(PORT, "127.0.0.1", () => {
  console.log(`Pont Jarvis prêt sur ws://127.0.0.1:${PORT}`);
  console.log(`Code d'appairage : ${conf.code}  (dites ou tapez « connecte le pont » dans Jarvis, puis saisissez ce code)`);
});
