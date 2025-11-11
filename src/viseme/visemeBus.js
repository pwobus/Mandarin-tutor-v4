// File: src/viseme/visemeBus.js
// Tiny event helpers. Fire these from your TTS call.
export function startVisemes({ pinyin, durationMs }) {
  window.dispatchEvent(new CustomEvent('hb:viseme:start', { detail: { pinyin, durationMs }}));
}
export function stopVisemes() {
  window.dispatchEvent(new CustomEvent('hb:viseme:stop'));
}

