const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const {
  waitFor: waitForCondition,
  createPaintProbe,
} = require("./verification-waits.cjs");
const {
  projectRoot,
  configureProfile,
} = require("../../scripts/verification-paths.cjs");
// This also sets inherited profile variables for the single-instance secondary.
const paths = configureProfile(app);
const interactive =
  process.env.AV_VERIFICATION_INTERACTIVE === "1" ||
  process.argv.includes("--interactive");
function runCheck(check, { requiresDesktop = false } = {}) {
  if (requiresDesktop && !interactive) {
    console.log(
      "SKIP: this check opens native windows; rerun with --interactive when convenient."
    );
    app.whenReady().then(() => app.quit());
    return;
  }
  const windows = new Set(),
    errors = [],
    allowances = new Map();
  let cleaning = false;
  const pendingWaits = new Set();
  let paintSequence = 0;
  function waitFor(description, read, accept, options = {}) {
    const controller = new AbortController(),
      releases = [];
    const abort = () =>
      controller.abort(Error(`Owner closed while waiting for ${description}`));
    const { window: owner, signal, ...timing } = options;
    pendingWaits.add(abort);
    if (owner) {
      if (owner.isDestroyed() || owner.webContents.isDestroyed()) abort();
      else
        for (const [target, event] of [
          [owner, "closed"],
          [owner.webContents, "destroyed"],
          [owner.webContents, "render-process-gone"],
        ]) {
          target.on(event, abort);
          releases.push(() => target.removeListener(event, abort));
        }
    }
    if (signal) {
      const forward = () => controller.abort(signal.reason);
      if (signal.aborted) forward();
      else signal.addEventListener("abort", forward, { once: true });
      releases.push(() => signal.removeEventListener("abort", forward));
    }
    return waitForCondition(description, read, accept, {
      ...timing,
      signal: controller.signal,
    }).finally(() => {
      pendingWaits.delete(abort);
      for (const release of releases) release();
    });
  }
  async function waitForPaint(window, selectors = ["body"], options = {}) {
    const id = ++paintSequence;
    try {
      return await waitFor(
        `paint ${selectors.join(", ")}`,
        () =>
          window.webContents.executeJavaScript(
            `window.verificationPaintProbe.probe(${id},${JSON.stringify(selectors)})`
          ),
        (value) => value.frames >= 2 && value.animations === 0,
        { ...options, window }
      );
    } finally {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        // Queue cleanup without awaiting a potentially unresponsive renderer.
        // Teardown destroys the owned window even if this IPC cannot complete.
        void window.webContents
          .executeJavaScript(`window.verificationPaintProbe.cancel(${id})`)
          .catch(() => {});
    }
  }
  async function setViewport(window, width, height) {
    window.setContentSize(width, height);
    // Windows can round the requested size at fractional display scaling.
    return waitFor(
      `viewport ${width} × ${height}`,
      async () => {
        const viewport = await window.webContents.executeJavaScript(
          "({width:innerWidth,height:innerHeight})"
        );
        const [nativeWidth, nativeHeight] = window.getContentSize();
        return { ...viewport, nativeWidth, nativeHeight };
      },
      (value) =>
        Math.abs(value.width - value.nativeWidth) <= 1 &&
        Math.abs(value.height - value.nativeHeight) <= 1,
      { window }
    );
  }
  async function installWaiters(window) {
    await window.webContents.executeJavaScript(`(()=>{
      const waitFor=${waitForCondition.toString()};
      const controller=new AbortController();
      const paint=(${createPaintProbe.toString()})(document,requestAnimationFrame.bind(window),cancelAnimationFrame.bind(window));
      let id=0;
      window.verificationPaintProbe=paint;
      window.verificationWaitFor=(description,read,accept,options={})=>waitFor(description,read,accept,{...options,signal:controller.signal});
      window.verificationWaitForPaint=async(selectors=['body'],options={})=>{
        const token='renderer-'+(++id);
        try{return await window.verificationWaitFor('paint '+selectors.join(', '),()=>paint.probe(token,selectors),value=>value.frames>=2&&value.animations===0,options);}
        finally{paint.cancel(token);}
      };
      window.verificationDisposeWaiters=()=>{controller.abort(Error('Verification renderer disposed'));paint.dispose();};
      window.addEventListener('pagehide',window.verificationDisposeWaiters,{once:true});
    })()`);
  }
  function createWindow({
    packaged = true,
    withRenderer = true,
    ...options
  } = {}) {
    if (!interactive && options.show)
      throw Error("Visible verification windows require --interactive");
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      ...options,
      show: interactive && options.show === true,
      focusable: interactive,
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
    if (!interactive) {
      for (const method of [
        "show",
        "showInactive",
        "focus",
        "moveTop",
        "restore",
        "maximize",
        "setFullScreen",
      ])
        window[method] = () => {
          throw Error(`${method} requires --interactive verification`);
        };
    }
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
    await installWaiters(window);
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
    await installWaiters(window);
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
          waitFor,
          waitForPaint,
          setViewport,
          installWaiters,
          errors,
          artifactDir: paths.artifacts,
        });
        if (errors.length)
          throw Error(`Unexpected renderer errors:\n${errors.join("\n")}`);
      } catch (error) {
        console.error(error);
        if (errors.length) console.error(errors.join("\n"));
        failed = true;
      } finally {
        cleaning = true;
        for (const abort of pendingWaits) abort();
        for (const window of windows)
          if (!window.isDestroyed() && !window.webContents.isDestroyed())
            void window.webContents
              .executeJavaScript("window.verificationDisposeWaiters?.()")
              .catch(() => {});
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
