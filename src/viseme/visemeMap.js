// File: src/viseme/visemeMap.js
// Minimal pinyin→viseme mapping. Tweak as you like.
export const VISEMES = [
  'viseme_sil','viseme_PP','viseme_FF','viseme_TH','viseme_DD','viseme_kk',
  'viseme_CH','viseme_SS','viseme_nn','viseme_RR','viseme_aa','viseme_E',
  'viseme_I','viseme_O','viseme_U'
];

const INITIALS = {
  b:'PP', p:'PP', m:'PP', f:'FF',
  d:'DD', t:'DD', n:'nn', l:'DD',
  g:'kk', k:'kk', h:'SS',
  j:'CH', q:'CH', x:'SS',
  zh:'CH', ch:'CH', sh:'SS', r:'RR', z:'SS', c:'SS', s:'SS',
  // vowels-only syllables (a/e/o/i/u/ü) handled in finals
};

const FINALS = {
  a:'aa', ai:'E', an:'aa', ang:'aa',
  e:'E', ei:'E', en:'E', eng:'E', er:'RR',
  i:'I', ia:'aa', ian:'I', iang:'aa', iao:'aa', ie:'E', in:'I', ing:'I', iong:'U', iu:'U',
  o:'O', ong:'O', ou:'O',
  u:'U', ua:'aa', uai:'E', uan:'U', uang:'aa', ue:'I', ui:'U', un:'U', uo:'O',
  v:'I', ve:'E' // 'v' often used for 'ü'
};

// crude fallback if we fail to parse:
const FALLBACK = 'aa';

export function syllableToViseme(pyin) {
  const s = (pyin || '').toLowerCase().replace(/[^a-züv]/g,'').trim();
  if (!s) return 'sil';
  // detect zh/ch/sh first (two-letter initials)
  let init = '', rest = s;
  for (const two of ['zh','ch','sh']) {
    if (s.startsWith(two)) { init = two; rest = s.slice(2); break; }
  }
  if (!init && s.length >= 1) {
    const one = s[0];
    if (INITIALS[one]) { init = one; rest = s.slice(1); }
  }
  const vInit = init ? (INITIALS[init] || null) : null;
  const vFinal = FINALS[rest] || FINALS[rest.replace('ü','v')] || null;
  if (vInit) return vInit;                    // favor consonant mouth first
  if (vFinal) return vFinal;
  return FALLBACK;
}

export function pinyinToVisemeTimeline(pinyin, durationMs) {
  const toks = String(pinyin || '').trim().split(/\s+/).filter(Boolean);
  const n = Math.max(1, toks.length);
  const total = Math.max(300, Number(durationMs) || 1200); // sane default
  const slice = total / n;
  return toks.map((syll, i) => {
    const viseme = syllableToViseme(syll).toLowerCase();
    return { t0: i * slice, t1: (i + 1) * slice, viseme };
  });
}

