const { contextBridge, ipcRenderer } = require("electron");
const IPC = require("./ipc-channels");

contextBridge.exposeInMainWorld("electronAPI", {
  toggleFullscreen: () => ipcRenderer.send(IPC.TOGGLE_FULLSCREEN),
  toggleAlwaysOnTop: () => ipcRenderer.send(IPC.TOGGLE_ALWAYS_ON_TOP),
  quit: () => ipcRenderer.send(IPC.QUIT_APP),
  getPerformanceMetrics: () => ipcRenderer.invoke(IPC.GET_PERFORMANCE_METRICS),
  benchmarkStartRenderTrace: (meta) =>
    ipcRenderer.invoke("benchmark-start-render-trace", meta),
  benchmarkStopRenderTrace: (meta) =>
    ipcRenderer.invoke("benchmark-stop-render-trace", meta),
});
