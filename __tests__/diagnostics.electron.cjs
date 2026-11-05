// Run with: npx electron __tests__/diagnostics.electron.cjs
const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const IPC = require("../src/ipc-channels");

app.whenReady().then(async () => {
  let failed = false;
  const windows = [];
  ipcMain.handle(IPC.GET_PERFORMANCE_METRICS, () => app.getAppMetrics());
  try {
    for (const packaged of [true, false]) {
      const window = new BrowserWindow({
        show: false,
        width: 1280,
        height: 720,
        webPreferences: {
          preload: path.join(__dirname, "../src/preload.js"),
          additionalArguments: [`--app-packaged=${packaged}`],
          partition: `diagnostics-check-${packaged}`,
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      windows.push(window);
      try {
        await window.loadFile(path.join(__dirname, "../src/index.html"));
        await window.webContents.executeJavaScript("window.rendererReady");
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
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    for (const window of windows) window.destroy();
    app.exit(failed ? 1 : 0);
  }
});
