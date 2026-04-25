const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Same isDev detection pattern as Project Aeon — works reliably across Electron versions
const isDev = process.env.ELECTRON_START_URL !== undefined
  || process.defaultApp === true
  || /node_modules[\\/]electron[\\/]/.test(process.execPath);

let mainWindow;

function createWindow() {
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
      webSecurity: true,
    },
  });

  mainWindow.loadURL(
    isDev
      ? 'http://localhost:3000'
      : `file://${path.join(__dirname, '../dist/index.html')}`
  );

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ──────────────────────────────────────────────────────────────

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
  console.log('[Animatic] Show export dialog called');
  const moviesPath = app.getPath('videos');
  return dialog.showSaveDialog(mainWindow, {
    ...options,
    defaultPath: path.join(moviesPath, 'animatic.mp4'),
  });
});

ipcMain.handle('save-image', async (_event, base64Data, fileName) => {
  try {
    const appDataPath = app.getPath('userData');
    const imagesDir = path.join(appDataPath, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const filePath = path.join(imagesDir, fileName);
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
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

ipcMain.handle('get-app-data-path', async () => {
  return app.getPath('userData');
});

ipcMain.handle('open-folder', (_event, filePath) => {
  console.log('[openFolder] Revealing:', filePath);
  shell.showItemInFolder(filePath);
});

ipcMain.handle('delete-comfy-input-file', async (_event, filename) => {
  try {
    const filePath = path.join(os.homedir(), 'ComfyUI', 'input', path.basename(filename));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-animatic', async (_event, panels, outputPath, fps = 24) => {
  console.log('[Animatic] Handler called. Panels:', panels?.length, 'Output:', outputPath);
  const concatFile = path.join(app.getPath('temp'), `aeon-concat-${Date.now()}.txt`);

  // Check ffmpeg is available
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
    // Resolve each panel to a file path — fall back to writing base64 to a temp file
    const validPanels = [];
    for (const panel of panels.filter((p) => p.generatedImagePath || p.generatedImageData)) {
      if (panel.generatedImagePath && fs.existsSync(panel.generatedImagePath)) {
        validPanels.push({ ...panel, resolvedPath: panel.generatedImagePath });
      } else if (panel.generatedImageData) {
        const tmpPath = path.join(app.getPath('temp'), `aeon-panel-${panel.id}-${Date.now()}.png`);
        const b64 = panel.generatedImageData.replace(/^data:image\/[^;]+;base64,/, '');
        fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64'));
        tempPanelFiles.push(tmpPath);
        validPanels.push({ ...panel, resolvedPath: tmpPath });
      }
    }

    console.log('[Animatic] Output path:', outputPath);
    console.log('[Animatic] Concat file:', concatFile);
    console.log('[Animatic] Valid panels:', validPanels.length);

    if (validPanels.length === 0) {
      return { success: false, error: 'No generated panel images found on disk' };
    }

    const lines = [];
    for (const panel of validPanels) {
      lines.push(`file '${panel.resolvedPath.replace(/'/g, "'\\''")}'`);
      lines.push(`duration ${panel.duration}`);
    }
    // Repeat last frame — FFmpeg concat quirk to display the final image
    const last = validPanels[validPanels.length - 1];
    lines.push(`file '${last.resolvedPath.replace(/'/g, "'\\''")}'`);
    lines.push(`duration ${last.duration}`);

    fs.writeFileSync(concatFile, lines.join('\n'), 'utf8');

    // Detect best available H.264 encoder: prefer libx264, fall back to VideoToolbox (macOS)
    const encoder = await new Promise((resolve) => {
      const probe = spawn('ffmpeg', ['-hide_banner', '-encoders']);
      let out = '';
      probe.stdout.on('data', (d) => { out += d; });
      probe.stderr.on('data', (d) => { out += d; });
      probe.on('close', () => {
        if (out.includes('libx264')) resolve('libx264');
        else if (out.includes('h264_videotoolbox')) resolve('h264_videotoolbox');
        else resolve('libx264'); // let ffmpeg emit the real error
      });
    });

    console.log('[Animatic] Encoder:', encoder);

    // VideoToolbox does not support yuv420p pixel format flag
    const pixFmtArgs = encoder === 'h264_videotoolbox' ? [] : ['-pix_fmt', 'yuv420p'];

    // Run FFmpeg
    const ffmpegArgs = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-vf', `scale=768:432:force_original_aspect_ratio=decrease,pad=768:432:(ow-iw)/2:(oh-ih)/2,fps=${fps}`,
      '-c:v', encoder,
      ...pixFmtArgs,
      '-movflags', '+faststart',
      outputPath,
    ];
    console.log('[Animatic] FFmpeg args:', ffmpegArgs);

    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ffmpegArgs);

      ff.stderr.on('data', (data) => process.stderr.write(data));
      ff.on('error', reject);
      ff.on('close', (code) => {
        console.log('[Animatic] FFmpeg exit code:', code);
        console.log('[Animatic] Output exists:', fs.existsSync(outputPath));
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
