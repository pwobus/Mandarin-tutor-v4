// File: src/components/Conversation.jsx  latest 0902 21:51
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useConversationStore } from "../store/useConversationStore";
import { usePersonaSettings, buildTutorPrompt } from "../utils/persona";
import { unlockAudio, speakLine } from "../utils/tts";
import { hanziToPinyin } from "../utils/pinyin";

// live persona read so changes apply immediately
function getLivePersona(defaultPersona) {
  try {
    const raw = localStorage.getItem("hb_persona");
    if (raw) return { ...(defaultPersona || {}), ...JSON.parse(raw) };
  } catch {}
  return defaultPersona || {};
}

// helpers to detect script
const hasHan = (s) => /[\p{Script=Han}]/u.test(s);
const hasTone = (s) =>
  /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i.test(s) || /\b[a-züv]+[1-4]\b/i.test(s);

// --- NEW: robust parser that pairs pinyin-only sentences with the PREVIOUS Hanzi sentence ---
function parseSegments(rawText) {
  const raw = String(rawText || "")
    .replace(/\r/g, "")
    .trim();
  const stripLabel = (s) =>
    s
      .replace(/^(Hanzi|汉字)\s*[:：]\s*/i, "")
      .replace(/^(Pinyin|拼音)\s*[:：]\s*/i, "")
      .replace(/^(English|译文|翻译)\s*[:：]\s*/i, "")
      .trim();

  // Split by sentence-ish boundaries, keep punctuation for rhythm
  const parts = raw
    .split(/(?<=[。！？.!?])\s+/)
    .map((s) => stripLabel(s))
    .filter(Boolean);

  const segs = []; // [{hanzi, pinyin}]
  const englishBits = [];
  let lastIdx = -1;

  for (const s of parts) {
    const isHan = hasHan(s);
    const isPinyinOnly = !isHan && hasTone(s);
    const isEnglishish = !isHan && !hasTone(s);

    if (isHan) {
      // extract only Han + CJK punct for clean speech
      const hanzi = Array.from(s)
        .filter((ch) => /[\p{Script=Han}，。！？、；：“”（）《》…]/u.test(ch))
        .join("")
        .replace(/\s+/g, "")
        .trim();
      if (hanzi) {
        segs.push({ hanzi, pinyin: "" });
        lastIdx = segs.length - 1;
      }
    } else if (isPinyinOnly) {
      // ATTACH to previous Hanzi segment
      if (lastIdx >= 0) {
        const current = segs[lastIdx];
        const clean = s.replace(/[。！？.!?]+$/u, "").trim();
        current.pinyin = current.pinyin ? `${current.pinyin} ${clean}` : clean;
      }
    } else if (isEnglishish) {
      englishBits.push(s.trim());
    }
  }

  // Fallback: try classic 3-line if nothing found
  if (!segs.length) {
    const lines = raw
      .split("\n")
      .map((s) => stripLabel(s.trim()))
      .filter(Boolean);
    const han = lines.find((x) => hasHan(x));
    const pin = lines.find((x) => !hasHan(x) && hasTone(x));
    const eng = lines.find((x) => !hasHan(x) && !hasTone(x));
    if (han) segs.push({ hanzi: han.trim(), pinyin: (pin || "").trim() });
    if (eng) englishBits.push(eng.trim());
  }

  const hydratedSegs = segs.map((seg) => {
    const existing = String(seg.pinyin || "")
      .replace(/\s+/g, " ")
      .trim();
    const auto = hanziToPinyin(seg.hanzi);
    const normExisting = existing.replace(/\s+/g, "");
    const normAuto = auto.replace(/\s+/g, "");
    let finalPinyin = existing;
    if (normAuto && normAuto !== normExisting) {
      finalPinyin = auto;
    } else if (!normExisting && normAuto) {
      finalPinyin = auto;
    }
    return { ...seg, pinyin: finalPinyin };
  });

  return { segs: hydratedSegs, english: englishBits.join(" ").trim() };
}

export default function Conversation() {
  const {
    vocabulary = [],
    addToHistory = () => {},
    setIsSpeaking = () => {},
  } = useConversationStore();
  const { s: personaBase } = usePersonaSettings();

  const [chat, setChat] = useState([]); // [{role, content}]
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [speakEnglishAudio, setSpeakEnglishAudio] = useState(
    () => localStorage.getItem("hb_speakEnglishAudio") === "1",
  );
  useEffect(() => {
    localStorage.setItem("hb_speakEnglishAudio", speakEnglishAudio ? "1" : "0");
  }, [speakEnglishAudio]);

  // whisper press/hold
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const recStartRef = useRef(0);
  const [recording, setRecording] = useState(false);

  const appendChat = useCallback((role, content, extra = {}) => {
    setChat((prev) => [...prev, { role, content, ...extra }]);
  }, []);

  useEffect(() => {
    const onRealtimeTranscript = (event) => {
      const detail = event?.detail || {};
      const text = typeof detail.text === "string" ? detail.text : "";
      if (!text) return;
      const prefix = detail.source === "realtime" ? "【Realtime】 " : "";
      const content = `${prefix}${text}`;
      const responseId = detail.id || null;

      if (!responseId) {
        setChat((prev) => [...prev, { role: "assistant", content }]);
        return;
      }

      setChat((prev) => {
        const existingIdx = prev.findIndex((m) => m?.realtimeId === responseId);
        if (existingIdx === -1) {
          return [
            ...prev,
            {
              role: "assistant",
              content,
              realtimeId: responseId,
              realtimeFinal: !!detail.final,
            },
          ];
        }
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          role: "assistant",
          content,
          realtimeId: responseId,
          realtimeFinal: !!detail.final,
        };
        return next;
      });
    };
    window.addEventListener("hb-realtime-transcript", onRealtimeTranscript);
    return () =>
      window.removeEventListener(
        "hb-realtime-transcript",
        onRealtimeTranscript,
      );
  }, []);

  const vocabBiasSnippet = useCallback(() => {
    const items = (vocabulary || []).slice(0, 60);
    if (!items.length) return "";
    return items
      .map((w) =>
        [
          w.hanzi,
          w.pinyin ? `(${w.pinyin})` : "",
          w.english ? `– ${w.english}` : "",
        ]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .join("、");
  }, [vocabulary]);

  const speakChineseSegments = useCallback(
    async (segs, englishTail, englishPolicy, englishAudio) => {
      await unlockAudio();
      setIsSpeaking(true);
      try {
        for (const s of segs) {
          if (!s?.hanzi) continue;
          await speakLine({
            text: s.hanzi,
            lang: "zh-CN",
            pinyin: s.pinyin || "",
          });
          await new Promise((r) => setTimeout(r, 90));
        }
        if ((englishPolicy === "always" || englishAudio) && englishTail) {
          await speakLine({ text: englishTail, lang: "en-US" });
        }
      } finally {
        setIsSpeaking(false);
      }
    },
    [setIsSpeaking],
  );

  const callGPT = useCallback(
    async (userText) => {
      const user = String(userText || "").trim();
      if (!user) return;

      setBusy(true);
      setStatus("Contacting tutor…");

      const persona = getLivePersona(personaBase);
      const englishPolicy = String(persona?.english || "auto"); // 'never' | 'auto' | 'always'

      const vocabList = vocabBiasSnippet();
      const system = buildTutorPrompt(persona, {
        vocabulary: vocabList ? vocabulary : [],
        vocabBiasText: vocabList,
      });

      try {
        const recent = chat
          .slice(-8)
          .map(({ role, content }) => ({ role, content }));
        const messages = [
          { role: "system", content: system },
          ...recent,
          { role: "user", content: user },
        ];

        const r = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages,
            temperature: 0.7,
          }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`chat failed ${r.status}: ${t}`);
        }
        const j = await r.json();
        const content =
          j?.choices?.[0]?.message?.content ??
          "对不起，我没有听清楚。\nDuìbùqǐ, wǒ méiyǒu tīng qīngchǔ.\nSorry, I didn’t catch that.";

        appendChat("assistant", content);

        // parse → multiple Chinese segments + English tail
        const { segs, english } = parseSegments(content);

        // Speak ALL Chinese sentences, then English if policy/toggle says so
        await speakChineseSegments(
          segs,
          english,
          englishPolicy,
          speakEnglishAudio,
        );

        // Store FIRST seg’s pinyin + global english for Review table
        const first = segs[0] || { hanzi: "", pinyin: "" };
        addToHistory({
          ts: Date.now(),
          prompt: {
            hanzi: first.hanzi,
            pinyin: first.pinyin || "",
            english: english || "",
          },
          response: user,
        });

        setStatus("");
      } catch (e) {
        console.error("[callGPT] error", e);
        setStatus(`Tutor error: ${String(e?.message || e)}`);
      } finally {
        setBusy(false);
      }
    },
    [
      chat,
      personaBase,
      vocabulary,
      vocabBiasSnippet,
      appendChat,
      addToHistory,
      speakChineseSegments,
      speakEnglishAudio,
    ],
  );

  // Start Conversation
  const startConversation = useCallback(async () => {
    setChat([]);
    const opener =
      "请用简体中文热情地打个招呼，并问我一个简单的问题开始聊天。（提供汉字与拼音；若需要再加英文简述）";
    appendChat("user", "开始对话");
    await callGPT(opener);
  }, [appendChat, callGPT]);

  const onSendTyped = useCallback(async () => {
    const text = typed.trim();
    if (!text) return;
    appendChat("user", text);
    setTyped("");
    await callGPT(text);
  }, [typed, appendChat, callGPT]);

  const startWhisperRecording = useCallback(async () => {
    if (recording) return;
    setStatus("Mic: recording…");
    setRecording(true);
    chunksRef.current = [];
    recStartRef.current = Date.now();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecRef.current = mr;
      mr.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };
      mr.start();
    } catch (e) {
      console.error("[whisper] getUserMedia", e);
      setRecording(false);
      setStatus("Mic failed: permissions or device not found");
    }
  }, [recording]);

  const stopWhisperRecording = useCallback(async () => {
    const mr = mediaRecRef.current;
    if (!recording || !mr) return;
    setRecording(false);
    setStatus("Mic: processing…");
    try {
      mr.stop();
      await new Promise((r) => (mr.onstop = r));
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      const dur = (Date.now() - recStartRef.current) / 1000;
      if (dur < 0.12) {
        setStatus("Recording too short — try again");
        return;
      }
      const r = await fetch("/api/whisper", {
        method: "POST",
        headers: { "Content-Type": "audio/webm", Accept: "application/json" },
        body: blob,
      });
      if (!r.ok) throw new Error(`stt failed ${r.status}`);
      const { text } = await r.json();
      const cleaned = String(text || "").trim();
      if (cleaned) {
        appendChat("user", cleaned);
        await callGPT(cleaned);
      }
      setStatus("");
    } catch (e) {
      console.error("[whisper] error", e);
      setStatus(`STT error: ${String(e?.message || e)}`);
    } finally {
      mediaRecRef.current = null;
    }
  }, [recording, appendChat, callGPT]);

  // unlock audio after first gesture
  useEffect(() => {
    const onFirst = async () => {
      await unlockAudio();
    };
    window.addEventListener("click", onFirst, { once: true });
    window.addEventListener("touchstart", onFirst, { once: true });
    return () => {
      window.removeEventListener("click", onFirst);
      window.removeEventListener("touchstart", onFirst);
    };
  }, []);

  const testZh = useCallback(async () => {
    try {
      await unlockAudio();
      await speakLine({
        text: "你好，我叫华语伙伴，很高兴认识你！",
        lang: "zh-CN",
        pinyin: "nǐ hǎo wǒ jiào huá yǔ huǒ bàn hěn gāo xìng rèn shi nǐ",
      });
    } catch (e) {
      setStatus(`TTS zh failed: ${String(e?.message || e)}`);
    }
  }, []);
  const testEn = useCallback(async () => {
    try {
      await unlockAudio();
      await speakLine({ text: "Hello, this is an English test." });
    } catch (e) {
      setStatus(`TTS en failed: ${String(e?.message || e)}`);
    }
  }, []);

  return (
    <div className="p-4 bg-white rounded shadow flex flex-col h-full min-h-[420px]">
      {/* toolbar */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button
          className="px-2 py-1 text-xs rounded bg-sky-700 text-white"
          onClick={startConversation}
          title="Seed a proactive greeting and kick off a longer chat"
        >
          Start Conversation
        </button>
        <button
          className="px-2 py-1 text-xs rounded bg-slate-700 text-white"
          onClick={() => unlockAudio().catch(() => {})}
        >
          Enable Audio
        </button>
        <button
          className="px-2 py-1 text-xs rounded bg-emerald-600 text-white"
          onClick={testZh}
        >
          Test zh
        </button>
        <button
          className="px-2 py-1 text-xs rounded bg-gray-900 text-white"
          onClick={testEn}
        >
          Test en
        </button>
        <label className="ml-2 text-xs inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={speakEnglishAudio}
            onChange={(e) => setSpeakEnglishAudio(e.target.checked)}
          />
          Speak English too
        </label>
        <div className="flex-1" />
        <button
          className={`px-2 py-1 text-xs rounded border ${
            recording ? "bg-red-600 text-white border-red-700" : "bg-white"
          }`}
          onMouseDown={startWhisperRecording}
          onMouseUp={stopWhisperRecording}
          onTouchStart={startWhisperRecording}
          onTouchEnd={stopWhisperRecording}
          title="Press and hold to talk (Whisper STT)"
        >
          {recording ? "Recording… release to send" : "Hold to talk (Whisper)"}
        </button>
      </div>

      {status && (
        <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded mb-2 px-2 py-1">
          {busy ? "⏳ " : ""} {status}
        </div>
      )}

      {/* chat */}
      <div className="flex-1 overflow-auto border rounded p-2 text-sm mb-2">
        {chat.map((m, i) => (
          <div
            key={i}
            className={`mb-1 ${m.role === "user" ? "text-right" : ""}`}
          >
            <span
              className={`inline-block px-2 py-1 rounded ${
                m.role === "user" ? "bg-emerald-50" : "bg-gray-50"
              }`}
            >
              {m.content}
            </span>
          </div>
        ))}
      </div>

      {/* input */}
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-2 py-1 text-sm"
          placeholder="Type in Chinese or English…"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSendTyped();
            }
          }}
        />
        <button
          className="px-3 py-1 text-sm bg-gray-900 text-white rounded"
          onClick={onSendTyped}
        >
          Send
        </button>
      </div>

      {vocabulary.length === 0 && (
        <div className="text-[11px] text-yellow-700 bg-yellow-50 border border-yellow-200 rounded mt-2 p-2">
          Tip: Load HSK or PDF vocab to bias the tutor’s words.
        </div>
      )}
    </div>
  );
}
