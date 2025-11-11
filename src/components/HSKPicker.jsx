// File: src/components/HSKPicker.jsx
import React, { useCallback, useMemo, useState } from 'react';
import { useConversationStore } from '../store/useConversationStore';

const LEVELS = [1, 2, 3, 4, 5];

export default function HSKPicker() {
  const { setVocabulary } = useConversationStore();

  const [levels, setLevels] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb_hsk_levels') || '[1]'); } catch { return [1]; }
  });
  const [limit, setLimit] = useState(() => {
    const v = Number(localStorage.getItem('hb_hsk_limit') || '60');
    return Number.isFinite(v) ? v : 60;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState({
    items: [],   // [{level, hanzi, pinyin, english}]
    total: 0,    // total available in server response (after level filter)
    source: '',  // xlsx path (if provided by server)
  });

  const levelsParam = useMemo(() => levels.join(','), [levels]);
  const canLoad = levels.length > 0 && !busy;

  const toggleLevel = useCallback((lv) => {
    setLevels(prev => {
      const has = prev.includes(lv);
      const next = has ? prev.filter(x => x !== lv) : [...prev, lv].sort((a,b)=>a-b);
      try { localStorage.setItem('hb_hsk_levels', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  function sampleRandom(items, n) {
    if (!Array.isArray(items) || items.length === 0) return [];
    if (!Number.isFinite(n) || n <= 0) return [];
    if (items.length <= n) return [...items];
    // Fisher–Yates partial shuffle
    const arr = [...items];
    for (let i = arr.length - 1; i > arr.length - 1 - n; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(arr.length - n);
  }

  const fetchHSK = useCallback(async () => {
    setBusy(true); setErr('');
    try {
      const url = levelsParam ? `/api/hsk?levels=${levelsParam}` : '/api/hsk';
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text().catch(()=> 'hsk error'));
      const j = await r.json();
      const items = (Array.isArray(j) ? j : j.items) || [];
      const total = Array.isArray(j) ? j.length : Number(j.count || items.length);
      const source = Array.isArray(j) ? '' : (j.source || '');

      const normalized = items.map(x => ({
        level: Number(x.level ?? 1),
        hanzi: String(x.hanzi || '').trim(),
        pinyin: String(x.pinyin || '').trim(),
        english: String(x.english || '').trim(),
      })).filter(w => w.hanzi);

      const n = Math.max(1, Number(limit) || 1);
      const sample = sampleRandom(normalized, n);

      setPreview({ items: sample, total: normalized.length || total, source });
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
      try { localStorage.setItem('hb_hsk_limit', String(limit)); } catch {}
    }
  }, [levelsParam, limit]);

  const onPreviewToggle = useCallback(() => {
    const opening = !previewOpen;
    setPreviewOpen(opening);
    if (opening) fetchHSK();
  }, [previewOpen, fetchHSK]);

  const loadPreviewSet = useCallback(() => {
    if (!preview.items.length) return;
    const vocab = preview.items.map(x => ({
      hanzi: x.hanzi, pinyin: x.pinyin, english: x.english, level: x.level,
    }));
    setVocabulary(vocab);
  }, [preview.items, setVocabulary]);

  const loadFreshRandom = useCallback(async () => {
    if (!canLoad) return;
    setBusy(true); setErr('');
    try {
      const url = levelsParam ? `/api/hsk?levels=${levelsParam}` : '/api/hsk';
      const r = await fetch(url);
      if (!r.ok) throw new Error(await r.text().catch(()=> 'hsk error'));
      const j = await r.json();
      const items = (Array.isArray(j) ? j : j.items) || [];
      const normalized = items.map(x => ({
        level: Number(x.level ?? 1),
        hanzi: String(x.hanzi || '').trim(),
        pinyin: String(x.pinyin || '').trim(),
        english: String(x.english || '').trim(),
      })).filter(w => w.hanzi);

      const n = Math.max(1, Number(limit) || 1);
      const picked = sampleRandom(normalized, n);
      const vocab = picked.map(x => ({
        hanzi: x.hanzi, pinyin: x.pinyin, english: x.english, level: x.level,
      }));
      setVocabulary(vocab);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, [canLoad, levelsParam, limit, setVocabulary]);

  return (
    <div className="p-4 bg-white rounded shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">HSK Vocabulary Loader</h3>
        <div className="text-[11px] text-gray-500">Select levels → Preview → Load</div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {LEVELS.map(lv => (
          <button
            key={lv}
            onClick={() => toggleLevel(lv)}
            className={`px-2 py-1 text-xs rounded border ${
              levels.includes(lv) ? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-gray-700'
            }`}
          >
            HSK{lv}
          </button>
        ))}
      </div>

      <div className="flex items-center flex-wrap gap-3 mb-3">
        <label className="text-xs text-gray-700">Limit words:</label>
        <input
          type="number"
          min={1}
          step={1}
          className="border rounded px-2 py-1 text-xs w-24"
          value={limit}
          onChange={e => setLimit(e.target.value)}
          title="Number of words to preview / load"
        />

        <button
          onClick={onPreviewToggle}
          className="px-3 py-1 text-sm rounded bg-slate-700 text-white"
        >
          {previewOpen ? 'Hide preview' : `Preview (${Math.max(1, Number(limit) || 1)})`}
        </button>

        <button
          disabled={!canLoad}
          onClick={loadPreviewSet}
          className={`px-3 py-1 text-sm rounded ${canLoad ? 'bg-emerald-600 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
          title="Load exactly what you see in the preview"
        >
          Load preview set
        </button>

        <button
          disabled={!canLoad}
          onClick={loadFreshRandom}
          className={`px-3 py-1 text-sm rounded ${canLoad ? 'bg-gray-900 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
          title="Load a fresh random sample from the selected levels"
        >
          Load random
        </button>

        <button
          disabled={busy}
          onClick={fetchHSK}
          className="px-2 py-1 text-xs rounded bg-slate-600 text-white"
          title="Re-sample a new preview"
        >
          Re-sample preview
        </button>
      </div>

      {err && <div className="text-xs text-red-600 mb-2">{err}</div>}

      {previewOpen && (
        <div className="border rounded p-2 bg-slate-50">
          <div className="flex items-center justify-between mb-2 text-xs text-gray-700">
            <div>Source: <span className="font-mono">{preview.source || '(server)'}</span></div>
            <div>Total available: <b>{preview.total}</b> • Showing: <b>{preview.items.length}</b></div>
          </div>
          <div className="max-h-56 overflow-auto text-xs">
            <table className="w-full table-auto">
              <thead>
                <tr>
                  <th className="text-left pr-2">Level</th>
                  <th className="text-left pr-2">Hanzi</th>
                  <th className="text-left pr-2">Pinyin</th>
                  <th className="text-left">English</th>
                </tr>
              </thead>
              <tbody>
                {preview.items.map((w, i) => (
                  <tr key={`${w.hanzi}-${i}`} className="border-t">
                    <td className="py-0.5 pr-2">{w.level}</td>
                    <td className="py-0.5 pr-2">{w.hanzi}</td>
                    <td className="py-0.5 pr-2 text-gray-700">{w.pinyin}</td>
                    <td className="py-0.5 text-gray-500">{w.english}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-gray-500">
            Preview shows a random sample limited by “Limit words”. Use “Re-sample preview” to reshuffle.
          </p>
        </div>
      )}

      <p className="text-[11px] text-gray-500 mt-2">
        Tip: You can also upload a PDF vocab list; this tool preloads HSK words from the server.
      </p>
    </div>
  );
}

