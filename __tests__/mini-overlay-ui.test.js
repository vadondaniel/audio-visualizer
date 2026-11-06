const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function setup() {
  const nodes = new Map();
  function node(id, button = false) {
    const listeners = new Map();
    const classes = new Set();
    return {
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
      addEventListener: (name, callback) => {
        listeners.set(name, [...(listeners.get(name) || []), callback]);
      },
      emit: async (name, event) => {
        for (const listener of listeners.get(name) || []) await listener(event);
      },
    };
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
  ])
    nodes.set(id, node(id, id !== "miniOverlayControls"));
  const body = node("body"),
    canvas = node("canvas");
  let receive;
  const api = {
    miniOverlaySupported: false,
    onMiniOverlayState: (callback) => {
      receive = callback;
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
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../src/mini-overlay-ui.js"), "utf8"),
    context
  );
  const state = (overrides = {}) =>
    receive({ active: true, locked: false, canLock: true, ...overrides });
  state();
  const event = (target, x = 100, y = 100) => ({
    button: 0,
    pointerId: 1,
    screenX: x,
    screenY: y,
    target,
  });
  return { api, body, canvas, nodes, state, event, window: context.window };
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
  });
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
