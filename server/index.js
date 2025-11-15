import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { DEFAULT_PERSONA, buildTutorPrompt } from '../src/shared/personaDefaults.js';
import * as XLSX from 'xlsx/xlsx.mjs';

XLSX.set_fs(fs);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV_CANDIDATES = [
  path.resolve(__dirname, '..', '.env.local'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '.env.local'),
  path.resolve(__dirname, '.env'),
];

let loadedEnv = false;
for (const envPath of ENV_CANDIDATES) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    loadedEnv = true;
  }
}

if (!loadedEnv) {
  dotenv.config();
}

const DEFAULT_PATHS = {
  frontPublic: path.resolve(__dirname, '..', 'public'),
  frontBuild: path.resolve(__dirname, '..', 'build'),
  serverData: path.resolve(__dirname, 'data'),
};

const exists = p => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

function coerceLevel(val, sheetName) {
  const s = String(val ?? '').trim();
  const m = s.match(/(\d+)/) || String(sheetName || '').match(/(\d+)/);
  const n = m ? Number(m[1]) : 1;
  return Math.max(1, Math.min(6, Number.isFinite(n) ? Math.round(n) : 1));
}

function resolvePaths(options = {}) {
  const frontPublic = options.frontPublic ? path.resolve(options.frontPublic) : DEFAULT_PATHS.frontPublic;
  const frontBuild = options.frontBuild ? path.resolve(options.frontBuild) : DEFAULT_PATHS.frontBuild;
  const serverData = options.serverData ? path.resolve(options.serverData) : DEFAULT_PATHS.serverData;
  const hskXlsx = options.hskXlsx
    ? path.resolve(options.hskXlsx)
    : process.env.HSK_XLSX
    ? path.resolve(process.env.HSK_XLSX)
    : path.join(serverData, 'HSK_1-5.xlsx');
  const host = options.host || process.env.HOST || '0.0.0.0';
  const port = Number.parseInt(options.port ?? process.env.PORT ?? '8787', 10);
  return { frontPublic, frontBuild, serverData, hskXlsx, host, port };
}

function loadHSKWorkbook(filePath) {
  try {
    if (!exists(filePath)) throw new Error(`Cannot access file ${filePath}`);
    const buf = fs.readFileSync(filePath);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const out = [];
    for (const name of wb.SheetNames || []) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      for (const row of rows) {
        const hanzi = (row.hanzi ?? row.Hanzi ?? row.word ?? row['汉字'] ?? '').toString().trim();
        if (!hanzi) continue;
        const pinyin = (row.pinyin ?? row.Pinyin ?? row['拼音'] ?? '').toString().trim();
        const english = (row.english ?? row.English ?? row.meaning ?? row['释义'] ?? '').toString().trim();
        const levelRaw = row.level ?? row.Level ?? row.HSK ?? row['HSK Level'] ?? row['级别'];
        const level = coerceLevel(levelRaw, name);
        out.push({ level, hanzi, pinyin, english });
      }
    }
    return out;
  } catch (e) {
    console.error('[HSK] load error', e);
    return [];
  }
}

function createExpressApp(resolvedPaths) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  if (exists(resolvedPaths.frontBuild)) {
    app.use(express.static(resolvedPaths.frontBuild));
    app.get('/', (_req, res) => res.sendFile(path.join(resolvedPaths.frontBuild, 'index.html')));
  } else {
    console.log('[server] build/ not found – run CRA dev on :3000');
    console.log('[server] attempted FRONT_BUILD path:', resolvedPaths.frontBuild);
  }

  app.use('/_data', express.static(resolvedPaths.serverData));

  app.get('/api/diag/fs', (_req, res) => {
    res.json({
      cwd: process.cwd(),
      __dirname,
      FRONT_PUBLIC: resolvedPaths.frontPublic,
      FRONT_BUILD: resolvedPaths.frontBuild,
      SERVER_DATA: resolvedPaths.serverData,
      HSK_XLSX: resolvedPaths.hskXlsx,
      exists: {
        FRONT_PUBLIC: exists(resolvedPaths.frontPublic),
        FRONT_BUILD: exists(resolvedPaths.frontBuild),
        SERVER_DATA: exists(resolvedPaths.serverData),
        HSK_XLSX: exists(resolvedPaths.hskXlsx),
        'public/head-avatar.glb (CRA)': exists(path.join(resolvedPaths.frontPublic, 'head-avatar.glb')),
      },
    });
  });

  let HSK_CACHE = loadHSKWorkbook(resolvedPaths.hskXlsx);
  console.log(`[HSK] loaded ${HSK_CACHE.length} items from ${resolvedPaths.hskXlsx}`);

  app.get('/api/hsk', (req, res) => {
    try {
      const q = (req.query?.levels || '').toString().trim();
      let items = HSK_CACHE;
      if (q) {
        const want = new Set(q.split(',').map(s => coerceLevel(s, '')).filter(Number.isFinite));
        items = items.filter(x => want.has(Number(x.level)));
      }
      res.json({ source: resolvedPaths.hskXlsx, count: items.length, items });
    } catch (e) {
      console.error('[HSK] route error', e);
      res.status(500).json({ error: 'hsk failed', detail: String(e?.message || e) });
    }
  });

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1';
  const STT_MODEL = process.env.OPENAI_STT_MODEL || 'whisper-1';

  app.post('/api/realtime-session', async (req, res) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY missing');
      }

      const rawModel = (req.body?.model || '').toString().trim();
      const useMini = Boolean(req.body?.useMini) || rawModel === 'gpt-realtime-mini';
      const model = rawModel || (useMini ? 'gpt-realtime-mini' : 'gpt-4o-mini-realtime-preview');
      const voice = (req.body?.voice || '').toString().trim();

      const speakEnglishToo = req.body?.allowEnglish === true || req.body?.allowEnglish === '1';
      const persona = speakEnglishToo
        ? DEFAULT_PERSONA
        : { ...DEFAULT_PERSONA, english: 'never' };

      const payload = { model };
      if (!useMini && voice) payload.voice = voice;
      payload.instructions = `${buildTutorPrompt(persona)}\n\nCritical: Unless the learner explicitly asks, respond ONLY in Simplified Chinese plus pinyin support.`;

      const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'realtime=v1',
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        const detail = await r.text().catch(() => '');
        throw new Error(`OpenAI realtime session failed ${r.status}: ${detail}`);
      }

      const json = await r.json();
      res.json(json);
    } catch (e) {
      console.error('[realtime-session] error', e);
      res.status(400).json({ error: 'realtime session failed', detail: String(e?.message || e) });
    }
  });

  app.get('/api/health', async (_req, res) => {
    const out = { ok: false, openai: false, tts: false, whisper: true, ts: Date.now() };
    try {
      const models = await openai.models.list();
      out.openai = Array.isArray(models?.data);
    } catch (e) {
      return res.status(200).json(out);
    }

    try {
      const r = await openai.audio.speech.create({
        model: TTS_MODEL,
        voice: 'alloy',
        input: 'ping',
        format: 'mp3',
      });
      const buf = Buffer.from(await r.arrayBuffer());
      out.tts = buf.length > 0;
    } catch {
      out.tts = false;
    }
    out.ok = !!(out.openai && out.tts);
    res.json(out);
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const { model, messages, temperature } = req.body || {};
      const r = await openai.chat.completions.create({
        model: model || CHAT_MODEL,
        messages: Array.isArray(messages) ? messages : [],
        temperature: typeof temperature === 'number' ? temperature : 0.6,
      });
      res.json(r);
    } catch (e) {
      console.error('[chat] error', e);
      res.status(500).json({ error: 'chat failed', detail: String(e?.message || e) });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
    try {
      const { model, messages, temperature } = req.body || {};
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const stream = await openai.chat.completions.create({
        model: model || CHAT_MODEL,
        messages: Array.isArray(messages) ? messages : [],
        temperature: typeof temperature === 'number' ? temperature : 0.6,
        stream: true,
      });

      for await (const part of stream) {
        const delta = part?.choices?.[0]?.delta?.content || '';
        if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (e) {
      console.error('[chat/stream] error', e);
      try {
        res.write(`data: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`);
      } catch {}
      try {
        res.end();
      } catch {}
    }
  });

  app.post('/api/tts', async (req, res) => {
    try {
      const text = (req.body?.text || '').toString();
      const voice = (req.body?.voice || 'alloy').toString().toLowerCase();
      if (!text) return res.status(400).json({ error: 'missing text' });

      const allowed = new Set(['nova', 'shimmer', 'echo', 'onyx', 'fable', 'alloy', 'ash', 'sage', 'coral']);
      const chosen = allowed.has(voice) ? voice : 'alloy';

      const r = await openai.audio.speech.create({
        model: TTS_MODEL,
        voice: chosen,
        input: text,
        format: 'mp3',
      });

      const arrayBuffer = await r.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(arrayBuffer));
    } catch (e) {
      console.error('[tts] error', e);
      res.status(400).json({ error: 'OpenAI TTS failed', detail: String(e?.message || e) });
    }
  });

  const rawAudio = express.raw({
    type: ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'application/octet-stream'],
    limit: '25mb',
  });

  app.post('/api/whisper', rawAudio, async (req, res) => {
    try {
      const buf = req.body;
      if (!buf || !buf.length) return res.status(400).json({ error: 'no audio body' });
      const ct = req.headers['content-type'] || 'audio/webm';
      const file = new File([buf], 'speech.webm', { type: ct });
      const r = await openai.audio.transcriptions.create({ file, model: STT_MODEL });
      res.json({ text: r.text || '' });
    } catch (e) {
      console.error('[whisper] error', e);
      res.status(400).json({ error: 'stt failed', detail: String(e?.message || e) });
    }
  });

  app.post('/api/stt', rawAudio, async (req, res) => {
    try {
      const buf = req.body;
      if (!buf || !buf.length) return res.status(400).json({ error: 'no audio body' });
      const ct = req.headers['content-type'] || 'audio/webm';
      const file = new File([buf], 'speech.webm', { type: ct });
      const language = String(req.headers['x-stt-language'] || req.query.language || '')
        .trim()
        .slice(0, 16);
      const payload = { file, model: STT_MODEL };
      if (language) payload.language = language;
      const r = await openai.audio.transcriptions.create(payload);
      res.json({ text: r.text || '' });
    } catch (e) {
      console.error('[stt] error', e);
      res.status(400).json({ error: 'stt failed', detail: String(e?.message || e) });
    }
  });

  return app;
}

export function createApp(options = {}) {
  const resolved = resolvePaths(options);
  const app = createExpressApp(resolved);
  return { app, config: resolved };
}

export function startServer(options = {}) {
  const { app, config } = createApp(options);
  return new Promise((resolve, reject) => {
    const server = app
      .listen({ port: config.port, host: config.host }, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : config.port;
        console.log(`[server] listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${actualPort}`);
        resolve({ app, server, config: { ...config, port: actualPort } });
      })
      .on('error', err => {
        console.error('[server] failed to start', err);
        reject(err);
      });
  });
}

const isEntryPoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntryPoint) {
  startServer().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
