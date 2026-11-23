// Voix de Jarvis en flux : le texte arrive par morceaux (LLM en streaming), chaque phrase complète part
// immédiatement en synthèse vocale, la suivante est préparée pendant que la première est lue.
// Moteurs : ElevenLabs (via proxy, clé côté serveur), voix du Mac (say / Kokoro, serveur local), navigateur (speechSynthesis).
// Le son passe par un AnalyserNode : son niveau anime l'orbe.
import { audioContext } from "./sfx.js";

const SENTENCE = /^[\s\S]*?[.!?…:;](?=\s|$)["»)\]]*/;

export function createVoice({ getChoice, endpoints = {}, onState = () => {}, onError = () => {} }) {
  let analyser = null, data = null, current = null, queue = [], playing = false, buffer = "", gen = 0, synthLevel = 0, utterance = null;

  function ensureAnalyser() {
    if (analyser) return analyser;
    const c = audioContext();
    analyser = c.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.6;
    analyser.connect(c.destination);
    data = new Uint8Array(analyser.fftSize);
    return analyser;
  }

  function level() {
    if (utterance) { synthLevel *= 0.9; return Math.min(1, synthLevel + 0.12 + Math.random() * 0.05); }
    if (!analyser || !current) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
    return Math.min(1, Math.sqrt(sum / data.length) * 4.5);
  }

  // ---------- récupération de l'audio d'une phrase (lancée dès la mise en file : préchargement) ----------
  async function fetchAudio(text, choice) {
    if (choice.engine === "elevenlabs") {
      const r = await fetch(endpoints.elevenlabs || "/api/voix", { method: "POST", headers: endpoints.headers?.() || { "Content-Type": "application/json", "X-Jarvis": "1" }, body: JSON.stringify({ text, voice: choice.voice }) });
      if (!r.ok) throw new Error("ElevenLabs indisponible (" + r.status + ")");
      return r.arrayBuffer();
    }
    const r = await fetch(endpoints.local || "/api/tts", { method: "POST", headers: { "Content-Type": "application/json", "X-Jarvis": "1" }, body: JSON.stringify({ engine: choice.engine, voice: choice.voice, text }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Voix indisponible."); }
    return r.arrayBuffer();
  }

  function enqueue(text) {
    text = text.replace(/\s+/g, " ").trim();
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return;
    const choice = getChoice();
    const item = { text, choice, gen };
    if (choice.engine !== "browser") item.audio = fetchAudio(text, choice).catch((e) => { item.err = e; return null; });
    queue.push(item);
    if (!playing) playNext();
  }

  function speakBrowser(text, voiceName) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "fr-FR";
      const voices = synth.getVoices() || [];
      u.voice = voices.find((v) => v.name === voiceName) || voices.find((v) => /^fr/i.test(v.lang)) || null;
      u.onboundary = () => { synthLevel = 0.7 + Math.random() * 0.3; };
      u.onend = u.onerror = () => { utterance = null; resolve(); };
      utterance = u;
      synth.speak(u);
    });
  }

  async function playBuffer(arrayBuf) {
    const c = audioContext();
    const buf = await c.decodeAudioData(arrayBuf.slice(0));
    return new Promise((resolve) => {
      const src = c.createBufferSource(); src.buffer = buf; src.connect(ensureAnalyser());
      current = src; src.onended = () => { if (current === src) current = null; resolve(); };
      src.start();
    });
  }

  async function playNext() {
    const item = queue.shift();
    if (!item) { playing = false; onState(false); return; }
    playing = true; onState(true);
    try {
      if (item.choice.engine === "browser") await speakBrowser(item.text, item.choice.voice);
      else {
        const audio = await item.audio;
        if (item.gen !== gen) return; // coupé entre-temps
        if (!audio) { onError(item.err); await speakBrowser(item.text, ""); } // repli : voix du navigateur
        else await playBuffer(audio);
      }
    } catch (e) { onError(e); }
    if (item.gen === gen) playNext();
  }

  // ---------- API ----------
  const api = {
    // Morceau de texte en flux : on parle dès qu'une phrase est complète.
    feed(delta) {
      buffer += delta;
      for (;;) {
        const m = buffer.match(SENTENCE);
        if (m && m[0].trim().length >= 2) { enqueue(m[0]); buffer = buffer.slice(m[0].length); continue; }
        // longue proposition sans ponctuation finale : on coupe à la virgule pour démarrer plus tôt
        if (buffer.length > 110) { const k = buffer.lastIndexOf(", ", 100); if (k > 30) { enqueue(buffer.slice(0, k + 1)); buffer = buffer.slice(k + 2); continue; } }
        break;
      }
    },
    end() { if (buffer.trim()) enqueue(buffer); buffer = ""; },
    say(text) {
      return new Promise((resolve) => {
        api.feed(String(text || "") + " "); api.end();
        const check = setInterval(() => { if (!playing && !queue.length) { clearInterval(check); resolve(); } }, 120);
      });
    },
    stop() {
      gen++; queue = []; buffer = "";
      try { current?.stop(); } catch (_) {}
      current = null;
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      utterance = null;
      if (playing) { playing = false; onState(false); }
    },
    level,
    get speaking() { return playing; },
    // Texte en cours de lecture : sert à ignorer l'écho de sa propre voix (barge-in).
    get currentText() { return queue.length || playing ? (queue[0]?.text || "") : ""; },
  };
  return api;
}

// ---------- mot d'éveil Porcupine (optionnel, si une AccessKey Picovoice est fournie) ----------
export async function startPorcupine(accessKey, onWake) {
  const pv = await import("https://cdn.jsdelivr.net/npm/@picovoice/porcupine-web@4.0.1/+esm");
  const wvp = await import("https://cdn.jsdelivr.net/npm/@picovoice/web-voice-processor@4.0.10/+esm");
  const model = { publicPath: "https://raw.githubusercontent.com/Picovoice/porcupine/master/lib/common/porcupine_params.pv", forceWrite: false };
  const worker = await pv.PorcupineWorker.create(accessKey, pv.BuiltInKeyword.Jarvis, () => onWake(), model);
  await wvp.WebVoiceProcessor.subscribe(worker);
  return { async stop() { await wvp.WebVoiceProcessor.unsubscribe(worker); await worker.release(); } };
}
