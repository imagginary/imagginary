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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
async function ensureOllamaModel(loadingWin, preferredModel = 'qwen2.5:1.5b') {
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
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${res.statusCode} from ${u}`));
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
      code === 0 ? resolve() : reject(new Error(`Python extraction failed (code ${code})`));
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
      code === 0 ? resolve() : reject(new Error(`pip bootstrap failed (code ${code})`));
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
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`virtualenv install failed (code ${code})`)));
  });

  console.log('[Python] Embedded Python ready at', WIN_PYTHON_EXE);
  return WIN_PYTHON_EXE;
}

/**
 * Download ComfyUI as a ZIP (no git required).
 * Used on Windows where git is rarely pre-installed.
 */
function downloadComfyUIZip(comfyPath, setInstallMsg) {
  return new Promise((resolve, reject) => {
    const zipUrl = 'https://github.com/comfyanonymous/ComfyUI/archive/refs/heads/master.zip';
    const zipDest = path.join(os.tmpdir(), 'comfyui-master.zip');
    const extractDir = path.dirname(comfyPath);

    setInstallMsg('Downloading ComfyUI… (first launch, ~150 MB)');
    console.log('[ComfyUI] Downloading zip from', zipUrl);

    httpsDownload(zipUrl, zipDest).then(() => {
      setInstallMsg('Extracting ComfyUI…');
      console.log('[ComfyUI] Extracting', zipDest, 'to', extractDir);
      const tar = spawn('tar', ['-xf', zipDest, '-C', extractDir], { stdio: 'pipe' });
      tar.stderr.on('data', (d) => console.log('[ComfyUI extract]', d.toString().trim()));
      tar.on('error', reject);
      tar.on('close', (code) => {
        fs.unlink(zipDest, () => {});
        if (code !== 0) return reject(new Error(`Extraction failed (code ${code})`));
        const extracted = path.join(extractDir, 'ComfyUI-master');
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
      setInstallMsg('Cloning ComfyUI (first launch, ~2 min)…');
      console.log('[ComfyUI] Cloning to', comfyPath);
      await new Promise((resolve, reject) => {
        const git = spawn(gitBin, ['clone', 'https://github.com/comfyanonymous/ComfyUI', comfyPath], {
          stdio: 'pipe',
          env: spawnEnv,
        });
        git.stdout.on('data', (d) => console.log('[ComfyUI clone]', d.toString().trim()));
        git.stderr.on('data', (d) => console.log('[ComfyUI clone]', d.toString().trim()));
        git.on('error', reject);
        git.on('close', (code) => code === 0 ? resolve() : reject(new Error(`git clone failed (code ${code})`)));
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
      venv.on('close', (code) => code === 0 ? resolve() : reject(new Error(`venv creation failed (code ${code})`)));
    });

    // 3. Install requirements into the venv — full output captured for debugging
    setInstallMsg('Installing ComfyUI dependencies (this takes a few minutes)…');
    console.log('[ComfyUI] Installing requirements with venv pip:', venvPip);
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
      pip.on('close', (code) => code === 0 ? resolve() : reject(new Error(`pip install failed (code ${code})`)));
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
        env: { ...process.env, PATH: ENRICHED_PATH, HOME: os.homedir(), PYTHONPATH: comfyPath },
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

const MODEL_URL = 'https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors';
const MODEL_FILENAME = 'dreamshaper_8.safetensors';

function getModelPath(comfyPath) {
  const base = comfyPath || path.join(os.homedir(), 'ComfyUI');
  return path.join(base, 'models', 'checkpoints', MODEL_FILENAME);
}

async function checkAndDownloadModel(loadingWin, comfyPath) {
  const modelPath = getModelPath(comfyPath);
  sendLoadingUpdate(loadingWin, 'Checking for DreamShaper 8 model…', 71);

  if (fs.existsSync(modelPath)) {
    console.log('[Model] DreamShaper 8 already present at', modelPath);
    serviceLaunchStatus.modelPresent = true;
    return true;
  }

  console.log('[Model] DreamShaper 8 not found — downloading to', modelPath);
  sendLoadingUpdate(loadingWin, 'Downloading DreamShaper 8 (~2GB, first launch only)…', 72);

  const modelsDir = path.dirname(modelPath);
  fs.mkdirSync(modelsDir, { recursive: true });

  try {
    await streamDownload(MODEL_URL, modelPath, (downloaded, total) => {
      const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      const mb = Math.round(downloaded / 1024 / 1024);
      const totalMb = total > 0 ? Math.round(total / 1024 / 1024) : '?';
      sendLoadingUpdate(loadingWin, `Downloading model… ${mb}MB / ${totalMb}MB (${pct}%)`, 72 + Math.round(pct * 0.23));
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

function ensureOllamaRunner() {
  if (!app.isPackaged || process.platform !== 'darwin') return;
  const runnerDir = '/Applications/Ollama.app/Contents/Resources';
  if (fs.existsSync(path.join(runnerDir, 'ollama'))) return;
  console.log('[Ollama] Copying bundled Ollama runner to system location…');
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
}

async function startBundledServices(loadingWin) {
  console.log('[Phase14] startBundledServices called, isPackaged:', app.isPackaged);
  serviceLaunchStatus.autoStartAttempted = true;

  // 0. Ensure Ollama runner files are in place before starting the server
  ensureOllamaRunner();

  // 1. Ollama
  const ollamaOk = await startOllama(loadingWin);
  sendLoadingUpdate(loadingWin, ollamaOk ? 'Ollama ready.' : 'Ollama unavailable — continuing.', 20);

  // 2. AI model (qwen2.5:1.5b) — ensureOllamaModel polls for ~/.ollama/id_ed25519 internally
  if (ollamaOk) {
    await ensureOllamaModel(loadingWin, 'qwen2.5:1.5b');
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

  // 4. DreamShaper model download on first launch
  if (comfyOk && isFirstLaunch()) {
    await checkAndDownloadModel(loadingWin, comfyPath);
    markLaunched();
  } else {
    const modelPath = getModelPath(comfyPath);
    serviceLaunchStatus.modelPresent = fs.existsSync(modelPath);
    if (!comfyOk) markLaunched();
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

ipcMain.on('open-download-page', () => shell.openExternal('https://imagginary.com'));

ipcMain.handle('open-folder', async (_event, folderPath) => {
  shell.openPath(folderPath);
});

ipcMain.handle('get-system-memory', () => ({
  totalMem: os.totalmem(),
  freeMem: os.freemem(),
}));

ipcMain.handle('open-external', (_event, url) => {
  shell.openExternal(url);
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

ipcMain.handle('export-animatic', async (event, panelList, outputPath) => {
  console.log('[Animatic] Handler called. Panels:', panelList?.length, 'Output:', outputPath);

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
      lines.push(`file '${imagePath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
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

    const ffmpegArgs = [
      '-y', '-f', 'concat', '-safe', '0', '-i', concatFile,
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
      '-c:v', encoder, ...pixFmtArgs, '-movflags', '+faststart', outputPath,
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

  // ── 1. ffmpeg availability ───────────────────────────────────────────────
  const ffmpegAvailable = await new Promise((resolve) => {
    const probe = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
  if (!ffmpegAvailable) {
    return { success: false, error: 'ffmpeg not found — install via: brew install ffmpeg' };
  }

  // ── 2. Detect encoder ────────────────────────────────────────────────────
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

  const tempDir = app.getPath('temp');
  const sessionId = Date.now();
  const tempClips = [];

  try {
    // ── 3. Resolve inputs and create normalised intermediate clips ──────────
    const validPanels = [];
    const tempImageFiles = [];

    for (const panel of panels) {
      if (panel.motionClipPath && fs.existsSync(panel.motionClipPath)) {
        validPanels.push({ ...panel, resolvedType: 'video', resolvedPath: panel.motionClipPath });
      } else if (panel.imagePath && fs.existsSync(panel.imagePath)) {
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
        const ff = spawn('ffmpeg', args);
        ff.stderr.on('data', (d) => process.stderr.write(d));
        ff.on('error', reject);
        ff.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg clip ${i} exited with code ${code}`));
        });
      });

      // Progress 5–60% across all panel conversions
      sendProgress(5 + Math.round(55 * (i + 1) / validPanels.length));

      for (const tmp of tempImageFiles) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      }
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
      const ff = spawn('ffmpeg', assembleArgs);
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

    // ── 5. Mix ambient sound ─────────────────────────────────────────────
    // Pick mood from the first panel that has one, otherwise neutral
    const dominantMood = validPanels.find((p) => p.mood)?.mood || '';
    const soundPath = selectAmbientSound(dominantMood);

    if (soundPath) {
      const audioArgs = [
        '-y',
        '-i', assembledPath,
        '-stream_loop', '-1', '-i', soundPath,
        '-filter_complex', '[1:a]volume=-18dB[amix]',
        '-map', '0:v', '-map', '[amix]',
        '-shortest',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath,
      ];

      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', audioArgs);
        ff.stderr.on('data', (d) => process.stderr.write(d));
        ff.on('error', reject);
        ff.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg audio mix exited with code ${code}`));
        });
      });
    } else {
      // No sound file — just copy assembled video as final output
      fs.copyFileSync(assembledPath, outputPath);
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
  }
});

// ── Phase 9 — 3D Mesh / Turntable ────────────────────────────────────────────
//
// Calls the InstantMesh Gradio server (localhost:7860) to:
//   1. Generate an OBJ + GLB mesh from a character portrait  ← GPU required
//   2. Render a 360° turntable video from the OBJ           ← GPU required
//
// All file I/O is handled here (main process) because the renderer cannot write
// to arbitrary disk paths.  The renderer receives progress events and final paths.

const INSTANTMESH_URL = 'http://127.0.0.1:7860';
const MESH_TIMEOUT_MS = 5 * 60 * 1000; // 5-minute budget per call

ipcMain.handle('generate-3d-mesh', async (event, { characterId, portraitImagePath }) => {
  const sendProgress = (pct, msg) => {
    try { event.sender.send('mesh-progress', { characterId, pct, message: msg }); } catch { /* window closed */ }
  };

  try {
    // ── 1. Verify InstantMesh is reachable ──────────────────────────────────
    sendProgress(0, 'Checking InstantMesh…');
    let imAvailable = false;
    try {
      const healthRes = await fetch(`${INSTANTMESH_URL}/info`, { signal: AbortSignal.timeout(3000) });
      imAvailable = healthRes.ok;
    } catch {
      try {
        const healthRes = await fetch(INSTANTMESH_URL, { signal: AbortSignal.timeout(3000) });
        imAvailable = healthRes.ok;
      } catch { /* not reachable */ }
    }

    if (!imAvailable) {
      return {
        success: false,
        error: 'InstantMesh is not running on port 7860. Start it and try again.',
      };
    }

    // ── 2. Read and encode the portrait image ───────────────────────────────
    sendProgress(5, 'Reading portrait image…');
    if (!fs.existsSync(portraitImagePath)) {
      return { success: false, error: `Portrait image not found: ${portraitImagePath}` };
    }
    const imgBase64 = fs.readFileSync(portraitImagePath).toString('base64');

    // ── 3. Set up output directory ──────────────────────────────────────────
    const meshDir = path.join(app.getPath('userData'), 'characters', characterId, 'mesh');
    fs.mkdirSync(meshDir, { recursive: true });

    // ── 4. Call /api/generate_mesh  (GPU required on InstantMesh server) ───
    sendProgress(10, 'Generating 3D mesh… (GPU)');
    const meshRes = await fetch(`${INSTANTMESH_URL}/api/generate_mesh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imgBase64, sample_steps: 75, seed: 42 }),
      signal: AbortSignal.timeout(MESH_TIMEOUT_MS),
    });

    if (!meshRes.ok) {
      const errText = await meshRes.text().catch(() => meshRes.statusText);
      return { success: false, error: `Mesh generation failed (HTTP ${meshRes.status}): ${errText}` };
    }

    const meshResult = await meshRes.json();
    sendProgress(55, 'Mesh received, saving…');

    // ── 5. Save OBJ ─────────────────────────────────────────────────────────
    let objPath = null;
    if (meshResult.obj_data) {
      // InstantMesh returned base64-encoded OBJ
      objPath = path.join(meshDir, 'model.obj');
      fs.writeFileSync(objPath, Buffer.from(meshResult.obj_data, 'base64'));
    } else if (meshResult.obj_url) {
      // InstantMesh returned a URL — download it
      objPath = path.join(meshDir, 'model.obj');
      const objRes = await fetch(meshResult.obj_url, { signal: AbortSignal.timeout(30000) });
      fs.writeFileSync(objPath, Buffer.from(await objRes.arrayBuffer()));
    }
    sendProgress(65, 'OBJ saved');

    // ── 6. Save GLB ─────────────────────────────────────────────────────────
    let glbPath = null;
    if (meshResult.glb_data) {
      glbPath = path.join(meshDir, 'model.glb');
      fs.writeFileSync(glbPath, Buffer.from(meshResult.glb_data, 'base64'));
    } else if (meshResult.glb_url) {
      glbPath = path.join(meshDir, 'model.glb');
      const glbRes = await fetch(meshResult.glb_url, { signal: AbortSignal.timeout(30000) });
      fs.writeFileSync(glbPath, Buffer.from(await glbRes.arrayBuffer()));
    }
    sendProgress(72, 'GLB saved');

    // ── 7. Render turntable video  (GPU required) ───────────────────────────
    let turntableVideoPath = null;
    if (objPath) {
      sendProgress(75, 'Rendering turntable video… (GPU)');
      try {
        const turntableRes = await fetch(`${INSTANTMESH_URL}/api/generate_turntable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ obj_path: objPath }),
          signal: AbortSignal.timeout(MESH_TIMEOUT_MS),
        });

        if (turntableRes.ok) {
          const turntableResult = await turntableRes.json();
          if (turntableResult.video_data) {
            turntableVideoPath = path.join(meshDir, 'turntable.mp4');
            fs.writeFileSync(turntableVideoPath, Buffer.from(turntableResult.video_data, 'base64'));
            sendProgress(95, 'Turntable saved');
          } else if (turntableResult.video_url) {
            turntableVideoPath = path.join(meshDir, 'turntable.mp4');
            const vidRes = await fetch(turntableResult.video_url, { signal: AbortSignal.timeout(60000) });
            fs.writeFileSync(turntableVideoPath, Buffer.from(await vidRes.arrayBuffer()));
            sendProgress(95, 'Turntable saved');
          }
        }
      } catch (turntableErr) {
        // Turntable generation is best-effort — don't fail the whole operation
        console.warn('[3DMesh] Turntable generation failed (non-fatal):', turntableErr);
      }
    }

    sendProgress(100, 'Done');
    return { success: true, objPath, glbPath, turntableVideoPath };

  } catch (err) {
    console.error('[3DMesh] Error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-mesh-file', async (_event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
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

ipcMain.handle('generate-pose-animation', async (event, params) => {
  console.log('[PoseEngine] Handler called. Templates:', params?.poseTemplateIds?.length, 'Frames/segment:', params?.framesPerSegment);

  const sendProgress = (data) => {
    try { event.sender.send('pose-animation-progress', data); } catch { /* window closed */ }
  };

  // Basic validation
  if (!params?.imageData) {
    return { success: false, error: 'No image data provided for pose animation' };
  }
  if (!params?.poseTemplateIds?.length) {
    return { success: false, error: 'No pose templates selected' };
  }

  // Signal start — the renderer's PoseEngineService drives the actual generation
  // via ComfyUI.  The IPC handler just records success/failure.
  sendProgress({ pct: 0, msg: 'Pose animation initiated from main process' });

  // The renderer performs the generation directly (ComfyUI is a localhost HTTP
  // server accessible from the renderer via the proxy port).  Return a sentinel
  // so the renderer knows the IPC channel is ready; actual progress events
  // flow from the renderer's onProgress callback via setProgress() in App.tsx.
  return { success: true, delegatedToRenderer: true };
});
