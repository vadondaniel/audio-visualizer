// ---------- audio-math imports ----------
// bandAverage/normalizeEnergy/smoothTowards/computeHue/detectBeat/
// mergeSettings live in audio-math.js (loaded before this file in
// index.html) so they can be unit tested outside the app — see that file
// for what each one does.
const {
  bandAverage,
  normalizeEnergy,
  smoothTowards,
  computeHue,
  detectBeat,
  mergeSettings,
} = AudioMath;

// ---------- visual modes & themes ----------
const THEMES = [
  { name: "Neon", hues: [320, 200] }, // pink -> cyan
  { name: "Fire", hues: [15, 45] }, // red -> orange
  { name: "Matrix", hues: [130, 160] }, // green
  { name: "Color Cycle", colorCycle: true, spread: 50 }, // rotates over time, with a hue gradient across each visual so it isn't flat
  { name: "Rainbow", rainbow: true }, // fixed full spectrum across each visual
  { name: "Rainbow Cycle", rainbow: true, cycle: true }, // spectrum rotates
  { name: "Ice", hues: [190, 260] }, // blue -> purple
];

const MODES = [
  "bars",
  "radial",
  "waveform",
  "particles",
  "kaleidoscope",
  "tunnel",
  "waves",
  "aurora",
];

// ---------- visual tuning ----------
// Per-mode constants that shape how each visual responds to audio.
// Grouped here so tweaking a feel doesn't require hunting through draw code.
const VISUAL_TUNING = {
  bars: {
    baseYFrac: 0.75,
    heightScale: 0.6,
    releasePerSec: 6.3,
  },
  radial: {
    baseRFrac: 0.16,
    lengthScale: 0.32,
    releasePerSec: 9.75,
  },
  kaleidoscope: {
    maxRFrac: 0.46,
    coreRFrac: 0.035,
    releasePerSec: 14.9,
    spinPerSec: 0.072,
    spinTreblePerSec: 0.18,
    spinBeatPerSec: 0.36,
    flashDecayPerSec: 7.2,
  },
  tunnel: {
    ringCount: 26,
    speed: 1.2,
    twistPerSec: 0.35,
    releasePerSec: 8.5,
  },
  waves: {
    releasePerSec: 6.5,
  },
  aurora: {
    releasePerSec: 6.5,
  },
  particles: {
    cap: 1400,
  },
  hueCycle: {
    baseDegPerSec: 18,
    midDegPerSecPerUnit: 0.6,
  },
  trail: {
    fadePerSec: 42.8,
  },
};

// ---------- audio tuning ----------
const AUDIO_TUNING = {
  beatRatio: 1.25,
  beatFloor: 42,
  beatCooldownMs: 133,
  pulseDecayPerSec: 6.0,
  particleFloor: 26,
  particleRange: 210,
  sustainedFloor: 150,
  sustainedIntervalMs: 333,
};

// ---------- particle system constants ----------
// Three frequency bands, each spawning particles with different
// characteristics so bass, mids, and treble all have a distinct visual feel.
const PARTICLE_BANDS = [
  { hueT: 0.05, sizeMul: 1.7, speedMul: 0.55, decayMul: 0.55 },
  { hueT: 0.5, sizeMul: 1.0, speedMul: 1.0, decayMul: 1.0 },
  { hueT: 0.95, sizeMul: 0.5, speedMul: 2.0, decayMul: 2.0 },
];

// ---------- kaleidoscope constants ----------
const KALEIDO_BARS = 28;

// Logarithmically-spaced frequency band edges so bass bands are wider
// (more FFT bins) and treble bands are narrower, matching human pitch
// perception.
const KALEIDO_BAND_EDGES = (() => {
  const edges = [];
  const minFrac = 0.006;
  const maxFrac = 0.5;
  for (let i = 0; i <= KALEIDO_BARS; i++) {
    const t = i / KALEIDO_BARS;
    edges.push(minFrac * Math.pow(maxFrac / minFrac, t));
  }
  return edges;
})();

// ---------- misc timing constants ----------
const BASS_HISTORY_MS = 1000;
const ENERGY_HISTORY_MS = 3000;
const FRAME_MS = 1000 / 60;
const TRAIL_TIMEOUT_MS = 15000;
