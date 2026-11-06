const {
  app,
  BaseWindow,
  BrowserWindow,
  screen,
  dialog,
  session,
  desktopCapturer,
  ipcMain,
} = require("electron");
const path = require("path");
const fs = require("fs");
const IPC = require("./ipc-channels");
const { toggleAlwaysOnTop } = require("./window-state");
const { spawn } = require("child_process");
const { acquireSingleInstance } = require("./single-instance");
const MiniOverlay = require("./mini-overlay");
const TrayController = require("./tray-controller");
const SettingsWindow = require("./settings-window");
let floatingSettings;

let mainWindow;
let presentation;
let nativeTray;
let rendererContents;
let rendererReady = false;
let rendererLoadGeneration = 0;
let mediaWatcher = null;
let mediaWatcherBuffer = "";
let pendingMediaMetadata = [];

function stopMediaWatcher() {
  if (!mediaWatcher) return;
  try {
    mediaWatcher.kill();
  } catch {}
  mediaWatcher = null;
  mediaWatcherBuffer = "";
  pendingMediaMetadata = [];
}

function startMediaWatcher() {
  if (process.platform !== "win32" || mediaWatcher) return;

  stopMediaWatcher();
  const watcherPath = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "media-watcher",
        "publish",
        "media-watcher.exe"
      )
    : path.join(
        __dirname,
        "..",
        "media-watcher",
        "publish",
        "media-watcher.exe"
      );

  if (!fs.existsSync(watcherPath)) {
    console.warn(
      "Windows media watcher executable is missing:",
      watcherPath,
      "npm start will build it automatically; or run scripts\\build-media-watcher.ps1 manually."
    );
    return;
  }

  mediaWatcher = spawn(watcherPath, [], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  mediaWatcher.stdout.setEncoding("utf8");
  console.log("Starting Windows media watcher:", watcherPath);

  mediaWatcher.stdout.on("data", (chunk) => {
    mediaWatcherBuffer += chunk;
    const lines = mediaWatcherBuffer.split(/\r?\n/);
    mediaWatcherBuffer = lines.pop() || "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      try {
        const metadata = JSON.parse(text);
        if (
          !rendererReady ||
          !rendererContents ||
          rendererContents.isDestroyed() ||
          rendererContents.isLoading()
        ) {
          pendingMediaMetadata.push(metadata);
          if (pendingMediaMetadata.length > 4) pendingMediaMetadata.shift();
          continue;
        }
        rendererContents.send(IPC.MEDIA_METADATA, metadata);
      } catch (err) {
        console.warn("Invalid media watcher JSON:", err.message, text);
      }
    }
  });

  mediaWatcher.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) console.warn("Media watcher:", text);
  });

  mediaWatcher.on("error", (err) => {
    console.warn("Could not start Windows media watcher:", err.message);
    stopMediaWatcher();
  });

  mediaWatcher.on("exit", () => {
    mediaWatcher = null;
  });
}

async function finishRendererStartup(contents) {
  const generation = rendererLoadGeneration;
  try {
    await contents.executeJavaScript("window.rendererReady");
    if (
      rendererContents !== contents ||
      contents.isDestroyed() ||
      generation !== rendererLoadGeneration
    )
      return;
    rendererReady = true;
    for (const metadata of pendingMediaMetadata)
      contents.send(IPC.MEDIA_METADATA, metadata);
    pendingMediaMetadata = [];
  } catch (error) {
    console.error("Renderer initialization failed:", error.message);
  }
}

function createWindow() {
  const electron = require("electron");
  nativeTray = TrayController.create({
    Tray: electron.Tray,
    Menu: electron.Menu,
    icon: path.join(__dirname, "icon.png"),
    onSelect: (selection) => {
      if (rendererContents && !rendererContents.isDestroyed())
        rendererContents.send(IPC.TRAY_SELECT, selection);
    },
    onUnlock: () => presentation?.unlock(),
    onReturn: () => presentation?.restore(),
    onQuit: () => app.quit(),
  });
  presentation = MiniOverlay.create({
    electron,
    preload: path.join(__dirname, "preload.js"),
    icon: path.join(__dirname, "icon.png"),
    packaged: app.isPackaged,
    preferencesPath: path.join(app.getPath("userData"), "mini-overlay.json"),
    onQuit: () => app.quit(),
    ensureTray: nativeTray.ensure,
    isTrayAvailable: nativeTray.isAvailable,
    onPresentationChange(value) {
      nativeTray.setPresentation(value);
      floatingSettings?.presentationChanged(value);
    },
  });
  mainWindow = presentation.normal;
  rendererContents = presentation.contents;
  floatingSettings = SettingsWindow.create({
    createWindow: (options) => new BrowserWindow(options),
    present: (window) => {
      window.show();
      window.focus();
    },
    ipc: ipcMain,
    screen,
    getOwner: () => rendererContents,
    waitForOwner: () =>
      rendererContents.executeJavaScript("window.rendererReady"),
    getOverlay: () => presentation.getOverlayWindow(),
    isActive: () => presentation.snapshot().active,
    htmlPath: path.join(__dirname, "settings.html"),
    preload: path.join(__dirname, "settings-preload.js"),
    reportError: (message) => {
      dialog
        .showMessageBox(presentation.getOverlayWindow() || mainWindow, {
          type: "error",
          title: "Settings",
          message,
        })
        .catch(console.error);
    },
  });
  const loadingContents = rendererContents;
  rendererReady = false;
  rendererContents.on("did-start-loading", () => {
    if (rendererContents === loadingContents) {
      rendererReady = false;
      rendererLoadGeneration++;
    }
  });
  rendererContents.on("did-finish-load", () =>
    finishRendererStartup(loadingContents)
  );
  rendererContents.loadFile(path.join(__dirname, "index.html"));

  // This is what lets us grab system-wide desktop audio (WASAPI loopback on
  // Windows) without any virtual-cable software. The renderer calls
  // navigator.mediaDevices.getDisplayMedia({video:true, audio:true}) and
  // this handler answers it directly with the loopback audio, skipping the
  // usual screen-share picker dialog.
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          if (sources.length === 0) {
            console.error("No desktop sources available for loopback capture");
            callback({});
            return;
          }
          callback({ video: sources[0], audio: "loopback" });
        })
        .catch((err) => {
          console.error("Failed to get desktop sources", err);
          callback({});
        });
    },
    { useSystemPicker: false }
  );
}

function buildMediaWatcher() {
  return new Promise((resolve, reject) => {
    const build = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "..", "scripts", "build-media-watcher.ps1"),
      ],
      { windowsHide: true, stdio: "inherit" }
    );
    build.once("error", reject);
    build.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Media watcher build failed (exit code ${code}).`));
    });
  });
}

if (
  acquireSingleInstance(app, () => {
    presentation?.restore();
    return mainWindow;
  })
) {
  app
    .whenReady()
    .then(async () => {
      if (!app.isPackaged) await buildMediaWatcher();
      createWindow();
    })
    .catch((error) => {
      console.error("Could not start Audio Visualizer:", error.message);
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow();
    else presentation?.restore();
  });

  ipcMain.on(IPC.TOGGLE_FULLSCREEN, () => {
    if (!mainWindow || presentation?.snapshot().active) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });

  ipcMain.on(IPC.TOGGLE_ALWAYS_ON_TOP, () => {
    if (!mainWindow || presentation?.snapshot().active) return;
    toggleAlwaysOnTop(mainWindow);
  });

  ipcMain.on(IPC.QUIT_APP, () => {
    app.quit();
  });

  ipcMain.handle(IPC.GET_PERFORMANCE_METRICS, () => app.getAppMetrics());

  const removeOverlayIpc = MiniOverlay.registerIpc(
    ipcMain,
    () => presentation,
    async () => {
      if (!rendererReady || !rendererContents || rendererContents.isDestroyed())
        return false;
      return rendererContents.executeJavaScript(
        "!!analyser && !!audioCtx && audioCtx.state === 'running'"
      );
    }
  );
  const removeTrayIpc = TrayController.registerIpc(
    ipcMain,
    () => rendererContents,
    () => nativeTray
  );

  ipcMain.on(IPC.SET_MEDIA_METADATA_ENABLED, (_event, enabled) => {
    if (enabled) startMediaWatcher();
    else stopMediaWatcher();
  });

  app.on("before-quit", stopMediaWatcher);
  app.on("before-quit", () => {
    floatingSettings?.dispose();
    removeTrayIpc();
    removeOverlayIpc();
    try {
      nativeTray?.dispose();
    } finally {
      presentation?.dispose();
    }
  });
}
