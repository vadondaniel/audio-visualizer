jest.mock("../scripts/verification-paths.cjs", () => ({
  projectRoot: process.cwd(),
  configureProfile: () => ({ artifacts: "ignored" }),
}));
jest.mock("electron", () => {
  const { EventEmitter } = require("node:events");
  return {
    app: {
      whenReady: jest.fn(async () => {}),
      exit: jest.fn(),
      quit: jest.fn(),
    },
    ipcMain: { handle: jest.fn(), removeHandler: jest.fn() },
    BrowserWindow: jest.fn(function (options) {
      Object.assign(this, new EventEmitter());
      for (const name of ["on", "removeListener", "emit", "listenerCount"])
        this[name] = EventEmitter.prototype[name];
      this.options = options;
      this.webContents = Object.assign(new EventEmitter(), {
        isDestroyed: () => false,
        executeJavaScript: jest.fn(async () => undefined),
      });
      this.isDestroyed = () => false;
      this.destroy = jest.fn();
    }),
  };
});
const electron = require("electron");
const { runCheck } = require("./helpers/electron-harness.cjs");
beforeEach(() => jest.clearAllMocks());
test("background harness forces hidden non-focusable windows and rejects activation", async () => {
  let window;
  runCheck(async ({ createWindow }) => {
    expect(() => createWindow({ show: true })).toThrow("--interactive");
    window = createWindow();
    expect(window.options).toMatchObject({ show: false, focusable: false });
    for (const method of [
      "show",
      "focus",
      "restore",
      "maximize",
      "setFullScreen",
    ])
      expect(() => window[method]()).toThrow("--interactive");
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(electron.app.exit).toHaveBeenCalledWith(0);
  expect(window.destroy).toHaveBeenCalled();
});
test("desktop-only check exits as skipped without creating any native window", async () => {
  const check = jest.fn();
  runCheck(check, { requiresDesktop: true });
  await new Promise((resolve) => setImmediate(resolve));
  expect(check).not.toHaveBeenCalled();
  expect(electron.BrowserWindow).not.toHaveBeenCalled();
  expect(electron.app.quit).toHaveBeenCalled();
});

test("owned waits reject immediately when the renderer exits and remove temporary listeners", async () => {
  let owner;
  runCheck(async ({ createWindow, waitFor }) => {
    owner = createWindow();
    const result = waitFor(
      "renderer state",
      () => new Promise(() => {}),
      Boolean,
      { window: owner }
    );
    const failure = expect(result).rejects.toThrow(
      "Owner closed while waiting for renderer state"
    );
    owner.webContents.emit(
      "render-process-gone",
      {},
      { reason: "expected test exit" }
    );
    await failure;
    expect(owner.listenerCount("closed")).toBe(0);
    expect(owner.webContents.listenerCount("destroyed")).toBe(0);
    expect(owner.webContents.listenerCount("render-process-gone")).toBe(1);
  });
  await new Promise((resolve) => setImmediate(resolve));
  // The harness independently reports the crash as a check failure.
  expect(electron.app.exit).toHaveBeenCalledWith(1);
});

test("harness teardown aborts outstanding waits and removes owner subscriptions", async () => {
  let pending, owner;
  runCheck(async ({ createWindow, waitFor }) => {
    owner = createWindow();
    pending = waitFor("unfinished observation", () => false, Boolean, {
      window: owner,
    }).catch((error) => error);
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect((await pending).message).toContain("Owner closed");
  expect(owner.listenerCount("closed")).toBe(0);
  expect(owner.webContents.listenerCount("destroyed")).toBe(0);
  expect(electron.app.exit).toHaveBeenCalledWith(0);
});

test("viewport synchronization uses the granted native size with one-DIP renderer rounding", async () => {
  runCheck(async ({ createWindow, setViewport }) => {
    const window = createWindow();
    window.setContentSize = jest.fn();
    window.getContentSize = () => [1282, 722];
    window.webContents.executeJavaScript.mockImplementation(async () => ({
      width: 1282,
      height: 723,
    }));
    const result = await setViewport(window, 1280, 720);
    expect(window.setContentSize).toHaveBeenCalledWith(1280, 720);
    expect(result).toEqual({
      width: 1282,
      height: 723,
      nativeWidth: 1282,
      nativeHeight: 722,
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(electron.app.exit).toHaveBeenCalledWith(0);
});

test("a hung paint probe fails within its deadline without blocking window cleanup", async () => {
  jest.useFakeTimers();
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  let owner;
  try {
    runCheck(async ({ createWindow, waitForPaint }) => {
      owner = createWindow();
      owner.webContents.executeJavaScript.mockImplementation(
        () => new Promise(() => {})
      );
      await waitForPaint(owner, ["body"]);
    });
    await jest.advanceTimersByTimeAsync(5000);
    expect(electron.app.exit).toHaveBeenCalledWith(1);
    expect(owner.destroy).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    logged.mockRestore();
    jest.useRealTimers();
  }
});
