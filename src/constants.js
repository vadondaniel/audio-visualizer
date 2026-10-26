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
  applyValueHandling,
} = AudioMath;

// `colorStops` are ordered spatial stops around the visual. They are
// intentionally directional: each stop is a point on the HSL hue wheel,
// and interpolation proceeds from first -> last. This lets palettes such
// as Sunset/Aurora use a deliberate multi-stage color journey instead of
// forcing everything through one two-point hue range.
const THEMES = [
  {
    name: "Neon",
    colorStops: [
      { position: 0, hue: 320 },
      { position: 0.5, hue: 270 },
      { position: 1, hue: 190 },
    ],
    alwaysGradient: true,
  },
  {
    name: "Fire",
    colorStops: [
      { position: 0, hue: 0 },
      { position: 0.5, hue: 18 },
      { position: 1, hue: 48 },
    ],
  },
  {
    name: "Matrix",
    colorStops: [
      { position: 0, hue: 125 },
      { position: 0.5, hue: 142 },
      { position: 1, hue: 95 },
    ],
  },
  {
    name: "Ice",
    colorStops: [
      { position: 0, hue: 215 },
      { position: 0.5, hue: 195 },
      { position: 1, hue: 180 },
    ],
  },
  {
    name: "Aqua",
    colorStops: [
      { position: 0, hue: 165 },
      { position: 0.5, hue: 180 },
      { position: 1, hue: 195 },
    ],
  },
  {
    name: "Violet",
    colorStops: [
      { position: 0, hue: 255 },
      { position: 0.5, hue: 275 },
      { position: 1, hue: 300 },
    ],
  },
  {
    name: "Aurora",
    colorStops: [
      { position: 0, hue: 145 },
      { position: 0.42, hue: 175 },
      { position: 0.72, hue: 215 },
      { position: 1, hue: 280 },
    ],
  },
  {
    name: "Sunset",
    colorStops: [
      { position: 0, hue: 335 },
      { position: 0.42, hue: 8 },
      { position: 0.72, hue: 20 },
      { position: 1, hue: 38 },
    ],
  },
  {
    name: "Amber",
    colorStops: [
      { position: 0, hue: 42 },
      { position: 0.5, hue: 48 },
      { position: 1, hue: 34 },
    ],
  },
  { name: "White", monochrome: "white" },
  { name: "Black", monochrome: "black" },
  { name: "Color Cycle", colorCycle: true, spread: 50 },
  { name: "Rainbow", rainbow: true },
  { name: "Rainbow Cycle", rainbow: true, cycle: true },
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
  "cascade",
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
    ringCount: 30,
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
  cascade: {
    lineCount: 26,
    rollSpeed: 0.52,
    releasePerSec: 9.6,
  },
  particles: {
    cap: 1400,
  },
  hueCycle: {
    baseDegPerSec: 18,
    midDegPerSecPerUnit: 0.6,
  },
  backgrounds: {
    nebulaClouds: 8,
    starsCount: 180,
    gridSpeed: 0.65,
  },
  fx: {
    vignetteMin: 0.25,
    vignetteMax: 0.85,
    beatFlashMax: 0.35,
  },
};

// ---------- audio tuning ----------
const AUDIO_TUNING = {
  beatRatio: 1.2,
  beatFloor: 38,
  beatCooldownMs: 120,
  pulseDecayPerSec: 5.6,
  particleFloor: 20,
  particleRange: 190,
  sustainedFloor: 140,
  sustainedIntervalMs: 300,
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
const TRAIL_DURATION_MS = 220;
const TRAIL_MAX_SNAPSHOTS = 24;
const TRAIL_MAX_FPS = 60;
