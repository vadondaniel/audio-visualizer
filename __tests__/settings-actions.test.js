const Actions = require("../src/settings-actions");
const registry = require("../src/mode-registry");
const modeList = require("../src/mode-list");
const { setup: visualFixture } = require("./helpers/mode-fixture.cjs");

function setup(overrides = {}) {
  const fixture = visualFixture("bars");
  const state = Object.assign(fixture.settings, overrides);
  const order = [];
  const effects = Object.fromEntries(
    [
      "syncControls",
      "modeOptions",
      "modeManager",
      "visualOptions",
      "theme",
      "themeOptions",
      "themeManager",
      "labels",
      "backgroundRows",
      "background",
      "fx",
      "trailRows",
      "bassRows",
      "resetTrails",
      "media",
      "wakeLock",
      "mediaWatching",
      "clearImageInput",
    ].map((name) => [name, jest.fn(() => order.push(name))])
  );
  const save = jest.fn(() => order.push("save"));
  const timers = {
    setInterval: jest.fn((cb, ms) => setInterval(cb, ms)),
    clearInterval: jest.fn((id) => clearInterval(id)),
  };
  const actions = Actions.create({
    state,
    registry,
    modeList,
    themeIds: fixture.constants.THEMES.map((theme) => theme.name),
    save,
    effects,
    timers,
  });
  return { state, actions, effects, save, order, timers };
}

test("overlay background is one persisted action without changing normal visual settings", () => {
  const a = setup({
    miniOverlayShowBackground: false,
    bgType: "grid",
    bgColor: "#123456",
  });
  a.actions.set("miniOverlayShowBackground", true);
  expect(a.state).toMatchObject({
    miniOverlayShowBackground: true,
    bgType: "grid",
    bgColor: "#123456",
  });
  expect(a.effects.syncControls).toHaveBeenCalledWith([
    "miniOverlayShowBackground",
  ]);
  expect(a.effects.background).not.toHaveBeenCalled();
  expect(a.effects.resetTrails).not.toHaveBeenCalled();
  expect(a.save).toHaveBeenCalledTimes(1);
});

test("state is complete before targeted synchronization and persistence runs last", () => {
  const a = setup();
  a.effects.syncControls.mockImplementation((keys) => {
    expect(keys).toEqual(["sensitivity"]);
    expect(a.state.sensitivity).toBe(2.1);
    a.order.push("syncControls");
  });
  a.actions.set("sensitivity", 2.1);
  expect(a.order).toEqual(["syncControls", "labels", "save"]);
  expect(a.save).toHaveBeenCalledTimes(1);
});

test("theme preferences preserve canonical selection, cycle enabled order, and save once", () => {
  const a = setup();
  a.actions.setThemePreferences({
    order: ["Ice", "Fire", "Neon"],
    disabled: a.state.themeOrder.filter((id) => !["Ice", "Neon"].includes(id)),
  });
  expect(a.state.theme).toBe(0);
  expect(a.save).toHaveBeenCalledTimes(1);
  a.actions.cycleTheme();
  expect(a.state.theme).toBe(3);
  a.actions.cycleTheme();
  expect(a.state.theme).toBe(0);
  // Disabling the selected theme chooses the first enabled item.
  a.save.mockClear();
  a.actions.setThemePreferences({
    order: ["Ice", "Fire", "Neon"],
    disabled: ["Ice", "Neon"],
  });
  expect(a.state.theme).toBe(1);
  expect(a.save).toHaveBeenCalledTimes(1);
  expect(a.effects.themeOptions).toHaveBeenCalledTimes(2);
});
test("theme normalization deduplicates, appends additions, and keeps one theme enabled", () => {
  const a = setup({
    theme: 7,
    themeOrder: ["Fire", "Fire", "unknown"],
    disabledThemes: ["unknown", "Fire"],
  });
  a.actions.initialize();
  expect(a.state.theme).toBe(7);
  expect(a.state.themeOrder.slice(0, 2)).toEqual(["Fire", "Neon"]);
  expect(a.state.disabledThemes).toEqual(["Fire"]);
  expect(a.save).not.toHaveBeenCalled();
  const order = [...a.state.themeOrder];
  a.actions.setThemePreferences({ order, disabled: order });
  expect(a.state.disabledThemes).not.toContain(order[0]);
  expect(a.state.theme).toBe(1);
});

test("independent overlay selection and shortcuts leave normal selection and mode simulations alone", () => {
  const a = setup();
  a.actions.selectOverlayMode("orbit");
  expect(a.state).toMatchObject({ mode: 0, miniOverlayMode: "orbit" });
  expect(a.save).toHaveBeenCalledTimes(1);
  expect(a.effects.resetTrails).not.toHaveBeenCalled();
  a.actions.selectActiveMode("prism", true);
  expect(a.state).toMatchObject({ mode: 0, miniOverlayMode: "prism" });
  a.actions.nextMode();
  expect(a.state.mode).toBe(1);
  expect(a.state.miniOverlayMode).toBe("prism");
  a.actions.selectActiveMode("waves", false);
  expect(a.state.mode).toBe(6);
  expect(a.state.miniOverlayMode).toBe("prism");
  a.actions.selectOverlayMode("follow");
  a.actions.selectActiveMode("bars", true);
  expect(a.state.mode).toBe(0);
  expect(a.state.miniOverlayMode).toBe("follow");
});
test("overlay preferences fall back atomically when disabled; unknown IDs restore to follow without saving", () => {
  const a = setup({ miniOverlayMode: "orbit" });
  a.actions.setModePreferences({
    order: [...registry.ids].reverse(),
    disabled: ["orbit"],
  });
  expect(a.state.miniOverlayMode).toBe("prism");
  expect(a.save).toHaveBeenCalledTimes(1);
  const saves = a.save.mock.calls.length;
  a.actions.selectOverlayMode("orbit");
  a.actions.selectOverlayMode("missing");
  expect(a.save).toHaveBeenCalledTimes(saves);
  a.state.miniOverlayMode = "unknown";
  a.actions.initialize();
  expect(a.state.miniOverlayMode).toBe("follow");
  expect(a.save).toHaveBeenCalledTimes(saves);
});
test.each([
  ["miniOverlayScale", 1.5],
  ["miniOverlayOpacity", 0.5],
  ["miniOverlayMaxFps", 30],
])("%s synchronizes and saves once without unrelated effects", (key, value) => {
  const a = setup();
  a.actions.set(key, value);
  expect(a.state[key]).toBe(value);
  expect(a.order).toEqual(["syncControls", "save"]);
  expect(a.effects.resetTrails).not.toHaveBeenCalled();
});

test.each([
  ["bassSensitivityEnabled", true, ["bassRows"]],
  ["bassSensitivityAmount", 0.75, ["labels"]],
  ["valueHandling", "linear", []],
  ["trailsEnabled", false, ["trailRows", "resetTrails"]],
  ["trailsEnabled", true, ["trailRows"]],
  ["trailDuration", 300, ["labels", "resetTrails"]],
  ["trailMaxFps", 30, ["labels", "resetTrails"]],
  ["bgBrightness", 0.8, ["labels", "background"]],
  ["bgBlur", 4, ["labels", "background"]],
  ["bgType", "grid", ["backgroundRows", "background"]],
  ["bgColor", "#abcdef", ["background"]],
  ["crtFilter", true, ["fx"]],
  ["reactiveVignette", false, ["fx"]],
  ["beatFlash", false, ["fx"]],
  ["particleDensity", 0.8, ["labels"]],
  ["wakeLockEnabled", true, ["wakeLock"]],
  ["wakeLockEnabled", false, ["wakeLock"]],
  ["mediaMetadataEnabled", true, ["media", "mediaWatching"]],
  ["mediaDisplay", "title", ["media"]],
  ["theme", 3, ["visualOptions", "theme", "media"]],
])(
  "%s uses its effects once, without unrelated work",
  (key, value, expected) => {
    const a = setup();
    a.actions.set(key, value);
    expect(a.state[key]).toBe(value);
    expect(a.order).toEqual(["syncControls", ...expected, "save"]);
    for (const effect of Object.values(a.effects))
      expect(effect.mock.calls.length).toBeLessThanOrEqual(1);
    expect(a.save).toHaveBeenCalledTimes(1);
    if (key === "wakeLockEnabled")
      expect(a.effects.wakeLock).toHaveBeenCalledWith(value);
    if (key === "mediaMetadataEnabled")
      expect(a.effects.mediaWatching).toHaveBeenCalledWith(value);
  }
);

test("background images change atomically, apply once, and clear the file control", () => {
  const a = setup();
  a.effects.background.mockImplementation(() => {
    expect(a.state.bgType).toBe("image");
    expect(a.state.bgImageName).toBe("cover.png");
    expect(a.state.bgImageDataUrl).toBe("data:image/png;base64,test");
    a.order.push("background");
  });
  a.actions.setBackgroundImage({
    dataUrl: "data:image/png;base64,test",
    name: "cover.png",
  });
  expect(a.order).toEqual([
    "syncControls",
    "backgroundRows",
    "background",
    "save",
  ]);
  a.effects.background.mockImplementation(() => a.order.push("background"));
  a.order.length = 0;
  a.save.mockClear();
  a.actions.clearBackgroundImage();
  expect(a.state).toMatchObject({
    bgType: "color",
    bgImageName: null,
    bgImageDataUrl: null,
  });
  expect(a.order).toEqual([
    "clearImageInput",
    "syncControls",
    "backgroundRows",
    "background",
    "save",
  ]);
  expect(a.save).toHaveBeenCalledTimes(1);
});

test("mode selection and cycling share effects and retain numeric selection", () => {
  const order = ["prism", "waves", "radial", ...registry.ids];
  const a = setup({
    modeOrder: modeList.normalize(registry.ids, order, []).modeOrder,
    mode: 10,
    disabledModes: ["waves"],
  });
  a.actions.nextMode();
  expect(a.state.mode).toBe(1);
  const trace = [...a.order];
  a.order.length = 0;
  a.actions.selectMode("radial");
  expect(a.order).toEqual(trace);
  expect(trace).toEqual(["syncControls", "visualOptions", "media", "save"]);
  a.save.mockClear();
  a.actions.selectMode("waves");
  a.actions.selectMode("unknown");
  expect(a.save).not.toHaveBeenCalled();
});

test("mode preferences preserve order, keep selection, and fall back when disabled", () => {
  const a = setup({ mode: 9 });
  const order = [...registry.ids].reverse();
  a.actions.setModePreferences({ order, disabled: ["bars"] });
  expect(a.state.mode).toBe(9);
  expect(a.state.modeOrder).toEqual(order);
  expect(a.state.modeOrder).not.toBe(order);
  a.order.length = 0;
  a.save.mockClear();
  a.actions.setModePreferences({ order, disabled: ["orbit"] });
  expect(a.state.mode).toBe(10);
  expect(a.order).toEqual([
    "modeOptions",
    "syncControls",
    "visualOptions",
    "media",
    "modeManager",
    "save",
  ]);
  expect(a.save).toHaveBeenCalledTimes(1);
  a.actions.setModePreferences({ order, disabled: order });
  expect(modeList.enabled(a.state.modeOrder, a.state.disabledModes)).toEqual([
    "prism",
  ]);
  expect(order).toEqual([...registry.ids].reverse());
});

test("only the active media position is repaired, using registry capabilities", () => {
  const a = setup();
  a.state.mediaTextPositions.bars = "above";
  a.state.mediaTextPositions.radial = "top";
  a.actions.selectMode("bars");
  expect(a.state.mediaTextPositions.bars).toBe("top");
  expect(a.state.mediaTextPositions.radial).toBe("top");
  a.actions.selectMode("radial");
  expect(a.state.mediaTextPositions.radial).toBe("below");
  a.actions.setMediaPosition("radial", "above");
  expect(a.state.mediaTextPositions.radial).toBe("above");
  a.actions.selectMode("bars");
  a.actions.selectMode("radial");
  expect(a.state.mediaTextPositions.radial).toBe("above");
  a.save.mockClear();
  a.actions.setMediaPosition("unknown", "top");
  a.actions.setMediaPosition("bars", "invalid");
  expect(a.save).not.toHaveBeenCalled();
});

test("theme cycling wraps without resetting trails or simulation", () => {
  const a = setup({ theme: 13 });
  a.actions.cycleTheme();
  expect(a.state.theme).toBe(0);
  expect(a.order).toEqual([
    "syncControls",
    "visualOptions",
    "theme",
    "media",
    "save",
  ]);
});

describe("timer ownership and restoration", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test("enabling replaces one interval; ticks use mode actions; disabling and disposal clear it", () => {
    const a = setup();
    a.actions.set("autoCycle", true);
    expect(jest.getTimerCount()).toBe(1);
    a.actions.set("autoCycle", true);
    expect(jest.getTimerCount()).toBe(1);
    expect(a.timers.clearInterval).toHaveBeenCalledTimes(1);
    expect(a.timers.setInterval).toHaveBeenLastCalledWith(
      expect.any(Function),
      12000
    );
    a.order.length = 0;
    a.save.mockClear();
    jest.advanceTimersByTime(12000);
    expect(a.state.mode).toBe(1);
    expect(a.order).toEqual(["syncControls", "visualOptions", "media", "save"]);
    a.actions.set("autoCycle", false);
    expect(jest.getTimerCount()).toBe(0);
    a.actions.set("autoCycle", true);
    a.actions.dispose();
    expect(jest.getTimerCount()).toBe(0);
  });
  test("initialize synchronizes restored state without saving, resetting trails, or requesting wake lock", () => {
    const a = setup({
      autoCycle: true,
      mediaMetadataEnabled: true,
      wakeLockEnabled: true,
      disabledModes: ["bars"],
    });
    a.actions.initialize();
    expect(a.state.mode).toBe(1);
    expect(a.effects.syncControls).toHaveBeenCalledWith("all");
    expect(a.effects.mediaWatching).toHaveBeenCalledWith(true);
    expect(a.effects.wakeLock).not.toHaveBeenCalled();
    expect(a.effects.resetTrails).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(1);
    a.actions.initialize();
    expect(jest.getTimerCount()).toBe(1);
    a.actions.dispose();
  });
  test("a zero-valued timer handle is cleaned up", () => {
    const a = setup();
    a.timers.setInterval.mockReturnValue(0);
    a.actions.set("autoCycle", true);
    a.actions.dispose();
    expect(a.timers.clearInterval).toHaveBeenCalledWith(0);
  });
});
