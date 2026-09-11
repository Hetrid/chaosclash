// LEGEND ARENA — generated SFX (WebAudio) + TTS announcer (speechSynthesis).
// All sounds are synthesized originals; no copyrighted audio.
let ctx = null, master = null, muted = false, ttsVoice = null, ttsOn = true;
const lastPlay = {};   // sfx key -> t (throttle)
const annCd = {};      // announcer key -> t

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
  } catch { ctx = null; }
  pickVoice();
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.35; }
export function setTTS(on) { ttsOn = on; }
function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices();
  ttsVoice = vs.find(v => v.lang === 'en-US' && /google/i.test(v.name)) || vs.find(v => v.lang.startsWith('en')) || vs[0] || null;
}
if (typeof window !== 'undefined' && window.speechSynthesis) speechSynthesis.onvoiceschanged = pickVoice;

function env(g, t0, a, d, peak = 1) { g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
function tone({ freq = 440, type = 'sine', dur = 0.15, delay = 0, slide = 0, vol = 1 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  env(g, t0, 0.008, dur, vol);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise({ dur = 0.2, delay = 0, vol = 0.6, freq = 900 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const n = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  n.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain(); env(g, t0, 0.005, dur, vol);
  n.connect(f); f.connect(g); g.connect(master); n.start(t0);
}

export function sfx(key) {
  if (!ctx || muted) return;
  const now = ctx.currentTime;
  if (lastPlay[key] && now - lastPlay[key] < 0.06) return;
  lastPlay[key] = now;
  switch (key) {
    case 'hit': tone({ freq: 220 + Math.random() * 60, type: 'square', dur: 0.05, vol: 0.25 }); break;
    case 'hitBig': tone({ freq: 140, type: 'square', dur: 0.1, vol: 0.4 }); noise({ dur: 0.08, vol: 0.25, freq: 500 }); break;
    case 'cast': tone({ freq: 620, type: 'triangle', dur: 0.12, slide: 240, vol: 0.4 }); break;
    case 'ult': tone({ freq: 300, type: 'sawtooth', dur: 0.3, slide: 380, vol: 0.5 }); tone({ freq: 450, type: 'triangle', dur: 0.35, delay: 0.05, vol: 0.4 }); break;
    case 'kill': tone({ freq: 540, dur: 0.12, vol: 0.5 }); tone({ freq: 810, dur: 0.18, delay: 0.09, vol: 0.5 }); break;
    case 'death': tone({ freq: 200, type: 'sawtooth', dur: 0.5, slide: -140, vol: 0.55 }); noise({ dur: 0.4, vol: 0.4, freq: 300 }); break;
    case 'turretShot': tone({ freq: 760, type: 'square', dur: 0.07, slide: -300, vol: 0.28 }); break;
    case 'turretDown': noise({ dur: 0.7, vol: 0.7, freq: 240 }); tone({ freq: 110, type: 'sawtooth', dur: 0.6, slide: -60, vol: 0.5 }); break;
    case 'objective': tone({ freq: 90, type: 'sawtooth', dur: 0.9, slide: 40, vol: 0.6 }); noise({ dur: 0.8, vol: 0.5, freq: 200 }); break;
    case 'levelup': [520, 660, 780].forEach((f, i) => tone({ freq: f, dur: 0.14, delay: i * 0.08, vol: 0.4 })); break;
    case 'gold': tone({ freq: 1180, dur: 0.05, vol: 0.18 }); break;
    case 'buy': tone({ freq: 880, dur: 0.06, vol: 0.3 }); tone({ freq: 1320, dur: 0.09, delay: 0.06, vol: 0.3 }); break;
    case 'recall': tone({ freq: 380, type: 'sine', dur: 0.8, slide: 260, vol: 0.25 }); break;
    case 'recallDone': [660, 990].forEach((f, i) => tone({ freq: f, dur: 0.16, delay: i * 0.1, vol: 0.4 })); break;
    case 'victory': [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.32, delay: i * 0.16, vol: 0.5 })); break;
    case 'defeat': [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.4, delay: i * 0.2, vol: 0.5 })); break;
    case 'firstblood': tone({ freq: 980, dur: 0.1, vol: 0.5 }); tone({ freq: 1245, dur: 0.22, delay: 0.1, vol: 0.5 }); break;
    case 'ping': tone({ freq: 1400, dur: 0.06, vol: 0.25 }); break;
    case 'hunt': noise({ dur: 0.25, vol: 0.5, freq: 700 }); tone({ freq: 160, type: 'sawtooth', dur: 0.25, slide: -80, vol: 0.45 }); break;
  }
}

// TTS announcer with per-key cooldown so fights don't spam speech.
export function announce(key, text, { cd = 8, force = false } = {}) {
  const now = performance.now() / 1000;
  if (!force && annCd[key] && now - annCd[key] < cd) return;
  annCd[key] = now;
  if (!ttsOn || muted || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    if (ttsVoice) u.voice = ttsVoice;
    u.rate = 1.02; u.pitch = 0.92; u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch { /* TTS unavailable */ }
}
