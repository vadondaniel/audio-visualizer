// Application adapter: owns the frame and resolves globals before calling modes.
const visualSpectrumReader = ModeRuntime.createFloatSpectrumReader();
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
  {
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
  }
);

const audioPipeline = AudioPipeline.create();
const visualAudioInput = {
  frequencyBytes: null,
  timeBytes: null,
  sampleRate: 48000,
  readFloatSpectrum: visualSpectrumReader.read,
  beatPulse: 0,
};
function prepareVisualFrame(timestampMs, elapsedMs) {
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
  audioPipeline.update(visualAudioInput, state, visualFrame);
  visualFrame.signals = audioPipeline.forMode(MODES[state.mode]);
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
  return visualFrame;
}

function resetVisualModes() {
  visualModeController.reset();
  visualSpectrumReader.reset();
  audioPipeline.reset();
  visualAudioInput.frequencyBytes = null;
  visualAudioInput.timeBytes = null;
  visualFrame.signals = null;
  visualFrame.mediaArt = null;
}
