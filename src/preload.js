const { contextBridge, ipcRenderer } = require("electron");
const IPC = require("./ipc-channels");

contextBridge.exposeInMainWorld("electronAPI", {
  toggleFullscreen: () => ipcRenderer.send(IPC.TOGGLE_FULLSCREEN),
  toggleAlwaysOnTop: () => ipcRenderer.send(IPC.TOGGLE_ALWAYS_ON_TOP),
  quit: () => ipcRenderer.send(IPC.QUIT_APP),
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
