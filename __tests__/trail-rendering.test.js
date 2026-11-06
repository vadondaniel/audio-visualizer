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
  const displayCtx = {
    save() {},
    restore() {},
    setTransform() {},
    clearRect() {
      compositeAlphas.length = 0;
    },
    drawImage() {
      compositeAlphas.push(this.globalAlpha);
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
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            clearRect() {},
            drawImage() {
              captures++;
            },
          }),
        };
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
    const handlers = {};
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
    for (const name of ["trailDurationSlider", "trailFpsSlider"]) {
      app.context[name] = {
        addEventListener: (_event, callback) => {
          handlers[name] = callback;
        },
      };
    }
    const source = readSource("ui.js");
    vm.runInContext(
      source.slice(
        source.indexOf("trailDurationSlider.addEventListener"),
        source.indexOf("wakeLockCheckbox.addEventListener")
      ),
      app.context
    );
    app.render(0);
    handlers[slider]({ target: { value } });
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
