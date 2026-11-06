const { resolveTrailBounds } = require("../src/trail-math");
const { setup, runtime, names } = require("./helpers/mode-fixture.cjs");

test.each([
  [null, { x: 0, y: 0, width: 100, height: 80 }],
  [
    { x: 2.2, y: 3.8, width: 6.1, height: 4.5 },
    { x: 2, y: 3, width: 7, height: 6 },
  ],
  [
    { x: -2.5, y: 70.1, width: 120, height: 50 },
    { x: 0, y: 70, width: 100, height: 10 },
  ],
  [
    { x: NaN, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 100, height: 80 },
  ],
  [
    { x: 0, y: 0, width: Infinity, height: 10 },
    { x: 0, y: 0, width: 100, height: 80 },
  ],
  [
    { x: 0, y: 0, width: -1, height: 10 },
    { x: 0, y: 0, width: 100, height: 80 },
  ],
  [
    { x: 101, y: 80, width: 10, height: 10 },
    { x: 0, y: 0, width: 100, height: 80 },
  ],
])(
  "bounds normalize outward with full-size fallback: %p",
  (bounds, expected) => {
    const result = {};
    expect(resolveTrailBounds(bounds, 100, 80, result)).toBe(result);
    expect(result).toEqual(expected);
  }
);

test.each(["orbit", "prism", "radial"])(
  "%s bounds are stable across signals, reusable, and independent per instance",
  (id) => {
    const app = setup(id),
      other = setup(id);
    app.frame.width = 1920;
    app.frame.height = 1080;
    app.process();
    const bounds = app.mode.getRenderBounds(app.frame),
      initial = { ...bounds };
    expect(bounds).not.toBe(other.mode.getRenderBounds(other.frame));
    app.frame.signals.levels = { bass: 1, mid: 1, treble: 1 };
    app.frame.beat.pulse = 1;
    expect(app.mode.getRenderBounds(app.frame)).toBe(bounds);
    expect(bounds).toEqual(initial);
    const pixels = resolveTrailBounds(
      bounds,
      app.frame.width,
      app.frame.height,
      {}
    );
    expect(pixels.width * pixels.height).toBeLessThan(
      app.frame.width * app.frame.height
    );
    app.settings.glowIntensity = 2.5;
    expect(app.mode.getRenderBounds(app.frame).width).toBeGreaterThan(
      initial.width
    );
    app.frame.width = 160;
    app.frame.height = 200;
    const small = resolveTrailBounds(
      app.mode.getRenderBounds(app.frame),
      160,
      200,
      {}
    );
    expect(small.x).toBeGreaterThanOrEqual(0);
    expect(small.y).toBeGreaterThanOrEqual(0);
    expect(small.x + small.width).toBeLessThanOrEqual(160);
    expect(small.y + small.height).toBeLessThanOrEqual(200);
  }
);

test("controller forwards optional bounds without lifecycle calls, and unsupported modes retain full-canvas fallback", () => {
  const app = setup("bars"),
    bounds = { x: 1, y: 2, width: 3, height: 4 };
  const mode = {
    update: jest.fn(),
    draw: jest.fn(),
    reset: jest.fn(),
    getRenderBounds: jest.fn(() => bounds),
  };
  const controller = runtime.createController(
    { custom: () => mode, bars: () => app.mode },
    app.services
  );
  expect(controller.getRenderBounds("custom", app.frame)).toBe(bounds);
  expect(mode.getRenderBounds).toHaveBeenCalledWith(app.frame);
  expect(mode.update).not.toHaveBeenCalled();
  expect(mode.draw).not.toHaveBeenCalled();
  expect(controller.getRenderBounds("bars", app.frame)).toBeNull();
  expect(() => controller.getRenderBounds("missing", app.frame)).toThrow(
    "Unknown visual mode"
  );
  for (const id of names.filter(
    (id) => !["orbit", "prism", "radial"].includes(id)
  ))
    expect(setup(id).mode.getRenderBounds).toBeUndefined();
});
