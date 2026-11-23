// Commandes par les yeux, à partir des « blendshapes » MediaPipe (eyeBlinkLeft / eyeBlinkRight, de 0 à 1).
// - clin d'œil : un seul œil fermé 0,14 à 1 s, l'autre ouvert ;
// - double clignement : deux clignements des deux yeux en moins de 0,7 s ;
// - yeux fermés : les deux yeux fermés plus de 1,2 s.
// Un clignement naturel (deux yeux, ~0,15 s, isolé) ne déclenche rien. Tête trop tournée : ignoré.
const FERME = 0.5, OUVERT = 0.3, ECART = 0.3;
const CLIN_MIN = 140, CLIN_MAX = 1000, CLIGNE_MAX = 450, DOUBLE_DANS = 700, LONG = 1200, REPOS = 700;

export function createYeux({ onCommande = () => {} } = {}) {
  let etat = "ouvert", debut = 0, cote = null, dernierClignement = 0, dernierOrdre = 0, longFait = false;

  function maj({ clignG = 0, clignD = 0, yaw = 0 }, now = performance.now()) {
    if (Math.abs(yaw) > 28) { etat = "ouvert"; return; }
    const deux = clignG > FERME && clignD > FERME;
    const ouverts = clignG < OUVERT && clignD < OUVERT;
    const un = Math.max(clignG, clignD) > FERME && Math.min(clignG, clignD) < OUVERT + 0.1 && Math.abs(clignG - clignD) > ECART;
    const libre = now - dernierOrdre > REPOS;

    if (etat === "ouvert") {
      if (deux) { etat = "deux"; debut = now; longFait = false; }
      else if (un) { etat = "un"; debut = now; cote = clignG > clignD ? "gauche" : "droit"; }
      return;
    }
    if (etat === "un") {
      if (deux) { etat = "deux"; longFait = false; return; }       // finalement un clignement des deux yeux
      if (un) { if (now - debut > CLIN_MAX) etat = "tenu"; return; } // trop long : ce n'est pas un clin d'œil
      if (ouverts || !un) {
        const duree = now - debut; etat = "ouvert";
        if (duree >= CLIN_MIN && duree <= CLIN_MAX && libre) { dernierOrdre = now; onCommande("clin", { cote }); }
      }
      return;
    }
    if (etat === "deux") {
      if (deux) {
        if (!longFait && now - debut >= LONG && libre) { longFait = true; dernierOrdre = now; onCommande("fermes", {}); }
        return;
      }
      if (ouverts) {
        const duree = now - debut; etat = "ouvert";
        if (longFait || duree > CLIGNE_MAX) return;
        if (now - dernierClignement < DOUBLE_DANS && libre) { dernierClignement = 0; dernierOrdre = now; onCommande("double", {}); }
        else dernierClignement = now;
      }
      return;
    }
    if (etat === "tenu" && ouverts) etat = "ouvert";
  }
  return { maj };
}
