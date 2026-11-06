const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const Registry = require("../src/mode-registry");
const Protocol = require("../src/settings-protocol");
const ModeList = require("../src/mode-list");
const { setup: fixture } = require("./helpers/mode-fixture.cjs");
class Node {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.open = false;
    this.classes = new Set(["collapsed"]);
    this.listeners = new Map();
    this.classList = {
      contains: (c) => this.classes.has(c),
      add: (c) => this.classes.add(c),
      remove: (c) => this.classes.delete(c),
      toggle: (c, on) => {
        if (on) this.classes.add(c);
        else this.classes.delete(c);
      },
    };
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  append(...children) {
    this.children.push(...children);
  }
  closest() {
    return this;
  }
  emit(type, event) {
    for (const fn of this.listeners.get(type) || []) fn(event);
  }
}
function setup() {
  const f = fixture("bars"),
    nodes = new Map(),
    get = (id) => {
      if (!nodes.has(id)) nodes.set(id, new Node(id));
      return nodes.get(id);
    };
  const sections = ["style", "audio", "miniOverlay", "diagnostics"].map((id) =>
    get(id + "Section")
  );
  const document = {
    getElementById: get,
    createElement: () => new Node(),
    querySelectorAll: () => sections,
  };
  const window = new Node();
  window.setInterval = setInterval;
  window.clearInterval = clearInterval;
  window.requestAnimationFrame = jest.fn(() => 1);
  window.cancelAnimationFrame = jest.fn();
  window.navigator = {
    clipboard: { writeText: jest.fn().mockResolvedValue() },
  };
  let callback;
  const unsubscribe = jest.fn(),
    api = {
      getState: jest.fn().mockResolvedValue({
        revision: 1,
        values: structuredClone(f.settings),
        effectiveMode: "bars",
        packaged: false,
      }),
      dispatch: jest.fn().mockResolvedValue({ revision: 2 }),
      onPatch: (fn) => {
        callback = fn;
        return unsubscribe;
      },
      ready: jest.fn().mockResolvedValue(),
      close: jest.fn(),
      diagnostics: jest.fn().mockResolvedValue({
        rows: [],
        profileActive: false,
        copyEnabled: false,
        clipboard: null,
      }),
    };
  const panel = {
    start: jest.fn(),
    dispose: jest.fn(),
    rows: jest.fn(),
    labels: jest.fn(),
    backgroundRows: jest.fn(),
    trailRows: jest.fn(),
    bindings: [
      {
        key: "sensitivity",
        sync: (state) => {
          get("sensitivitySlider").value = String(state.sensitivity);
        },
      },
    ],
  };
  const SettingsPanel = { create: jest.fn(() => panel), paintTheme: jest.fn() };
  const managers = [],
    createManager = jest.fn(() => {
      const manager = { render: jest.fn(), dispose: jest.fn() };
      managers.push(manager);
      return manager;
    });
  const context = {
    SettingsPanel,
    SettingsProtocol: Protocol,
    SettingsView: { mount: jest.fn() },
    Element: Node,
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/settings-client.js"), "utf8"),
    context
  );
  const client = context.SettingsClient.create({
    document,
    window,
    api,
    registry: Registry,
    themes: f.constants.THEMES,
    modeList: ModeList,
    createManager,
    cycleSpeed: 10,
  });
  return {
    client,
    api,
    panel,
    SettingsPanel,
    managers,
    createManager,
    unsubscribe,
    window,
    get,
    sections,
    deliver: (value) => callback(value),
  };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test("passive creation, initial synchronization, duplicate startup and ordered patches", async () => {
  const f = setup();
  expect(f.api.getState).not.toHaveBeenCalled();
  await f.client.start();
  await f.client.start();
  expect(f.api.getState).toHaveBeenCalledTimes(1);
  expect(f.api.ready).toHaveBeenCalledTimes(1);
  expect(f.api.dispatch).not.toHaveBeenCalled();
  expect(f.get("miniOverlaySection").classList.contains("collapsed")).toBe(
    false
  );
  f.deliver({
    revision: 4,
    values: { sensitivity: 1.8 },
    effectiveMode: "orbit",
    packaged: false,
  });
  expect(f.get("sensitivitySlider").value).toBe("1.8");
  expect(f.get("modeSelect").value).toBe(String(Registry.indexOf("orbit")));
  f.deliver({
    revision: 3,
    values: { sensitivity: 0.5 },
    effectiveMode: "bars",
    packaged: false,
  });
  f.deliver({
    revision: 4,
    values: { sensitivity: 0.6 },
    effectiveMode: "bars",
    packaged: false,
  });
  expect(f.get("sensitivitySlider").value).toBe("1.8");
  expect(f.api.dispatch).not.toHaveBeenCalled();
  expect(f.managers.every((m) => m.render.mock.calls.length === 0)).toBe(true);
  f.client.dispose();
  f.client.dispose();
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.panel.dispose).toHaveBeenCalledTimes(1);
  expect(f.managers.every((m) => m.dispose.mock.calls.length === 1)).toBe(true);
  expect(f.window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  f.deliver({
    revision: 5,
    values: { sensitivity: 3 },
    effectiveMode: "bars",
    packaged: false,
  });
  expect(f.get("sensitivitySlider").value).toBe("1.8");
});
test("early patches newer than the snapshot survive initialization without feedback commands", async () => {
  const f = setup();
  let resolve;
  f.api.getState.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const starting = f.client.start();
  f.deliver({
    revision: 3,
    values: { sensitivity: 2 },
    effectiveMode: "radial",
    packaged: false,
  });
  resolve({
    revision: 2,
    values: fixture("bars").settings,
    effectiveMode: "bars",
    packaged: false,
  });
  await starting;
  expect(f.get("sensitivitySlider").value).toBe("2");
  expect(f.get("modeSelect").value).toBe(String(Registry.indexOf("radial")));
  expect(f.api.dispatch).not.toHaveBeenCalled();
  f.client.dispose();
});
test("dispose before initial reply prevents late initialization or readiness", async () => {
  const f = setup();
  let resolve;
  f.api.getState.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const starting = f.client.start();
  f.client.dispose();
  resolve({
    revision: 1,
    values: fixture("bars").settings,
    effectiveMode: "bars",
    packaged: false,
  });
  await starting;
  expect(f.SettingsPanel.create).not.toHaveBeenCalled();
  expect(f.api.ready).not.toHaveBeenCalled();
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
});
test("partial UI startup failure disposes earlier managers, panel and subscriptions", async () => {
  const f = setup();
  f.createManager
    .mockImplementationOnce(() => {
      const m = { render: jest.fn(), dispose: jest.fn() };
      f.managers.push(m);
      return m;
    })
    .mockImplementationOnce(() => {
      throw Error("manager failed");
    });
  await expect(f.client.start()).rejects.toThrow("manager failed");
  expect(f.panel.dispose).toHaveBeenCalledTimes(1);
  expect(f.managers[0].dispose).toHaveBeenCalledTimes(1);
  expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  expect(f.api.ready).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test("development diagnostics poll only while expanded, stop on collapse/dispose and ignore late responses", async () => {
  const f = setup();
  await f.client.start();
  expect(f.api.diagnostics).not.toHaveBeenCalled();
  const section = f.get("diagnosticsSection");
  f.get("settingsPanel").emit("click", { target: section });
  await Promise.resolve();
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(1000);
  expect(f.api.diagnostics).toHaveBeenCalledTimes(3);
  f.get("settingsPanel").emit("click", { target: section });
  await jest.advanceTimersByTimeAsync(1000);
  expect(f.api.diagnostics).toHaveBeenCalledTimes(3);
  let resolve;
  f.api.diagnostics.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  f.get("settingsPanel").emit("click", { target: section });
  await Promise.resolve();
  f.client.dispose();
  resolve({ rows: [{ id: "diagFps", text: "60" }], clipboard: null });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.get("diagFps").textContent).toBe("");
  expect(jest.getTimerCount()).toBe(0);
});
test("packaged diagnostics remain hidden and never request owner diagnostics", async () => {
  const f = setup();
  const snapshot = await f.api.getState();
  snapshot.packaged = true;
  f.api.getState.mockResolvedValue(snapshot);
  await f.client.start();
  expect(f.get("diagnosticsSection").hidden).toBe(true);
  f.get("settingsPanel").emit("click", { target: f.get("diagnosticsSection") });
  await jest.advanceTimersByTimeAsync(1000);
  expect(f.api.diagnostics).not.toHaveBeenCalled();
  f.client.dispose();
});
