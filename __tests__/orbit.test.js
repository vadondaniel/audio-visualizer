const { setup: makeFixture, spyCanvas } = require("./helpers/mode-fixture.cjs");
const {
  orbitMirrorPosition,
  orbitInnerRadius,
  orbitOuterLength,
  advanceOrbitRope,
} = require("../src/visuals/orbit");
const AudioMath = require("../src/audio-math");

function setup(energy = 0) {
  const fixture = makeFixture("orbit");
  Object.assign(fixture.settings, {
    smoothingEnabled: false,
    sensitivity: 1,
    valueHandling: "linear",
  });
  fixture.frame.audio.frequencyBytes.fill(energy);
  fixture.frame.beat.pulse = 0;
  fixture.frame.audio.readFloatSpectrum = () =>
    Float32Array.from(
      fixture.frame.audio.frequencyBytes,
      (v) => -100 + (v * 70) / 255
    );
  const ctx = spyCanvas(fixture, jest.fn);
  const points = () => {
    const curves = ctx.bezierCurveTo.mock.calls.slice(-192);
    return [
      curves.at(-1).slice(-2),
      ...curves.slice(0, -1).map((c) => c.slice(-2)),
    ].flat();
  };
  const values = () =>
    fixture.canvas.events
      .slice(0, 128)
      .map(
        (e) =>
          (Math.hypot(...e[2][1].slice(1)) - Math.hypot(...e[2][0].slice(1))) /
            184 /
            0.7 -
          0.025 / 0.7
      );
  const displacements = () => {
    const p = points();
    return Array.from(
      { length: 192 },
      (_, i) => (0.92 - Math.hypot(p[i * 2], p[i * 2 + 1]) / 184) / 0.5
    );
  };
  return {
    ...fixture,
    ctx,
    points,
    values,
    displacements,
    draw(bass, mid, treble, dt) {
      Object.assign(fixture.frame.levels, { bass, mid, treble });
      fixture.frame.dtSec = dt;
      fixture.frame.elapsedMs = dt * 1000;
      fixture.canvas.clear();
      fixture.mode.update(fixture.frame);
      fixture.mode.draw(ctx, fixture.frame);
    },
  };
}

test("spectrum position is reflected across both axes", () => {
  for (let i = 0; i < 100; i++) {
    const angle = (i * Math.PI) / 200;
    expect(orbitMirrorPosition(angle)).toBeCloseTo(orbitMirrorPosition(-angle));
    expect(orbitMirrorPosition(angle)).toBeCloseTo(
      orbitMirrorPosition(Math.PI - angle)
    );
    expect(orbitMirrorPosition(angle)).toBeCloseTo(
      orbitMirrorPosition(Math.PI + angle)
    );
  }
});

test("audio pulls the rope inward while extending bars outward", () => {
  expect(orbitInnerRadius(100, 1)).toBeLessThan(orbitInnerRadius(100, 0));
  expect(orbitOuterLength(100, 1)).toBeGreaterThan(orbitOuterLength(100, 0));
  const quiet = setup(0),
    loud = setup(255);
  quiet.draw(0, 0, 0, 1 / 60);
  loud.draw(0, 0, 0, 1 / 60);
  expect(Math.hypot(...loud.points().slice(0, 2))).toBeLessThan(
    Math.hypot(...quiet.points().slice(0, 2))
  );
  const length = (app) =>
    Math.hypot(...app.ctx.lineTo.mock.calls[0]) -
    Math.hypot(...app.ctx.moveTo.mock.calls[0]);
  expect(length(loud)).toBeGreaterThan(length(quiet));
});

test("rope is one closed smooth path with exact four-way symmetry", () => {
  const app = setup();
  for (let i = 0; i < app.frame.audio.frequencyBytes.length; i++)
    app.frame.audio.frequencyBytes[i] = Math.round(127 + 120 * Math.sin(i / 9));
  app.draw(0.5, 0.5, 0.5, 1 / 60);
  const points = app.points();
  const count = points.length / 2;
  for (let i = 0; i < count; i++) {
    const oppositeX = (count / 2 - i + count) % count;
    const oppositeY = (count - i) % count;
    expect(points[i * 2]).toBeCloseTo(-points[oppositeX * 2]);
    expect(points[i * 2 + 1]).toBeCloseTo(points[oppositeX * 2 + 1]);
    expect(points[i * 2]).toBeCloseTo(points[oppositeY * 2]);
    expect(points[i * 2 + 1]).toBeCloseTo(-points[oppositeY * 2 + 1]);
  }
  expect(app.ctx.bezierCurveTo).toHaveBeenCalledTimes(count);
  expect(app.ctx.bezierCurveTo.mock.calls.at(-1).slice(-2)).toEqual(
    points.slice(0, 2)
  );
  expect(app.ctx.closePath).toHaveBeenCalledTimes(1);
  expect(app.ctx.arc).toHaveBeenCalledTimes(1);
  expect(points.every(Number.isFinite)).toBe(true);
});

function rope() {
  const displacement = new Float64Array(41),
    velocity = new Float64Array(41);
  const target = new Float64Array(41),
    acceleration = new Float64Array(41);
  return {
    displacement,
    velocity,
    target,
    step: (dt) =>
      advanceOrbitRope(displacement, velocity, target, acceleration, dt),
  };
}

test("a local pull propagates to neighboring parts without audio forces on those parts", () => {
  const line = rope();
  line.target[20] = 1;
  line.step(1 / 240);
  expect(line.displacement[20]).toBeGreaterThan(0);
  expect(line.displacement[19]).toBe(0);
  line.step(1 / 240);
  expect(line.displacement[19]).toBeGreaterThan(0);
  expect(line.displacement[21]).toBeCloseTo(line.displacement[19], 12);
  expect(line.displacement[18]).toBe(0);
  line.step(1 / 240);
  expect(line.displacement[18]).toBeGreaterThan(0);
  expect(line.target[18]).toBe(0);
});

test("rope retains momentum after a tug, then damping returns it to rest", () => {
  const line = rope();
  line.target[20] = 1;
  line.step(1 / 60);
  const pulled = line.displacement[20];
  line.target.fill(0);
  line.step(1 / 240);
  expect(line.displacement[20]).toBeGreaterThan(pulled);
  for (let i = 0; i < 120; i++) line.step(1 / 60);
  expect(Math.max(...line.displacement)).toBeLessThan(0.0001);
  expect(Math.max(...line.velocity.map(Math.abs))).toBeLessThan(0.0001);
});

test("rope tension produces consistent motion across frame rates", () => {
  const results = [60, 144, 240].map((hz) => {
    const line = rope();
    line.target[20] = 1;
    for (let frame = 0; frame < hz / 2; frame++) line.step(1 / hz);
    return line.displacement;
  });
  for (const values of results.slice(1))
    expect(
      Math.max(
        ...values.map((value, index) => Math.abs(value - results[0][index]))
      )
    ).toBeLessThan(0.003);
});

test("mirrored boundaries move, and long/invalid frames cannot destabilize the rope", () => {
  const line = rope();
  line.target[0] = 1;
  line.target[40] = 1;
  line.step(0.1);
  expect(line.displacement[0]).toBeGreaterThan(0);
  expect(line.displacement[1]).toBeGreaterThan(0);
  expect(line.displacement[40]).toBeCloseTo(line.displacement[0]);
  for (const dt of [0, -1, NaN, Infinity, 10, 1 / 15, 1 / 240]) line.step(dt);
  expect([...line.displacement, ...line.velocity].every(Number.isFinite)).toBe(
    true
  );
  expect(line.displacement.every((value) => value >= 0 && value <= 1)).toBe(
    true
  );
});

test("all layers use one rotation and its speed is independent of frame rate", () => {
  const angles = [60, 144].map((hz) => {
    const app = setup(128);
    for (let i = 0; i < hz; i++) app.draw(0, 0, 0, 1 / hz);
    expect(app.ctx.rotate).toHaveBeenCalledTimes(hz);
    expect(app.ctx.save).toHaveBeenCalledTimes(hz);
    expect(app.ctx.restore).toHaveBeenCalledTimes(hz);
    return app.ctx.rotate.mock.calls.at(-1)[0];
  });
  expect(angles[0]).toBeCloseTo(0.065);
  expect(angles[1]).toBeCloseTo(angles[0]);
});

test("loud audio retains band detail at logarithmic handling and maximum sensitivity", () => {
  const app = setup(255); // Byte FFT is completely clipped in this regression.
  const profile = Float32Array.from({ length: 1024 }, (_, i) => {
    const x = Math.log2(i + 1);
    return (
      -65 +
      45 * Math.exp(-Math.pow((x - 4) / 0.8, 2)) +
      28 * Math.exp(-Math.pow((x - 7) / 0.5, 2))
    );
  });
  app.settings.valueHandling = "logarithmic";
  app.settings.sensitivity = 2.5;
  const readSpectrum = jest.fn(() => profile);
  app.frame.audio.readFloatSpectrum = readSpectrum;
  for (let i = 0; i < 60; i++) app.draw(0, 0, 0, 1 / 60);
  expect(readSpectrum).toHaveBeenCalledTimes(60);
  expect(app.values().filter((value) => value >= 0.999).length).toBeLessThan(4);
  expect(Math.max(...app.values()) - Math.min(...app.values())).toBeGreaterThan(
    0.3
  );
  expect(
    Math.max(...app.displacements()) - Math.min(...app.displacements())
  ).toBeGreaterThan(0.1);
});

test("input headroom preserves gain control without amplifying silence or quiet noise", () => {
  const app = setup();
  const low = AudioMath.spectrumResponseLevel(-50, -35, "logarithmic", 1);
  const high = AudioMath.spectrumResponseLevel(-50, -35, "logarithmic", 2.5);
  expect(high).toBeGreaterThan(low);
  expect(high).toBeLessThan(1);
  app.settings.sensitivity = 2.5;
  app.frame.audio.readFloatSpectrum = () => new Float32Array(1024).fill(-110);
  for (let i = 0; i < 60; i++) app.draw(0, 0, 0, 1 / 60);
  expect(Math.max(...app.values())).toBeCloseTo(0);
  expect(Math.max(...app.displacements())).toBeCloseTo(0);
});
