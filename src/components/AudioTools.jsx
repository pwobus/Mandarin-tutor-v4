// File: src/components/AudioTools.jsx
import React, { useEffect, useState } from 'react';
import { unlockAudio, beep, listVoices, speakLine } from '../utils/tts';

const OPENAI_VOICES = ['alloy','ash','coral','echo','fable','nova','onyx','sage','shimmer'];

export default function AudioTools() {
  const [voices, setVoices] = useState([]);
  const [busy, setBusy] = useState(false);
  const [oaiVoice, setOaiVoice] = useState(() => localStorage.getItem('hb_voice') || 'alloy');

  useEffect(() => { localStorage.setItem('hb_voice', oaiVoice); }, [oaiVoice]);

  async function onList() {
    setBusy(true);
    try {
      const v = await listVoices(2000);
      setVoices(v);
    } finally {
      setBusy(false);
    }
  }

  async function onUnlock() {
    await unlockAudio();
  }

  async function onBeep() {
    await beep();
  }

  async function onTestEn() {
    setBusy(true);
    try {
      await speakLine({ text: 'Hello, this is an English test.', voice: oaiVoice, model: 'tts-1', lang: 'en-US' });
    } catch (e) {
      console.error('TTS EN failed', e);
      alert('OpenAI TTS (en) failed. Check server logs.');
    } finally {
      setBusy(false);
    }
  }

  async function onTestZh() {
    setBusy(true);
    try {
      await speakLine({ text: '你好，我是华语小帮手。', voice: oaiVoice, model: 'tts-1', lang: 'zh-CN' });
    } catch (e) {
      console.error('TTS ZH failed', e);
      alert('OpenAI TTS (zh) failed. Check server logs.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3 mt-3 bg-white rounded shadow">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Audio tools</h3>
        <span className="text-[11px] text-gray-500">{busy ? 'working…' : ''}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={onUnlock} className="px-2 py-1 text-xs bg-gray-800 text-white rounded">Enable audio</button>
        <button onClick={onBeep} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">▶ Beep</button>
        <button onClick={onList} className="px-2 py-1 text-xs bg-gray-200 rounded">List voices</button>
      </div>

      <div className="mt-3">
        <label className="text-xs text-gray-700">OpenAI voice</label>
        <select
          className="w-full text-xs border rounded px-2 py-1 mt-1"
          value={oaiVoice}
          onChange={(e) => setOaiVoice(e.target.value)}
        >
          {OPENAI_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <div className="mt-2 flex gap-2">
          <button onClick={onTestEn} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded">Test en</button>
          <button onClick={onTestZh} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded">测试中文</button>
        </div>
      </div>

      <div className="mt-3 text-xs">
        <div className="font-semibold mb-1">Browser voices ({voices.length})</div>
        {voices.length === 0 ? (
          <div className="text-gray-500">No browser voices (OK; use OpenAI TTS).</div>
        ) : (
          <ul className="max-h-24 overflow-auto border rounded p-2">
            {voices.map((v, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{v.name}</span>
                <span className="text-gray-500">{v.lang}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

