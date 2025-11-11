// src/components/RealtimePanel.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useConversationStore } from "../store/useConversationStore";
import { hanziToPinyin, hasHanCharacters } from "../utils/pinyin";

/**
 * Minimal WebRTC panel for OpenAI Realtime (Preview).
 * - Connect: obtains ephemeral token from /api/realtime-session
 * - Starts mic capture, sets up RTCPeerConnection
 * - Sends SDP offer to OpenAI, sets answer, plays remote audio
 * - Push-to-talk: toggles mic track enabled
 *
 * Notes:
 * - Requires server route /api/realtime-session.
 * - Uses OpenAI Realtime WebRTC with "OpenAI-Beta: realtime=v1" header on SDP exchange.
 */
export default function RealtimePanel() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [ptt, setPtt] = useState(false);
  const [voice, setVoice] = useState(
    () => localStorage.getItem("hb_rt_voice") || "alloy",
  );
  const [model, setModel] = useState(
    () => localStorage.getItem("hb_rt_model") || "gpt-4o-mini-realtime-preview",
  );
  const [useMini, setUseMini] = useState(
    () => localStorage.getItem("hb_rt_useMini") === "1",
  );
  const prevStandardModelRef = useRef(
    model === "gpt-realtime-mini" ? "gpt-4o-mini-realtime-preview" : model,
  );

  const setIsSpeaking = useConversationStore(
    (s) => s.setIsSpeaking || (() => {}),
  );

  const pcRef = useRef(null);
  const micStreamRef = useRef(null);
  const micTrackRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const analyserCleanupRef = useRef(null);
  const dataChannelRef = useRef(null);
  const transcriptsRef = useRef(new Map()); // canonical/stored transcript per responseId
  const emittedRef = useRef(new Map()); // last emitted normalized main text per responseId
  const emitTimersRef = useRef(new Map()); // debounce timers per responseId
  const textDecoderRef = useRef(null);

  // UI-visible transcripts: array of { id, text, translit?, final }
  const [liveTranscripts, setLiveTranscripts] = useState([]);

  const resetTranscripts = useCallback(() => {
    transcriptsRef.current = new Map();
    emittedRef.current = new Map();
    emitTimersRef.current.forEach((t) => clearTimeout(t));
    emitTimersRef.current = new Map();
    setLiveTranscripts([]);
  }, []);

  const dispatchTranscript = useCallback(
    (responseId, text, isFinal = false) => {
      const cleaned = String(text || "").trim();
      if (!cleaned) return;
      try {
        window.dispatchEvent(
          new CustomEvent("hb-realtime-transcript", {
            detail: {
              text: cleaned,
              source: "realtime",
              id: responseId || null,
              final: !!isFinal,
            },
          }),
        );
      } catch (err) {
        console.warn("[realtime] transcript dispatch failed", err);
      }
    },
    [],
  );

  const cleanupDataChannel = useCallback(() => {
    try {
      dataChannelRef.current?.close?.();
    } catch {}
    dataChannelRef.current = null;
    resetTranscripts();
  }, [resetTranscripts]);

  const extractTexts = useCallback((nodes, bucket) => {
    if (!nodes) return;
    const target = bucket || [];
    const seen = new WeakSet();
    const ignoredKeys = new Set([
      "type",
      "role",
      "id",
      "event",
      "event_type",
      "name",
      "status",
      "index",
      "mode",
    ]);
    const shouldTakeKey = (key) => {
      if (!key) return true;
      const lower = key.toLowerCase();
      if (ignoredKeys.has(lower)) return false;
      return /(text|transcript|transcription|caption|content|message|value|delta|output)/.test(
        lower,
      );
    };
    const pushString = (value) => {
      const str = String(value ?? "").trim();
      if (str) target.push(str);
    };
    const visit = (node, keyHint = "") => {
      if (node === null || node === undefined) return;
      if (typeof node === "string" || typeof node === "number") {
        if (shouldTakeKey(keyHint)) {
          pushString(node);
        }
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item) => visit(item, keyHint));
        return;
      }
      if (typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);

      const type = typeof node.type === "string" ? node.type.toLowerCase() : "";
      if (typeof node.text === "string" && (type.includes("text") || !type)) {
        pushString(node.text);
      }
      if (typeof node.transcript === "string") {
        pushString(node.transcript);
      }
      if (typeof node.transcription === "string") {
        pushString(node.transcription);
      }
      if (typeof node.caption === "string") {
        pushString(node.caption);
      }

      Object.entries(node).forEach(([key, value]) => {
        if (key === "text" || key === "type") return;
        if (value === undefined || value === null) return;
        if (typeof value === "string" || typeof value === "number") {
          if (shouldTakeKey(key)) {
            pushString(value);
          }
          return;
        }
        visit(value, key);
      });
    };
    visit(nodes);
    return target;
  }, []);

  // Helper: update UI transcripts map (dedup, mark final)
  const updateUITranscript = useCallback(
    (responseId, text, translit = "", isFinal = false) => {
      setLiveTranscripts((prev) => {
        const filtered = prev.filter((p) => p.id !== responseId);
        const entry = { id: responseId, text, translit, final: !!isFinal };
        const next = [...filtered, entry].slice(-12);
        return next;
      });
    },
    [],
  );

  // Normalize for comparison: remove whitespace and punctuation, lower-case Latin, collapse CJK runs
  const stripToneGarble = useCallback((value) => {
    if (!value) return value;
    const source = String(value);
    return source.replace(
      /[A-Za-z\u00C0-\u024F]{3,}/gu,
      (match, offset, original) => {
        const prev = offset > 0 ? original[offset - 1] : "";
        const next =
          offset + match.length < original.length
            ? original[offset + match.length]
            : "";
        if (
          /[A-Za-z\u00C0-\u024F]/.test(prev) ||
          /[A-Za-z\u00C0-\u024F]/.test(next)
        ) {
          return match;
        }
        const diacCount = (match.match(/[\u00C0-\u024F]/g) || []).length;
        const asciiCount = match.length - diacCount;
        if (diacCount >= 3) return "";
        if (diacCount >= 2 && match.length >= 6) return "";
        if (diacCount >= 2 && asciiCount <= 1) return "";
        return match;
      },
    );
  }, []);

  const normalizeForCompare = useCallback(
    (s) => {
      if (!s) return "";
      let t = String(s).trim();
      // remove noise tokens like pcm16inf followed by digits
      t = t.replace(/\bpcm16inf\d*\b/gi, "");
      t = stripToneGarble(t);
      // remove punctuation-like chars
      t = t.replace(/[，,。\.、？！\?！:;，。·\-\u2000-\u206F]+/g, "");
      // normalize whitespace
      t = t.replace(/\s+/g, "");
      try {
        t = t.toLowerCase();
      } catch {}
      return t;
    },
    [stripToneGarble],
  );

  // Extract transliteration: return { main: chinesePreferred, translit: latinSeqOrEmpty }
  const extractTransliteration = useCallback((input) => {
    if (!input) return { main: "", translit: "" };
    const source = String(input).trim();
    if (!source) return { main: "", translit: "" };

    const translitPieces = [];
    let result = "";
    let lastIndex = 0;

    const latinSeq =
      /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF][A-Za-z\u00C0-\u024F\u1E00-\u1EFF\s·.'’\-]*/gu;
    const looksLikePinyin = (token, prevChar, nextChar) => {
      if (!token) return false;
      const raw = String(token).trim();
      if (!raw) return false;
      const hasToneMark = /[\u00C0-\u024F\u1E00-\u1EFF]/.test(raw);
      const hasToneNumber = /\b[a-z\u00FC\u00FFv]+[1-4]\b/i.test(raw);
      const hasSeparator = /[·'’]/.test(raw);
      const nearCjk =
        /[\u4E00-\u9FFF]/.test(prevChar || "") ||
        /[\u4E00-\u9FFF]/.test(nextChar || "") ||
        /[，,。.、？！?！]/.test(prevChar || "") ||
        /[，,。.、？！?！]/.test(nextChar || "");
      const lengthOk = raw.length <= 64;
      return (
        nearCjk && lengthOk && (hasToneMark || hasToneNumber || hasSeparator)
      );
    };

    let match;
    while ((match = latinSeq.exec(source))) {
      const token = match[0];
      const startIdx = match.index;
      const endIdx = startIdx + token.length;
      const prevChar = (() => {
        for (let i = startIdx - 1; i >= 0; i--) {
          const ch = source[i];
          if (/\s/.test(ch)) continue;
          return ch;
        }
        return "";
      })();
      const nextChar = (() => {
        for (let i = endIdx; i < source.length; i++) {
          const ch = source[i];
          if (/\s/.test(ch)) continue;
          return ch;
        }
        return "";
      })();

      if (looksLikePinyin(token, prevChar, nextChar)) {
        result += source.slice(lastIndex, startIdx);
        const cleaned = token.replace(/\s+/g, " ").replace(/[·]+/g, "·").trim();
        if (cleaned) translitPieces.push(cleaned);
        lastIndex = endIdx;
      }
    }

    result += source.slice(lastIndex);
    const main = result.replace(/\s{2,}/g, " ").trim();
    const translit = translitPieces
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { main: main || source, translit };
  }, []);

  // Debounced emission: schedule emit for a responseId after brief quiet period
  // scheduleEmit(..., delay = 400)
  const scheduleEmit = useCallback(
    (responseId, delay = 400) => {
      const timers = emitTimersRef.current;
      if (timers.has(responseId)) {
        clearTimeout(timers.get(responseId));
      }
      const t = setTimeout(() => {
        emitTimersRef.current.delete(responseId);
        const stored = transcriptsRef.current.get(responseId) || "";
        const { main, translit } = extractTransliteration(stored || "");
        const displayMain = (main || stored || "").trim();
        const fallbackTranslit = hasHanCharacters(displayMain)
          ? hanziToPinyin(displayMain)
          : "";
        const displayTranslit = (translit || fallbackTranslit || "").trim();
        const candidateNormalized = normalizeForCompare(displayMain);
        const lastEmitted = emittedRef.current.get(responseId) || "";
        if (
          displayMain &&
          candidateNormalized &&
          candidateNormalized !== lastEmitted
        ) {
          emittedRef.current.set(responseId, candidateNormalized);
          dispatchTranscript(responseId, displayMain, false);
          updateUITranscript(responseId, displayMain, displayTranslit, false);
        }
      }, delay);
      timers.set(responseId, t);
    },
    [
      dispatchTranscript,
      updateUITranscript,
      normalizeForCompare,
      extractTransliteration,
      hanziToPinyin,
      hasHanCharacters,
    ],
  );

  //--------------------------------------
  const collapseRepetition = (text) => {
    if (!text) return text;
    let out = String(text).trim();

    // Remove encoder-like tokens first
    out = out.replace(/\bpcm16inf\d*\b/gi, "");
    out = stripToneGarble(out);

    // Normalize whitespace
    out = out.replace(/\s+/g, " ").trim();

    // Split into sentence-like pieces (preserve delimiters)
    const pieces = out.split(/([，,。.、？！?！:；；：]+)/).filter(Boolean);

    // Build a de-duplicated sequence where identical adjacent tokens are collapsed.
    const seq = [];
    for (let i = 0; i < pieces.length; i++) {
      const tok = pieces[i].trim();
      if (!tok) continue;
      const last = seq.length ? seq[seq.length - 1] : "";
      if (last === tok) continue;

      // drop immediate exact duplicate
      seq.push(tok);
    }
    out = seq.join("");

    // collapse repeated short-word runs like "可以可以可以" -> "可以"
    try {
      out = out.replace(/(\S{1,6})(?:\s*\1){2,}/g, "$1");
    } catch (e) {}

    // collapse longer phrase duplications: A A -> A
    try {
      const maxLen = Math.min(120, Math.floor(out.length / 2));
      for (let len = maxLen; len >= 6; len--) {
        const tail = out.slice(-2 * len);
        if (tail.length === 2 * len) {
          const a = tail.slice(0, len).trim();
          const b = tail.slice(len).trim();
          if (a && a === b) {
            out = out.slice(0, out.length - len).trim();
            break;
          }
        }
      }
    } catch (e) {}

    // Remove repeating phrase blocks e.g., "你早上几点起床呢？...你早上几点起床呢？"
    try {
      out = out.replace(/(.{6,}?)\s*\1+/g, "$1");
    } catch (e) {}

    // Final trimming and punctuation clean
    out = out.replace(/^[\s.,:;：-]+|[\s.,:;：-]+$/g, "").trim();
    return out;
  };

  // prefer the version with more CJK characters; avoid naive concatenation if cand just repeats prev
  const mergeTranscripts = (prev, cand) => {
    if (!prev) return cand;
    if (!cand) return prev;
    if (cand.includes(prev)) return cand;
    if (prev.includes(cand)) return prev;

    const prevCJK = (prev.match(/[\u4E00-\u9FFF]/g) || []).length;
    const candCJK = (cand.match(/[\u4E00-\u9FFF]/g) || []).length;
    // if one contains substantially more CJK content, prefer it
    if (candCJK > prevCJK + 3) return cand;
    if (prevCJK > candCJK + 3) return prev;

    // otherwise attempt overlap merge but avoid concatenating if only short overlap
    let overlap = 0;
    const max = Math.min(prev.length, cand.length, 80);
    for (let k = max; k > 3; k--) {
      if (prev.slice(-k) === cand.slice(0, k)) {
        overlap = k;
        break;
      }
    }
    if (overlap >= 3) {
      return prev + cand.slice(overlap);
    }
    // fallback: keep the longer (but normalized) to avoid duplication
    return prev.length >= cand.length ? prev : cand;
  };

  //----------------------------------------

  const processRealtimePayload = useCallback(
    (payload) => {
      if (!payload) return;

      const { type } = payload || {};
      const responseId =
        payload?.response?.id ??
        payload?.response_id ??
        payload?.item_id ??
        payload?.event?.item_id ??
        payload?.delta?.item_id ??
        payload?.id ??
        payload?.item?.id ??
        null;
      if (!responseId) return;

      const isDone =
        type === "response.completed" ||
        type === "response.final" ||
        type === "response.output_text.done";

      const hadExisting = transcriptsRef.current.has(responseId);
      const texts = [];
      const gather = (...sources) =>
        sources.forEach((src) => extractTexts(src, texts));
      gather(payload?.delta);
      gather(payload?.response?.delta);
      gather(payload?.delta?.content);
      gather(payload?.delta?.text);
      gather(payload?.delta?.output_text);
      gather(payload?.delta?.output_text_delta);
      gather(payload?.output_text);
      gather(payload?.output_text_delta);
      if (!texts.length) {
        gather(payload?.item);
      }
      if (!texts.length && (!hadExisting || !isDone)) {
        gather(payload?.response);
      }
      if (!texts.length) {
        gather(payload?.response?.output_text);
      }
      if (!texts.length) {
        gather(payload?.content);
      }

      const sanitizeCandidate = (str) => {
        if (!str) return "";
        let s = String(str).trim();

        // Remove known noise markers (e.g., encoder tokens)
        s = s.replace(/\bpcm16inf\d*\b/gi, "");
        s = stripToneGarble(s);

        // Normalize line breaks/zero-width/nbsp to single space
        s = s.replace(/[\uFEFF\u00A0\r\n]+/g, " ");

        // Drop garbled tone-mark runs like "ǎīānéěàng" that occasionally leak from the stream
        s = s.replace(
          /\b(?=(?:[A-Za-z]*[\u00C0-\u024F]){3,})[A-Za-z\u00C0-\u024F]{5,}\b/gu,
          "",
        );
        s = s.replace(/\s{2,}/g, " ");

        // Normalize punctuation sequences into single instance (keep full-width punctuation)
        s = s.replace(/[，,。.、？！?！:;：]+/g, (m) => m[0]);

        // Remove stray repeated colon-like sequences and isolated punctuation at start
        s = s.replace(/^[\s.,:;：-]+|[\s.,:;：-]+$/g, "").trim();
        if (!s) return "";

        // Remove interleaved pinyin fragments wedged between Hanzi sentences.
        const latinClusterRegex =
/[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]+(?:[\s·.'’-]*[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]+)*/u;
        const bridgeBetweenHan = new RegExp(
          `([\\p{Script=Han}][，,。.、？！?！]*)[\s·.\-'’]*${latinClusterRegex.source}(?=[\s·.\-'’]*[\\p{Script=Han}])`,
          "gu"
        );
        const afterPunct = new RegExp(
          `([，,。.、？！?！])\s*${latinClusterRegex.source}(?=[\s·.\-'’]*[\\p{Script=Han}])`,
          "gu"
        );
        let prevVal;
        do {
          prevVal = s;
          s = s.replace(bridgeBetweenHan, "$1");
          s = s.replace(afterPunct, "$1");
        } while (prevVal !== s);

        // If there's a "小提示" or similar helper attached and repeated, treat it as a separate sentence:
        // keep it but mark boundaries so collapseRepetition can dedupe repeated hint sentences.
        // (we normalize to a single '小提示：' token to make dedupe easier)
        s = s.replace(/小提示[:：]\s*/g, "小提示：");

        // If Chinese text with trailing ASCII translit/pinyin, drop the translit into separate field later.
        // Remove trailing short ASCII tokens that are likely pinyin or artifacts
        const lastCJK = (() => {
          for (let i = s.length - 1; i >= 0; i--) {
            if (/[\p{Script=Han}]/u.test(s[i])) return i;
          }
          return -1;
        })();

        if (lastCJK >= 0 && lastCJK < s.length - 1) {
          const suffix = s.slice(lastCJK + 1).trim();
          if (
            /^[\sA-Za-z0-9-\u0100-\u024F']+$/.test(suffix) &&
            suffix.length <= 40
          ) {
            s = s.slice(0, lastCJK + 1).trim();
          }
        } else if (/^[A-Za-z0-9-\s'.,!?]{1,6}$/.test(s)) {
          // drop tiny ASCII-only fragments that are unlikely meaningful
          return "";
        }

        return s;
      };

      if (texts.length) {
        const raw = texts.join("");
        let cand = sanitizeCandidate(raw);
        if (cand) {
          const extractedCand = extractTransliteration(cand || "");
          cand = (extractedCand.main || cand || "").trim();
        }
        if (cand) {
          const prev = transcriptsRef.current.get(responseId) || "";
          let merged = cand;
          if (prev) {
            if (cand.includes(prev)) merged = cand;
            else if (prev.includes(cand)) merged = prev;
            else {
              let overlap = 0;
              const max = Math.min(prev.length, cand.length);
              for (let k = max; k > 0; k--) {
                if (prev.slice(-k) === cand.slice(0, k)) {
                  overlap = k;
                  break;
                }
              }
              merged = prev + cand.slice(overlap);
            }
          }

          merged = collapseRepetition(merged);
          const extractedMerged = extractTransliteration(merged || "");
          const canonical = (extractedMerged.main || merged || "").trim();

          // If canonical is mostly ASCII small fragment while prev had CJK, ignore
          const prevHasCJK = /[\u4E00-\u9FFF]/.test(prev || "");
          if (/^[A-Za-z0-9\-\s'.,!?]{1,8}$/.test(canonical) && prevHasCJK) {
            scheduleEmit(responseId);
          } else if (canonical) {
            transcriptsRef.current.set(responseId, canonical);
            scheduleEmit(responseId);
          }
        }
      }

      if (isDone) {
        const timer = emitTimersRef.current.get(responseId);
        if (timer) {
          clearTimeout(timer);
          emitTimersRef.current.delete(responseId);
        }
        let finalText = transcriptsRef.current.get(responseId) || "";
        finalText = collapseRepetition(finalText);
        transcriptsRef.current.delete(responseId);
        emittedRef.current.delete(responseId);
        if (finalText) {
          const { main, translit } = extractTransliteration(finalText);
          const displayMain = (main || finalText || "").trim();
          const fallbackTranslit = hasHanCharacters(displayMain)
            ? hanziToPinyin(displayMain)
            : "";
          const finalTranslit = (translit || fallbackTranslit || "").trim();
          const normalizedMain = normalizeForCompare(displayMain);
          // store normalized canonical main text so further identical content is not re-emitted
          emittedRef.current.set(responseId, normalizedMain);
          dispatchTranscript(responseId, displayMain, true);
          updateUITranscript(responseId, displayMain, finalTranslit, true);
        }
      }

      const isError = type === "response.error" || type === "response.refusal";
      if (isError) {
        transcriptsRef.current.delete(responseId);
        emittedRef.current.delete(responseId);
        const t = emitTimersRef.current.get(responseId);
        if (t) {
          clearTimeout(t);
          emitTimersRef.current.delete(responseId);
        }
        setLiveTranscripts((prev) => prev.filter((p) => p.id !== responseId));
      }
    },
    [
      dispatchTranscript,
      extractTexts,
      updateUITranscript,
      scheduleEmit,
      collapseRepetition,
      normalizeForCompare,
      extractTransliteration,
      hanziToPinyin,
      hasHanCharacters,
    ],
  );

  const handleRealtimeMessage = useCallback(
    (event) => {
      if (!event?.data) return;

      const handleString = (raw) => {
        if (!raw) return;
        const text = String(raw);
        const trimmed = text.trim();
        if (!trimmed) return;

        const tryProcess = (snippet) => {
          if (!snippet) return { ok: false };
          try {
            const parsed = JSON.parse(snippet);
            processRealtimePayload(parsed);
            return { ok: true };
          } catch (err) {
            return { ok: false, err };
          }
        };

        const first = tryProcess(trimmed);
        if (first.ok) return;

        const handlePieces = (pieces) => {
          const cleaned = pieces
            .map((piece) => piece.trim())
            .filter(Boolean);
          if (cleaned.length <= 1) return false;
          let any = false;
          cleaned.forEach((piece) => {
            const result = tryProcess(piece);
            if (result.ok) {
              any = true;
            } else if (result.err) {
              console.warn("[realtime] bad message fragment", result.err, piece);
            }
          });
          return any;
        };

        if (handlePieces(trimmed.split(/\r?\n/))) return;
        if (handlePieces(trimmed.replace(/}\s*{/g, "}\n{").split(/\r?\n/))) return;

        if (first.err) {
          console.warn("[realtime] bad message", first.err, trimmed);
        } else {
          console.warn("[realtime] unhandled message", trimmed);
        }
      };

      if (typeof event.data === "string") {
        handleString(event.data);
        return;
      }

      const globalBlob = typeof Blob === "undefined" ? null : Blob;

      if (
        event.data instanceof ArrayBuffer ||
        ArrayBuffer.isView?.(event.data)
      ) {
        try {
          if (!textDecoderRef.current) {
            textDecoderRef.current = new TextDecoder();
          }
          const view =
            event.data instanceof ArrayBuffer
              ? new Uint8Array(event.data)
              : new Uint8Array(
                  event.data.buffer,
                  event.data.byteOffset,
                  event.data.byteLength,
                );
          const raw = textDecoderRef.current.decode(view);
          handleString(raw);
        } catch (err) {
          console.warn("[realtime] arraybuffer decode failed", err);
        }
        return;
      }

      if (globalBlob && event.data instanceof globalBlob) {
        event.data
          .text()
          .then(handleString)
          .catch((err) => console.warn("[realtime] blob decode failed", err));
        return;
      }

      console.warn("[realtime] unknown message payload", event.data);
    },
    [processRealtimePayload],
  );

  const stopAnalyser = useCallback(() => {
    const cleanup = analyserCleanupRef.current;
    if (cleanup) {
      analyserCleanupRef.current = null;
      cleanup();
      return;
    }
    setIsSpeaking(false);
    try {
      window.dispatchEvent(
        new CustomEvent("hb-tts-activity", { detail: { active: false } }),
      );
    } catch {}
    try {
      window.dispatchEvent(
        new CustomEvent("hb-tts-level", { detail: { level: 0 } }),
      );
    } catch {}
  }, [setIsSpeaking]);

  const startAnalyserForStream = useCallback(
    (stream) => {
      stopAnalyser();
      if (!stream) return;

      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(analyser);
        analyser.connect(gain);
        gain.connect(ctx.destination);
        const data = new Uint8Array(analyser.frequencyBinCount);
        let raf = 0;
        let active = false;
        let lastActive = performance.now();

        const emitActivity = (flag) => {
          setIsSpeaking(flag);
          try {
            window.dispatchEvent(
              new CustomEvent("hb-tts-activity", { detail: { active: flag } }),
            );
          } catch {}
        };

        const tick = () => {
          if (ctx.state === "suspended") ctx.resume().catch(() => {});
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i += 1) {
            const v = (data[i] - 128) / 128;
            peak = Math.max(peak, Math.abs(v));
          }
          const level = Math.min(1, peak * 2.2);
          try {
            window.dispatchEvent(
              new CustomEvent("hb-tts-level", { detail: { level } }),
            );
          } catch {}

          const now = performance.now();
          if (level > 0.04) {
            lastActive = now;
            if (!active) {
              active = true;
              emitActivity(true);
            }
          } else if (active && now - lastActive > 500) {
            active = false;
            emitActivity(false);
          }

          raf = requestAnimationFrame(tick);
        };
        tick();

        const tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
        const onEnded = () => stopAnalyser();
        tracks.forEach((track) => {
          if (track && track.addEventListener) {
            track.addEventListener("ended", onEnded);
          }
        });

        analyserCleanupRef.current = () => {
          cancelAnimationFrame(raf);
          try {
            source.disconnect();
          } catch {}
          try {
            analyser.disconnect();
          } catch {}
          try {
            gain.disconnect();
          } catch {}
          tracks.forEach((track) => {
            if (track && track.removeEventListener) {
              track.removeEventListener("ended", onEnded);
            }
          });
          ctx.close().catch(() => {});
          if (active) emitActivity(false);
          try {
            window.dispatchEvent(
              new CustomEvent("hb-tts-level", { detail: { level: 0 } }),
            );
          } catch {}
        };
      } catch (err) {
        console.warn("[realtime] analyser start failed", err);
      }
    },
    [setIsSpeaking, stopAnalyser],
  );

  useEffect(() => {
    try {
      localStorage.setItem("hb_rt_voice", voice);
    } catch {}
  }, [voice]);
  useEffect(() => {
    try {
      localStorage.setItem("hb_rt_model", model);
    } catch {}
  }, [model]);
  useEffect(() => {
    try {
      localStorage.setItem("hb_rt_useMini", useMini ? "1" : "0");
    } catch {}
  }, [useMini]);

  useEffect(() => {
    if (model !== "gpt-realtime-mini") {
      prevStandardModelRef.current = model;
    }
  }, [model]);

  useEffect(() => {
    if (useMini) {
      if (model !== "gpt-realtime-mini") {
        setModel("gpt-realtime-mini");
      }
    } else if (model === "gpt-realtime-mini") {
      const restore =
        prevStandardModelRef.current || "gpt-4o-mini-realtime-preview";
      setModel(restore);
    }
  }, [useMini, model]);

  useEffect(() => {
    remoteAudioRef.current = new Audio();
    remoteAudioRef.current.autoplay = true;
  }, []);

  useEffect(() => {
    return () => stopAnalyser();
  }, [stopAnalyser]);

  useEffect(() => {
    return () => cleanupDataChannel();
  }, [cleanupDataChannel]);

  const disconnect = async () => {
    setConnecting(false);
    setConnected(false);
    setPtt(false);
    stopAnalyser();
    cleanupDataChannel();
    try {
      micTrackRef.current && (micTrackRef.current.enabled = false);
    } catch {}
    try {
      pcRef.current?.getSenders?.().forEach((s) => s.track && s.track.stop());
    } catch {}
    try {
      micStreamRef.current?.getTracks?.forEach((t) => t.stop());
    } catch {}
    try {
      pcRef.current?.close?.();
    } catch {}
    pcRef.current = null;
    micStreamRef.current = null;
    micTrackRef.current = null;
  };

  const connect = async () => {
    if (connected || connecting) return;
    setConnecting(true);

    try {
      cleanupDataChannel();
      resetTranscripts();

      // 1) Ask our server for ephemeral token (and voice/model we want)
      const connectModel = useMini ? "gpt-realtime-mini" : model;
      let allowEnglish = false;
      try {
        allowEnglish = localStorage.getItem("hb_speakEnglishAudio") === "1";
      } catch {}
      const payload = { model: connectModel, useMini, allowEnglish };
      if (!useMini) payload.voice = voice;

      const tokenResp = await fetch("/api/realtime-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!tokenResp.ok) throw new Error("Failed to create realtime session");
      const data = await tokenResp.json();
      const EPHEMERAL = data?.client_secret?.value;
      if (!EPHEMERAL) throw new Error("No ephemeral token");

      // 2) WebRTC peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // remote audio sink
      pc.ontrack = (e) => {
        if (e?.streams?.[0] && remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          try {
            remoteAudioRef.current.play?.();
          } catch {}
          startAnalyserForStream(e.streams[0]);
        }
      };

      const attachDataChannel = (channel) => {
        if (!channel) return;
        dataChannelRef.current = channel;
        channel.onmessage = handleRealtimeMessage;
        channel.onclose = cleanupDataChannel;
      };

      const dc = pc.createDataChannel("oai-events");
      attachDataChannel(dc);
      pc.ondatachannel = (ev) => {
        if (ev?.channel?.label === "oai-events") {
          attachDataChannel(ev.channel);
        }
      };

      // 3) Add local mic
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = ms;
      const [track] = ms.getAudioTracks();
      micTrackRef.current = track;
      pc.addTrack(track, ms);

      // 4) Prepare offer and send SDP to OpenAI Realtime endpoint
      pc.addTransceiver("audio", { direction: "sendrecv" });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const url = `https://api.openai.com/v1/realtime?model=${encodeURIComponent(connectModel)}`;
      const sdpResp = await fetch(url, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL}`,
          "Content-Type": "application/sdp",
          "OpenAI-Beta": "realtime=v1",
        },
      });
      if (!sdpResp.ok)
        throw new Error(`SDP exchange failed: ${sdpResp.status}`);
      const answer = await sdpResp.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answer });

      setConnected(true);
      setPtt(true);
      if (micTrackRef.current) micTrackRef.current.enabled = true;
    } catch (e) {
      console.error("[realtime connect]", e);
      await disconnect();
      alert(`Realtime connect failed: ${e?.message || e}`);
    } finally {
      setConnecting(false);
    }
  };

  const togglePTT = () => {
    const track = micTrackRef.current;
    if (!track) return;
    const next = !ptt;
    setPtt(next);
    track.enabled = next; // enable/disable mic flow to model
  };

  return (
    <div className="p-3 rounded border bg-gray-50">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">Realtime (beta)</span>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            className="accent-emerald-600"
            checked={useMini}
            onChange={() => {
              if (connected || connecting) return;
              setUseMini((prev) => !prev);
            }}
            disabled={connected || connecting}
          />
          gpt-realtime-mini
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-700">Model</span>
          <select
            className="px-2 py-1 border rounded"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={connected || connecting || useMini}
          >
            <option value="gpt-4o-mini-realtime-preview">
              gpt-4o-mini-realtime-preview
            </option>
            <option value="gpt-4o-realtime-preview">
              gpt-4o-realtime-preview
            </option>
            {(useMini || model === "gpt-realtime-mini") && (
              <option value="gpt-realtime-mini">gpt-realtime-mini</option>
            )}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm text-gray-700">Voice</span>
          <select
            className="px-2 py-1 border rounded"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={connected || connecting || useMini}
          >
            <option value="alloy">alloy</option>
            <option value="sage">sage</option>
            <option value="ash">ash</option>
            <option value="verse">verse</option>
          </select>
        </label>

        {!connected ? (
          <button
            disabled={connecting}
            onClick={connect}
            className="px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        ) : (
          <>
            <button
              onClick={togglePTT}
              className={`px-3 py-2 rounded text-white ${ptt ? "bg-red-600" : "bg-slate-600"}`}
              title="Push-to-talk toggles mic track to the model"
            >
              {ptt ? "● Mic LIVE" : "Mic muted"}
            </button>
            <button
              onClick={disconnect}
              className="px-3 py-2 bg-gray-300 rounded"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-gray-600 mt-2">
        Uses OpenAI Realtime API over WebRTC with ephemeral token. Push-to-talk
        lets you gate the mic track.
        {useMini
          ? " When enabled, the gpt-realtime-mini API is requested for session setup."
          : ""}
      </p>

      {/* Live transcript area */}
      <div
        className="mt-3 p-2 border rounded bg-white max-h-56 overflow-auto text-sm"
        role="region"
        aria-label="Realtime transcripts"
      >
        {liveTranscripts.length === 0 ? (
          <div className="text-gray-400">No realtime transcripts yet.</div>
        ) : (
          liveTranscripts.map((t) => (
            <div
              key={t.id}
              className={`py-1 ${t.final ? "opacity-100" : "opacity-80"}`}
            >
              <div className="text-xs text-gray-500 mb-1">
                {t.final ? "Final" : "Interim"}
              </div>
              <div className="whitespace-pre-wrap">{t.text}</div>
              {t.translit ? (
                <div className="text-xs text-gray-400 italic mt-1">
                  {t.translit}
                </div>
              ) : null}
              <hr className="my-2 border-t border-gray-100" />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
