const {
  createRopeState,
  advanceRope,
  resetRope,
} = require("../src/visuals/rope");
const { setup, canonical } = require("./helpers/mode-fixture.cjs");
const Registry = require("../src/mode-registry"),
  ModeList = require("../src/mode-list"),
  AudioMath = require("../src/audio-math"),
  Protocol = require("../src/settings-protocol");
const tuning = setup("rope").constants.VISUAL_TUNING.rope;
const blank = () => new Float64Array(96);
const peak = (values) => Math.max(...values.map(Math.abs));

test("circular hits pull promptly and distinguish successive attacks from lingering wobble", () => {
  const run = (constants) => {
    const state = createRopeState(true),
      bands = blank();
    let maximum = 0,
      peakTime = 0,
      secondRise = 0,
      beforeSecond = 0;
    for (let frame = 0; frame < 240; frame++) {
      const time = frame / 240;
      bands.fill(0);
      if (time < 0.05 || (time >= 0.25 && time < 0.3)) bands.fill(0.8, 20, 28);
      if (frame === 60) beforeSecond = state.displacement[24];
      advanceRope(state, bands, 1 / 240, constants);
      if (time < 0.25 && state.displacement[24] > maximum) {
        maximum = state.displacement[24];
        peakTime = time;
      }
      if (time >= 0.25 && time < 0.4)
        secondRise = Math.max(
          secondRise,
          state.displacement[24] - beforeSecond
        );
    }
    return { peakTime, secondRise };
  };
  const current = run(tuning),
    slow = run({ ...tuning, circularRestoring: 80, circularDamping: 3.5 });
  expect(current.peakTime).toBeLessThan(0.09);
  expect(current.peakTime).toBeLessThan(slow.peakTime * 0.75);
  expect(current.secondRise).toBeGreaterThan(0.35);
});

test("circular tension preserves stronger local dents without changing straight physics", () => {
  const measure = (circular, constants) => {
    const state = createRopeState(circular),
      bands = blank();
    let contrast = 0;
    for (let frame = 0; frame < 180; frame++) {
      bands.fill(0.25);
      bands.fill(0.4 + 0.4 * Math.max(0, Math.sin(frame / 7)), 20, 28);
      advanceRope(state, bands, 1 / 60, constants);
      contrast = Math.max(
        contrast,
        Math.max(...state.displacement) - Math.min(...state.displacement)
      );
    }
    return { state, contrast };
  };
  const oldTension = { ...tuning, circularCoupling: tuning.coupling };
  expect(measure(true, tuning).contrast).toBeGreaterThan(
    measure(true, oldTension).contrast * 1.1
  );
  expect(measure(false, tuning)).toEqual(measure(false, oldTension));
});

test.each([true, false])(
  "local tugs propagate to neighbors in bounded steps (%s circular)",
  (circular) => {
    const state = createRopeState(circular),
      bands = blank(),
      offset = circular ? 0 : 1;
    bands[48] = 1;
    advanceRope(state, bands, tuning.stepSec, tuning);
    expect(state.displacement[48 + offset]).toBeGreaterThan(0);
    expect(state.displacement[49 + offset]).toBe(0);
    advanceRope(state, bands, tuning.stepSec, tuning);
    expect(state.displacement[49 + offset]).toBeGreaterThan(0);
    expect(state.displacement[50 + offset]).toBe(0);
  }
);
test("closed neighbors transmit across the frequency seam while straight endpoints stay anchored", () => {
  const circle = createRopeState(true),
    line = createRopeState(false),
    bands = blank();
  bands[0] = 1;
  for (let i = 0; i < 2; i++) {
    advanceRope(circle, bands, tuning.stepSec, tuning);
    advanceRope(line, bands, tuning.stepSec, tuning);
  }
  expect(circle.displacement[95]).toBeGreaterThan(0);
  expect(line.displacement[96]).toBe(0);
  bands.fill(1);
  for (let i = 0; i < 1000; i++)
    advanceRope(line, bands, tuning.stepSec, tuning);
  for (const data of [line.displacement, line.velocity]) {
    expect(data[0]).toBe(0);
    expect(data[97]).toBe(0);
  }
});
test.each([true, false])(
  "release crosses rest, carries waves and damps to silence (%s circular)",
  (circular) => {
    const state = createRopeState(circular),
      bands = blank();
    let maximum = 0,
      minimum = 0,
      neighbor = 0;
    for (let frame = 0; frame < 1200; frame++) {
      bands.fill(0);
      if (frame < 24) bands[48] = 1;
      advanceRope(state, bands, tuning.stepSec, tuning);
      maximum = Math.max(maximum, ...state.displacement);
      neighbor = Math.max(
        neighbor,
        state.displacement[49 + (circular ? 0 : 1)]
      );
      if (frame >= 24) minimum = Math.min(minimum, ...state.displacement);
    }
    expect(maximum).toBeGreaterThan(0.1);
    expect(neighbor).toBeGreaterThan(0.05);
    expect(minimum).toBeLessThan(-0.01);
    expect(peak(state.displacement)).toBeLessThan(0.001);
    expect(peak(state.velocity)).toBeLessThan(0.001);
  }
);
test.each([true, false])(
  "silence, sustained audio and extreme impulses remain finite and bounded (%s circular)",
  (circular) => {
    const state = createRopeState(circular),
      bands = blank();
    advanceRope(state, bands, 0.1, tuning);
    expect(peak(state.displacement)).toBe(0);
    bands.fill(1);
    for (let i = 0; i < 1000; i++) advanceRope(state, bands, 1 / 60, tuning);
    for (const values of [
      state.displacement,
      state.velocity,
      state.acceleration,
    ])
      expect([...values].every(Number.isFinite)).toBe(true);
    expect(peak(state.displacement)).toBeLessThanOrEqual(tuning.limit);
    for (const sign of [-1, 1]) {
      state.velocity[48] = sign * 1e9;
      advanceRope(state, bands, tuning.stepSec, tuning);
      expect(state.displacement[48]).toBe(sign * tuning.limit);
      expect(state.velocity[48]).toBe(0);
    }
  }
);
test("fixed-step accumulator, invalid timing and pause cap do not accumulate catch-up work", () => {
  const state = createRopeState(true),
    bands = blank();
  bands[12] = 1;
  const before = structuredClone(state);
  for (const dt of [0, -1, NaN, Infinity, -Infinity])
    advanceRope(state, bands, dt, tuning);
  expect(canonical(state)).toEqual(canonical(before));
  advanceRope(state, bands, tuning.stepSec / 2, tuning);
  expect(peak(state.displacement)).toBe(0);
  advanceRope(state, bands, tuning.stepSec / 2, tuning);
  expect(state.displacement[12]).toBeGreaterThan(0);
  const paused = createRopeState(true),
    bounded = createRopeState(true);
  advanceRope(paused, bands, 3600, tuning);
  advanceRope(bounded, bands, 0.1, tuning);
  expect(paused).toEqual(bounded);
  expect(paused.accumulator).toBeLessThan(tuning.stepSec);
});
test.each([60, 120, 144, 165, 240])(
  "motion stays comparable at %i Hz",
  (rate) => {
    const sample = (hz) => {
      const s = createRopeState(true),
        bands = blank();
      for (let i = 0; i < hz; i++) {
        bands.fill(0);
        if (i / hz < 0.1 - 1e-10) bands.fill(1, 40, 46);
        advanceRope(s, bands, 1 / hz, tuning);
      }
      return s;
    };
    const a = sample(rate),
      reference = sample(240);
    expect(
      Math.max(
        ...a.displacement.map((v, i) => Math.abs(v - reference.displacement[i]))
      )
    ).toBeLessThan(0.015);
  }
);
test("owned storage is reused on advance/reset; borrowed samples are unchanged and not retained", () => {
  const state = createRopeState(false),
    arrays = { ...state },
    bands = Float32Array.from({ length: 96 }, (_, i) => i / 95),
    copy = bands.slice();
  for (let i = 0; i < 20; i++) advanceRope(state, bands, 1 / 60, tuning);
  expect(bands).toEqual(copy);
  expect(state.target).not.toBe(bands);
  for (const key of [
    "displacement",
    "velocity",
    "acceleration",
    "target",
    "previous",
  ])
    expect(state[key]).toBe(arrays[key]);
  resetRope(state);
  expect(state).toEqual(createRopeState(false));
  for (const key of [
    "displacement",
    "velocity",
    "acceleration",
    "target",
    "previous",
  ])
    expect(state[key]).toBe(arrays[key]);
});
test("layout histories remain independent across drawing, switching and resizing", () => {
  const f = setup("rope");
  f.process();
  f.frame.signals.bands.fill(0);
  f.frame.signals.bands.fill(1, 10, 18);
  f.mode.update(f.frame);
  f.mode.draw(f.canvas.ctx, f.frame);
  const circle = canonical(f.canvas.events);
  f.canvas.clear();
  f.mode.draw(f.canvas.ctx, f.frame);
  expect(canonical(f.canvas.events)).toEqual(circle);
  f.settings.ropeLayout = "straight";
  f.frame.signals.bands.fill(0);
  f.mode.update(f.frame);
  f.canvas.clear();
  f.mode.draw(f.canvas.ctx, f.frame);
  const coordinates = f.canvas.events.find((e) => e[0] === "stroke")[2];
  for (const event of coordinates)
    for (let i = 2; i < event.length; i += 2)
      expect(event[i]).toBe(f.frame.height / 2);
  f.settings.ropeLayout = "circular";
  f.canvas.clear();
  f.mode.draw(f.canvas.ctx, f.frame);
  expect(canonical(f.canvas.events)).toEqual(circle);
  const oldWidth = f.frame.width;
  f.frame.width = 600;
  f.mode.draw(f.canvas.ctx, f.frame);
  f.frame.width = oldWidth;
  f.canvas.clear();
  f.mode.draw(f.canvas.ctx, f.frame);
  expect(canonical(f.canvas.events)).toEqual(circle);
  f.mode.reset();
  f.canvas.clear();
  f.mode.draw(f.canvas.ctx, f.frame);
  const fresh = setup("rope");
  fresh.process();
  fresh.mode.draw(fresh.canvas.ctx, fresh.frame);
  expect(canonical(f.canvas.events)).toEqual(canonical(fresh.canvas.events));
});
test.each(["circular", "straight"])(
  "prepared %s geometry uses one rope, finite smooth controls and fixed framing",
  (layout) => {
    const f = setup("rope");
    f.settings.ropeLayout = layout;
    f.process();
    f.frame.signals.bands.fill(1);
    const initial = f.mode.getOverlayBounds(f.frame),
      bounds = initial && { ...initial };
    for (let i = 0; i < 120; i++) f.mode.update(f.frame);
    f.mode.draw(f.canvas.ctx, f.frame);
    expect(f.canvas.events.filter((e) => e[0] === "fill")).toHaveLength(0);
    const path = f.canvas.events.find((e) => e[0] === "stroke")[2];
    expect(path.filter((e) => e[0] === "quadraticCurveTo")).toHaveLength(
      layout === "circular" ? 96 : 97
    );
    if (layout === "straight") {
      expect(initial).toBeNull();
      expect(f.mode.getRenderBounds(f.frame)).toBeNull();
      expect(path[0]).toEqual(["moveTo", 0, f.frame.height / 2]);
      expect(path.at(-1).slice(-2)).toEqual([
        f.frame.width,
        f.frame.height / 2,
      ]);
    } else {
      f.settings.hueShift = 137;
      f.settings.glowIntensity = 2.5;
      expect(f.mode.getOverlayBounds(f.frame)).toBe(initial);
      expect(initial).toEqual(bounds);
      for (const event of path)
        for (let i = 1; i + 1 < event.length; i += 2) {
          expect(event[i]).toBeGreaterThanOrEqual(bounds.x);
          expect(event[i]).toBeLessThanOrEqual(bounds.x + bounds.width);
          expect(event[i + 1]).toBeGreaterThanOrEqual(bounds.y);
          expect(event[i + 1]).toBeLessThanOrEqual(bounds.y + bounds.height);
        }
    }
  }
);
test("circular Rainbow is seamless and glow follows its painted palette", () => {
  const f = setup("rope");
  f.setTheme("Rainbow Cycle");
  f.process();
  f.mode.update(f.frame);
  f.mode.draw(f.canvas.ctx, f.frame);
  const strokes = f.canvas.events.filter((e) => e[0] === "stroke");
  expect(strokes).toHaveLength(2);
  const paint = strokes[0][3].color;
  expect(paint.type).toBe("createConicGradient");
  expect(paint.stops[0][1]).toBe(paint.stops.at(-1)[1]);
  expect(strokes[1][3].color).toEqual(paint);
  expect(strokes[0][3].filter).toContain("blur");
});
test.each(["linear", "exponential", "logarithmic"])(
  "Rope receives the common %s finished audio profile exactly once",
  (valueHandling) => {
    for (const sensitivity of [0.3, 2.5])
      for (const bassSensitivityEnabled of [false, true]) {
        const f = setup("rope");
        Object.assign(f.settings, {
          valueHandling,
          sensitivity,
          bassSensitivityEnabled,
          bassSensitivityAmount: 0.75,
        });
        for (let i = 0; i < 4; i++) {
          f.process();
          const expected = f.pipeline.forMode("prism");
          expect([...f.frame.signals.bands]).toEqual([...expected.bands]);
          expect(f.frame.signals.bassMultiplier).toBe(expected.bassMultiplier);
        }
      }
  }
);
test("Rope metadata and settings extend old preferences without changing earlier IDs or disabled selections", () => {
  const old = Registry.ids.slice(0, -1);
  expect(Registry.ids.at(-1)).toBe("rope");
  expect(Registry.indexOf("rope")).toBe(11);
  const saved = ModeList.normalize(Registry.ids, [...old].reverse(), [
    "waveform",
    "prism",
  ]);
  expect(saved.modeOrder).toEqual([...old].reverse().concat("rope"));
  expect(saved.disabledModes).toEqual(["waveform", "prism"]);
  expect(ModeList.enabled(saved.modeOrder, saved.disabledModes)).toContain(
    "rope"
  );
  expect(Registry.get("rope").audio).toEqual(Registry.get("prism").audio);
  expect(Registry.mediaDefaults().rope).toBe("bottom-left");
  for (const ropeLayout of ["circular", "straight"]) {
    expect(
      AudioMath.mergeSettings(
        { ropeLayout: "circular" },
        { ropeLayout },
        12,
        14
      ).ropeLayout
    ).toBe(ropeLayout);
    expect(
      Protocol.validCommand(
        { type: "set", key: "ropeLayout", value: ropeLayout },
        AudioMath,
        Registry,
        []
      )
    ).toBe(true);
  }
  for (const value of ["circle", false, 1, null]) {
    expect(
      AudioMath.mergeSettings(
        { ropeLayout: "circular" },
        { ropeLayout: value },
        12,
        14
      ).ropeLayout
    ).toBe("circular");
    expect(
      Protocol.validCommand(
        { type: "set", key: "ropeLayout", value },
        AudioMath,
        Registry,
        []
      )
    ).toBe(false);
  }
});
