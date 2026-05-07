const { contextBridge, ipcRenderer } = require('electron');

// Preload runs in sandboxed context — no Node.js core modules.
// All file/OS operations are delegated to the main process via IPC.

// Synchronous check — runs before React mounts, so localStorage is clean
// before useState(() => localStorage.getItem('imagginary_onboarded')) fires.
const isFresh = ipcRenderer.sendSync('is-fresh-install-sync');
if (isFresh) {
  localStorage.removeItem('imagginary_onboarded');
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Project persistence
  saveProject: (projectData, filePath) => ipcRenderer.invoke('save-project', projectData, filePath),
  loadProject: (filePath) => ipcRenderer.invoke('load-project', filePath),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showExportDialog: (options) => ipcRenderer.invoke('show-export-dialog', options),

  // Image operations
  saveImage: (base64Data, fileName) => ipcRenderer.invoke('save-image', base64Data, fileName),
  readImage: (filePath) => ipcRenderer.invoke('read-image', filePath),

  // Video operations
  saveVideo: (base64Data, fileName) => ipcRenderer.invoke('save-video', base64Data, fileName),

  // Animatic export
  exportAnimatic: (panelList, outputPath) => ipcRenderer.invoke('export-animatic', panelList, outputPath),
  onAnimaticProgress: (callback) => {
    const handler = (_event, percent) => callback(percent);
    ipcRenderer.on('animatic-progress', handler);
    return () => ipcRenderer.removeListener('animatic-progress', handler);
  },

  // ComfyUI integration
  deleteComfyInputFile: (filename) => ipcRenderer.invoke('delete-comfy-input-file', filename),

  // App info
  getAppDataPath: () => ipcRenderer.invoke('get-app-data-path'),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),

  // Phase 14 — Bundled Engine
  // Returns { autoStartAttempted, ollama, comfyui, modelPresent }
  getServiceLaunchStatus: () => ipcRenderer.invoke('get-service-launch-status'),
  // Trigger model download; listen for 'download-model-progress' events for progress
  downloadModels: () => ipcRenderer.invoke('download-models'),
  // Subscribe to model download progress events
  onDownloadModelProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('download-model-progress', handler);
    // Return a cleanup function
    return () => ipcRenderer.removeListener('download-model-progress', handler);
  },

  // Service health checks — proxied through main process to bypass renderer CSP/CORS
  checkOllama: () => ipcRenderer.invoke('check-ollama'),
  checkComfyUI: () => ipcRenderer.invoke('check-comfyui'),
  getComfyUIProxyPort: () => ipcRenderer.invoke('get-comfyui-proxy-port'),

  // System info
  getSystemMemory: () => ipcRenderer.invoke('get-system-memory'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Platform (safe to read in preload)
  platform: process.platform,
});
