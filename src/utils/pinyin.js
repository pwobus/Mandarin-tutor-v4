import { pinyin } from 'pinyin-pro';

const HAN_REGEX = /\p{Script=Han}/u;

export function hanziToPinyin(input, options = {}) {
  const text = String(input || '').trim();
  if (!text || !HAN_REGEX.test(text)) return '';
  try {
    const result = pinyin(text, {
      toneType: 'mark',
      type: 'string',
      nonZh: 'preserve',
      ...options,
    });
    return String(result || '')
      .replace(/\s+/g, ' ')
      .replace(/\u3000/g, ' ')
      .trim();
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[pinyin] conversion failed', err);
    }
    return '';
  }
}

export function hasHanCharacters(value) {
  return HAN_REGEX.test(String(value || ''));
}
