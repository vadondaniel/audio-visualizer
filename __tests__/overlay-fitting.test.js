const { fitBounds } = require("../src/overlay-display");
const {
  setup,
  runtime,
  names,
  makeCanvas,
} = require("./helpers/mode-fixture.cjs");

test.each([
  [320, 320, { x: 100, y: 80, width: 100, height: 120 }],
  [640, 320, { x: -50, y: -10, width: 300, height: 400 }],
  [160, 200, { x: 0.123, y: 0.456, width: 200.321, height: 100.654 }],
  [320, 640, { x: 0, y: 0, width: 800, height: 90 }],
])(
  "fit preserves aspect and centers unrounded bounds in %ix%i",
  (width, height, bounds) => {
    const result = { scale: 0, x: 0, y: 0 };
    expect(fitBounds(bounds, width, height, result)).toBe(result);
    const left = result.x + bounds.x * result.scale;
    const top = result.y + bounds.y * result.scale;
    const right = left + bounds.width * result.scale;
    const bottom = top + bounds.height * result.scale;
    expect((left + right) / 2).toBeCloseTo(width / 2, 12);
    expect((top + bottom) / 2).toBeCloseTo(height / 2, 12);
    expect(Math.min(left, top)).toBeCloseTo(8, 12);
    expect(left).toBeGreaterThanOrEqual(8 - 1e-10);
    expect(top).toBeGreaterThanOrEqual(8 - 1e-10);
    expect(right).toBeLessThanOrEqual(width - 8 + 1e-10);
    expect(bottom).toBeLessThanOrEqual(height - 8 + 1e-10);
    expect((right - left) / (bottom - top)).toBeCloseTo(
      bounds.width / bounds.height
    );
  }
);

test.each([
  [null, 320, 320],
  [{ x: 0, y: 0, width: 0, height: 10 }, 320, 320],
  [{ x: 0, y: 0, width: 10, height: -1 }, 320, 320],
  [{ x: NaN, y: 0, width: 10, height: 10 }, 320, 320],
  [{ x: 0, y: Infinity, width: 10, height: 10 }, 320, 320],
  [{ x: 0, y: 0, width: 10, height: 10 }, 16, 320],
  [{ x: 0, y: 0, width: 10, height: 10 }, 320, Infinity],
  [{ x: 0, y: 0, width: Number.MIN_VALUE, height: Number.MIN_VALUE }, 320, 320],
  [{ x: 1e308, y: 0, width: 1e308, height: 10 }, 320, 320],
])(
  "missing or invalid bounds retain identity presentation: %p",
  (bounds, width, height) => {
    const result = { scale: 9, x: 15, y: 23 };
    expect(fitBounds(bounds, width, height, result)).toBeNull();
    expect(result).toEqual({ scale: 1, x: 0, y: 0 });
  }
);

const fitted = ["orbit", "prism", "radial", "kaleidoscope"];
test.each(fitted)("%s fitting leaves native glow blur unchanged", (id) => {
  const app = setup(id);
  app.settings.glowIntensity = 2.5;
  app.frame.width = app.frame.height = 160;
  app.process();
  app.mode.update(app.frame);
  const normal = makeCanvas(),
    overlay = makeCanvas();
  app.mode.draw(normal.ctx, app.frame);
  const fit = fitBounds(app.mode.getOverlayBounds(app.frame), 160, 160, {
    scale: 1,
    x: 0,
    y: 0,
  });
  overlay.ctx.save();
  overlay.ctx.translate(fit.x, fit.y);
  overlay.ctx.scale(fit.scale, fit.scale);
  app.mode.draw(overlay.ctx, app.frame);
  overlay.ctx.restore();
  const blurs = (canvas) => canvas.events.map((event) => event[3].shadowBlur);
  expect(blurs(overlay)).toEqual(blurs(normal));
  expect(blurs(overlay).some((blur) => blur > 0)).toBe(true);
});

test.each(fitted)(
  "%s overlay bounds are reusable, independent, and stable across audio, palette, and glow",
  (id) => {
    const app = setup(id),
      other = setup(id);
    app.process();
    const initial = app.mode.getOverlayBounds(app.frame),
      values = { ...initial };
    expect(initial).not.toBe(other.mode.getOverlayBounds(other.frame));
    app.frame.signals.levels = { bass: 1, mid: 1, treble: 1 };
    app.frame.signals.bands.fill(1);
    app.frame.beat.pulse = 1;
    app.settings.hueShift = 271;
    app.setTheme("Rainbow Cycle");
    app.settings.glowIntensity = 2.5;
    app.mode.update(app.frame);
    expect(app.mode.getOverlayBounds(app.frame)).toBe(initial);
    expect(initial).toEqual(values);
    if (app.mode.getRenderBounds) {
      const trailBounds = app.mode.getRenderBounds(app.frame);
      expect(trailBounds).not.toBe(initial);
      expect(trailBounds.width).toBeGreaterThan(initial.width);
      expect(initial).toEqual(values);
    }
    app.frame.width = 160;
    app.frame.height = 200;
    expect(app.mode.getOverlayBounds(app.frame)).toBe(initial);
    expect(initial.width).toBeLessThan(values.width);
  }
);

test("Kaleidoscope unclipped bounds include the larger spatially weighted peaks", () => {
  const app = setup("kaleidoscope");
  app.settings.kaleidoClipEnabled = true;
  const clipped = app.mode.getOverlayBounds(app.frame).width;
  app.settings.kaleidoClipEnabled = false;
  expect(app.mode.getOverlayBounds(app.frame).width).toBeGreaterThan(clipped);
});

test("controller forwards overlay bounds without simulation and retains viewport-mode fallback", () => {
  const app = setup("bars"),
    bounds = { x: 1, y: 2, width: 3, height: 4 };
  const mode = {
    update: jest.fn(),
    draw: jest.fn(),
    reset: jest.fn(),
    getOverlayBounds: jest.fn(() => bounds),
  };
  const controller = runtime.createController(
    { custom: () => mode, bars: () => app.mode },
    app.services
  );
  expect(controller.getOverlayBounds("custom", app.frame)).toBe(bounds);
  expect(mode.getOverlayBounds).toHaveBeenCalledWith(app.frame);
  expect(mode.update).not.toHaveBeenCalled();
  expect(mode.draw).not.toHaveBeenCalled();
  expect(controller.getOverlayBounds("bars", app.frame)).toBeNull();
  expect(() => controller.getOverlayBounds("missing", app.frame)).toThrow(
    "Unknown visual mode"
  );
  for (const id of names.filter((id) => !fitted.includes(id)))
    expect(setup(id).mode.getOverlayBounds).toBeUndefined();
});

// Track painted geometry separately from shadows. All fitted modes use uniform
// scaling/rotation; Bezier control hulls and full-circle arc bounds are conservative.
function geometryContext() {
  const canvas = makeCanvas();
  let matrix = [1, 0, 0, 1, 0, 0],
    stack = [],
    points = [];
  const painted = [];
  const point = (x, y) => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
  const ctx = new Proxy(canvas.ctx, {
    get(target, key) {
      const original = target[key];
      if (typeof original !== "function") return original;
      return (...args) => {
        if (key === "save") stack.push([...matrix]);
        if (key === "restore") matrix = stack.pop();
        if (key === "translate") {
          const p = point(args[0], args[1]);
          matrix[4] = p[0];
          matrix[5] = p[1];
        }
        if (key === "scale") {
          matrix[0] *= args[0];
          matrix[1] *= args[0];
          matrix[2] *= args[1];
          matrix[3] *= args[1];
        }
        if (key === "rotate") {
          const [a, b, c, d] = matrix,
            cosine = Math.cos(args[0]),
            sine = Math.sin(args[0]);
          matrix[0] = a * cosine + c * sine;
          matrix[1] = b * cosine + d * sine;
          matrix[2] = c * cosine - a * sine;
          matrix[3] = d * cosine - b * sine;
        }
        if (key === "beginPath") points = [];
        if (key === "moveTo" || key === "lineTo") points.push(point(...args));
        if (key === "bezierCurveTo")
          for (let i = 0; i < 6; i += 2)
            points.push(point(args[i], args[i + 1]));
        if (key === "arc") {
          const [x, y] = point(args[0], args[1]);
          const radius = args[2] * Math.hypot(matrix[0], matrix[1]);
          points.push([x - radius, y - radius], [x + radius, y + radius]);
        }
        if (key === "fill" || key === "stroke") {
          const padding =
            key === "stroke"
              ? (target.lineWidth * Math.hypot(matrix[0], matrix[1])) / 2
              : 0;
          for (const [x, y] of points)
            painted.push(
              [x - padding, y - padding],
              [x + padding, y + padding]
            );
        }
        if (key === "drawImage") {
          const [x, y, w, h] = args.slice(-4);
          painted.push(
            point(x, y),
            point(x + w, y),
            point(x, y + h),
            point(x + w, y + h)
          );
        }
        return original(...args);
      };
    },
  });
  return { ctx, painted, canvas };
}

test.each(
  fitted.flatMap((id) =>
    [
      [160, 160],
      [320, 320],
      [640, 320],
      [320, 640],
    ].flatMap(([width, height]) =>
      [true, false].map((clip) => [id, width, height, clip])
    )
  )
)(
  "%s maximum geometry fits %ix%i with clipping=%s",
  (id, width, height, clip) => {
    const app = setup(id);
    app.frame.width = width;
    app.frame.height = height;
    app.settings.kaleidoClipEnabled = clip;
    app.settings.glowIntensity = 0;
    app.process();
    app.frame.signals.levels = { bass: 1, mid: 1, treble: 1 };
    app.frame.signals.bands.fill(1);
    app.frame.beat.pulse = 1;
    app.frame.mediaArt = { naturalWidth: 80, naturalHeight: 40 };
    for (let step = 0; step < 2; step++) {
      app.frame.dtSec = 0.1;
      app.mode.update(app.frame);
      const fit = fitBounds(
        app.mode.getOverlayBounds(app.frame),
        width,
        height,
        { scale: 1, x: 0, y: 0 }
      );
      const { ctx, painted, canvas } = geometryContext();
      ctx.save();
      ctx.translate(fit.x, fit.y);
      ctx.scale(fit.scale, fit.scale);
      app.mode.draw(ctx, app.frame);
      ctx.restore();
      expect(painted.length).toBeGreaterThan(0);
      let left = Infinity,
        top = Infinity,
        right = -Infinity,
        bottom = -Infinity;
      for (const [x, y] of painted) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
      expect(left).toBeGreaterThanOrEqual(8 - 1e-8);
      expect(right).toBeLessThanOrEqual(width - 8 + 1e-8);
      expect(top).toBeGreaterThanOrEqual(8 - 1e-8);
      expect(bottom).toBeLessThanOrEqual(height - 8 + 1e-8);
      expect(canvas.depth).toBe(0);
    }
  }
);
