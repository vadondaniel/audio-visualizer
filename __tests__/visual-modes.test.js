const crypto = require("node:crypto");
const {
  names,
  setup,
  canonical,
  runtime,
} = require("./helpers/mode-fixture.cjs");
const baseline = require("./fixtures/mode-render-baseline.json");

describe.each(names)("%s lifecycle", (name) => {
  test.each(["landscape", "portrait"])(
    "preserves pre-refactor drawing in %s",
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
      for (let i = 0; i < 8; i++) {
        a.frame.timestampMs = 1000 + (i * 1000) / 60;
        a.frame.audioClockMs = a.frame.timestampMs;
        a.frame.beat.justHit = i === 0;
        a.frame.beat.pulse = i < 4 ? 0.8 : 0;
        a.frame.levels.bass = i < 4 ? 0.8 : 0.1;
        const hash = crypto
          .createHash("sha256")
          .update(JSON.stringify(canonical(a.render())))
          .digest("hex");
        expect(hash).toBe(baseline[name][scene][i]);
        expect(a.canvas.depth).toBe(0);
      }
    }
  );

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
