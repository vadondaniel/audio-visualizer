const { EventEmitter } = require("node:events");
jest.mock("node:fs", () => ({
  readFileSync: jest.fn(() => {
    throw Error("First run");
  }),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));
const fs = require("node:fs");
const TrayController = require("../src/tray-controller");
const { create, clampBounds, validBounds } = require("../src/mini-overlay");

function setup({ trayFails = false, saved } = {}) {
  jest.clearAllMocks();
  fs.readFileSync.mockImplementation(() => {
    if (!saved) throw Error("First run");
    return JSON.stringify(saved);
  });
  const windows = [];
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const workArea = { ...area, height: 1040 };
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => [{ bounds: area, workArea }],
    getPrimaryDisplay: () => ({ bounds: area, workArea }),
    getDisplayMatching: () => ({ bounds: area, workArea }),
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      const { x, y, width, height } = options;
      this.bounds = { x, y, width, height };
      this.fullscreen = false;
      this.children = new Set();
      this.dead = false;
      this.contentView = {
        addChildView: (view) => this.children.add(view),
        removeChildView: (view) => this.children.delete(view),
      };
      for (const name of [
        "show",
        "hide",
        "focus",
        "restore",
        "setAlwaysOnTop",
        "setIgnoreMouseEvents",
      ])
        this[name] = jest.fn();
      windows.push(this);
    }
    isDestroyed() {
      return this.dead;
    }
    getBounds() {
      return this.bounds;
    }
    setBounds(value) {
      this.bounds = value;
      this.emit("resize");
    }
    getContentSize() {
      return [this.bounds.width, this.bounds.height];
    }
    isFullScreen() {
      return this.fullscreen;
    }
    setFullScreen(value) {
      this.fullscreen = value;
    }
    isMinimized() {
      return false;
    }
    destroy() {
      this.dead = true;
    }
  }
  const contents = {
    send: jest.fn(),
    focus: jest.fn(),
    close: jest.fn(),
    isDestroyed: () => false,
  };
  const view = {
    webContents: contents,
    setBackgroundColor: jest.fn(),
    setBounds: jest.fn(),
  };
  const tray = Object.assign(new EventEmitter(), {
    setToolTip: jest.fn(),
    setContextMenu: jest.fn(),
    destroy: jest.fn(),
    isDestroyed: () => false,
  });
  const dialog = { showMessageBox: jest.fn(async () => ({ response: 0 })) };
  const quit = jest.fn();
  let controller;
  const nativeTray = TrayController.create({
    Tray: class {
      constructor() {
        if (trayFails) throw Error("No tray");
        return tray;
      }
    },
    Menu: { buildFromTemplate: (value) => value },
    icon: "icon.png",
    onSelect: (selection) => contents.send("tray-select", selection),
    onUnlock: () => controller.unlock(),
    onReturn: () => controller.restore(),
    onQuit: quit,
  });
  controller = create({
    electron: {
      BaseWindow: Window,
      WebContentsView: class {
        constructor() {
          return view;
        }
      },
      screen,
      dialog,
    },
    preload: "preload.js",
    icon: "icon.png",
    packaged: true,
    preferencesPath: "owned/overlay.json",
    onQuit: quit,
    ensureTray: nativeTray.ensure,
    isTrayAvailable: nativeTray.isAvailable,
    onPresentationChange: nativeTray.setPresentation,
  });
  return {
    nativeTray,
    controller,
    windows,
    contents,
    view,
    tray,
    dialog,
    quit,
    screen,
    area,
  };
}

test("bounds reject malformed input and clamp dimensions and placement", () => {
  expect(validBounds({ x: NaN, y: 0, width: 320, height: 320 })).toBe(false);
  expect(validBounds({ x: 1, y: 2, width: "320", height: 320 })).toBe(false);
  expect(
    clampBounds(
      { x: 9999, y: -100, width: 10, height: 9999 },
      { x: -100, y: 30, width: 800, height: 600 }
    )
  ).toEqual({ x: 540, y: 30, width: 160, height: 600 });
});

test("placement may overlap the taskbar and restores there without being pushed into the work area", () => {
  const f = setup();
  f.controller.enter();
  expect(f.windows[1].setAlwaysOnTop).toHaveBeenCalledWith(true, "pop-up-menu");
  f.controller.setBounds({ x: 100, y: 900, width: 200, height: 180 });
  expect(f.controller.getBounds()).toEqual({
    x: 100,
    y: 900,
    width: 200,
    height: 180,
  });
  const restored = setup({ saved: f.controller.getBounds() });
  restored.controller.enter();
  expect(restored.controller.getBounds()).toEqual({
    x: 100,
    y: 900,
    width: 200,
    height: 180,
  });
});

test("snapped resizing preserves the selected ratio when constrained by the display", () => {
  const f = setup();
  f.controller.enter();
  f.controller.setBounds({
    x: 0,
    y: 0,
    width: 10000,
    height: 10000,
    aspectRatio: 16 / 9,
  });
  expect(f.controller.getBounds()).toEqual({
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  f.controller.setBounds({
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    aspectRatio: 9 / 16,
  });
  const size = f.controller.getBounds();
  expect(size.width).toBe(160);
  expect(Math.abs((size.height * 9) / 16 - size.width)).toBeLessThan(1);
});
test("switching reparents the same renderer without closing it and restores fullscreen", () => {
  const f = setup();
  f.windows[0].fullscreen = true;
  expect(f.controller.snapshot().active).toBe(false);
  for (let i = 0; i < 5; i++) {
    expect(f.controller.enter().active).toBe(true);
    expect(f.windows[1].children.has(f.view)).toBe(true);
    expect(f.windows[0].children.size).toBe(0);
    expect(f.windows[0].fullscreen).toBe(false);
    f.controller.restore(true);
    expect(f.windows[0].children.has(f.view)).toBe(true);
    expect(f.windows[0].fullscreen).toBe(true);
  }
  expect(f.windows).toHaveLength(2);
  expect(f.contents.close).not.toHaveBeenCalled();
});
test("lock cancellation leaves input enabled; confirmation completes before click-through", async () => {
  const f = setup();
  f.controller.enter();
  await f.controller.lock();
  expect(f.controller.snapshot().locked).toBe(false);
  expect(f.windows[1].setIgnoreMouseEvents).not.toHaveBeenCalledWith(true);
  let resolve;
  f.dialog.showMessageBox.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = f.controller.lock();
  expect(f.windows[1].setIgnoreMouseEvents).not.toHaveBeenCalledWith(true);
  resolve({ response: 1 });
  await pending;
  expect(f.windows[1].setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  expect(f.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({
    defaultId: 0,
    cancelId: 0,
    buttons: ["Cancel", "Lock"],
  });
  const menu = f.tray.setContextMenu.mock.calls.at(-1)[0];
  menu.find((item) => item.label === "Unlock mini overlay").click();
  expect(f.controller.snapshot()).toMatchObject({
    active: true,
    locked: false,
  });
  expect(f.windows[1].setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
});

test("tray choices reflect enabled order and selection without unlocking or restoring", async () => {
  const f = setup();
  const settings = {
    modes: [
      { id: "prism", label: "Prism" },
      { id: "bars", label: "Bars" },
    ],
    themes: [
      { id: "Ice", label: "Ice" },
      { id: "Neon", label: "Neon" },
    ],
    mode: "bars",
    theme: "Ice",
  };
  f.nativeTray.setChoices(settings);
  expect(f.controller.contents.send).not.toHaveBeenCalled();
  f.controller.enter();
  f.dialog.showMessageBox.mockResolvedValue({ response: 1 });
  await f.controller.lock();
  const menu = () => f.tray.setContextMenu.mock.calls.at(-1)[0];
  const modes = menu().find((item) => item.label === "Visual mode").submenu;
  expect(modes.map((item) => [item.label, item.checked])).toEqual([
    ["Prism", false],
    ["Bars", true],
  ]);
  modes[0].click();
  expect(f.controller.contents.send).toHaveBeenLastCalledWith("tray-select", {
    kind: "mode",
    id: "prism",
  });
  menu()
    .find((item) => item.label === "Color theme")
    .submenu[1].click();
  expect(f.controller.contents.send).toHaveBeenLastCalledWith("tray-select", {
    kind: "theme",
    id: "Neon",
  });
  expect(f.controller.snapshot()).toMatchObject({ active: true, locked: true });
  const calls = f.tray.setContextMenu.mock.calls.length;
  f.nativeTray.setChoices({ ...settings, mode: "unknown" });
  f.nativeTray.setChoices({ ...settings, themes: null });
  expect(f.tray.setContextMenu).toHaveBeenCalledTimes(calls);
});
test("restoring during a pending confirmation cannot lock the normal window", async () => {
  const f = setup();
  f.controller.enter();
  let resolve;
  f.dialog.showMessageBox.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = f.controller.lock();
  f.controller.restore();
  resolve({ response: 1 });
  await pending;
  expect(f.controller.snapshot().locked).toBe(false);
});
test("tray failure disables locking while retaining a return path", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const f = setup({ trayFails: true });
  expect(f.controller.enter().canLock).toBe(false);
  await f.controller.lock();
  expect(f.dialog.showMessageBox).not.toHaveBeenCalled();
  expect(f.controller.restore().active).toBe(false);
  warn.mockRestore();
});

test("losing tray availability during confirmation cannot enable click-through", async () => {
  const f = setup();
  f.controller.enter();
  let resolve;
  f.dialog.showMessageBox.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const pending = f.controller.lock();
  f.nativeTray.dispose();
  resolve({ response: 1 });
  await pending;
  expect(f.controller.snapshot()).toMatchObject({
    active: true,
    locked: false,
    canLock: false,
  });
  expect(f.windows[1].setIgnoreMouseEvents).not.toHaveBeenCalledWith(true);
});
test("preferences restore only bounds, sanitize monitor changes, and ignore locked resize", async () => {
  const f = setup({
    saved: { x: 10000, y: -500, width: 250, height: 300, locked: true },
  });
  f.controller.enter();
  expect(f.controller.snapshot().locked).toBe(false);
  expect(f.controller.getBounds()).toMatchObject({
    x: 1670,
    y: 0,
    width: 250,
    height: 300,
  });
  f.controller.setBounds({ x: 100, y: 100, width: 400, height: 200 });
  expect(JSON.parse(fs.writeFileSync.mock.calls.at(-1)[1])).toEqual({
    x: 100,
    y: 100,
    width: 400,
    height: 200,
  });
  f.area.width = 300;
  f.screen.emit("display-removed");
  expect(f.controller.getBounds().width).toBe(300);
  f.dialog.showMessageBox.mockResolvedValue({ response: 1 });
  await f.controller.lock();
  const previous = f.controller.getBounds();
  f.controller.setBounds({ x: 0, y: 0, width: 160, height: 160 });
  expect(f.controller.getBounds()).toEqual(previous);
});
test("tray return and double-click unlock and restore; disposal closes all owned resources once", async () => {
  const f = setup();
  f.controller.enter();
  f.dialog.showMessageBox.mockResolvedValue({ response: 1 });
  await f.controller.lock();
  f.tray.emit("double-click");
  expect(f.controller.snapshot().active).toBe(false);
  f.nativeTray.dispose();
  f.controller.dispose();
  f.nativeTray.dispose();
  f.controller.dispose();
  expect(f.contents.close).toHaveBeenCalledTimes(1);
  expect(f.tray.destroy).toHaveBeenCalledTimes(1);
  expect(f.windows.every((window) => window.dead)).toBe(true);
  expect(f.screen.listenerCount("display-removed")).toBe(0);
});

test("overlay creation failure returns to the normal renderer with a visible error", () => {
  const f = setup();
  const original = f.windows[0].contentView.removeChildView;
  let first = true;
  f.windows[0].contentView.removeChildView = (view) => {
    if (first) {
      first = false;
      throw Error("Attachment failed");
    }
    original(view);
  };
  const result = f.controller.enter();
  expect(result.active).toBe(false);
  expect(result.error).toContain("Attachment failed");
  expect(f.windows[0].children.has(f.view)).toBe(true);
  expect(f.windows[0].show).toHaveBeenCalled();
});

test("IPC restricts presentation commands and bounds to the owned renderer and capture", async () => {
  const { registerIpc } = require("../src/mini-overlay");
  const f = setup();
  const handlers = {};
  const ipc = Object.assign(new EventEmitter(), {
    handle: (key, value) => {
      handlers[key] = value;
    },
    removeHandler: (key) => {
      delete handlers[key];
    },
  });
  const canEnter = jest.fn(async () => false);
  const remove = registerIpc(ipc, () => f.controller, canEnter);
  const owned = { sender: f.contents },
    stranger = { sender: {} };
  await handlers["overlay-enter"](stranger);
  expect(canEnter).not.toHaveBeenCalled();
  await handlers["overlay-enter"](owned);
  expect(f.controller.snapshot().active).toBe(false);
  canEnter.mockResolvedValue(true);
  await handlers["overlay-enter"](owned);
  expect(f.controller.snapshot().active).toBe(true);
  const previous = f.controller.getBounds();
  ipc.emit("overlay-set-bounds", stranger, {
    x: 1,
    y: 1,
    width: 160,
    height: 160,
  });
  ipc.emit("overlay-set-bounds", owned, {
    x: Infinity,
    y: 1,
    width: 160,
    height: 160,
  });
  expect(f.controller.getBounds()).toEqual(previous);
  remove();
  expect(Object.keys(handlers)).toHaveLength(0);
  expect(ipc.listenerCount("overlay-set-bounds")).toBe(0);
});
