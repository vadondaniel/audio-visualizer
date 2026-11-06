const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const AudioMath = require("../src/audio-math");
const Pipeline = require("../src/audio-pipeline");
const { setup: makeFixture, spyCanvas } = require("./helpers/mode-fixture.cjs");

const source = (file) =>
  fs.readFileSync(path.join(__dirname, "../src", file), "utf8");

function setup({ enabled = true, amount = 0.5, bass = 0.5 } = {}) {
  const fixture = makeFixture("bars");
  Object.assign(fixture.settings, {
    bassSensitivityEnabled: enabled,
    bassSensitivityAmount: amount,
    valueHandling: "linear",
    sensitivity: 1,
    smoothingEnabled: false,
  });
  fixture.spectrum.fill(-50);
  fixture.spectrum[100] = -15;
  const setBass = (value) => fixture.spectrum.fill(-65 + value * 40, 0, 10);
  setBass(bass);
  const settle = () => {
    const previous = fixture.frame.dtSec;
    fixture.frame.dtSec = 0.1;
    for (let i = 0; i < 60; i++) fixture.process();
    fixture.frame.dtSec = previous;
  };
  settle();
  const ctx = spyCanvas(fixture, jest.fn),
    modes = {};
  const context = {
    state: fixture.settings,
    freqData: fixture.frame.audio.frequencyBytes,
    timeData: fixture.frame.audio.timeBytes,
    AudioMath,
    AudioPipeline: Pipeline,
  };
  const render = (name) => {
    fixture.process();
    Object.assign(fixture.frame.signals.levels, { bass: 0, mid: 0, treble: 0 });
    Object.assign(fixture.frame.signals.motion, { bass: 0, mid: 0, treble: 0 });
    const mode = (modes[name] ||= require("../src/visuals/" + name).createMode(
      fixture.services
    ));
    mode.update(fixture.frame);
    mode.draw(ctx, fixture.frame);
  };
  return {
    ...fixture,
    ctx,
    context,
    render,
    setBass,
    settle,
    signals: () => fixture.frame.signals,
  };
}

test.each([
  [0, 0.5, 0.5],
  [0.5, 0.5, 1],
  [1, 0.5, 1.5],
  [0, 1, 0],
  [1, 1, 2],
  [0, 0, 1],
  [1, 0, 1],
])("target for bass=%s amount=%s is %s", (bass, amount, expected) => {
  expect(AudioMath.bassSensitivityTarget(bass, amount)).toBe(expected);
});

test("gain uses 40 ms attack and 120 ms release, independently of frame rate", () => {
  expect(AudioMath.smoothBassSensitivity(1, 2, 0.04)).toBeCloseTo(
    2 - Math.exp(-1)
  );
  expect(AudioMath.smoothBassSensitivity(1, 0, 0.12)).toBeCloseTo(Math.exp(-1));
  for (const hz of [60, 144, 240]) {
    let gain = 1;
    for (let frame = 0; frame < hz; frame++)
      gain = AudioMath.smoothBassSensitivity(gain, 0.5, 1 / hz);
    expect(gain).toBeCloseTo(AudioMath.smoothBassSensitivity(1, 0.5, 1), 10);
  }
});

test("selected response curve shapes the bass driver while preserving the range", () => {
  const linear = AudioMath.bassSensitivityTarget(0.5, 0.5, "linear");
  expect(AudioMath.bassSensitivityTarget(0.5, 0.5, "exponential")).toBeLessThan(
    linear
  );
  expect(
    AudioMath.bassSensitivityTarget(0.5, 0.5, "logarithmic")
  ).toBeGreaterThan(linear);
  for (const curve of ["linear", "exponential", "logarithmic"]) {
    expect(AudioMath.bassSensitivityTarget(0, 0.5, curve)).toBe(0.5);
    expect(AudioMath.bassSensitivityTarget(1, 0.5, curve)).toBe(1.5);
    expect(AudioMath.bassSensitivityTarget(0.3, 0, curve)).toBe(1);
    const app = setup();
    app.context.state.valueHandling = curve;
    app.setBass(0.5);
    app.settle();
    expect(app.signals().bassMultiplier).toBeCloseTo(
      AudioMath.bassSensitivityTarget(0.5, 0.5, curve)
    );
  }
});

test("boost preserves headroom, signal order, polarity, and exact neutral behavior", () => {
  const values = [0, 0.1, 0.4, 0.8, 1];
  const boosted = values.map((v) => AudioMath.applyBassGain(v, 2));
  for (let i = 0; i < values.length; i++) {
    expect(AudioMath.applyBassGain(values[i], 1)).toBe(values[i]);
    expect(AudioMath.applyBassGain(values[i], 0.5)).toBe(values[i] * 0.5);
    expect(AudioMath.applyBassGain(-values[i], 2)).toBeCloseTo(-boosted[i]);
    if (i > 0) expect(boosted[i]).toBeGreaterThan(boosted[i - 1]);
  }
  expect(boosted[3]).toBeLessThan(1);
});

test.each([
  { enabled: false, amount: 1 },
  { enabled: true, amount: 0 },
])("disabled/zero amount bypasses stale gain exactly: %p", (options) => {
  const app = setup(options);
  app.setBass(1);
  app.settle();
  for (const value of [-0.6, 0, 0.5, 1.5])
    expect(AudioMath.applyBassGain(value, app.signals().bassMultiplier)).toBe(
      value
    );
  app.setBass(0);
  app.process();
  expect(app.signals().bassMultiplier).toBe(1);
});

test("disabling resets immediately without changing the base sensitivity or FFT", () => {
  const app = setup({ bass: 0 });
  const before = Array.from(app.context.freqData);
  expect(
    AudioMath.applyBassGain(0.5, app.signals().bassMultiplier)
  ).toBeCloseTo(0.25);
  app.context.state.bassSensitivityEnabled = false;
  app.process();
  expect(AudioMath.applyBassGain(0.5, app.signals().bassMultiplier)).toBe(0.5);
  expect(app.context.state.sensitivity).toBe(1);
  expect(Array.from(app.context.freqData)).toEqual(before);
});

test("saved bass controls validate types and ranges while preserving old defaults", () => {
  const defaults = {
    bassSensitivityEnabled: false,
    bassSensitivityAmount: 0.5,
  };
  expect(AudioMath.mergeSettings(defaults, {}, 10, 14)).toEqual(defaults);
  expect(
    AudioMath.mergeSettings(
      defaults,
      { bassSensitivityEnabled: true, bassSensitivityAmount: 1 },
      10,
      14
    )
  ).toMatchObject({ bassSensitivityEnabled: true, bassSensitivityAmount: 1 });
  for (const value of [-0.1, 1.1, NaN, "0.5", null])
    expect(
      AudioMath.mergeSettings(
        defaults,
        { bassSensitivityEnabled: "yes", bassSensitivityAmount: value },
        10,
        14
      )
    ).toEqual(defaults);
});

test("the same spectral bars get quieter/louder with bass, with no double gain", () => {
  const heights = [0, 0.5, 1].map((bass) => {
    const app = setup({ bass });
    app.render("bars");
    return app.ctx.fillRect.mock.calls[80][3];
  });
  expect(heights[0]).toBeCloseTo(heights[1] * 0.5);
  expect(heights[2]).toBeGreaterThan(heights[1]);
});

test("waveform amplitude follows bass without changing its samples or timing", () => {
  const amplitudes = [0, 0.5, 1].map((bass) => {
    const app = setup({ bass });
    const original = Array.from(app.context.timeData);
    app.render("waveform");
    expect(Array.from(app.context.timeData)).toEqual(original);
    return Math.max(
      ...app.ctx.lineTo.mock.calls.map(([, y]) => Math.abs(y - 400))
    );
  });
  expect(amplitudes[0]).toBeCloseTo(amplitudes[1] * 0.5);
  expect(amplitudes[2]).toBeGreaterThan(amplitudes[1]);
});

test("Orbit's direct float path and rope forces follow gain without flattening or changing rotation", () => {
  const stats = [0, null, 1].map((bass) => {
    const app = setup({ enabled: bass !== null, bass: bass ?? 0.5 });
    app.context.state.valueHandling = "logarithmic";
    app.context.state.sensitivity = 2.4;
    for (let i = 10; i < 1024; i++)
      app.spectrum[i] =
        -65 + 40 * Math.exp(-Math.pow((Math.log2(i + 1) - 4) / 0.8, 2));
    app.spectrum[100] = -15;
    app.settle();
    for (let i = 0; i < 60; i++) app.render("orbit");
    const radius = 184;
    const moves = app.ctx.moveTo.mock.calls.slice(-129, -1),
      lines = app.ctx.lineTo.mock.calls.slice(-128);
    const levels = lines.map(
      (p, i) =>
        (Math.hypot(...p) - Math.hypot(...moves[i])) / radius / 0.7 -
        0.025 / 0.7
    );
    const rope = app.ctx.bezierCurveTo.mock.calls
      .slice(-192)
      .map((p) => (0.92 - Math.hypot(...p.slice(-2)) / radius) / 0.5);
    return {
      mean: levels.reduce((a, b) => a + b, 0) / levels.length,
      detail: levels[31],
      rope: rope.reduce((a, b) => a + b, 0) / rope.length,
      angle: app.ctx.rotate.mock.calls.at(-1)[0],
      clipped: levels.filter((v) => v >= 0.999).length,
    };
  });
  expect(stats[0].detail).toBeCloseTo(stats[1].detail * 0.5);
  expect(stats[0].mean).toBeLessThan(stats[1].mean);
  expect(stats[0].rope).toBeLessThan(stats[1].rope);
  expect(stats[2].mean).toBeGreaterThan(stats[1].mean);
  expect(stats[2].rope).toBeGreaterThan(stats[1].rope);
  expect(stats[2].clipped).toBeLessThan(4);
  expect(stats[0].angle).toBe(stats[2].angle);
});

test.each([0, 255])(
  "render loop preserves raw beat input=%s and shares finished signals with effects",
  (byteBass) => {
    const app = setup({ bass: byteBass / 255 });
    const context = app.context;
    const bytes = new Uint8Array(1024).fill(100);
    bytes.fill(byteBass, 0, 15);
    const background = jest.fn(),
      fx = jest.fn(),
      render = jest.fn(),
      updateBeat = jest.fn();
    Object.assign(context, {
      analyser: {
        getByteFrequencyData: (data) => data.set(bytes),
        getByteTimeDomainData: () => {},
      },
      audioCtx: { state: "running" },
      bufferLength: 1024,
      canvas: {},
      ctx: {},
      requestAnimationFrame: () => {},
      performance: { now: () => 1000 },
      checkSilence: () => {},
      updateBeat,
      clearFrame: () => {},
      renderTrailHistory: () => {},
      updateProceduralBackground: jest.fn(),
      drawProceduralBackground: background,
      updateFxLive: fx,
      syncMediaThemeColors: () => {},
      visualModeController: { update: jest.fn(), draw: render },
      effectiveVisualMode: () => "bars",
      isMiniOverlayActive: () => false,
      overlayDrawSchedule:
        require("../src/overlay-display").createDrawSchedule(),
      prepareVisualFrame: () => {
        app.process();
        return app.frame;
      },
      beatPulse: 0,
    });
    context.ModeRegistry = require("../src/mode-registry");
    vm.createContext(context);
    vm.runInContext(source("constants.js"), context);
    vm.runInContext(source("visuals/loop.js"), context);
    context.loop(1000);
    const signals = app.signals();
    expect(updateBeat.mock.calls[0][0]).toBe(byteBass);
    expect(fx.mock.calls[0]).toEqual([
      signals.levels.bass,
      signals.levels.mid,
      signals.levels.treble,
      signals.beatIntensity,
    ]);
    expect(background.mock.calls[0]).toEqual([
      signals.levels.bass,
      signals.levels.mid,
      signals.levels.treble,
      signals.beatIntensity,
    ]);
    expect(context.updateProceduralBackground.mock.calls[0].slice(1)).toEqual([
      signals.motion.bass,
      0,
    ]);
    expect(render.mock.calls[0][2].signals).toBe(signals);
    expect(Array.from(context.freqData)).toEqual(Array.from(bytes));
  }
);

test.each([44100, 48000, 96000])(
  "bass power calibration uses 30-180 Hz at %s Hz",
  (sampleRate) => {
    const fftSize = 2048;
    const binHz = sampleRate / fftSize;
    const data = new Float32Array(fftSize / 2);
    for (const [db, expected] of [
      [-Infinity, 0],
      [-80, 0],
      [-65, 0],
      [-45, 0.5],
      [-25, 1],
      [-10, 1],
    ]) {
      data.fill(db);
      expect(AudioMath.bassPowerLevel(data, sampleRate, fftSize)).toBeCloseTo(
        expected
      );
    }
    data.fill(-Infinity);
    data[Math.round(1000 / binHz)] = 0;
    expect(AudioMath.bassPowerLevel(data, sampleRate, fftSize)).toBe(0);
    data[Math.round(100 / binHz)] = -30;
    expect(AudioMath.bassPowerLevel(data, sampleRate, fftSize)).toBeGreaterThan(
      0.5
    );
  }
);
test("bass combines linear power rather than averaging decibels", () => {
  const data = new Float32Array(1024).fill(-Infinity);
  // 10 Hz bins: 15 bins' worth of overlap, one strong 100 Hz bin.
  data[10] = -25;
  const expected = (10 * Math.log10(10 ** (-25 / 10) / 15) + 65) / 40;
  expect(AudioMath.bassPowerLevel(data, 20480, 2048)).toBeCloseTo(expected);
});
