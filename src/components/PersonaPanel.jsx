// File: src/components/PersonaPanel.jsx
// Collapsible panel with presets + sliders + English-line selector. Auto-saves to localStorage.
import React, { useEffect, useMemo, useState } from 'react';
import { usePersonaSettings, PRESETS } from '../utils/persona';

export default function PersonaPanel() {
  const { s, set, applyPreset } = usePersonaSettings();
  const [open, setOpen] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hb_persona_open') || 'true'); } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('hb_persona_open', JSON.stringify(open)); } catch {} }, [open]);

  const presetOptions = useMemo(
    () => Object.values(PRESETS).map(p => ({ value: p.key, label: p.label })),
    []
  );

  return (
    <div className="p-4 bg-white rounded shadow mb-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Persona</h3>
          <div className="text-[11px] text-gray-500">
            Configure tone, proactivity, and English line behavior
          </div>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          className="px-2 py-1 text-xs rounded border bg-slate-50"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid md:grid-cols-2 gap-4">
          {/* Preset + Name + Topic */}
          <div className="space-y-2">
            <label className="block text-xs text-gray-600">Preset</label>
            <div className="flex gap-2">
              <select
                className="border rounded px-2 py-1 text-sm"
                value=""
                onChange={(e) => { if (e.target.value) applyPreset(e.target.value); }}
              >
                <option value="" disabled>Select…</option>
                {presetOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                className="px-2 py-1 text-xs rounded bg-slate-700 text-white"
                onClick={() => applyPreset('friendlyCoach')}
              >
                Reset default
              </button>
            </div>

            <label className="block text-xs text-gray-600 mt-2">Tutor name</label>
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              value={s.name}
              onChange={e => set({ ...s, name: e.target.value })}
            />

            <label className="block text-xs text-gray-600 mt-2">Topic focus</label>
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              value={s.topic}
              onChange={e => set({ ...s, topic: e.target.value })}
            />

            <label className="block text-xs text-gray-600 mt-2">Tone (free text)</label>
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              value={s.tone}
              onChange={e => set({ ...s, tone: e.target.value })}
            />
          </div>

          {/* Sliders + Output Rules */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-600">Strictness: {s.strictness}</label>
              <input
                type="range" min={0} max={100} value={s.strictness}
                onChange={e => set({ ...s, strictness: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">Humor: {s.humor}</label>
              <input
                type="range" min={0} max={100} value={s.humor}
                onChange={e => set({ ...s, humor: Number(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600">Proactivity: {s.proactivity}</label>
              <input
                type="range" min={0} max={100} value={s.proactivity}
                onChange={e => set({ ...s, proactivity: Number(e.target.value) })}
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-600">Length</label>
                <select
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={s.length}
                  onChange={e => set({ ...s, length: e.target.value })}
                >
                  <option value="short">short</option>
                  <option value="normal">normal</option>
                  <option value="long">long</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600">Speed</label>
                <select
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={s.speed}
                  onChange={e => set({ ...s, speed: e.target.value })}
                >
                  <option value="slow">slow</option>
                  <option value="normal">normal</option>
                  <option value="fast">fast</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600">English support</label>
                <select
                  className="border rounded px-2 py-1 text-sm w-full"
                  value={s.english}
                  onChange={e => set({ ...s, english: e.target.value })}
                  title="‘always’ forces the English line each turn"
                >
                  <option value="always">always</option>
                  <option value="auto">auto</option>
                  <option value="never">never</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

