const { EventEmitter } = require("node:events");
const { create, registerIpc } = require("../src/tray-controller");

const choices = () => ({
  modes: [
    { id: "prism", label: "Prism" },
    { id: "bars", label: "Bars" },
  ],
  themes: [
    { id: "Ice", label: "Ice" },
    { id: "Neon", label: "Neon" },
  ],
  mode: "bars",
  theme: "Ice",
});
function setup() {
  const instances = [];
  let failure = null;
  const construct = jest.fn();
  class Tray extends EventEmitter {
    constructor(icon) {
      super();
      construct(icon);
      if (failure === "constructor") throw Error("No tray");
      this.dead = false;
      this.setToolTip = jest.fn(() => {
        if (failure === "tooltip") throw Error("No tooltip");
      });
      this.setContextMenu = jest.fn(() => {
        if (failure === "menu") throw Error("No menu");
      });
      this.destroy = jest.fn(() => {
        this.dead = true;
      });
      instances.push(this);
    }
    isDestroyed() {
      return this.dead;
    }
  }
  const callbacks = {
    onSelect: jest.fn(),
    onUnlock: jest.fn(),
    onReturn: jest.fn(),
    onQuit: jest.fn(),
  };
  const controller = create({
    Tray,
    Menu: { buildFromTemplate: (value) => value },
    icon: "icon.png",
    ...callbacks,
  });
  return {
    controller,
    callbacks,
    instances,
    construct,
    fail: (value) => {
      failure = value;
    },
    menu: () => instances.at(-1).setContextMenu.mock.calls.at(-1)[0],
  };
}

test("construction and choice updates are lazy; first creation uses cached order, selection and presentation", () => {
  const f = setup();
  f.controller.setChoices(choices());
  f.controller.setPresentation({ active: true, locked: true });
  expect(f.construct).not.toHaveBeenCalled();
  expect(f.controller.isAvailable()).toBe(false);
  expect(f.controller.ensure()).toBe(true);
  expect(f.controller.ensure()).toBe(true);
  expect(f.construct).toHaveBeenCalledTimes(1);
  expect(f.instances[0].setToolTip).toHaveBeenCalledWith("Audio Visualizer");
  expect(f.menu().map((item) => item.label || item.type)).toEqual([
    "Visual mode",
    "Color theme",
    "separator",
    "Unlock mini overlay",
    "Return to normal",
    "separator",
    "Quit",
  ]);
  expect(f.menu()[0].submenu.map((item) => [item.label, item.checked])).toEqual(
    [
      ["Prism", false],
      ["Bars", true],
    ]
  );
  expect(f.menu()[1].submenu.map((item) => item.checked)).toEqual([
    true,
    false,
  ]);
  expect(f.menu()[3].enabled).toBe(true);
  f.controller.setPresentation({ active: false, locked: false });
  expect(f.menu()[3].enabled).toBe(false);
  expect(f.controller.isAvailable()).toBe(true);
});

test.each(["constructor", "tooltip", "menu"])(
  "failed %s creation cleans up and a later entry can retry",
  (failure) => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const f = setup();
      f.fail(failure);
      expect(f.controller.ensure()).toBe(false);
      expect(f.controller.isAvailable()).toBe(false);
      for (const tray of f.instances) {
        expect(tray.destroy).toHaveBeenCalledTimes(1);
        expect(tray.listenerCount("double-click")).toBe(0);
      }
      f.fail(null);
      expect(f.controller.ensure()).toBe(true);
      expect(f.construct).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  }
);

test("valid updates refresh choices; malformed values leave the existing menu untouched", () => {
  const f = setup();
  f.controller.ensure();
  expect(f.menu()[0].enabled).toBe(false);
  f.controller.setChoices(choices());
  const previous = f.menu();
  for (const value of [
    null,
    {},
    "invalid",
    { ...choices(), mode: "unknown" },
    { ...choices(), theme: "unknown" },
    { ...choices(), modes: [] },
    { ...choices(), themes: null },
    { ...choices(), modes: [{ id: 1, label: "Invalid" }] },
    { ...choices(), themes: [{ id: "Ice", label: null }] },
    {
      ...choices(),
      modes: [
        { id: "bars", label: "A" },
        { id: "bars", label: "B" },
      ],
    },
    {
      ...choices(),
      modes: Array.from({ length: 101 }, (_, i) => ({
        id: String(i),
        label: "A",
      })),
    },
    { ...choices(), themes: [{ id: "Ice", label: "a".repeat(101) }] },
  ]) {
    f.controller.setChoices(value);
    expect(f.menu()).toBe(previous);
  }
  f.controller.setChoices({ ...choices(), mode: "prism" });
  expect(f.menu()[0].submenu[0].checked).toBe(true);
});

test("menu callbacks and double-click dispatch only injected operations; disposal guards retained callbacks", () => {
  const f = setup();
  f.controller.setChoices(choices());
  f.controller.ensure();
  const menu = f.menu(),
    tray = f.instances[0];
  menu[0].submenu[0].click();
  menu[1].submenu[1].click();
  menu[3].click();
  menu[4].click();
  menu[6].click();
  tray.emit("double-click");
  expect(f.callbacks.onSelect.mock.calls).toEqual([
    [{ kind: "mode", id: "prism" }],
    [{ kind: "theme", id: "Neon" }],
  ]);
  expect(f.callbacks.onUnlock).toHaveBeenCalledTimes(1);
  expect(f.callbacks.onReturn).toHaveBeenCalledTimes(2);
  expect(f.callbacks.onQuit).toHaveBeenCalledTimes(1);
  f.controller.dispose();
  f.controller.dispose();
  expect(tray.destroy).toHaveBeenCalledTimes(1);
  expect(tray.listenerCount("double-click")).toBe(0);
  menu[0].submenu[0].click();
  menu[3].click();
  menu[4].click();
  menu[6].click();
  tray.emit("double-click");
  expect(f.callbacks.onSelect).toHaveBeenCalledTimes(2);
  expect(f.callbacks.onReturn).toHaveBeenCalledTimes(2);
  expect(f.callbacks.onUnlock).toHaveBeenCalledTimes(1);
  expect(f.callbacks.onQuit).toHaveBeenCalledTimes(1);
  expect(f.controller.ensure()).toBe(false);
  f.controller.setChoices(choices());
  f.controller.setPresentation({ active: true, locked: true });
  expect(f.construct).toHaveBeenCalledTimes(1);
});

test("IPC accepts only the current live renderer and unregisters its listener", () => {
  const ipc = new EventEmitter();
  const setChoices = jest.fn();
  let contents = { isDestroyed: () => false };
  const remove = registerIpc(
    ipc,
    () => contents,
    () => ({ setChoices })
  );
  ipc.emit("tray-settings", { sender: {} }, choices());
  expect(setChoices).not.toHaveBeenCalled();
  ipc.emit("tray-settings", { sender: contents }, choices());
  expect(setChoices).toHaveBeenCalledTimes(1);
  const old = contents;
  contents = { isDestroyed: () => false };
  ipc.emit("tray-settings", { sender: old }, choices());
  expect(setChoices).toHaveBeenCalledTimes(1);
  contents.isDestroyed = () => true;
  ipc.emit("tray-settings", { sender: contents }, choices());
  expect(setChoices).toHaveBeenCalledTimes(1);
  remove();
  remove();
  expect(ipc.listenerCount("tray-settings")).toBe(0);
});
