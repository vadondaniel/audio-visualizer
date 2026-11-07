const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const Registry = require("../src/mode-registry"),
  MathAudio = require("../src/audio-math"),
  ModeList = require("../src/mode-list");
const { migratePrismLayout } = require("../src/settings-migrations");
const { setup } = require("./helpers/mode-fixture.cjs");
const index = (id) => Registry.indexOf(id);

test.each([
  ["waveform", "prism", "straight"],
  ["prism", "waveform", "circular"],
  ["waveform", "follow", "straight"],
  ["bars", "waveform", "straight"],
  ["bars", "prism", "circular"],
  ["bars", "follow", "straight"],
])(
  "legacy %s / %s preserves the agreed priority as %s",
  (normal, mini, layout) => {
    const saved = {
      mode: index(normal),
      miniOverlayMode: mini,
      waveformStyle: "prism",
      modeOrder: [...Registry.ids].reverse(),
      disabledModes: ["prism", "tunnel"],
      mediaTextPositions: Registry.mediaDefaults(),
    };
    const before = structuredClone(saved),
      result = migratePrismLayout(saved, Registry);
    expect(result.prismLayout).toBe(layout);
    expect(result.waveformStyle).toBe("line");
    expect(result.mode).toBe(index(normal === "waveform" ? "prism" : normal));
    expect(result.miniOverlayMode).toBe(mini === "waveform" ? "prism" : mini);
    expect(result.modeOrder).toEqual(saved.modeOrder);
    expect(result.mediaTextPositions).toEqual(saved.mediaTextPositions);
    expect(saved).toEqual(before);
    expect(result.disabledModes.includes("prism")).toBe(
      normal !== "waveform" && mini !== "waveform"
    );
    expect(result.disabledModes).toContain("tunnel");
    expect(migratePrismLayout(result, Registry)).toBe(result);
  }
);
test.each(["circular", "straight"])(
  "valid explicit %s layout takes precedence over legacy conflicts",
  (prismLayout) => {
    for (const normal of ["waveform", "prism"])
      expect(
        migratePrismLayout(
          {
            mode: index(normal),
            miniOverlayMode: "waveform",
            waveformStyle: "prism",
            prismLayout,
          },
          Registry
        ).prismLayout
      ).toBe(prismLayout);
  }
);
test.each([
  null,
  undefined,
  [],
  {},
  "invalid",
  { waveformStyle: "line" },
  { waveformStyle: "filled" },
  { waveformStyle: "unknown" },
])("nonlegacy preferences remain untouched: %p", (saved) => {
  expect(migratePrismLayout(saved, Registry)).toBe(saved);
});
test("unknown values use normal validation; layouts only accept circular/straight", () => {
  const defaults = { waveformStyle: "line", prismLayout: "circular", mode: 0 };
  for (const prismLayout of ["circular", "straight"])
    expect(
      MathAudio.mergeSettings(defaults, { prismLayout }, 11, 14).prismLayout
    ).toBe(prismLayout);
  for (const prismLayout of [null, "circle", "line", true, 1])
    expect(
      MathAudio.mergeSettings(defaults, { prismLayout }, 11, 14).prismLayout
    ).toBe("circular");
  expect(
    MathAudio.mergeSettings(defaults, { waveformStyle: "prism" }, 11, 14)
      .waveformStyle
  ).toBe("line");
  const migrated = migratePrismLayout(
    {
      mode: 999,
      miniOverlayMode: "missing",
      waveformStyle: "prism",
      prismLayout: "invalid",
    },
    Registry
  );
  expect(migrated.mode).toBe(999);
  expect(migrated.miniOverlayMode).toBe("missing");
  expect(migrated.prismLayout).toBe("straight");
});
test("real restoration migrates without saving, repeats safely, and persists the new format on the next save", () => {
  const fixture = setup("bars");
  let raw = JSON.stringify({
    mode: index("waveform"),
    miniOverlayMode: "waveform",
    waveformStyle: "prism",
    disabledModes: ["prism"],
    modeOrder: [...Registry.ids].reverse(),
  });
  const localStorage = {
    getItem: jest.fn(() => raw),
    setItem: jest.fn((key, value) => {
      raw = value;
    }),
  };
  const context = {
    MODES: Registry.ids,
    THEMES: fixture.constants.THEMES,
    ModeRegistry: Registry,
    ModeList,
    SettingsMigrations: { migratePrismLayout },
    mergeSettings: MathAudio.mergeSettings,
    localStorage,
    TRAIL_DURATION_MS: 220,
    TRAIL_MAX_FPS: 60,
    console,
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/state.js"), "utf8"),
    context
  );
  const read = () =>
    vm.runInContext("JSON.parse(JSON.stringify(state))", context);
  vm.runInContext("restoreSettings()", context);
  const migrated = read();
  expect(migrated).toMatchObject({
    mode: index("prism"),
    miniOverlayMode: "prism",
    waveformStyle: "line",
    prismLayout: "straight",
  });
  expect(migrated.disabledModes).not.toContain("prism");
  expect(localStorage.setItem).not.toHaveBeenCalled();
  vm.runInContext("restoreSettings()", context);
  expect(read()).toEqual(migrated);
  expect(localStorage.setItem).not.toHaveBeenCalled();
  vm.runInContext("saveSettings();restoreSettings()", context);
  expect(read()).toEqual(migrated);
  expect(localStorage.setItem).toHaveBeenCalledTimes(1);
  expect(JSON.parse(raw)).toMatchObject({
    waveformStyle: "line",
    prismLayout: "straight",
  });
});
