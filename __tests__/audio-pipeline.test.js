const Pipeline = require("../src/audio-pipeline");
const MathAudio = require("../src/audio-math");
const Registry = require("../src/mode-registry");
const { setup, names } = require("./helpers/mode-fixture.cjs");
function fixture(overrides = {}) {
  const settings = {
    sensitivity: 1,
    valueHandling: "linear",
    smoothingEnabled: false,
    bassSensitivityEnabled: false,
    bassSensitivityAmount: 0.5,
    radialMode: "mirrored",
    cascadeFrequencyOrder: "bass-to-treble",
    ...overrides,
  };
  const input = {
    sampleRate: 48000,
    frequencyBytes: new Uint8Array(1024).fill(120),
    timeBytes: Uint8Array.from({ length: 1024 }, (_, i) =>
      Math.round(128 + 40 * Math.sin(i / 17))
    ),
    spectrumDb: new Float32Array(1024).fill(-45),
    beatPulse: 0.7,
  };
  input.spectrumDb[500] = -20;
  const pipeline = Pipeline.create();
  const step = (mode = "bars") => {
    pipeline.update(input, settings, { dtSec: 0.1 });
    return pipeline.forMode(mode);
  };
  return { input, settings, pipeline, step };
}

test("Waveform Prism shares Prism's finished bands and adaptive range", () => {
  const f = fixture({ waveformStyle: "prism" });
  const line = f.step("waveform");
  const circle = f.pipeline.forMode("prism");
  expect(line.bands).toHaveLength(96);
  expect([...line.bands]).toEqual([...circle.bands]);
  expect(line.rangeEndHz).toBe(circle.rangeEndHz);
  expect(f.pipeline.forMode("waveform")).toBe(line);
  f.settings.sensitivity = 0;
  expect([...f.step("waveform").bands].every((value) => value === 0)).toBe(
    true
  );
});

test.each(["linear", "exponential", "logarithmic"])(
  "Prism variants preserve %s controls, bass gain, smoothing and range",
  (valueHandling) => {
    for (const bassSensitivityEnabled of [false, true]) {
      const f = fixture({
        waveformStyle: "prism",
        valueHandling,
        sensitivity: 2.5,
        bassSensitivityEnabled,
        bassSensitivityAmount: 0.75,
        smoothingEnabled: true,
      });
      for (let frame = 0; frame < 10; frame++) {
        f.input.spectrumDb.fill(-80);
        f.input.spectrumDb.fill(-30, 2, 80);
        f.input.spectrumDb.fill(-45, 250, 270);
        const line = f.step("waveform"),
          circle = f.pipeline.forMode("prism");
        expect([...line.bands]).toEqual([...circle.bands]);
        expect([...line.motionBands]).toEqual([...circle.motionBands]);
        expect(line.rangeEndHz).toBe(circle.rangeEndHz);
        expect([...line.waveform]).toEqual([...circle.waveform]);
      }
    }
  }
);

test("style switching retains one mode history, cached outputs and buffers until reset", () => {
  const f = fixture({ waveformStyle: "prism", smoothingEnabled: true });
  const output = f.step("waveform"),
    bands = output.bands;
  const before = [...bands];
  f.settings.waveformStyle = "line";
  expect(f.pipeline.forMode("waveform")).toBe(output);
  f.input.spectrumDb.fill(-Infinity);
  f.input.frequencyBytes.fill(0);
  for (let frame = 0; frame < 10; frame++) f.step("waveform");
  expect([...bands]).toEqual(before);
  f.settings.waveformStyle = "prism";
  for (let frame = 0; frame < 10; frame++) f.step("bars");
  expect([...bands]).toEqual(before);
  const resumed = f.step("waveform");
  expect(resumed).toBe(output);
  expect(resumed.bands).toBe(bands);
  expect([...bands].some((value) => value > 0)).toBe(true);
  expect([...bands].some((value, i) => value < before[i])).toBe(true);
  f.pipeline.reset();
  const reset = f.step("waveform");
  expect(reset.bands).toBe(bands);
  expect([...reset.bands].every((value) => value === 0)).toBe(true);
});

test("declared style selectors are captured at update, before the first profile request", () => {
  const f = fixture({ waveformStyle: "line" });
  f.pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  f.settings.waveformStyle = "prism";
  expect(
    [...f.pipeline.forMode("waveform").bands].every((value) => value === 0)
  ).toBe(true);
  expect([...f.step("waveform").bands].some((value) => value > 0)).toBe(true);
});

test("synthetic variants use complete profiles and reuse capacity-sized storage across different counts", () => {
  const definition = {
    ...Registry.get("bars"),
    id: "variant-test",
    audio: {
      sampler: "bars",
      count: 4,
      release: 2,
      variants: {
        setting: "waveformStyle",
        profiles: {
          prism: {
            sampler: "prism",
            count: 96,
            release: 10,
            threshold: 0.2,
            domain: "db",
          },
        },
      },
    },
  };
  const registry = Registry.createRegistry([definition]);
  const f = fixture({ waveformStyle: "prism" }),
    pipeline = Pipeline.create({ registry });
  pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  const large = pipeline.forMode("variant-test"),
    storage = large.bands;
  expect(storage.length).toBe(96);
  const expectedRegistry = Registry.createRegistry([
    {
      ...definition,
      id: "expected",
      audio: definition.audio.variants.profiles.prism,
    },
  ]);
  const expected = Pipeline.create({ registry: expectedRegistry });
  expected.update(f.input, f.settings, { dtSec: 0.1 });
  expect([...storage]).toEqual([...expected.forMode("expected").bands]);
  f.settings.waveformStyle = "line";
  pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  const small = pipeline.forMode("variant-test").bands;
  expect(small.length).toBe(4);
  expect(small.buffer).toBe(storage.buffer);
  f.settings.waveformStyle = "prism";
  pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  expect(pipeline.forMode("variant-test").bands).toBe(storage);
  f.settings.waveformStyle = "line";
  pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  expect(pipeline.forMode("variant-test").bands).toBe(small);
});

test("FFT resizing resets adaptive range for a Prism variant even while its base style is selected", () => {
  const f = fixture({ waveformStyle: "prism" });
  f.input.spectrumDb.fill(-30);
  const bands = f.step("waveform").bands;
  expect(f.pipeline.forMode("waveform").rangeEndHz).toBeGreaterThan(10000);
  f.settings.waveformStyle = "line";
  f.input.spectrumDb = new Float32Array(128).fill(-Infinity);
  f.input.spectrumDb.fill(-30, 2, 12);
  f.input.frequencyBytes = new Uint8Array(128).fill(100);
  f.step("waveform");
  f.settings.waveformStyle = "prism";
  const line = f.step("waveform"),
    circle = f.pipeline.forMode("prism");
  expect(line.bands).toBe(bands);
  expect(line.rangeEndHz).toBe(circle.rangeEndHz);
  expect(line.rangeEndHz).toBeLessThanOrEqual(12000);
});
test.each([44100, 48000, 96000])(
  "power aggregation clips Hz edges and averages linear power at %s Hz",
  (sampleRate) => {
    const data = new Float32Array(1024).fill(-45);
    expect(Pipeline.powerBandDb(data, sampleRate, 2048, 30, 250)).toBeCloseTo(
      -45
    );
    expect(
      Pipeline.powerBandDb(data, sampleRate, 2048, 12000, 1e6)
    ).toBeCloseTo(-45);
    expect(Pipeline.powerBandDb(data, sampleRate, 2048, 0, 0)).toBe(-Infinity);
    data.fill(-Infinity);
    data[Math.round((1000 * 2048) / sampleRate)] = -10;
    expect(Pipeline.powerBandDb(data, sampleRate, 2048, 30, 180)).toBe(
      -Infinity
    );
  }
);
test("power averaging, normalization and headroom have explicit units and endpoints", () => {
  const data = new Float32Array(1024).fill(-Infinity);
  data[10] = -25;
  expect(Pipeline.powerBandDb(data, 20480, 2048, 30, 180)).toBeCloseTo(
    -25 - 10 * Math.log10(15)
  );
  expect(Pipeline.normalize(-Infinity, -30)).toBe(0);
  expect(Pipeline.normalize(-100, -65)).toBe(0);
  expect(Pipeline.normalize(-75, -30)).toBe(0);
  expect(Pipeline.normalize(-52.5, -30)).toBe(0.5);
  expect(Pipeline.normalize(-30, -30)).toBe(1);
  for (const gain of [0.5, 1, 2.5])
    expect(
      Pipeline.controlled(0.5, {
        sensitivity: gain,
        valueHandling: "exponential",
      })
    ).toBeCloseTo(
      MathAudio.applyValueHandling(
        MathAudio.applyBassGain(0.5, gain),
        "exponential"
      )
    );
});
test("control order applies sensitivity, curve and bass gain exactly once", () => {
  const f = fixture({
    sensitivity: 1.7,
    valueHandling: "exponential",
    bassSensitivityEnabled: true,
  });
  let result;
  for (let i = 0; i < 60; i++) result = f.step();
  const normalized = Pipeline.normalize(-45, -20);
  const base = Pipeline.controlled(normalized, f.settings);
  expect(result.motionBands[40]).toBeCloseTo(base);
  const multiplier = MathAudio.bassSensitivityTarget(0.5, 0.5, "exponential");
  expect(result.bassMultiplier).toBeCloseTo(multiplier, 8);
  expect(result.bands[40]).toBeCloseTo(
    MathAudio.applyBassGain(base, multiplier),
    8
  );
  expect(result.bands[40]).not.toBeCloseTo(
    MathAudio.applyBassGain(
      MathAudio.applyBassGain(base, multiplier),
      multiplier
    ),
    5
  );
});
test.each(names)(
  "%s consistently responds to Sensitivity and response curves",
  (id) => {
    const mean = (result) =>
      id === "waveform"
        ? Math.max(...result.waveform.map(Math.abs))
        : result.bands.reduce((a, b) => a + b, 0) / result.bands.length;
    const sensitivity = [0.5, 1, 2.5].map((s) => {
      const f = fixture({ sensitivity: s });
      return mean(f.step(id));
    });
    expect(sensitivity[0]).toBeLessThan(sensitivity[1]);
    expect(sensitivity[1]).toBeLessThan(sensitivity[2]);
    if (id !== "waveform") {
      const curves = ["exponential", "linear", "logarithmic"].map(
        (valueHandling) => {
          const f = fixture({ valueHandling });
          return mean(f.step(id));
        }
      );
      expect(curves[0]).toBeLessThan(curves[1]);
      expect(curves[1]).toBeLessThan(curves[2]);
    }
  }
);

test.each(names)(
  "%s only needs finished signals, not raw audio or control helpers",
  (id) => {
    const f = setup(id);
    f.process();
    const frame = {
      ...f.frame,
      settings: new Proxy(f.settings, {
        get(target, key) {
          if (
            [
              "sensitivity",
              "valueHandling",
              "bassSensitivityEnabled",
              "bassSensitivityAmount",
              "smoothingEnabled",
            ].includes(key)
          )
            throw Error(`Mode read audio control ${key}`);
          return target[key];
        },
      }),
    };
    delete frame.audio;
    delete frame.levels;
    const before = Array.from(frame.signals.bands);
    expect(() => {
      f.mode.update(frame);
      f.mode.draw(f.canvas.ctx, frame);
    }).not.toThrow();
    expect(Array.from(frame.signals.bands)).toEqual(before);
  }
);

test("FFT and waveform resizing keeps fixed profile buffers and a finite Prism cutoff", () => {
  const f = fixture();
  const first = f.step("prism").bands;
  f.input.spectrumDb = new Float32Array(512).fill(-45);
  f.input.frequencyBytes = new Uint8Array(512).fill(100);
  f.input.timeBytes = new Uint8Array(512).fill(128);
  const result = f.step("prism");
  expect(result.bands).toBe(first);
  expect(result.waveform.length).toBe(512);
  expect(Number.isFinite(result.rangeEndHz)).toBe(true);
  expect(result.rangeEndHz).toBeLessThanOrEqual(12000);
});
test("unchanged mid/high input follows bass while normalization and motion stay independent", () => {
  const results = [0, 0.5, 1].map((bass) => {
    const f = fixture({ bassSensitivityEnabled: true });
    f.input.spectrumDb.fill(-65 + bass * 40, 0, 10);
    let result;
    for (let i = 0; i < 60; i++) result = f.step();
    return {
      band: result.bands[40],
      motion: result.motionBands[40],
      reference: result.referenceDb,
      gain: result.bassMultiplier,
    };
  });
  expect(results[0].band).toBeCloseTo(results[1].band * 0.5);
  expect(results[2].band).toBeGreaterThan(results[1].band);
  expect(results.map((r) => r.reference)).toEqual([-20, -20, -20]);
  expect(results[0].motion).toBe(results[2].motion);
  expect(results.map((r) => r.gain)).toEqual([
    expect.closeTo(0.5, 8),
    expect.closeTo(1, 8),
    expect.closeTo(1.5, 8),
  ]);
});
test.each([
  { bassSensitivityEnabled: false, bassSensitivityAmount: 1 },
  { bassSensitivityEnabled: true, bassSensitivityAmount: 0 },
])(
  "disabled and zero Amount bypass stale gain and smoothing: %p",
  (options) => {
    const f = fixture({ bassSensitivityEnabled: true, smoothingEnabled: true });
    f.input.spectrumDb.fill(-25, 0, 10);
    for (let i = 0; i < 40; i++) f.step();
    Object.assign(f.settings, options);
    const result = f.step();
    expect(result.bassMultiplier).toBe(1);
    expect(Array.from(result.bands)).toEqual(Array.from(result.motionBands));
  }
);
test("waveform preserves signed shape and applies one uniform, bounded scale", () => {
  const f = fixture({ sensitivity: 2.5, bassSensitivityEnabled: true });
  f.input.spectrumDb.fill(-25, 0, 10);
  let result;
  for (let i = 0; i < 40; i++) result = f.step("waveform");
  const source = Array.from(f.input.timeBytes, (v) => (v - 128) / 128),
    peak = Math.max(...source.map(Math.abs));
  const expected =
    MathAudio.applyBassGain(
      MathAudio.applyBassGain(peak, 2.5),
      result.bassMultiplier
    ) / peak;
  for (let i = 0; i < source.length; i++)
    expect(result.waveform[i]).toBeCloseTo(source[i] * expected, 6);
  expect(Math.max(...result.waveform.map(Math.abs))).toBeLessThanOrEqual(1);
  const before = Array.from(result.waveform);
  f.settings.valueHandling = "logarithmic";
  f.settings.bassSensitivityEnabled = false;
  const linear = fixture({ sensitivity: 2.5 }).step("waveform").waveform;
  expect(Array.from(f.step("waveform").waveform)).toEqual(Array.from(linear));
  expect(before.some((v) => v < 0)).toBe(true);
});
test("canonical spectrum is read once and mode outputs and buffers are reused", () => {
  const f = fixture();
  const db = f.input.spectrumDb;
  delete f.input.spectrumDb;
  f.input.readFloatSpectrum = jest.fn(() => db);
  f.pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  const bars = f.pipeline.forMode("bars"),
    buffer = bars.bands;
  expect(f.pipeline.forMode("bars")).toBe(bars);
  f.pipeline.forMode("prism");
  expect(f.input.readFloatSpectrum).toHaveBeenCalledTimes(1);
  f.pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  expect(f.pipeline.forMode("bars").bands).toBe(buffer);
  const previous = Array.from(db);
  expect(Array.from(db)).toEqual(previous);
  f.pipeline.reset();
  expect(() => f.pipeline.forMode("bars")).toThrow("requires update");
  f.pipeline.update(f.input, f.settings, { dtSec: 0.1 });
  expect(f.pipeline.forMode("bars").bands).toBe(buffer);
});
test("inactive profiles hold smoothing state, while the reference follows audio independently", () => {
  const f = fixture({ smoothingEnabled: true });
  const waves = f.step("waves"),
    before = Array.from(waves.bands);
  f.input.spectrumDb.fill(-65);
  f.input.spectrumDb[500] = -20;
  for (let i = 0; i < 12; i++) f.step("bars");
  expect(Array.from(waves.bands)).toEqual(before);
  f.pipeline.forMode("waves");
  expect(Array.from(waves.bands)).not.toEqual(before);
  expect(f.pipeline.forMode("prism").referenceDb).toBe(-20);
});
test("Orbit shares the display range while Cascade retains its threshold and Prism distinct bins", () => {
  const f = fixture();
  const prism = f.step("prism"),
    orbit = f.pipeline.forMode("orbit"),
    cascade = f.pipeline.forMode("cascade");
  expect(orbit.bands[20]).toBeCloseTo(prism.bands[20]);
  expect(cascade.bands[20]).toBeLessThan(prism.bands[20]);
  for (const end of [98, 150, 512])
    for (let i = 0; i < 96; i++)
      expect(Pipeline.prismBandEdge(i + 1, 1024, end)).toBeGreaterThan(
        Pipeline.prismBandEdge(i, 1024, end)
      );
});

test.each([5, 20, 34])(
  "Orbit exponential retains quieter-band detail at spectral position %s",
  (index) => {
    const values = [-50, -40, -30].map((db) => {
      const f = fixture({ valueHandling: "exponential" });
      f.input.spectrumDb.fill(db);
      // A stronger peak outside Orbit's sampled range still sets the shared reference.
      f.input.spectrumDb[500] = -20;
      const value = f.step("orbit").bands[index];
      expect(value).toBeCloseTo(((45 + db + 20) / 45) ** 2.5);
      return value;
    });
    expect(values[0]).toBeGreaterThan(0.05);
    expect(values[1] - values[0]).toBeGreaterThan(0.1);
    expect(values[2] - values[1]).toBeGreaterThan(0.2);
  }
);
test("Prism contracts gradually, reopens for treble and holds range during silence", () => {
  const f = fixture();
  f.input.spectrumDb.fill(-Infinity);
  f.input.spectrumDb.fill(-30, 2, 80);
  const narrow = f.step("prism").rangeEndHz;
  f.input.spectrumDb.fill(-35, 450, 460);
  for (let i = 0; i < 15; i++) f.step("prism");
  const wide = f.step("prism").rangeEndHz;
  expect(wide).toBeGreaterThan(narrow * 3);
  f.input.spectrumDb.fill(-Infinity, 80);
  for (let i = 0; i < 60; i++) f.step("prism");
  const contracted = f.step("prism").rangeEndHz;
  expect(contracted).toBeLessThan(wide);
  f.input.spectrumDb.fill(-Infinity);
  for (let i = 0; i < 20; i++) f.step("prism");
  expect(f.step("prism").rangeEndHz).toBe(contracted);
});
test("raw features and beat measurements are untouched by visual controls; noise stays quiet", () => {
  const a = fixture(),
    b = fixture({
      sensitivity: 2.5,
      valueHandling: "logarithmic",
      bassSensitivityEnabled: true,
    });
  const first = a.step(),
    second = b.step();
  expect(first.features).toEqual(second.features);
  expect(first.features.rawBass).toBe(
    Pipeline.legacyBass(a.input.frequencyBytes)
  );
  const bytes = a.input.frequencyBytes.slice();
  a.input.spectrumDb.fill(-110);
  a.input.timeBytes.fill(128);
  for (const id of names) {
    const result = a.step(id);
    expect(result.bands.every((v) => v === 0)).toBe(true);
    expect(result.waveform.every((v) => v === 0)).toBe(true);
  }
  expect(a.input.frequencyBytes).toEqual(bytes);
});
test.each(["orbit", "kaleidoscope", "waves", "aurora", "tunnel"])(
  "%s accepts independent finished intensity and motion branches",
  (id) => {
    const a = setup(id);
    a.process();
    const motion = structuredClone(a.frame.signals.motion);
    a.settings.bassSensitivityEnabled = true;
    for (let i = 0; i < 20; i++) a.process();
    expect(a.frame.signals.motion).toEqual(motion);
    expect(() => a.render()).not.toThrow();
  }
);
