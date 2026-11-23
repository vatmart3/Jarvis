// Sound design Jarvis : tous les sons sont synthétisés avec Web Audio (aucun fichier externe).
let ctx = null, master = null, enabled = () => true;

export function audioContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
export function setEnabled(fn) { enabled = fn; }
const out = () => { audioContext(); return master; };

function tone(freq, { type = "sine", dur = 0.15, vol = 0.12, slide = 1, delay = 0, attack = 0.008 } = {}) {
  if (!enabled()) return;
  const c = audioContext(), t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out()); o.start(t); o.stop(t + dur + 0.05);
}

function noise({ dur = 0.45, from = 400, to = 4000, vol = 0.18, q = 1.2, delay = 0 } = {}) {
  if (!enabled()) return;
  const c = audioContext(), t = c.currentTime + delay, n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = q;
  f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out()); src.start(t); src.stop(t + dur + 0.05);
}

export const sfx = {
  bip: (f = 1320) => tone(f, { dur: 0.07, vol: 0.06, type: "sine" }),
  tick: () => tone(2400, { dur: 0.03, vol: 0.03, type: "triangle" }),
  ecoute: () => { tone(660, { dur: 0.12, vol: 0.09 }); tone(990, { dur: 0.16, vol: 0.09, delay: 0.1 }); },
  fin_ecoute: () => { tone(990, { dur: 0.1, vol: 0.07 }); tone(660, { dur: 0.14, vol: 0.07, delay: 0.08 }); },
  confirmation: () => { tone(523, { dur: 0.1, vol: 0.1, type: "triangle" }); tone(784, { dur: 0.1, vol: 0.1, type: "triangle", delay: 0.09 }); tone(1046, { dur: 0.22, vol: 0.1, type: "triangle", delay: 0.18 }); },
  annulation: () => { tone(440, { dur: 0.14, vol: 0.1, type: "sawtooth", slide: 0.6 }); tone(330, { dur: 0.2, vol: 0.08, type: "sawtooth", slide: 0.6, delay: 0.12 }); },
  whoosh: () => noise({ dur: 0.5, from: 300, to: 5000, vol: 0.16 }),
  whoosh_inverse: () => noise({ dur: 0.4, from: 5000, to: 300, vol: 0.12 }),
  attrape: () => { tone(880, { dur: 0.06, vol: 0.07 }); tone(1320, { dur: 0.08, vol: 0.05, delay: 0.04 }); },
  lache: () => tone(1100, { dur: 0.09, vol: 0.05, slide: 0.7 }),
  reveil: () => { noise({ dur: 0.9, from: 120, to: 2400, vol: 0.1 }); tone(220, { dur: 0.8, vol: 0.06, slide: 2 }); tone(880, { dur: 0.3, vol: 0.06, delay: 0.6 }); },
  veille: () => { tone(660, { dur: 0.6, vol: 0.05, slide: 0.4 }); },
  erreur: () => { tone(220, { dur: 0.18, vol: 0.1, type: "square" }); tone(180, { dur: 0.25, vol: 0.1, type: "square", delay: 0.16 }); },
  apparition: (i = 0) => tone(700 + i * 90, { dur: 0.12, vol: 0.04, slide: 1.5 }),
};
