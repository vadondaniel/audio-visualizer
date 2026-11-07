const crypto = require("node:crypto");
const {
  names,
  setup,
  canonical,
  runtime,
  makeCanvas,
} = require("./helpers/mode-fixture.cjs");
const geometry = require("./fixtures/mode-geometry-baseline.json");

describe.each(names)("%s lifecycle", (name) => {
  test("uses replacement frame inputs and drawing contexts without retaining borrowed buffers", () => {
    const a = setup(name),
      b = setup(name);
    a.process();
    b.process();
    a.mode.update(a.frame);
    b.mode.update(b.frame);
    a.mode.draw(a.canvas.ctx, a.frame);
    const replacement = {
      ...a.frame,
      audio: undefined,
      width: 360,
      height: 720,
      settings: { ...a.settings, glowIntensity: 0 },
      signals: structuredClone(a.frame.signals),
      beat: { pulse: 0.15, justHit: false },
    };
    replacement.signals.bands.fill(0.25);
    replacement.signals.waveform.fill(-0.2);
    const before = structuredClone(replacement);
    const left = makeCanvas(),
      right = makeCanvas();
    a.mode.draw(left.ctx, replacement);
    b.mode.draw(right.ctx, replacement);
    expect(canonical(left.events)).toEqual(canonical(right.events));
    expect(replacement).toEqual(before);
    expect(left.events.length).toBeGreaterThan(0);
    expect(left.depth).toBe(0);
  });
  test("owns its state, does not simulate during draw, and resets to a fresh instance", () => {
    const a = setup(name),
      fresh = setup(name);
    const bytes = a.frame.audio.frequencyBytes.slice(),
      time = a.frame.audio.timeBytes.slice(),
      db = a.spectrum.slice();
    const settings = structuredClone(a.settings);
    const first = canonical(a.render());
    a.canvas.clear();
    a.mode.draw(a.canvas.ctx, a.frame);
    expect(canonical(a.canvas.events)).toEqual(first);
    a.mode.update(a.frame);
    // Another instance must still produce the original first frame.
    expect(canonical(fresh.render())).toEqual(first);
    for (let i = 0; i < 6; i++) a.render();
    a.pipeline.reset();
    a.mode.reset();
    expect(canonical(a.render())).toEqual(first);
    expect(a.frame.audio.frequencyBytes).toEqual(bytes);
    expect(a.frame.audio.timeBytes).toEqual(time);
    expect(a.spectrum).toEqual(db);
    expect(a.settings).toEqual(settings);
  });

  test("handles silence, clamped long frames, and resizing without nonfinite geometry", () => {
    const a = setup(name);
    a.frame.audio.frequencyBytes.fill(0);
    a.frame.audio.timeBytes.fill(128);
    a.spectrum.fill(-Infinity);
    Object.assign(a.frame.levels, { rawBass: 0, bass: 0, mid: 0, treble: 0 });
    Object.assign(a.frame.beat, { pulse: 0, justHit: false });
    a.frame.timestampMs += 3600000;
    a.frame.elapsedMs = 100;
    a.frame.dtSec = 0.1;
    a.render();
    a.frame.width = 360;
    a.frame.height = 720;
    a.render();
    expect(a.canvas.events.length).toBeGreaterThan(0);
    expect(a.canvas.depth).toBe(0);
  });
});

test.each([0, 0.5, 2])(
  "shared glow applies intensity %s and clears a previous shadow",
  (intensity) => {
    const ctx = { shadowBlur: 99, shadowColor: "red" };
    runtime.applyGlow(ctx, "cyan", 12, intensity);
    expect(ctx.shadowBlur).toBe(12 * intensity);
    expect(ctx.shadowColor).toBe(intensity > 0 ? "cyan" : "transparent");
    runtime.applyGlow(ctx, "red", 0, intensity);
    expect(ctx).toEqual({ shadowBlur: 0, shadowColor: "transparent" });
  }
);

test("reset storage retains allocated buffers, restores nested values, and drops transient entries", () => {
  const buffer = new Float32Array([3, 4]);
  const target = {
    values: buffer,
    history: [1, 2],
    nested: { phase: 4 },
    transient: true,
  };
  const initial = {
    values: new Float32Array([0, 0]),
    history: [],
    nested: { phase: 0 },
  };
  expect(runtime.restore(target, initial)).toBe(target);
  expect(target.values).toBe(buffer);
  expect(target).toEqual(initial);
  const allocated = new Uint8Array([1, 2, 3]);
  expect(runtime.restore(allocated, null)).toBe(allocated);
  expect(Array.from(allocated)).toEqual([0, 0, 0]);
});

test("controller updates only the active instance, preserves it across switches, and isolates canvas state", () => {
  const a = setup("bars");
  const calls = [];
  const make = (id) => () => ({
    update: () => calls.push(`update:${id}`),
    draw(ctx) {
      calls.push(`draw:${id}`);
      ctx.globalAlpha = 0.2;
      ctx.rotate(1);
    },
    reset: () => calls.push(`reset:${id}`),
  });
  const controller = runtime.createController(
    { bars: make("bars"), prism: make("prism") },
    {}
  );
  for (const id of ["bars", "prism", "bars"])
    controller.render(id, a.canvas.ctx, a.frame);
  expect(calls).toEqual([
    "update:bars",
    "draw:bars",
    "update:prism",
    "draw:prism",
    "update:bars",
    "draw:bars",
  ]);
  expect(a.canvas.ctx.globalAlpha).toBe(1);
  expect(a.canvas.depth).toBe(0);
  controller.reset();
  expect(calls.slice(-2)).toEqual(["reset:bars", "reset:prism"]);
});

test("float spectrum is lazy, cached once per frame, borrowed, and supports byte-only sources", () => {
  const reader = runtime.createFloatSpectrumReader();
  const bytes = new Uint8Array([0, 128, 255]);
  const source = { getFloatFrequencyData: jest.fn((data) => data.fill(-42)) };
  reader.beginFrame(source, bytes);
  expect(source.getFloatFrequencyData).not.toHaveBeenCalled();
  const first = reader.read();
  expect(reader.read()).toBe(first);
  expect(source.getFloatFrequencyData).toHaveBeenCalledTimes(1);
  reader.beginFrame(source, bytes);
  expect(reader.read()).toBe(first);
  expect(source.getFloatFrequencyData).toHaveBeenCalledTimes(2);
  reader.beginFrame({}, bytes);
  expect(Array.from(reader.read())).toEqual([
    -100,
    expect.closeTo(-100 + (128 * 70) / 255, 4),
    -30,
  ]);
  expect(Array.from(bytes)).toEqual([0, 128, 255]);
  reader.reset();
  expect(reader.read()).toBe(first);
  expect(Array.from(first)).toEqual([-Infinity, -Infinity, -Infinity]);
});

test("host consumes a particle beat after update and restores canvas state even if drawing fails", () => {
  const a = setup("particles"),
    calls = [];
  const controller = runtime.createController(
    {
      particles: () => ({
        update: () => calls.push("update"),
        draw() {
          calls.push("draw");
          throw Error("test draw");
        },
        reset() {},
      }),
    },
    { consumeBeat: () => calls.push("consume") }
  );
  expect(() => controller.render("particles", a.canvas.ctx, a.frame)).toThrow(
    "test draw"
  );
  expect(calls).toEqual(["update", "consume", "draw"]);
  expect(a.canvas.depth).toBe(0);
});

test("controller update and draw are independent and drawing never consumes another event", () => {
  const a = setup("particles"),
    calls = [];
  const controller = runtime.createController(
    {
      particles: () => ({
        update: () => calls.push("update"),
        draw: () => calls.push("draw"),
        reset: () => calls.push("reset"),
      }),
    },
    { consumeBeat: () => calls.push("consume") }
  );
  controller.update("particles", a.frame);
  expect(calls).toEqual(["update", "consume"]);
  controller.draw("particles", a.canvas.ctx, a.frame);
  controller.draw("particles", a.canvas.ctx, a.frame);
  expect(calls).toEqual(["update", "consume", "draw", "draw"]);
  expect(a.canvas.depth).toBe(0);
  expect(() => controller.update("missing", a.frame)).toThrow(
    "Unknown visual mode"
  );
  expect(() => controller.draw("missing", a.canvas.ctx, a.frame)).toThrow(
    "Unknown visual mode"
  );
});

describe.each(Object.keys(geometry))("%s historical geometry", (name) => {
  test.each(["landscape", "portrait"])(
    "preserves geometry with explicit finished signals in %s",
    (scene) => {
      const a = setup(name);
      if (scene === "portrait") {
        a.frame.width = 420;
        a.frame.height = 720;
        a.settings.valueHandling = "logarithmic";
        a.settings.sensitivity = 2.5;
        a.setTheme("Rainbow Cycle");
        a.settings.waveformStyle = "filled";
        a.settings.radialMode = "full";
        a.settings.particleStyle = "vortex";
        a.settings.cascadeFillStyle = "theme";
        a.settings.cascadeFrequencyOrder = "treble-to-bass";
        a.settings.hueShift = 87;
      }
      const source = geometry[name][scene];
      // Preserve the historical fingerprint with its original style preset.
      // Shipped Prism styling and unchanged geometry are compared separately.
      if (name === "prism")
        Object.assign(a.constants.VISUAL_TUNING.prism, {
          minLineWidth: 1,
          lineWidthScale: 0.0018,
          contourAlpha: 0.4,
          spokeAlpha: 0.25,
          spokeAlphaGain: 0.45,
          glowBlur: 8,
          glowBlurGain: 7,
        });
      a.frame.timestampMs = 1000;
      a.frame.audioClockMs = 1000;
      a.frame.beat.pulse = 0.8;
      a.frame.signals = {
        ...source,
        bands: Float64Array.from(source.bands),
        motionBands: Float64Array.from(source.bands),
        motionEnvelopes: { ...source.envelopes },
        waveform: Float32Array.from(
          a.frame.audio.timeBytes,
          (v) => (v - 128) / 128
        ),
      };
      a.mode.update(a.frame);
      a.mode.draw(a.canvas.ctx, a.frame);
      const serialized = JSON.stringify(a.canvas.events, (_, v) =>
        typeof v === "number"
          ? Math.round(v * 1e7) / 1e7
          : typeof v === "string" && /^(hsla?|rgba?)\(/.test(v)
            ? v.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, (n) =>
                String(Math.round(Number(n) * 1e7) / 1e7)
              )
            : v
      );
      expect(crypto.createHash("sha256").update(serialized).digest("hex")).toBe(
        source.hash
      );
      expect(a.canvas.depth).toBe(0);
    }
  );
});
