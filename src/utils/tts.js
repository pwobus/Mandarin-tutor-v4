// File: src/utils/tts.js
// Clean, ESM-safe TTS with server (OpenAI) default, web-speech fallback,
// and viseme events for the avatar. No top-level await/CommonJS.

let AC = null;
let unlocked = false;
let activeAudio = null;

function startVisemes({ pinyin, durationMs }) {
  try { window.dispatchEvent(new CustomEvent('hb:viseme:start', { detail: { pinyin, durationMs } })); } catch {}
}
function stopVisemes() {
  try { window.dispatchEvent(new CustomEvent('hb:viseme:stop')); } catch {}
}

export async function unlockAudio() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!AC) AC = new Ctor();
    if (AC.state === 'suspended') await AC.resume();
    if (!unlocked) {
      const b = AC.createBuffer(1, AC.sampleRate / 32, AC.sampleRate);
      const src = AC.createBufferSource();
      src.buffer = b; src.connect(AC.destination); src.start(0);
      unlocked = true;
    }
    return AC;
  } catch {
    return null;
  }
}

export function hasWebVoices() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
export function listVoices() {
  return new Promise((resolve) => {
    if (!hasWebVoices()) return resolve({ all: [], zh: [], en: [] });
    const synth = window.speechSynthesis;
    let tries = 0;
    const finish = () => {
      const all = synth.getVoices() || [];
      const zh = all.filter((v) => /zh|cmn|chi|yue/i.test(v.lang));
      const en = all.filter((v) => /^en[-_]/i.test(v.lang));
      resolve({ all, zh, en });
    };
    const timer = setInterval(() => {
      tries++;
      const got = synth.getVoices();
      if ((got && got.length) || tries > 20) { clearInterval(timer); finish(); }
    }, 100);
    try { synth.onvoiceschanged = () => { clearInterval(timer); finish(); }; } catch {}
  });
}

function playHtmlAudio(audio, { onStart, onEnd, pinyin }) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onended = null;
      audio.onerror = null;
    };
    audio.onloadedmetadata = () => {
      const durationMs = Math.max(300, (audio.duration || 1) * 1000);
      try { onStart && onStart({ audio, durationMs }); } catch {}
      try { window.dispatchEvent(new CustomEvent('hb:viseme:audio', { detail: { audio } })); } catch {}
      if (pinyin) startVisemes({ pinyin, durationMs });
    };
    audio.onended = () => {
      try { onEnd && onEnd(); } catch {}
      if (pinyin) stopVisemes();
      try { window.dispatchEvent(new CustomEvent('hb:viseme:stopAudio')); } catch {}
      cleanup();
      resolve();
    };
    audio.onerror = (e) => { if (pinyin) stopVisemes(); cleanup(); reject(e); };

    try { if (activeAudio && !activeAudio.paused) activeAudio.pause(); } catch {}
    activeAudio = audio;

    audio.play().catch((e) => {
      unlockAudio().then(() => audio.play().then(()=>{}).catch(reject)).catch(() => reject(e));
    });
  });
}

async function speakWebSpeech({ text, lang, voice, pinyin, onStart, onEnd }) {
  if (!hasWebVoices()) throw new Error('Web speech not available');
  await unlockAudio();

  const synth = window.speechSynthesis;
  const { all } = await listVoices();
  const utt = new SpeechSynthesisUtterance(text);
  if (lang) utt.lang = lang;

  if (voice && all.length) {
    const v = all.find(
      (v) =>
        (v.name && v.name.toLowerCase() === String(voice).toLowerCase()) ||
        (v.voiceURI && v.voiceURI.toLowerCase() === String(voice).toLowerCase())
    );
    if (v) utt.voice = v;
  }

  const estMs = Math.max(600, Math.min(6000, text.split(/\s+/).filter(Boolean).length * 400));

  return new Promise((resolve, reject) => {
    let started = false;
    utt.onstart = () => {
      started = true;
      try { onStart && onStart({ audio: null, durationMs: estMs }); } catch {}
      if (pinyin) startVisemes({ pinyin, durationMs: estMs });
    };
    utt.onend = () => { if (pinyin) stopVisemes(); try { onEnd && onEnd(); } catch {} resolve(); };
    utt.onerror = (e) => { if (pinyin) stopVisemes(); if (!started) reject(e); else resolve(); };
    try { synth.speak(utt); } catch (e) { reject(e); }
  });
}

/**
 * speakLine({ text, lang, voice, engine, pinyin, onStart, onEnd })
 * engine: 'server' (default) | 'web'
 * server voices allowed: nova, shimmer, echo, onyx, fable, alloy, ash, sage, coral
 */
export async function speakLine(opts) {
  const { text, lang, voice, engine, pinyin, onStart, onEnd } = opts || {};
  const t = String(text || '').trim();
  if (!t) return;
  if (engine === 'web') {
    return speakWebSpeech({ text: t, lang: lang || 'zh-CN', voice, pinyin, onStart, onEnd });
  }

  await unlockAudio();

  const safeVoice = String(voice || '').toLowerCase();
  const allowed = new Set(['nova','shimmer','echo','onyx','fable','alloy','ash','sage','coral']);
  const chosen = allowed.has(safeVoice) ? safeVoice : 'alloy';

  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: t, voice: chosen }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`[hb-tts] server tts failed ${r.status} ${detail}`);
  }

  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try { await playHtmlAudio(audio, { onStart, onEnd, pinyin }); }
  finally { try { URL.revokeObjectURL(url); } catch {} }
}

