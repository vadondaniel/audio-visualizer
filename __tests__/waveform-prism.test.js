const { setup } = require("./helpers/mode-fixture.cjs");

test("straight Prism connects neighboring peaks in both directions without closing the ends", () => {
  const f = setup("prism");
  f.settings.prismLayout = "straight";
  f.process();
  f.frame.signals = { ...f.frame.signals, bands: [0, 0.5, 1, 0.25] };
  f.mode.draw(f.canvas.ctx, f.frame);
  const contours = f.canvas.events.filter(
    (e) => e[0] === "stroke" && e[2].length === 4
  );
  expect(contours).toHaveLength(3);
  const mid = f.frame.height / 2,
    span = f.frame.height * 0.38;
  expect(contours[0][2]).toEqual([
    ["moveTo", 0, mid],
    ["lineTo", 1000 / 3, mid - span * 0.5],
    ["moveTo", 0, mid],
    ["lineTo", 1000 / 3, mid + span * 0.5],
  ]);
  expect(contours.at(-1)[2][1][1]).toBeCloseTo(1000);
  const before = JSON.stringify(f.canvas.events);
  f.canvas.clear();
  f.mode.draw(f.canvas.ctx, f.frame);
  expect(JSON.stringify(f.canvas.events)).toBe(before);
  expect(f.frame.signals.bands).toEqual([0, 0.5, 1, 0.25]);
});

test.each([
  [320, 320],
  [360, 800],
  [1600, 900],
])(
  "straight Prism handles silence, resize and reset at %s × %s",
  (width, height) => {
    const f = setup("prism");
    f.settings.prismLayout = "straight";
    f.frame.width = width;
    f.frame.height = height;
    f.process();
    f.frame.signals.bands.fill(0);
    f.mode.reset();
    f.mode.draw(f.canvas.ctx, f.frame);
    const strokes = f.canvas.events.filter((e) => e[0] === "stroke");
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes)
      for (const [, , y] of stroke[2]) expect(y).toBe(height / 2);
  }
);

test("only circular Prism supplies cropped history and fitted-overlay bounds", () => {
  const f = setup("prism");
  f.process();
  const circle = f.mode.getRenderBounds(f.frame),
    fit = f.mode.getOverlayBounds(f.frame);
  expect(circle.width).toBeGreaterThan(0);
  expect(fit.width).toBeGreaterThan(0);
  f.settings.prismLayout = "straight";
  expect(f.mode.getRenderBounds(f.frame)).toBeNull();
  expect(f.mode.getOverlayBounds(f.frame)).toBeNull();
  f.settings.prismLayout = "circular";
  expect(f.mode.getRenderBounds(f.frame)).toBe(circle);
  expect(f.mode.getOverlayBounds(f.frame)).toBe(fit);
});
