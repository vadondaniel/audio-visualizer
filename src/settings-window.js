const IPC = require("./ipc-channels");
const Protocol = require("./settings-protocol");
const math = require("./audio-math");
const registry = require("./mode-registry");
/** @typedef {import('electron').BrowserWindow} SettingsWindow */
/** @typedef {import('./settings-protocol').Reply} Reply */
/** @typedef {{createWindow:(options:import('electron').BrowserWindowConstructorOptions)=>SettingsWindow,present:(window:SettingsWindow)=>void,ipc:import('electron').IpcMain,screen:Pick<import('electron').Screen,'getDisplayMatching'>,getOwner:()=>import('electron').WebContents|undefined,waitForOwner:()=>Promise<unknown>,getOverlay:()=>import('electron').BaseWindow|null,isActive:()=>boolean,htmlPath:string,preload:string,reportError:(message:string)=>void}} Dependencies */

/** Fully on-screen placement is deliberately separate from overlay overhang.
 * @param {import('./mini-overlay').Bounds|null} saved @param {import('./mini-overlay').Bounds} anchor @param {import('./mini-overlay').Bounds} area */
function placement(saved, anchor, area) {
  const width = Math.min(area.width, Math.max(360, saved?.width || 400));
  const height = Math.min(area.height, Math.max(440, saved?.height || 720));
  const preferred = anchor.x - width - 12;
  return {
    width,
    height,
    x: Math.round(
      Math.max(
        area.x,
        Math.min(
          area.x + area.width - width,
          saved?.x ??
            (preferred >= area.x ? preferred : anchor.x + anchor.width + 12)
        )
      )
    ),
    y: Math.round(
      Math.max(
        area.y,
        Math.min(area.y + area.height - height, saved?.y ?? anchor.y)
      )
    ),
  };
}
/** @param {Dependencies} deps */
function create(deps) {
  const { ipc } = deps;
  /** @type {SettingsWindow|null} */ let window = null;
  /** @type {Promise<void>|null} */ let opening = null;
  /** @type {import('./mini-overlay').Bounds|null} */ let saved = null;
  /** @type {import('./settings-protocol').Snapshot|null} */ let initial = null;
  let disposed = false,
    generation = 0,
    sequence = 0;
  /** @type {Map<number,{resolve:(reply:Reply)=>void,reject:(error:Error)=>void,timer:ReturnType<typeof setTimeout>}>} */ const pending =
    new Map();
  /** @type {(()=>void)|null} */ let clientReady = null;
  /** @type {Array<()=>void>} */ const releases = [];
  /** @param {unknown} error */ const message = (error) =>
    error instanceof Error ? error.message : String(error);
  /** @type {((reason:Error)=>void)|null} */ let cancelOpening = null;
  function cancel() {
    cancelOpening?.(Error("Settings window closed"));
    cancelOpening = null;
    generation++;
    initial = null;
    clientReady = null;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(Error("Settings window closed"));
    }
    pending.clear();
  }
  function close() {
    const target = window;
    if (target && !target.isDestroyed()) {
      saved = target.getBounds();
      window = null;
      target.destroy();
    }
    cancel();
  }
  /** @param {'snapshot'|'command'|'diagnostics'} operation @param {import('./settings-protocol').Command} [command] @param {import('./settings-protocol').DiagnosticOperation} [diagnostic] */
  function request(operation, command, diagnostic) {
    const owner = deps.getOwner();
    if (
      disposed ||
      !window ||
      window.isDestroyed() ||
      !owner ||
      owner.isDestroyed()
    )
      return Promise.reject(Error("Settings owner unavailable"));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Settings ${operation} timed out`));
      }, 5000);
      pending.set(id, {
        resolve: (reply) =>
          reply.ok ? resolve(reply.value) : reject(Error(reply.error)),
        reject,
        timer,
      });
      try {
        owner.send(IPC.SETTINGS_REQUEST, {
          id,
          operation,
          command,
          diagnostic,
        });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }
  function owned(event) {
    return (
      !disposed &&
      !!window &&
      !window.isDestroyed() &&
      event.sender === window.webContents
    );
  }
  function requireClient(event) {
    if (!owned(event)) throw Error("Unauthorized settings sender");
  }
  /** @param {import('electron').IpcMainEvent} event @param {Reply} reply */
  function reply(event, reply) {
    if (
      disposed ||
      event.sender !== deps.getOwner() ||
      !reply ||
      !Number.isSafeInteger(reply.id)
    )
      return;
    const task = pending.get(reply.id);
    if (!task) return;
    pending.delete(reply.id);
    clearTimeout(task.timer);
    task.resolve(reply);
  }
  /** @param {import('electron').IpcMainEvent} event @param {import('./settings-protocol').Patch} patch */
  function publish(event, patch) {
    if (
      disposed ||
      event.sender !== deps.getOwner() ||
      !Protocol.isPatch(patch) ||
      !window ||
      window.isDestroyed()
    )
      return;
    window.webContents.send(IPC.SETTINGS_PATCH, patch);
  }
  const handlers = {
    [IPC.SETTINGS_OPEN]: async (event) => {
      if (disposed || event.sender !== deps.getOwner())
        throw Error("Unauthorized settings owner");
      await open();
    },
    [IPC.SETTINGS_READ]: async (event) => {
      requireClient(event);
      const result = await request("snapshot");
      if (!result || !("values" in result))
        throw Error("Invalid settings snapshot");
      initial = result;
      return result;
    },
    [IPC.SETTINGS_COMMAND]: async (event, command) => {
      requireClient(event);
      if (
        !initial ||
        !Protocol.validCommand(
          command,
          math,
          registry,
          initial.values.themeOrder
        )
      )
        throw Error("Invalid settings command");
      return request("command", command);
    },
    [IPC.SETTINGS_DIAGNOSTICS]: async (event, operation) => {
      requireClient(event);
      if (
        !initial ||
        initial.packaged ||
        !["snapshot", "report", "reset", "profile", "copy-profile"].includes(
          operation
        )
      )
        throw Error("Diagnostics unavailable");
      return request("diagnostics", undefined, operation);
    },
    [IPC.SETTINGS_CLIENT_READY]: async (event) => {
      requireClient(event);
      if (!initial) throw Error("Settings not synchronized");
      clientReady?.();
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipc.handle(channel, handler);
    releases.push(() => ipc.removeHandler(channel));
  }
  const closeRequest = (event) => {
    if (owned(event)) close();
  };
  ipc.on(IPC.SETTINGS_CLOSE, closeRequest);
  ipc.on(IPC.SETTINGS_REPLY, reply);
  ipc.on(IPC.SETTINGS_PATCH, publish);
  releases.push(
    () => ipc.removeListener(IPC.SETTINGS_CLOSE, closeRequest),
    () => ipc.removeListener(IPC.SETTINGS_REPLY, reply),
    () => ipc.removeListener(IPC.SETTINGS_PATCH, publish)
  );
  async function open() {
    if (disposed || !deps.isActive()) return;
    if (opening) {
      await opening;
      if (window && !window.isDestroyed() && !disposed) deps.present(window);
      return;
    }
    if (window && !window.isDestroyed()) {
      deps.present(window);
      return;
    }
    const token = ++generation;
    const cancelled = new Promise((_, reject) => {
      cancelOpening = reject;
    });
    void cancelled.catch(() => {});
    opening = (async () => {
      let readyTimer;
      try {
        await Promise.race([
          deps.waitForOwner(),
          cancelled,
          new Promise((_, reject) => {
            readyTimer = setTimeout(
              () => reject(Error("Settings owner not ready")),
              5000
            );
          }),
        ]);
        clearTimeout(readyTimer);
        if (disposed || token !== generation || !deps.isActive()) return;
        const parent = deps.getOverlay();
        if (!parent || parent.isDestroyed())
          throw Error("Mini overlay unavailable");
        const bounds = placement(
          saved,
          parent.getBounds(),
          deps.screen.getDisplayMatching(saved || parent.getBounds()).workArea
        );
        const target = deps.createWindow({
          ...bounds,
          useContentSize: !saved,
          minWidth: Math.min(360, bounds.width),
          minHeight: Math.min(440, bounds.height),
          show: false,
          frame: false,
          autoHideMenuBar: true,
          backgroundColor: "#101014",
          parent,
          modal: false,
          skipTaskbar: true,
          title: "Settings — Audio Visualizer",
          minimizable: false,
          maximizable: false,
          resizable: true,
          webPreferences: {
            preload: deps.preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
          },
        });
        window = target;
        target.setMenu(null);
        // Keep restored/native bounds within the current display work area.
        const area = deps.screen.getDisplayMatching(
          saved || parent.getBounds()
        ).workArea;
        target.setBounds(
          placement(target.getBounds(), parent.getBounds(), area)
        );
        target.setAlwaysOnTop(true, "pop-up-menu");
        function constrain() {
          if (target.isDestroyed() || window !== target) return;
          const current = target.getBounds(),
            area = deps.screen.getDisplayMatching(current).workArea;
          target.setMaximumSize(area.width, area.height);
          const next = placement(current, current, area);
          if (
            current.x !== next.x ||
            current.y !== next.y ||
            current.width !== next.width ||
            current.height !== next.height
          )
            target.setBounds(next);
        }
        constrain();
        target.on("moved", constrain);
        target.on("resized", constrain);
        target.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        target.webContents.on("will-navigate", (event) =>
          event.preventDefault()
        );
        target.on("closed", () => {
          if (window === target) {
            window = null;
            cancel();
          }
        });
        target.on("close", () => {
          if (!target.isDestroyed()) saved = target.getBounds();
        });
        const ready = new Promise((resolve, reject) => {
          clientReady = () => resolve(undefined);
          readyTimer = setTimeout(
            () => reject(Error("Settings UI did not initialize")),
            5000
          );
        });
        // Consume readiness rejection even if loadFile itself fails first.
        void ready.catch(() => {});
        await Promise.race([target.loadFile(deps.htmlPath), cancelled]);
        await Promise.race([ready, cancelled]);
        clearTimeout(readyTimer);
        if (
          !disposed &&
          token === generation &&
          window === target &&
          !target.isDestroyed()
        )
          deps.present(target);
      } catch (error) {
        clearTimeout(readyTimer);
        if (!disposed && token === generation) {
          close();
          deps.reportError(`Could not open settings: ${message(error)}`);
          throw error;
        }
      }
    })();
    try {
      await opening;
    } finally {
      opening = null;
      cancelOpening = null;
    }
  }
  const owner = deps.getOwner();
  if (owner) {
    owner.on("did-start-loading", close);
    owner.on("destroyed", close);
    releases.push(
      () => owner.removeListener("did-start-loading", close),
      () => owner.removeListener("destroyed", close)
    );
  }
  return {
    open,
    close,
    /** @param {import('./mini-overlay').Presentation} presentation */
    presentationChanged(presentation) {
      if (!presentation.active) close();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      for (const release of releases.splice(0)) release();
    },
    getWindow: () => window,
  };
}
module.exports = { create, placement };
