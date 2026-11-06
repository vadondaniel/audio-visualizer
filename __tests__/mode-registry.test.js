const Registry = require("../src/mode-registry");
const Pipeline = require("../src/audio-pipeline");
const Runtime = require("../src/mode-runtime");
const Entry = require("../src/renderer-entry");
const { setup } = require("./helpers/mode-fixture.cjs");

const originalIds = [
  "bars",
  "radial",
  "waveform",
  "particles",
  "kaleidoscope",
  "tunnel",
  "waves",
  "aurora",
  "cascade",
  "orbit",
  "prism",
];
const synthetic = {
  ...Registry.get("bars"),
  id: "test-mode",
  label: "Test Mode",
  modulePath: "visuals/test-mode.js",
  media: { ...Registry.get("bars").media, defaultPosition: "bottom" },
};
const lifecycle = () => ({ update() {}, draw() {}, reset() {} });

test("canonical indices, labels and original media defaults remain compatible", () => {
  expect(Registry.ids.slice(0, 11)).toEqual(originalIds);
  for (const [index, id] of originalIds.entries()) {
    expect(Registry.indexOf(id)).toBe(index);
    expect(Registry.get(id).label).toBe(id[0].toUpperCase() + id.slice(1));
  }
  expect(Registry.mediaDefaults()).toMatchObject({
    bars: "top",
    radial: "below",
    waveform: "auto",
    particles: "auto",
    kaleidoscope: "auto",
    tunnel: "auto",
    waves: "auto",
    aurora: "auto",
    cascade: "below",
    orbit: "bottom-left",
    prism: "bottom-left",
  });
  expect(Registry.indexOf("missing")).toBe(-1);
  expect(Registry.get("missing")).toBeUndefined();
});
test("definitions and derived profile views are immutable; settings get fresh defaults", () => {
  expect(Object.isFrozen(Registry.entries)).toBe(true);
  expect(Object.isFrozen(Registry.ids)).toBe(true);
  for (const entry of Registry.entries) {
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.audio)).toBe(true);
    expect(Object.isFrozen(entry.media)).toBe(true);
    expect(Registry.audioProfiles[entry.id]).toBe(entry.audio);
  }
  const defaults = Registry.mediaDefaults();
  defaults.bars = "bottom";
  expect(Registry.mediaDefaults().bars).toBe("top");
  expect(Pipeline.PROFILES).toBe(Registry.audioProfiles);
});

test("style profiles resolve to immutable registry objects with safe base fallbacks", () => {
  const base = Registry.audioProfiles.waveform;
  const prism = base.variants.profiles.prism;
  expect(
    Registry.resolveAudioProfile("waveform", { waveformStyle: "prism" })
  ).toBe(prism);
  for (const waveformStyle of [
    "line",
    "filled",
    undefined,
    "unknown",
    "toString",
    "__proto__",
  ])
    expect(Registry.resolveAudioProfile("waveform", { waveformStyle })).toBe(
      base
    );
  expect(Registry.resolveAudioProfile("bars", { waveformStyle: "prism" })).toBe(
    Registry.audioProfiles.bars
  );
  expect(() => Registry.resolveAudioProfile("missing", {})).toThrow(
    "Unknown audio profile"
  );
  for (const value of [base.variants, base.variants.profiles, prism])
    expect(Object.isFrozen(value)).toBe(true);
  const original = {
    setting: "waveformStyle",
    profiles: { prism: { sampler: "prism", count: 96, release: 10 } },
  };
  const custom = Registry.createRegistry([
    { ...synthetic, audio: { ...synthetic.audio, variants: original } },
  ]);
  original.profiles.prism.count = 1;
  original.profiles.extra = { sampler: "bars", count: 1, release: 1 };
  expect(
    custom.resolveAudioProfile("test-mode", { waveformStyle: "prism" }).count
  ).toBe(96);
  expect(Object.keys(custom.get("test-mode").audio.variants.profiles)).toEqual([
    "prism",
  ]);
});

test.each([
  null,
  {
    setting: "unsupported",
    profiles: { prism: { sampler: "prism", count: 96, release: 10 } },
  },
  { setting: "waveformStyle", profiles: {} },
  { setting: "waveformStyle", profiles: [] },
  { setting: "waveformStyle", profiles: { prism: { count: 96, release: 10 } } },
  {
    setting: "waveformStyle",
    profiles: { prism: { sampler: "prism", count: -1, release: 10 } },
  },
  {
    setting: "waveformStyle",
    profiles: { prism: { sampler: "prism", count: 96, release: 0 } },
  },
  {
    setting: "waveformStyle",
    profiles: {
      prism: { sampler: "prism", count: 96, release: 10, variants: {} },
    },
  },
])(
  "invalid audio variants fail during registry construction: %p",
  (variants) => {
    expect(() =>
      Registry.createRegistry([
        { ...synthetic, audio: { ...synthetic.audio, variants } },
      ])
    ).toThrow(/audio (variants|profile)/);
  }
);
test.each(["getRenderBounds", "getOverlayBounds"])(
  "invalid optional %s method fails lifecycle validation",
  (method) => {
    const registry = Registry.createRegistry([synthetic]);
    registry.registerFactory("test-mode", () => ({
      ...lifecycle(),
      [method]: 1,
    }));
    expect(() => registry.getFactories()["test-mode"]({})).toThrow(
      "Invalid lifecycle"
    );
  }
);

test("invalid definitions and factory registrations fail explicitly", () => {
  expect(() => Registry.createRegistry([synthetic, synthetic])).toThrow(
    "duplicate mode ID"
  );
  expect(() =>
    Registry.createRegistry([{ ...synthetic, modulePath: "" }])
  ).toThrow("Incomplete");
  expect(() => Registry.createRegistry([{ ...synthetic, audio: {} }])).toThrow(
    "audio profile"
  );
  const registry = Registry.createRegistry([synthetic]);
  expect(() => registry.registerFactory("missing", lifecycle)).toThrow(
    "Unknown"
  );
  expect(() => registry.getFactories()).toThrow("Missing");
  expect(() => registry.registerFactory("test-mode", null)).toThrow("Invalid");
  registry.registerFactory("test-mode", lifecycle);
  expect(() => registry.registerFactory("test-mode", lifecycle)).toThrow(
    "Duplicate"
  );
  expect(Object.keys(registry.getFactories())).toEqual(["test-mode"]);
});
test.each([
  () => null,
  () => ({ update() {}, draw() {} }),
  () => ({ update: 1, draw() {}, reset() {} }),
])("invalid instance lifecycle is rejected before rendering", (factory) => {
  const registry = Registry.createRegistry([synthetic]);
  registry.registerFactory("test-mode", factory);
  expect(() => Runtime.createController(registry.getFactories(), {})).toThrow(
    "Invalid lifecycle"
  );
});
test("synthetic entries are discovered and use the declared sampler rather than their ID", async () => {
  const registry = Registry.createRegistry([...Registry.entries, synthetic]);
  const loads = [];
  await registry.loadFactories(async (module) => {
    loads.push(module);
    const entry = registry.entries.find((entry) => entry.modulePath === module);
    registry.registerFactory(entry.id, lifecycle);
  });
  expect(loads).toEqual(registry.entries.map((entry) => entry.modulePath));
  expect(registry.ids.at(-1)).toBe("test-mode");
  expect(registry.mediaDefaults()["test-mode"]).toBe("bottom");
  const f = setup("bars");
  const pipeline = Pipeline.create({ registry });
  pipeline.update({ ...f.frame.audio, beatPulse: 0 }, f.settings, f.frame);
  expect(Array.from(pipeline.forMode("test-mode").bands)).toEqual(
    Array.from(pipeline.forMode("bars").bands)
  );
  expect(Object.keys(registry.getFactories())).toEqual(registry.ids);
});

test.each(["bars", "prism", "aurora"])(
  "a registry containing only an alias can use the %s sampler",
  (sampler) => {
    const definition = {
      ...synthetic,
      audio: { ...Registry.get(sampler).audio },
    };
    const registry = Registry.createRegistry([definition]);
    const f = setup("bars"),
      pipeline = Pipeline.create({ registry });
    pipeline.update({ ...f.frame.audio, beatPulse: 0 }, f.settings, f.frame);
    expect(pipeline.forMode("test-mode").bands.length).toBe(
      definition.audio.count
    );
  }
);
test("loader waits for each module, caches readiness and starts dependents only after registration", async () => {
  const registry = Registry.createRegistry([synthetic]);
  const order = [];
  let release;
  const promise = Entry.initialize(registry, async (path) => {
    order.push(path);
    if (path === synthetic.modulePath) {
      await new Promise((resolve) => {
        release = resolve;
      });
      registry.registerFactory("test-mode", lifecycle);
    }
  });
  await Promise.resolve();
  expect(order).toEqual([synthetic.modulePath]);
  expect(
    registry.loadFactories(() => {
      throw Error("second load");
    })
  ).toBe(registry.loadFactories(() => {}));
  release();
  await promise;
  expect(order).toEqual([
    synthetic.modulePath,
    "renderer-bridge.js",
    "visual-mode-host.js",
    "visuals/loop.js",
    "settings-actions.js",
    "media.js",
    "preference-manager.js",
    "mode-controls.js",
    "theme-controls.js",
    "settings-ui.js",
    "ui.js",
    "mini-overlay-math.js",
    "mini-overlay-ui.js",
    "tray-controls.js",
  ]);
});
test("missing modules and missing registrations prevent dependent startup", async () => {
  const loader = jest.fn().mockRejectedValue(Error("missing file"));
  await expect(
    Entry.initialize(Registry.createRegistry([synthetic]), loader)
  ).rejects.toThrow("missing file");
  expect(loader).toHaveBeenCalledTimes(1);
  await expect(
    Entry.initialize(Registry.createRegistry([synthetic]), async () => {})
  ).rejects.toThrow("did not register");
});
test("script loader propagates network and runtime errors and removes temporary error listeners", async () => {
  const listeners = new Set();
  let script;
  const document = {
    defaultView: {
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
    },
    createElement: () => ({}),
    body: {
      appendChild: (value) => {
        script = value;
      },
    },
  };
  const load = Entry.scriptLoader(document);
  const missing = load("missing.js");
  script.onerror();
  await expect(missing).rejects.toThrow("Could not load missing.js");
  expect(listeners.size).toBe(0);
  const broken = load("broken.js");
  for (const listener of [...listeners])
    listener({ filename: "broken.js", message: "runtime failure" });
  await expect(broken).rejects.toThrow("runtime failure");
  expect(listeners.size).toBe(0);
  const good = load("good.js");
  script.onload();
  await good;
  expect(listeners.size).toBe(0);
});
