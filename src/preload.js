const { contextBridge, ipcRenderer } = require("electron");
const IPC = require("./ipc-channels");

contextBridge.exposeInMainWorld("electronAPI", {
  isPackaged: process.argv.includes("--app-packaged=true"),
  miniOverlaySupported: process.argv.includes("--mini-overlay-supported"),
  /** @param {import('./tray-controller').TraySettings} settings */
  setTraySettings: (settings) => ipcRenderer.send(IPC.TRAY_SETTINGS, settings),
  /** @param {(selection:import('./tray-controller').Selection)=>void} callback */
  onTraySelect: (callback) => {
    const listener = (_event, selection) => callback(selection);
    ipcRenderer.on(IPC.TRAY_SELECT, listener);
    return () => ipcRenderer.removeListener(IPC.TRAY_SELECT, listener);
  },
  toggleFullscreen: () => ipcRenderer.send(IPC.TOGGLE_FULLSCREEN),
  toggleAlwaysOnTop: () => ipcRenderer.send(IPC.TOGGLE_ALWAYS_ON_TOP),
  quit: () => ipcRenderer.send(IPC.QUIT_APP),
  /** @returns {Promise<import('./mini-overlay').Presentation>} */
  enterMiniOverlay: () => ipcRenderer.invoke(IPC.OVERLAY_ENTER),
  /** @param {boolean} [openSettings] @returns {Promise<import('./mini-overlay').Presentation>} */
  restoreNormalWindow: (openSettings = false) =>
    ipcRenderer.invoke(IPC.OVERLAY_RESTORE, openSettings),
  /** @returns {Promise<import('./mini-overlay').Presentation>} */
  lockMiniOverlay: () => ipcRenderer.invoke(IPC.OVERLAY_LOCK),
  /** @returns {Promise<import('./mini-overlay').Presentation>} */
  getMiniOverlayState: () => ipcRenderer.invoke(IPC.OVERLAY_GET_STATE),
  /** @returns {Promise<import('./mini-overlay').Bounds|null>} */
  getMiniOverlayBounds: () => ipcRenderer.invoke(IPC.OVERLAY_GET_BOUNDS),
  /** @param {import('./mini-overlay').BoundsRequest} bounds */
  setMiniOverlayBounds: (bounds) =>
    ipcRenderer.send(IPC.OVERLAY_SET_BOUNDS, bounds),
  /** @param {(state:import('./mini-overlay').Presentation)=>void} callback */
  onMiniOverlayState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(IPC.OVERLAY_STATE, listener);
    return () => ipcRenderer.removeListener(IPC.OVERLAY_STATE, listener);
  },
  getPerformanceMetrics: () => ipcRenderer.invoke(IPC.GET_PERFORMANCE_METRICS),
  setMediaMetadataEnabled: (enabled) =>
    ipcRenderer.send(IPC.SET_MEDIA_METADATA_ENABLED, Boolean(enabled)),
  onMediaMetadata: (callback) => {
    const listener = (_event, metadata) => callback(metadata);
    ipcRenderer.on(IPC.MEDIA_METADATA, listener);
    return () => ipcRenderer.removeListener(IPC.MEDIA_METADATA, listener);
  },
  benchmarkStartRenderTrace: (meta) =>
    ipcRenderer.invoke("benchmark-start-render-trace", meta),
  benchmarkStopRenderTrace: (meta) =>
    ipcRenderer.invoke("benchmark-stop-render-trace", meta),
});
