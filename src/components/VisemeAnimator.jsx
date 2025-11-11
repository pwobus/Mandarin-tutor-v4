// File: src/components/VisemeAnimator.jsx
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

const VISEMES = [
  'viseme_sil','viseme_PP','viseme_FF','viseme_TH','viseme_DD','viseme_kk',
  'viseme_CH','viseme_SS','viseme_nn','viseme_RR','viseme_aa','viseme_E','viseme_I','viseme_O','viseme_U'
];
const INITIALS = { b:'PP', p:'PP', m:'PP', f:'FF', d:'DD', t:'DD', n:'nn', l:'DD', g:'kk', k:'kk', h:'SS',
  j:'CH', q:'CH', x:'SS', zh:'CH', ch:'CH', sh:'SS', r:'RR', z:'SS', c:'SS', s:'SS' };
const FINALS = { a:'aa', ai:'E', an:'aa', ang:'aa', e:'E', ei:'E', en:'E', eng:'E', er:'RR',
  i:'I', ia:'aa', ian:'I', iang:'aa', iao:'aa', ie:'E', in:'I', ing:'I', iong:'U', iu:'U',
  o:'O', ong:'O', ou:'O',
  u:'U', ua:'aa', uai:'E', uan:'U', uang:'aa', ue:'I', ui:'U', un:'U', uo:'O',
  v:'I', ve:'E' };

function syllableToViseme(p) {
  const s = (p || '').toLowerCase().replace(/[^a-züv]/g, '').trim();
  if (!s) return 'sil';
  let init = '', rest = s;
  for (const two of ['zh','ch','sh']) { if (s.startsWith(two)) { init = two; rest = s.slice(2); break; } }
  if (!init && s.length >= 1) { const one = s[0]; if (INITIALS[one]) { init = one; rest = s.slice(1); } }
  return (INITIALS[init] || FINALS[rest] || 'aa').toLowerCase();
}
function pinyinToTimeline(pinyin, durationMs) {
  const toks = String(pinyin || '').trim().split(/\s+/).filter(Boolean);
  const n = Math.max(1, toks.length);
  const total = Math.max(300, Number(durationMs) || 1200);
  const slice = total / n;
  return toks.map((syll, i) => ({ t0: i * slice, t1: (i + 1) * slice, viseme: syllableToViseme(syll) }));
}

export default function VisemeAnimator() {
  const { scene, clock } = useThree();
  const meshRef = useRef(null), dictRef = useRef(null), inflRef = useRef(null);
  const activeRef = useRef({ tl: [], tStart: 0, playing: false });
  const analyserRef = useRef(null), dataRef = useRef(null);

  const findTarget = useMemo(() => () => {
    let found = null;
    scene.traverse((o) => {
      if (found || !o?.isMesh) return;
      const dict = o.morphTargetDictionary;
      const infl = o.morphTargetInfluences;
      if (dict && infl) {
        const ok = VISEMES.some((v) => v in dict || v.replace('viseme_', '') in dict);
        if (ok) found = o;
      }
    });
    return found;
  }, [scene]);

  useEffect(() => {
    const m = findTarget();
    if (m) {
      meshRef.current = m;
      dictRef.current = m.morphTargetDictionary;
      inflRef.current = m.morphTargetInfluences;
      console.info('[viseme] mesh:', m.name, 'keys:', Object.keys(dictRef.current || {}));
    } else {
      console.warn('[viseme] no morph-target mesh found');
    }
  }, [findTarget]);

  useEffect(() => {
    function onStart(e) {
      if (!meshRef.current) return;
      const { pinyin, durationMs } = e.detail || {};
      activeRef.current = { tl: pinyinToTimeline(pinyin, durationMs), tStart: clock.getElapsedTime() * 1000, playing: true };
    }
    function onStop() { activeRef.current.playing = false; }
    window.addEventListener('hb:viseme:start', onStart);
    window.addEventListener('hb:viseme:stop', onStop);
    return () => {
      window.removeEventListener('hb:viseme:start', onStart);
      window.removeEventListener('hb:viseme:stop', onStop);
    };
  }, [clock]);

  useEffect(() => {
    function onAudio(e) {
      try {
        const audio = e.detail?.audio;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!audio || !AC) return;
        const ctx = new AC();
        const src = ctx.createMediaElementSource(audio);
        const an = ctx.createAnalyser(); an.fftSize = 1024;
        src.connect(an); an.connect(ctx.destination);
        analyserRef.current = an;
        dataRef.current = new Uint8Array(an.frequencyBinCount);
      } catch {}
    }
    function onStopAudio() { analyserRef.current = null; dataRef.current = null; }
    window.addEventListener('hb:viseme:audio', onAudio);
    window.addEventListener('hb:viseme:stopAudio', onStopAudio);
    return () => {
      window.removeEventListener('hb:viseme:audio', onAudio);
      window.removeEventListener('hb:viseme:stopAudio', onStopAudio);
    };
  }, []);

  useFrame(() => {
    const dict = dictRef.current, infl = inflRef.current;
    if (!dict || !infl) return;
    for (let i = 0; i < infl.length; i++) infl[i] = Math.max(0, infl[i] * 0.85);

    const st = activeRef.current;
    if (st.playing && st.tl?.length) {
      const nowMs = clock.getElapsedTime() * 1000 - st.tStart;
      const seg = st.tl.find((s) => nowMs >= s.t0 && nowMs < s.t1);
      if (seg) {
        const key = ('viseme_' + seg.viseme).toLowerCase();
        const idx = dict[key] ?? dict[seg.viseme] ?? dict['viseme_aa'];
        if (idx != null) {
          const mid = (seg.t0 + seg.t1) / 2;
          const w = Math.max(0, 1 - Math.abs(nowMs - mid) / ((seg.t1 - seg.t0) * 0.6));
          infl[idx] = Math.max(infl[idx], w);
        }
      }
    }

    // amplitude fallback → drive 'viseme_aa'
    const an = analyserRef.current, arr = dataRef.current;
    if (an && arr) {
      an.getByteTimeDomainData(arr);
      let peak = 0;
      for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; peak = Math.max(peak, Math.abs(v)); }
      const idxAA = dict['viseme_aa'] ?? dict['aa'] ?? null;
      if (idxAA != null) infl[idxAA] = Math.max(infl[idxAA], Math.min(1, peak * 3.2));
    }
  });

  return null;
}

