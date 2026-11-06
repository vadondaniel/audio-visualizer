const Entry = require("../src/renderer-entry");
const SettingsUI = require("../src/settings-ui");
const TrayControls = require("../src/tray-controls");
const Registry = require("../src/mode-registry");
const ModeList = require("../src/mode-list");

function composition({ fail, initial } = {}) {
  const log = [],
    instances = {};
  let effects, changed;
  const factory = (name) => ({
    create: jest.fn((deps) => {
      log.push(`create:${name}`);
      const instance = {
        start: jest.fn(() => {
          log.push(`start:${name}`);
          if (fail === name) throw Error("start failure");
        }),
        dispose: jest.fn(() => log.push(`dispose:${name}`)),
      };
      if (name === "settings")
        Object.assign(instance, { effects: {}, sync: jest.fn() });
      if (name === "actions") {
        effects = deps.effects;
        instance.initialize = () => {
          log.push("initialize:actions");
          deps.effects.syncControls("all");
        };
      }
      if (name === "overlay") {
        changed = deps.onPresentationChange;
        instance.isActive = () => false;
        instance.initialize = async () => {
          log.push("initialize:overlay");
          if (initial) await initial;
          changed();
        };
      }
      if (name === "tray") instance.sync = jest.fn();
      return (instances[name] = instance);
    }),
  });
  const dependencies = {
    SettingsUI: factory("settings"),
    SettingsActions: factory("actions"),
    MiniOverlayUI: factory("overlay"),
    TrayControls: factory("tray"),
    bridge: {
      window: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        setInterval: jest.fn(),
        clearInterval: jest.fn(),
        setTimeout: jest.fn(),
        clearTimeout: jest.fn(),
      },
      restore: () => log.push("restore"),
      bind: jest.fn(),
      save: jest.fn(),
      settings: {},
      overlay: {},
    },
  };
  return {
    dependencies,
    instances,
    log,
    effects: () => effects,
    changed: () => changed(),
  };
}

test("bootstrap restores first, wires all instances, then starts once and waits for presentation", async () => {
  let release;
  const initial = new Promise((resolve) => {
    release = resolve;
  });
  const f = composition({ initial });
  const pending = Entry.startAdapters(f.dependencies);
  expect(f.log).toEqual([
    "restore",
    "create:settings",
    "create:actions",
    "create:overlay",
    "create:tray",
    "start:settings",
    "start:tray",
    "start:overlay",
    "initialize:actions",
    "initialize:overlay",
  ]);
  expect(f.instances.tray.sync).not.toHaveBeenCalled();
  release();
  const controller = await pending;
  expect(f.instances.tray.sync).toHaveBeenCalledTimes(1);
  expect(f.dependencies.bridge.save).not.toHaveBeenCalled();
  f.effects().syncControls(["sensitivity"]);
  expect(f.instances.tray.sync).toHaveBeenCalledTimes(1);
  f.effects().syncControls(["theme"]);
  f.changed();
  expect(f.instances.tray.sync).toHaveBeenCalledTimes(3);
  controller.dispose();
  controller.dispose();
  expect(f.log.slice(-4)).toEqual([
    "dispose:tray",
    "dispose:overlay",
    "dispose:actions",
    "dispose:settings",
  ]);
  for (const instance of Object.values(f.instances))
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  f.changed();
  expect(f.instances.tray.sync).toHaveBeenCalledTimes(3);
});

test.each(["settings", "tray", "overlay"])(
  "partial %s startup failure disposes every constructed resource",
  async (fail) => {
    const f = composition({ fail });
    await expect(Entry.startAdapters(f.dependencies)).rejects.toThrow(
      "start failure"
    );
    for (const instance of Object.values(f.instances))
      expect(instance.dispose).toHaveBeenCalledTimes(1);
    expect(
      f.dependencies.bridge.window.removeEventListener
    ).toHaveBeenCalledWith("unload", expect.any(Function));
  }
);

test("initial presentation rejection and unload during initialization both release resources", async () => {
  let reject;
  const initial = new Promise((_, fail) => {
    reject = fail;
  });
  const f = composition({ initial });
  const pending = Entry.startAdapters(f.dependencies);
  const unload = f.dependencies.bridge.window.addEventListener.mock.calls[0][1];
  unload();
  reject(Error("native state failed"));
  await expect(pending).rejects.toThrow("native state failed");
  for (const instance of Object.values(f.instances))
    expect(instance.dispose).toHaveBeenCalledTimes(1);
  expect(f.instances.tray.sync).not.toHaveBeenCalled();
});

test("native capabilities explicitly fall back or reject incomplete supported APIs", () => {
  const api = Entry.nativeCapabilities();
  expect(api.miniOverlaySupported).toBe(false);
  expect(api.onTraySelect(() => {})()).toBeUndefined();
  expect(() =>
    Entry.nativeCapabilities({ miniOverlaySupported: true })
  ).toThrow("Missing native capability");
  expect(() => Entry.nativeCapabilities({ setTraySettings() {} })).toThrow(
    "Incomplete native tray"
  );
});

test("tray construction is passive and lifecycle prevents duplicate or late commands", () => {
  let receive,
    active = false;
  const unsubscribe = jest.fn();
  const state = {
    mode: 0,
    theme: 0,
    miniOverlayMode: "prism",
    modeOrder: [...Registry.ids],
    disabledModes: [],
    themeOrder: ["Ice"],
    disabledThemes: [],
  };
  const api = {
    setTraySettings: jest.fn(),
    onTraySelect: jest.fn((fn) => {
      receive = fn;
      return unsubscribe;
    }),
  };
  const actions = { selectActiveMode: jest.fn(), set: jest.fn() };
  const tray = TrayControls.create({
    state,
    registry: Registry,
    modeList: ModeList,
    themeIds: ["Ice"],
    settingsActions: actions,
    isActive: () => active,
    api,
  });
  tray.sync();
  expect(api.setTraySettings).not.toHaveBeenCalled();
  expect(api.onTraySelect).not.toHaveBeenCalled();
  tray.start();
  tray.start();
  expect(api.onTraySelect).toHaveBeenCalledTimes(1);
  active = true;
  tray.sync();
  expect(api.setTraySettings.mock.calls[0][0].mode).toBe("prism");
  receive({ kind: "mode", id: "bars" });
  expect(actions.selectActiveMode).toHaveBeenCalledWith("bars", true);
  receive({ kind: "theme", id: "Ice" });
  expect(actions.set).toHaveBeenCalledWith("theme", 0);
  tray.dispose();
  tray.dispose();
  tray.start();
  receive({ kind: "mode", id: "prism" });
  expect(actions.selectActiveMode).toHaveBeenCalledTimes(1);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("settings adapter construction does not touch DOM, effects, or persistence", () => {
  const toggle = jest.fn(),
    reset = jest.fn(),
    element = { value: 0 };
  const adapter = SettingsUI.create({
    state: { sensitivity: 1.8 },
    elements: { body: { classList: { toggle } } },
    bindings: [SettingsUI.valueBinding("sensitivity", element, String)],
    resetDrawDeadline: reset,
    effects: {},
  });
  adapter.sync(["sensitivity"]);
  expect(toggle).not.toHaveBeenCalled();
  adapter.start();
  adapter.start();
  adapter.sync(["sensitivity"]);
  expect(element.value).toBe("1.8");
  expect(toggle).toHaveBeenCalledTimes(1);
  adapter.dispose();
  adapter.dispose();
  adapter.start();
  adapter.sync(["sensitivity"]);
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(reset).not.toHaveBeenCalled();
});

test("typed bindings preserve conversions and synchronize only affected controls", () => {
  const state = {
    sensitivity: 1.8,
    smoothingEnabled: true,
    radialMode: "full",
    miniOverlayScale: 1.5,
    miniOverlayOpacity: 0.5,
    miniOverlayShowBackground: false,
  };
  const gain = { value: "" },
    smooth = { checked: false },
    mirror = { checked: false };
  const setProperty = jest.fn(),
    resetDrawDeadline = jest.fn();
  const elements = {
    body: { classList: { toggle: jest.fn() }, style: { setProperty } },
    scaleLabel: { textContent: "" },
    opacityLabel: { textContent: "" },
  };
  const controls = SettingsUI.create({
    state,
    elements,
    resetDrawDeadline,
    effects: {},
    bindings: [
      SettingsUI.valueBinding("sensitivity", gain, (value) => value.toFixed(1)),
      SettingsUI.checkboxBinding("smoothingEnabled", smooth, (value) => value),
      SettingsUI.checkboxBinding(
        "radialMode",
        mirror,
        (value) => value === "mirrored"
      ),
    ],
  });
  controls.start();
  controls.sync("all");
  expect(gain.value).toBe("1.8");
  expect(smooth.checked).toBe(true);
  expect(mirror.checked).toBe(false);
  expect(elements.scaleLabel.textContent).toBe("150%");
  expect(elements.opacityLabel.textContent).toBe("50%");
  expect(setProperty).toHaveBeenCalledWith("--mini-overlay-scale", "1.5");
  expect(setProperty).toHaveBeenCalledWith("--mini-overlay-opacity", "0.5");
  state.sensitivity = 2.2;
  state.smoothingEnabled = false;
  state.radialMode = "mirrored";
  controls.sync(["sensitivity"]);
  expect(gain.value).toBe("2.2");
  expect(smooth.checked).toBe(true);
  controls.sync(["smoothingEnabled", "radialMode"]);
  expect(smooth.checked).toBe(false);
  expect(mirror.checked).toBe(true);
  expect(resetDrawDeadline).toHaveBeenCalledTimes(1);
});
