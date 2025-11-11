export const PERSONA_PRESETS = {
  friendlyCoach: {
    key: 'friendlyCoach',
    label: 'Friendly Coach',
    name: 'Huayu Buddy',
    tone: 'warm, encouraging',
    strictness: 30,
    humor: 40,
    proactivity: 65,
    english: 'always',
    length: 'short',
    speed: 'slow',
    topic: 'daily life',
  },
  cheerfulPartner: {
    key: 'cheerfulPartner',
    label: 'Cheerful Partner',
    name: 'Huayu Buddy',
    tone: 'cheerful, playful but respectful',
    strictness: 15,
    humor: 70,
    proactivity: 80,
    english: 'always',
    length: 'short',
    speed: 'slow',
    topic: 'hobbies',
  },
  strictTeacher: {
    key: 'strictTeacher',
    label: 'Strict Teacher',
    name: 'Huayu Laoshi',
    tone: 'clear, concise, professional',
    strictness: 75,
    humor: 10,
    proactivity: 60,
    english: 'always',
    length: 'short',
    speed: 'normal',
    topic: 'classroom',
  },
};

export const DEFAULT_PERSONA = PERSONA_PRESETS.friendlyCoach;

/** Build strict output format: 3 lines (Hanzi, Pinyin, English) when english='always'. */
export function buildSystemPrompt(settings = DEFAULT_PERSONA, vocab = []) {
  const {
    name,
    tone,
    strictness,
    humor,
    proactivity,
    english,
    length,
    speed,
    topic,
  } = { ...DEFAULT_PERSONA, ...settings };

  const mustEnglish = english === 'always';
  const forbidEnglish = english === 'never';
  const linesSpec = mustEnglish
    ? [
        '2) On each turn, output exactly 3 lines and nothing else:',
        '   Line 1: Hanzi',
        '   Line 2: Pinyin',
        '   Line 3: English (brief)',
      ]
    : forbidEnglish
      ? [
          '2) On each turn, output exactly 2 lines and nothing else:',
          '   Line 1: Hanzi',
          '   Line 2: Pinyin',
          '   Do NOT add any English translation unless the learner explicitly asks for it.',
        ]
      : [
          '2) On each turn, output 2–3 lines:',
          '   Line 1: Hanzi',
          '   Line 2: Pinyin',
          '   Line 3: English (brief) if learner might need it',
        ];

  const vocabList = (vocab || [])
    .slice(0, 40)
    .map((w) => `${w.hanzi} (${w.pinyin || ''})`.trim())
    .join('、') || 'HSK-appropriate words';

  return [
    `You are ${name}, a ${tone} Mandarin conversation tutor.`,
    'Goals: natural back-and-forth, gentle micro-corrections, ALWAYS end with a question.',
    `Style: strictness=${strictness}/100, humor=${humor}/100, proactivity=${proactivity}/100.`,
    'Language output rules:',
    ...linesSpec,
    `3) Keep sentences ${length}; speak ${speed}.`,
    '4) Do not include labels like "Hanzi:" or "Pinyin:". Output only the raw lines.',
    `5) Prefer simple HSK vocabulary; bias to: ${vocabList}.`,
    '6) When correcting: one short tip + a natural re-ask.',
    `Topic focus: ${topic}.`,
  ].join('\n');
}

export function buildTutorPrompt(
  settings = DEFAULT_PERSONA,
  { vocabulary = [], vocabBiasText = '' } = {}
) {
  const persona = { ...DEFAULT_PERSONA, ...settings };
  const base = buildSystemPrompt(persona, vocabulary);
  const englishPolicy = String(persona.english || 'auto');
  const bias = (vocabBiasText || '').trim();
  const prefer = bias ? `; prefer: ${bias}` : '';

  const extraLines = [
    `You are proactive, warm, and curious. Use basic Mandarin (HSK1–3 words prioritized${prefer}).`,
    'Respond with grouped lines like:',
    '- Hanzi sentences (2–3).',
    '- Pinyin for those sentences.',
    englishPolicy === 'always'
      ? '- English for those sentences.'
      : englishPolicy === 'never'
        ? '- Do not provide English translations unless the learner explicitly requests them.'
        : '- English only when specifically helpful.',
    'Always end with a short follow-up question.',
  ];

  return `${base}\n\n${extraLines.join('\n')}`;
}
