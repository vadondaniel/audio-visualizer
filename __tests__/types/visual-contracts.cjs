// Compiled by check:types, never executed. Expected errors make regressions in
// the exported types fail even if permissive JavaScript inference creeps in.
const Pipeline = require("../../src/audio-pipeline");
const Registry = require("../../src/mode-registry");
const Runtime = require("../../src/mode-runtime");
const Bars = require("../../src/visuals/bars");

/** @param {import('../../src/visual-contracts').Frame} frame
 * @param {import('../../src/visual-contracts').Services} services
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../../src/visual-contracts').PipelineInput} input
 * @param {Readonly<import('../../src/visual-contracts').AudioSettings>} settings */
function checkContracts(frame, services, ctx, input, settings) {
  /** @type {import('../../src/visual-contracts').ModeFactory} */
  const factory = Bars.createMode;
  const mode = factory(services);
  mode.update(frame);
  mode.draw(ctx, frame);
  mode.reset();
  /** @type {import('../../src/visual-contracts').Mode} */
  const bounded = {
    ...mode,
    getOverlayBounds: () => ({
      x: 0,
      y: 0,
      width: frame.width,
      height: frame.height,
    }),
    getRenderBounds: () => ({
      x: 0,
      y: 0,
      width: frame.width,
      height: frame.height,
    }),
  };
  const bounds = bounded.getRenderBounds?.(frame);
  if (bounds) {
    // @ts-expect-error Bounds records are borrowed and read only to consumers.
    bounds.x = 4;
  }
  /** @type {import('../../src/visual-contracts').Mode} */
  const invalidBounds = {
    ...mode,
    // @ts-expect-error Bounds must be a rectangle or null, not a scalar.
    getRenderBounds: () => 1,
    // @ts-expect-error Overlay bounds must also be a rectangle or null.
    getOverlayBounds: () => "full",
  };

  const pipeline = Pipeline.create();
  /** @type {import('../../src/visual-contracts').AudioProfile} */
  const resolved = Registry.resolveAudioProfile("waveform", settings);
  // @ts-expect-error Resolved registry profiles are immutable.
  resolved.count = 12;
  // @ts-expect-error Variant selectors use the declared audio-setting contract.
  Registry.resolveAudioProfile("waveform", { waveformStyle: "unknown" });
  pipeline.update(input, settings, frame);
  /** @type {import('../../src/visual-contracts').Signals} */
  const signals = pipeline.forMode("bars");
  const nextFrame = { ...frame, signals };
  mode.update(nextFrame);
  Registry.registerFactory("bars", factory);
  const registered = Registry.getFactories().bars(services);
  registered.draw(ctx, nextFrame);
  Runtime.createController(Registry.getFactories(), {
    ...services,
    consumeBeat() {},
  }).render("bars", ctx, nextFrame);

  // @ts-expect-error Misspelled finished output.
  signals.levels.bsa;
  // @ts-expect-error Actual pipeline outputs have immutable nested records.
  signals.motion.bass = 1;
  // @ts-expect-error Borrowed samples have no mutating methods.
  signals.bands.fill(0);
  // @ts-expect-error Borrowed samples cannot be written by index.
  signals.waveform[0] = 1;
  // @ts-expect-error Frame and its nested inputs are read-only.
  frame.width = 1;
  // @ts-expect-error Settings belong to the host.
  frame.settings.glowIntensity = 0;
  // @ts-expect-error Shared beat consumption belongs to the host.
  frame.beat.justHit = false;
  // @ts-expect-error No raw-audio route in a mode's frame.
  frame.audio.frequencyBytes;
  // @ts-expect-error No analyser in finished signals.
  frame.signals.readFloatSpectrum();
  // @ts-expect-error Modes cannot reapply the pipeline's sensitivity control.
  frame.settings.sensitivity;
  // @ts-expect-error Media art availability must be narrowed before use.
  frame.mediaArt.naturalWidth;
  // @ts-expect-error No legacy capture globals in this checked environment.
  analyser.getByteFrequencyData(freqData);
  // @ts-expect-error No beat-consumption service is exposed to modes.
  services.consumeBeat();
  // @ts-expect-error Global response functions are not injected into modes.
  services.math.applyValueHandling(0.5, "linear");
  const { applyGlow, ...incomplete } = services;
  // @ts-expect-error Real exported factories require every service.
  Bars.createMode(incomplete);
  // @ts-expect-error Invalid lifecycle registration.
  Registry.registerFactory("bars", () => ({ update() {}, reset() {} }));
  // @ts-expect-error Registered instances preserve the lifecycle contract.
  registered.draw(frame, ctx);
  // @ts-expect-error Raw input must provide acquisition buffers.
  pipeline.update({ sampleRate: 48000 }, settings, frame);
  // @ts-expect-error Misspelled fields are rejected on the actual API's return.
  pipeline.forMode("bars").level;
  // @ts-expect-error Actual factory return retains the frame contract.
  Bars.createMode(services).update({ width: 100 });
  /** @type {import('../../src/visual-contracts').FrameStorage} */
  const storage = {
    ...frame,
    signals: null,
    beat: { pulse: 0, justHit: false },
  };
  // @ts-expect-error Initialization/reset storage cannot reach a mode before signals exist.
  mode.update(storage);
  storage.signals = signals;
  mode.update({ ...storage, signals });
  const image = services.loadImage("cover.png");
  mode.draw(ctx, { ...nextFrame, mediaArt: image });
  Runtime.applyGlow(ctx, "red", 12, 0.5);
  const random = services.createRandom();
  random.setState(random.getState());
  services.restore(new Float64Array(4), new Float64Array(4));
  // @ts-expect-error Restoration preserves storage shape.
  services.restore(new Float64Array(4), "invalid");
}
module.exports = { checkContracts };
