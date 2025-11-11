// File: src/utils/stt.js  (FULL FILE)
// Transcribe audio Blob by posting to our server Whisper route.
export async function transcribeBlobToText(blob, { language = 'zh' } = {}) {
  if (!(blob instanceof Blob)) {
    throw new Error('Expected a Blob to transcribe');
  }

  const contentType = blob.type || 'audio/webm';

  const resp = await fetch('/api/stt', {
    method: 'POST',
    // Our server route uses express.raw to capture the binary audio payload, so we need to
    // send the Blob directly with an audio content-type instead of JSON-encoding it.
    headers: {
      'Content-Type': contentType,
      'X-STT-Language': language,
    },
    body: blob,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`STT server error ${resp.status}: ${t.slice(0, 500)}`);
  }
  const data = await resp.json().catch(() => ({}));
  return (data?.text || '').trim();
}
