const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  toggleFullscreen: () => ipcRenderer.send("toggle-fullscreen"),
  toggleAlwaysOnTop: () => ipcRenderer.send("toggle-always-on-top"),
  quit: () => ipcRenderer.send("quit-app"),
});
