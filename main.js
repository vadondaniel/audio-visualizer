const {
  app,
  BrowserWindow,
  session,
  desktopCapturer,
  ipcMain,
  screen,
} = require("electron");
const path = require("path");
const IPC = require("./ipc-channels");
const { toggleAlwaysOnTop } = require("./window-state");
const { spawn } = require("child_process");

let mainWindow;
let mediaWatcher = null;
let mediaWatcherBuffer = "";

function stopMediaWatcher() {
  if (!mediaWatcher) return;
  try {
    mediaWatcher.kill();
  } catch {}
  mediaWatcher = null;
  mediaWatcherBuffer = "";
}

function startMediaWatcher() {
  if (process.platform !== "win32" || mediaWatcher) return;

  stopMediaWatcher();
  const watcherPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "media-watcher.ps1")
    : path.join(__dirname, "media-watcher.ps1");
  mediaWatcher = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      watcherPath,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  );

  mediaWatcher.stdout.setEncoding("utf8");
  mediaWatcher.stdout.on("data", (chunk) => {
    mediaWatcherBuffer += chunk;
    const lines = mediaWatcherBuffer.split(/\r?\n/);
    mediaWatcherBuffer = lines.pop() || "";
    for (const line of lines) {
      const text = line.trim();
      if (!text || !mainWindow || mainWindow.isDestroyed()) continue;
      try {
        mainWindow.webContents.send(IPC.MEDIA_METADATA, JSON.parse(text));
      } catch {}
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

function createWindow() {
  const displays = screen.getAllDisplays();
  // If there's a second monitor, open the window there by default.
  const target = displays.length > 1 ? displays[1] : displays[0];

  mainWindow = new BrowserWindow({
    x: target.bounds.x + 40,
    y: target.bounds.y + 40,
    width: 1280,
    height: 720,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Electron defaults this to true since v20. Sandboxed preload scripts
      // only get a small allowlist of require()-able built-ins — a local
      // relative-path module like "./ipc-channels" isn't one of them, so it
      // silently fails, contextBridge.exposeInMainWorld never runs, and
      // window.electronAPI ends up undefined in the renderer (breaking
      // fullscreen/always-on-top/quit with no visible error). contextIsolation
      // + nodeIntegration:false already give the renderer proper isolation,
      // so turning sandbox off here doesn't weaken that — it just lets the
      // preload script's own require() calls resolve normally.
      sandbox: false,
    },
  });

  mainWindow.loadFile("index.html");

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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on(IPC.TOGGLE_FULLSCREEN, () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

ipcMain.on(IPC.TOGGLE_ALWAYS_ON_TOP, () => {
  if (!mainWindow) return;
  toggleAlwaysOnTop(mainWindow);
});

ipcMain.on(IPC.QUIT_APP, () => {
  app.quit();
});

ipcMain.handle(IPC.GET_PERFORMANCE_METRICS, () => app.getAppMetrics());

ipcMain.on(IPC.SET_MEDIA_METADATA_ENABLED, (_event, enabled) => {
  if (enabled) startMediaWatcher();
  else stopMediaWatcher();
});

app.on("before-quit", stopMediaWatcher);
