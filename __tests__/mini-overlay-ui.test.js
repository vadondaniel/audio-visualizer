class FakeElement {}
const originalElement = global.Element;
beforeAll(() => {
  global.Element = FakeElement;
});
afterAll(() => {
  global.Element = originalElement;
});
const OverlayUI = require("../src/mini-overlay-ui");
function setup({ start = true } = {}) {
  const nodes = new Map();
  function node(id, button = false) {
    const listeners = new Map();
    const classes = new Set();
    return Object.assign(new FakeElement(), {
      id,
      hidden: false,
      disabled: false,
      classList: {
        add: (x) => classes.add(x),
        remove: (x) => classes.delete(x),
        toggle: (x, enabled) => (enabled ? classes.add(x) : classes.delete(x)),
      },
      closest: () => (button ? {} : null),
      setPointerCapture: jest.fn(),
      hasPointerCapture: () => true,
      releasePointerCapture: jest.fn(),
      removeEventListener: (name, callback) =>
        listeners.set(
          name,
          (listeners.get(name) || []).filter((fn) => fn !== callback)
        ),
      addEventListener: (name, callback) => {
        listeners.set(name, [...(listeners.get(name) || []), callback]);
      },
      emit: async (name, event) => {
        for (const listener of listeners.get(name) || []) await listener(event);
      },
    });
  }
  for (const id of [
    "miniOverlayBtn",
    "miniOverlayControls",
    "miniOverlayResize",
    "miniOverlayLock",
    "miniOverlaySettings",
    "miniOverlayReturn",
    "miniOverlayBackgroundCheckbox",
    "miniOverlaySize",
    "miniOverlayModeSelect",
    "miniOverlayScaleSlider",
    "miniOverlayOpacitySlider",
    "miniOverlayFpsSelect",
  ])
    nodes.set(id, node(id, id !== "miniOverlayControls"));
  const body = node("body"),
    canvas = node("canvas");
  let receive;
  const api = {
    miniOverlaySupported: false,
    onMiniOverlayState: (callback) => {
      receive = callback;
      return jest.fn();
    },
    getMiniOverlayBounds: jest.fn(async () => ({
      x: 100,
      y: 80,
      width: 320,
      height: 300,
    })),
    setMiniOverlayBounds: jest.fn(),
  };
  const context = {
    MiniOverlayMath: require("../src/mini-overlay-math"),
    window: {
      electronAPI: api,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      innerWidth: 320,
      innerHeight: 300,
    },
    document: { body, getElementById: (id) => nodes.get(id) },
    setTimeout: jest.fn(() => 1),
    clearTimeout: jest.fn(),
    panelOpen: false,
    updatePanelVisibility: jest.fn(),
    closeHotkeys: jest.fn(),
    modeManager: { open: false },
    themeManager: { open: false },
  };
  const dependencies = {
    window: context.window,
    elements: {
      body,
      entry: nodes.get("miniOverlayBtn"),
      controls: nodes.get("miniOverlayControls"),
      grip: nodes.get("miniOverlayResize"),
      lock: nodes.get("miniOverlayLock"),
      size: nodes.get("miniOverlaySize"),
      settings: nodes.get("miniOverlaySettings"),
      returnButton: nodes.get("miniOverlayReturn"),
      background: nodes.get("miniOverlayBackgroundCheckbox"),
      mode: nodes.get("miniOverlayModeSelect"),
      scale: nodes.get("miniOverlayScaleSlider"),
      opacity: nodes.get("miniOverlayOpacitySlider"),
      fps: nodes.get("miniOverlayFpsSelect"),
    },
    api,
    actions: { set: jest.fn(), selectOverlayMode: jest.fn() },
    timers: {
      setTimeout: context.setTimeout,
      clearTimeout: context.clearTimeout,
    },
    snapSize: context.MiniOverlayMath.snapSize,
    canCapture: () => true,
    resetDrawDeadline: jest.fn(),
    showStart: jest.fn(),
    closePanels: jest.fn(),
    openSettings: jest.fn(),
    reportError: jest.fn(),
    onPresentationChange: jest.fn(),
  };
  const adapter = OverlayUI.create(dependencies);
  if (start) adapter.start();
  const state = (overrides = {}) =>
    receive({ active: true, locked: false, canLock: true, ...overrides });
  if (start) state();
  const event = (target, x = 100, y = 100) => ({
    button: 0,
    pointerId: 1,
    screenX: x,
    screenY: y,
    target,
  });
  return {
    api,
    body,
    canvas,
    nodes,
    state,
    event,
    window: context.window,
    adapter,
    dependencies,
  };
}
test("dragging any visual area moves the overlay without requiring a handle", async () => {
  const f = setup();
  await f.body.emit("pointerdown", f.event(f.canvas));
  await f.body.emit("pointermove", f.event(f.canvas, 130, 120));
  expect(f.api.setMiniOverlayBounds).toHaveBeenCalledWith({
    x: 130,
    y: 100,
    width: 320,
    height: 300,
    operation: "move",
    snapToEdges: true,
  });
  await f.body.emit("pointerup", f.event(f.canvas));
  f.api.setMiniOverlayBounds.mockClear();
  await f.body.emit("pointermove", f.event(f.canvas, 200, 200));
  expect(f.api.setMiniOverlayBounds).not.toHaveBeenCalled();
});
test("buttons, resize grip, inactive mode and click-through lock cannot start a move", async () => {
  const f = setup();
  for (const id of [
    "miniOverlaySettings",
    "miniOverlayLock",
    "miniOverlayReturn",
    "miniOverlayResize",
  ])
    await f.body.emit("pointerdown", f.event(f.nodes.get(id)));
  f.state({ locked: true });
  await f.body.emit("pointerdown", f.event(f.canvas));
  f.state({ active: false });
  await f.body.emit("pointerdown", f.event(f.canvas));
  expect(f.api.getMiniOverlayBounds).not.toHaveBeenCalled();
});
test("resize changes only size and pointer cancellation ends it", async () => {
  const f = setup(),
    grip = f.nodes.get("miniOverlayResize");
  await grip.emit("pointerdown", f.event(grip));
  const label = f.nodes.get("miniOverlaySize");
  expect(label.hidden).toBe(false);
  expect(label.textContent).toBe("320 × 300 px");
  await grip.emit("pointermove", f.event(grip, 140, 125));
  expect(f.api.setMiniOverlayBounds).toHaveBeenCalledWith({
    x: 100,
    y: 80,
    width: 360,
    height: 325,
    operation: "resize",
    snapToEdges: true,
  });
  await grip.emit("pointercancel", f.event(grip));
  expect(label.hidden).toBe(true);
  f.api.setMiniOverlayBounds.mockClear();
  await grip.emit("pointermove", f.event(grip, 150, 150));
  expect(f.api.setMiniOverlayBounds).not.toHaveBeenCalled();
});

test("holding Shift snaps resize and releasing it restores free sizing", async () => {
  const f = setup(),
    grip = f.nodes.get("miniOverlayResize");
  await grip.emit("pointerdown", f.event(grip));
  await grip.emit("pointermove", { ...f.event(grip, 260, 70), shiftKey: true });
  expect(f.api.setMiniOverlayBounds).toHaveBeenLastCalledWith({
    x: 100,
    y: 80,
    width: 480,
    height: 270,
    aspectRatio: 16 / 9,
    operation: "resize",
    snapToEdges: true,
  });
  await grip.emit("pointermove", {
    ...f.event(grip, 250, 70),
    shiftKey: false,
  });
  expect(f.api.setMiniOverlayBounds).toHaveBeenLastCalledWith({
    x: 100,
    y: 80,
    width: 470,
    height: 270,
    operation: "resize",
    snapToEdges: true,
  });
});

test("Alt bypasses edge snapping for move/resize and preserves Shift aspect snapping", async () => {
  const f = setup(),
    grip = f.nodes.get("miniOverlayResize");
  await f.body.emit("pointerdown", f.event(f.canvas));
  await f.body.emit("pointermove", {
    ...f.event(f.canvas, 80, 70),
    altKey: true,
  });
  expect(f.api.setMiniOverlayBounds).toHaveBeenLastCalledWith({
    x: 80,
    y: 50,
    width: 320,
    height: 300,
    operation: "move",
    snapToEdges: false,
  });
  await f.body.emit("pointermove", {
    ...f.event(f.canvas, 80, 70),
    altKey: false,
  });
  expect(f.api.setMiniOverlayBounds.mock.calls.at(-1)[0].snapToEdges).toBe(
    true
  );
  await f.body.emit("pointerup", f.event(f.canvas));
  await grip.emit("pointerdown", f.event(grip));
  await grip.emit("pointermove", {
    ...f.event(grip, 260, 70),
    shiftKey: true,
    altKey: true,
  });
  expect(f.api.setMiniOverlayBounds).toHaveBeenLastCalledWith({
    x: 100,
    y: 80,
    width: 480,
    height: 270,
    aspectRatio: 16 / 9,
    operation: "resize",
    snapToEdges: false,
  });
  await grip.emit("lostpointercapture", f.event(grip));
  f.api.setMiniOverlayBounds.mockClear();
  await grip.emit("pointermove", f.event(grip, 300, 100));
  expect(f.api.setMiniOverlayBounds).not.toHaveBeenCalled();
});

test("live dimensions follow actual viewport resize and disappear when leaving or locking", async () => {
  const f = setup(),
    grip = f.nodes.get("miniOverlayResize"),
    label = f.nodes.get("miniOverlaySize");
  await grip.emit("pointerdown", f.event(grip));
  f.window.innerWidth = 361;
  f.window.innerHeight = 321;
  f.window.addEventListener.mock.calls.find(([name]) => name === "resize")[1]();
  expect(label.textContent).toBe("361 × 321 px");
  f.state({ locked: true });
  expect(label.hidden).toBe(true);
  f.state();
  await grip.emit("pointerdown", f.event(grip));
  f.state({ active: false });
  expect(label.hidden).toBe(true);
});

test("construction is passive, start is guarded, and disposal removes listeners and capture", async () => {
  const f = setup({ start: false });
  expect(f.window.addEventListener).not.toHaveBeenCalled();
  expect(f.api.getMiniOverlayBounds).not.toHaveBeenCalled();
  f.adapter.start();
  const count = f.window.addEventListener.mock.calls.length;
  f.adapter.start();
  expect(f.window.addEventListener).toHaveBeenCalledTimes(count);
  f.state();
  await f.body.emit("pointerdown", f.event(f.canvas));
  f.adapter.dispose();
  expect(f.body.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(f.window.removeEventListener).toHaveBeenCalledTimes(count);
  f.adapter.dispose();
  f.adapter.start();
  await f.body.emit("pointermove", f.event(f.canvas, 200, 200));
  expect(f.api.setMiniOverlayBounds).not.toHaveBeenCalled();
  expect(f.window.addEventListener).toHaveBeenCalledTimes(count);
});

test("late native state and bounds replies cannot revive a disposed adapter", async () => {
  const f = setup();
  let complete;
  f.api.enterMiniOverlay = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const enter = f.adapter.enter();
  let bounds;
  f.api.getMiniOverlayBounds.mockImplementation(
    () =>
      new Promise((resolve) => {
        bounds = resolve;
      })
  );
  const down = f.body.emit("pointerdown", f.event(f.canvas));
  f.adapter.dispose();
  const count = f.dependencies.onPresentationChange.mock.calls.length;
  complete({ active: false, locked: false, canLock: true });
  bounds({ x: 0, y: 0, width: 320, height: 320 });
  await Promise.all([enter, down]);
  f.state({ active: false });
  expect(f.dependencies.onPresentationChange).toHaveBeenCalledTimes(count);
  expect(f.api.setMiniOverlayBounds).not.toHaveBeenCalled();
});

test("native operation errors recover normal presentation and report the error", async () => {
  const f = setup();
  f.api.enterMiniOverlay = jest
    .fn()
    .mockRejectedValue(Error("attachment failed"));
  f.api.restoreNormalWindow = jest.fn().mockResolvedValue({ active: false });
  await f.adapter.enter();
  expect(f.api.restoreNormalWindow).toHaveBeenCalledTimes(1);
  expect(f.adapter.isActive()).toBe(false);
  expect(f.dependencies.reportError).toHaveBeenCalledWith("attachment failed");
});

test("initial native state failure recovers and rejects startup rather than resolving readiness", async () => {
  const f = setup();
  f.api.miniOverlaySupported = true;
  f.api.getMiniOverlayState = jest
    .fn()
    .mockRejectedValue(Error("state unavailable"));
  f.api.restoreNormalWindow = jest.fn().mockResolvedValue({ active: false });
  await expect(f.adapter.initialize()).rejects.toThrow("state unavailable");
  expect(f.dependencies.reportError).toHaveBeenCalledWith("state unavailable");
  expect(f.api.restoreNormalWindow).toHaveBeenCalledTimes(1);
});
