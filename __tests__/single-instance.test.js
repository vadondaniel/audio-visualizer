const { acquireSingleInstance } = require("../src/single-instance");

function setup(primary = true, window) {
  const handlers = {};
  const app = {
    requestSingleInstanceLock: jest.fn(() => primary),
    quit: jest.fn(),
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
  };
  return {
    app,
    handlers,
    start: () => acquireSingleInstance(app, () => window),
  };
}

test("a secondary exits before registering startup behavior", () => {
  const instance = setup(false);
  expect(instance.start()).toBe(false);
  expect(instance.app.quit).toHaveBeenCalledTimes(1);
  expect(instance.app.on).not.toHaveBeenCalled();
});

test.each([true, false])(
  "a second launch shows and focuses the primary; minimized=%s",
  (minimized) => {
    const window = {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      restore: jest.fn(),
      show: jest.fn(),
      focus: jest.fn(),
    };
    const instance = setup(true, window);
    expect(instance.start()).toBe(true);
    instance.handlers["second-instance"]();
    expect(window.restore).toHaveBeenCalledTimes(minimized ? 1 : 0);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(instance.app.quit).not.toHaveBeenCalled();
  }
);

test("early and destroyed-window notifications are harmless", () => {
  for (const window of [undefined, { isDestroyed: () => true }]) {
    const instance = setup(true, window);
    instance.start();
    expect(() => instance.handlers["second-instance"]()).not.toThrow();
  }
});
