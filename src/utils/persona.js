// File: src/utils/persona.js
// Minimal persona state + system-prompt builder with "English line" control.
import { useEffect, useState } from 'react';
import {
  PERSONA_PRESETS,
  DEFAULT_PERSONA,
  buildSystemPrompt as sharedBuildSystemPrompt,
  buildTutorPrompt as sharedBuildTutorPrompt,
} from '../shared/personaDefaults';

export const PRESETS = PERSONA_PRESETS;
const DEFAULTS = DEFAULT_PERSONA;
const KEY = 'hb_persona_v1';

export function usePersonaSettings() {
  const [s, set] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { ...DEFAULTS, ...saved };
    } catch {
      return { ...DEFAULTS };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  }, [s]);

  const applyPreset = (key) => {
    const preset = PRESETS[key] || DEFAULTS;
    set({ ...preset });
  };

  return { s, set, applyPreset, presets: PRESETS };
}

export const buildSystemPrompt = sharedBuildSystemPrompt;
export const buildTutorPrompt = sharedBuildTutorPrompt;
