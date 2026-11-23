/* Jarvis HUD — schémas animés.
 * JarvisSchema.show(action) construit à l'écran, élément par élément, un schéma décrit par Jarvis :
 *   flux (processus / organigramme), mental (carte mentale), chronologie, cycle, graphique (barres, courbe, camembert).
 * Mise en page calculée ici, sans bibliothèque. Animations : apparition des blocs, tracé des liens,
 * texte tapé, particules qui circulent une fois le schéma construit.
 */
(() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const COLORS = ["#49c6ff", "#4dffb8", "#ffb547", "#b98cff"];
  const CHAR_W = 9.4, LINE_H = 21, FONT = 17;
  let timers = [], stage, svg, root, soundOn = () => true;

  // ---------- utilitaires ----------
  const el = (name, attrs = {}, parent) => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function wrap(text, max) {
    const words = String(text || "").split(/\s+/).filter(Boolean), lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim();
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  let audio = null;
  function blip(freq = 880, vol = 0.035) {
    if (!soundOn()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = "sine"; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + 0.08);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.18);
    } catch (_) { /* pas de son */ }
  }

  function typeText(textEl, full, ms = 22) {
    const tspans = [...textEl.querySelectorAll("tspan")];
    const parts = tspans.map((t) => t.dataset.full);
    tspans.forEach((t) => (t.textContent = ""));
    let li = 0, ci = 0;
    if (reduced()) { tspans.forEach((t, i) => (t.textContent = parts[i])); return; }
    const iv = setInterval(() => {
      if (li >= tspans.length) return clearInterval(iv);
      ci += 2;
      tspans[li].textContent = parts[li].slice(0, ci);
      if (ci >= parts[li].length) { li++; ci = 0; }
    }, ms);
    timers.push(iv);
  }

  function drawPath(path, delay, dur = 700) {
    const len = path.getTotalLength ? path.getTotalLength() : 600;
    path.style.strokeDasharray = `${len} ${len}`;
    path.style.strokeDashoffset = len;
    at(delay, () => {
      path.style.transition = `stroke-dashoffset ${reduced() ? 0 : dur}ms cubic-bezier(.4,0,.2,1)`;
      path.style.strokeDashoffset = 0;
      path.classList.add("on");
    });
    at(delay + dur + 50, () => {
      path.style.strokeDasharray = "";
      if (path.dataset.marker) path.setAttribute("marker-end", path.dataset.marker); // pointe de flèche une fois le trait tracé
    }); // laisse place aux pointillés animés si besoin
  }

  // ---------- blocs ----------
  function measure(n, max = 18) {
    const lines = wrap(n.texte, max), dl = n.detail ? wrap(n.detail, max + 8) : [];
    const longest = Math.max(...lines.map((l) => l.length), ...dl.map((l) => l.length * 0.82), 6);
    let w = Math.max(130, longest * CHAR_W + 40), h = lines.length * LINE_H + dl.length * 17 + 26;
    if (n.forme === "losange") { w *= 1.45; h *= 1.75; }
    if (n.forme === "pilule") w += 20;
    return Object.assign(n, { lines, dl, w, h });
  }

  function drawNode(n, layer, delay, opts = {}) {
    const c = COLORS[n.groupe || 0], g = el("g", { class: "s-node", transform: `translate(${n.x},${n.y})` }, layer);
    g.style.setProperty("--c", c);
    const inner = el("g", { class: "s-pop" }, g);
    const { w, h } = n;
    let shape;
    if (n.forme === "losange") shape = el("polygon", { points: `0,${-h / 2} ${w / 2},0 0,${h / 2} ${-w / 2},0`, class: "s-box" }, inner);
    else shape = el("rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: n.forme === "pilule" ? h / 2 : 10, class: "s-box" }, inner);
    if (opts.big) shape.classList.add("s-big");
    // coins lumineux (style HUD) sur les rectangles
    if (n.forme === "rect") {
      const k = 10;
      el("path", { d: `M${-w / 2},${-h / 2 + k} V${-h / 2} H${-w / 2 + k} M${w / 2 - k},${h / 2} H${w / 2} V${h / 2 - k}`, class: "s-corner" }, inner);
    }
    const flash = shape.cloneNode(); flash.setAttribute("class", "s-flash"); inner.appendChild(flash);
    const total = n.lines.length * LINE_H + n.dl.length * 17;
    const t = el("text", { class: "s-label" + (opts.big ? " big" : ""), "text-anchor": "middle" }, inner);
    n.lines.forEach((line, i) => { const s = el("tspan", { x: 0, y: -total / 2 + 15 + i * LINE_H }, t); s.dataset.full = line; s.textContent = line; });
    if (n.dl.length) {
      const d = el("text", { class: "s-detail", "text-anchor": "middle" }, inner);
      n.dl.forEach((line, i) => { const s = el("tspan", { x: 0, y: -total / 2 + n.lines.length * LINE_H + 12 + i * 17 }, d); s.dataset.full = line; s.textContent = line; });
      at(delay + 250, () => typeText(d, null, 14));
    }
    inner.style.animationDelay = `${delay}ms`;
    at(delay, () => { blip(700 + (n.groupe || 0) * 120); typeText(t); });
    return g;
  }

  function edgeLabel(layer, x, y, text, delay) {
    if (!text) return;
    const g = el("g", { class: "s-elabel", transform: `translate(${x},${y})` }, layer);
    const w = text.length * 7.6 + 16;
    el("rect", { x: -w / 2, y: -11, width: w, height: 22, rx: 4 }, g);
    el("text", { "text-anchor": "middle", y: 5 }, g).textContent = text;
    g.style.animationDelay = `${delay}ms`;
  }

  function particles(layer, paths, start) {
    if (reduced()) return;
    at(start, () => paths.forEach((p, i) => {
      const dot = el("circle", { r: 3.2, class: "s-particle" }, layer);
      dot.style.setProperty("--c", p.getAttribute("data-c") || COLORS[0]);
      const m = el("animateMotion", { dur: `${2.4 + (i % 3) * 0.5}s`, repeatCount: "indefinite", begin: `${(i * 0.37) % 2}s`, path: p.getAttribute("d") }, dot);
      m.beginElement && setTimeout(() => { try { m.beginElement(); } catch (_) {} }, 30);
    }));
  }

  const bez = (a, b, c, d, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };

  // ---------- mises en page ----------
  // Lien courbe entre deux blocs, ancré sur les côtés qui se font face.
  function routeEdge(a, b, back, all = []) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const sameRow = Math.abs(dy) < (a.h + b.h) / 2 + 10;
    const skip = sameRow && Math.abs((b.layer || 0) - (a.layer || 0)) > 1; // passerait à travers un bloc intermédiaire
    let sx, sy, tx, ty, c1x, c1y, c2x, c2y;
    if (skip) {
      // arc qui passe juste au-dessus des blocs enjambés, dans l'espace entre deux rangées
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      const between = all.filter((n) => n !== a && n !== b && Math.abs(n.y - a.y) < (n.h + a.h) / 2 && n.x > lo && n.x < hi);
      const top = Math.min(a.y - a.h / 2, b.y - b.h / 2, ...between.map((n) => n.y - n.h / 2)) - 30;
      sx = a.x; sy = a.y - a.h / 2; tx = b.x; ty = b.y - b.h / 2;
      c1x = sx; c2x = tx; c1y = c2y = sy + (top - sy) / 0.75;
    } else if (back) {
      sx = a.x; sy = a.y - a.h / 2; tx = b.x; ty = b.y - b.h / 2;
      const lift = 90 + Math.abs(dx) * 0.12;
      c1x = sx; c1y = Math.min(sy, ty) - lift; c2x = tx; c2y = c1y;
    } else if (sameRow) {
      const sg = Math.sign(dx) || 1;
      sx = a.x + sg * a.w / 2; sy = a.y; tx = b.x - sg * b.w / 2; ty = b.y;
      const k = Math.max(30, Math.abs(tx - sx) / 2);
      c1x = sx + sg * k; c1y = sy; c2x = tx - sg * k; c2y = ty;
    } else {
      const sg = Math.sign(dy) || 1;
      sx = a.x; sy = a.y + sg * a.h / 2; tx = b.x; ty = b.y - sg * b.h / 2;
      const k = Math.max(36, Math.abs(ty - sy) / 2);
      c1x = sx; c1y = sy + sg * k; c2x = tx; c2y = ty - sg * k;
    }
    const d = `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
    const short = Math.hypot(tx - sx, ty - sy) < 110;
    return { d, lx: bez(sx, c1x, c2x, tx, 0.5), ly: bez(sy, c1y, c2y, ty, 0.5) - (short ? 22 : 0) };
  }

  function layoutFlux(nodes, links, box) {
    const byId = new Map(nodes.map((n) => [n.id, n])), out = new Map(), indeg = new Map();
    nodes.forEach((n) => { out.set(n.id, []); indeg.set(n.id, 0); n.layer = 0; });
    links.forEach((l) => { out.get(l.de).push(l.vers); indeg.set(l.vers, indeg.get(l.vers) + 1); });
    // couches : plus long chemin depuis les sources (les cycles sont coupés)
    const q = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id), seen = new Set(), deg = new Map(indeg);
    if (!q.length && nodes.length) q.push(nodes[0].id);
    while (q.length) {
      const id = q.shift(); if (seen.has(id)) continue; seen.add(id);
      for (const v of out.get(id)) {
        if (seen.has(v)) continue;
        byId.get(v).layer = Math.max(byId.get(v).layer, byId.get(id).layer + 1);
        deg.set(v, deg.get(v) - 1);
        if (deg.get(v) <= 0) q.push(v);
      }
      if (!q.length) { const rest = nodes.find((n) => !seen.has(n.id)); if (rest) { rest.layer = Math.max(rest.layer, byId.get(id).layer + 1); q.push(rest.id); } }
    }
    const L = [];
    nodes.forEach((n) => (L[n.layer] = L[n.layer] || []).push(n));
    const layers = L.filter(Boolean);
    const preds = new Map(nodes.map((n) => [n.id, []]));
    links.forEach((l) => preds.get(l.vers).push(l.de));
    layers.forEach((layer, li) => {
      if (li === 0) { layer.forEach((n, i) => (n.pos = i)); return; }
      layer.forEach((n, i) => { const p = preds.get(n.id).map((id) => byId.get(id)).filter((m) => m.pos !== undefined && m.layer < n.layer); n.bary = p.length ? p.reduce((s, m) => s + m.pos, 0) / p.length : i; });
      layer.sort((x, y) => x.bary - y.bary).forEach((n, i) => (n.pos = i));
    });

    // Dispositions candidates : couches de haut en bas, ou de gauche à droite repliées en serpentin sur k colonnes.
    const GAP_IN = 46, GAP_COL = 110, GAP_ROW = 90;
    const place = (mode, k) => {
      const pos = new Map();
      if (mode === "TB") {
        let y = 0;
        layers.forEach((layer) => {
          const rowH = Math.max(...layer.map((n) => n.h)), span = layer.reduce((s, n) => s + n.w, 0) + (layer.length - 1) * 54;
          let x = -span / 2;
          layer.forEach((n) => { pos.set(n.id, [x + n.w / 2, y + rowH / 2]); x += n.w + 54; });
          y += rowH + 96;
        });
      } else {
        const colW = Math.max(...nodes.map((n) => n.w)) + GAP_COL;
        let y = 0;
        for (let r = 0; r * k < layers.length; r++) {
          const row = layers.slice(r * k, r * k + k);
          const rowH = Math.max(...row.map((layer) => layer.reduce((s, n) => s + n.h, 0) + (layer.length - 1) * GAP_IN));
          row.forEach((layer, c) => {
            const col = r % 2 === 0 ? c : k - 1 - c; // serpentin : une ligne sur deux de droite à gauche
            const span = layer.reduce((s, n) => s + n.h, 0) + (layer.length - 1) * GAP_IN;
            let yy = y + (rowH - span) / 2;
            layer.forEach((n) => { pos.set(n.id, [col * colW, yy + n.h / 2]); yy += n.h + GAP_IN; });
          });
          y += rowH + GAP_ROW;
        }
      }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      nodes.forEach((n) => { const [x, yv] = pos.get(n.id); x0 = Math.min(x0, x - n.w / 2); x1 = Math.max(x1, x + n.w / 2); y0 = Math.min(y0, yv - n.h / 2); y1 = Math.max(y1, yv + n.h / 2); });
      const scale = Math.min(box.w / (x1 - x0 + 140), box.h / (y1 - y0 + 140));
      return { pos, scale };
    };
    let best = place("TB");
    for (let k = layers.length; k >= 2; k--) {
      const c = place("LR", k);
      if (c.scale > best.scale * 1.04) best = c;
    }
    nodes.forEach((n) => { [n.x, n.y] = best.pos.get(n.id); });
    const order = layers.flat();
    const edges = links.map((l) => {
      const a = byId.get(l.de), b = byId.get(l.vers);
      return Object.assign({ l, a, b }, routeEdge(a, b, b.layer <= a.layer, nodes));
    });
    return { order, edges };
  }

  function layoutMental(nodes, links) {
    const byId = new Map(nodes.map((n) => [n.id, n])), kids = new Map(nodes.map((n) => [n.id, []])), parent = new Map();
    const incoming = new Set(links.map((l) => l.vers));
    const rootN = nodes.find((n) => !incoming.has(n.id)) || nodes[0];
    links.forEach((l) => { if (!parent.has(l.vers) && l.vers !== rootN.id) { parent.set(l.vers, l.de); kids.get(l.de).push(l.vers); } });
    // éléments isolés ou cycles : rattachés au centre
    const reach = new Set([rootN.id]), stack = [rootN.id];
    while (stack.length) for (const k of kids.get(stack.pop())) if (!reach.has(k)) { reach.add(k); stack.push(k); }
    nodes.forEach((n) => { if (!reach.has(n.id)) { const p = parent.get(n.id); if (p) kids.set(p, kids.get(p).filter((x) => x !== n.id)); parent.set(n.id, rootN.id); kids.get(rootN.id).push(n.id); reach.add(n.id); } });
    const leaves = (id) => { const k = kids.get(id); return k.length ? k.reduce((s, c) => s + leaves(c), 0) : 1; };
    const R = [0, 330, 590, 820];
    rootN.x = 0; rootN.y = 0; rootN.depth = 0; rootN.big = true;
    const place = (id, a0, a1, depth) => {
      const k = kids.get(id), tot = k.reduce((s, c) => s + leaves(c), 0) || 1;
      let a = a0;
      k.forEach((c, i) => {
        const span = ((a1 - a0) * leaves(c)) / tot, mid = a + span / 2, n = byId.get(c);
        const r = R[Math.min(depth + 1, 3)] + (depth === 0 && k.length > 6 ? (i % 2) * 70 : 0);
        n.x = Math.cos(mid) * r * 1.25; n.y = Math.sin(mid) * r * 0.82; n.depth = depth + 1; n.angle = mid;
        if (n.depth === 1 && n.groupe === 0) n.groupe = i % 4;
        if (n.depth > 1 && n.groupe === 0) n.groupe = byId.get(id).groupe;
        place(c, a, a + span, depth + 1);
        a += span;
      });
    };
    place(rootN.id, -Math.PI / 2, (3 * Math.PI) / 2, 0);
    const order = [], q = [rootN.id];
    while (q.length) { const id = q.shift(); order.push(byId.get(id)); q.push(...kids.get(id)); }
    const edges = [];
    order.slice(1).forEach((n) => {
      const p = byId.get(parent.get(n.id)), mx = (p.x + n.x) / 2, my = (p.y + n.y) / 2;
      const d = `M${p.x},${p.y} C${mx},${p.y} ${mx},${n.y} ${n.x},${n.y}`;
      edges.push({ a: p, b: n, d, lx: mx, ly: my, l: { texte: "" } });
    });
    return { order, edges };
  }

  function layoutCycle(nodes) {
    const n = nodes.length, maxW = Math.max(...nodes.map((m) => m.w));
    const R = Math.max(250, (n * (maxW + 60)) / (2 * Math.PI));
    nodes.forEach((m, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; m.x = Math.cos(a) * R * 1.15; m.y = Math.sin(a) * R; m.angle = a; });
    const edges = nodes.map((a, i) => {
      const b = nodes[(i + 1) % n];
      if (n < 2) return null;
      const da = (2 * Math.PI) / n, pad = Math.min(da * 0.32, Math.max(a.w, b.w) / 2 / R + 0.08);
      const a0 = a.angle + pad, a1 = a.angle + da - pad;
      const P = (ang) => [Math.cos(ang) * R * 1.15, Math.sin(ang) * R];
      const [sx, sy] = P(a0), [tx, ty] = P(a1), [mx, my] = P((a0 + a1) / 2);
      const d = `M${sx},${sy} Q${mx * 1.12 - (sx + tx) * 0.06},${my * 1.12 - (sy + ty) * 0.06} ${tx},${ty}`;
      return { a, b, d, lx: mx * 1.2, ly: my * 1.2, l: { texte: "" } };
    }).filter(Boolean);
    return { order: nodes, edges };
  }

  // ---------- rendu des schémas à blocs ----------
  function renderGraph(a, kind, box) {
    const nodes = a.noeuds.map((n) => measure(Object.assign({}, n)));
    const links = a.liens || [];
    let res;
    if (kind === "mental") res = layoutMental(nodes, links);
    else if (kind === "cycle") res = layoutCycle(nodes);
    else res = layoutFlux(nodes, links, box);
    if (kind === "mental") res.order.forEach((n) => { if (n.depth === 0) { n.texte = n.texte; Object.assign(n, measure(Object.assign(n, { forme: "pilule" }), 16)); n.w += 30; n.h += 12; } else if (n.depth >= 2) n.forme = "pilule"; });
    const edgeLayer = el("g", {}, root), partLayer = el("g", {}, root), nodeLayer = el("g", {}, root), labelLayer = el("g", {}, root);
    const step = Math.max(240, Math.min(520, 7000 / res.order.length));
    const appearAt = new Map(res.order.map((n, i) => [n.id, 500 + i * step]));
    res.order.forEach((n) => drawNode(n, nodeLayer, appearAt.get(n.id), { big: n.big }));
    const paths = [];
    res.edges.forEach((e) => {
      const p = el("path", { d: e.d, class: "s-edge" + (kind === "cycle" ? " s-arc" : ""), "data-marker": kind === "mental" ? null : "url(#s-arrow)", "data-c": COLORS[e.b.groupe || 0] }, edgeLayer);
      p.style.setProperty("--c", COLORS[e.b.groupe || 0]);
      const start = Math.max(appearAt.get(e.a.id), appearAt.get(e.b.id)) - step * 0.55;
      drawPath(p, start, Math.min(700, step));
      edgeLabel(labelLayer, e.lx, e.ly, e.l.texte, start + 500);
      paths.push(p);
    });
    const end = 500 + res.order.length * step + 500;
    particles(partLayer, paths, end);
    return { nodes: res.order, end };
  }

  function renderTimeline(a) {
    const nodes = a.noeuds.map((n) => measure(Object.assign({}, n), 16));
    const gap = Math.max(230, Math.max(...nodes.map((n) => n.w)) + 36);
    const x0 = -((nodes.length - 1) * gap) / 2;
    const axis = el("path", { d: `M${x0 - 120},0 H${-x0 + 120}`, class: "s-axis" }, root);
    drawPath(axis, 300, 1200);
    const step = Math.max(300, Math.min(600, 7000 / nodes.length));
    nodes.forEach((n, i) => {
      const up = i % 2 === 0, x = x0 + i * gap, t = 900 + i * step;
      n.x = x; n.y = (up ? -1 : 1) * (n.h / 2 + 80);
      const stem = el("path", { d: `M${x},0 V${up ? n.y + n.h / 2 : n.y - n.h / 2}`, class: "s-edge" }, root);
      stem.style.setProperty("--c", COLORS[n.groupe || 0]);
      drawPath(stem, t - 150, 300);
      const dot = el("circle", { cx: x, cy: 0, r: 7, class: "s-dot" }, root);
      dot.style.setProperty("--c", COLORS[n.groupe || 0]); dot.style.animationDelay = `${t - 200}ms`;
      if (n.date) { const d = el("text", { x, y: up ? 30 : -18, class: "s-date", "text-anchor": "middle" }, root); d.textContent = n.date; d.style.animationDelay = `${t - 100}ms`; }
      drawNode(n, root, t);
    });
    return { nodes: nodes.concat([{ x: x0 - 140, y: 0, w: 1, h: 1 }, { x: -x0 + 140, y: 0, w: 1, h: 1 }]), end: 900 + nodes.length * step };
  }

  // ---------- graphiques ----------
  function countUp(textEl, value, unit, delay, dur = 900) {
    const dec = value % 1 ? 1 : 0;
    const fmt = (v) => v.toLocaleString("fr-FR", { maximumFractionDigits: dec, minimumFractionDigits: dec }) + (unit ? " " + unit : "");
    textEl.textContent = fmt(0);
    at(delay, () => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        textEl.textContent = fmt(value * e);
        if (k >= 1) clearInterval(iv);
      }, 30);
      timers.push(iv);
    });
  }

  function renderChart(a) {
    const data = a.donnees, unit = a.unite || "", n = data.length;
    const genre = a.genre;
    if (genre === "camembert") {
      const total = data.reduce((s, d) => s + Math.max(0, d.valeur), 0) || 1, R = 210, C = 2 * Math.PI * R;
      el("circle", { r: R, class: "s-ring-bg" }, root);
      let acc = 0;
      data.forEach((d, i) => {
        const frac = Math.max(0, d.valeur) / total, len = frac * C, t = 600 + i * 550, c = COLORS[i % 4];
        const seg = el("circle", { r: R, class: "s-seg", transform: `rotate(${-90 + (acc / C) * 360})` }, root);
        seg.style.setProperty("--c", c);
        seg.style.strokeDasharray = `0 ${C}`;
        at(t, () => { seg.style.transition = `stroke-dasharray ${reduced() ? 0 : 700}ms cubic-bezier(.4,0,.2,1)`; seg.style.strokeDasharray = `${Math.max(0, len - 3)} ${C}`; blip(600 + i * 90); });
        const mid = ((acc + len / 2) / C) * 2 * Math.PI - Math.PI / 2, lx = Math.cos(mid) * (R + 70), ly = Math.sin(mid) * (R + 70);
        const lead = el("path", { d: `M${Math.cos(mid) * (R + 26)},${Math.sin(mid) * (R + 26)} L${lx},${ly} H${lx + (lx >= 0 ? 30 : -30)}`, class: "s-edge" }, root);
        lead.style.setProperty("--c", c); drawPath(lead, t + 450, 300);
        const g = el("g", { class: "s-fade" }, root); g.style.animationDelay = `${t + 600}ms`;
        const anchor = lx >= 0 ? "start" : "end", tx = lx + (lx >= 0 ? 38 : -38);
        el("text", { x: tx, y: ly - 4, class: "s-clabel", "text-anchor": anchor }, g).textContent = d.label;
        const v = el("text", { x: tx, y: ly + 18, class: "s-cval", "text-anchor": anchor }, g);
        countUp(v, Math.round(frac * 1000) / 10, "%", t + 600);
        acc += len;
      });
      const center = el("g", { class: "s-fade" }, root); center.style.animationDelay = "300ms";
      const tv = el("text", { y: 10, class: "s-total", "text-anchor": "middle" }, center);
      countUp(tv, total, unit, 400, 600 + n * 550);
      el("text", { y: 40, class: "s-date", "text-anchor": "middle" }, center).textContent = "TOTAL";
      return { nodes: [{ x: -R - 300, y: -R - 60, w: 1, h: 1 }, { x: R + 300, y: R + 60, w: 1, h: 1 }], end: 800 + n * 550 };
    }
    const W = Math.max(720, Math.min(1300, n * 120)), H = 480, vals = data.map((d) => d.valeur);
    const max = Math.max(0, ...vals), min = Math.min(0, ...vals), span = max - min || 1;
    const Y = (v) => H / 2 - ((v - min) / span) * H, X0 = -W / 2;
    // axes et graduations
    const ax = el("path", { d: `M${X0},${-H / 2 - 10} V${H / 2} H${W / 2 + 20}`, class: "s-axis" }, root);
    drawPath(ax, 200, 900);
    for (let k = 0; k <= 4; k++) {
      const v = min + (span * k) / 4, y = Y(v);
      const gl = el("path", { d: `M${X0},${y} H${W / 2}`, class: "s-grid" }, root); gl.style.animationDelay = `${400 + k * 80}ms`;
      const t = el("text", { x: X0 - 12, y: y + 5, class: "s-tick", "text-anchor": "end" }, root);
      t.textContent = (Math.round(v * 10) / 10).toLocaleString("fr-FR"); t.style.animationDelay = `${400 + k * 80}ms`;
    }
    const slot = W / n, step = Math.max(180, Math.min(450, 5000 / n));
    const y0 = Y(0);
    if (genre === "courbe") {
      const pts = data.map((d, i) => [X0 + slot * (i + 0.5), Y(d.valeur)]);
      const dLine = pts.map((p, i) => (i ? "L" : "M") + p[0] + "," + p[1]).join(" ");
      const area = el("path", { d: `${dLine} L${pts[n - 1][0]},${y0} L${pts[0][0]},${y0} Z`, class: "s-area" }, root);
      area.style.animationDelay = `${900 + n * step}ms`;
      const line = el("path", { d: dLine, class: "s-edge s-line" }, root);
      line.style.setProperty("--c", COLORS[0]);
      drawPath(line, 900, n * step);
      pts.forEach((p, i) => {
        const t = 900 + i * step;
        const c = el("circle", { cx: p[0], cy: p[1], r: 6, class: "s-dot" }, root); c.style.setProperty("--c", COLORS[0]); c.style.animationDelay = `${t}ms`;
        const v = el("text", { x: p[0], y: p[1] - 16, class: "s-cval", "text-anchor": "middle" }, root); countUp(v, data[i].valeur, unit, t, 500);
        const lb = el("text", { x: p[0], y: H / 2 + 28, class: "s-clabel", "text-anchor": "middle" }, root); lb.textContent = data[i].label; lb.style.animationDelay = `${t}ms`;
        at(t, () => blip(500 + i * 60));
      });
      particles(el("g", {}, root), [line], 1000 + n * step);
    } else {
      const bw = Math.min(90, slot * 0.6);
      data.forEach((d, i) => {
        const t = 900 + i * step, x = X0 + slot * (i + 0.5), y = Y(d.valeur), c = COLORS[d.valeur < 0 ? 2 : i % 2 === 0 ? 0 : 1];
        const top = Math.min(y, y0), h = Math.max(2, Math.abs(y0 - y));
        const bar = el("rect", { x: x - bw / 2, y: top, width: bw, height: h, rx: 3, class: "s-bar" }, root);
        bar.style.setProperty("--c", c); bar.style.transformOrigin = `${x}px ${y0}px`; bar.style.animationDelay = `${t}ms`;
        el("rect", { x: x - bw / 2, y: top, width: bw, height: 3, class: "s-bartop" }, root).style.cssText = `--c:${c};animation-delay:${t + 500}ms`;
        const v = el("text", { x, y: top - 12, class: "s-cval", "text-anchor": "middle" }, root); countUp(v, d.valeur, unit, t, 700);
        const lb = el("text", { x, y: H / 2 + 28, class: "s-clabel", "text-anchor": "middle" }, root); lb.textContent = d.label; lb.style.animationDelay = `${t}ms`;
        at(t, () => blip(500 + i * 60));
      });
    }
    return { nodes: [{ x: X0 - 80, y: -H / 2 - 60, w: 1, h: 1 }, { x: W / 2 + 40, y: H / 2 + 60, w: 1, h: 1 }], end: 900 + n * step };
  }

  // ---------- scène ----------
  function ensureStage() {
    if (stage) return;
    stage = document.createElement("div"); stage.id = "stage";
    svg = el("svg", { id: "stagesvg", preserveAspectRatio: "xMidYMid meet" });
    const defs = el("defs", {}, svg);
    const mk = el("marker", { id: "s-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
    el("path", { d: "M0,0 L10,5 L0,10 z", class: "s-arrowhead" }, mk);
    const gr = el("radialGradient", { id: "s-fill", cx: "50%", cy: "40%", r: "80%" }, defs);
    el("stop", { offset: "0%", "stop-color": "rgba(20,60,95,.92)" }, gr); el("stop", { offset: "100%", "stop-color": "rgba(4,14,26,.94)" }, gr);
    const ga = el("linearGradient", { id: "s-areafill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el("stop", { offset: "0%", "stop-color": "rgba(73,198,255,.35)" }, ga); el("stop", { offset: "100%", "stop-color": "rgba(73,198,255,0)" }, ga);
    stage.appendChild(svg);
    const x = document.createElement("button"); x.className = "stage-x"; x.textContent = "✕"; x.setAttribute("aria-label", "Fermer le schéma");
    x.onclick = hide; stage.appendChild(x);
    document.body.appendChild(stage);
  }

  function clear() {
    timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    timers = [];
    if (root) root.remove();
  }

  function fit(nodes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach((n) => { x0 = Math.min(x0, n.x - n.w / 2); x1 = Math.max(x1, n.x + n.w / 2); y0 = Math.min(y0, n.y - n.h / 2); y1 = Math.max(y1, n.y + n.h / 2); });
    const m = 60;
    let w = x1 - x0 + 2 * m, h = y1 - y0 + 2 * m;
    // pas de zoom excessif sur les petits schémas
    const box = stage.getBoundingClientRect(), minScale = Math.max(w / box.width, h / box.height, 0.62);
    const W2 = box.width * minScale, H2 = box.height * minScale;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    svg.setAttribute("viewBox", `${cx - W2 / 2} ${cy - H2 / 2} ${W2} ${H2}`);
  }

  function show(a, opts = {}) {
    if (opts.sound) soundOn = opts.sound;
    ensureStage(); clear();
    const pad = opts.padding || {};
    Object.assign(stage.style, { left: (pad.left || 60) + "px", right: (pad.right || 60) + "px", top: (pad.top || 120) + "px", bottom: (pad.bottom || 130) + "px" });
    root = el("g", { class: "s-root" }, svg);
    document.body.classList.add("stage-on");
    let res;
    const kind = a.genre_schema;
    if (kind === "graphique") res = renderChart(a);
    else if (kind === "chronologie") res = renderTimeline(a);
    else { const r = stage.getBoundingClientRect(); res = renderGraph(a, kind, { w: r.width || 1200, h: r.height || 700 }); }
    fit(res.nodes);
    // balayage lumineux à l'ouverture
    document.body.classList.remove("stage-scan"); void document.body.offsetWidth; document.body.classList.add("stage-scan");
    return res.end;
  }

  function hide() {
    clear();
    document.body.classList.remove("stage-on");
  }

  window.JarvisSchema = { show, hide, active: () => document.body.classList.contains("stage-on") };
})();
