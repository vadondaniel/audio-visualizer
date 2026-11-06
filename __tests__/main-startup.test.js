const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");

function loadMain({ primary = true, packaged = false } = {}) {
  const app = {
    isPackaged: packaged,
    requestSingleInstanceLock: jest.fn(() => primary),
    whenReady: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
    quit: jest.fn(),
    exit: jest.fn(),
  };
  const build = new EventEmitter();
  const spawn = jest.fn(() => build);
  const electron = {
    app,
    BrowserWindow: jest.fn(),
    ipcMain: {
      on: jest.fn(),
      handle: jest.fn(),
      removeListener: jest.fn(),
      removeHandler: jest.fn(),
    },
  };
  const filename = path.join(__dirname, "../src/main.js");
  const nativeRequire = createRequire(filename);
  const context = {
    __dirname: path.dirname(filename),
    process,
    console: { error: jest.fn() },
    require: (id) =>
      id === "electron"
        ? electron
        : id === "child_process"
          ? { spawn }
          : nativeRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context);
  context.createWindow = jest.fn();
  return {
    app,
    build,
    spawn,
    electron,
    context,
    evaluate: (code) => vm.runInContext(code, context),
  };
}

test("duplicate startup cannot create caches/windows, register IPC, or rebuild the helper", async () => {
  const { app, spawn, electron } = loadMain({ primary: false });
  await Promise.resolve();
  expect(app.quit).toHaveBeenCalledTimes(1);
  expect(app.whenReady).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
  expect(electron.BrowserWindow).not.toHaveBeenCalled();
  expect(electron.ipcMain.on).not.toHaveBeenCalled();
  expect(electron.ipcMain.handle).not.toHaveBeenCalled();
});

test("development primary builds the helper before opening its window", async () => {
  const { app, spawn, build, context } = loadMain();
  await Promise.resolve();
  expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0][0]).toBe("powershell.exe");
  expect(spawn.mock.calls[0][1].at(-1)).toBe(
    path.join(__dirname, "../scripts/build-media-watcher.ps1")
  );
  expect(context.createWindow).not.toHaveBeenCalled();
  build.emit("exit", 0);
  await Promise.resolve();
  expect(context.createWindow).toHaveBeenCalledTimes(1);
});

test("packaged startup does not rebuild the bundled helper", async () => {
  const { spawn, context } = loadMain({ packaged: true });
  await Promise.resolve();
  expect(spawn).not.toHaveBeenCalled();
  expect(context.createWindow).toHaveBeenCalledTimes(1);
});

test("second launch restores the normal presentation before focusing it", async () => {
  const { app, context, evaluate } = loadMain({ packaged: true });
  await Promise.resolve();
  const restore = jest.fn();
  const window = {
    isDestroyed: () => false,
    isMinimized: () => false,
    show: jest.fn(),
    focus: jest.fn(),
  };
  context.testController = { restore };
  context.testWindow = window;
  evaluate("presentation=testController;mainWindow=testWindow;");
  app.on.mock.calls.find((call) => call[0] === "second-instance")[1]();
  expect(restore).toHaveBeenCalledTimes(1);
  expect(restore.mock.invocationCallOrder[0]).toBeLessThan(
    window.focus.mock.invocationCallOrder[0]
  );
});

test("quit removes tray IPC and disposes tray before closing the presentation", async () => {
  const { app, context, evaluate, electron } = loadMain({ packaged: true });
  await Promise.resolve();
  context.testSettings = { dispose: jest.fn() };
  context.testTray = { dispose: jest.fn() };
  context.testPresentation = { dispose: jest.fn() };
  evaluate(
    "floatingSettings=testSettings;nativeTray=testTray;presentation=testPresentation;"
  );
  for (const [event, handler] of app.on.mock.calls)
    if (event === "before-quit") handler();
  expect(electron.ipcMain.removeListener).toHaveBeenCalledWith(
    "tray-settings",
    expect.any(Function)
  );
  expect(context.testSettings.dispose.mock.invocationCallOrder[0]).toBeLessThan(
    context.testTray.dispose.mock.invocationCallOrder[0]
  );
  expect(context.testTray.dispose.mock.invocationCallOrder[0]).toBeLessThan(
    context.testPresentation.dispose.mock.invocationCallOrder[0]
  );
});

test.each(["nonzero exit", "spawn error"])(
  "a helper build failure stops startup: %s",
  async (failure) => {
    const { app, build, context } = loadMain();
    await Promise.resolve();
    if (failure === "nonzero exit") build.emit("exit", 1);
    else build.emit("error", new Error("PowerShell unavailable"));
    await new Promise((resolve) => setImmediate(resolve));
    expect(context.createWindow).not.toHaveBeenCalled();
    expect(context.console.error).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(1);
  }
);

test("media metadata stays queued until the asynchronous renderer is ready", async () => {
  const { context, evaluate } = loadMain({ primary: false });
  let ready;
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: jest.fn(
        () =>
          new Promise((resolve) => {
            ready = resolve;
          })
      ),
      send: jest.fn(),
    },
  };
  context.testWindow = window;
  evaluate(
    'rendererContents=testWindow.webContents;pendingMediaMetadata=[{title:"queued"}];'
  );
  const pending = context.finishRendererStartup(window.webContents);
  expect(window.webContents.send).not.toHaveBeenCalled();
  evaluate('pendingMediaMetadata.push({title:"later"});');
  ready();
  await pending;
  expect(
    window.webContents.send.mock.calls.map((call) => call[1].title)
  ).toEqual(["queued", "later"]);
  expect(evaluate("rendererReady")).toBe(true);
});
test("a failed renderer does not flush queued metadata", async () => {
  const { context, evaluate } = loadMain({ primary: false });
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      executeJavaScript: jest.fn().mockRejectedValue(Error("load failed")),
      send: jest.fn(),
    },
  };
  context.testWindow = window;
  evaluate(
    'rendererContents=testWindow.webContents;pendingMediaMetadata=[{title:"queued"}];'
  );
  await context.finishRendererStartup(window.webContents);
  expect(window.webContents.send).not.toHaveBeenCalled();
  expect(evaluate("rendererReady")).toBe(false);
  expect(context.console.error).toHaveBeenCalled();
});
