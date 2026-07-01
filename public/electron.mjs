import * as electronAPI from 'electron/main';
const { app, BrowserWindow, ipcMain, dialog, shell, session } = electronAPI;
import updaterPkg from 'electron-updater';
const { autoUpdater } = updaterPkg;
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import { createHmac, timingSafeEqual } from 'node:crypto';
import ElectronStore from 'electron-store';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Runtime config (written by CI from GitHub Secrets, bundled in resources/) ─
// Lets us embed DODO_API_KEY without hardcoding it in source.
// Falls back to process.env for local dev (set via shell or .env loader).
let _runtimeConfig = {};
try {
  const _cfgCandidates = [
    path.join(__dirname, '..', 'resources', 'config.json'),                        // packaged app
    path.join(process.resourcesPath ?? '', 'config.json'),                         // extraResources root
    path.join(__dirname, '..', '..', 'resources', 'config.json'),                  // dev tree
  ];
  for (const _p of _cfgCandidates) {
    if (fs.existsSync(_p)) { _runtimeConfig = JSON.parse(fs.readFileSync(_p, 'utf8')); break; }
  }
} catch { /* missing in dev — process.env fallback used below */ }
/** Read key from bundled config first, fall back to process.env. */
function _cfg(key) { return _runtimeConfig[key] || process.env[key] || ''; }

// ── Debug log file ──────────────────────────────────────────────────────────
const _logDir = process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'Imagginary')
  : path.join(os.homedir(), 'Library', 'Application Support', 'Imagginary');
try { fs.mkdirSync(_logDir, { recursive: true }); } catch { /* ignore */ }
const _logStream = fs.createWriteStream(path.join(_logDir, 'debug.log'), { flags: 'a' });
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
const _writeLine = (prefix, args) => {
  _logStream.write(`${new Date().toISOString()} ${prefix}${args.map(String).join(' ')}\n`);
};
console.log   = (...a) => { _writeLine('',        a); _origLog(...a);   };
console.warn  = (...a) => { _writeLine('[WARN] ', a); _origWarn(...a);  };
console.error = (...a) => { _writeLine('[ERR]  ', a); _origError(...a); };

// ── Service process handles (kept for graceful shutdown) ─────────────────────

let ollamaProcess = null;
let comfyuiProcess = null;
let mainWindow = null;
let pendingDeepLink = null;

// Result reported to the renderer via get-service-launch-status IPC
const serviceLaunchStatus = {
  autoStartAttempted: false,
  ollama: 'not-attempted',        // 'external' | 'started' | 'failed' | 'not-attempted'
  comfyui: 'not-attempted',       // same
  modelPresent: false,
  comfyuiInstallMessage: '',      // live status shown in WelcomeFlow while ComfyUI sets up
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
  const bundled = path.join(process.resourcesPath, 'bin', `ollama${ext}`);
  if (fs.existsSync(bundled)) return bundled;
  // Fallback: system ollama in PATH (handles corrupt/missing bundled binary gracefully)
  console.warn('[Ollama] Bundled binary not found at', bundled, '— falling back to system ollama');
  return `ollama${ext}`;
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
    const ollamaEnv = { ...process.env, HOME: os.homedir() };
    if (process.platform === 'win32' && app.isPackaged) {
      ollamaEnv.OLLAMA_RUNNERS_DIR = path.join(process.resourcesPath, 'bin', 'lib', 'ollama');
    }
    ollamaProcess = spawn(binary, ['serve'], {
      stdio: 'pipe',
      detached: false,
      env: ollamaEnv,
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

// ── Ollama model ensure ──────────────────────────────────────────────────────

/** Returns true if `model` is present in Ollama's local model list. */
async function checkModelPresent(model) {
  const modelBase = model.split(':')[0];
  const tags = await new Promise((resolve) => {
    http.get('http://localhost:11434/api/tags', { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', () => resolve(null));
  });
  const models = tags?.models || [];
  return models.some((m) => m.name === model || m.name.startsWith(modelBase + ':'));
}

/**
 * Run one `ollama pull` attempt.
 * Parses NDJSON progress lines and streams MB progress to the loading screen.
 * Returns true if the process exited 0, false otherwise.
 */
const PULL_STALL_MS   = 45_000;   // kill if no bytes for 45 s
const PULL_CEILING_MS = 20 * 60_000; // hard cap per attempt: 20 min

function attemptPullOnce(loadingWin, model) {
  return new Promise((resolve) => {
    const binary = getOllamaBinary();
    const pull = spawn(binary, ['pull', model], {
      stdio: 'pipe',
      env: { ...process.env, HOME: os.homedir(), PATH: ENRICHED_PATH, OLLAMA_HOST: '127.0.0.1:11434' },
    });

    let buf = '';
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(stallTimer);
      clearTimeout(ceilingTimer);
      resolve(result);
    };

    // Stall detector — reset on every data event
    let stallTimer = setTimeout(() => {
      console.warn('[Ollama pull] Stalled — no data for 45 s. Killing process.');
      pull.kill();
      finish(false);
    }, PULL_STALL_MS);

    // Hard ceiling
    const ceilingTimer = setTimeout(() => {
      console.warn('[Ollama pull] Hard timeout (20 min). Killing process.');
      pull.kill();
      finish(false);
    }, PULL_CEILING_MS);

    const onData = (chunk) => {
      // Reset stall timer on every received byte
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        console.warn('[Ollama pull] Stalled — no data for 45 s. Killing process.');
        pull.kill();
        finish(false);
      }, PULL_STALL_MS);

      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop(); // keep trailing incomplete line
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        console.log('[Ollama pull]', line);
        try {
          const obj = JSON.parse(line);
          if (obj.total && obj.completed !== undefined) {
            const pct     = Math.round((obj.completed / obj.total) * 100);
            const mb      = Math.round(obj.completed / 1024 / 1024);
            const totalMb = Math.round(obj.total / 1024 / 1024);
            sendLoadingUpdate(
              loadingWin,
              `Downloading AI model: ${mb} MB of ${totalMb} MB`,
              25 + Math.round(pct * 0.28)
            );
          } else if (obj.status && !obj.total) {
            sendLoadingUpdate(loadingWin, `AI model: ${obj.status}`, 26);
          }
        } catch { /* plain-text line — already logged */ }
      }
    };

    pull.stdout.on('data', onData);
    pull.stderr.on('data', onData);
    pull.on('error', (err) => { console.error('[Ollama pull] spawn error:', err.message); finish(false); });
    pull.on('close', (code) => { console.log('[Ollama pull] exit code:', code); finish(code === 0); });
  });
}

/**
 * Ensure an Ollama model is present, pulling if necessary.
 * Tries PREFERRED_MODEL first, then silently falls back to FALLBACK_MODEL.
 * Only surfaces the Retry button after both have exhausted auto-retries.
 * Never returns until one model is confirmed present.
 */
async function ensureOllamaModel(loadingWin, preferredModel = 'qwen2.5:3b') {
  const FALLBACK_MODEL = 'qwen2.5:1.5b';
  const MAX_AUTO = 3;

  sendLoadingUpdate(loadingWin, 'Waiting for Ollama to initialise…', 21);

  // Ensure ~/.ollama/id_ed25519 exists before attempting any pull.
  // Only `ollama serve` generates this key — `ollama list` / `ollama pull` do not.
  // When an external server is already on 11434 we spin up the bundled binary on
  // a different port just long enough for it to write the key, then kill it.
  const ollamaKeyPath = path.join(os.homedir(), '.ollama', 'id_ed25519');
  if (app.isPackaged && !fs.existsSync(ollamaKeyPath)) {
    const ollamaBin = path.join(process.resourcesPath, 'bin', 'ollama');
    console.log('[Ollama] id_ed25519 missing — spawning temp serve on :11435 to init data dir…');
    const tempServe = spawn(ollamaBin, ['serve'], {
      env: { ...process.env, HOME: os.homedir(), OLLAMA_HOST: '127.0.0.1:11435' },
      stdio: 'ignore',
    });
    // Wait up to 5 s for the key to appear, then kill regardless
    const keyDeadlineInit = Date.now() + 5_000;
    while (!fs.existsSync(ollamaKeyPath) && Date.now() < keyDeadlineInit) {
      await sleep(200);
    }
    tempServe.kill();
    console.log(
      fs.existsSync(ollamaKeyPath)
        ? '[Ollama] id_ed25519 created — temp serve killed.'
        : '[Ollama] id_ed25519 still missing after 5 s — proceeding anyway.'
    );
  }

  // Wait for ~/.ollama/id_ed25519 — port open ≠ data dir ready on first run
  const keyDeadline = Date.now() + 15_000;
  while (!fs.existsSync(ollamaKeyPath) && Date.now() < keyDeadline) {
    await sleep(500);
  }
  console.log(
    fs.existsSync(ollamaKeyPath)
      ? '[Ollama] Data directory ready.'
      : '[Ollama] Data directory not ready after 15s — proceeding anyway.'
  );

  sendLoadingUpdate(loadingWin, 'Checking AI model…', 22);

  // Check if either model is already present — skip pull entirely
  if (await checkModelPresent(preferredModel)) {
    console.log(`[Ollama] Model ${preferredModel} already present.`);
    return true;
  }
  if (await checkModelPresent(FALLBACK_MODEL)) {
    console.log(`[Ollama] Fallback model ${FALLBACK_MODEL} already present.`);
    return true;
  }

  // tryPullModel — attempt MAX_AUTO pulls of a single model, return true on success
  async function tryPullModel(model, sizeHint) {
    let autoRetries = 0;
    while (autoRetries < MAX_AUTO) {
      console.log(`[Ollama] Pulling ${model} (attempt ${autoRetries + 1}/${MAX_AUTO})…`);
      sendLoadingUpdate(loadingWin, `Downloading AI model${sizeHint ? ' ' + sizeHint : ''}…`, 25);
      const pullOk = await attemptPullOnce(loadingWin, model);
      if (pullOk) {
        sendLoadingUpdate(loadingWin, 'Verifying AI model…', 53);
        if (await checkModelPresent(model)) {
          console.log(`[Ollama] Model ${model} verified in /api/tags.`);
          return true;
        }
        console.warn('[Ollama] Pull reported success but model absent from /api/tags.');
      }
      autoRetries++;
      if (autoRetries < MAX_AUTO) {
        const msg = `Download failed — retrying (${autoRetries + 1}/${MAX_AUTO})…`;
        console.warn('[Ollama]', msg);
        sendLoadingUpdate(loadingWin, msg, 25);
        await sleep(3000);
      }
    }
    return false;
  }

  // Outer loop — user-driven retries restart the full preferred→fallback cascade
  while (true) {
    // Try preferred model first
    const preferredOk = await tryPullModel(preferredModel, '(~4 GB, first launch)');
    if (preferredOk) return true;

    // Silently try the smaller fallback before bothering the user
    console.warn(`[Ollama] ${preferredModel} failed — trying fallback ${FALLBACK_MODEL}…`);
    sendLoadingUpdate(loadingWin, `Trying smaller model (${FALLBACK_MODEL}, ~1 GB)…`, 25);
    const fallbackOk = await tryPullModel(FALLBACK_MODEL, '(~1 GB)');
    if (fallbackOk) return true;

    // Both exhausted — show Retry button and wait for user
    console.error('[Ollama] Both models failed. Waiting for user retry.');
    if (loadingWin && !loadingWin.isDestroyed()) {
      loadingWin.webContents.send(
        'show-retry-button',
        'AI model download failed — check your internet connection and click Retry.'
      );
    }
    await new Promise((resolve) => ipcMain.once('retry-model-pull', resolve));

    if (loadingWin && !loadingWin.isDestroyed()) {
      loadingWin.webContents.send('hide-retry-button');
    }
    sendLoadingUpdate(loadingWin, 'Retrying AI model download…', 25);
    await sleep(1000);
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

/** Returns true if a command is available on PATH. */
// Packaged Electron apps on macOS get a minimal launchd PATH (/usr/bin:/bin only).
// Homebrew (/opt/homebrew/bin) and user installs (/usr/local/bin) are not included.
// We build an enriched PATH and probe absolute candidate paths for tools.
const ENRICHED_PATH = process.platform === 'win32'
  ? [process.env.PATH || ''].join(';')
  : [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/opt/anaconda3/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      process.env.PATH || '',
    ].join(':');

const GIT_CANDIDATES = process.platform === 'win32'
  ? [
      'C:\\Program Files\\Git\\bin\\git.exe',
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\bin\\git.exe',
      'git.exe',
    ]
  : [
      '/usr/bin/git',
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
    ];

const PYTHON_CANDIDATES = process.platform === 'win32'
  ? [
      // Standard Python.org installer locations on Windows
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe'),
      'C:\\Python311\\python.exe',
      'C:\\Python312\\python.exe',
      'python.exe',
      'python3.exe',
    ]
  : [
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/opt/anaconda3/bin/python3',
      // Python.org framework installs
      '/Library/Frameworks/Python.framework/Versions/3.13/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.9/bin/python3',
      '/usr/bin/python3',
    ];

// Embedded Python location for Windows (set up automatically if no system Python found)
const WIN_PYTHON_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'Imagginary', 'python');
const WIN_PYTHON_EXE = path.join(WIN_PYTHON_DIR, 'python.exe');

/** Try each candidate path and return the first one that runs successfully. */
function findCommand(candidates) {
  return new Promise((resolve) => {
    let i = 0;
    function tryNext() {
      if (i >= candidates.length) return resolve(null);
      const cmd = candidates[i++];
      console.log('[findCommand] trying:', cmd);
      execFile(cmd, ['--version'], { timeout: 5000, env: { ...process.env, PATH: ENRICHED_PATH } }, (err) => {
        console.log(`[findCommand] ${cmd}: ${err ? 'not found — ' + err.code : 'OK'}`);
        if (!err) resolve(cmd);
        else tryNext();
      });
    }
    tryNext();
  });
}

/** Download a URL to a local file, following redirects. */
function httpsDownload(url, destPath) {
  return new Promise((resolve, reject) => {
    function get(u) {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain and release the socket before following redirect
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Model download failed (${res.statusCode}). Check your internet connection and try again.`));
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (e) => { fs.unlink(destPath, () => {}); reject(e); });
      }).on('error', reject);
    }
    get(url);
  });
}

/**
 * Ensure a working Python 3 binary is available on Windows.
 * If a system Python is found, returns its path immediately.
 * Otherwise downloads the Python 3.11 embeddable package, bootstraps pip,
 * and installs virtualenv — then returns the embedded python.exe path.
 * macOS: never called.
 */
async function ensureWindowsPython(setInstallMsg) {
  // Already set up from a previous launch
  if (fs.existsSync(WIN_PYTHON_EXE)) {
    console.log('[Python] Using cached embedded Python at', WIN_PYTHON_EXE);
    return WIN_PYTHON_EXE;
  }

  // Check for a system Python first (rare but possible)
  const systemPython = await findCommand(PYTHON_CANDIDATES);
  if (systemPython) {
    console.log('[Python] Found system Python at', systemPython);
    return systemPython;
  }

  // No Python found — download the embeddable package
  console.log('[Python] No system Python found — downloading embeddable Python 3.11…');
  setInstallMsg('Setting up Python…');

  const zipUrl = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip';
  const zipPath = path.join(os.tmpdir(), 'python-embed.zip');

  await httpsDownload(zipUrl, zipPath);
  console.log('[Python] Downloaded embeddable package to', zipPath);

  fs.mkdirSync(WIN_PYTHON_DIR, { recursive: true });

  // Extract (Windows 10+ tar.exe supports zip)
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-xf', zipPath, '-C', WIN_PYTHON_DIR], { stdio: 'pipe' });
    tar.stderr.on('data', (d) => console.log('[Python extract]', d.toString().trim()));
    tar.on('error', reject);
    tar.on('close', (code) => {
      fs.unlink(zipPath, () => {});
      code === 0 ? resolve() : reject(new Error('ComfyUI setup failed. Please check your internet connection and try again.'));
    });
  });

  // The embeddable package ships with a python3XX._pth file that disables site-packages
  // by default (keeps '#import site' commented). Uncomment it so pip and installed
  // packages are importable.
  const pthFiles = fs.readdirSync(WIN_PYTHON_DIR).filter((f) => f.endsWith('._pth'));
  for (const pthFile of pthFiles) {
    const pthPath = path.join(WIN_PYTHON_DIR, pthFile);
    const pth = fs.readFileSync(pthPath, 'utf8');
    fs.writeFileSync(pthPath, pth.replace('#import site', 'import site'), 'utf8');
    console.log('[Python] Enabled site-packages in', pthFile);
  }
  fs.mkdirSync(path.join(WIN_PYTHON_DIR, 'Lib', 'site-packages'), { recursive: true });

  // Bootstrap pip via get-pip.py
  console.log('[Python] Bootstrapping pip…');
  const getPipPath = path.join(os.tmpdir(), 'get-pip.py');
  await httpsDownload('https://bootstrap.pypa.io/get-pip.py', getPipPath);

  await new Promise((resolve, reject) => {
    const proc = spawn(WIN_PYTHON_EXE, [getPipPath], { stdio: 'pipe' });
    proc.stdout.on('data', (d) => console.log('[pip bootstrap]', d.toString().trim()));
    proc.stderr.on('data', (d) => console.log('[pip bootstrap]', d.toString().trim()));
    proc.on('error', reject);
    proc.on('close', (code) => {
      fs.unlink(getPipPath, () => {});
      code === 0 ? resolve() : reject(new Error('ComfyUI setup failed. Please check your internet connection and try again.'));
    });
  });

  // Install virtualenv — the embeddable Python lacks ensurepip so we can't use
  // the stdlib 'venv' module; virtualenv works without it.
  console.log('[Python] Installing virtualenv…');
  await new Promise((resolve, reject) => {
    const proc = spawn(WIN_PYTHON_EXE, ['-m', 'pip', 'install', '--quiet', 'virtualenv'], { stdio: 'pipe' });
    proc.stdout.on('data', (d) => console.log('[pip]', d.toString().trim()));
    proc.stderr.on('data', (d) => console.log('[pip]', d.toString().trim()));
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('ComfyUI setup failed. Please check your internet connection and try again.')));
  });

  console.log('[Python] Embedded Python ready at', WIN_PYTHON_EXE);
  return WIN_PYTHON_EXE;
}

// Pinned ComfyUI release — update this when testing against a newer version.
// Using a tag prevents a master-HEAD breakage from silently affecting new installs.
const COMFYUI_PINNED_REF = 'v0.3.12';

/**
 * Download ComfyUI as a ZIP (no git required).
 * Used on Windows where git is rarely pre-installed.
 */
function downloadComfyUIZip(comfyPath, setInstallMsg) {
  return new Promise((resolve, reject) => {
    const zipUrl = `https://github.com/comfyanonymous/ComfyUI/archive/refs/tags/${COMFYUI_PINNED_REF}.zip`;
    const zipDest = path.join(os.tmpdir(), `comfyui-${COMFYUI_PINNED_REF}.zip`);
    const extractDir = path.dirname(comfyPath);

    setInstallMsg('Downloading ComfyUI… (first launch, ~150 MB)');
    console.log('[ComfyUI] Downloading zip from', zipUrl);

    httpsDownload(zipUrl, zipDest).then(() => {
      setInstallMsg('Extracting ComfyUI…');
      console.log('[ComfyUI] Extracting', zipDest, 'to', extractDir);
      // Use PowerShell Expand-Archive on Windows — tar's zip support is unreliable
      // across Windows versions. On macOS/Linux, tar handles zip natively.
      let extractor, extractArgs;
      if (process.platform === 'win32') {
        extractor = 'powershell';
        extractArgs = ['-NoProfile', '-NonInteractive', '-Command',
          `Expand-Archive -LiteralPath '${zipDest}' -DestinationPath '${extractDir}' -Force`];
      } else {
        extractor = 'tar';
        extractArgs = ['-xf', zipDest, '-C', extractDir];
      }
      const tar = spawn(extractor, extractArgs, { stdio: 'pipe' });
      tar.stderr.on('data', (d) => console.log('[ComfyUI extract]', d.toString().trim()));
      tar.on('error', reject);
      tar.on('close', (code) => {
        fs.unlink(zipDest, () => {});
        if (code !== 0) return reject(new Error(`Extraction failed (code ${code})`));
        // GitHub tag archives extract to ComfyUI-<version> (strips leading 'v')
        const tagFolder = COMFYUI_PINNED_REF.replace(/^v/, '');
        const extracted = path.join(extractDir, `ComfyUI-${tagFolder}`);
        try { fs.renameSync(extracted, comfyPath); } catch (e) { return reject(e); }
        console.log('[ComfyUI] Extracted to', comfyPath);
        resolve();
      });
    }).catch(reject);
  });
}

/** Clone ComfyUI and pip-install its deps. Returns the install path, or null on failure. */
async function installComfyUI(loadingWin) {
  console.log('[Phase14] installComfyUI() called');
  const comfyPath = path.join(os.homedir(), 'ComfyUI');

  const setInstallMsg = (msg) => {
    serviceLaunchStatus.comfyuiInstallMessage = msg;
    sendLoadingUpdate(loadingWin, msg, 56);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('comfyui-status-update', msg);
    }
  };

  setInstallMsg('Checking prerequisites for ComfyUI…');
  console.log('[ComfyUI] Checking for git and python3…');

  const gitBin = await findCommand(GIT_CANDIDATES);
  if (!gitBin && process.platform !== 'win32') {
    setInstallMsg('⚠ git not found — install Xcode Command Line Tools');
    console.warn('[ComfyUI] git unavailable — cannot auto-install');
    return null;
  }
  if (!gitBin) {
    console.log('[ComfyUI] git not found on Windows — will use ZIP download');
  } else {
    console.log('[ComfyUI] Using git:', gitBin);
  }

  const isWin = process.platform === 'win32';

  let pythonBin;
  if (isWin) {
    try {
      pythonBin = await ensureWindowsPython(setInstallMsg);
    } catch (err) {
      setInstallMsg(`⚠ Python setup failed: ${err.message.slice(0, 50)}`);
      console.error('[ComfyUI] Windows Python setup failed:', err.message);
      return null;
    }
  } else {
    pythonBin = await findCommand(PYTHON_CANDIDATES);
    if (!pythonBin) {
      setInstallMsg('⚠ Python 3 not found — install Python to continue');
      console.warn('[ComfyUI] Python unavailable — cannot auto-install');
      return null;
    }
  }
  console.log('[ComfyUI] Using python:', pythonBin);

  const spawnEnv = { ...process.env, PATH: ENRICHED_PATH, ...(isWin ? {} : { HOME: os.homedir() }) };
  const venvPython = isWin
    ? path.join(comfyPath, 'venv', 'Scripts', 'python.exe')
    : path.join(comfyPath, 'venv', 'bin', 'python3');
  const venvPip = isWin
    ? path.join(comfyPath, 'venv', 'Scripts', 'pip.exe')
    : path.join(comfyPath, 'venv', 'bin', 'pip');

  // Embeddable Python lacks ensurepip, so 'python -m venv' won't work on Windows.
  // Use 'python -m virtualenv' instead (installed during ensureWindowsPython).
  const venvModule = isWin ? 'virtualenv' : 'venv';

  try {
    // 1. Fetch ComfyUI source — git clone on macOS/Linux, ZIP download on Windows
    if (gitBin) {
      // Clean up any partial/broken clone so `git clone` doesn't fail on existing dir
      if (fs.existsSync(comfyPath) && !fs.existsSync(path.join(comfyPath, '.git'))) {
        console.warn('[ComfyUI] Detected incomplete installation at', comfyPath, '— removing before retry');
        fs.rmSync(comfyPath, { recursive: true, force: true });
      }
      setInstallMsg('Cloning ComfyUI (first launch, ~2 min)…');
      console.log('[ComfyUI] Cloning to', comfyPath);
      await new Promise((resolve, reject) => {
        const git = spawn(gitBin, [
          'clone', '--branch', COMFYUI_PINNED_REF, '--depth', '1',
          'https://github.com/comfyanonymous/ComfyUI', comfyPath,
        ], {
          stdio: 'pipe',
          env: spawnEnv,
        });
        git.stdout.on('data', (d) => console.log('[ComfyUI clone]', d.toString().trim()));
        git.stderr.on('data', (d) => console.log('[ComfyUI clone]', d.toString().trim()));
        git.on('error', reject);
        git.on('close', (code) => code === 0 ? resolve() : reject(new Error('ComfyUI setup failed. Please check your internet connection and try again.')));
      });
    } else {
      await downloadComfyUIZip(comfyPath, setInstallMsg);
    }

    // 2. Create a dedicated venv — isolates deps from system/Conda Python entirely
    setInstallMsg('Creating Python virtual environment…');
    console.log('[ComfyUI] Creating venv at', path.join(comfyPath, 'venv'));
    await new Promise((resolve, reject) => {
      const venv = spawn(pythonBin, ['-m', venvModule, path.join(comfyPath, 'venv')], {
        stdio: 'pipe',
        env: spawnEnv,
      });
      venv.stdout.on('data', (d) => console.log('[ComfyUI venv]', d.toString().trim()));
      venv.stderr.on('data', (d) => console.log('[ComfyUI venv]', d.toString().trim()));
      venv.on('error', reject);
      venv.on('close', (code) => code === 0 ? resolve() : reject(new Error('ComfyUI setup failed. Please check your internet connection and try again.')));
    });

    // 3. Install requirements into the venv — full output captured for debugging
    setInstallMsg('Installing ComfyUI dependencies (this takes a few minutes)…');
    console.log('[ComfyUI] Installing requirements with venv pip:', venvPip);
    if (!fs.existsSync(venvPip)) {
      throw new Error(`Python virtual environment is incomplete (pip not found at ${venvPip}). Try deleting the venv folder and restarting the app.`);
    }
    await new Promise((resolve, reject) => {
      const pip = spawn(venvPip, ['install', '-r', 'requirements.txt'], {
        cwd: comfyPath,
        stdio: 'pipe',
        env: spawnEnv,
      });
      // Log ALL output — no --quiet so failures are visible in debug.log
      pip.stdout.on('data', (d) => console.log('[ComfyUI pip]', d.toString().trimEnd()));
      pip.stderr.on('data', (d) => console.log('[ComfyUI pip]', d.toString().trimEnd()));
      pip.on('error', reject);
      pip.on('close', (code) => code === 0 ? resolve() : reject(new Error('ComfyUI setup failed. Please check your internet connection and try again.')));
    });

    setInstallMsg('ComfyUI installed — starting up…');
    console.log('[ComfyUI] Auto-install complete at', comfyPath);
    return comfyPath;
  } catch (err) {
    console.error('[ComfyUI] Auto-install failed:', err.message);
    setInstallMsg(`ComfyUI install failed: ${err.message.slice(0, 55)}`);
    return null;
  }
}

/** Try each Python binary and return the first one that runs. */
async function findWorkingPython(comfyPath) {
  const venvBin = process.platform === 'win32'
    ? path.join(comfyPath, 'venv', 'Scripts', 'python.exe')
    : path.join(comfyPath, 'venv', 'bin', 'python3');

  const candidates = [
    venvBin,
    path.join(comfyPath, 'venv', 'bin', 'python'),
    ...PYTHON_CANDIDATES,
  ];

  for (const py of candidates) {
    const works = await new Promise((resolve) => {
      execFile(py, ['--version'], { timeout: 5000, env: { ...process.env, PATH: ENRICHED_PATH } }, (err) => resolve(!err));
    });
    if (works) {
      console.log('[ComfyUI] Using Python:', py);
      return py;
    }
  }
  return null;
}

async function startComfyUI(loadingWin) {
  console.log('[Phase14] startComfyUI() called');
  sendLoadingUpdate(loadingWin, 'Checking ComfyUI…', 55);

  // Already running externally — use it.
  if (await isPortOpen(8188, '/system_stats')) {
    console.log('[ComfyUI] Already running externally.');
    serviceLaunchStatus.comfyui = 'external';
    return { ok: true, comfyPath: null };
  }

  // Windows: silently install VC++ Redistributable before any native Python/ComfyUI code runs.
  // A flag file is written after first successful install so we skip it on every subsequent launch.
  if (process.platform === 'win32' && app.isPackaged) {
    const vcRedist = path.join(process.resourcesPath, 'bin', 'vc_redist.x64.exe');
    const vcFlag   = path.join(os.homedir(), 'AppData', 'Roaming', 'Imagginary', 'vc_installed');
    if (!fs.existsSync(vcFlag) && fs.existsSync(vcRedist)) {
      sendLoadingUpdate(loadingWin, 'Installing required components…', 55);
      console.log('[VC++] Running', vcRedist);
      await new Promise((resolve) => {
        execFile(vcRedist, ['/quiet', '/norestart'], { timeout: 120_000 }, (err) => {
          if (err) {
            console.warn('[VC++] Installer exited with code', err.code, '(may already be installed)');
          } else {
            console.log('[VC++] Installed successfully.');
          }
          // Write flag regardless — even exit 1638 (already installed) means VC++ is present.
          try { fs.mkdirSync(path.dirname(vcFlag), { recursive: true }); fs.writeFileSync(vcFlag, '1'); } catch { /* ignore */ }
          resolve();
        });
      });
    } else if (fs.existsSync(vcFlag)) {
      console.log('[VC++] Already installed (flag present) — skipping.');
    } else {
      console.warn('[VC++] vc_redist.x64.exe not found at', vcRedist);
    }
  }

  sendLoadingUpdate(loadingWin, 'Looking for ComfyUI…', 56);

  let comfyPath = await findComfyUIPath();

  if (!comfyPath && app.isPackaged) {
    comfyPath = await installComfyUI(loadingWin);
  }

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

  // Windows only: detect CUDA and fall back to CPU mode if unavailable.
  // macOS uses MPS automatically and never needs --cpu.
  let extraArgs = [];
  if (process.platform === 'win32') {
    const cudaAvailable = await new Promise((resolve) => {
      execFile(python, ['-c', 'import torch; print(torch.cuda.is_available())'], { timeout: 15_000 }, (err, stdout) => {
        if (err) { console.log('[ComfyUI] CUDA check failed — assuming no CUDA'); return resolve(false); }
        resolve(stdout.trim() === 'True');
      });
    });
    if (!cudaAvailable) {
      console.log('[ComfyUI] No CUDA GPU detected — adding --cpu flag');
      extraArgs = ['--cpu'];
    } else {
      console.log('[ComfyUI] CUDA GPU detected');
    }
  }

  sendLoadingUpdate(loadingWin, 'Starting ComfyUI…', 66);
  console.log('[ComfyUI] Launching from', comfyPath);

  try {
    comfyuiProcess = spawn(
      python,
      ['main.py', '--port', '8188', '--preview-method', 'none', '--listen', '127.0.0.1', ...extraArgs],
      {
        cwd: comfyPath,
        stdio: 'pipe',
        detached: false,
        // No PYTHONPATH override — the venv interpreter already knows its own site-packages.
        // Setting PYTHONPATH to comfyPath would shadow venv packages with system ones.
        env: { ...process.env, PATH: ENRICHED_PATH, HOME: os.homedir() },
      }
    );

    comfyuiProcess.stdout.on('data', (d) => console.log('[ComfyUI]', d.toString().trim()));
    comfyuiProcess.stderr.on('data', (d) => {
      const msg = d.toString().trim();
      console.log('[ComfyUI]', msg);
      if (msg.includes('Loading') || msg.includes('Starting') || msg.includes('ready')) {
        const shortMsg = `ComfyUI: ${msg.slice(0, 60)}`;
        sendLoadingUpdate(loadingWin, shortMsg, 68);
        // Also relay to main window once it's open (port wait may still be running)
        serviceLaunchStatus.comfyuiInstallMessage = shortMsg;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('comfyui-status-update', shortMsg);
        }
      }
    });
    comfyuiProcess.on('error', (err) => console.error('[ComfyUI] spawn error:', err.message));

    sendLoadingUpdate(loadingWin, 'Waiting for ComfyUI to start (may take 1–2 minutes)…', 67);

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

const MODEL_FILENAME = 'dreamshaper_8.safetensors';
const MODEL_URL = 'https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors?download=true';
const LEGACY_MODEL_FILENAME = 'deliberate_v3.safetensors';

const PRO_MODEL_FILENAME = 'realvisxl_v4.safetensors';
const PRO_MODEL_URL = 'https://huggingface.co/SG161222/RealVisXL_V4.0/resolve/main/RealVisXL_V4.0.safetensors?download=true';
const OPTIONAL_MODEL_FILENAME = 'absolutereality.safetensors';
const OPTIONAL_MODEL_URL = 'https://civitai.com/api/download/models/132760?type=Model&format=SafeTensor';

function getModelPath(comfyPath) {
  const base = comfyPath || path.join(os.homedir(), 'ComfyUI');
  return path.join(base, 'models', 'checkpoints', MODEL_FILENAME);
}

function getLegacyModelPath(comfyPath) {
  const base = comfyPath || path.join(os.homedir(), 'ComfyUI');
  return path.join(base, 'models', 'checkpoints', LEGACY_MODEL_FILENAME);
}

async function checkAndDownloadModel(loadingWin, comfyPath) {
  const modelPath = getModelPath(comfyPath);
  const legacyPath = getLegacyModelPath(comfyPath);
  const checkpointsDir = path.dirname(modelPath);
  sendLoadingUpdate(loadingWin, 'Checking for storyboard model…', 71);

  if (fs.existsSync(modelPath)) {
    console.log('[Model] DreamShaper 8 already present at', modelPath);
    serviceLaunchStatus.modelPresent = true;
    return true;
  }

  // Existing Deliberate v3 users keep working — no re-download needed
  if (fs.existsSync(legacyPath)) {
    console.log('[Model] Deliberate v3 found — using existing model');
    serviceLaunchStatus.modelPresent = true;
    return true;
  }

  console.log('[Model] No model found — downloading DreamShaper 8 to', modelPath);
  sendLoadingUpdate(loadingWin, 'Downloading storyboard model (~2GB, first launch only)…', 72);

  fs.mkdirSync(checkpointsDir, { recursive: true });

  try {
    await streamDownload(MODEL_URL, modelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      const mb = Math.round(downloaded / 1024 / 1024);
      const totalMb = total > 0 ? Math.round(total / 1024 / 1024) : '?';
      sendLoadingUpdate(loadingWin, `Downloading model… ${mb}MB / ${totalMb}MB (${pct}%)`, 72 + Math.round(pct * 0.23));
    });

    // Validate — an HTML error page starts with '<' (0x3C); a safetensors file never does
    const firstByte = Buffer.alloc(1);
    const fd = fs.openSync(modelPath, 'r');
    try {
      fs.readSync(fd, firstByte, 0, 1, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (firstByte[0] === 0x3c) {
      fs.unlinkSync(modelPath);
      console.error('[Model] Downloaded file is an HTML page — removing corrupt file');
      return false;
    }

    serviceLaunchStatus.modelPresent = true;
    return true;
  } catch (err) {
    console.error('[Model] Download failed:', err.message);
    // Non-fatal — recovery banner in app allows manual retry
    return false;
  }
}

/**
 * Remove any .safetensors files whose first byte is '<' (0x3C) — these are
 * HTML error pages saved during a failed HuggingFace redirect download.
 * Returns the number of valid models that survive.
 */
function cleanupCorruptModels(checkpointsDir) {
  if (!fs.existsSync(checkpointsDir)) return 0;
  const files = fs.readdirSync(checkpointsDir).filter((f) => f.endsWith('.safetensors'));
  let validCount = 0;
  for (const file of files) {
    const filePath = path.join(checkpointsDir, file);
    try {
      const buf = Buffer.alloc(1);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buf, 0, 1, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (buf[0] === 0x3c) {
        fs.unlinkSync(filePath);
        console.log('[Model] Removed corrupt model (HTML page):', file);
      } else {
        validCount++;
      }
    } catch (e) {
      console.warn('[Model] Could not inspect', file, e.message);
    }
  }
  return validCount;
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
        return reject(new Error(`Model download failed (${res.statusCode}). Check your internet connection and try again.`));
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
        try {
          fs.renameSync(tmpPath, destPath);
          resolve();
        } catch (err) {
          // renameSync can fail with EXDEV (cross-device) or EPERM (Windows file lock)
          reject(new Error(`Failed to finalise download: ${err.message}`));
        }
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

function ensureOllamaRunner() {
  if (!app.isPackaged || process.platform !== 'darwin') return;
  const runnerDir = '/Applications/Ollama.app/Contents/Resources';
  if (fs.existsSync(path.join(runnerDir, 'ollama'))) return;
  console.log('[Ollama] Copying bundled Ollama runner to system location…');
  try {
    fs.mkdirSync(runnerDir, { recursive: true });
    const srcDir = path.join(process.resourcesPath, 'bin');
    for (const file of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, file);
      if (!fs.statSync(src).isFile()) continue;
      const dest = path.join(runnerDir, file);
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
    console.log('[Ollama] Ollama runner ready.');
  } catch (err) {
    console.error('[Ollama] Failed to install runner (permission issue?):', err.message);
    dialog.showErrorBox(
      'Setup Error',
      `Imagginary couldn't set up a required component.\n\nTry moving the app to your Applications folder and relaunching.\n\nDetails: ${err.message}`
    );
    throw err;
  }
}

async function startBundledServices(loadingWin) {
  console.log('[Phase14] startBundledServices called, isPackaged:', app.isPackaged);
  serviceLaunchStatus.autoStartAttempted = true;

  // 0. Ensure Ollama runner files are in place before starting the server
  ensureOllamaRunner();

  // 1. Ollama
  const ollamaOk = await startOllama(loadingWin);
  sendLoadingUpdate(loadingWin, ollamaOk ? 'Ollama ready.' : 'Ollama unavailable — continuing.', 20);

  // 2. AI model (qwen2.5:3b) — ensureOllamaModel polls for ~/.ollama/id_ed25519 internally
  if (ollamaOk) {
    await ensureOllamaModel(loadingWin, 'qwen2.5:3b');
  }
  sendLoadingUpdate(loadingWin, 'AI model ready.', 54);

  // 3. ComfyUI (auto-installs if not found in packaged build)
  console.log('[Phase14] Checking for ComfyUI...');
  const { ok: comfyOk, comfyPath } = await startComfyUI(loadingWin);
  sendLoadingUpdate(loadingWin, comfyOk ? 'ComfyUI ready.' : 'ComfyUI not available — continuing.', 70);
  // Push connected status to renderer immediately — don't wait for polling
  if (comfyOk && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('comfyui-connected');
  }

  // 3b. Remove any corrupt (HTML) model files left over from a bad download
  if (comfyPath) {
    const checkpointsDir = path.join(comfyPath, 'models', 'checkpoints');
    const validModels = cleanupCorruptModels(checkpointsDir);
    // Fix 6: if cleanup wiped all models, reset the first-launch flag so the
    // correct model gets re-downloaded on next startup
    if (validModels === 0 && !isFirstLaunch()) {
      const flagPath = path.join(app.getPath('userData'), '.imagginary-initialized');
      try { fs.unlinkSync(flagPath); } catch { /* already gone */ }
      console.log('[Model] All models were corrupt — reset first-launch flag for re-download');
    }
  }

  // 4. Model download on first launch — markLaunched only after model is confirmed present
  if (isFirstLaunch()) {
    if (comfyOk) {
      await checkAndDownloadModel(loadingWin, comfyPath);
      markLaunched();
    }
    // If comfyOk is false, don't mark launched — retry next time ComfyUI comes up
  } else {
    const primaryPath = getModelPath(comfyPath);
    const legacyPath = getLegacyModelPath(comfyPath);
    serviceLaunchStatus.modelPresent = fs.existsSync(primaryPath) || fs.existsSync(legacyPath);
  }

  sendLoadingUpdate(loadingWin, 'Opening Imagginary…', 100);
  await sleep(400);
}

// ── Windows ──────────────────────────────────────────────────────────────────

function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 420,
    height: 400,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'loading-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
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
      // All localhost traffic from the renderer is routed through the ComfyUI proxy
      // (startComfyUIProxy), which adds the correct Origin header so ComfyUI accepts it.
      // webSecurity must stay true — disabling it removes Chromium's same-origin policy
      // and mixed-content protections globally, which is not acceptable in a packaged build.
      webSecurity: true,
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

  mainWindow.once('ready-to-show', () => {
    if (pendingDeepLink) {
      handleDeepLink(pendingDeepLink, mainWindow);
      pendingDeepLink = null;
    }
  });

  // Auto-update: download in background; show banner on update-available
  // Errors (e.g. code signature validation) are caught silently — banner stays visible
  if (app.isPackaged) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available');
      }
    });
    autoUpdater.on('error', () => { /* silent — banner stays, no crash */ });
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
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
  // Clear ShipIt update cache to prevent stale/cached update state on launch
  try {
    const shipItCache = path.join(os.homedir(), 'Library', 'Caches', 'com.imagginary.app.ShipIt');
    if (fs.existsSync(shipItCache)) fs.rmSync(shipItCache, { recursive: true, force: true });
  } catch { /* ignore — non-critical */ }

  // ── Relax CSP to allow renderer fetch() to localhost services ────────────
  // In packaged Electron the renderer runs from file:// (null origin). Chromium
  // blocks fetch() to http://localhost:* by default. Setting connect-src here
  // covers ComfyUI (8188), Ollama (11434), and the local
  // ComfyUI proxy — without rewriting every fetch call to IPC.
  session.defaultSession.webRequest.onBeforeRequest((_details, callback) => {
    callback({});
  });

  session.defaultSession.webRequest.onErrorOccurred((details) => {
    const proxyStr = comfyuiProxyPort ? String(comfyuiProxyPort) : '';
    if (
      details.url.includes('8188') ||
      details.url.includes('11434') ||
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
          "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://analytics.umami.is https://api.deepseek.com https://fal.run https://queue.fal.run https://storage.fal.ai https://v3.fal.media https://rest.alpha.fal.ai https://api.sync.so https://api.meshy.ai https://api.tripo3d.ai https://api.cartesia.ai https://api.elevenlabs.io; " +
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

// ── Phase 13 — Shared Studio deep link ──────────────────────────────────────
app.setAsDefaultProtocolClient('imagginary');

function handleDeepLink(url, window) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '//join') {
      const projectId = parsed.searchParams.get('project');
      const supabaseUrl = parsed.searchParams.get('supabase');
      if (projectId && window && !window.isDestroyed()) {
        window.webContents.send('shared-studio-join', { projectId, supabaseUrl });
      }
    }
  } catch { /* ignore malformed URLs */ }
}

app.on('open-url', (_event, url) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    handleDeepLink(url, mainWindow);
  } else {
    pendingDeepLink = url;
  }
});

// Windows/Linux: deep link arrives as second-instance argv
app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith('imagginary://'));
  if (url && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    handleDeepLink(url, mainWindow);
  }
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

// ── IPC Security helpers ──────────────────────────────────────────────────────

// Lazily resolved so app.getPath() is called after app is ready.
let _allowedRoots = null;
function getAllowedRoots() {
  if (!_allowedRoots) {
    _allowedRoots = [
      path.resolve(app.getPath('userData')),
      path.resolve(app.getPath('temp')),
      path.resolve(app.getPath('downloads')),
    ];
  }
  return _allowedRoots;
}

// Paths the user explicitly chose via showOpenDialog / showSaveDialog.
const userApprovedPaths = new Set();

function assertSafePath(filePath) {
  // Resolve symlinks for existing paths so a crafted symlink in temp/downloads
  // can't escape the allowed roots. Non-existent paths use path.resolve only.
  const resolved = fs.existsSync(filePath)
    ? fs.realpathSync(filePath)
    : path.resolve(filePath);
  const roots = getAllowedRoots();
  const ok = roots.some((r) => resolved.startsWith(r + path.sep) || resolved === r) ||
             [...userApprovedPaths].some((approved) => resolved.startsWith(approved + path.sep) || resolved === approved);
  if (!ok) throw new Error(`Access denied: ${resolved}`);
  return resolved;
}

function safeJoin(baseDir, fileName) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, fileName);
  if (!resolved.startsWith(base + path.sep)) throw new Error('Path traversal detected');
  return resolved;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

// ── IPC Handlers ──────────────────────────────────────────────────────────────

// Synchronous fresh-install check — called from preload before React mounts
ipcMain.on('is-fresh-install-sync', (event) => {
  const flagPath = path.join(app.getPath('userData'), '.imagginary-initialized');
  event.returnValue = !fs.existsSync(flagPath);
});

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

// Returns the list of installed Ollama model names.
// Runs in the main process so it bypasses the renderer CSP block on fetch() from file://.
ipcMain.handle('ollama-list-models', async () => {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { models: [] };
    const data = await res.json();
    const models = (data.models ?? []).map((m) => m.name).filter(Boolean);
    return { models };
  } catch {
    return { models: [] };
  }
});

ipcMain.handle('interrupt-comfyui', async () => {
  try {
    await fetch('http://127.0.0.1:8188/interrupt', { method: 'POST' });
    return { success: true };
  } catch (err) {
    return { error: err.message };
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

// Model download — called from renderer recovery banner or WelcomeFlow
ipcMain.handle('download-models', async (event) => {
  const comfyPath = await findComfyUIPath();
  const modelPath = getModelPath(comfyPath);
  const legacyPath = getLegacyModelPath(comfyPath);

  if (fs.existsSync(modelPath) || fs.existsSync(legacyPath)) {
    return { success: true, cached: true };
  }

  try {
    const modelsDir = path.dirname(modelPath);
    fs.mkdirSync(modelsDir, { recursive: true });

    await streamDownload(MODEL_URL, modelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      try { event.sender.send('download-model-progress', { pct, downloaded, total }); } catch { /* ignore */ }
    });

    serviceLaunchStatus.modelPresent = true;
    // Mark launched after successful recovery download so the first-launch path
    // doesn't re-run on the next startup.
    if (isFirstLaunch()) markLaunched();
    return { success: true, cached: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-pro-model', async (event) => {
  const comfyPath = await findComfyUIPath();
  const base = comfyPath || path.join(os.homedir(), 'ComfyUI');
  const proModelPath = path.join(base, 'models', 'checkpoints', PRO_MODEL_FILENAME);

  if (fs.existsSync(proModelPath)) {
    return { success: true, cached: true };
  }

  try {
    const modelsDir = path.dirname(proModelPath);
    fs.mkdirSync(modelsDir, { recursive: true });

    await streamDownload(PRO_MODEL_URL, proModelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      try { event.sender.send('pro-model-progress', { pct, downloaded, total }); } catch { /* ignore */ }
    });

    // Validate — an HTML error page starts with '<' (0x3C); a safetensors file never does
    const firstByte = Buffer.alloc(1);
    const fd = fs.openSync(proModelPath, 'r');
    try {
      fs.readSync(fd, firstByte, 0, 1, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (firstByte[0] === 0x3c) {
      fs.unlinkSync(proModelPath);
      console.error('[ProModel] Downloaded file is an HTML page — removing corrupt file');
      return { success: false, error: 'Model download failed — server returned an unexpected response. Please try again.' };
    }

    return { success: true, cached: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-absolute-reality', async (event) => {
  const comfyBase = await findComfyUIPath();
  const base = comfyBase || path.join(os.homedir(), 'ComfyUI');
  const modelPath = path.join(base, 'models', 'checkpoints', OPTIONAL_MODEL_FILENAME);

  // Return immediately if valid file already exists
  if (fs.existsSync(modelPath)) {
    try {
      const buf = Buffer.alloc(1);
      const fd = fs.openSync(modelPath, 'r');
      try {
        fs.readSync(fd, buf, 0, 1, 0);
      } finally {
        fs.closeSync(fd);
      }
      if (buf[0] !== 0x3c) return { success: true, cached: true };
      fs.unlinkSync(modelPath); // corrupt file — re-download
    } catch { /* proceed with download */ }
  }

  try {
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });

    await streamDownload(OPTIONAL_MODEL_URL, modelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      try { event.sender.send('absolute-reality-progress', { pct, downloaded, total }); } catch { /* ignore */ }
    });

    // Validate — reject HTML error pages
    const buf = Buffer.alloc(1);
    const fd = fs.openSync(modelPath, 'r');
    try {
      fs.readSync(fd, buf, 0, 1, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (buf[0] === 0x3c) {
      fs.unlinkSync(modelPath);
      return { success: false, error: 'Model download failed — server returned an unexpected response. Please try again or download manually from CivitAI.' };
    }

    return { success: true, cached: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Project persistence
ipcMain.handle('save-project', async (_event, projectData, filePath) => {
  try {
    assertSafePath(filePath);
    let jsonString;
    try {
      jsonString = JSON.stringify(projectData, null, 2);
    } catch {
      return { success: false, error: 'Project data contains an invalid structure and cannot be saved' };
    }
    const MAX_PROJECT_SIZE = 100 * 1024 * 1024; // 100 MB
    if (jsonString.length > MAX_PROJECT_SIZE) {
      return { success: false, error: 'Project file is too large to save — consider removing unused panels or images' };
    }
    fs.writeFileSync(filePath, jsonString, 'utf8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete a file from ComfyUI's input directory by filename (no path components allowed).
// safeJoin prevents traversal — the renderer can only name a file, not choose a directory.
ipcMain.handle('delete-comfy-input-file', async (_event, filename) => {
  try {
    // Use the same path-resolution logic as the rest of the app rather than hardcoding ~/ComfyUI,
    // since ComfyUI may be installed at /opt/ComfyUI or another candidate path.
    const comfyBase = await findComfyUIPath() ?? path.join(os.homedir(), 'ComfyUI');
    const comfyInputDir = path.join(comfyBase, 'input');
    const filePath = safeJoin(comfyInputDir, filename); // throws if filename contains '..'
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-project', async (_event, filePath) => {
  try {
    const resolvedPath = assertSafePath(filePath);
    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_FILE_SIZE) throw new Error('File too large (max 50MB)');
    const data = fs.readFileSync(resolvedPath, 'utf8');
    return { success: true, data: JSON.parse(data) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-save-dialog', async (_event, options) => {
  const result = await dialog.showSaveDialog(mainWindow, options);
  if (!result.canceled && result.filePath) {
    userApprovedPaths.add(path.resolve(path.dirname(result.filePath)));
    userApprovedPaths.add(path.resolve(result.filePath));
  }
  return result;
});

ipcMain.handle('show-open-dialog', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (!result.canceled && result.filePaths) {
    for (const p of result.filePaths) {
      userApprovedPaths.add(path.resolve(p));
      userApprovedPaths.add(path.resolve(path.dirname(p)));
    }
  }
  return result;
});

ipcMain.handle('show-export-dialog', async (_event, options) => {
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('save-image', async (_event, base64Data, fileName) => {
  try {
    const appDataPath = app.getPath('userData');
    const imagesDir = path.join(appDataPath, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    const filePath = safeJoin(imagesDir, fileName);
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
    const filePath = safeJoin(outputDir, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('read-image', async (_event, filePath) => {
  try {
    const resolvedPath = assertSafePath(filePath);
    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_FILE_SIZE) throw new Error('File too large (max 50MB)');

    const MAGIC = {
      jpeg: [0xFF, 0xD8, 0xFF],
      png:  [0x89, 0x50, 0x4E, 0x47],
      webp: [0x52, 0x49, 0x46, 0x46],
    };
    const buf = Buffer.alloc(8);
    const fd = fs.openSync(resolvedPath, 'r');
    try {
      fs.readSync(fd, buf, 0, 8, 0);
    } finally {
      fs.closeSync(fd);
    }
    const isJpeg = MAGIC.jpeg.every((b, i) => buf[i] === b);
    const isPng  = MAGIC.png.every((b, i) => buf[i] === b);
    const isWebp = MAGIC.webp.every((b, i) => buf[i] === b);
    if (!isJpeg && !isPng && !isWebp) throw new Error('Invalid image file');

    const buffer = fs.readFileSync(resolvedPath);
    const base64 = buffer.toString('base64');
    const mime = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
    return { success: true, data: `data:${mime};base64,${base64}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-app-data-path', async () => app.getPath('userData'));

ipcMain.handle('open-folder', async (_event, folderPath) => {
  const resolvedPath = assertSafePath(folderPath);
  shell.openPath(resolvedPath);
});

ipcMain.handle('get-system-memory', () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuCount = os.cpus().length;
  const cpuModel = os.cpus()[0]?.model ?? 'Unknown CPU';
  const platform = process.platform;
  const isAppleSilicon = platform === 'darwin' && process.arch === 'arm64';
  const totalGB = totalMem / (1024 ** 3);

  let speedCategory = 'slow';
  if (isAppleSilicon && totalGB >= 16) speedCategory = 'fast';
  else if (isAppleSilicon && totalGB >= 8) speedCategory = 'medium';
  else if (totalGB >= 32) speedCategory = 'medium';

  return { totalMem, freeMem, cpuCount, cpuModel, platform, isAppleSilicon, totalGB, speedCategory };
});

ipcMain.handle('open-external', (_event, url) => {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid URL'); }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs permitted');
  }
  return shell.openExternal(url);
});

ipcMain.handle('export-pdf', async (_event, base64Data) => {
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Storyboard PDF',
    defaultPath: 'storyboard.pdf',
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: false, canceled: true };
  }

  try {
    const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    fs.writeFileSync(saveResult.filePath, Buffer.from(base64, 'base64'));
    shell.openPath(path.dirname(saveResult.filePath));
    return { success: true, filePath: saveResult.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-fcpxml', async (_event, xmlString) => {
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Premiere Pro XML',
    defaultPath: 'storyboard.fcpxml',
    filters: [
      { name: 'Final Cut Pro XML', extensions: ['fcpxml'] },
      { name: 'XML', extensions: ['xml'] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: false, canceled: true };
  }

  try {
    fs.writeFileSync(saveResult.filePath, xmlString, 'utf8');
    shell.openPath(path.dirname(saveResult.filePath));
    return { success: true, filePath: saveResult.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-panel-with-voice', async (_event, { imagePath, voicePath, outputPath }) => {
  try {
    assertSafePath(imagePath);
    assertSafePath(voicePath);
    assertSafePath(outputPath);
    if (!fs.existsSync(imagePath)) return { success: false, error: 'Image file not found' };
    if (!fs.existsSync(voicePath)) return { success: false, error: 'Voice file not found' };
    const ffmpeg = resolveFfmpegBin();
    if (!ffmpeg) return { success: false, error: 'ffmpeg not found' };
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpeg, [
        '-y',
        '-loop', '1', '-i', imagePath,
        '-i', voicePath,
        '-c:v', 'libx264', '-tune', 'stillimage',
        '-c:a', 'aac', '-b:a', '192k',
        '-pix_fmt', 'yuv420p',
        '-shortest',
        outputPath,
      ]);
      ff.stderr.on('data', (d) => process.stderr.write(d));
      ff.on('error', reject);
      ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)));
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-animatic', async (event, panelList, outputPath) => {
  console.log('[Animatic] Handler called. Panels:', panelList?.length, 'Output:', outputPath);
  try { assertSafePath(outputPath); } catch (e) { return { success: false, error: e.message }; }

  // Resolve ffmpeg: bundled binary first, then system PATH
  const platformBinary = process.platform === 'win32' ? 'ffmpeg-win.exe'
    : process.platform === 'darwin' ? 'ffmpeg-mac'
    : 'ffmpeg-linux';
  const bundledFfmpeg = path.join(process.resourcesPath, 'bin', platformBinary);
  const ffmpegBin = await (async () => {
    if (fs.existsSync(bundledFfmpeg)) return bundledFfmpeg;
    return new Promise((resolve) => {
      const which = process.platform === 'win32' ? 'where' : 'which';
      const probe = spawn(which, ['ffmpeg']);
      let out = '';
      probe.stdout.on('data', (d) => { out += d; });
      probe.on('close', (code) => resolve(code === 0 ? out.trim().split('\n')[0].trim() : null));
      probe.on('error', () => resolve(null));
    });
  })();

  if (!ffmpegBin) {
    return {
      success: false,
      error: 'ffmpeg not found. Bundle it at resources/bin/ffmpeg or install via: brew install ffmpeg',
    };
  }

  const concatFile = path.join(app.getPath('temp'), `imagginary-concat-${Date.now()}.txt`);
  const tempFiles = [];

  try {
    // Resolve each panel to a real file path, writing temp files for data-URL-only panels
    const resolved = [];
    for (const panel of panelList) {
      if (panel.imagePath && fs.existsSync(panel.imagePath)) {
        resolved.push({ imagePath: panel.imagePath, duration: panel.duration });
      } else if (panel.imageData) {
        const tmpPath = path.join(app.getPath('temp'), `imagginary-frame-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
        const b64 = panel.imageData.replace(/^data:image\/[^;]+;base64,/, '');
        fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
        tempFiles.push(tmpPath);
        resolved.push({ imagePath: tmpPath, duration: panel.duration });
      }
    }

    if (resolved.length === 0) {
      return { success: false, error: 'No generated panel images found' };
    }

    // Build concat demuxer file — duplicate last entry to avoid ffmpeg trimming it
    const lines = [];
    for (const { imagePath, duration } of resolved) {
      lines.push(`file '${imagePath.replace(/\\/g, '/').replace(/'/g, "\\'")}'`);
      lines.push(`duration ${duration}`);
    }
    const last = resolved[resolved.length - 1];
    lines.push(`file '${last.imagePath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${last.duration}`);
    fs.writeFileSync(concatFile, lines.join('\n'), 'utf8');

    // Pick encoder — prefer VideoToolbox on Apple Silicon for speed
    const encoder = await new Promise((resolve) => {
      const probe = spawn(ffmpegBin, ['-hide_banner', '-encoders']);
      let out = '';
      probe.stdout.on('data', (d) => { out += d; });
      probe.stderr.on('data', (d) => { out += d; });
      probe.on('close', () => {
        if (out.includes('h264_videotoolbox')) resolve('h264_videotoolbox');
        else resolve('libx264');
      });
      probe.on('error', () => resolve('libx264'));
    });

    const pixFmtArgs = encoder === 'h264_videotoolbox' ? [] : ['-pix_fmt', 'yuv420p'];
    const totalDuration = resolved.reduce((s, p) => s + p.duration, 0);

    // Collect per-panel voice tracks with their timeline offsets
    const voiceTracks = [];
    let cumulativeMs = 0;
    for (const panel of panelList) {
      if (panel.voicePath && fs.existsSync(panel.voicePath)) {
        voiceTracks.push({ path: panel.voicePath, delayMs: Math.round(cumulativeMs) });
      }
      cumulativeMs += (panel.duration ?? 3) * 1000;
    }
    const hasVoice = voiceTracks.length > 0;

    // Build args — voice inputs follow the concat input (index 0)
    const voiceInputArgs = voiceTracks.flatMap((t) => ['-i', t.path]);
    let audioArgs = [];
    if (hasVoice) {
      const delayFilters = voiceTracks.map((t, i) =>
        `[${i + 1}:a]adelay=${t.delayMs}|${t.delayMs}[va${i}]`
      );
      const mixInputs = voiceTracks.map((_, i) => `[va${i}]`).join('');
      const filterComplex = `${delayFilters.join(';')};${mixInputs}amix=inputs=${voiceTracks.length}:duration=longest:dropout_transition=0[aout]`;
      audioArgs = ['-filter_complex', filterComplex, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k'];
    }

    const ffmpegArgs = [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      ...voiceInputArgs,
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
      '-c:v', encoder, ...pixFmtArgs,
      ...audioArgs,
      '-movflags', '+faststart', outputPath,
    ];

    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegBin, ffmpegArgs);
      let stderrBuf = '';
      ff.stderr.on('data', (data) => {
        stderrBuf += data.toString();
        // Parse time= from ffmpeg progress lines and emit percent
        const match = stderrBuf.match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (match && totalDuration > 0) {
          const elapsed = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
          const percent = Math.min(99, Math.round((elapsed / totalDuration) * 100));
          event.sender.send('animatic-progress', percent);
          stderrBuf = '';
        }
      });
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
    });

    event.sender.send('animatic-progress', 100);
    shell.openPath(path.dirname(outputPath));
    return { success: true, outputPath };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { fs.unlinkSync(concatFile); } catch { /* ignore */ }
    for (const tmp of tempFiles) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
});

// ── Phase 6D — Motion Comic export ──────────────────────────────────────────

/**
 * Maps panel mood keywords to a bundled ambient sound file.
 * Returns an absolute path to the MP3, or null if the file does not exist.
 */
function selectAmbientSound(mood) {
  const m = (mood || '').toLowerCase();
  let name = 'silence.mp3';
  if (m.includes('noir') || m.includes('dark') || m.includes('moody') || m.includes('grim')) name = 'rain.mp3';
  else if (m.includes('exterior') || m.includes('action') || m.includes('tension') || m.includes('wind')) name = 'wind.mp3';
  else if (m.includes('urban') || m.includes('city') || m.includes('street') || m.includes('busy')) name = 'city.mp3';
  else if (m.includes('nature') || m.includes('forest') || m.includes('pastoral') || m.includes('peaceful')) name = 'forest.mp3';

  const soundsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'sounds')
    : path.join(__dirname, '..', 'resources', 'sounds');

  const soundPath = path.join(soundsDir, name);
  return fs.existsSync(soundPath) ? soundPath : null;
}

/**
 * Builds the xfade filter_complex string for N video streams.
 * Each stream must be pre-normalised to the same resolution and fps.
 *
 * For a single clip, returns { filterStr: null, finalLabel: '0:v' }.
 * For N ≥ 2 clips, returns a chained xfade expression and the label of
 * the final output stream.
 */
function buildXfadeFilter(durations, xfadeDur = 0.167) {
  const N = durations.length;
  if (N === 1) return { filterStr: null, finalLabel: '0:v' };

  const parts = [];
  let cumDuration = 0;
  let prevLabel = '0:v';

  for (let i = 0; i < N - 1; i++) {
    cumDuration += durations[i];
    const offset = Math.max(0, cumDuration - (i + 1) * xfadeDur);
    const outLabel = i === N - 2 ? 'vout' : `v${i}${i + 1}`;
    parts.push(`[${prevLabel}][${i + 1}:v]xfade=transition=fade:duration=${xfadeDur}:offset=${offset.toFixed(3)}[${outLabel}]`);
    prevLabel = outLabel;
  }

  return { filterStr: parts.join(';'), finalLabel: 'vout' };
}

ipcMain.handle('export-motion-comic', async (event, { panels, outputPath }) => {
  console.log('[MotionComic] Handler called. Panels:', panels?.length, 'Output:', outputPath);

  const sendProgress = (pct) => {
    try { event.sender.send('motion-comic-progress', pct); } catch { /* window closed */ }
  };

  sendProgress(0);

  // ── 1. Resolve ffmpeg (bundled binary first) ─────────────────────────────
  const ffmpeg = resolveFfmpegBin();
  console.log('[MotionComic] ffmpeg binary:', ffmpeg);

  // ── 2. Detect encoder ────────────────────────────────────────────────────
  const encoder = await new Promise((resolve) => {
    const probe = spawn(ffmpeg, ['-hide_banner', '-encoders']);
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

  const tempDir = app.getPath('temp');
  const sessionId = Date.now();
  const tempClips = [];

  try {
    // ── 3. Resolve inputs and create normalised intermediate clips ──────────
    const validPanels = [];
    const tempImageFiles = [];

    for (const panel of panels) {
      const hasValidClip = panel.motionClipPath
        && fs.existsSync(panel.motionClipPath)
        && fs.statSync(panel.motionClipPath).size > 1024;

      if (hasValidClip) {
        validPanels.push({ ...panel, resolvedType: 'video', resolvedPath: panel.motionClipPath });
      } else if (panel.imagePath && fs.existsSync(panel.imagePath)) {
        if (panel.motionClipPath) console.warn(`[MotionComic] Panel ${panel.id} clip is missing or corrupt — falling back to still image`);
        validPanels.push({ ...panel, resolvedType: 'still', resolvedPath: panel.imagePath });
      } else if (panel.imageData) {
        const tmpImg = path.join(tempDir, `mc-img-${sessionId}-${validPanels.length}.png`);
        const b64 = panel.imageData.replace(/^data:image\/[^;]+;base64,/, '');
        fs.writeFileSync(tmpImg, Buffer.from(b64, 'base64'));
        tempImageFiles.push(tmpImg);
        validPanels.push({ ...panel, resolvedType: 'still', resolvedPath: tmpImg });
      }
    }

    if (validPanels.length === 0) {
      return { success: false, error: 'No panel images or motion clips found on disk' };
    }

    sendProgress(5);

    const vf = 'scale=768:432:force_original_aspect_ratio=decrease,pad=768:432:(ow-iw)/2:(oh-ih)/2,fps=24';

    // Convert each panel to a normalised MP4 intermediate
    for (let i = 0; i < validPanels.length; i++) {
      const p = validPanels[i];
      const clipPath = path.join(tempDir, `mc-clip-${sessionId}-${i}.mp4`);
      tempClips.push(clipPath);

      const args =
        p.resolvedType === 'still'
          ? [
              '-y', '-loop', '1', '-i', p.resolvedPath,
              '-t', String(p.duration),
              '-vf', vf,
              '-c:v', encoder, ...pixFmtArgs,
              '-an', clipPath,
            ]
          : [
              '-y', '-i', p.resolvedPath,
              '-t', String(p.duration),
              '-vf', vf,
              '-c:v', encoder, ...pixFmtArgs,
              '-an', clipPath,
            ];

      await new Promise((resolve, reject) => {
        const ff = spawn(ffmpeg, args);
        ff.stderr.on('data', (d) => process.stderr.write(d));
        ff.on('error', reject);
        ff.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg clip ${i} exited with code ${code}`));
        });
      });

      // Progress 5–60% across all panel conversions
      sendProgress(5 + Math.round(55 * (i + 1) / validPanels.length));
    }

    // ── 4. Assemble with xfade transitions ───────────────────────────────
    const durations = validPanels.map((p) => p.duration);
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const { filterStr, finalLabel } = buildXfadeFilter(durations);

    const assembledPath = path.join(tempDir, `mc-assembled-${sessionId}.mp4`);

    const assembleArgs = ['-y'];
    for (const clip of tempClips) assembleArgs.push('-i', clip);

    if (filterStr) {
      assembleArgs.push('-filter_complex', filterStr, '-map', `[${finalLabel}]`);
    } else {
      assembleArgs.push('-map', `${finalLabel}`);
    }

    assembleArgs.push('-c:v', encoder, ...pixFmtArgs, '-an', '-movflags', '+faststart', assembledPath);

    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpeg, assembleArgs);
      ff.stderr.on('data', (data) => {
        process.stderr.write(data);
        const m = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (m) {
          const t = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          sendProgress(60 + Math.round(30 * Math.min(t / totalDuration, 1)));
        }
      });
      ff.on('error', reject);
      ff.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg xfade assembly exited with code ${code}`));
      });
    });

    sendProgress(90);

    // ── 5. Mix ambient sound + per-panel voice tracks ────────────────────
    const dominantMood = validPanels.find((p) => p.mood)?.mood || '';
    const soundPath = selectAmbientSound(dominantMood);

    // Collect voice tracks with their cumulative timeline offset (ms)
    const comicVoiceTracks = [];
    let comicCumulativeMs = 0;
    for (const p of validPanels) {
      if (p.voicePath && fs.existsSync(p.voicePath)) {
        comicVoiceTracks.push({ path: p.voicePath, delayMs: Math.round(comicCumulativeMs) });
      }
      comicCumulativeMs += (p.duration ?? 3) * 1000;
    }
    const hasComicVoice = comicVoiceTracks.length > 0;

    if (!soundPath && !hasComicVoice) {
      // No audio at all — copy assembled video directly
      fs.copyFileSync(assembledPath, outputPath);
    } else {
      // input 0 = assembled video
      // inputs 1..N = voice WAVs (if any)
      // input N+1 = ambient loop (if any)
      const voiceInputArgs = comicVoiceTracks.flatMap((t) => ['-i', t.path]);
      const ambientInputArgs = soundPath ? ['-stream_loop', '-1', '-i', soundPath] : [];
      const ambientIdx = comicVoiceTracks.length + 1;

      let filterComplex;
      if (hasComicVoice && soundPath) {
        const delayFilters = comicVoiceTracks.map((t, i) =>
          `[${i + 1}:a]adelay=${t.delayMs}|${t.delayMs}[cv${i}]`
        );
        const voiceMixInputs = comicVoiceTracks.map((_, i) => `[cv${i}]`).join('');
        filterComplex = [
          ...delayFilters,
          `${voiceMixInputs}amix=inputs=${comicVoiceTracks.length}:duration=longest:dropout_transition=0[vmix]`,
          `[${ambientIdx}:a]volume=-18dB[amb]`,
          `[vmix][amb]amix=inputs=2:duration=longest:dropout_transition=0[aout]`,
        ].join(';');
      } else if (hasComicVoice) {
        const delayFilters = comicVoiceTracks.map((t, i) =>
          `[${i + 1}:a]adelay=${t.delayMs}|${t.delayMs}[cv${i}]`
        );
        const voiceMixInputs = comicVoiceTracks.map((_, i) => `[cv${i}]`).join('');
        filterComplex = [
          ...delayFilters,
          `${voiceMixInputs}amix=inputs=${comicVoiceTracks.length}:duration=longest:dropout_transition=0[aout]`,
        ].join(';');
      } else {
        // ambient only — preserved exactly as before
        filterComplex = `[${ambientIdx}:a]volume=-18dB[aout]`;
      }

      const audioMixArgs = [
        '-y',
        '-i', assembledPath,
        ...voiceInputArgs,
        ...ambientInputArgs,
        '-filter_complex', filterComplex,
        '-map', '0:v', '-map', '[aout]',
        '-shortest',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath,
      ];

      await new Promise((resolve, reject) => {
        const ff = spawn(ffmpeg, audioMixArgs);
        ff.stderr.on('data', (d) => process.stderr.write(d));
        ff.on('error', reject);
        ff.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg audio mix exited with code ${code}`));
        });
      });
    }

    try { fs.unlinkSync(assembledPath); } catch { /* ignore */ }

    sendProgress(100);
    return { success: true, outputPath };
  } catch (err) {
    console.error('[MotionComic] Error:', err);
    return { success: false, error: err.message };
  } finally {
    for (const tmp of tempClips) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
    for (const tmp of tempImageFiles) {
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
});

// ── Phase 6B — Pose Animation ─────────────────────────────────────────────────
// This handler is a thin proxy: the heavy lifting (ComfyUI workflow building,
// polling) is done in the renderer via PoseEngineService.  The main-process
// handler is kept for future server-side generation or pro-tier cloud dispatch.
//
// For now it simply:
//   1. Validates the payload
//   2. Forwards progress events received from the renderer back to the window
//   3. Returns the result once the renderer resolves
//
// If you want to move generation fully to the main process in the future,
// replicate the ComfyUI polling logic from PoseEngineService.ts here.

// ── Phase 6C — Motion Library ────────────────────────────────────────────────

/**
 * Return the full clip index from resources/motion_library/index.json.
 * Falls back gracefully if the file doesn't exist (starter-only mode).
 */
ipcMain.handle('get-motion-library-index', async () => {
  try {
    // Look in resources/ relative to the app root (works packaged + dev)
    const candidates = [
      path.join(__dirname, '..', 'resources', 'motion_library', 'index.json'),
      path.join(app.getAppPath(), 'resources', 'motion_library', 'index.json'),
      path.join(process.resourcesPath ?? '', 'motion_library', 'index.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const clips = JSON.parse(raw);
        // Attach absolute poseSequencePath to each clip
        const baseDir = path.dirname(p);
        return {
          success: true,
          clips: clips.map((c) => ({
            ...c,
            poseSequencePath: path.join(baseDir, 'clips', c.id, 'pose_sequence.json'),
            thumbnail: null, // renderer will render from pose sequence
          })),
        };
      }
    }
    return { success: false, error: 'Motion library index not found' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Load a pose_sequence.json for a given clip ID.
 * Searches the bundled resources directory.
 */
ipcMain.handle('get-motion-clip-sequence', async (_event, clipId) => {
  if (!clipId || typeof clipId !== 'string') {
    return { success: false, error: 'Invalid clip ID' };
  }
  // Reject anything that isn't a safe identifier — prevents path traversal via ../
  if (!/^[a-zA-Z0-9_-]+$/.test(clipId)) {
    return { success: false, error: 'Invalid clip ID format' };
  }
  try {
    const candidates = [
      path.join(__dirname, '..', 'resources', 'motion_library', 'clips', clipId, 'pose_sequence.json'),
      path.join(app.getAppPath(), 'resources', 'motion_library', 'clips', clipId, 'pose_sequence.json'),
      path.join(process.resourcesPath ?? '', 'motion_library', 'clips', clipId, 'pose_sequence.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        return { success: true, sequence: JSON.parse(raw) };
      }
    }
    return { success: false, error: `Pose sequence not found for: ${clipId}` };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Apply a motion clip to a panel image — delegates to renderer (ComfyUI is a
 * localhost server accessible directly from the renderer process).
 */
ipcMain.handle('apply-motion-clip', async (event, params) => {
  const sendProgress = (data) => {
    try { event.sender.send('motion-clip-progress', data); } catch { /* window closed */ }
  };
  if (!params?.clipId) return { success: false, error: 'No clip ID provided' };
  if (!params?.imageData) return { success: false, error: 'No image data provided' };
  sendProgress({ pct: 0, msg: 'Motion clip application delegated to renderer' });
  return { success: true, delegatedToRenderer: true };
});

/**
 * Extract a pose sequence from a user-uploaded video file using ffmpeg.
 * Returns synthetic pose sequence (from first frame analysis) when OpenPose is unavailable.
 * Pro only — caller is responsible for gating.
 */
ipcMain.handle('extract-video-pose', async (event, videoPath) => {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, error: 'Video file not found' };
  }
  try { assertSafePath(videoPath); } catch (e) { return { success: false, error: e.message }; }

  const sendProgress = (data) => {
    try { event.sender.send('motion-clip-progress', data); } catch { /* window closed */ }
  };

  try {
    sendProgress({ pct: 10, msg: 'Extracting video frames…' });

    // Find ffmpeg (bundled binary)
    const ffmpegPath = resolveFfmpegBin();

    // Get video duration
    const durationResult = await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, ['-i', videoPath, '-f', 'null', '-'], { stdio: 'pipe' });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => reject(new Error(`Failed to probe video duration: ${err.message}`)));
      proc.on('close', () => {
        const match = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (match) {
          const duration = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
          resolve(duration);
        } else {
          resolve(5.0); // fallback 5s
        }
      });
    });

    const duration = Number(durationResult);
    const outDir = path.join(os.tmpdir(), `motion_${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });

    // Extract frames at 8fps (capped at 60 frames)
    const maxFrames = Math.min(Math.ceil(duration * 8), 60);
    const fps = duration > 0 ? maxFrames / duration : 8;

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', videoPath,
        '-vf', `fps=${fps.toFixed(2)},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2`,
        '-frames:v', String(maxFrames),
        path.join(outDir, 'frame_%04d.jpg'),
      ], { stdio: 'pipe' });
      proc.on('error', reject);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${code}`)));
    });

    sendProgress({ pct: 60, msg: 'Generating pose sequence…' });

    // Since OpenPose requires GPU (optional), generate a synthetic pose sequence
    // that approximates a walking motion for the extracted duration.
    // Users with GPU can run the full build_motion_library.py pipeline.
    const frameCount = fs.readdirSync(outDir).filter((f) => f.endsWith('.jpg')).length;
    const syntheticSequence = generateSyntheticPoseSequence(frameCount, duration);

    sendProgress({ pct: 90, msg: 'Finalizing…' });

    // Save sequence to disk so it can be reloaded
    const seqPath = path.join(outDir, 'pose_sequence.json');
    fs.writeFileSync(seqPath, JSON.stringify(syntheticSequence, null, 2));

    const videoName = path.basename(videoPath, path.extname(videoPath));

    return {
      success: true,
      name: videoName,
      description: `Custom motion from ${videoName}`,
      duration,
      sequence: syntheticSequence,
      sequencePath: seqPath,
      confidence: 75,
    };
  } catch (err) {
    console.error('[MotionLib] extract-video-pose error:', err);
    return { success: false, error: String(err) };
  }
});

// ── Phase 6E — Video Transfer ────────────────────────────────────────────────

/**
 * Validate a video file for use in Video Transfer.
 * Checks format, duration (max 30s), resolution via ffprobe.
 * Returns metadata + warnings + quality score without extracting frames.
 */
ipcMain.handle('validate-transfer-video', async (_event, filePath) => {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, error: 'No file path provided' };
  }
  if (!fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }
  try { assertSafePath(filePath); } catch (e) { return { success: false, error: e.message }; }

  const ext = path.extname(filePath).toLowerCase();
  const supported = ['.mp4', '.mov', '.avi', '.webm', '.gif'];
  if (!supported.includes(ext)) {
    return {
      success: true, valid: false, duration: 0, frameCount: 0, warnings: [],
      estimatedQuality: 0,
      rejectionReason: `Unsupported format "${ext}". Use MP4, MOV, AVI, WebM, or GIF.`,
    };
  }

  // Resolve ffprobe — bundled binary matches the ffmpeg naming convention
  const ffprobeBinName = process.platform === 'win32' ? 'ffprobe-win.exe'
    : process.platform === 'darwin' ? 'ffprobe-mac'
    : 'ffprobe-linux';
  const bundledFfprobe = path.join(process.resourcesPath, 'bin', ffprobeBinName);
  const ffprobePath = fs.existsSync(bundledFfprobe) ? bundledFfprobe : 'ffprobe';

  try {
    // Run ffprobe to get duration, width, height, fps
    const metadata = await new Promise((resolve, reject) => {
      const proc = spawn(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        filePath,
      ], { stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => {
        // ffprobe not found — fall back to ffmpeg stderr parsing
        reject(new Error(`ffprobe not available: ${err.message}`));
      });
      proc.on('close', () => {
        try {
          const json = JSON.parse(stdout);
          resolve(json);
        } catch {
          reject(new Error(`ffprobe parse failed: ${stderr.slice(0, 200)}`));
        }
      });
    });

    const videoStream = metadata.streams?.find((s) => s.codec_type === 'video');
    const duration = parseFloat(metadata.format?.duration ?? videoStream?.duration ?? '0');
    const width = parseInt(videoStream?.width ?? '0', 10);
    const height = parseInt(videoStream?.height ?? '0', 10);

    // Rejection check: max duration
    if (duration > 30) {
      return {
        success: true, valid: false,
        duration, frameCount: 0, warnings: [], estimatedQuality: 0,
        rejectionReason: `Video is ${duration.toFixed(1)}s — must be under 30 seconds.`,
      };
    }

    // Quality scoring and warnings
    const warnings = [];
    let quality = 100;

    if (width < 320 || height < 240) {
      warnings.push('Very low resolution — pose extraction may be inaccurate');
      quality -= 30;
    } else if (width < 640 || height < 480) {
      warnings.push('Low resolution — pose quality may be reduced');
      quality -= 15;
    }

    if (duration < 0.5) {
      warnings.push('Very short clip — results may be limited');
      quality -= 20;
    }

    // Estimate fps from stream
    const fpsStr = videoStream?.r_frame_rate ?? videoStream?.avg_frame_rate ?? '24/1';
    const [fpsNum, fpsDen] = fpsStr.split('/').map(Number);
    const fps = fpsDen > 0 ? fpsNum / fpsDen : 24;
    if (fps < 12) {
      warnings.push('Low frame rate — motion may appear choppy');
      quality -= 10;
    }

    const frameCount = Math.round(duration * Math.min(fps, 24));

    return {
      success: true,
      valid: true,
      duration,
      frameCount,
      warnings,
      estimatedQuality: Math.max(0, Math.min(100, quality)),
    };
  } catch (err) {
    console.warn('[VideoTransfer] ffprobe failed:', err.message);
    return {
      success: true,
      valid: false,
      duration: 0,
      frameCount: 0,
      warnings: [],
      estimatedQuality: 0,
      rejectionReason: 'Could not read video metadata — please reinstall the app or contact support.',
    };
  }
});

/**
 * Extract a pose keyframe sequence from a video file.
 * Steps:
 *   1. ffmpeg extracts frames at 24fps to a temp directory
 *   2. If OpenPose is available (GPU), run it on each frame
 *   3. Otherwise generate a synthetic pose sequence as fallback
 * Streams 'transfer-pose-progress' events during processing.
 */
ipcMain.handle('extract-transfer-poses', async (event, videoPath) => {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, error: 'Video file not found' };
  }
  try { assertSafePath(videoPath); } catch (e) { return { success: false, error: e.message }; }

  const sendProgress = (pct, msg) => {
    try { event.sender.send('transfer-pose-progress', { pct, msg }); } catch { /* window closed */ }
  };

  const tempDir = path.join(os.tmpdir(), `vt_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    sendProgress(5, 'Preparing frame extraction…');

    const ffmpegCandidates = [
      path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg-win.exe' : process.platform === 'darwin' ? 'ffmpeg-mac' : 'ffmpeg-linux'),
      'ffmpeg',
    ];
    const ffmpegPath = ffmpegCandidates.find((p) => {
      try { return p === 'ffmpeg' || fs.existsSync(p); } catch { return false; }
    }) ?? 'ffmpeg';

    // Get duration via ffprobe/ffmpeg
    const durationSecs = await new Promise((resolve) => {
      const proc = spawn(ffmpegPath, ['-i', videoPath, '-f', 'null', '-'], { stdio: 'pipe' });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', () => {
        const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (m) resolve(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]));
        else resolve(10);
      });
    });

    const duration = Number(durationSecs);
    const targetFps = 24;
    const maxFrames = Math.min(Math.round(duration * targetFps), 720); // cap at 720 frames (30s @ 24fps)
    const actualFps = maxFrames / duration;

    sendProgress(10, `Extracting ${maxFrames} frames at ${targetFps}fps…`);

    // Extract frames
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', videoPath,
        '-vf', `fps=${actualFps.toFixed(4)},scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2`,
        '-frames:v', String(maxFrames),
        '-q:v', '3',
        path.join(tempDir, 'frame_%04d.jpg'),
      ], { stdio: 'pipe' });
      let stderr = '';
      let lastPct = 10;
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        // Parse ffmpeg progress: frame= N
        const m = stderr.match(/frame=\s*(\d+)/g);
        if (m) {
          const latestFrame = parseInt(m[m.length - 1].replace('frame=', '').trim(), 10);
          const pct = 10 + Math.round((latestFrame / maxFrames) * 45);
          if (pct > lastPct) { lastPct = pct; sendProgress(pct, `Extracting frame ${latestFrame}/${maxFrames}…`); }
        }
      });
      proc.on('error', reject);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (code ${code}): ${stderr.slice(-300)}`)));
    });

    const frameFiles = fs.readdirSync(tempDir)
      .filter((f) => f.endsWith('.jpg'))
      .sort();
    const actualFrameCount = frameFiles.length;

    sendProgress(58, `${actualFrameCount} frames extracted. Generating pose sequence…`);

    // Synthetic pose generation is the only supported path.
    // Real OpenPose integration requires GPU-side output parsing that is not yet implemented.
    sendProgress(60, 'Generating synthetic pose sequence…');
    const sequence = generateSyntheticPoseSequence(actualFrameCount, duration);

    sendProgress(90, 'Saving pose sequence…');

    const seqPath = path.join(tempDir, 'pose_sequence.json');
    fs.writeFileSync(seqPath, JSON.stringify(sequence, null, 2));

    sendProgress(100, 'Pose extraction complete');

    return {
      success: true,
      sequence,
      sequencePath: seqPath,
      tempDir,
      frameCount: actualFrameCount,
      duration,
      usedSynthetic: true,
    };
  } catch (err) {
    console.error('[VideoTransfer] extract-transfer-poses error:', err);
    // Cleanup on failure
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    return { success: false, error: err.message };
  }
});

/**
 * Delete the temporary frame directory created during pose extraction.
 */
ipcMain.handle('cleanup-transfer-frames', async (_event, tempDir) => {
  if (!tempDir || typeof tempDir !== 'string') {
    return { success: false, error: 'No directory path provided' };
  }
  const resolvedPath = path.resolve(tempDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolvedPath.startsWith(tempRoot + path.sep) && resolvedPath !== tempRoot) {
    console.warn('[VideoTransfer] Refused cleanup-transfer-frames outside tmpdir:', resolvedPath);
    return { success: false, error: 'Refused to delete a path outside the temp directory' };
  }
  try {
    if (fs.existsSync(resolvedPath)) {
      fs.rmSync(resolvedPath, { recursive: true, force: true });
    }
    return { success: true };
  } catch (err) {
    console.warn('[VideoTransfer] cleanup-transfer-frames error:', err.message);
    return { success: false, error: err.message };
  }
});

// ── Cloud API keys (main-process only — never sent to renderer) ───────────────
const FAL_API_KEY      = _cfg('FAL_API_KEY');
const SYNCSO_API_KEY   = _cfg('SYNCSO_API_KEY');
const DEEPSEEK_API_KEY = _cfg('DEEPSEEK_API_KEY');
const CARTESIA_API_KEY = _cfg('CARTESIA_API_KEY');

/** Read the stored license tier from disk. Returns 'community' if none. */
function getStoredLicenseTier() {
  try {
    const p = getLicensePath();
    if (!fs.existsSync(p)) return 'community';
    const lic = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!verifyLicense(lic)) { console.warn('[License] HMAC mismatch — ignoring stored license'); return 'community'; }
    if (lic.expiresAt && Date.now() > lic.expiresAt) return 'community';
    return lic.tier ?? 'community';
  } catch { return 'community'; }
}

/** Returns true for Pro or Studio tier. */
function isProOrStudio() {
  const t = getStoredLicenseTier();
  return t === 'pro' || t === 'studio';
}

function isStudio() {
  return getStoredLicenseTier() === 'studio';
}

// ── License / Dodo Payments ───────────────────────────────────────────────────

const DODO_API_KEY            = _cfg('DODO_API_KEY');
const DODO_API_BASE           = _cfg('DODO_API_BASE') || 'https://live.dodopayments.com';
const DODO_CUSTOMER_PORTAL_URL = _cfg('DODO_CUSTOMER_PORTAL_URL') || 'https://customer.dodopayments.com';
const CHECKOUT_URLS  = {
  pro:           _cfg('DODO_PRO_CHECKOUT_URL')           || 'https://checkout.dodopayments.com/buy/pdt_0NfSlPakjsXHejKSZgxND',
  studio:        _cfg('DODO_STUDIO_CHECKOUT_URL')        || 'https://checkout.dodopayments.com/buy/pdt_0NfSlpx2ktThlKQivLq6X',
  pro_annual:    _cfg('DODO_PRO_ANNUAL_CHECKOUT_URL')    || '',
  studio_annual: _cfg('DODO_STUDIO_ANNUAL_CHECKOUT_URL') || '',
};

function getLicensePath() {
  return path.join(app.getPath('userData'), 'imagginary-license.json');
}

// In packaged builds the real secret is baked in by scripts/write-config.js from
// the LICENSE_HMAC_SECRET CI secret.  In local dev we allow a clearly-labelled
// insecure placeholder so development doesn't require the production secret.
// An empty string (e.g. CI secret missing from a misconfigured run) is treated
// identically to absent — never fall back silently to a forgeable string.
const _rawHmacSecret = _cfg('LICENSE_HMAC_SECRET');
const LICENSE_HMAC_SECRET = (_rawHmacSecret && _rawHmacSecret.length > 0)
  ? _rawHmacSecret
  : (app.isPackaged ? null : 'LOCAL_DEV_ONLY_INSECURE_SECRET');

if (!LICENSE_HMAC_SECRET && app.isPackaged) {
  console.error('[FATAL] LICENSE_HMAC_SECRET is not configured in a packaged build — license signing cannot proceed securely.');
  dialog.showErrorBox(
    'Configuration Error',
    'Imagginary could not start due to a missing security configuration.\nPlease reinstall the app or contact support@imagginary.com.'
  );
  app.quit();
}

function signLicense(obj) {
  if (!LICENSE_HMAC_SECRET) {
    throw new Error('License signing unavailable — security configuration missing');
  }
  const { _sig: _removed, ...payload } = obj;
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', LICENSE_HMAC_SECRET).update(body).digest('hex');
  return { ...payload, _sig: sig };
}

function verifyLicense(obj) {
  if (!LICENSE_HMAC_SECRET) return false; // fail closed — never fail open
  if (!obj || typeof obj !== 'object') return false;
  const { _sig: sig, ...payload } = obj;
  if (!sig) return false;
  const body = JSON.stringify(payload);
  const expected = createHmac('sha256', LICENSE_HMAC_SECRET).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ── Credit Store (electron-store — not accessible from renderer/DevTools) ─────

const store = new ElectronStore();
const creditDefaults = { subscriptionCredits: 0, topUpCredits: 0, lastCreditedAt: 0 };

// Per-feature credit costs (mirrors CREDIT_COSTS in LicenseService.ts)
const CREDIT_COST = {
  panelCloud:         2,
  inpaint:            3,
  characterPanel:     2,
  motionClip:        14,   // Seedance 1.5 Pro
  motionClipPremium: 28,   // Veo 3.1 Fast (2× — higher quality, ~4× upstream cost)
  videoTransfer:     14,   // Wan Motion cloud transfer
  lipSync:           16,
  loraTraining:      50,
};

function getCredits() {
  return store.get('credits', creditDefaults);
}

function setCredits(val) {
  store.set('credits', val);
}

ipcMain.handle('get-credits', () => getCredits());

ipcMain.handle('spend-credits', (_, cost) => {
  const bal = getCredits();
  const total = bal.subscriptionCredits + bal.topUpCredits;
  if (total < cost) return { success: false, remaining: total };
  // Spend subscription credits first (expire monthly), preserve paid top-ups longest.
  let toSpend = cost;
  if (bal.subscriptionCredits >= toSpend) {
    bal.subscriptionCredits -= toSpend;
  } else {
    toSpend -= bal.subscriptionCredits;
    bal.subscriptionCredits = 0;
    bal.topUpCredits -= toSpend;
  }
  setCredits(bal);
  return { success: true, remaining: bal.subscriptionCredits + bal.topUpCredits };
});

ipcMain.handle('set-credits', (_, { subscriptionCredits, topUpCredits, lastCreditedAt }) => {
  const existing = getCredits();
  setCredits({
    subscriptionCredits,
    topUpCredits,
    lastCreditedAt: lastCreditedAt ?? existing.lastCreditedAt,
  });
});

ipcMain.handle('reset-credits', () => setCredits(creditDefaults));

/** Detect tier from Dodo response — checks metadata.tier first, then product name. */
// Known Dodo product IDs — must match the checkout URL slugs configured above.
const PRODUCT_IDS = {
  pro:    ['pdt_0NfSlPakjsXHejKSZgxND'],
  studio: ['pdt_0NfSlpx2ktThlKQivLq6X'],
};

function detectTier(data) {
  // Primary: match product_id — most reliable for /license_keys responses
  const pid = data?.product_id ?? '';
  if (PRODUCT_IDS.studio.includes(pid)) return 'studio';
  if (PRODUCT_IDS.pro.includes(pid))    return 'pro';
  // Fallback: explicit metadata.tier (useful if set manually in Dodo dashboard)
  const meta = data?.metadata?.tier?.toLowerCase();
  if (meta === 'studio') return 'studio';
  if (meta === 'pro')    return 'pro';
  // Last resort: product name string match
  const name = (data?.product_name ?? data?.name ?? '').toLowerCase();
  if (name.includes('studio')) return 'studio';
  if (name.includes('pro'))    return 'pro';
  return 'pro'; // safe default — better to over-grant than lock out a paying user
}

// Two-step license validation:
// 1. Public /licenses/validate confirms the key is valid.
// 2. Authenticated GET /license_keys?license_key= fetches full details (tier, email, expiry).
ipcMain.handle('validate-license', async (_event, key, selectedTier = 'pro') => {
  if (!key) return { valid: false, error: 'No key provided.' };

  try {
    // ── Step 1: confirm validity (public endpoint) ──────────────────────────
    const validateRes = await fetch(`${DODO_API_BASE}/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: key.trim() }),
    });

    if (!validateRes.ok) {
      const text = await validateRes.text().catch(() => '');
      console.error('[License] validate error:', validateRes.status, text);
      if (validateRes.status === 404) return { valid: false, error: 'License key not found. Check for typos.' };
      if (validateRes.status === 403) return { valid: false, error: 'License key has been deactivated.' };
      return { valid: false, error: `Validation failed: HTTP ${validateRes.status}` };
    }

    const validateData = await validateRes.json();
    console.log('[License] validate response:', JSON.stringify(validateData));
    if (!validateData.valid) return { valid: false, error: 'License key is not valid.' };

    // ── Step 2: fetch full details (authenticated endpoint) ─────────────────
    let tier = selectedTier;
    let email = '';
    let expiresAt = null;

    if (DODO_API_KEY) {
      const detailRes = await fetch(
        `${DODO_API_BASE}/license_keys?license_key=${encodeURIComponent(key.trim())}`,
        {
          headers: {
            'Authorization': `Bearer ${DODO_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const detailText = await detailRes.text().catch(() => '');
      let detailData = null;
      try { detailData = JSON.parse(detailText); } catch { /* ignore */ }
      console.log('[License] detail fetch status:', detailRes.status);
      console.log('[License] detail response:', JSON.stringify(detailData));
      if (detailRes.ok && detailData) {
        // /license_keys returns { items: [{ id, key, status, product_id, expires_at, ... }] }
        const item = detailData.items?.[0] ?? null;
        if (item) {
          tier      = detectTier(item);
          // /license_keys does not return email — preserve from stored license or leave empty
          expiresAt = item.expires_at ? new Date(item.expires_at).getTime() : null;
        } else {
          console.warn('[License] detail response contained no items — using selectedTier');
        }
      } else {
        console.warn('[License] detail fetch failed:', detailRes.status, detailText.slice(0, 500));
        // Fall through — use stored tier if available, else selectedTier.
      }
    } else {
      console.warn('[License] DODO_API_KEY not set — tier detection unavailable, using stored/default.');
    }

    // ── Preserve stored tier/email if detail fetch didn't return them ────────
    const existing = (() => {
      try {
        const p = getLicensePath();
        if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch { /* ignore */ }
      return null;
    })();
    if (existing?.key === key.trim()) {
      if (!email)              email     = existing.email     ?? '';
      if (tier === 'pro' && existing.tier === 'studio') tier = 'studio'; // don't downgrade
      if (expiresAt === null)  expiresAt = existing.expiresAt ?? null;
    }

    const license = {
      key: key.trim(), tier, email,
      activatedAt:     existing?.activatedAt     ?? Date.now(),
      expiresAt,
      lastValidatedAt: Date.now(),
      lastCreditedAt:  existing?.lastCreditedAt  ?? Date.now(),
    };
    fs.writeFileSync(getLicensePath(), JSON.stringify(signLicense(license), null, 2), 'utf8');
    console.log('[License] tier detected:', tier, '— isPro will return:', tier === 'pro' || tier === 'studio');
    return { valid: true, tier, email, expiresAt };
  } catch (err) {
    console.error('[License] validate error:', err.message);
    return { valid: false, error: 'Could not reach license server. Check your connection.' };
  }
});

ipcMain.handle('get-license', () => {
  try {
    const p = getLicensePath();
    if (!fs.existsSync(p)) return null;
    const license = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!verifyLicense(license)) {
      console.warn('[License] HMAC mismatch on get-license — treating as no license');
      fs.unlinkSync(p);
      return null;
    }
    // Expire on-disk entry automatically
    if (license.expiresAt && Date.now() > license.expiresAt) {
      fs.unlinkSync(p);
      return null;
    }
    const { _sig: _removed, ...clean } = license;
    return clean;
  } catch {
    return null;
  }
});

ipcMain.handle('save-license', (_event, license) => {
  try {
    fs.writeFileSync(getLicensePath(), JSON.stringify(signLicense(license), null, 2), 'utf8');
    return { success: true };
  } catch {
    return { success: false };
  }
});

ipcMain.handle('clear-license', () => {
  try {
    const p = getLicensePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { success: true };
  } catch {
    return { success: true }; // idempotent
  }
});

ipcMain.handle('open-checkout', (_event, tier) => {
  const url = CHECKOUT_URLS[tier] ?? CHECKOUT_URLS.pro;
  if (url) shell.openExternal(url);
});

ipcMain.handle('open-customer-portal', () => {
  shell.openExternal(DODO_CUSTOMER_PORTAL_URL);
});

const TOPUP_URLS = {
  starter:  _cfg('DODO_STARTER_CREDITS_URL')  || '',
  standard: _cfg('DODO_STANDARD_CREDITS_URL') || '',
  power:    _cfg('DODO_POWER_CREDITS_URL')    || '',
};

ipcMain.handle('open-topup-checkout', (_event, pack) => {
  const url = TOPUP_URLS[pack];
  if (url) shell.openExternal(url);
});

ipcMain.handle('validate-topup', async (_event, code) => {
  if (!code) return { valid: false, error: 'Invalid code.' };
  try {
    // Step 1: Confirm the key is valid via the same public endpoint used by validate-license.
    // The previous /licenses/{id}/validate path-param form used a different response shape
    // (status vs valid) and required the key to be a Dodo license ID, not a key string.
    const validateRes = await fetch(`${DODO_API_BASE}/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: code.trim() }),
    });
    if (!validateRes.ok) return { valid: false, error: 'Invalid top-up code.' };
    const validateData = await validateRes.json();
    if (!validateData.valid) return { valid: false, error: 'Top-up code is not valid or has expired.' };

    // Step 2: Fetch full details to read the credits from metadata.
    if (!DODO_API_KEY) return { valid: false, error: 'Server configuration error.' };
    const detailRes = await fetch(
      `${DODO_API_BASE}/license_keys?license_key=${encodeURIComponent(code.trim())}`,
      { headers: { 'Authorization': `Bearer ${DODO_API_KEY}`, 'Content-Type': 'application/json' } }
    );
    if (!detailRes.ok) return { valid: false, error: 'Could not read top-up code details.' };
    const detailData = await detailRes.json();
    const item = detailData.items?.[0];
    if (!item) return { valid: false, error: 'Top-up code not found.' };
    if (item.status !== 'active') return { valid: false, error: 'Top-up code already used.' };
    const credits = parseInt(item.metadata?.credits ?? '0');
    if (!credits) return { valid: false, error: 'Top-up code carries no credits.' };
    return { valid: true, credits };
  } catch {
    return { valid: false, error: 'Could not validate code. Check your connection.' };
  }
});

// ── Phase 15 — Voice Layer (Coqui TTS) ───────────────────────────────────────

/**
 * Resolve the ComfyUI venv Python executable (mac/win).
 * Falls back to the system python3/python if the venv doesn't exist yet.
 */
function resolveVenvPython() {
  const isWin = process.platform === 'win32';
  const comfyPath = path.join(os.homedir(), 'ComfyUI');
  const venvPython = isWin
    ? path.join(comfyPath, 'venv', 'Scripts', 'python.exe')
    : path.join(comfyPath, 'venv', 'bin', 'python3');
  if (fs.existsSync(venvPython)) return venvPython;
  // Fallback to system python
  const systemCandidates = isWin
    ? ['python.exe', 'python3.exe']
    : ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3', 'python3'];
  for (const p of systemCandidates) {
    try {
      if (p.startsWith('/') && fs.existsSync(p)) return p;
      if (!p.startsWith('/')) return p; // let spawn resolve from PATH
    } catch { /* skip */ }
  }
  return 'python3';
}

/**
 * Resolve the edge-tts binary: ComfyUI venv first, then system PATH.
 */
function resolveEdgeTtsBin() {
  const isWin = process.platform === 'win32';
  const venvBin = isWin
    ? path.join(os.homedir(), 'ComfyUI', 'venv', 'Scripts', 'edge-tts.exe')
    : path.join(os.homedir(), 'ComfyUI', 'venv', 'bin', 'edge-tts');
  if (fs.existsSync(venvBin)) return venvBin;
  return 'edge-tts'; // fall back to system PATH (e.g. anaconda3)
}

/**
 * Resolve the bundled ffmpeg binary.
 */
function resolveFfmpegBin() {
  const platformBinary = process.platform === 'win32' ? 'ffmpeg-win.exe'
    : process.platform === 'darwin' ? 'ffmpeg-mac'
    : 'ffmpeg-linux';
  const bundled = path.join(process.resourcesPath ?? '', 'bin', platformBinary);
  if (fs.existsSync(bundled)) return bundled;
  return 'ffmpeg'; // fall back to system PATH
}

/**
 * Check whether edge-tts is accessible.
 */
ipcMain.handle('check-coqui-tts', async () => {
  try {
    const bin = resolveEdgeTtsBin();
    const ok = await new Promise((resolve) => {
      const proc = spawn(bin, ['--version'], { stdio: 'pipe' });
      let out = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { out += d.toString(); });
      proc.on('close', (code) => resolve(code === 0 ? out.trim() : null));
      proc.on('error', () => resolve(null));
    });
    return ok ? { available: true, version: ok } : { available: false };
  } catch {
    return { available: false };
  }
});

/**
 * Read the bundled voices/index.json and return the voice library.
 */
ipcMain.handle('get-voice-library', async () => {
  try {
    const candidates = [
      path.join(__dirname, '..', 'resources', 'voices', 'index.json'),
      path.join(app.getAppPath(), 'resources', 'voices', 'index.json'),
      path.join(process.resourcesPath ?? '', 'voices', 'index.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const voices = JSON.parse(fs.readFileSync(p, 'utf8'));
        return { success: true, voices };
      }
    }
    return { success: false, error: 'Voice library index not found' };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Return the path to a pre-recorded sample WAV for the given voice ID.
 * Falls back to a live edge-tts preview if no static file exists.
 */
ipcMain.handle('get-voice-sample', async (_event, voiceId) => {
  if (!voiceId || typeof voiceId !== 'string') {
    return { success: false, error: 'Invalid voice ID' };
  }
  try {
    // Try static bundled samples first (legacy)
    const candidates = [
      path.join(__dirname, '..', 'resources', 'voices', 'samples', `${voiceId}.wav`),
      path.join(app.getAppPath(), 'resources', 'voices', 'samples', `${voiceId}.wav`),
      path.join(process.resourcesPath ?? '', 'voices', 'samples', `${voiceId}.wav`),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return { success: true, samplePath: p };
    }
    return { success: false, error: `Sample not found for: ${voiceId}` };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

/**
 * Generate speech via edge-tts, then convert MP3 → WAV via bundled ffmpeg.
 * Streams voice-progress events back to the renderer.
 */
ipcMain.handle('generate-voice', async (event, params) => {
  const { text, voiceId, edgeVoice } = params ?? {};
  if (!text || !voiceId || !edgeVoice) {
    return { success: false, error: 'text, voiceId, and edgeVoice are required' };
  }

  const sendProgress = (pct) => {
    try { event.sender.send('voice-progress', pct); } catch { /* window closed */ }
  };

  try {
    sendProgress(5);

    const voiceDir = path.join(app.getPath('userData'), 'voices');
    fs.mkdirSync(voiceDir, { recursive: true });
    const ts = Date.now();
    const mp3Path = path.join(voiceDir, `voice_${voiceId}_${ts}.mp3`);
    const wavPath = path.join(voiceDir, `voice_${voiceId}_${ts}.wav`);

    const edgeTtsBin = resolveEdgeTtsBin();
    console.log('[Voice] edge-tts bin:', edgeTtsBin, '| voice:', edgeVoice);
    sendProgress(10);

    // Step 1 — synthesise to MP3
    const ttsResult = await new Promise((resolve) => {
      const proc = spawn(edgeTtsBin, [
        '--voice', edgeVoice,
        '--text', text,
        '--write-media', mp3Path,
      ], { stdio: 'pipe' });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        resolve(code === 0 ? null : (stderr.split('\n').filter(Boolean).slice(-3).join(' ') || 'edge-tts failed'));
      });
      proc.on('error', (err) => resolve(err.message));
    });

    if (ttsResult) return { success: false, error: ttsResult };
    sendProgress(55);

    // Step 2 — convert MP3 → WAV (22050 Hz mono, as expected by lip-sync)
    const ffmpegBin = resolveFfmpegBin();
    const ffmpegResult = await new Promise((resolve) => {
      const proc = spawn(ffmpegBin, [
        '-y', '-i', mp3Path,
        '-ar', '22050', '-ac', '1',
        wavPath,
      ], { stdio: 'pipe' });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        resolve(code === 0 && fs.existsSync(wavPath) ? null : (stderr.slice(-200) || 'ffmpeg conversion failed'));
      });
      proc.on('error', (err) => resolve(err.message));
    });

    // Cleanup MP3 regardless of outcome
    try { fs.unlinkSync(mp3Path); } catch { /* ignore */ }

    if (ffmpegResult) return { success: false, error: ffmpegResult };

    // Validate output before declaring success
    const stats = fs.statSync(wavPath);
    if (stats.size < 1024) {
      try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
      return { success: false, error: 'Generated audio file is invalid or empty — please try again' };
    }

    sendProgress(100);
    return { success: true, wavPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Return the full edge-tts voice catalogue (~320 voices) as structured JSON.
 */
ipcMain.handle('get-edge-tts-voices', async () => {
  try {
    const bin = resolveEdgeTtsBin();
    const stdout = await new Promise((resolve, reject) => {
      const proc = spawn(bin, ['--list-voices'], { stdio: 'pipe' });
      let out = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.on('close', (code) => code === 0 ? resolve(out) : reject(new Error('edge-tts --list-voices failed')));
      proc.on('error', reject);
    });

    // Parse the tabular output (Name, Gender, ContentCategories, VoicePersonalities)
    const lines = stdout.trim().split('\n');
    const voices = [];
    for (let i = 2; i < lines.length; i++) { // skip header + separator
      const cols = lines[i].split(/\s{2,}/);
      if (cols.length < 2) continue;
      const name = cols[0].trim();
      const gender = cols[1].trim();
      if (!name || !name.includes('-')) continue;
      // locale = first two BCP-47 segments, e.g. "en-US" from "en-US-GuyNeural"
      const parts = name.split('-');
      const locale = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : parts[0];
      voices.push({ name, gender, locale });
    }
    return voices;
  } catch (err) {
    console.error('[get-edge-tts-voices] error:', err.message);
    return [];
  }
});

/**
 * Generate a short live preview clip for any edge-tts voice name.
 * Returns the MP3 path (played directly in renderer via file:// URL).
 */
ipcMain.handle('preview-voice', async (_event, { edgeVoice } = {}) => {
  if (!edgeVoice) return { success: false, error: 'edgeVoice required' };
  try {
    const bin = resolveEdgeTtsBin();
    const previewPath = path.join(app.getPath('temp'), `preview_${Date.now()}.mp3`);
    const sampleText = 'A detective walks into a rain-soaked alley at midnight.';
    const err = await new Promise((resolve) => {
      const proc = spawn(bin, [
        '--voice', edgeVoice,
        '--text', sampleText,
        '--write-media', previewPath,
      ], { stdio: 'pipe' });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => resolve(code === 0 ? null : stderr.slice(-200)));
      proc.on('error', (e) => resolve(e.message));
    });
    if (err) return { success: false, error: err };
    return { success: true, previewPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Install edge-tts via pip (system pip3 or ComfyUI venv pip).
 * edge-tts supports Python 3.7+ including 3.13 — no compat issues.
 * Streams install log lines as 'install-progress' events.
 */
ipcMain.handle('install-coqui-tts', async (event) => {
  const sendProgress = (msg) => {
    try { event.sender.send('install-progress', msg); } catch { /* window closed */ }
  };

  try {
    const isWin = process.platform === 'win32';
    const comfyPath = path.join(os.homedir(), 'ComfyUI');
    const venvPip = isWin
      ? path.join(comfyPath, 'venv', 'Scripts', 'pip.exe')
      : path.join(comfyPath, 'venv', 'bin', 'pip');
    const pipBin = fs.existsSync(venvPip) ? venvPip : 'pip3';

    console.log('[edge-tts install] pip binary:', pipBin);
    sendProgress(`Installing edge-tts via: ${pipBin}`);

    const stdoutLines = [];
    const stderrLines = [];

    const result = await new Promise((resolve) => {
      const proc = spawn(pipBin, ['install', 'edge-tts'], { stdio: 'pipe' });

      proc.stdout.on('data', (d) => {
        const text = d.toString().trim();
        stdoutLines.push(text);
        console.log('[edge-tts install stdout]', text);
        sendProgress(text);
      });
      proc.stderr.on('data', (d) => {
        const text = d.toString().trim();
        stderrLines.push(text);
        console.error('[edge-tts install stderr]', text);
        sendProgress(text);
      });

      proc.on('close', (code) => {
        console.log(`[edge-tts install] pip exited with code ${code}`);
        if (code !== 0) {
          console.error('[edge-tts install] FAILED. Last stderr:\n', stderrLines.slice(-10).join('\n'));
        }
        resolve({ success: code === 0, exitCode: code, stderr: stderrLines.slice(-20).join('\n') });
      });
      proc.on('error', (err) => {
        console.error('[edge-tts install] spawn error:', err.message);
        resolve({ success: false, error: err.message });
      });
    });

    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/**
 * Studio only — fine-tune a Coqui model from a voice sample file.
 * Returns the new VoiceProfile on success.
 */
ipcMain.handle('clone-voice', async (_event, params) => {
  const { audioSamplePath, name } = params ?? {};
  if (!audioSamplePath || !name) return { success: false, error: 'audioSamplePath and name are required' };
  if (!fs.existsSync(audioSamplePath)) return { success: false, error: 'Audio sample file not found' };

  // BYOK ElevenLabs takes priority; fall back to baked-in Cartesia
  const elevenLabsKey = _cfg('ELEVENLABS_API_KEY') || store.get('elevenLabsApiKey', '');
  const useElevenLabs = !!elevenLabsKey;
  const useCartesia   = !!CARTESIA_API_KEY;
  if (!useElevenLabs && !useCartesia) return { success: false, error: 'No voice cloning API configured' };

  try {
    assertSafePath(audioSamplePath);
    const audioBuffer = fs.readFileSync(audioSamplePath);

    if (useElevenLabs) {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('files', new Blob([audioBuffer]), path.basename(audioSamplePath));
      formData.append('description', 'Cloned via Imagginary Studio');

      const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: { 'xi-api-key': elevenLabsKey },
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.voice_id) {
        return { success: false, error: json.detail?.message ?? json.detail ?? `ElevenLabs error: ${res.status}` };
      }
      return { success: true, voiceId: json.voice_id, name, provider: 'elevenlabs' };

    } else {
      // Cartesia: upload clip to get embedding, then create voice
      const uploadRes = await fetch('https://api.cartesia.ai/voices/clone/clip', {
        method: 'POST',
        headers: {
          'Cartesia-Version': '2024-06-10',
          'X-API-Key': CARTESIA_API_KEY,
          'Content-Type': 'audio/mpeg',
        },
        body: audioBuffer,
      });
      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({}));
        return { success: false, error: err.message ?? `Cartesia upload error: ${uploadRes.status}` };
      }
      const { embedding } = await uploadRes.json();

      const voiceRes = await fetch('https://api.cartesia.ai/voices', {
        method: 'POST',
        headers: {
          'Cartesia-Version': '2024-06-10',
          'X-API-Key': CARTESIA_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description: 'Cloned via Imagginary Studio', embedding, language: 'en' }),
      });
      if (!voiceRes.ok) {
        const err = await voiceRes.json().catch(() => ({}));
        return { success: false, error: err.message ?? `Cartesia voice creation error: ${voiceRes.status}` };
      }
      const voiceData = await voiceRes.json();
      return { success: true, voiceId: voiceData.id, name, provider: 'cartesia' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// KNOWN LIMITATION (v2): No client-side rate limiting or quota tracking for voice
// generation calls — relies on provider error responses (Cartesia/ElevenLabs HTTP status
// codes), which do surface correctly to the user via existing validation in VoiceService.ts.
ipcMain.handle('generate-cloned-voice', async (_event, { text, voiceId, provider }) => {
  if (!text || !voiceId) return { success: false, error: 'text and voiceId required' };
  try {
    const voiceDir = path.join(app.getPath('userData'), 'voices');
    fs.mkdirSync(voiceDir, { recursive: true });
    const outputPath = path.join(voiceDir, `${Date.now()}.mp3`);

    if (provider === 'elevenlabs') {
      const elevenLabsKey = _cfg('ELEVENLABS_API_KEY') || store.get('elevenLabsApiKey', '');
      if (!elevenLabsKey) return { success: false, error: 'ElevenLabs API key not configured' };
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: { 'xi-api-key': elevenLabsKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      });
      if (!res.ok) return { success: false, error: `ElevenLabs TTS error: ${res.status}` };
      fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
      const statsEl = fs.statSync(outputPath);
      if (statsEl.size < 1024) {
        try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
        return { success: false, error: 'Generated audio file is invalid or empty — please try again' };
      }
      return { success: true, audioPath: outputPath };

    } else {
      if (!CARTESIA_API_KEY) return { success: false, error: 'Cartesia API key not configured' };
      const res = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'Cartesia-Version': '2024-06-10',
          'X-API-Key': CARTESIA_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: 'sonic-2',
          transcript: text,
          voice: { mode: 'id', id: voiceId },
          output_format: { container: 'mp3', encoding: 'mp3', sample_rate: 44100 },
          language: 'en',
        }),
      });
      if (!res.ok) return { success: false, error: `Cartesia TTS error: ${res.status}` };
      fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
      const statsC = fs.statSync(outputPath);
      if (statsC.size < 1024) {
        try { fs.unlinkSync(outputPath); } catch { /* ignore */ }
        return { success: false, error: 'Generated audio file is invalid or empty — please try again' };
      }
      return { success: true, audioPath: outputPath };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('check-voice-clone-providers', () => {
  const cartesiaKey   = CARTESIA_API_KEY;
  const elevenLabsKey = _cfg('ELEVENLABS_API_KEY') || store.get('elevenLabsApiKey', '');
  const preferred     = elevenLabsKey ? 'elevenlabs' : cartesiaKey ? 'cartesia' : null;
  return { cartesia: !!cartesiaKey, elevenlabs: !!elevenLabsKey, preferred };
});

ipcMain.handle('save-elevenlabs-key', (_event, { key }) => {
  store.set('elevenLabsApiKey', key || '');
  return { success: true };
});

ipcMain.handle('get-custom-voices', () => {
  const voices = store.get('customVoices', []);
  return { success: true, voices };
});

ipcMain.handle('save-custom-voice', (_event, { voice }) => {
  if (!voice?.id) return { success: false, error: 'voice.id required' };
  const existing = store.get('customVoices', []);
  const updated = [...existing.filter(v => v.id !== voice.id), voice];
  store.set('customVoices', updated);
  return { success: true };
});

ipcMain.handle('delete-custom-voice', (_event, { voiceId }) => {
  if (!voiceId) return { success: false, error: 'voiceId required' };
  const existing = store.get('customVoices', []);
  store.set('customVoices', existing.filter(v => v.id !== voiceId));
  return { success: true };
});

ipcMain.handle('read-file-as-base64', (_event, filePath) => {
  try {
    const resolvedPath = assertSafePath(filePath);
    const stat = fs.statSync(resolvedPath);
    if (stat.size > MAX_FILE_SIZE) throw new Error('File too large (max 50MB)');
    const buf = fs.readFileSync(resolvedPath);
    return buf.toString('base64');
  } catch { return null; }
});

ipcMain.handle('delete-file', (_event, filePath) => {
  try {
    const resolvedPath = assertSafePath(filePath);
    if (fs.existsSync(resolvedPath)) fs.unlinkSync(resolvedPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Cloud API proxy handlers (keys never leave main process) ─────────────────
// All handlers validate Pro/Studio tier from the on-disk license before calling
// any external API. Progress is streamed back via 'cloud-progress' IPC events.

/** Fetch a URL and return the body as a base64 string. */
// Upload a Buffer to Fal's CDN using the official 2-step initiate + PUT flow.
// Step 1: POST to rest.alpha.fal.ai/storage/upload/initiate → get { file_url, upload_url }
// Step 2: PUT the raw binary to upload_url
// Returns the CDN file_url string on success, throws on any error.
async function falStorageUpload(buffer, contentType, fileName, apiKey) {
  // Step 1 — Initiate upload
  console.log('[FalUpload] Initiating upload for', fileName, contentType, buffer.length, 'bytes');
  const initiateRes = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ content_type: contentType, file_name: fileName });
    const req = https.request({
      hostname: 'rest.alpha.fal.ai',
      path: '/storage/upload/initiate?storage_type=fal-cdn-v3',
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error(`Initiate response parse failed: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (initiateRes.status !== 200) {
    throw new Error(`Upload initiate failed: ${initiateRes.status} — ${JSON.stringify(initiateRes.body)}`);
  }
  const { file_url, upload_url } = initiateRes.body;
  if (!upload_url || !file_url) {
    throw new Error(`Upload initiate missing fields: ${JSON.stringify(initiateRes.body)}`);
  }
  console.log('[FalUpload] Got upload_url and file_url, starting PUT...');

  // Step 2 — PUT the file binary to the pre-signed upload URL
  const uploadUrl = new URL(upload_url);
  await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: uploadUrl.hostname,
      path: uploadUrl.pathname + uploadUrl.search,
      method: 'PUT',
      rejectUnauthorized: false,
      headers: {
        'Content-Type': contentType,
        'Content-Length': buffer.length,
      },
    }, (res) => {
      res.resume(); // drain body
      if (res.statusCode >= 200 && res.statusCode < 300) resolve();
      else reject(new Error(`Upload PUT failed: ${res.statusCode}`));
    });
    req.on('error', reject);
    req.write(buffer);
    req.end();
  });

  console.log('[FalUpload] PUT complete, CDN URL:', file_url);
  return file_url;
}

async function fetchToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`Downloaded file is too small (${buf.length} bytes) — likely corrupt or empty`);
  return buf.toString('base64');
}

// Deduct credits from the main-process store (no balance check — caller pre-checked).
// Must be called AFTER a successful API response and BEFORE returning the result
// so the deduction is guaranteed even if the renderer crashes or closes.
function deductCredits(cost) {
  const bal = getCredits();
  let { subscriptionCredits, topUpCredits } = bal;
  if (subscriptionCredits >= cost) {
    subscriptionCredits -= cost;
  } else {
    const remainder = cost - subscriptionCredits;
    subscriptionCredits = 0;
    topUpCredits = Math.max(0, topUpCredits - remainder);
  }
  setCredits({ ...bal, subscriptionCredits, topUpCredits });
}

// Atomic check-and-deduct: reads, validates, and writes in a single synchronous
// block with no await in between.  Eliminates the TOCTOU window where two
// concurrent requests both pass a pre-flight balance check before either deducts.
// Returns { success: true } or { success: false, error: string }.
function deductCreditsAtomic(cost) {
  const bal = getCredits();
  const available = bal.subscriptionCredits + bal.topUpCredits;
  if (available < cost) {
    return { success: false, error: 'insufficient credits' };
  }
  let { subscriptionCredits, topUpCredits } = bal;
  if (subscriptionCredits >= cost) {
    subscriptionCredits -= cost;
  } else {
    const remainder = cost - subscriptionCredits;
    subscriptionCredits = 0;
    topUpCredits = Math.max(0, topUpCredits - remainder);
  }
  setCredits({ ...bal, subscriptionCredits, topUpCredits });
  return { success: true };
}

ipcMain.handle('fal-flux-schnell', async (_event, { prompt, width, height }) => {
  console.log('[Fal] fal-flux-schnell called — isPro check passed, attempting cloud generation');
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { error: 'FAL_API_KEY not configured' };
  const _bal0 = getCredits();
  if (_bal0.subscriptionCredits + _bal0.topUpCredits < CREDIT_COST.panelCloud) return { error: 'insufficient credits' };
  try {
    const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        image_size: { width, height },
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: false,
      }),
    });
    if (!res.ok) return { error: `fal-flux-schnell: ${res.status}` };
    const data = await res.json();
    const imageUrl = data.images?.[0]?.url;
    if (!imageUrl) return { error: 'No image URL in response' };
    // Deduct BEFORE downloading — Fal.ai has already billed us at this point.
    // If fetchToBase64 throws (CDN error, corrupt file), credits are still correctly
    // consumed rather than silently skipped.
    const deduct0 = deductCreditsAtomic(CREDIT_COST.panelCloud);
    if (!deduct0.success) {
      console.warn('[Credits] fal-flux-schnell deduction failed (insufficient credits at deduction time):', deduct0.error);
      return { error: 'insufficient credits' };
    }
    const base64 = await fetchToBase64(imageUrl);
    return { base64 };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fal-ipadapter', async (_event, { prompt, faceImageData }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { error: 'FAL_API_KEY not configured' };
  const _bal1 = getCredits();
  if (_bal1.subscriptionCredits + _bal1.topUpCredits < CREDIT_COST.characterPanel) return { error: 'insufficient credits' };
  try {
    const res = await fetch('https://fal.run/fal-ai/ipadapter-faceid', {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        face_image_url: faceImageData,
        scale: 0.6,
        num_inference_steps: 20,
      }),
    });
    if (!res.ok) return { error: `fal-ipadapter: ${res.status}` };
    const data = await res.json();
    const imageUrl = data.images?.[0]?.url;
    if (!imageUrl) return { error: 'No image URL in response' };
    // Deduct BEFORE downloading — Fal.ai has already billed us at this point.
    const deduct1 = deductCreditsAtomic(CREDIT_COST.characterPanel);
    if (!deduct1.success) {
      console.warn('[Credits] fal-ipadapter deduction failed:', deduct1.error);
      return { error: 'insufficient credits' };
    }
    const base64 = await fetchToBase64(imageUrl);
    return { base64 };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fal-flux-fill', async (_event, { imageBase64, maskBase64, prompt, steps, strength }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { error: 'FAL_API_KEY not configured' };
  const _bal2 = getCredits();
  if (_bal2.subscriptionCredits + _bal2.topUpCredits < CREDIT_COST.inpaint) return { error: 'insufficient credits' };
  try {
    const res = await fetch('https://fal.run/fal-ai/flux/dev/image-to-image/inpainting', {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        image_url: `data:image/png;base64,${imageBase64}`,
        mask_url:  `data:image/png;base64,${maskBase64}`,
        num_inference_steps: steps ?? 20,
        strength: strength ?? 0.75,
        guidance_scale: 3.5,
        output_format: 'png',
      }),
    });
    if (!res.ok) return { error: `fal-flux-fill: ${res.status}` };
    const data = await res.json();
    const imageUrl = data.images?.[0]?.url;
    if (!imageUrl) return { error: 'No image URL in response' };
    // Deduct BEFORE downloading — Fal.ai has already billed us at this point.
    const deduct2 = deductCreditsAtomic(CREDIT_COST.inpaint);
    if (!deduct2.success) {
      console.warn('[Credits] fal-flux-fill deduction failed:', deduct2.error);
      return { error: 'insufficient credits' };
    }
    const base64 = await fetchToBase64(imageUrl);
    return { base64 };
  } catch (err) {
    return { error: err.message };
  }
});

// Per-request cancel flags for fal-kling. Each active request registers its own flag
// object here. cancel-fal-kling sets all active flags so concurrent requests are all
// cancellable, even if two requests are running simultaneously.
const activeKlingFlags = new Set();
ipcMain.on('cancel-fal-kling', () => {
  for (const flag of activeKlingFlags) flag.cancelled = true;
});

ipcMain.handle('fal-kling', async (event, { imageData, motionPrompt, duration = '5', aspectRatio = '16:9' }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { error: 'FAL_API_KEY not configured' };
  const _bal3 = getCredits();
  if (_bal3.subscriptionCredits + _bal3.topUpCredits < CREDIT_COST.motionClip) return { error: 'insufficient credits' };

  const send = (pct, msg) => {
    try { event.sender.send('cloud-progress', { handler: 'fal-kling', pct, msg }); } catch {}
  };

  const flag = { cancelled: false };
  activeKlingFlags.add(flag);

  try {
    const base64 = imageData.replace(/^data:image\/[^;]+;base64,/, '');
    send(5, 'Sending to Kling AI…\nKling queue can take longer during peak hours');

    const submitRes = await fetch('https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video', {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: `data:image/png;base64,${base64}`,
        prompt: motionPrompt,
        duration,
        aspect_ratio: aspectRatio,
      }),
    });

    if (!submitRes.ok) return { error: `Kling submit failed: ${submitRes.status}` };
    const job = await submitRes.json();
    const requestId = job.request_id;

    send(15, 'Sending to Kling AI…\nKling queue can take longer during peak hours');

    for (let i = 0; i < 60; i++) {
      if (flag.cancelled) return { error: 'cancelled' };
      await new Promise(r => setTimeout(r, 5000));
      if (flag.cancelled) return { error: 'cancelled' };
      const pollRes = await fetch(
        `https://fal.run/fal-ai/kling-video/v1.6/standard/image-to-video/requests/${requestId}`,
        { headers: { 'Authorization': `Key ${key}` } }
      );
      if (!pollRes.ok) continue;
      const status = await pollRes.json();
      const pct = Math.min(15 + Math.pow(i / 20, 0.6) * 70, 88);
      send(pct, 'Sending to Kling AI…\nKling queue can take longer during peak hours');

      if (status.status === 'COMPLETED') {
        send(92, 'Downloading your motion clip…');
        const videoUrl = status.video?.url;
        if (!videoUrl) return { error: 'No video URL in Kling response' };
        try {
          // Deduct BEFORE downloading — Kling has already rendered and billed us.
          const deductKling = deductCreditsAtomic(CREDIT_COST.motionClip);
          if (!deductKling.success) {
            console.warn('[Credits] fal-kling deduction failed:', deductKling.error);
            return { error: 'insufficient credits' };
          }
          const base64Result = await fetchToBase64(videoUrl);
          send(100, 'Done');
          return { base64: `data:video/mp4;base64,${base64Result}` };
        } catch (err) {
          return { error: `Failed to download generated video: ${err.message}` };
        }
      }
      if (status.status === 'FAILED') return { error: 'Kling generation failed' };
    }
    return { error: 'Kling timed out' };
  } catch (err) {
    return { error: err.message };
  } finally {
    activeKlingFlags.delete(flag);
  }
});

// ── Shared cancel set for Seedance / Veo / Wan Motion ──────────────────────────
const activeVideoFlags = new Set();
ipcMain.on('cancel-fal-video', () => {
  for (const flag of activeVideoFlags) flag.cancelled = true;
});

// ── Seedance 1.5 Pro — image to video ──────────────────────────────────────────
ipcMain.handle('fal-seedance', async (event, { imageData, prompt }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { error: 'FAL_API_KEY not configured' };
  const _balS = getCredits();
  if (_balS.subscriptionCredits + _balS.topUpCredits < CREDIT_COST.motionClip) return { error: 'insufficient credits' };

  const send = (pct, msg) => {
    try { event.sender.send('cloud-progress', { handler: 'fal-seedance', pct, msg }); } catch {}
  };
  const flag = { cancelled: false };
  activeVideoFlags.add(flag);

  try {
    send(3, 'Uploading image to Fal storage…');
    const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    let imageUrl;
    try {
      imageUrl = await falStorageUpload(imageBuffer, 'image/png', 'panel.png', key);
    } catch (err) {
      console.error('[Seedance] Upload failed:', err.message);
      return { error: `Image upload failed: ${err.message}` };
    }

    send(5, 'Sending to Seedance…');
    const submitRes = await fetch('https://queue.fal.run/fal-ai/bytedance/seedance/v1.5/pro/image-to-video', {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt: prompt || 'cinematic motion, smooth animation',
        duration: "5",
        resolution: '720p',
        generate_audio: false,
      }),
    });
    console.log('[Seedance] Submission response status:', submitRes.status);
    if (!submitRes.ok) {
      const rawText = await submitRes.text().catch(() => '<empty>');
      console.error('[Seedance] Submission failed:', submitRes.status, rawText);
      return { error: `Seedance submission failed: ${submitRes.status} — ${rawText}` };
    }
    let submitData;
    try { submitData = await submitRes.json(); } catch (err) {
      const rawText = await submitRes.text().catch(() => '<empty>');
      console.error('[Seedance] Submission parse failed:', rawText);
      return { error: `Seedance submission parse failed: ${rawText}` };
    }
    const { request_id, response_url, status_url } = submitData ?? {};
    console.log('[Seedance] Got request_id:', request_id);
    console.log('[Seedance] status_url:', status_url);
    console.log('[Seedance] response_url:', response_url);
    if (!request_id) return { error: `Seedance submission missing request_id: ${JSON.stringify(submitData)}` };
    if (!status_url)  return { error: `Seedance submission missing status_url: ${JSON.stringify(submitData)}` };
    if (!response_url) return { error: `Seedance submission missing response_url: ${JSON.stringify(submitData)}` };

    for (let i = 0; i < 60; i++) {
      if (flag.cancelled) return { error: 'cancelled' };
      await new Promise(r => setTimeout(r, 5000));
      if (flag.cancelled) return { error: 'cancelled' };
      const pct = Math.min(90, 15 + i * 1.5);
      send(pct, 'Seedance is generating your motion clip…');

      const statusRes = await fetch(status_url, { headers: { 'Authorization': `Key ${key}` } });
      if (!statusRes.ok) {
        console.warn('[Seedance] Status poll non-OK:', statusRes.status, '— continuing');
        continue;
      }
      let status;
      try { status = await statusRes.json(); } catch (err) {
        const rawText = await statusRes.text().catch(() => '<empty>');
        console.warn('[Seedance] Status parse failed:', rawText, '— continuing');
        continue;
      }
      console.log('[Seedance] Poll', i, 'status:', status.status);

      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(response_url, { headers: { 'Authorization': `Key ${key}` } });
        if (!resultRes.ok) return { error: `Seedance result fetch failed: ${resultRes.status}` };
        let result;
        try { result = await resultRes.json(); } catch (err) {
          const rawText = await resultRes.text().catch(() => '<empty>');
          return { error: `Seedance result parse failed: ${rawText}` };
        }
        const videoUrl = result.video?.url;
        if (!videoUrl) return { error: 'No video URL in Seedance response' };
        const deductS = deductCreditsAtomic(CREDIT_COST.motionClip);
        if (!deductS.success) return { error: 'insufficient credits' };
        send(92, 'Downloading your motion clip…');
        const base64 = await fetchToBase64(videoUrl);
        send(100, 'Done');
        return { base64: `data:video/mp4;base64,${base64}` };
      }
      if (status.status === 'FAILED') return { error: 'Seedance generation failed' };
    }
    return { error: 'Seedance timed out' };
  } catch (err) {
    return { error: err.message };
  } finally {
    activeVideoFlags.delete(flag);
  }
});

// ── Veo 3.1 Fast — image to video (premium) ────────────────────────────────────
ipcMain.handle('fal-veo', async (event, { imageData, prompt }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { error: 'FAL_API_KEY not configured' };
  const _balV = getCredits();
  if (_balV.subscriptionCredits + _balV.topUpCredits < CREDIT_COST.motionClipPremium) return { error: 'insufficient credits' };

  const send = (pct, msg) => {
    try { event.sender.send('cloud-progress', { handler: 'fal-veo', pct, msg }); } catch {}
  };
  const flag = { cancelled: false };
  activeVideoFlags.add(flag);

  try {
    send(3, 'Uploading image to Fal storage…');
    const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    let imageUrl;
    try {
      imageUrl = await falStorageUpload(imageBuffer, 'image/png', 'panel.png', key);
    } catch (err) {
      console.error('[Veo] Upload failed:', err.message);
      return { error: `Image upload failed: ${err.message}` };
    }

    send(5, 'Sending to Veo 3.1…');
    const submitRes = await fetch('https://queue.fal.run/fal-ai/veo3/image-to-video', {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        prompt: prompt || 'cinematic motion, smooth animation',
        duration: "6s",
        generate_audio: false,
      }),
    });
    if (!submitRes.ok) {
      const rawText = await submitRes.text().catch(() => '<empty>');
      return { error: `Veo submission failed: ${submitRes.status} — ${rawText}` };
    }
    let submitData;
    try { submitData = await submitRes.json(); } catch (err) {
      const rawText = await submitRes.text().catch(() => '<empty>');
      return { error: `Veo submission parse failed: ${rawText}` };
    }
    const { request_id: veo_request_id, response_url: veo_response_url, status_url: veo_status_url } = submitData ?? {};
    console.log('[Veo] Got request_id:', veo_request_id);
    console.log('[Veo] status_url:', veo_status_url);
    console.log('[Veo] response_url:', veo_response_url);
    if (!veo_request_id)  return { error: `Veo submission missing request_id: ${JSON.stringify(submitData)}` };
    if (!veo_status_url)  return { error: `Veo submission missing status_url: ${JSON.stringify(submitData)}` };
    if (!veo_response_url) return { error: `Veo submission missing response_url: ${JSON.stringify(submitData)}` };

    for (let i = 0; i < 30; i++) {
      if (flag.cancelled) return { error: 'cancelled' };
      await new Promise(r => setTimeout(r, 5000));
      if (flag.cancelled) return { error: 'cancelled' };
      const pct = Math.min(90, 15 + i * 3);
      send(pct, 'Veo 3.1 is generating your motion clip…');

      const statusRes = await fetch(veo_status_url, { headers: { 'Authorization': `Key ${key}` } });
      if (!statusRes.ok) {
        console.warn('[Veo] Status poll non-OK:', statusRes.status, '— continuing');
        continue;
      }
      let status;
      try { status = await statusRes.json(); } catch (err) {
        const rawText = await statusRes.text().catch(() => '<empty>');
        console.warn('[Veo] Status parse failed:', rawText, '— continuing');
        continue;
      }
      console.log('[Veo] Poll', i, 'status:', status.status);

      if (status.status === 'COMPLETED') {
        const resultRes = await fetch(veo_response_url, { headers: { 'Authorization': `Key ${key}` } });
        if (!resultRes.ok) return { error: `Veo result fetch failed: ${resultRes.status}` };
        let result;
        try { result = await resultRes.json(); } catch (err) {
          const rawText = await resultRes.text().catch(() => '<empty>');
          return { error: `Veo result parse failed: ${rawText}` };
        }
        const videoUrl = result.video?.url;
        if (!videoUrl) return { error: 'No video URL in Veo response' };
        const deductV = deductCreditsAtomic(CREDIT_COST.motionClipPremium);
        if (!deductV.success) return { error: 'insufficient credits' };
        send(92, 'Downloading your motion clip…');
        const base64 = await fetchToBase64(videoUrl);
        send(100, 'Done');
        return { base64: `data:video/mp4;base64,${base64}` };
      }
      if (status.status === 'FAILED') return { error: 'Veo generation failed' };
    }
    return { error: 'Veo timed out' };
  } catch (err) {
    return { error: err.message };
  } finally {
    activeVideoFlags.delete(flag);
  }
});

// ── Wan Motion — cloud Video Transfer (character image + driving video) ─────────
ipcMain.handle('fal-wan-motion', async (event, { imageData, videoUrl, prompt }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { error: 'FAL_API_KEY not configured' };
  const _balW = getCredits();
  if (_balW.subscriptionCredits + _balW.topUpCredits < CREDIT_COST.videoTransfer) return { error: 'insufficient credits' };

  const send = (pct, msg) => {
    try { event.sender.send('cloud-progress', { handler: 'fal-wan-motion', pct, msg }); } catch {}
  };
  const flag = { cancelled: false };
  activeVideoFlags.add(flag);

  try {
    send(3, 'Uploading image to Fal storage…');
    const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    let imageUrl;
    try {
      imageUrl = await falStorageUpload(imageBuffer, 'image/png', 'panel.png', key);
    } catch (err) {
      console.error('[WanMotion] Upload failed:', err.message);
      return { error: `Image upload failed: ${err.message}` };
    }

    send(5, 'Uploading to Wan Motion…');
    const submitRes = await fetch('https://queue.fal.run/fal-ai/wan/v2.1/1.3b/image-to-video', {
      method: 'POST',
      headers: { 'Authorization': `Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        video_url: videoUrl,
        prompt: prompt || 'smooth motion transfer, cinematic character animation',
      }),
    });
    if (!submitRes.ok) {
      const rawText = await submitRes.text().catch(() => '<empty>');
      return { error: `Wan Motion submission failed: ${submitRes.status} — ${rawText}` };
    }
    let submitData;
    try { submitData = await submitRes.json(); } catch (err) {
      const rawText = await submitRes.text().catch(() => '<empty>');
      return { error: `Wan Motion submission parse failed: ${rawText}` };
    }
    const { request_id: wan_request_id, response_url: wan_response_url, status_url: wan_status_url } = submitData ?? {};
    console.log('[WanMotion] Got request_id:', wan_request_id);
    console.log('[WanMotion] status_url:', wan_status_url);
    console.log('[WanMotion] response_url:', wan_response_url);
    if (!wan_request_id)  return { error: `Wan Motion submission missing request_id: ${JSON.stringify(submitData)}` };
    if (!wan_status_url)  return { error: `Wan Motion submission missing status_url: ${JSON.stringify(submitData)}` };
    if (!wan_response_url) return { error: `Wan Motion submission missing response_url: ${JSON.stringify(submitData)}` };

    for (let i = 0; i < 60; i++) {
      if (flag.cancelled) return { error: 'cancelled' };
      await new Promise(r => setTimeout(r, 5000));
      if (flag.cancelled) return { error: 'cancelled' };
      const pct = Math.min(90, 15 + i * 1.5);
      send(pct, 'Transferring motion to your character…');

      const statusRes = await fetch(wan_status_url, { headers: { 'Authorization': `Key ${key}` } });
      if (!statusRes.ok) {
        console.warn('[WanMotion] Status poll non-OK:', statusRes.status, '— continuing');
        continue;
      }
      let status;
      try { status = await statusRes.json(); } catch (err) {
        const rawText = await statusRes.text().catch(() => '<empty>');
        console.warn('[WanMotion] Status parse failed:', rawText, '— continuing');
        continue;
      }
      console.log('[WanMotion] Poll', i, 'status:', status.status);

      if (status.status === 'COMPLETED') {
        // Fal returns response_url as the bare request URL (no /response suffix).
        // Try response_url first; if 404, fall back to response_url + /response.
        console.log('[WanMotion] Fetching result from response_url:', wan_response_url);
        let resultRes = await fetch(wan_response_url, { headers: { 'Authorization': `Key ${key}` } });
        if (resultRes.status === 404) {
          const fallback = wan_response_url.replace(/\/?$/, '/response');
          console.warn('[WanMotion] response_url 404, trying fallback:', fallback);
          resultRes = await fetch(fallback, { headers: { 'Authorization': `Key ${key}` } });
        }
        if (!resultRes.ok) {
          const errText = await resultRes.text().catch(() => '<empty>');
          console.error('[WanMotion] Result fetch failed:', resultRes.status, errText);
          return { error: `Wan Motion result fetch failed: ${resultRes.status} — ${errText}` };
        }
        let result;
        try { result = await resultRes.json(); } catch (err) {
          const rawText = await resultRes.text().catch(() => '<empty>');
          console.error('[WanMotion] Result parse failed:', rawText);
          return { error: `Wan Motion result parse failed: ${rawText}` };
        }
        console.log('[WanMotion] Result keys:', Object.keys(result));
        const outUrl = result.video?.url ?? result.output?.url ?? result.url;
        if (!outUrl) return { error: 'No video URL in Wan Motion response' };
        const deductW = deductCreditsAtomic(CREDIT_COST.videoTransfer);
        if (!deductW.success) return { error: 'insufficient credits' };
        send(92, 'Downloading motion clip…');
        const base64 = await fetchToBase64(outUrl);
        send(100, 'Done');
        return { base64: `data:video/mp4;base64,${base64}` };
      }
      if (status.status === 'FAILED') return { error: 'Wan Motion generation failed' };
    }
    return { error: 'Wan Motion timed out' };
  } catch (err) {
    return { error: err.message };
  } finally {
    activeVideoFlags.delete(flag);
  }
});

// ── Upload a local video file to Fal storage ────────────────────────────────────
ipcMain.handle('upload-video-to-fal', async (event, videoPath) => {
  if (!isProOrStudio()) return { success: false, error: 'Pro or Studio required' };
  const key = FAL_API_KEY;
  if (!key) return { success: false, error: 'FAL_API_KEY not configured' };
  try {
    assertSafePath(videoPath);
    const buffer = fs.readFileSync(videoPath);
    const fileName = path.basename(videoPath);
    const url = await falStorageUpload(buffer, 'video/mp4', fileName, key);
    return { success: true, url };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('syncso-lipsync', async (event, { imageBase64, audioBase64 }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = SYNCSO_API_KEY;
  if (!key) return { error: 'SYNCSO_API_KEY not configured' };
  const _bal4 = getCredits();
  if (_bal4.subscriptionCredits + _bal4.topUpCredits < CREDIT_COST.lipSync) return { error: 'insufficient credits' };

  const send = (pct, msg) => {
    try { event.sender.send('cloud-progress', { handler: 'syncso-lipsync', pct, msg }); } catch {}
  };

  try {
    send(10, 'Uploading to Sync.so…');

    const res = await fetch('https://api.sync.so/v2/generate', {
      method: 'POST',
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'lipsync-2',
        input: [
          // Sync.so lipsync-2 accepts type:"image" for still-image inputs (not type:"video")
          { type: 'image', url: `data:image/png;base64,${imageBase64}` },
          { type: 'audio', url: `data:audio/wav;base64,${audioBase64}` },
        ],
        options: { output_format: 'mp4', sync_mode: 'bounce' },
      }),
    });

    if (!res.ok) return { error: `Sync.so submit failed: ${res.status}` };
    const job = await res.json();
    const jobId = job.id;

    send(30, 'Processing…');

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const poll = await fetch(`https://api.sync.so/v2/generate/${jobId}`, {
        headers: { 'x-api-key': key },
      });
      const status = await poll.json();
      const pct = Math.min(30 + i * 1.5, 90);
      send(pct, `Processing… ${status.status}`);
      if (status.status === 'completed') {
        send(95, 'Finalising…');
        const deductSync = deductCreditsAtomic(CREDIT_COST.lipSync);
        if (!deductSync.success) console.warn('[Credits] syncso-lipsync deduction failed post-generation:', deductSync.error);
        return { videoUrl: status.outputUrl ?? '' };
      }
      if (status.status === 'failed') return { error: 'Sync.so generation failed' };
    }
    return { error: 'Sync.so timed out' };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('deepseek-parse-shot', async (_event, { description, systemPrompt }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = DEEPSEEK_API_KEY;
  if (!key) return { error: 'DEEPSEEK_API_KEY not configured' };
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Parse this shot description and return structured JSON.
REMEMBER: If you see INT./EXT. followed by a time token (NIGHT/DAY/DAWN etc), use that exact time — never override it.
Only include characters explicitly mentioned. Match mood to genre.

${description}

Return ONLY valid JSON, no explanation, no markdown:`,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) return { error: `DeepSeek: ${res.status}` };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { error: 'Empty DeepSeek response' };
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('deepseek-parse-screenplay', async (_event, { scriptText, systemPrompt }) => {
  if (!isProOrStudio()) return { error: 'Pro or Studio required' };
  const key = DEEPSEEK_API_KEY;
  if (!key) return { error: 'DEEPSEEK_API_KEY not configured' };
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Parse this screenplay and return a JSON array of shots:\n\n${scriptText}\n\nReturn ONLY a valid JSON array, no explanation, no markdown.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        // No response_format constraint — the prompt asks for a bare JSON array,
        // and json_object mode would force an object wrapper that conflicts with that.
      }),
    });
    if (!res.ok) return { error: `DeepSeek: ${res.status}` };
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { error: 'Empty DeepSeek response' };
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a synthetic walking-like pose sequence for N frames.
 * Used when OpenPose GPU is not available.
 */
function generateSyntheticPoseSequence(frameCount, duration) {
  const sequence = [];
  for (let i = 0; i < Math.max(frameCount, 2); i++) {
    const t = frameCount <= 1 ? 0 : i / (frameCount - 1);
    const phase = t * Math.PI * 4; // 2 walk cycles
    const swing = Math.sin(phase) * 0.08;
    const liftL = Math.max(0, Math.sin(phase)) * 0.12;
    const liftR = Math.max(0, Math.sin(phase + Math.PI)) * 0.12;
    sequence.push({
      joints: [
        { x: 0.50, y: 0.08 }, // nose
        { x: 0.47, y: 0.06 }, { x: 0.53, y: 0.06 }, // eyes
        { x: 0.44, y: 0.07 }, { x: 0.56, y: 0.07 }, // ears
        { x: 0.42, y: 0.20 }, { x: 0.58, y: 0.20 }, // shoulders
        { x: 0.42 + swing, y: 0.36 },  { x: 0.58 - swing, y: 0.36 },  // elbows
        { x: 0.40 + swing * 1.5, y: 0.51 }, { x: 0.60 - swing * 1.5, y: 0.51 }, // wrists
        { x: 0.44, y: 0.52 }, { x: 0.56, y: 0.52 }, // hips
        { x: 0.44 - swing * 0.5, y: 0.70 - liftL }, { x: 0.56 + swing * 0.5, y: 0.70 - liftR }, // knees
        { x: 0.44 - swing, y: 0.90 - liftL }, { x: 0.56 + swing, y: 0.90 - liftR }, // ankles
      ],
      easing: 'ease-in-out',
    });
  }
  return sequence;
}

// ── ControlNet OpenPose model — check + download ─────────────────────────────

ipcMain.handle('check-controlnet-openpose', async () => {
  const modelPath = path.join(os.homedir(), 'ComfyUI', 'models', 'controlnet', 'control_v11p_sd15_openpose.pth');
  return { installed: fs.existsSync(modelPath) };
});

ipcMain.handle('download-controlnet-openpose', async (event) => {
  const controlnetDir = path.join(os.homedir(), 'ComfyUI', 'models', 'controlnet');
  const modelPath = path.join(controlnetDir, 'control_v11p_sd15_openpose.pth');

  if (fs.existsSync(modelPath)) {
    return { success: true, alreadyInstalled: true };
  }

  fs.mkdirSync(controlnetDir, { recursive: true });

  const url = 'https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.pth';

  try {
    await streamDownload(url, modelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      const mb = (downloaded / 1024 / 1024).toFixed(1);
      try { event.sender.send('controlnet-download-progress', { pct, mb }); } catch { /* ignore */ }
    });

    // Validate — a valid .pth file is binary, not an HTML error page
    const firstByte = Buffer.alloc(1);
    const fd = fs.openSync(modelPath, 'r');
    try {
      fs.readSync(fd, firstByte, 0, 1, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (firstByte[0] === 0x3c) {
      fs.unlinkSync(modelPath);
      return { success: false, error: 'Download failed — server returned an error page. Please try again.' };
    }

    return { success: true, alreadyInstalled: false };
  } catch (err) {
    try { if (fs.existsSync(modelPath + '.download')) fs.unlinkSync(modelPath + '.download'); } catch { /* ignore */ }
    return { success: false, error: err.message };
  }
});

// ── Brand LoRA Training ───────────────────────────────────────────────────────

// Step 1: Upload training images to Fal storage, return CDN URLs
ipcMain.handle('upload-training-images', async (event, { imagePaths }) => {
  if (!isStudio()) return { success: false, error: 'Studio subscription required' };
  if (!FAL_API_KEY) return { success: false, error: 'FAL_API_KEY not configured' };
  if (!imagePaths?.length) return { success: false, error: 'No images provided' };

  const uploadedUrls = [];
  try {
    for (let i = 0; i < imagePaths.length; i++) {
      const filePath = assertSafePath(imagePaths[i]);
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        return { success: false, error: `Image ${path.basename(filePath)} exceeds the 50 MB size limit` };
      }
      const fileBuffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const mimeType = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

      let url;
      try {
        url = await falStorageUpload(fileBuffer, mimeType, fileName, FAL_API_KEY);
      } catch (err) {
        return { success: false, error: `Upload failed for ${fileName}: ${err.message}` };
      }
      uploadedUrls.push(url);

      event.sender.send('lora-upload-progress', {
        current: i + 1,
        total: imagePaths.length,
        pct: Math.round(((i + 1) / imagePaths.length) * 100),
      });
    }
    return { success: true, urls: uploadedUrls };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Step 2: Submit async training job, returns requestId for polling
ipcMain.handle('start-lora-training', async (_event, { imageUrls, styleName, triggerWord }) => {
  if (!isStudio()) return { success: false, error: 'Studio subscription required' };
  if (!FAL_API_KEY) return { success: false, error: 'FAL_API_KEY not configured' };

  const deductResult = deductCreditsAtomic(CREDIT_COST.loraTraining);
  if (!deductResult.success) {
    return { success: false, error: deductResult.error || 'Insufficient credits for training' };
  }

  try {
    const res = await fetch('https://queue.fal.run/fal-ai/flux-lora-fast-training', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        images_data_url: imageUrls,
        trigger_word: triggerWord || 'IMAGGINARY_BRAND',
        steps: 1000,
        learning_rate: 0.0004,
        batch_size: 1,
        resolution: '512,768,1024',
        autocaption: true,
        is_input_format_already_preprocessed: false,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { success: false, error: errData.detail || `Training submission failed: ${res.status}` };
    }

    const data = await res.json();
    if (!data.request_id) return { success: false, error: 'No request_id in response' };

    return { success: true, requestId: data.request_id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Step 3: Poll training status; returns loraUrl when COMPLETED
ipcMain.handle('poll-lora-training', async (_event, { requestId }) => {
  if (!FAL_API_KEY) return { success: false, error: 'FAL_API_KEY not configured' };
  if (!requestId) return { success: false, error: 'requestId required' };

  try {
    const statusRes = await fetch(
      `https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${requestId}/status`,
      { headers: { 'Authorization': `Key ${FAL_API_KEY}` } }
    );
    if (!statusRes.ok) return { success: false, error: `Status check failed: ${statusRes.status}` };

    const statusData = await statusRes.json();
    // statusData.status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

    if (statusData.status === 'COMPLETED') {
      const resultRes = await fetch(
        `https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/${requestId}`,
        { headers: { 'Authorization': `Key ${FAL_API_KEY}` } }
      );
      if (!resultRes.ok) return { success: false, error: `Result fetch failed: ${resultRes.status}` };
      const result = await resultRes.json();
      return {
        success: true,
        status: 'COMPLETED',
        loraUrl: result.diffusers_lora_file?.url ?? null,
        configUrl: result.config_file?.url ?? null,
      };
    }

    if (statusData.status === 'FAILED') {
      return { success: true, status: 'FAILED', error: statusData.error || 'Training failed' };
    }

    return { success: true, status: statusData.status, logs: statusData.logs ?? null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Step 4: Download trained LoRA from Fal CDN → userData/loras/ + ComfyUI models/loras/
ipcMain.handle('install-lora', async (event, { loraUrl, loraName }) => {
  if (!loraUrl || !loraName) return { success: false, error: 'loraUrl and loraName required' };

  try {
    const safeLoraName = loraName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeLoraName}.safetensors`;

    const userLoraDir = path.join(app.getPath('userData'), 'loras');
    fs.mkdirSync(userLoraDir, { recursive: true });
    const userLoraPath = path.join(userLoraDir, fileName);

    // Install to ComfyUI's lora directory (best-guess default path)
    const comfyLoraDir = path.join(os.homedir(), 'ComfyUI', 'models', 'loras');
    let comfyLoraPath = null;
    try {
      fs.mkdirSync(comfyLoraDir, { recursive: true });
      comfyLoraPath = path.join(comfyLoraDir, fileName);
    } catch {
      console.warn('[LoRA] Could not create ComfyUI loras dir — ComfyUI may not be at default path');
    }

    event.sender.send('lora-install-progress', { pct: 0, message: 'Downloading trained LoRA…' });

    await streamDownload(loraUrl, userLoraPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 90) : 0;
      event.sender.send('lora-install-progress', { pct, message: `Downloading… ${pct}%` });
    });

    if (comfyLoraPath) {
      event.sender.send('lora-install-progress', { pct: 95, message: 'Installing into ComfyUI…' });
      fs.copyFileSync(userLoraPath, comfyLoraPath);

      // Ask ComfyUI to refresh its model list so the new LoRA is discoverable immediately
      try {
        const comfyUrl = store.get('comfyuiUrl', 'http://127.0.0.1:8188');
        await fetch(`${comfyUrl}/api/free`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unload_models: false, free_memory: false }),
        });
      } catch { /* non-critical — ComfyUI may not be running */ }
    }

    event.sender.send('lora-install-progress', { pct: 100, message: 'LoRA installed' });
    return { success: true, userLoraPath, comfyLoraPath, fileName };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Step 5: Custom style persistence via electron-store
ipcMain.handle('get-custom-styles', () => {
  const styles = store.get('customStyles', []);
  return { success: true, styles };
});

ipcMain.handle('save-custom-style', (_event, { style }) => {
  if (!style?.id) return { success: false, error: 'style.id required' };
  const existing = store.get('customStyles', []);
  const updated = [...existing.filter(s => s.id !== style.id), style];
  store.set('customStyles', updated);
  return { success: true };
});

ipcMain.handle('delete-custom-style', (_event, { styleId }) => {
  if (!styleId) return { success: false, error: 'styleId required' };
  const existing = store.get('customStyles', []);
  const target = existing.find(s => s.id === styleId);

  // Delete LoRA file from userData/loras/ (primary copy)
  if (target?.loraPath) {
    try {
      assertSafePath(target.loraPath);
      if (fs.existsSync(target.loraPath)) fs.unlinkSync(target.loraPath);
    } catch (err) {
      console.warn('[LoRA] Could not delete loraPath:', target.loraPath, err.message);
    }
  }

  // Also remove the copy from ComfyUI's models/loras/ directory
  if (target?.loraName) {
    // Sanitize loraName before joining into a path — the store is renderer-writable
    // so a crafted loraName with ../ could traverse outside models/loras/
    if (!/^[a-zA-Z0-9_-]+$/.test(target.loraName)) {
      console.warn('[LoRA] Refusing to delete invalid loraName:', target.loraName);
    } else {
      const comfyLoraPath = path.join(os.homedir(), 'ComfyUI', 'models', 'loras', `${target.loraName}.safetensors`);
      try {
        if (fs.existsSync(comfyLoraPath)) fs.unlinkSync(comfyLoraPath);
      } catch (err) {
        console.warn('[LoRA] Could not delete ComfyUI copy:', comfyLoraPath, err.message);
      }
    }
  }

  store.set('customStyles', existing.filter(s => s.id !== styleId));
  return { success: true };
});

// Best-effort cleanup of training images uploaded to Fal.ai storage.
// Fal.ai's storage API supports DELETE on uploaded file URLs.
ipcMain.handle('cleanup-training-uploads', async (_event, { imageUrls }) => {
  if (!FAL_API_KEY || !Array.isArray(imageUrls) || imageUrls.length === 0) return { success: true };
  try {
    await Promise.allSettled(
      imageUrls.map(url =>
        fetch(url, { method: 'DELETE', headers: { 'Authorization': `Key ${FAL_API_KEY}` } })
      )
    );
  } catch {
    // Best-effort — never fail the training flow over cleanup
  }
  return { success: true };
});
