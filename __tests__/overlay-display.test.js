const { createDrawSchedule, effectiveMode } = require("../src/overlay-display");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const Pipeline = require("../src/audio-pipeline");
const Registry = require("../src/mode-registry");
const { makeCanvas, setup } = require("./helpers/mode-fixture.cjs");
const timingCases = [60, 120, 144, 165, 240].flatMap((hz) =>
  [0, 15, 30, 60, 120].map((cap) => [hz, cap])
);
test.each(timingCases)(
  "ten-second drawing totals at %s Hz and cap %s",
  (hz, cap) => {
    const schedule = createDrawSchedule();
    let draws = 0;
    for (let i = 0; i < hz * 10; i++)
      if (schedule.step((i * 1000) / hz, true, cap).draw) draws++;
    expect(Math.abs(draws - 10 * Math.min(hz, cap || hz))).toBeLessThanOrEqual(
      1
    );
  }
);
test("fractional boundaries, pauses, setting edits, normal presentation and reusable results", () => {
  const s = createDrawSchedule();
  const result = s.step(0, true, 60);
  expect(result.draw).toBe(true);
  expect(s.step(1000 / 60 - 0.02, true, 60).draw).toBe(false);
  expect(s.step(1000 / 60 - 0.005, true, 60).draw).toBe(true);
  expect(s.step(50000, true, 60)).toBe(result);
  expect(result.draw).toBe(true);
  expect(s.step(50000.1, true, 60).draw).toBe(false);
  expect(s.step(50001, true, 30).draw).toBe(true);
  expect(s.step(50002, false, 30).draw).toBe(true);
  expect(s.step(50003, false, 30).draw).toBe(true);
  expect(s.step(50004, true, 30).draw).toBe(true);
  s.resetDeadline();
  expect(s.step(50005, true, 30)).toMatchObject({ draw: true, elapsedMs: 1 });
  s.reset();
  expect(s.step(50006, true, 30)).toMatchObject({ draw: true, elapsedMs: 0 });
});
test("effective mode resolves one profile without changing normal numeric selection", () => {
  const state = { mode: 0, miniOverlayMode: "orbit" };
  expect(effectiveMode(state, true, Registry.ids)).toBe("orbit");
  expect(effectiveMode(state, false, Registry.ids)).toBe("bars");
  expect(
    effectiveMode({ ...state, miniOverlayMode: "follow" }, true, Registry.ids)
  ).toBe("bars");
  expect(
    effectiveMode({ ...state, miniOverlayMode: "missing" }, true, Registry.ids)
  ).toBe("bars");
  expect(state.mode).toBe(0);
});

function loopFixture({
  hz = 144,
  cap = 30,
  active = true,
  trails = false,
} = {}) {
  const fixture = setup("bars");
  const settings = fixture.settings;
  Object.assign(settings, {
    miniOverlayMaxFps: cap,
    miniOverlayMode: "orbit",
    trailsEnabled: trails,
    trailDuration: 220,
    trailMaxFps: 60,
  });
  const canvas = makeCanvas(),
    render = makeCanvas();
  let allocations = 0,
    captures = 0,
    frame;
  const pipeline = Pipeline.create();
  const freq = new Uint8Array(1024),
    time = new Uint8Array(2048);
  const analyser = {
    getByteFrequencyData: jest.fn((data) => data.fill(140)),
    getByteTimeDomainData: jest.fn((data) => data.fill(128)),
  };
  const ctx = {
    state: settings,
    MODES: Registry.ids,
    THEMES: fixture.constants.THEMES,
    VISUAL_TUNING: fixture.constants.VISUAL_TUNING,
    overlayActive: active,
    isMiniOverlayActive: () => ctx.overlayActive,
    analyser,
    audioCtx: { state: "running" },
    freqData: freq,
    timeData: time,
    beatPulse: 0,
    AudioPipeline: Pipeline,
    TrailMath: require("../src/trail-math"),
    overlayDrawSchedule: createDrawSchedule(),
    canvas: { width: 16, height: 16 },
    renderCanvas: { width: 16, height: 16 },
    ctx: render.ctx,
    displayCtx: canvas.ctx,
    document: {
      createElement() {
        allocations++;
        const c = makeCanvas();
        return {
          width: 16,
          height: 16,
          getContext: () =>
            new Proxy(c.ctx, {
              get(target, key) {
                return key === "drawImage"
                  ? () => {
                      captures++;
                    }
                  : target[key];
              },
            }),
        };
      },
    },
    requestAnimationFrame: jest.fn(),
    checkSilence: jest.fn(),
    updateBeat: jest.fn(),
    updateProceduralBackground: jest.fn(),
    drawProceduralBackground: jest.fn(),
    updateFxLive: jest.fn(),
    recoverAudioCapture: jest.fn(),
    visualModeController: {
      getRenderBounds: () => null,
      update: jest.fn(),
      draw: jest.fn(),
    },
    effectiveVisualMode: () =>
      effectiveMode(settings, ctx.overlayActive, Registry.ids),
    prepareVisualFrame: (timestampMs, elapsedMs, id) => {
      pipeline.update(
        {
          frequencyBytes: freq,
          timeBytes: time,
          spectrumDb: fixture.spectrum,
          sampleRate: 48000,
        },
        settings,
        { dtSec: elapsedMs / 1000 }
      );
      frame = {
        timestampMs,
        elapsedMs,
        dtSec: elapsedMs / 1000,
        signals: pipeline.forMode(id),
      };
      return frame;
    },
  };
  vm.createContext(ctx);
  for (const file of ["visuals.js", "visuals/loop.js"])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
      ctx
    );
  const tick = (timestamp) => vm.runInContext(`loop(${timestamp})`, ctx);
  return {
    ctx,
    settings,
    tick,
    hz,
    frame: () => frame,
    captures: () => captures,
    allocations: () => allocations,
    history: () => vm.runInContext("trailFrames", ctx),
  };
}
test("actual loop keeps acquisition, beat/silence checks, and simulation running between drawn frames", () => {
  const f = loopFixture();
  for (let i = 0; i < 288; i++) f.tick((i * 1000) / 144);
  for (const action of [
    f.ctx.analyser.getByteFrequencyData,
    f.ctx.analyser.getByteTimeDomainData,
    f.ctx.updateBeat,
    f.ctx.checkSilence,
    f.ctx.visualModeController.update,
  ])
    expect(action).toHaveBeenCalledTimes(288);
  expect(f.ctx.visualModeController.draw).toHaveBeenCalledTimes(60);
  expect(f.ctx.updateProceduralBackground).toHaveBeenCalledTimes(60);
  expect(f.ctx.drawProceduralBackground).not.toHaveBeenCalled();
  expect(f.ctx.updateFxLive).not.toHaveBeenCalled();
  expect(
    f.ctx.visualModeController.update.mock.calls.every(([id]) => id === "orbit")
  ).toBe(true);
  expect(f.frame().signals.bands.length).toBe(
    Registry.get("orbit").audio.count
  );
  expect(f.ctx.updateProceduralBackground.mock.calls[1][0]).toBeCloseTo(
    5 / 144
  );
  f.ctx.overlayActive = false;
  f.tick(2000);
  f.tick(2001);
  expect(f.ctx.visualModeController.draw.mock.calls.at(-1)[0]).toBe("bars");
  expect(f.ctx.visualModeController.draw).toHaveBeenCalledTimes(62);
  expect(f.ctx.drawProceduralBackground).toHaveBeenCalledTimes(2);
  expect(f.ctx.updateFxLive).toHaveBeenCalledTimes(2);
});
test("overlay background visibility changes drawing only, at the existing capped cadence", () => {
  const f = loopFixture();
  for (let i = 0; i < 144; i++) f.tick((i * 1000) / 144);
  expect(f.ctx.updateProceduralBackground).toHaveBeenCalledTimes(30);
  expect(f.ctx.drawProceduralBackground).not.toHaveBeenCalled();
  f.settings.miniOverlayShowBackground = true;
  for (let i = 144; i < 288; i++) f.tick((i * 1000) / 144);
  expect(f.ctx.updateProceduralBackground).toHaveBeenCalledTimes(60);
  expect(f.ctx.drawProceduralBackground).toHaveBeenCalledTimes(30);
  expect(f.ctx.updateFxLive).not.toHaveBeenCalled();
  f.settings.miniOverlayShowBackground = false;
  f.tick(50000);
  expect(f.ctx.updateProceduralBackground.mock.calls.at(-1)[0]).toBe(0.1);
  expect(f.ctx.drawProceduralBackground).toHaveBeenCalledTimes(30);
});
test("capped actual loop expires trails by real timestamps with bounded canvas retention and no pause burst", () => {
  const f = loopFixture({ trails: true });
  for (let i = 0; i < 288; i++) f.tick((i * 1000) / 144);
  expect(f.captures()).toBe(60);
  expect(f.history().length).toBeLessThanOrEqual(7);
  expect(f.allocations()).toBeLessThanOrEqual(8);
  f.tick(50000);
  expect(f.history().length).toBe(1);
  f.tick(50000.1);
  expect(f.captures()).toBe(61);
});
test("draw limiting leaves finished audio signals identical to unlimited rendering", () => {
  const limited = loopFixture({ cap: 15 }),
    unlimited = loopFixture({ cap: 0 });
  for (let i = 0; i < 144; i++) {
    limited.tick((i * 1000) / 144);
    unlimited.tick((i * 1000) / 144);
  }
  expect(Array.from(limited.frame().signals.bands)).toEqual(
    Array.from(unlimited.frame().signals.bands)
  );
  expect(limited.frame().signals.levels).toEqual(
    unlimited.frame().signals.levels
  );
  expect(limited.ctx.visualModeController.update).toHaveBeenCalledTimes(144);
  expect(limited.ctx.visualModeController.draw).toHaveBeenCalledTimes(15);
  expect(unlimited.ctx.visualModeController.draw).toHaveBeenCalledTimes(144);
});
