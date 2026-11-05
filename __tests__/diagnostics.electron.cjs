const { runCheck } = require("./helpers/electron-harness.cjs");
// Run with: npm run test:electron -- diagnostics
const assert = require("node:assert/strict");

runCheck(async ({ createWindow, loadRenderer }) => {
  for (const packaged of [true, false]) {
    const window = createWindow({
      packaged,
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        partition: `diagnostics-check-${packaged}`,
      },
    });
    try {
      await loadRenderer(window);
      const result = await window.webContents.executeJavaScript(`(() => {
          const section = document.getElementById("diagnosticsStatus").closest(".settingsSection");
          document.getElementById("settingsBtn").click();
          // Exercise the render path with diagnostics disabled as well as enabled.
          renderTrailHistory(performance.now());
          return {
            packaged: window.electronAPI.isPackaged,
            visible: getComputedStyle(section).display !== "none",
            profiler: typeof diagnostics,
            settingsOpen: document.getElementById("settingsPanel").classList.contains("visible"),
          };
        })()`);
      assert.equal(result.packaged, packaged);
      assert.equal(result.visible, !packaged);
      assert.equal(result.profiler, packaged ? "undefined" : "object");
      assert.equal(result.settingsOpen, true);
      console.log(
        `PASS: ${packaged ? "packaged" : "development"} diagnostics visibility, profiler, settings, and render path`
      );
    } finally {
      window.hide();
    }
  }
});
