const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const readSource = (name) =>
  fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const visualsSource = readSource("visuals.js");

function setup(fps = 60, duration = 220) {
  let captures = 0;
  let canvases = 0;
  const compositeAlphas = [];
  const compositeCalls = [];
  const captureCalls = [];
  const surfaces = [];
  const displayCtx = {
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {
      compositeAlphas.length = 0;
      compositeCalls.length = 0;
    },
    drawImage(...args) {
      compositeAlphas.push(this.globalAlpha);
      compositeCalls.push(args);
    },
  };
  const context = {
    TrailMath: require("../src/trail-math"),
    state: { trailsEnabled: true, trailDuration: duration, trailMaxFps: fps },
    renderCanvas: { width: 16, height: 16 },
    canvas: { width: 16, height: 16 },
    bgCanvas: null,
    window: { innerWidth: 320, innerHeight: 240 },
    displayCtx,
    document: {
      createElement() {
        canvases++;
        const surface = {
          width: 0,
          height: 0,
          getContext: () => ({
            clearRect() {},
            drawImage(...args) {
              captures++;
              captureCalls.push({
                args,
                width: surface.width,
                height: surface.height,
              });
            },
          }),
        };
        surfaces.push(surface);
        return surface;
      },
    },
    updateSliderLabels: jest.fn(),
    saveSettings: jest.fn(),
  };
  vm.createContext(context);
  vm.runInContext(visualsSource, context);
  const render = vm.runInContext("renderTrailHistory", context);
  return {
    context,
    render,
    frames: vm.runInContext("trailFrames", context),
    pool: vm.runInContext("trailCanvasPool", context),
    evaluate: (code) => vm.runInContext(code, context),
    captures: () => captures,
    canvases: () => canvases,
    compositeAlphas,
    compositeCalls,
    captureCalls,
    surfaces,
  };
}

test.each(
  [60, 120, 144, 165, 240].flatMap((hz) =>
    [15, 30, 60, 120, 240].map((fps) => [hz, fps])
  )
)("trail rendering sustains its capture cap: %i Hz / %i FPS", (hz, fps) => {
  const app = setup(fps);
  const limit = app.evaluate("getTrailSnapshotLimit()");
  let maxCapturedPerFrame = 0;
  let maxRetained = 0;
  let expiredFrameRetained = false;
  for (let frame = 0; frame < hz * 10; frame++) {
    const now = (frame * 1000) / hz;
    const before = app.captures();
    app.render(now);
    maxCapturedPerFrame = Math.max(
      maxCapturedPerFrame,
      app.captures() - before
    );
    maxRetained = Math.max(maxRetained, app.frames.length);
    expiredFrameRetained ||= app.frames.some((f) => now - f.timestamp >= 220);
  }
  expect(maxCapturedPerFrame).toBe(1);
  expect(maxRetained).toBeLessThanOrEqual(limit);
  expect(expiredFrameRetained).toBe(false);
  expect(Math.abs(app.captures() - Math.min(hz, fps) * 10)).toBeLessThanOrEqual(
    1
  );
  expect(app.canvases()).toBeLessThanOrEqual(limit);
  expect(app.frames.length + app.pool.length).toBe(app.canvases());
});

test("uses actual capture times for fading and still presents uncaptured render frames", () => {
  const app = setup();
  app.render(0);
  app.render(20); // Capture is scheduled for 16.67 ms, but rendered at 20 ms.
  app.render(25); // Not due for another snapshot.
  expect(app.captures()).toBe(2);
  expect(Array.from(app.evaluate("trailFrames.map(f => f.timestamp)"))).toEqual(
    [0, 20]
  );
  expect(app.compositeAlphas).toHaveLength(3);
  expect(app.compositeAlphas[1]).toBeCloseTo((1 - 5 / 220) ** 3);
  expect(app.compositeAlphas[2]).toBe(1);
});

test("expires old history and captures once after a long pause without catch-up", () => {
  const app = setup();
  app.render(0);
  app.render(10005);
  app.render(10005);
  app.render(10006);
  expect(app.captures()).toBe(2);
  expect(app.evaluate("trailFrames.length")).toBe(1);
  expect(app.evaluate("trailFrames[0].timestamp")).toBe(10005);
  const deadline = app.evaluate("nextTrailCaptureMs");
  expect(deadline).toBeGreaterThan(10005);
  expect(deadline - 10005).toBeLessThanOrEqual(1000 / 60);
  app.render(deadline);
  expect(app.captures()).toBe(3);
});

test("disabling and re-enabling trails resets history and captures immediately", () => {
  const app = setup();
  app.render(0);
  app.context.state.trailsEnabled = false;
  app.render(1);
  expect(app.evaluate("nextTrailCaptureMs")).toBeNull();
  expect(app.evaluate("trailFrames.length + trailCanvasPool.length")).toBe(0);
  app.context.state.trailsEnabled = true;
  app.render(2);
  expect(app.captures()).toBe(2);
  expect(app.evaluate("trailFrames[0].timestamp")).toBe(2);
});

test.each([
  ["trailDurationSlider", "trailDuration", "600"],
  ["trailFpsSlider", "trailMaxFps", "240"],
])(
  "%s resets the capture deadline through its actual input handler",
  (slider, field, value) => {
    const app = setup();
    app.context.settingsActions = require("../src/settings-actions").create({
      state: app.context.state,
      registry: require("../src/mode-registry"),
      modeList: require("../src/mode-list"),
      themeIds: ["Neon"],
      save: app.context.saveSettings,
      effects: new Proxy(
        {
          syncControls: jest.fn(),
          labels: app.context.updateSliderLabels,
          resetTrails: app.evaluate("resetTrailHistory"),
        },
        {
          get(target, key) {
            if (key in target) return target[key];
            throw Error(`Unexpected effect for a trail slider: ${String(key)}`);
          },
        }
      ),
      timers: { setInterval, clearInterval },
    });
    class Input {
      constructor() {
        this.value = "";
        this.type = "range";
      }
      addEventListener(_event, callback) {
        this.callback = callback;
      }
      removeEventListener() {}
    }
    const nodes = new Map();
    app.context.HTMLInputElement = Input;
    app.context.document = {
      ...app.context.document,
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, new Input());
        return nodes.get(id);
      },
    };
    app.context.SettingsUI = require("../src/settings-ui");
    vm.runInContext(readSource("settings-panel.js"), app.context);
    const panel = app.context.SettingsPanel.create({
      document: app.context.document,
      state: app.context.state,
      registry: require("../src/mode-registry"),
      themes: [],
      currentMode: () => "bars",
      submit: (c) => app.context.settingsActions.set(c.key, c.value),
      reportError: () => {},
    });
    panel.start();
    app.render(0);
    nodes.get(slider).value = value;
    nodes.get(slider).callback();
    panel.dispose();
    expect(app.context.state[field]).toBe(Number(value));
    expect(app.context.updateSliderLabels).toHaveBeenCalledTimes(1);
    expect(app.context.saveSettings).toHaveBeenCalledTimes(1);
    expect(app.evaluate("nextTrailCaptureMs")).toBeNull();
    expect(app.evaluate("trailFrames.length + trailCanvasPool.length")).toBe(0);
    app.render(1);
    expect(app.captures()).toBe(2);
  }
);

test("resizing resets the capture deadline and uses the new canvas dimensions", () => {
  const app = setup();
  const source = readSource("dom.js");
  vm.runInContext(
    source.slice(
      source.indexOf("function resize()"),
      source.indexOf('window.addEventListener("resize"')
    ),
    app.context
  );
  app.render(0);
  app.evaluate("resize()");
  expect(app.evaluate("nextTrailCaptureMs")).toBeNull();
  expect(app.evaluate("trailFrames.length + trailCanvasPool.length")).toBe(0);
  app.render(1);
  expect(app.captures()).toBe(2);
  expect(app.evaluate("trailFrames[0].canvas.width")).toBe(320);
  expect(app.evaluate("trailFrames[0].canvas.height")).toBe(240);
});

test("long trails at the maximum capture rate retain a bounded canvas pool", () => {
  const app = setup(240, 600);
  for (let frame = 0; frame < 2400; frame++) app.render((frame * 1000) / 240);
  expect(app.canvases()).toBeLessThanOrEqual(145);
  expect(app.evaluate("trailFrames.length + trailCanvasPool.length")).toBe(
    app.canvases()
  );
});

test("cropped snapshots keep independent integer origins and present uncaptured frames at full size", () => {
  const app = setup();
  const bounds = { x: 2.2, y: 3.8, width: 6.1, height: 4.5 };
  app.render(0, bounds);
  expect(app.captureCalls[0]).toMatchObject({ width: 7, height: 6 });
  expect(app.captureCalls[0].args).toEqual([app.context.renderCanvas, -2, -3]);
  expect(app.frames[0]).toMatchObject({ x: 2, y: 3 });
  bounds.x = 9;
  bounds.y = 10;
  bounds.width = 4;
  bounds.height = 4;
  app.render(20, bounds);
  expect(app.compositeCalls.map((args) => args.slice(1))).toEqual([
    [2, 3],
    [9, 10],
  ]);
  app.render(25, null);
  expect(app.compositeCalls.at(-1)).toEqual([app.context.renderCanvas, 0, 0]);
  expect(app.frames[0]).toMatchObject({ x: 2, y: 3 });
});

test("pool prefers an exact size, retains one spare after expiration, and releases backing stores on reset", () => {
  const app = setup();
  for (let i = 0; i < 5; i++) app.render(i * 20);
  app.render(1000);
  expect(app.pool).toHaveLength(1);
  expect(app.frames).toHaveLength(1);
  expect(
    app.surfaces.filter(
      (surface) => surface.width === 0 && surface.height === 0
    )
  ).toHaveLength(3);
  const spare = app.pool[0];
  app.render(1020);
  expect(app.frames.at(-1).canvas).toBe(spare);
  app.context.exact = { width: 7, height: 8 };
  app.context.other = { width: 12, height: 13 };
  app.evaluate("trailCanvasPool.push(exact,other)");
  expect(app.evaluate("takeTrailCanvas(7,8)")).toBe(app.context.exact);
  expect(app.pool).toEqual([app.context.other]);
  app.evaluate("resetTrailHistory()");
  expect(app.context.other).toMatchObject({ width: 0, height: 0 });
  expect(
    app.surfaces.every((surface) => surface.width === 0 && surface.height === 0)
  ).toBe(true);
  expect(app.frames).toHaveLength(0);
  expect(app.pool).toHaveLength(0);
});

test("disabling releases cropped canvases and ordinary full-size captures remain compatible", () => {
  const app = setup();
  app.render(0, { x: 3, y: 4, width: 5, height: 6 });
  const cropped = app.frames[0].canvas;
  app.context.state.trailsEnabled = false;
  app.render(1);
  expect(cropped).toMatchObject({ width: 0, height: 0 });
  app.context.state.trailsEnabled = true;
  app.render(2);
  expect(app.frames[0]).toMatchObject({
    x: 0,
    y: 0,
    canvas: { width: 16, height: 16 },
  });
});
