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
  audio: {
    frequencyBytes: null,
    timeBytes: null,
    sampleRate: 48000,
    readFloatSpectrum: visualSpectrumReader.read,
  },
  levels: { rawBass: 0, bass: 0, mid: 0, treble: 0 },
  beat: { pulse: 0, justHit: false },
};
const visualModeController = ModeRuntime.createController(VisualModes, {
  math: AudioMath,
  constants: {
    VISUAL_TUNING,
    THEMES,
    PARTICLE_BANDS,
    KALEIDO_BARS,
    KALEIDO_BAND_EDGES,
    FRAME_MS,
    ENERGY_HISTORY_MS,
  },
  palette: { currentHue, themeCssColor },
  modulate: applyBassModulation,
  createRandom: () =>
    ModeRuntime.createRandom(Math.floor(Math.random() * 4294967296)),
  restore: ModeRuntime.restore,
  loadImage(src) {
    const image = new Image();
    image.src = src;
    return image;
  },
  consumeBeat() {
    beatJustHit = false;
  },
});

function prepareVisualFrame(
  timestampMs,
  elapsedMs,
  rawBass,
  bass,
  mid,
  treble
) {
  visualFrame.width = canvas.width;
  visualFrame.height = canvas.height;
  visualFrame.timestampMs = timestampMs;
  visualFrame.elapsedMs = elapsedMs;
  visualFrame.dtSec = elapsedMs / 1000;
  visualFrame.audioClockMs = audioClockMs;
  visualFrame.audio.frequencyBytes = freqData;
  visualFrame.audio.timeBytes = timeData;
  visualFrame.audio.sampleRate = audioCtx?.sampleRate || 48000;
  visualSpectrumReader.beginFrame(analyser, freqData);
  visualFrame.levels.rawBass = rawBass;
  visualFrame.levels.bass = bass;
  visualFrame.levels.mid = mid;
  visualFrame.levels.treble = treble;
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
  visualFrame.audio.frequencyBytes = null;
  visualFrame.audio.timeBytes = null;
  visualFrame.mediaArt = null;
}
