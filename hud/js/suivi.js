// Affichage du suivi du visage : cadre, ovale, contours des yeux, iris avec mire, direction du regard, clignements.
// Les points arrivent à la cadence de la caméra ; le dessin est interpolé à 60 i/s pour rester fluide.
export function createSuivi() {
  const cv = Object.assign(document.createElement("canvas"), { id: "suivi" });
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");
  let cible = null, aff = null, visible = true, derniere = 0, dpr = 1;
  const resize = () => { dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  addEventListener("resize", resize); resize();

  const lerpPts = (a, b, k) => b.map((p, i) => (a && a[i] ? { x: a[i].x + (p.x - a[i].x) * k, y: a[i].y + (p.y - a[i].y) * k } : p));
  function lisser(k) {
    if (!cible) return;
    if (!aff) { aff = structuredClone(cible); return; }
    for (const cle of ["ovale", "oeilG", "oeilD", "irisG", "irisD"]) if (cible[cle]) aff[cle] = lerpPts(aff[cle], cible[cle], k);
    for (const cle of ["clignG", "clignD", "yaw", "pitch", "sourire"]) aff[cle] += (cible[cle] - aff[cle]) * k;
    aff.regard = cible.regard;
  }
  const poly = (pts, ferme = true) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (ferme) ctx.closePath(); };

  function dessiner(t) {
    requestAnimationFrame(dessiner);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!visible || !cible || performance.now() - derniere > 900) return;
    lisser(0.45);
    const f = aff, CY = "rgba(73,198,255,", AM = "rgba(255,181,71,";
    // cadre du visage (coins) + étiquettes
    const xs = f.ovale.map((p) => p.x), ys = f.ovale.map((p) => p.y);
    const x0 = Math.min(...xs) - 18, x1 = Math.max(...xs) + 18, y0 = Math.min(...ys) - 18, y1 = Math.max(...ys) + 18, k = 26;
    ctx.lineWidth = 2; ctx.strokeStyle = CY + ".9)"; ctx.shadowColor = "#49c6ff"; ctx.shadowBlur = 10;
    [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]].forEach(([x, y, sx, sy]) => { ctx.beginPath(); ctx.moveTo(x, y + sy * k); ctx.lineTo(x, y); ctx.lineTo(x + sx * k, y); ctx.stroke(); });
    ctx.shadowBlur = 0;
    ctx.font = "11px 'Share Tech Mono', monospace"; ctx.fillStyle = CY + ".95)";
    ctx.fillText("SUJET IDENTIFIÉ", x0, y0 - 10);
    ctx.fillStyle = f.regard ? "rgba(77,255,184,.95)" : AM + ".95)";
    ctx.fillText(f.regard ? "REGARD : ÉCRAN ✓" : "REGARD : AILLEURS", x0, y1 + 18);
    ctx.fillStyle = CY + ".7)";
    ctx.fillText(`LACET ${f.yaw.toFixed(0)}°  TANGAGE ${f.pitch.toFixed(0)}°`, x0, y1 + 34);
    // ovale (pointillé discret) avec balayage
    ctx.setLineDash([2, 6]); ctx.lineWidth = 1; ctx.strokeStyle = CY + ".35)"; poly(f.ovale); ctx.stroke(); ctx.setLineDash([]);
    const scan = y0 + ((t / 12) % (y1 - y0));
    ctx.strokeStyle = CY + ".25)"; ctx.beginPath(); ctx.moveTo(x0 + 6, scan); ctx.lineTo(x1 - 6, scan); ctx.stroke();
    // yeux, iris, clignements
    [["oeilG", "irisG", "clignG"], ["oeilD", "irisD", "clignD"]].forEach(([o, i, c]) => {
      const ferme = f[c] > 0.5;
      ctx.lineWidth = 1.5; ctx.strokeStyle = ferme ? AM + ".95)" : CY + ".85)";
      ctx.shadowColor = ferme ? "#ffb547" : "#49c6ff"; ctx.shadowBlur = 8;
      poly(f[o]); ctx.stroke(); ctx.shadowBlur = 0;
      const ir = f[i];
      if (ir && !ferme) {
        const cx = ir[0].x, cy = ir[0].y, r = Math.max(3, Math.hypot(ir[1].x - ir[2].x, ir[1].y - ir[2].y) / 2);
        ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = CY + ".9)"; ctx.beginPath();
        ctx.moveTo(cx - r * 2, cy); ctx.lineTo(cx - r * 1.3, cy); ctx.moveTo(cx + r * 1.3, cy); ctx.lineTo(cx + r * 2, cy);
        ctx.moveTo(cx, cy - r * 2); ctx.lineTo(cx, cy - r * 1.3); ctx.moveTo(cx, cy + r * 1.3); ctx.lineTo(cx, cy + r * 2); ctx.stroke();
        // direction du regard (estimée depuis l'orientation de la tête)
        ctx.strokeStyle = (f.regard ? "rgba(77,255,184," : AM) + ".6)"; ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx - f.yaw * 2.2, cy - f.pitch * 2.2); ctx.stroke();
      }
      if (ferme) { ctx.fillStyle = AM + ".95)"; ctx.fillText("CLIGNEMENT", f[o][0].x - 10, f[o][0].y - 14); }
    });
  }
  requestAnimationFrame(dessiner);

  return {
    maj(data) { cible = data; derniere = performance.now(); },
    afficher(v) { visible = v; },
    get visible() { return visible; },
  };
}
