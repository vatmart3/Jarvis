// Mémoire persistante et notes de Jarvis (localStorage). Un résumé de la mémoire est injecté dans le prompt.
const KM = "jarvis.memoire", KN = "jarvis.notes";
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch (_) { return []; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* stockage indisponible */ } };

export const memoire = {
  faits: () => read(KM),
  ajouter(fait) {
    fait = String(fait || "").trim().slice(0, 300);
    if (!fait) return "Rien à retenir.";
    const l = read(KM).filter((f) => f.fait.toLowerCase() !== fait.toLowerCase());
    l.push({ fait, date: new Date().toISOString().slice(0, 10) });
    write(KM, l.slice(-60));
    return `Retenu : ${fait}`;
  },
  oublier(motif) {
    const m = String(motif || "").toLowerCase(), l = read(KM), k = l.filter((f) => !f.fait.toLowerCase().includes(m));
    write(KM, k);
    return `${l.length - k.length} souvenir(s) effacé(s).`;
  },
  remplacer(liste) { if (Array.isArray(liste)) write(KM, liste); },
  // Résumé compact pour le prompt (les plus récents d'abord, ~1500 caractères max)
  resume() {
    const l = read(KM).slice().reverse(); let out = "", n = 0;
    for (const f of l) { const s = `- ${f.fait}\n`; if (out.length + s.length > 1500) break; out += s; n++; }
    return out.trim();
  },
  ville() {
    const f = read(KM).find((x) => /\b(habite|vit|ville|j'habite)\b/i.test(x.fait));
    const m = f && f.fait.match(/(?:à|a)\s+([A-ZÉÈÊÀÂÎÔÛÇ][\wÀ-ÿ' -]+)/);
    return m ? m[1].trim() : null;
  },
};

export const notes = {
  toutes: () => read(KN),
  ajouter(texte) {
    texte = String(texte || "").trim().slice(0, 500);
    if (!texte) return "Note vide.";
    const l = read(KN); l.push({ texte, date: new Date().toISOString() }); write(KN, l.slice(-200));
    return `Note enregistrée (${l.length} au total).`;
  },
  supprimer(motif) {
    const m = String(motif || "").toLowerCase(), l = read(KN), k = m === "toutes" ? [] : l.filter((n) => !n.texte.toLowerCase().includes(m));
    write(KN, k); return `${l.length - k.length} note(s) supprimée(s).`;
  },
  remplacer(liste) { if (Array.isArray(liste)) write(KN, liste); },
  lignes(n = 8) {
    return read(KN).slice(-n).reverse().map((x) => {
      const d = new Date(x.date);
      return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} — ${x.texte}`;
    });
  },
};
