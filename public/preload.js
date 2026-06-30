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

  // Production Pack exports (Studio tier)
  exportPDF: (base64Data) => ipcRenderer.invoke('export-pdf', base64Data),
  exportFCPXML: (xmlString) => ipcRenderer.invoke('export-fcpxml', xmlString),

  // Animatic export
  exportAnimatic: (panelList, outputPath) => ipcRenderer.invoke('export-animatic', panelList, outputPath),
  onAnimaticProgress: (callback) => {
    const handler = (_event, percent) => callback(percent);
    ipcRenderer.on('animatic-progress', handler);
    return () => ipcRenderer.removeListener('animatic-progress', handler);
  },

  // Motion Comic export (Phase 6D)
  exportMotionComic: (payload) => ipcRenderer.invoke('export-motion-comic', payload),
  onMotionComicProgress: (cb) => {
    const handler = (_event, pct) => cb(pct);
    ipcRenderer.on('motion-comic-progress', handler);
    return () => ipcRenderer.removeListener('motion-comic-progress', handler);
  },

  // Phase 6B — Pose Engine
  onPoseAnimationProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('pose-animation-progress', handler);
    return () => ipcRenderer.removeListener('pose-animation-progress', handler);
  },
  checkControlnetOpenpose: () => ipcRenderer.invoke('check-controlnet-openpose'),
  downloadControlnetOpenpose: () => ipcRenderer.invoke('download-controlnet-openpose'),
  onControlnetDownloadProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('controlnet-download-progress', handler);
    return () => ipcRenderer.removeListener('controlnet-download-progress', handler);
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
  // Pro model (RealVisXL V4.0) download
  downloadProModel: () => ipcRenderer.invoke('download-pro-model'),
  onProModelProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('pro-model-progress', handler);
    return () => ipcRenderer.removeListener('pro-model-progress', handler);
  },

  // AbsoluteReality model download
  downloadAbsoluteReality: () => ipcRenderer.invoke('download-absolute-reality'),
  onAbsoluteRealityProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('absolute-reality-progress', handler);
    return () => ipcRenderer.removeListener('absolute-reality-progress', handler);
  },

  // Service health checks — proxied through main process to bypass renderer CSP/CORS
  checkOllama: () => ipcRenderer.invoke('check-ollama'),
  checkComfyUI: () => ipcRenderer.invoke('check-comfyui'),
  getComfyUIProxyPort: () => ipcRenderer.invoke('get-comfyui-proxy-port'),

  // System info
  getSystemMemory: () => ipcRenderer.invoke('get-system-memory'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Phase 6C — Motion Library
  getMotionLibraryIndex: () => ipcRenderer.invoke('get-motion-library-index'),
  getMotionClipSequence: (clipId) => ipcRenderer.invoke('get-motion-clip-sequence', clipId),
  applyMotionClip: (params) => ipcRenderer.invoke('apply-motion-clip', params),
  extractVideoPose: (videoPath) => ipcRenderer.invoke('extract-video-pose', videoPath),
  onMotionClipProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('motion-clip-progress', handler);
    return () => ipcRenderer.removeListener('motion-clip-progress', handler);
  },

  // Phase 6E — Video Transfer (Pro+)
  validateTransferVideo: (filePath) => ipcRenderer.invoke('validate-transfer-video', filePath),
  extractTransferPoses: (filePath) => ipcRenderer.invoke('extract-transfer-poses', filePath),
  cleanupTransferFrames: (tempDir) => ipcRenderer.invoke('cleanup-transfer-frames', tempDir),
  onTransferPoseProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('transfer-pose-progress', handler);
    return () => ipcRenderer.removeListener('transfer-pose-progress', handler);
  },

  // Credits (main-process store — not accessible from DevTools)
  getCredits:   ()    => ipcRenderer.invoke('get-credits'),
  spendCredits: (cost) => ipcRenderer.invoke('spend-credits', cost),
  setCredits:   (bal)  => ipcRenderer.invoke('set-credits', bal),
  resetCredits: ()    => ipcRenderer.invoke('reset-credits'),

  // License / Dodo Payments
  validateLicense: (key) => ipcRenderer.invoke('validate-license', key),
  getLicense: () => ipcRenderer.invoke('get-license'),
  saveLicense: (license) => ipcRenderer.invoke('save-license', license),
  clearLicense: () => ipcRenderer.invoke('clear-license'),
  openCheckout: (tier) => ipcRenderer.invoke('open-checkout', tier),
  openCustomerPortal: () => ipcRenderer.invoke('open-customer-portal'),
  validateTopup: (code) => ipcRenderer.invoke('validate-topup', code),
  openTopupCheckout: (pack) => ipcRenderer.invoke('open-topup-checkout', pack),

  // Phase 15 — Voice Layer (edge-tts)
  checkCoquiTTS: () => ipcRenderer.invoke('check-coqui-tts'),
  getVoiceLibrary: () => ipcRenderer.invoke('get-voice-library'),
  getVoiceSample: (voiceId) => ipcRenderer.invoke('get-voice-sample', voiceId),
  generateVoice: (params) => ipcRenderer.invoke('generate-voice', params),
  installCoquiTTS: () => ipcRenderer.invoke('install-coqui-tts'),
  cloneVoice: (params) => ipcRenderer.invoke('clone-voice', params),
  generateClonedVoice: (params) => ipcRenderer.invoke('generate-cloned-voice', params),
  checkVoiceCloneProviders: () => ipcRenderer.invoke('check-voice-clone-providers'),
  saveElevenLabsKey: (params) => ipcRenderer.invoke('save-elevenlabs-key', params),
  getCustomVoices: () => ipcRenderer.invoke('get-custom-voices'),
  saveCustomVoice: (params) => ipcRenderer.invoke('save-custom-voice', params),
  deleteCustomVoice: (params) => ipcRenderer.invoke('delete-custom-voice', params),
  getEdgeTtsVoices: () => ipcRenderer.invoke('get-edge-tts-voices'),
  previewVoice: (params) => ipcRenderer.invoke('preview-voice', params),
  readFileAsBase64: (filePath) => ipcRenderer.invoke('read-file-as-base64', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
  exportPanelWithVoice: (params) => ipcRenderer.invoke('export-panel-with-voice', params),
  onJoinSharedProject: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('join-shared-project', handler);
    return () => ipcRenderer.removeListener('join-shared-project', handler);
  },
  onSharedStudioJoin: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('shared-studio-join', handler);
    return () => ipcRenderer.removeListener('shared-studio-join', handler);
  },
  onVoiceProgress: (cb) => {
    const handler = (_event, pct) => cb(pct);
    ipcRenderer.on('voice-progress', handler);
    return () => ipcRenderer.removeListener('voice-progress', handler);
  },
  onInstallProgress: (cb) => {
    const handler = (_event, msg) => cb(msg);
    ipcRenderer.on('install-progress', handler);
    return () => ipcRenderer.removeListener('install-progress', handler);
  },

  // Cloud API proxy — keys live in main process only, never in renderer bundle
  falFluxSchnell:      (params) => ipcRenderer.invoke('fal-flux-schnell', params),
  falIPAdapter:        (params) => ipcRenderer.invoke('fal-ipadapter', params),
  falFluxFill:         (params) => ipcRenderer.invoke('fal-flux-fill', params),
  falKling:            (params) => ipcRenderer.invoke('fal-kling', params),
  cancelFalKling:      () => ipcRenderer.send('cancel-fal-kling'),
  interruptComfyUI:    () => ipcRenderer.invoke('interrupt-comfyui'),
  syncsoLipSync:       (params) => ipcRenderer.invoke('syncso-lipsync', params),
  deepSeekShot:        (params) => ipcRenderer.invoke('deepseek-parse-shot', params),
  deepSeekScreenplay:  (params) => ipcRenderer.invoke('deepseek-parse-screenplay', params),
  onCloudProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('cloud-progress', handler);
    return () => ipcRenderer.removeListener('cloud-progress', handler);
  },

  // Brand LoRA Training
  uploadTrainingImages:  (params) => ipcRenderer.invoke('upload-training-images', params),
  startLoraTraining:     (params) => ipcRenderer.invoke('start-lora-training', params),
  pollLoraTraining:      (params) => ipcRenderer.invoke('poll-lora-training', params),
  installLora:           (params) => ipcRenderer.invoke('install-lora', params),
  getCustomStyles:       ()       => ipcRenderer.invoke('get-custom-styles'),
  saveCustomStyle:       (params) => ipcRenderer.invoke('save-custom-style', params),
  deleteCustomStyle:         (params) => ipcRenderer.invoke('delete-custom-style', params),
  cleanupTrainingUploads:    (params) => ipcRenderer.invoke('cleanup-training-uploads', params),
  onLoraUploadProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('lora-upload-progress', handler);
    return () => ipcRenderer.removeListener('lora-upload-progress', handler);
  },
  onLoraInstallProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('lora-install-progress', handler);
    return () => ipcRenderer.removeListener('lora-install-progress', handler);
  },

  // Platform (safe to read in preload)
  platform: process.platform,
});
