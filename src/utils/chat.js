// File: src/utils/chat.js
export async function chatStream({ model = 'gpt-4o-mini', messages = [], temperature = 0.6, onDelta }) {
  const r = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
    body: JSON.stringify({ model, messages, temperature }),
  });
  if (!r.ok || !r.body) throw new Error(`stream failed ${r.status}`);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx).trim(); buf = buf.slice(idx + 2);
      if (!chunk.startsWith('data:')) continue;
      const json = chunk.slice(5).trim();
      try {
        const evt = JSON.parse(json);
        if (evt.delta && onDelta) onDelta(evt.delta);
        if (evt.done) return;
        if (evt.error) throw new Error(evt.error);
      } catch { /* ignore parse errors */ }
    }
  }
}

