const { contextBridge, ipcRenderer } = require("electron");
const IPC = require("./ipc-channels");
/** @type {import('./settings-protocol').ClientApi} */
const api = {
  getState: () => ipcRenderer.invoke(IPC.SETTINGS_READ),
  dispatch: (command) => ipcRenderer.invoke(IPC.SETTINGS_COMMAND, command),
  diagnostics: (operation) =>
    ipcRenderer.invoke(IPC.SETTINGS_DIAGNOSTICS, operation),
  onPatch(callback) {
    const listener = (_event, patch) => callback(patch);
    ipcRenderer.on(IPC.SETTINGS_PATCH, listener);
    return () => ipcRenderer.removeListener(IPC.SETTINGS_PATCH, listener);
  },
  ready: () => ipcRenderer.invoke(IPC.SETTINGS_CLIENT_READY),
  close: () => ipcRenderer.send(IPC.SETTINGS_CLOSE),
};
contextBridge.exposeInMainWorld("settingsAPI", api);
