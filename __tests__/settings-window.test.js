const { EventEmitter } = require("node:events");
const { create, placement } = require("../src/settings-window");
const Protocol = require("../src/settings-protocol");
const registry = require("../src/mode-registry");
const math = require("../src/audio-math");
const Actions = require("../src/settings-actions");
const modeList = require("../src/mode-list");
const { setup: fixture } = require("./helpers/mode-fixture.cjs");
const IPC = require("../src/ipc-channels");

function setup({ loadFailure = false, ready = true } = {}) {
  const f = fixture("bars"),
    state = f.settings,
    keys = Object.keys(state).filter((key) => key !== "hueShift");
  const themes = f.constants.THEMES.map((theme) => theme.name);
  const ipc = new EventEmitter();
  ipc.handlers = new Map();
  ipc.handle = (key, fn) => ipc.handlers.set(key, fn);
  ipc.removeHandler = (key) => ipc.handlers.delete(key);
  const owner = new EventEmitter();
  owner.isDestroyed = () => false;
  let receive;
  const publish = jest.fn((patch) =>
    ipc.emit(IPC.SETTINGS_PATCH, { sender: owner }, patch)
  );
  const save = jest.fn();
  const effects = Object.fromEntries(
    [
      "modeOptions",
      "modeManager",
      "visualOptions",
      "theme",
      "themeOptions",
      "themeManager",
      "labels",
      "backgroundRows",
      "background",
      "fx",
      "trailRows",
      "bassRows",
      "resetTrails",
      "media",
      "wakeLock",
      "mediaWatching",
      "clearImageInput",
    ].map((name) => [name, jest.fn()])
  );
  effects.syncControls = (changed) => bridge.notify(changed);
  const timers = { setInterval: jest.fn(), clearInterval: jest.fn() };
  const actions = Actions.create({
    state,
    registry,
    modeList,
    themeIds: themes,
    save,
    effects,
    timers,
  });
  const bridge = Protocol.createOwner({
    state,
    keys,
    actions,
    math,
    registry,
    themes,
    effectiveMode: () =>
      state.miniOverlayMode === "follow"
        ? registry.ids[state.mode]
        : state.miniOverlayMode,
    isActive: () => true,
    packaged: false,
    api: {
      onRequest: (fn) => {
        receive = fn;
        return () => {
          receive = null;
        };
      },
      reply: (value) => ipc.emit(IPC.SETTINGS_REPLY, { sender: owner }, value),
      publish,
    },
    diagnostics: () => ({
      rows: [],
      profileActive: false,
      copyEnabled: false,
      clipboard: null,
    }),
  });
  bridge.start();
  owner.send = jest.fn((_channel, value) => receive?.(value));
  const windows = [],
    present = jest.fn(),
    reportError = jest.fn();
  const parent = {
    isDestroyed: () => false,
    getBounds: () => ({ x: 1500, y: 700, width: 320, height: 320 }),
  };
  let controller;
  const call = (key, sender, ...args) =>
    Promise.resolve().then(() => ipc.handlers.get(key)({ sender }, ...args));
  const makeWindow = (options) => {
    const win = new EventEmitter();
    win.options = options;
    win.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    };
    win.dead = false;
    win.webContents = new EventEmitter();
    win.webContents.send = jest.fn();
    win.webContents.setWindowOpenHandler = jest.fn();
    win.getBounds = () => ({ ...win.bounds });
    win.setBounds = (bounds) => {
      win.bounds = { ...bounds };
    };
    win.setAlwaysOnTop = jest.fn();
    win.setMenu = jest.fn();
    win.setMaximumSize = jest.fn();
    win.isDestroyed = () => win.dead;
    win.destroy = () => {
      win.dead = true;
      win.emit("closed");
    };
    win.loadFile = jest.fn(async () => {
      if (loadFailure) throw Error("missing UI");
      if (ready) {
        await call(IPC.SETTINGS_READ, win.webContents);
        await call(IPC.SETTINGS_CLIENT_READY, win.webContents);
      }
    });
    windows.push(win);
    return win;
  };
  controller = create({
    createWindow: makeWindow,
    present,
    ipc,
    screen: {
      getDisplayMatching: () => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      }),
    },
    getOwner: () => owner,
    waitForOwner: () => Promise.resolve(),
    getOverlay: () => parent,
    isActive: () => true,
    htmlPath: "settings.html",
    preload: "settings-preload.js",
    reportError,
  });
  return {
    controller,
    windows,
    present,
    reportError,
    ipc,
    owner,
    bridge,
    actions,
    state,
    save,
    effects,
    timers,
    publish,
    call,
    dispose() {
      controller.dispose();
      bridge.dispose();
      actions.dispose();
    },
  };
}
afterEach(() => jest.useRealTimers());

test("lazy singleton waits for initial sync; only explicit opens focus, and close preserves settings", async () => {
  const a = setup();
  expect(a.windows).toHaveLength(0);
  await a.controller.open();
  const win = a.windows[0];
  expect(win.options).toMatchObject({
    width: 400,
    height: 720,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    skipTaskbar: true,
    modal: false,
    parent: expect.any(Object),
  });
  expect(win.setMenu).toHaveBeenCalledWith(null);
  expect(a.present).toHaveBeenCalledTimes(1);
  expect(a.save).not.toHaveBeenCalled();
  await a.call(IPC.SETTINGS_COMMAND, win.webContents, {
    type: "set",
    key: "sensitivity",
    value: 1.8,
  });
  expect(a.state.sensitivity).toBe(1.8);
  expect(a.save).toHaveBeenCalledTimes(1);
  expect(a.effects.labels).toHaveBeenCalledTimes(1);
  expect(a.present).toHaveBeenCalledTimes(1);
  expect(win.webContents.send).toHaveBeenCalledWith(
    IPC.SETTINGS_PATCH,
    expect.objectContaining({ values: { sensitivity: 1.8 } })
  );
  await a.controller.open();
  expect(a.windows).toHaveLength(1);
  expect(a.present).toHaveBeenCalledTimes(2);
  win.bounds = { x: 20, y: 30, width: 510, height: 650 };
  a.controller.close();
  expect(a.state.sensitivity).toBe(1.8);
  await a.controller.open();
  expect(a.windows[1].bounds).toEqual({
    x: 20,
    y: 30,
    width: 510,
    height: 650,
  });
  a.dispose();
  expect(a.ipc.handlers.size).toBe(0);
  expect(a.ipc.eventNames()).toEqual([]);
  expect(a.owner.eventNames()).toEqual([]);
});
test("effective independent mode and media positions use the authoritative actions once", async () => {
  const a = setup();
  a.state.miniOverlayMode = "orbit";
  const normal = a.state.mode;
  await a.controller.open();
  const sender = a.windows[0].webContents;
  await a.call(IPC.SETTINGS_COMMAND, sender, { type: "mode", id: "radial" });
  await a.call(IPC.SETTINGS_COMMAND, sender, {
    type: "media-position",
    position: "above",
  });
  expect(a.state.mode).toBe(normal);
  expect(a.state.miniOverlayMode).toBe("radial");
  expect(a.state.mediaTextPositions.radial).toBe("above");
  expect(a.save).toHaveBeenCalledTimes(2);
  a.dispose();
});
test("separate sender ownership and command allowlist reject arbitrary writes and calls", async () => {
  const a = setup();
  await a.controller.open();
  const client = a.windows[0].webContents;
  await expect(a.call(IPC.SETTINGS_OPEN, client)).rejects.toThrow(
    "Unauthorized"
  );
  await expect(a.call(IPC.SETTINGS_READ, a.owner)).rejects.toThrow(
    "Unauthorized"
  );
  for (const command of [
    { type: "set", key: "hueShift", value: 1 },
    { type: "set", key: "sensitivity", value: "2" },
    { type: "set", key: "miniOverlayMaxFps", value: 45 },
    { type: "mode", id: "absent" },
    { type: "invoke", method: "dispose" },
    { type: "background", name: "x", dataUrl: "https://image" },
    { type: "mode-preferences", order: ["orbit"], disabled: [] },
  ])
    await expect(a.call(IPC.SETTINGS_COMMAND, client, command)).rejects.toThrow(
      "Invalid"
    );
  a.ipc.emit(
    IPC.SETTINGS_PATCH,
    { sender: client },
    { revision: 2, values: {}, effectiveMode: "orbit", packaged: false }
  );
  expect(client.send).not.toHaveBeenCalled();
  expect(a.save).not.toHaveBeenCalled();
  a.dispose();
});
test("load failure cleans up without restoring presentation and permits a later attempt", async () => {
  const a = setup({ loadFailure: true });
  await expect(a.controller.open()).rejects.toThrow("missing UI");
  expect(a.windows[0].dead).toBe(true);
  expect(a.present).not.toHaveBeenCalled();
  expect(a.reportError).toHaveBeenCalledTimes(1);
  expect(a.controller.getWindow()).toBeNull();
  await expect(a.controller.open()).rejects.toThrow("missing UI");
  expect(a.windows).toHaveLength(2);
  a.dispose();
});
test.each(["close", "reload", "dispose"])(
  "%s cancels initialization and late replies cannot reopen",
  async (how) => {
    jest.useFakeTimers();
    const a = setup({ ready: false });
    const opening = a.controller.open();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(a.windows).toHaveLength(1);
    const client = a.windows[0].webContents;
    if (how === "close") a.controller.close();
    else if (how === "reload") a.owner.emit("did-start-loading");
    else a.controller.dispose();
    await opening;
    await expect(a.call(IPC.SETTINGS_CLIENT_READY, client)).rejects.toThrow();
    expect(a.present).not.toHaveBeenCalled();
    expect(a.reportError).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    a.dispose();
  }
);
test("request timeout rejects, ignores forged/late replies, and releases pending timers", async () => {
  jest.useFakeTimers();
  const a = setup();
  await a.controller.open();
  a.owner.send.mockImplementation(() => {});
  const read = a.call(IPC.SETTINGS_READ, a.windows[0].webContents);
  const failure = expect(read).rejects.toThrow("timed out");
  await Promise.resolve();
  const request = a.owner.send.mock.calls.at(-1)[1];
  a.ipc.emit(
    IPC.SETTINGS_REPLY,
    { sender: {} },
    { id: request.id, ok: true, value: { revision: 999 } }
  );
  await jest.advanceTimersByTimeAsync(5000);
  await failure;
  expect(jest.getTimerCount()).toBe(0);
  a.controller.close();
  a.ipc.emit(
    IPC.SETTINGS_REPLY,
    { sender: a.owner },
    { id: request.id, ok: true, value: { revision: 999 } }
  );
  expect(a.present).toHaveBeenCalledTimes(1);
  a.dispose();
});
test("snapshots and affected patches omit image data and revisions are monotonic", async () => {
  const a = setup();
  a.state.bgImageDataUrl = "data:image/png;base64,xxx";
  await a.controller.open();
  const client = a.windows[0].webContents;
  const snapshot = await a.call(IPC.SETTINGS_READ, client);
  expect(snapshot.values.bgImageDataUrl).toBeNull();
  a.actions.set("glowIntensity", 1.5);
  a.actions.set("sensitivity", 1.2);
  const patches = a.publish.mock.calls.map(([patch]) => patch);
  expect(patches.map((p) => p.revision)).toEqual([1, 2]);
  expect(patches[1].values).toEqual({ sensitivity: 1.2 });
  a.dispose();
});
test("placement fits work areas, negative displays, removed monitors and small screens", () => {
  const area = { x: -1280, y: 0, width: 1280, height: 720 },
    anchor = { x: -100, y: 600, width: 320, height: 320 };
  expect(placement(null, anchor, area)).toEqual({
    x: -512,
    y: 0,
    width: 400,
    height: 720,
  });
  expect(
    placement({ x: 4000, y: 3000, width: 800, height: 900 }, anchor, area)
  ).toEqual({ x: -800, y: 0, width: 800, height: 720 });
  expect(
    placement(null, anchor, { x: 0, y: 0, width: 300, height: 300 })
  ).toEqual({ x: 0, y: 0, width: 300, height: 300 });
});

test("concurrent explicit opens create one window and returning to normal cancels it", async () => {
  const a = setup();
  await Promise.all([a.controller.open(), a.controller.open()]);
  expect(a.windows).toHaveLength(1);
  a.controller.presentationChanged({ active: true, locked: true });
  expect(a.windows[0].dead).toBe(false);
  a.controller.presentationChanged({ active: false, locked: false });
  expect(a.windows[0].dead).toBe(true);
  expect(a.save).not.toHaveBeenCalled();
  a.dispose();
});
test("initial UI timeout cleans up its window and timers without presenting it", async () => {
  jest.useFakeTimers();
  const a = setup({ ready: false });
  const opening = a.controller.open();
  const failed = expect(opening).rejects.toThrow("did not initialize");
  await jest.advanceTimersByTimeAsync(5000);
  await failed;
  expect(a.windows[0].dead).toBe(true);
  expect(a.present).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
  a.dispose();
});
test("closing an established window rejects pending commands immediately", async () => {
  jest.useFakeTimers();
  const a = setup();
  await a.controller.open();
  a.owner.send.mockImplementation(() => {});
  const command = a.call(IPC.SETTINGS_COMMAND, a.windows[0].webContents, {
    type: "set",
    key: "sensitivity",
    value: 1.8,
  });
  const failed = expect(command).rejects.toThrow("closed");
  await Promise.resolve();
  a.controller.close();
  await failed;
  expect(jest.getTimerCount()).toBe(0);
  expect(a.save).not.toHaveBeenCalled();
  a.dispose();
});
