// Single source of truth for IPC channel names. main.js and preload.js both
// require this instead of typing the channel strings independently — a typo
// in either file becomes a ReferenceError here instead of a hotkey that
// silently does nothing (ipcRenderer.send to a channel nobody listens on
// fails silently, so a mismatch was previously invisible).
module.exports = {
  TOGGLE_FULLSCREEN: "toggle-fullscreen",
  TOGGLE_ALWAYS_ON_TOP: "toggle-always-on-top",
  QUIT_APP: "quit-app",
};
