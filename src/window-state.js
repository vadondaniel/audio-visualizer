// Window z-order policy kept separate from Electron startup so it can be
// tested with a small BrowserWindow-shaped mock.
function toggleAlwaysOnTop(window) {
  const enabled = !window.isAlwaysOnTop();
  window.setAlwaysOnTop(enabled, enabled ? "floating" : "normal");

  // Windows can retain a stale z-order after changing the topmost flag. Move
  // the window to the top immediately after enabling to reassert the policy.
  if (enabled) {
    window.moveTop();
    window.focus();
  }

  return enabled;
}

if (typeof module === "object" && module.exports) {
  module.exports = { toggleAlwaysOnTop };
}
