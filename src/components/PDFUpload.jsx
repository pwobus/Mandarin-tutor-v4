// ===================================================
// File: src/components/PDFUpload.jsx  (drop-in)
// Smarter parser + "Paste text/CSV" + preview
// ===================================================
import React, { useMemo, useState } from 'react';
import { useConversationStore } from '../store/useConversationStore';

// pdf.js worker (avoid "fake worker" warning)
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.entry';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ---------- parsing helpers ----------
const HANZI_RE = /[\p{Script=Han}]+/u;
// includes tone-marked vowels or 1–5 digits style
const PINYIN_MARKS = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
const PINYIN_NUM   = /\b[a-zü]+[1-5]\b/i;

function isLikelyPinyin(s) {
  const t = String(s || '').trim();
  return PINYIN_MARKS.test(t) || PINYIN_NUM.test(t);
}
function cleanSpaces(s){ return String(s || '').replace(/\s+/g,' ').trim(); }

/**
 * Flexible line parser.
 * Accepts: "你好 nǐ hǎo hello", "你好 - nǐ hǎo - hello", "你好\tnǐ hǎo\thello"
 * Also tolerates extra columns by best-effort picking Hanzi, Pinyin, English.
 */
function parseLinesToVocab(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const out = [];
  for (const line of lines) {
    // Try common tokenizations
    let parts = line.split('\t');
    if (parts.length < 3) parts = line.split(/\s+-\s+/);
    if (parts.length < 3) parts = line.split(/\s{2,}/);
    if (parts.length < 3) parts = line.split(/\s+/);

    // Best-effort classification
    let hanzi = '';
    let pinyin = '';
    let english = '';

    // Find a token containing Hanzi
    for (const tok of parts) {
      if (HANZI_RE.test(tok)) { hanzi = cleanSpaces(tok); break; }
    }
    // Find a token that looks like pinyin
    for (const tok of parts) {
      if (!tok) continue;
      const t = cleanSpaces(tok);
      if (t === hanzi) continue;
      if (isLikelyPinyin(t)) { pinyin = t; break; }
    }
    // Everything else as English (join remaining non-hanzi/non-pinyin)
    if (!english) {
      const rest = parts
        .map(cleanSpaces)
        .filter(Boolean)
        .filter(t => t !== hanzi && t !== pinyin);
      // Heuristic: prefer ASCII/latin remainder as English gloss
      const ascii = rest.filter(s => /^[\p{Letter}\p{Number}\p{Punctuation}\p{Separator}]+$/u.test(s));
      english = cleanSpaces((ascii.length ? ascii : rest).join(' '));
    }

    if (hanzi && pinyin && english) {
      out.push({ hanzi, pinyin, english });
    }
  }
  return out;
}

// ---------- component ----------
export default function PDFUpload() {
  const { setVocabulary, loadSampleVocabulary } = useConversationStore();
  const [tab, setTab] = useState('pdf'); // 'pdf' | 'paste'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState([]);

  // Parse-on-change for paste tab
  useMemo(() => {
    if (tab !== 'paste') return;
    if (!raw.trim()) { setPreview([]); return; }
    const v = parseLinesToVocab(raw);
    setPreview(v.slice(0, 50)); // show first 50 rows preview
  }, [raw, tab]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

      let all = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items.map(it => it.str);
        // Join with single spaces to keep token order; also keep newlines to help row detection
        all += strings.join(' ') + '\n';
      }

      const vocab = parseLinesToVocab(all);
      if (vocab.length === 0) {
        setErr('Parsed PDF but did not find vocabulary rows. Try the “Paste text/CSV” tab or sample vocab.');
        setPreview([]);
        return;
      }
      setVocabulary(vocab);
      setPreview(vocab.slice(0, 50));
    } catch (e2) {
      console.error('[PDFUpload] error', e2);
      setErr('Failed to read PDF. Use the “Paste text/CSV” tab or sample vocab.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  function onUsePreview() {
    if (!preview.length) { setErr('Nothing to import.'); return; }
    setVocabulary(preview); // import only preview rows or switch to full if you prefer
  }

  return (
    <div className="p-3 bg-white rounded shadow">
      <h2 className="font-semibold mb-3 text-sm">Vocabulary</h2>

      <div className="flex gap-2 mb-3">
        <button
          className={`px-2 py-1 text-xs rounded ${tab==='pdf'?'bg-gray-900 text-white':'bg-gray-100'}`}
          onClick={() => setTab('pdf')}
        >Upload PDF</button>
        <button
          className={`px-2 py-1 text-xs rounded ${tab==='paste'?'bg-gray-900 text-white':'bg-gray-100'}`}
          onClick={() => setTab('paste')}
        >Paste text / CSV</button>
        <button
          className="px-2 py-1 text-xs rounded bg-emerald-600 text-white"
          onClick={loadSampleVocabulary}
        >Use sample</button>
      </div>

      {tab === 'pdf' && (
        <>
          <input type="file" accept="application/pdf" onChange={onFile} disabled={busy} />
          {busy && <div className="text-xs text-gray-500 mt-2">Reading PDF…</div>}
        </>
      )}

      {tab === 'paste' && (
        <>
          <textarea
            rows={6}
            className="w-full text-xs p-2 border rounded"
            placeholder={`One row per line, e.g.\n你好\tnǐ hǎo\thello\n我叫华语巴迪 - wǒ jiào huáyǔ bā dí - my name is Huayu Buddy`}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
          <div className="mt-2">
            <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded" onClick={onUsePreview}>
              Import parsed rows ({preview.length})
            </button>
          </div>
        </>
      )}

      {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

      {!!preview.length && (
        <div className="mt-3">
          <div className="text-xs text-gray-600 mb-1">Preview (first {preview.length} rows):</div>
          <table className="w-full text-xs border">
            <thead><tr><th className="border p-1">Hanzi</th><th className="border p-1">Pinyin</th><th className="border p-1">English</th></tr></thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={i}>
                  <td className="border p-1">{r.hanzi}</td>
                  <td className="border p-1">{r.pinyin}</td>
                  <td className="border p-1">{r.english}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

