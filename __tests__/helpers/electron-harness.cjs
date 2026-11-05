const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const {
  projectRoot,
  configureProfile,
} = require("../../scripts/verification-paths.cjs");
// This also sets inherited profile variables for the single-instance secondary.
const paths = configureProfile(app);
function runCheck(check) {
  const windows = new Set(),
    errors = [],
    allowances = new Map();
  let cleaning = false;
  function createWindow({
    packaged = true,
    withRenderer = true,
    ...options
  } = {}) {
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      ...options,
      webPreferences: {
        ...(withRenderer
          ? {
              preload: path.join(projectRoot, "src/preload.js"),
              additionalArguments: [`--app-packaged=${packaged}`],
              sandbox: false,
              contextIsolation: true,
              nodeIntegration: false,
            }
          : {}),
        ...options.webPreferences,
      },
    });
    windows.add(window);
    window.webContents.on("console-message", (event) => {
      if (
        event.level === "error" &&
        !(allowances.get(window) || []).some((pattern) =>
          pattern.test(event.message)
        )
      )
        errors.push(event.message);
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      if (!cleaning) errors.push(`Renderer exited: ${details.reason}`);
    });
    return window;
  }
  async function ready(window) {
    await window.webContents.executeJavaScript(
      `(()=>{if(!window.rendererReady || typeof window.rendererReady.then!=='function')throw Error('Renderer readiness was not published');return window.rendererReady;})()`
    );
  }
  async function loadRenderer(window, { waitForReady = true } = {}) {
    await window.loadFile(path.join(projectRoot, "src/index.html"));
    if (waitForReady) await ready(window);
  }
  async function reloadRenderer(window) {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        window.webContents.removeListener("did-finish-load", loaded);
        window.webContents.removeListener("did-fail-load", failed);
      };
      const loaded = () => {
        cleanup();
        resolve();
      };
      const failed = (_event, code, message) => {
        cleanup();
        reject(Error(`Reload failed ${code}: ${message}`));
      };
      window.webContents.once("did-finish-load", loaded);
      window.webContents.once("did-fail-load", failed);
      window.reload();
    });
    await ready(window);
  }
  async function expectRendererErrors(window, pattern, callback) {
    const previous = allowances.get(window) || [];
    allowances.set(window, [...previous, pattern]);
    try {
      return await callback();
    } finally {
      allowances.set(window, previous);
    }
  }
  app
    .whenReady()
    .then(async () => {
      let failed = false;
      ipcMain.handle("get-performance-metrics", () => app.getAppMetrics());
      try {
        await check({
          createWindow,
          loadRenderer,
          reloadRenderer,
          expectRendererErrors,
          errors,
          artifactDir: paths.artifacts,
        });
        if (errors.length)
          throw Error(`Unexpected renderer errors:\n${errors.join("\n")}`);
      } catch (error) {
        console.error(error);
        failed = true;
      } finally {
        cleaning = true;
        for (const window of windows)
          if (!window.isDestroyed()) window.destroy();
        ipcMain.removeHandler("get-performance-metrics");
        app.exit(failed ? 1 : 0);
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
module.exports = { runCheck };
