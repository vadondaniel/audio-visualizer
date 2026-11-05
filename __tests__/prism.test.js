const AudioMath = require("../src/audio-math");
const { setup: makeFixture, spyCanvas } = require("./helpers/mode-fixture.cjs");
const {
  prismInnerRadius,
  prismOuterRadius,
  prismBandEdge,
  prismAudioLevel: audioLevel,
  prismActiveEnd: activeEnd,
} = require("../src/visuals/prism");
const prismActiveEnd = (data) => activeEnd(data, AudioMath.spectrumBandDb);
const prismAudioLevel = (...args) =>
  audioLevel(...args, AudioMath.applyValueHandling);
test("active range trims quiet treble, follows recording level, and retains real high frequencies", () => {
  const data = new Float32Array(1024).fill(-110);
  data.fill(-30, 2, 80);
  const narrow = prismActiveEnd(data);
  expect(narrow).toBeGreaterThanOrEqual(98);
  expect(narrow).toBeLessThan(120);
  expect(prismActiveEnd(Float32Array.from(data, (v) => v - 15))).toBe(narrow);
  data.fill(-40, 450, 460);
  expect(prismActiveEnd(data)).toBeGreaterThan(460);
  data.fill(-Infinity);
  expect(prismActiveEnd(data)).toBe(0);
  data.fill(-90);
  expect(prismActiveEnd(data)).toBe(0);
  for (const end of [98, 150, 250, 512])
    for (let i = 0; i < 96; i++)
      expect(prismBandEdge(i + 1, 1024, end)).toBeGreaterThan(
        prismBandEdge(i, 1024, end)
      );
});

test("range expands quickly, holds transient treble, contracts slowly, and stays fixed during silence", () => {
  const app = setup(null);
  let high = false,
    silent = false;
  app.frame.audio.readFloatSpectrum = () => {
    app.spectrum.fill(-Infinity);
    if (!silent) {
      app.spectrum.fill(-30, 2, 80);
      if (high) app.spectrum.fill(-35, 450, 460);
    }
    return app.spectrum;
  };
  const count = () => app.values().filter((v) => v > 1e-6).length;
  app.draw();
  const narrow = count();
  high = true;
  for (let i = 0; i < 60; i++) app.draw();
  high = false;
  app.draw();
  const wide = count();
  expect(wide).toBeLessThan(narrow);
  for (let i = 0; i < 20; i++) app.draw();
  expect(count()).toBe(wide);
  for (let i = 0; i < 360; i++) app.draw();
  const contracted = count();
  expect(contracted).toBeGreaterThan(wide);
  silent = true;
  for (let i = 0; i < 60; i++) app.draw();
  silent = false;
  app.draw();
  expect(count()).toBe(contracted);
});

test("frequency bands partition distinct FFT bins instead of duplicating bass bins", () => {
  for (const bins of [512, 1024, 2048]) {
    const edges = Array.from({ length: 97 }, (_, i) => prismBandEdge(i, bins));
    expect(edges[0]).toBe(Math.floor(bins * 0.002));
    expect(edges[96]).toBe(Math.floor(bins * 0.5));
    for (let i = 0; i < 96; i++) expect(edges[i + 1]).toBeGreaterThan(edges[i]);
  }
});

test("neighboring bass bins drive separate rendered bands", () => {
  const app = setup(null);
  for (const bin of [2, 3, 4, 5, 6]) {
    app.frame.audio.readFloatSpectrum = () => {
      app.spectrum.fill(-Infinity);
      app.spectrum[bin] = -30;
      return app.spectrum;
    };
    app.draw();
    const active = app
      .values()
      .map((v, i) => (v > 1e-6 ? i : -1))
      .filter((i) => i >= 0);
    expect(active).toHaveLength(1);
    expect(prismBandEdge(active[0], 1024)).toBeLessThanOrEqual(bin);
    expect(prismBandEdge(active[0] + 1, 1024)).toBeGreaterThan(bin);
  }
});

function setup(bass = 0.5) {
  const fixture = makeFixture("prism");
  Object.assign(fixture.settings, {
    smoothingEnabled: false,
    valueHandling: "logarithmic",
    sensitivity: 2.4,
  });
  Object.assign(fixture.frame.levels, { bass: 0, mid: 0, treble: 0 });
  fixture.frame.beat.pulse = 0;
  fixture.frame.audio.frequencyBytes.fill(255);
  for (let i = 0; i < 1024; i++)
    fixture.spectrum[i] =
      -70 +
      45 * Math.exp(-Math.pow((Math.log2(i + 1) - 4) / 0.7, 2)) +
      25 * Math.exp(-Math.pow((Math.log2(i + 1) - 7) / 0.5, 2));
  fixture.setGain(
    bass === null
      ? 1
      : AudioMath.bassSensitivityTarget(bass, 0.5, "logarithmic")
  );
  const ctx = spyCanvas(fixture, jest.fn);
  const outer = () =>
    Array.from(
      { length: 96 },
      (_, i) => ctx.lineTo.mock.calls[i * 3 + 2]
    ).flat();
  const inner = () =>
    Array.from(
      { length: 96 },
      (_, i) => ctx.moveTo.mock.calls[i * 3 + 1]
    ).flat();
  return {
    ...fixture,
    ctx,
    outer,
    inner,
    values: () =>
      Array.from(
        { length: 96 },
        (_, i) =>
          (Math.hypot(...ctx.lineTo.mock.calls[i * 3 + 2]) / 172 - 1) / 1.1
      ),
    draw() {
      ctx.clearMocks();
      fixture.mode.update(fixture.frame);
      fixture.mode.draw(ctx, fixture.frame);
    },
  };
}

test("triangular tips extend in opposite radial directions and stay within bounds", () => {
  expect(prismInnerRadius(100, 0)).toBe(100);
  expect(prismOuterRadius(100, 0)).toBe(100);
  expect(prismInnerRadius(100, 1)).toBeCloseTo(12);
  expect(prismOuterRadius(100, 1)).toBeCloseTo(210);
  const app = setup();
  app.draw();
  const outer = app.outer(),
    inner = app.inner();
  for (let i = 0; i < outer.length; i += 2) {
    expect(Math.hypot(outer[i], outer[i + 1])).toBeGreaterThanOrEqual(
      172 - 1e-8
    );
    expect(Math.hypot(outer[i], outer[i + 1])).toBeLessThanOrEqual(
      172 * 2.1 + 1e-8
    );
    expect(Math.hypot(inner[i], inner[i + 1])).toBeLessThanOrEqual(172 + 1e-8);
    expect(Math.hypot(inner[i], inner[i + 1])).toBeGreaterThanOrEqual(
      172 * 0.12 - 1e-8
    );
  }
});

test("Prism applies the selected curve once over its dB range, with proportional geometry", () => {
  const app = setup(null);
  for (const curve of ["linear", "exponential", "logarithmic"]) {
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const shaped = prismAudioLevel(-30 - 45 * (1 - level), -30, curve, 1);
      expect(shaped).toBeCloseTo(AudioMath.applyValueHandling(level, curve));
      expect(prismOuterRadius(100, shaped) - 100).toBeCloseTo(110 * shaped);
      expect(100 - prismInnerRadius(100, shaped)).toBeCloseTo(88 * shaped);
    }
  }
  // A band 12 dB below the peak still produces a visible spike in exponential.
  expect(prismAudioLevel(-42, -30, "exponential", 1)).toBeGreaterThan(0.4);
  expect(prismAudioLevel(-Infinity, -30, "exponential", 1)).toBe(0);
  expect(prismAudioLevel(-100, -65, "logarithmic", 1)).toBe(0);
});

test.each(["Neon", "Rainbow Cycle", "Color Cycle", "White"])(
  "rim arcs match their bands' angular colors in %s",
  (theme) => {
    const app = setup(null);
    app.setTheme(theme);
    app.settings.hueShift = 137;
    expect(app.settings.theme).toBeGreaterThanOrEqual(0);
    for (const gradient of [true, false]) {
      app.settings.colorGradientEnabled = gradient;
      const strokes = [];
      app.ctx.stroke.mockImplementation(() =>
        strokes.push(app.ctx.strokeStyle)
      );
      app.ctx.arc.mockClear();
      app.draw();
      const count = 96;
      const rim = strokes.slice(-count);
      const arcs = app.ctx.arc.mock.calls.slice(-count);
      for (let i = 0; i < count; i++) {
        expect(rim[i]).toBe(
          app.services.palette.themeCssColor(
            app.services.palette.currentHue(i / 96),
            95,
            70,
            0.75
          )
        );
        expect(arcs[i][3]).toBeCloseTo((i * Math.PI * 2) / count - Math.PI / 2);
        expect(arcs[i][4]).toBeCloseTo(
          ((i + 1) * Math.PI * 2) / count - Math.PI / 2
        );
      }
    }
  }
);

test("bands connect neighboring inner and outer peaks, including the closing seam", () => {
  const app = setup();
  app.draw();
  const count = 96;
  const outer = app.outer();
  const inner = app.inner();
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    expect(app.ctx.moveTo.mock.calls[i * 3]).toEqual(
      outer.slice(i * 2, i * 2 + 2)
    );
    expect(app.ctx.lineTo.mock.calls[i * 3]).toEqual(
      outer.slice(next * 2, next * 2 + 2)
    );
    expect(app.ctx.moveTo.mock.calls[i * 3 + 1]).toEqual(
      inner.slice(i * 2, i * 2 + 2)
    );
    expect(app.ctx.lineTo.mock.calls[i * 3 + 1]).toEqual(
      inner.slice(next * 2, next * 2 + 2)
    );
    expect(app.ctx.lineTo.mock.calls[i * 3 + 2]).toEqual(
      outer.slice(i * 2, i * 2 + 2)
    );
  }
  expect(app.ctx.save).toHaveBeenCalledTimes(1);
  expect(app.ctx.restore).toHaveBeenCalledTimes(1);
});

test("sensitivity and bass modulation preserve the spectrum's detail even when byte FFT data is clipped", () => {
  const stats = [0, null, 1].map((bass) => {
    const app = setup(bass);
    app.draw();
    const values = app.values();
    return {
      mean: values.reduce((a, b) => a + b, 0) / 96,
      clipped: values.filter((v) => v >= 0.999).length,
      range: Math.max(...values) - Math.min(...values),
    };
  });
  expect(stats[0].mean).toBeCloseTo(stats[1].mean * 0.5);
  expect(stats[2].mean).toBeGreaterThan(stats[1].mean);
  expect(stats[2].clipped).toBeLessThan(8);
  expect(stats[2].range).toBeGreaterThan(0.25);
});

test("silence leaves a finite circular baseline without triangular spikes", () => {
  const app = setup();
  app.spectrum.fill(-Infinity);
  app.draw();
  expect(app.values().every((v) => Math.abs(v) < 1e-12)).toBe(true);
  expect([...app.inner(), ...app.outer()].every(Number.isFinite)).toBe(true);
  expect(app.inner()).toEqual(app.outer());
});
