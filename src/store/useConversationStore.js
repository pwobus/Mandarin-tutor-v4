// File: src/store/useConversationStore.js
import { create } from 'zustand';

/*
const SAMPLE_VOCAB = [
  { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' },
  { hanzi: '我叫华语巴迪', pinyin: 'wǒ jiào huáyǔ bā dí', english: 'my name is Huayu Buddy' },
  { hanzi: '你叫什么名字？', pinyin: 'nǐ jiào shénme míngzi?', english: 'what is your name?' },
  { hanzi: '很高兴认识你', pinyin: 'hěn gāoxìng rènshi nǐ', english: 'nice to meet you' },
];
*/

export const useConversationStore = create((set) => ({
  vocabulary: [],
  setVocabulary: (words) => set({ vocabulary: Array.isArray(words) ? words : [] }),
  appendVocabulary: (words) => set((s) => ({ vocabulary: [...s.vocabulary, ...(Array.isArray(words) ? words : [])] })),
  loadSampleVocabulary: () => set({
    vocabulary: [
      { hanzi: '你好', pinyin: 'nǐ hǎo', english: 'hello' },
      { hanzi: '我叫华语巴迪', pinyin: 'wǒ jiào huáyǔ bā dí', english: 'my name is Huayu Buddy' },
      { hanzi: '你叫什么名字？', pinyin: 'nǐ jiào shénme míngzi?', english: 'what is your name?' },
      { hanzi: '很高兴认识你', pinyin: 'hěn gāoxìng rènshi nǐ', english: 'nice to meet you' },
    ]
  }),

  currentPhrase: null,
  setCurrentPhrase: (phrase) => set({ currentPhrase: phrase }),

  userResponse: '',
  setUserResponse: (response) => set({ userResponse: response }),

  responseHistory: [],
  addToHistory: (entry) => set((state) => ({ responseHistory: [...state.responseHistory, entry] })),
  clearHistory: () => set({ responseHistory: [], userResponse: '' }),

  // cache HSK in client (optional)
  hskItems: [],
  setHskItems: (items) => set({ hskItems: items || [] }),

  // global speaking flag (drives avatar + realtime analyser)
  isSpeaking: false,
  setIsSpeaking: (flag) => set({ isSpeaking: !!flag }),
}));

/*
export const useConversationStore = create((set, get) => ({
  vocabulary: [],
  setVocabulary: (words) => set({ vocabulary: Array.isArray(words) ? words : [] }),
  loadSampleVocabulary: () => set({ vocabulary: SAMPLE_VOCAB }),

  currentPhrase: null,
  setCurrentPhrase: (phrase) => set({ currentPhrase: phrase }),

  userResponse: '',
  setUserResponse: (response) => set({ userResponse: response }),

  responseHistory: [],
  addToHistory: (entry) => set((state) => ({ responseHistory: [...state.responseHistory, entry] })),
  clearHistory: () => set({ responseHistory: [], userResponse: '' }),
}));
*/
