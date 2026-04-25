import * as electronAPI from 'electron/main';
const { app, BrowserWindow, ipcMain, dialog, shell, session } = electronAPI;
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// ── Service process handles (kept for graceful shutdown) ─────────────────────

let ollamaProcess = null;
let comfyuiProcess = null;
let mainWindow = null;

// Result reported to the renderer via get-service-launch-status IPC
const serviceLaunchStatus = {
  autoStartAttempted: false,
  ollama: 'not-attempted',   // 'external' | 'started' | 'failed' | 'not-attempted'
  comfyui: 'not-attempted',  // same
  modelPresent: false,
};

// ── Utility helpers ──────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Single HTTP GET — resolves on 2xx/3xx, rejects on error or 4xx/5xx. */
function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** Returns true if the port is accepting HTTP requests within 3 seconds. */
async function isPortOpen(port, urlPath = '/') {
  try {
    await httpGet(`http://localhost:${port}${urlPath}`, 3000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls until the port responds or timeoutMs elapses.
 * Returns true if the service came up in time.
 */
async function waitForPort(port, urlPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port, urlPath)) return true;
    await sleep(1500);
  }
  return false;
}

/** Send a status/progress update to the loading window (no-op if it's closed). */
function sendLoadingUpdate(win, status, progress) {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('loading-update', { status, progress });
    }
  } catch { /* window may have been closed */ }
}

// ── Ollama auto-start ────────────────────────────────────────────────────────

function getOllamaBinary() {
  if (!app.isPackaged) return 'ollama'; // dev: use system ollama from PATH
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(process.resourcesPath, 'bin', `ollama${ext}`);
}

async function startOllama(loadingWin) {
  sendLoadingUpdate(loadingWin, 'Checking Ollama…', 5);

  // Already running externally — use it.
  if (await isPortOpen(11434, '/api/tags')) {
    console.log('[Ollama] Already running externally.');
    serviceLaunchStatus.ollama = 'external';
    return true;
  }

  sendLoadingUpdate(loadingWin, 'Starting Ollama…', 10);
  console.log('[Ollama] Not running — attempting to start.');

  const binary = getOllamaBinary();

  // Verify binary exists (packaged) or trust PATH (dev)
  if (app.isPackaged && !fs.existsSync(binary)) {
    console.warn('[Ollama] Bundled binary not found at', binary);
    serviceLaunchStatus.ollama = 'failed';
    return false;
  }

  try {
    ollamaProcess = spawn(binary, ['serve'], {
      stdio: 'pipe',
      detached: false,
      env: { ...process.env, HOME: os.homedir() },
    });

    ollamaProcess.stdout.on('data', (d) => console.log('[Ollama]', d.toString().trim()));
    ollamaProcess.stderr.on('data', (d) => console.log('[Ollama]', d.toString().trim()));
    ollamaProcess.on('error', (err) => console.error('[Ollama] spawn error:', err.message));

    sendLoadingUpdate(loadingWin, 'Waiting for Ollama to start…', 15);
    const ok = await waitForPort(11434, '/api/tags', 30_000);

    if (ok) {
      console.log('[Ollama] Started successfully.');
      serviceLaunchStatus.ollama = 'started';
      return true;
    } else {
      console.error('[Ollama] Timed out waiting for port 11434.');
      serviceLaunchStatus.ollama = 'failed';
      return false;
    }
  } catch (err) {
    console.error('[Ollama] Failed to start:', err.message);
    serviceLaunchStatus.ollama = 'failed';
    return false;
  }
}

// ── ComfyUI auto-start ───────────────────────────────────────────────────────

/** Returns the first ComfyUI directory found, or null. */
async function findComfyUIPath() {
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, 'ComfyUI'),
        path.join(home, 'comfyui'),
        'C:\\ComfyUI',
      ]
    : [
        path.join(home, 'ComfyUI'),
        path.join(home, 'comfyui'),
        path.join(home, 'Applications', 'ComfyUI'),
        '/opt/ComfyUI',
      ];

  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'main.py'))) {
      console.log('[ComfyUI] Found installation at', p);
      return p;
    }
  }
  return null;
}

/** Try each Python binary and return the first one that runs. */
async function findWorkingPython(comfyPath) {
  const venvBin = process.platform === 'win32'
    ? path.join(comfyPath, 'venv', 'Scripts', 'python.exe')
    : path.join(comfyPath, 'venv', 'bin', 'python3');

  const candidates = [
    venvBin,
    path.join(comfyPath, 'venv', 'bin', 'python'),
    'python3',
    'python',
  ];

  for (const py of candidates) {
    const works = await new Promise((resolve) => {
      execFile(py, ['--version'], { timeout: 5000 }, (err) => resolve(!err));
    });
    if (works) {
      console.log('[ComfyUI] Using Python:', py);
      return py;
    }
  }
  return null;
}

async function startComfyUI(loadingWin) {
  sendLoadingUpdate(loadingWin, 'Checking ComfyUI…', 20);

  // Already running externally — use it.
  if (await isPortOpen(8188, '/system_stats')) {
    console.log('[ComfyUI] Already running externally.');
    serviceLaunchStatus.comfyui = 'external';
    return { ok: true, comfyPath: null };
  }

  sendLoadingUpdate(loadingWin, 'Looking for ComfyUI…', 25);

  const comfyPath = await findComfyUIPath();
  if (!comfyPath) {
    console.warn('[ComfyUI] No installation found.');
    serviceLaunchStatus.comfyui = 'failed';
    return { ok: false, comfyPath: null };
  }

  const python = await findWorkingPython(comfyPath);
  if (!python) {
    console.warn('[ComfyUI] No working Python found.');
    serviceLaunchStatus.comfyui = 'failed';
    return { ok: false, comfyPath };
  }

  sendLoadingUpdate(loadingWin, 'Starting ComfyUI…', 30);
  console.log('[ComfyUI] Launching from', comfyPath);

  try {
    comfyuiProcess = spawn(
      python,
      ['main.py', '--port', '8188', '--preview-method', 'none', '--listen', '127.0.0.1'],
      {
        cwd: comfyPath,
        stdio: 'pipe',
        detached: false,
        env: { ...process.env, PYTHONPATH: comfyPath },
      }
    );

    comfyuiProcess.stdout.on('data', (d) => console.log('[ComfyUI]', d.toString().trim()));
    comfyuiProcess.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      console.log('[ComfyUI]', msg);
      // Relay meaningful status lines to loading window
      if (msg.includes('Loading') || msg.includes('Starting') || msg.includes('ready')) {
        sendLoadingUpdate(loadingWin, `ComfyUI: ${msg.slice(0, 60)}`, 45);
      }
    });
    comfyuiProcess.on('error', (err) => console.error('[ComfyUI] spawn error:', err.message));

    sendLoadingUpdate(loadingWin, 'Waiting for ComfyUI to start (may take 1-2 minutes)…', 35);

    // 2-minute timeout — model loading takes time
    const ok = await waitForPort(8188, '/system_stats', 120_000);

    if (ok) {
      console.log('[ComfyUI] Started successfully.');
      serviceLaunchStatus.comfyui = 'started';
      return { ok: true, comfyPath };
    } else {
      console.error('[ComfyUI] Timed out waiting for port 8188.');
      serviceLaunchStatus.comfyui = 'failed';
      return { ok: false, comfyPath };
    }
  } catch (err) {
    console.error('[ComfyUI] Failed to start:', err.message);
    serviceLaunchStatus.comfyui = 'failed';
    return { ok: false, comfyPath };
  }
}

// ── Model download ───────────────────────────────────────────────────────────

const MODEL_URL = 'https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors';
const MODEL_FILENAME = 'dreamshaper_8.safetensors';

function getModelPath(comfyPath) {
  const base = comfyPath || path.join(os.homedir(), 'ComfyUI');
  return path.join(base, 'models', 'checkpoints', MODEL_FILENAME);
}

async function checkAndDownloadModel(loadingWin, comfyPath) {
  const modelPath = getModelPath(comfyPath);
  sendLoadingUpdate(loadingWin, 'Checking for DreamShaper 8 model…', 70);

  if (fs.existsSync(modelPath)) {
    console.log('[Model] DreamShaper 8 already present at', modelPath);
    serviceLaunchStatus.modelPresent = true;
    return true;
  }

  console.log('[Model] DreamShaper 8 not found — downloading to', modelPath);
  sendLoadingUpdate(loadingWin, 'Downloading DreamShaper 8 (~2GB, first launch only)…', 75);

  const modelsDir = path.dirname(modelPath);
  fs.mkdirSync(modelsDir, { recursive: true });

  try {
    await streamDownload(MODEL_URL, modelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      const mb = Math.round(downloaded / 1024 / 1024);
      const totalMb = total > 0 ? Math.round(total / 1024 / 1024) : '?';
      sendLoadingUpdate(loadingWin, `Downloading model… ${mb}MB / ${totalMb}MB (${pct}%)`, 75 + Math.round(pct * 0.2));
    });
    serviceLaunchStatus.modelPresent = true;
    return true;
  } catch (err) {
    console.error('[Model] Download failed:', err.message);
    // Non-fatal — user can download manually; app still opens
    return false;
  }
}

/** Stream an HTTPS download with redirect following and progress callbacks. */
function streamDownload(url, destPath, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => {
      // Follow redirects (HuggingFace uses them)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        streamDownload(res.headers.location, destPath, onProgress, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const tmpPath = destPath + '.download';
      const out = fs.createWriteStream(tmpPath);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        onProgress(downloaded, total);
      });

      res.pipe(out);
      out.on('finish', () => {
        fs.renameSync(tmpPath, destPath);
        resolve();
      });
      out.on('error', (err) => {
        fs.unlink(tmpPath, () => {});
        reject(err);
      });
    });

    req.on('error', reject);
  });
}

// ── First-launch flag ────────────────────────────────────────────────────────

function isFirstLaunch() {
  const flagPath = path.join(app.getPath('userData'), '.imagginary-initialized');
  return !fs.existsSync(flagPath);
}

function markLaunched() {
  const flagPath = path.join(app.getPath('userData'), '.imagginary-initialized');
  try { fs.writeFileSync(flagPath, Date.now().toString(), 'utf8'); } catch { /* ignore */ }
}

// ── Service startup orchestrator ─────────────────────────────────────────────

async function startBundledServices(loadingWin) {
  serviceLaunchStatus.autoStartAttempted = true;

  // 1. Ollama
  const ollamaOk = await startOllama(loadingWin);
  sendLoadingUpdate(loadingWin, ollamaOk ? 'Ollama ready.' : 'Ollama unavailable — continuing.', 55);

  // 2. ComfyUI
  const { ok: comfyOk, comfyPath } = await startComfyUI(loadingWin);
  sendLoadingUpdate(loadingWin, comfyOk ? 'ComfyUI ready.' : 'ComfyUI not found — continuing.', 65);

  // 3. Model download on first launch (only if ComfyUI is available)
  if (comfyOk && isFirstLaunch()) {
    await checkAndDownloadModel(loadingWin, comfyPath);
    markLaunched();
  } else {
    // Check model presence anyway for status reporting
    const modelPath = getModelPath(comfyPath);
    serviceLaunchStatus.modelPresent = fs.existsSync(modelPath);
    if (!comfyOk) markLaunched(); // don't retry on every launch if comfy not installed
  }

  sendLoadingUpdate(loadingWin, 'Opening Imagginary…', 100);
  await sleep(400); // let the bar reach 100% visually
}

// ── Windows ──────────────────────────────────────────────────────────────────

function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      // nodeIntegration for simple IPC receive in loading.html
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.loadFile(path.join(__dirname, 'loading.html'));
  return win;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#030712',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // In the packaged app the renderer loads from file:// which gives it a null origin.
      // Chromium's CORS implementation does NOT match null origin against
      // Access-Control-Allow-Origin: * — so every fetch() to localhost is rejected before
      // it even leaves the renderer. Disabling webSecurity for the packaged build removes
      // that restriction. All content is local so the security trade-off is acceptable.
      webSecurity: !app.isPackaged,
    },
  });

  // Use app.isPackaged (Electron's authoritative flag) — not the isDev heuristic,
  // which can be fooled by ELECTRON_START_URL lingering in the shell environment.
  if (app.isPackaged) {
    // loadFile() sets the correct base URL so ./bundle.js resolves relative to index.html.
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:3000');
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── ComfyUI local proxy ───────────────────────────────────────────────────────
// Forwards renderer requests to ComfyUI with Origin: http://localhost:8188 so
// ComfyUI's origin-security check passes. The proxy port is exposed to the
// renderer via IPC; ComfyUIService uses it instead of connecting to 8188 directly.

let comfyuiProxyPort = null;

function startComfyUIProxy() {
  return new Promise((resolve) => {
    const { createServer } = http;
    const proxy = createServer((req, res) => {
      console.log('[ComfyUI Proxy] Incoming:', req.method, req.url);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        console.log('[ComfyUI Proxy] Preflight OPTIONS — responding 204');
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
      }

      // Strip headers that would conflict with or cause ComfyUI's security check to reject
      // the request. Chromium adds sec-fetch-* headers automatically on cross-origin fetches
      // from file:// pages — ComfyUI rejects sec-fetch-site: cross-site even when the origin
      // is in its allow-list. content-length is removed so Node.js recalculates it correctly.
      const forwardHeaders = { ...req.headers };
      delete forwardHeaders['content-length'];
      delete forwardHeaders['host'];
      delete forwardHeaders['origin'];
      delete forwardHeaders['sec-fetch-site'];
      delete forwardHeaders['sec-fetch-mode'];
      delete forwardHeaders['sec-fetch-dest'];
      delete forwardHeaders['sec-fetch-user'];
      delete forwardHeaders['sec-ch-ua'];
      delete forwardHeaders['sec-ch-ua-mobile'];
      delete forwardHeaders['sec-ch-ua-platform'];

      const options = {
        hostname: '127.0.0.1',
        port: 8188,
        path: req.url,
        method: req.method,
        headers: {
          ...forwardHeaders,
          host: '127.0.0.1:8188',
          origin: 'http://127.0.0.1:8188',
        },
      };

      const proxyReq = http.request(options, (proxyRes) => {
        console.log('[ComfyUI Proxy] Response:', proxyRes.statusCode, req.url);
        const responseHeaders = {
          ...proxyRes.headers,
          'access-control-allow-origin': '*',
        };
        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on('error', (err) => {
        console.error('[ComfyUI Proxy] Error:', err.message, req.url);
        if (!res.headersSent) res.writeHead(502);
        res.end(err.message);
      });

      req.pipe(proxyReq, { end: true });
    });

    // WebSocket upgrade — pipe TCP sockets directly after rewriting Host/Origin headers
    proxy.on('upgrade', (req, socket, head) => {
      const wsTarget = new net.Socket();
      wsTarget.connect(8188, '127.0.0.1', () => {
        const headerLines = Object.entries(req.headers)
          .filter(([k]) => !['host', 'origin'].includes(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n');
        wsTarget.write(
          `GET ${req.url} HTTP/1.1\r\n` +
          `Host: localhost:8188\r\n` +
          `Origin: http://localhost:8188\r\n` +
          (headerLines ? headerLines + '\r\n' : '') +
          '\r\n'
        );
        if (head && head.length) wsTarget.write(head);
        wsTarget.pipe(socket);
        socket.pipe(wsTarget);
      });
      wsTarget.on('error', (err) => {
        console.error('[ComfyUI Proxy] WS upstream error:', err.message);
        socket.destroy();
      });
      socket.on('error', () => wsTarget.destroy());
    });

    // Port 0 → OS picks a free port
    proxy.listen(0, '127.0.0.1', () => {
      comfyuiProxyPort = proxy.address().port;
      console.log('[ComfyUI Proxy] listening on port', comfyuiProxyPort);
      resolve(comfyuiProxyPort);
    });

    proxy.on('error', (err) => {
      console.error('[ComfyUI Proxy] server error:', err.message);
      resolve(null); // renderer falls back to direct 8188
    });
  });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // ── Relax CSP to allow renderer fetch() to localhost services ────────────
  // In packaged Electron the renderer runs from file:// (null origin). Chromium
  // blocks fetch() to http://localhost:* by default. Setting connect-src here
  // covers ComfyUI (8188), Ollama (11434), InstantMesh (7860), and the local
  // ComfyUI proxy — without rewriting every fetch call to IPC.
  session.defaultSession.webRequest.onBeforeRequest((_details, callback) => {
    callback({});
  });

  session.defaultSession.webRequest.onErrorOccurred((details) => {
    const proxyStr = comfyuiProxyPort ? String(comfyuiProxyPort) : '';
    if (
      details.url.includes('8188') ||
      details.url.includes('11434') ||
      details.url.includes('7860') ||
      (proxyStr && details.url.includes(proxyStr))
    ) {
      console.error('[Request blocked]', details.url, details.error);
    }
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
          "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; " +
          "img-src 'self' data: blob: http://127.0.0.1:* http://localhost:*;",
        ],
      },
    });
  });

  // ── Start ComfyUI local proxy ────────────────────────────────────────────
  // The renderer runs from file:// — fetch() sends Origin: null, which ComfyUI
  // rejects with 403. Electron's webRequest URL filter syntax doesn't support
  // port wildcards so onBeforeSendHeaders can't patch outgoing headers reliably.
  // Solution: a tiny Node.js proxy that forwards all traffic to ComfyUI with
  // the correct Origin header. The renderer talks to the proxy instead of 8188.
  const proxyPort = await startComfyUIProxy();
  console.log('[ComfyUI Proxy] Port assigned:', proxyPort);

  if (app.isPackaged) {
    // ── Packaged: show loading → start services → open main window ────────
    const loadingWin = createLoadingWindow();

    try {
      await startBundledServices(loadingWin);
    } catch (err) {
      console.error('[Startup] Unexpected error during service startup:', err);
    }

    if (!loadingWin.isDestroyed()) loadingWin.close();
    createMainWindow();
  } else {
    // ── Dev: skip auto-start, open main window immediately ────────────────
    createMainWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

app.on('before-quit', () => {
  if (ollamaProcess && !ollamaProcess.killed) {
    console.log('[Shutdown] Stopping Ollama.');
    ollamaProcess.kill('SIGTERM');
  }
  if (comfyuiProcess && !comfyuiProcess.killed) {
    console.log('[Shutdown] Stopping ComfyUI.');
    comfyuiProcess.kill('SIGTERM');
  }
});

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// Service launch status — called by App.tsx on mount
ipcMain.handle('get-service-launch-status', () => ({ ...serviceLaunchStatus }));

// Service health checks — renderer fetch() is blocked by CSP in packaged file:// context;
// running checks here in the main process bypasses that restriction entirely.
ipcMain.handle('check-ollama', async () => {
  try {
    const ok = await isPortOpen(11434, '/api/tags');
    return { connected: ok };
  } catch {
    return { connected: false };
  }
});

ipcMain.handle('check-comfyui', async () => {
  try {
    const ok = await isPortOpen(8188, '/system_stats');
    return { connected: ok };
  } catch {
    return { connected: false };
  }
});

// Returns the local proxy port so the renderer can route all ComfyUI requests through it.
ipcMain.handle('get-comfyui-proxy-port', () => {
  console.log('[IPC] get-comfyui-proxy-port called, returning:', comfyuiProxyPort);
  return comfyuiProxyPort;
});

// Model download — called from renderer (e.g. WelcomeFlow "Download" button)
ipcMain.handle('download-models', async (event) => {
  const comfyPath = await findComfyUIPath();
  const modelPath = getModelPath(comfyPath);

  if (fs.existsSync(modelPath)) {
    return { success: true, cached: true };
  }

  try {
    const modelsDir = path.dirname(modelPath);
    fs.mkdirSync(modelsDir, { recursive: true });

    await streamDownload(MODEL_URL, modelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      // Send progress to the renderer window that invoked us
      try { event.sender.send('download-model-progress', { pct, downloaded, total }); } catch { /* ignore */ }
    });

    serviceLaunchStatus.modelPresent = true;
    return { success: true, cached: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Project persistence
ipcMain.handle('save-project', async (_event, projectData, filePath) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(projectData, null, 2), 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-project', async (_event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return { success: true, data: JSON.parse(data) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-save-dialog', async (_event, options) => {
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('show-open-dialog', async (_event, options) => {
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('show-export-dialog', async (_event, options) => {
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('save-image', async (_event, base64Data, fileName) => {
  try {
    const appDataPath = app.getPath('userData');
    const imagesDir = path.join(appDataPath, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    const filePath = path.join(imagesDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-video', async (_event, base64Data, fileName) => {
  try {
    const outputDir = path.join(app.getPath('userData'), 'imagginary-clips');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-image', async (_event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    return { success: true, data: `data:${mime};base64,${base64}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-data-path', async () => app.getPath('userData'));

ipcMain.handle('open-folder', async (_event, folderPath) => {
  shell.openPath(folderPath);
});

ipcMain.handle('export-animatic', async (_event, panels, outputPath, fps = 24) => {
  console.log('[Animatic] Handler called. Panels:', panels?.length, 'Output:', outputPath);
  const concatFile = path.join(app.getPath('temp'), `imagginary-concat-${Date.now()}.txt`);

  const ffmpegAvailable = await new Promise((resolve) => {
    const probe = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });

  if (!ffmpegAvailable) {
    return {
      success: false,
      error: 'ffmpeg not found — install it via: brew install ffmpeg  or  https://ffmpeg.org',
    };
  }

  const tempPanelFiles = [];
  try {
    const validPanels = [];
    for (const panel of panels.filter((p) => p.generatedImagePath || p.generatedImageData)) {
      if (panel.generatedImagePath && fs.existsSync(panel.generatedImagePath)) {
        validPanels.push({ ...panel, resolvedPath: panel.generatedImagePath });
      } else if (panel.generatedImageData) {
        const tmpPath = path.join(app.getPath('temp'), `imagginary-panel-${panel.id}-${Date.now()}.png`);
        const b64 = panel.generatedImageData.replace(/^data:image\/[^;]+;base64,/, '');
        fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
        tempPanelFiles.push(tmpPath);
        validPanels.push({ ...panel, resolvedPath: tmpPath });
      }
    }

    if (validPanels.length === 0) {
      return { success: false, error: 'No generated panel images found on disk' };
    }

    const lines = [];
    for (const panel of validPanels) {
      lines.push(`file '${panel.resolvedPath.replace(/'/g, "'\\''")}'`);
      lines.push(`duration ${panel.duration}`);
    }
    const last = validPanels[validPanels.length - 1];
    lines.push(`file '${last.resolvedPath.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${last.duration}`);

    fs.writeFileSync(concatFile, lines.join('\n'), 'utf8');

    const encoder = await new Promise((resolve) => {
      const probe = spawn('ffmpeg', ['-hide_banner', '-encoders']);
      let out = '';
      probe.stdout.on('data', (d) => { out += d; });
      probe.stderr.on('data', (d) => { out += d; });
      probe.on('close', () => {
        if (out.includes('libx264')) resolve('libx264');
        else if (out.includes('h264_videotoolbox')) resolve('h264_videotoolbox');
        else resolve('libx264');
      });
    });

    const pixFmtArgs = encoder === 'h264_videotoolbox' ? [] : ['-pix_fmt', 'yuv420p'];

    const ffmpegArgs = [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vf', `scale=768:432:force_original_aspect_ratio=decrease,pad=768:432:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      '-c:v', encoder, ...pixFmtArgs, '-movflags', '+faststart', outputPath,
    ];

    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ffmpegArgs);
      ff.stderr.on('data', (data) => process.stderr.write(data));
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });

    return { success: true, outputPath };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { fs.unlinkSync(concatFile); } catch { /* ignore */ }
    for (const tmp of tempPanelFiles) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
});
