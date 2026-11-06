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
      this.on = jest.fn();
      this.options = options;
      this.webContents = { on: jest.fn() };
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
