const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const AudioMath = require("../src/audio-math");

const source = (file) =>
  fs.readFileSync(path.join(__dirname, "../src", file), "utf8");

function setup({ enabled = true, amount = 0.5, bass = 0.5 } = {}) {
  const gradient = { addColorStop() {} };
  const ctx = new Proxy(
    {
      fillRect: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      createLinearGradient: () => gradient,
    },
    {
      get: (object, key) => (key in object ? object[key] : () => {}),
      set: (object, key, value) => {
        object[key] = value;
        return true;
      },
    }
  );
  const context = {
    AudioMath,
    ctx,
    canvas: { width: 1000, height: 800 },
    renderCanvas: { width: 1000, height: 800 },
    state: {
      bassSensitivityEnabled: enabled,
      bassSensitivityAmount: amount,
      valueHandling: "linear",
      sensitivity: 1,
      smoothingEnabled: false,
      mode: 0,
      theme: 0,
      hueShift: 0,
      barsAlignment: "bottom",
      waveformStyle: "line",
      glowIntensity: 0,
      colorGradientEnabled: true,
    },
    beatPulse: 0,
    bufferLength: 1024,
    freqData: Uint8Array.from({ length: 1024 }, (_, i) =>
      Math.round(100 + 60 * Math.sin(i / 24))
    ),
    timeData: Uint8Array.from({ length: 1024 }, (_, i) =>
      Math.round(128 + 40 * Math.sin(i / 16))
    ),
  };
  vm.createContext(context);
  for (const file of [
    "constants.js",
    "visuals.js",
    "visuals/bars.js",
    "visuals/waveform.js",
    "visuals/orbit.js",
  ])
    vm.runInContext(source(file), context);
  context.updateBassSensitivity(bass, 10);
  return { context, ctx, read: (code) => vm.runInContext(code, context) };
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
    app.context.updateBassSensitivity(0.5, 10);
    expect(app.read("bassSensitivityGain")).toBeCloseTo(
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
  app.read("bassSensitivityGain = 0.25");
  for (const value of [-0.6, 0, 0.5, 1.5])
    expect(app.context.applyBassModulation(value)).toBe(value);
  app.context.updateBassSensitivity(0, 1 / 60);
  expect(app.read("bassSensitivityGain")).toBe(1);
});

test("disabling resets immediately without changing the base sensitivity or FFT", () => {
  const app = setup({ bass: 0 });
  const before = Array.from(app.context.freqData);
  expect(app.context.applyBassModulation(0.5)).toBeCloseTo(0.25);
  app.context.state.bassSensitivityEnabled = false;
  expect(app.context.applyBassModulation(0.5)).toBe(0.5);
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
    app.context.drawBars(0, 0, 0, 1 / 60);
    return app.ctx.fillRect.mock.calls[0][3];
  });
  expect(heights[0]).toBeCloseTo(heights[1] * 0.5);
  expect(heights[2]).toBeGreaterThan(heights[1]);
});

test("waveform amplitude follows bass without changing its samples or timing", () => {
  const amplitudes = [0, 0.5, 1].map((bass) => {
    const app = setup({ bass });
    const original = Array.from(app.context.timeData);
    app.context.drawWaveform(0, 0, 0);
    expect(Array.from(app.context.timeData)).toEqual(original);
    return Math.max(
      ...app.ctx.lineTo.mock.calls.map(([, y]) => Math.abs(y - 400))
    );
  });
  expect(amplitudes[0]).toBeCloseTo(amplitudes[1] * 0.5);
  expect(amplitudes[2]).toBeGreaterThan(amplitudes[1]);
});

test("Orbit's direct float path and rope forces follow gain without flattening or changing rotation", () => {
  const stats = [0, 0.5, 1].map((bass) => {
    const app = setup({ bass });
    app.context.state.valueHandling = "logarithmic";
    app.context.state.sensitivity = 2.4;
    app.context.analyser = {
      getFloatFrequencyData: (data) => {
        for (let i = 0; i < data.length; i++)
          data[i] =
            -65 + 40 * Math.exp(-Math.pow((Math.log2(i + 1) - 4) / 0.8, 2));
      },
    };
    for (let i = 0; i < 60; i++) app.context.drawOrbit(0, 0, 0, 1 / 60);
    return app.read(
      "({mean:orbitSpectrum.reduce((a,b)=>a+b,0)/orbitSpectrum.length, rope:orbitDisplacement.reduce((a,b)=>a+b,0)/orbitDisplacement.length, angle:orbitRotation, clipped:orbitSpectrum.filter(v=>v>=0.999).length})"
    );
  });
  expect(stats[0].mean).toBeCloseTo(stats[1].mean * 0.5);
  expect(stats[0].rope).toBeLessThan(stats[1].rope);
  expect(stats[2].mean).toBeGreaterThan(stats[1].mean);
  expect(stats[2].rope).toBeGreaterThan(stats[1].rope);
  expect(stats[2].clipped).toBeLessThan(4);
  expect(stats[0].angle).toBe(stats[2].angle);
});

test.each([0, 255])(
  "render loop measures original bass=%s and modulates effects without altering mode clocks",
  (byteBass) => {
    const app = setup({ bass: 0.5 });
    const input = new Uint8Array(1024).fill(100);
    input.fill(byteBass, 0, 15);
    Object.assign(app.context, {
      analyser: {
        getByteFrequencyData: (data) => data.set(input),
        getByteTimeDomainData: () => {},
      },
      audioCtx: { state: "running" },
      requestAnimationFrame: jest.fn(),
      performance: { now: () => 1000 },
      readBassSensitivityLevel: () => (byteBass === 0 ? 0 : 1),
      checkSilence: jest.fn(),
      updateBeat: jest.fn(),
      clearFrame: jest.fn(),
      renderTrailHistory: jest.fn(),
      drawBars: jest.fn(),
      renderProceduralBackground: jest.fn(),
      updateFxLive: jest.fn(),
    });
    app.context.state.sensitivity = 2.4;
    app.context.state.valueHandling = "logarithmic";
    vm.runInContext(source("visuals/loop.js"), app.context);
    for (let i = 0; i < 180; i++) app.context.loop(1000 + (i * 1000) / 60);
    const rawMid = Math.min(
      1,
      AudioMath.applyValueHandling(
        AudioMath.normalizeEnergy(100, 15, 165),
        "logarithmic"
      ) * 2.4
    );
    expect(app.context.drawBars.mock.calls.at(-1)[1]).toBe(rawMid);
    const expectedGain = byteBass === 0 ? 0.5 : 1.5;
    expect(app.read("bassSensitivityGain")).toBeCloseTo(expectedGain, 5);
    expect(app.context.updateFxLive.mock.calls.at(-1)[1]).toBeCloseTo(
      AudioMath.applyBassGain(rawMid, expectedGain),
      5
    );
    expect(app.context.updateBeat.mock.calls.at(-1)[0]).toBe(byteBass);
    expect(Array.from(app.context.freqData)).toEqual(Array.from(input));
    const background = app.context.renderProceduralBackground.mock.calls.at(-1);
    expect(background[5]).toBe(app.context.drawBars.mock.calls.at(-1)[0]);
    expect(background[6]).toBe(0);
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
