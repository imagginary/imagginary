const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('loadingAPI', {
  onLoadingUpdate: (cb) => ipcRenderer.on('loading-update', (_e, data) => cb(data)),
  onShowRetryButton: (cb) => ipcRenderer.on('show-retry-button', (_e, msg) => cb(msg)),
  onHideRetryButton: (cb) => ipcRenderer.on('hide-retry-button', () => cb()),
  retryModelPull: () => ipcRenderer.send('retry-model-pull'),
});
