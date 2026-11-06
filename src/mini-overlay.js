const fs = require("node:fs");
const path = require("node:path");
const IPC = require("./ipc-channels");
const { ASPECT_RATIOS, fitSize } = require("./mini-overlay-math");

/** @typedef {{x:number,y:number,width:number,height:number}} Bounds */
/** @typedef {Bounds & {aspectRatio?:number}} BoundsRequest */
/** @typedef {{active:boolean,locked:boolean,canLock:boolean,openSettings:boolean,error:string|null}} Presentation */

/** @param {Bounds} bounds @param {Bounds} area @returns {Bounds} */
function clampBounds(bounds, area) {
  const dimension = (value, limit) =>
    Math.round(Math.min(limit, Math.max(Math.min(160, limit), value)));
  const width = dimension(bounds.width, area.width);
  const height = dimension(bounds.height, area.height);
  return {
    width,
    height,
    x: Math.round(
      Math.max(area.x, Math.min(area.x + area.width - width, bounds.x))
    ),
    y: Math.round(
      Math.max(area.y, Math.min(area.y + area.height - height, bounds.y))
    ),
  };
}
/** @param {unknown} value @returns {value is Bounds} */
function validBounds(value) {
  return (
    !!value &&
    typeof value === "object" &&
    ["x", "y", "width", "height"].every(
      (key) =>
        typeof value[key] === "number" &&
        Number.isFinite(value[key]) &&
        Math.abs(value[key]) <= 1000000
    )
  );
}

/** One renderer, two native hosts. Only the main process can move or lock them.
 * @param {{electron:typeof import('electron'),preload:string,icon:string,packaged:boolean,preferencesPath:string,onQuit:()=>void,ensureTray:()=>boolean,isTrayAvailable:()=>boolean,onPresentationChange:(presentation:Presentation)=>void}} options */
function create({
  electron,
  preload,
  icon,
  packaged,
  preferencesPath,
  onQuit,
  ensureTray,
  isTrayAvailable,
  onPresentationChange,
}) {
  const { BaseWindow, WebContentsView, screen, dialog } = electron;
  const displays = screen.getAllDisplays();
  const target = displays.length > 1 ? displays[1] : displays[0];
  const normal = new BaseWindow({
    x: target.bounds.x + 40,
    y: target.bounds.y + 40,
    width: 1280,
    height: 720,
    title: "Audio Visualizer",
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    icon,
    show: false,
  });
  const view = new WebContentsView({
    webPreferences: {
      preload,
      additionalArguments: [
        `--app-packaged=${packaged}`,
        "--mini-overlay-supported",
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor("#00000000");
  const contents = view.webContents;
  /** @type {import('electron').BaseWindow|null} */
  let overlay = null;
  /** @type {Bounds|null} */
  let saved = null;
  let active = false,
    locked = false,
    disposed = false,
    confirming = false;
  let transition = 0;
  let restoreFullscreen = false;
  try {
    const value = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
    if (validBounds(value)) saved = value;
  } catch {
    /* First run or invalid preferences use the default corner. */
  }

  /** @param {boolean} [openSettings] @param {string|null} [error] @returns {Presentation} */
  function snapshot(openSettings = false, error = null) {
    return { active, locked, canLock: isTrayAvailable(), openSettings, error };
  }
  /** @param {boolean} [openSettings] @param {string|null} [error] */
  function publish(openSettings = false, error = null) {
    const result = snapshot(openSettings, error);
    if (!contents.isDestroyed()) contents.send(IPC.OVERLAY_STATE, result);
    onPresentationChange(result);
    return result;
  }
  function fit() {
    const host = active ? overlay : normal;
    if (!host || host.isDestroyed()) return;
    const [width, height] = host.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });
  }
  function persist() {
    if (!overlay || overlay.isDestroyed()) return;
    saved = overlay.getBounds();
    try {
      fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
      fs.writeFileSync(preferencesPath, JSON.stringify(saved));
    } catch (error) {
      console.warn("Could not save mini overlay position", error);
    }
  }
  function attach(host) {
    normal.contentView.removeChildView(view);
    overlay?.contentView.removeChildView(view);
    host.contentView.addChildView(view);
    fit();
  }
  function unlock() {
    locked = false;
    if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(false);
    return publish();
  }
  function restore(openSettings = false) {
    if (disposed) return snapshot();
    unlock();
    if (active) {
      transition++;
      persist();
      active = false;
      attach(normal);
      overlay?.hide();
      normal.setFullScreen(restoreFullscreen);
    }
    if (normal.isMinimized()) normal.restore();
    normal.show();
    normal.focus();
    contents.focus();
    return publish(openSettings);
  }
  function enter() {
    if (active || disposed) return snapshot();
    try {
      if (!overlay) {
        const area = screen.getDisplayMatching(normal.getBounds()).workArea;
        const bounds = clampBounds(
          saved || {
            width: 320,
            height: 320,
            x: area.x + area.width - 344,
            y: area.y + area.height - 344,
          },
          saved
            ? screen.getDisplayMatching(saved).bounds
            : screen.getDisplayMatching(normal.getBounds()).bounds
        );
        overlay = new BaseWindow({
          ...bounds,
          frame: false,
          title: "Audio Visualizer — Mini overlay",
          transparent: true,
          backgroundColor: "#00000000",
          resizable: false,
          maximizable: false,
          minimizable: false,
          hasShadow: false,
          show: false,
          skipTaskbar: true,
          icon,
        });
        // Unlike "floating", this level can remain above the Windows taskbar.
        overlay.setAlwaysOnTop(true, "pop-up-menu");
        overlay.on("resize", () => {
          fit();
          if (active) persist();
        });
        overlay.on("resized", fit);
        overlay.on("move", () => {
          if (active) persist();
        });
        overlay.on("close", (event) => {
          if (!disposed) {
            event.preventDefault();
            restore();
          }
        });
      }
      ensureTray();
      restoreFullscreen = normal.isFullScreen();
      normal.setFullScreen(false);
      active = true;
      transition++;
      attach(overlay);
      normal.hide();
      overlay.show();
      contents.focus();
      return publish();
    } catch (error) {
      restore();
      return publish(
        false,
        `Could not open mini overlay: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  async function lock() {
    if (!active || !isTrayAvailable() || !overlay || confirming || locked)
      return snapshot();
    confirming = true;
    const started = transition;
    try {
      const result = await dialog.showMessageBox(overlay, {
        type: "question",
        title: "Lock mini overlay?",
        message: "Lock mini overlay?",
        detail:
          "The overlay will stop responding to mouse clicks. You can unlock it from the Audio Visualizer tray icon.",
        buttons: ["Cancel", "Lock"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (
        result.response === 1 &&
        active &&
        !disposed &&
        isTrayAvailable() &&
        started === transition
      ) {
        locked = true;
        publish();
        // The modal has resolved and closed before native click-through begins.
        overlay.setIgnoreMouseEvents(true);
      }
    } finally {
      confirming = false;
    }
    return publish();
  }
  /** @param {BoundsRequest} value */
  function setBounds(value) {
    if (!active || locked || !overlay || !validBounds(value)) return;
    const area = screen.getDisplayMatching(value).bounds;
    const ratio = value.aspectRatio;
    const size =
      typeof ratio === "number" && ASPECT_RATIOS.includes(ratio)
        ? fitSize(value.width, value.height, ratio, area.width, area.height)
        : { width: value.width, height: value.height };
    overlay.setBounds(clampBounds({ ...value, ...size }, area));
    fit();
    persist();
  }
  function recoverDisplay() {
    if (!overlay || !saved) return;
    const area = screen.getDisplayMatching(saved).bounds;
    overlay.setBounds(clampBounds(saved, area));
    persist();
  }
  function dispose() {
    if (disposed) return;
    persist();
    disposed = true;
    screen.removeListener("display-removed", recoverDisplay);
    screen.removeListener("display-metrics-changed", recoverDisplay);
    if (!contents.isDestroyed()) contents.close();
    overlay?.destroy();
    if (!normal.isDestroyed()) normal.destroy();
  }
  normal.contentView.addChildView(view);
  fit();
  normal.on("resize", fit);
  normal.on("resized", fit);
  normal.on("close", (event) => {
    if (!disposed) {
      event.preventDefault();
      onQuit();
    }
  });
  screen.on("display-removed", recoverDisplay);
  screen.on("display-metrics-changed", recoverDisplay);
  normal.show();
  return {
    normal,
    view,
    contents,
    enter,
    restore,
    lock,
    unlock,
    setBounds,
    getBounds: () => overlay?.getBounds() || null,
    snapshot,
    dispose,
  };
}
/** @param {import('electron').IpcMain} ipcMain
 * @param {()=>ReturnType<typeof create>|undefined} getController
 * @param {()=>Promise<boolean>} canEnter */
function registerIpc(ipcMain, getController, canEnter) {
  const owned = (event) => event.sender === getController()?.contents;
  const handlers = {
    [IPC.OVERLAY_ENTER]: async (event) => {
      const controller = getController();
      if (!controller || !owned(event)) return;
      return (await canEnter()) ? controller.enter() : controller.snapshot();
    },
    [IPC.OVERLAY_RESTORE]: (event, settings) =>
      owned(event) ? getController()?.restore(settings === true) : undefined,
    [IPC.OVERLAY_LOCK]: (event) =>
      owned(event) ? getController()?.lock() : undefined,
    [IPC.OVERLAY_GET_STATE]: (event) =>
      owned(event) ? getController()?.snapshot() : undefined,
    [IPC.OVERLAY_GET_BOUNDS]: (event) =>
      owned(event) ? getController()?.getBounds() : undefined,
  };
  for (const [channel, handler] of Object.entries(handlers))
    ipcMain.handle(channel, handler);
  const bounds = (event, value) => {
    if (owned(event)) getController()?.setBounds(value);
  };
  ipcMain.on(IPC.OVERLAY_SET_BOUNDS, bounds);
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel);
    ipcMain.removeListener(IPC.OVERLAY_SET_BOUNDS, bounds);
  };
}
module.exports = { create, clampBounds, validBounds, registerIpc };
