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
    ipcMain: { on: jest.fn(), handle: jest.fn() },
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
  evaluate('mainWindow=testWindow;pendingMediaMetadata=[{title:"queued"}];');
  const pending = context.finishRendererStartup(window);
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
      executeJavaScript: jest.fn().mockRejectedValue(Error("load failed")),
      send: jest.fn(),
    },
  };
  context.testWindow = window;
  evaluate('mainWindow=testWindow;pendingMediaMetadata=[{title:"queued"}];');
  await context.finishRendererStartup(window);
  expect(window.webContents.send).not.toHaveBeenCalled();
  expect(evaluate("rendererReady")).toBe(false);
  expect(context.console.error).toHaveBeenCalled();
});
