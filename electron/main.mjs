import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { startServer } from '../server/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureWritableTmp() {
  if (process.platform !== 'linux') {
    return;
  }

  const candidateTmp = process.env.TMPDIR || process.env.TEMP || os.tmpdir();
  if (candidateTmp) {
    try {
      fs.accessSync(candidateTmp, fs.constants.W_OK | fs.constants.X_OK);
      return;
    } catch (err) {
      console.warn('[electron] tmp path is not accessible, falling back', err);
    }
  }

  const fallbackTmp = path.join(process.cwd(), '.electron-tmp');
  try {
    fs.mkdirSync(fallbackTmp, { recursive: true, mode: 0o700 });
    fs.accessSync(fallbackTmp, fs.constants.W_OK | fs.constants.X_OK);
    process.env.TMPDIR = fallbackTmp;
    process.env.TEMP = fallbackTmp;
    process.env.TEMPDIR = fallbackTmp;
  } catch (err) {
    console.error('[electron] failed to create fallback tmp directory', err);
  }
}

ensureWritableTmp();

if (process.platform === 'linux') {
  // Allow running in environments where the Chrome SUID sandbox is unavailable.
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
  // Some CI containers expose a small /dev/shm which breaks Chromium shared memory.
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

let mainWindow = null;
let serverHandle = null;

function resolveResourcePath(...segments) {
  const candidates = [];

  const appPath = app.getAppPath();
  candidates.push(path.join(appPath, ...segments));

  if (!app.isPackaged) {
    candidates.push(path.join(__dirname, '..', ...segments));
  } else {
    candidates.push(path.join(process.resourcesPath, ...segments));
    candidates.push(path.join(process.resourcesPath, 'app.asar', ...segments));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', ...segments));

    if (process.env.PORTABLE_EXECUTABLE_DIR) {
      candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', ...segments));
      candidates.push(
        path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'resources', 'app.asar.unpacked', ...segments),
      );
    }
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }

  return path.join(appPath, ...segments);
}

async function ensureBackend() {
  if (process.env.ELECTRON_START_URL) {
    return null;
  }
  if (serverHandle) {
    return serverHandle;
  }
  const frontBuild = resolveResourcePath('build');
  const frontPublic = resolveResourcePath('public');
  const serverData = resolveResourcePath('server', 'data');
  serverHandle = await startServer({
    host: '127.0.0.1',
    port: process.env.BACKEND_PORT || process.env.PORT || 0,
    frontBuild,
    frontPublic,
    serverData,
  });
  return serverHandle;
}

async function createMainWindow() {
  const backend = await ensureBackend();
  const defaultUrl = backend ? `http://127.0.0.1:${backend.config.port}` : 'http://127.0.0.1:8787';
  const startUrl = process.env.ELECTRON_START_URL || defaultUrl;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(startUrl);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function init() {
  try {
    await createMainWindow();
  } catch (err) {
    console.error('[electron] failed to create window', err);
    app.quit();
  }
}

app.whenReady().then(init);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    init();
  }
});

async function shutdown() {
  if (serverHandle?.server) {
    try {
      await new Promise(resolve => serverHandle.server.close(resolve));
    } catch (err) {
      console.warn('[electron] failed to close server gracefully', err);
    }
    serverHandle = null;
  }
}

let isQuitting = false;
app.on('before-quit', async (event) => {
  if (isQuitting) {
    return;
  }
  event.preventDefault();
  isQuitting = true;
  await shutdown();
  app.quit();
});
