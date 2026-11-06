// Application adapter: owns the frame and resolves globals before calling modes.
const visualSpectrumReader = ModeRuntime.createFloatSpectrumReader();
const overlayDrawSchedule = OverlayDisplay.createDrawSchedule();
function effectiveVisualMode() {
  return OverlayDisplay.effectiveMode(
    state,
    typeof miniOverlayActive !== "undefined" && miniOverlayActive,
    MODES
  );
}
/** @type {import('./visual-contracts').FrameStorage} */
const visualFrame = {
  width: 0,
  height: 0,
  timestampMs: 0,
  elapsedMs: 0,
  dtSec: 0,
  audioClockMs: 0,
  settings: state,
  mediaArt: null,
  signals: null,
  beat: { pulse: 0, justHit: false },
};
const visualModeController = ModeRuntime.createController(
  ModeRegistry.getFactories(),
  /** @satisfies {import('./visual-contracts').HostServices} */ ({
    constants: {
      VISUAL_TUNING,
      THEMES,
      PARTICLE_BANDS,
      KALEIDO_BARS,
      FRAME_MS,
      ENERGY_HISTORY_MS,
    },
    palette: { currentHue, themeCssColor },
    createRandom: () =>
      ModeRuntime.createRandom(Math.floor(Math.random() * 4294967296)),
    restore: ModeRuntime.restore,
    applyGlow: ModeRuntime.applyGlow,
    loadImage(src) {
      const image = new Image();
      image.src = src;
      return image;
    },
    consumeBeat() {
      beatJustHit = false;
    },
  })
);

const audioPipeline = AudioPipeline.create();
/** @type {Omit<import('./visual-contracts').PipelineInput,'frequencyBytes'|'timeBytes'> & {frequencyBytes:Uint8Array|null,timeBytes:Uint8Array|null}} */
const visualAudioInput = {
  frequencyBytes: null,
  timeBytes: null,
  sampleRate: 48000,
  readFloatSpectrum: visualSpectrumReader.read,
  beatPulse: 0,
};
/** @param {number} timestampMs
 * @param {number} elapsedMs
 * @param {string} [modeId]
 * @returns {import('./visual-contracts').Frame} */
function prepareVisualFrame(
  timestampMs,
  elapsedMs,
  modeId = effectiveVisualMode()
) {
  visualFrame.width = canvas.width;
  visualFrame.height = canvas.height;
  visualFrame.timestampMs = timestampMs;
  visualFrame.elapsedMs = elapsedMs;
  visualFrame.dtSec = elapsedMs / 1000;
  visualFrame.audioClockMs = audioClockMs;
  visualSpectrumReader.beginFrame(bassAnalyser || analyser, freqData);
  visualAudioInput.frequencyBytes = freqData;
  visualAudioInput.timeBytes = timeData;
  visualAudioInput.sampleRate = audioCtx?.sampleRate || 48000;
  visualAudioInput.beatPulse = beatPulse;
  // Acquisition buffers have been installed by the active capture before rendering.
  audioPipeline.update(
    /** @type {import('./visual-contracts').PipelineInput} */ (
      visualAudioInput
    ),
    state,
    visualFrame
  );
  visualFrame.signals = audioPipeline.forMode(modeId);
  visualFrame.beat.pulse = beatPulse;
  visualFrame.beat.justHit = beatJustHit;
  const display =
    MEDIA_DISPLAYS[state.mediaDisplay] || MEDIA_DISPLAYS["cover-title-artist"];
  const image = mediaState.thumbnailImage;
  visualFrame.mediaArt =
    state.mediaMetadataEnabled &&
    display?.cover &&
    mediaState.metadata?.thumbnailDataUrl &&
    image?.complete &&
    image.naturalWidth > 0 &&
    image.naturalHeight > 0
      ? image
      : null;
  // Signals and media availability have now been resolved for this frame.
  return /** @type {import('./visual-contracts').Frame} */ (visualFrame);
}

function resetVisualModes() {
  overlayDrawSchedule.reset();
  visualModeController.reset();
  visualSpectrumReader.reset();
  audioPipeline.reset();
  visualAudioInput.frequencyBytes = null;
  visualAudioInput.timeBytes = null;
  visualFrame.signals = null;
  visualFrame.mediaArt = null;
}
