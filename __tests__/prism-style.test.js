const { setup, canonical } = require("./helpers/mode-fixture.cjs");
const legacy = {
  minLineWidth: 1,
  lineWidthScale: 0.0018,
  contourAlpha: 0.4,
  spokeAlpha: 0.25,
  spokeAlphaGain: 0.45,
  glowBlur: 8,
  glowBlurGain: 7,
};
test.each(["circular", "straight"])(
  "%s has stronger strokes without changing paths or audio",
  (layout) => {
    for (const size of [320, 800])
      for (const glow of [0, 1]) {
        const f = setup("prism");
        f.settings.prismLayout = layout;
        f.settings.glowIntensity = glow;
        f.frame.width = f.frame.height = size;
        f.process();
        const input = JSON.stringify(f.frame.signals);
        f.mode.draw(f.canvas.ctx, f.frame);
        const strong = canonical(f.canvas.events);
        f.canvas.clear();
        Object.assign(f.constants.VISUAL_TUNING.prism, legacy);
        f.mode.draw(f.canvas.ctx, f.frame);
        const before = canonical(f.canvas.events);
        expect(strong.map((event) => event.slice(0, 3))).toEqual(
          before.map((event) => event.slice(0, 3))
        );
        expect(JSON.stringify(f.frame.signals)).toBe(input);
        const newStrokes = strong.filter((event) => event[0] === "stroke"),
          oldStrokes = before.filter((event) => event[0] === "stroke");
        expect(newStrokes.length).toBe(oldStrokes.length);
        for (let i = 0; i < newStrokes.length; i++) {
          expect(newStrokes[i][3].lineWidth).toBeGreaterThan(
            oldStrokes[i][3].lineWidth
          );
          expect(newStrokes[i][3].globalAlpha).toBeGreaterThanOrEqual(
            oldStrokes[i][3].globalAlpha
          );
          if (glow === 0) expect(newStrokes[i][3].shadowBlur).toBe(0);
          else
            expect(newStrokes[i][3].shadowBlur).toBeGreaterThan(
              oldStrokes[i][3].shadowBlur
            );
        }
      }
  }
);
