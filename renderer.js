// ---------- setup ----------
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const errorMsg = document.getElementById("errorMsg");
const hud = document.getElementById("hud");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const bgColorInput = document.getElementById("bgColorInput");
const bgImageInput = document.getElementById("bgImageInput");
const clearBgImageBtn = document.getElementById("clearBgImageBtn");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const THEMES = [
  { name: "Neon", hues: [320, 200] }, // pink -> cyan
  { name: "Fire", hues: [15, 45] }, // red -> orange
  { name: "Matrix", hues: [130, 160] }, // green
  { name: "Color Cycle", colorCycle: true }, // one hue rotates over time
  { name: "Rainbow", rainbow: true }, // fixed full spectrum across each visual
  { name: "Rainbow Cycle", rainbow: true, cycle: true }, // spectrum rotates
  { name: "Ice", hues: [190, 260] }, // blue -> purple
];

const MODES = ["bars", "radial", "waveform", "particles", "kaleidoscope"];

const state = {
  mode: 0,
  theme: 0,
  autoCycle: false,
  autoCycleTimer: null,
  hueShift: 0,
  bgColor: "#0f0f1a",
  bgImageDataUrl: null,
};

// ---------- settings persistence ----------
// Everything the person can change from outside the audio itself —
// background, and which visual/theme/auto-cycle they left it on —
// is remembered here, so the app reopens the way they left it instead
// of resetting to defaults every launch. One shared key, one shared
// save/load pair, so adding another persisted setting later is a
// one-line change instead of a new storage key + new plumbing.
const SETTINGS_KEY = "audioVisualizerSettings";

// The canvas clears each frame with destination-out compositing (see
// clearFrame below), which erases canvas alpha rather than painting over
// it — so whatever is set as the <body> CSS background shows straight
// through. That means changing the background is just: update <body>'s
// background-color / background-image and remember the choice.
function applyBackground() {
  if (state.bgImageDataUrl) {
    document.body.style.backgroundImage = `url("${state.bgImageDataUrl}")`;
  } else {
    document.body.style.backgroundImage = "none";
    document.body.style.backgroundColor = state.bgColor;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        bgColor: state.bgColor,
        bgImageDataUrl: state.bgImageDataUrl,
        mode: state.mode,
        theme: state.theme,
        autoCycle: state.autoCycle,
      }),
    );
  } catch (e) {
    // Large background images can exceed localStorage's quota. Everything
    // still works for this session, it just won't be remembered next launch.
    console.warn("Could not save settings", e);
  }
}

// Starts/stops the auto-cycle interval AND updates state.autoCycle, so it
// can be called both from the keyboard shortcut and when restoring a saved
// "autoCycle: true" setting on launch without duplicating this logic.
function setAutoCycle(enabled) {
  state.autoCycle = enabled;
  clearInterval(state.autoCycleTimer);
  if (enabled) {
    state.autoCycleTimer = setInterval(() => {
      state.mode = (state.mode + 1) % MODES.length;
      saveSettings();
    }, 12000);
  }
}

function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
  } catch (e) {
    saved = null;
  }
  if (saved) {
    if (saved.bgColor) state.bgColor = saved.bgColor;
    if (saved.bgImageDataUrl) state.bgImageDataUrl = saved.bgImageDataUrl;
    if (typeof saved.mode === "number" && MODES[saved.mode] !== undefined)
      state.mode = saved.mode;
    if (typeof saved.theme === "number" && THEMES[saved.theme] !== undefined)
      state.theme = saved.theme;
    if (saved.autoCycle) setAutoCycle(true);
  }
  bgColorInput.value = state.bgColor;
  applyBackground();
}

settingsBtn.addEventListener("click", () => {
  settingsPanel.classList.toggle("visible");
});

bgColorInput.addEventListener("input", (e) => {
  state.bgColor = e.target.value;
  applyBackground();
  saveSettings();
});

bgImageInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.bgImageDataUrl = reader.result;
    applyBackground();
    saveSettings();
  };
  reader.readAsDataURL(file);
});

clearBgImageBtn.addEventListener("click", () => {
  state.bgImageDataUrl = null;
  bgImageInput.value = "";
  applyBackground();
  saveSettings();
});

loadSettings();

// ---------- audio ----------
let analyser, freqData, timeData, bufferLength;

const BASS_HISTORY_MS = 1000;
let bassHistory = [];

let beatCooldownMsLeft = 0;
let sustainedCooldownMsLeft = 0;
let beatPulse = 0;
let beatJustHit = false;
let previousBeatTime = 0;

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

async function initAudio() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error(
      "No system audio track was returned. Make sure something is actually playing.",
    );
  }

  // We don't need the video frames at all, drop that track to save resources.
  stream.getVideoTracks().forEach((t) => t.stop());

  const audioStream = new MediaStream(audioTracks);
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioCtx.createMediaStreamSource(audioStream);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.82;
  source.connect(analyser);

  bufferLength = analyser.frequencyBinCount;
  freqData = new Uint8Array(bufferLength);
  timeData = new Uint8Array(bufferLength);
}

// ---------- helpers ----------
function currentHue(offset = 0) {
  const theme = THEMES[state.theme];
  if (theme.rainbow) {
    const rotation = theme.cycle ? state.hueShift : 0;
    return (offset * 360 + rotation) % 360;
  }
  if (theme.colorCycle) return state.hueShift % 360;
  const [a, b] = theme.hues;
  return a + (b - a) * (offset % 1);
}

function bandAverage(data, loFrac, hiFrac) {
  const lo = Math.floor(data.length * loFrac);
  const hi = Math.floor(data.length * hiFrac);
  let sum = 0;
  for (let i = lo; i < hi; i++) sum += data[i];
  return sum / Math.max(1, hi - lo);
}

function normalizeEnergy(value, floor = 20, range = 210) {
  return Math.min(1, Math.max(0, (value - floor) / range));
}

function updateBeat(bass, timestamp = performance.now()) {
  if (previousBeatTime === 0) previousBeatTime = timestamp;
  const elapsedMs = Math.min(100, Math.max(0, timestamp - previousBeatTime));
  previousBeatTime = timestamp;

  bassHistory.push({ bass, t: timestamp });
  while (bassHistory.length && timestamp - bassHistory[0].t > BASS_HISTORY_MS) {
    bassHistory.shift();
  }
  const avg = bassHistory.reduce((a, e) => a + e.bass, 0) / bassHistory.length;

  beatCooldownMsLeft = Math.max(0, beatCooldownMsLeft - elapsedMs);
  sustainedCooldownMsLeft = Math.max(0, sustainedCooldownMsLeft - elapsedMs);

  const isSpike =
    bass > avg * AUDIO_TUNING.beatRatio &&
    bass > AUDIO_TUNING.beatFloor &&
    beatCooldownMsLeft === 0;

  const isSustainedLoud =
    bass > AUDIO_TUNING.sustainedFloor && sustainedCooldownMsLeft === 0;

  if (isSpike || isSustainedLoud) {
    beatPulse = 1;
    beatJustHit = true;
    if (isSpike) {
      beatCooldownMsLeft = AUDIO_TUNING.beatCooldownMs;
    } else {
      sustainedCooldownMsLeft = AUDIO_TUNING.sustainedIntervalMs;
    }
  }

  const dtSec = elapsedMs / 1000;
  beatPulse *= Math.exp(-AUDIO_TUNING.pulseDecayPerSec * dtSec);
}

// ---------- particle system (used by 'particles' mode) ----------
const particles = [];
let previousFrameTime = 0;
let trailAge = 0;
// Now just a safety net for float drift, not the primary cleanup mechanism,
// so it can be long enough to never be visible as a pop.
const TRAIL_TIMEOUT_MS = 15000;
function spawnParticles(n, energy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const energyRatio = Math.min(1, energy / 255);
  for (let i = 0; i < n; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Give every particle a noticeably different launch speed. Stronger bass
    // raises the whole speed range while randomness keeps bursts organic.
    const speed = (1.4 + Math.random() * 5.6) * (0.7 + energyRatio * 1.7);
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.007 + Math.random() * 0.014,
      drag: 0.975 + Math.random() * 0.02,
      size: 1.5 + Math.random() * 3.5,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.08 + Math.random() * 0.16,
      hueOffset: Math.random(),
    });
  }
}

// ---------- draw modes ----------
function clearFrame(timestamp = performance.now()) {
  if (previousFrameTime === 0) previousFrameTime = timestamp;
  const elapsed = Math.min(100, Math.max(0, timestamp - previousFrameTime));
  previousFrameTime = timestamp;
  trailAge += elapsed;
  // Fade every animation frame using elapsed time rather than batching. This
  // keeps the trail continuous on 60 Hz, 144 Hz, and variable-refresh displays.
  const frameEquivalent = elapsed / (1000 / 60);
  const remainingAlpha = Math.pow(0.49, frameEquivalent);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(0, 0, 0, ${1 - remainingAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  // Safety net only: the time-scaled fade handles normal cleanup, while this
  // catches any pathological alpha drift that survives canvas quantization.
  if (trailAge >= TRAIL_TIMEOUT_MS) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    trailAge = 0;
  }
}

const smoothedBars = new Array(96).fill(0);

function drawBars(bassLevel, midLevel, trebleLevel) {
  const barCount = 96;
  // Map the bars across 69% of the analyser range so the quiet upper-
  // frequency tail does not dominate the layout.
  const step = Math.max(1, Math.floor((bufferLength * 0.69) / barCount));
  const w = canvas.width / barCount;
  const baseY = canvas.height * 0.75;

  for (let i = 0; i < barCount; i++) {
    const targetV = Math.pow(freqData[i * step] / 255, 0.82);

    if (targetV >= smoothedBars[i]) {
      smoothedBars[i] = targetV;
    } else {
      smoothedBars[i] += (targetV - smoothedBars[i]) * 0.1;
    }

    const v = smoothedBars[i];

    const h =
      v *
      canvas.height *
      0.6 *
      (0.82 + bassLevel * 0.2 + midLevel * 0.12 + beatPulse * 0.15);
    const hue = currentHue(i / barCount);
    ctx.fillStyle = `hsl(${hue}, 90%, ${50 + v * 20}%)`;
    ctx.shadowBlur = 14;
    ctx.shadowColor = ctx.fillStyle;
    ctx.fillRect(i * w, baseY - h, w * 0.8, h);
    // mirrored reflection below
    ctx.globalAlpha = 0.25;
    ctx.fillRect(i * w, baseY, w * 0.8, h * 0.35);
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0;
}

const smoothedRadial = new Array(180).fill(0);

function drawRadial(bassLevel, midLevel, trebleLevel) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const baseR =
    Math.min(canvas.width, canvas.height) *
    0.16 *
    (1 + bassLevel * 0.2 + beatPulse * 0.25);
  const barCount = 180;
  const halfCount = barCount / 2;

  ctx.lineCap = "round";

  for (let i = 0; i < barCount; i++) {
    const normalized =
      i < halfCount ? i / halfCount : (barCount - i - 1) / halfCount;
    const idx = Math.floor(normalized * bufferLength * 0.5);
    const targetV = Math.pow(freqData[idx] / 255, 0.82);

    if (targetV >= smoothedRadial[i]) {
      smoothedRadial[i] = targetV;
    } else {
      smoothedRadial[i] += (targetV - smoothedRadial[i]) * 0.15;
    }

    const v = smoothedRadial[i];
    const len =
      v *
      Math.min(canvas.width, canvas.height) *
      0.32 *
      (0.8 + midLevel * 0.25 + trebleLevel * 0.2);
    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * baseR;
    const y1 = cy + Math.sin(angle) * baseR;
    const x2 = cx + Math.cos(angle) * (baseR + len);
    const y2 = cy + Math.sin(angle) * (baseR + len);

    const hue = currentHue(normalized);
    ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`;
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 10;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // pulsing center circle
  ctx.beginPath();
  ctx.arc(cx, cy, baseR * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${currentHue(0)}, 90%, 60%, 0.15)`;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `hsla(${currentHue(0)}, 90%, 70%, 0.5)`;
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.lineCap = "butt";
}

const smoothedWave = new Float32Array(0); // resized lazily below

function drawWaveform(bassLevel, midLevel, trebleLevel) {
  const midY = canvas.height / 2;
  ctx.lineWidth = 2.5 + midLevel * 1.5 + trebleLevel + beatPulse * 3;
  ctx.lineJoin = "round";
  ctx.shadowBlur = 16;

  // Build a gradient across the theme's hue range instead of one flat color,
  // so Rainbow/Ice/etc. actually show as gradients here too.
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  const stops = 6;
  for (let s = 0; s <= stops; s++) {
    grad.addColorStop(s / stops, `hsl(${currentHue(s / stops)}, 90%, 60%)`);
  }
  ctx.strokeStyle = grad;
  ctx.shadowColor = `hsl(${currentHue(0.5)}, 90%, 60%)`;

  ctx.beginPath();
  const slice = canvas.width / bufferLength;
  const amp = 1.35 + midLevel * 0.35 + trebleLevel * 0.2 + bassLevel * 0.25;
  for (let i = 0; i < bufferLength; i++) {
    const raw = (timeData[i] - 128) / 128;
    const y = midY + raw * amp * canvas.height * 0.32;
    const x = i * slice;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

const PARTICLE_BANDS = [
  { hueT: 0.05, sizeMul: 1.7, speedMul: 0.55, decayMul: 0.55 },
  { hueT: 0.5, sizeMul: 1.0, speedMul: 1.0, decayMul: 1.0 },
  { hueT: 0.95, sizeMul: 0.5, speedMul: 2.0, decayMul: 2.0 },
];

const bandSpawnAccum = [0, 0, 0];

// Auto-gain: tracks the recent range of raw energy so particles use the
// FULL visual range regardless of a given track's absolute loudness or
// how compressed normalizeEnergy's fixed floor/range leaves it. Without
// this, tracks that don't hit the hardcoded floor/range extremes look
// artificially flat no matter what multiplier ranges you pick downstream.
const ENERGY_HISTORY_LEN = 180; // ~3s at 60fps
const energyHistory = [];
let energyNow = 0; // fast-reacting, drives speed/size/alpha — snappy
let energyTrend = 0; // slow-reacting, drives buildup/decay only

function spawnBandParticle(band, energyRatio) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const angle = Math.random() * Math.PI * 2;
  const speed =
    (1.4 + Math.random() * 5.6) * band.speedMul * (0.6 + energyRatio * 1.6);
  particles.push({
    x: cx,
    y: cy,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 1,
    decay: (0.007 + Math.random() * 0.014) * band.decayMul,
    drag: 0.975 + Math.random() * 0.02,
    size:
      (1.5 + Math.random() * 3.5) * band.sizeMul * (0.8 + energyRatio * 0.6),
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.08 + Math.random() * 0.16,
    hueOffset: band.hueT + (Math.random() - 0.5) * 0.06,
  });
}

function spawnBeatRing(bass) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const count = Math.max(12, Math.floor(bass / 6));
  const speed = 4 + Math.min(1, bass / 255) * 6;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      decay: 0.018,
      drag: 0.965,
      size: 3.5,
      twinkle: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.12,
      hueOffset: 0.0,
    });
  }
}

let previousParticleFrameTime = 0;

function drawParticles(
  bass,
  bassLevel,
  midLevel,
  trebleLevel,
  timestamp = performance.now(),
) {
  if (previousParticleFrameTime === 0) previousParticleFrameTime = timestamp;
  const elapsed = Math.min(
    100,
    Math.max(0, timestamp - previousParticleFrameTime),
  );
  previousParticleFrameTime = timestamp;
  const dt = elapsed / (1000 / 60);

  const rawEnergy = bassLevel * 0.5 + midLevel * 0.3 + trebleLevel * 0.2;

  energyHistory.push(rawEnergy);
  if (energyHistory.length > ENERGY_HISTORY_LEN) energyHistory.shift();
  let histMin = 1,
    histMax = 0;
  for (const e of energyHistory) {
    if (e < histMin) histMin = e;
    if (e > histMax) histMax = e;
  }
  // Guard against a near-silent/flat window collapsing the range to ~0,
  // which would otherwise amplify noise into huge swings.
  const span = Math.max(0.08, histMax - histMin);
  const normalized = Math.min(1, Math.max(0, (rawEnergy - histMin) / span));

  // Fast attack AND fast-ish release — this is the key change. The old
  // single energyPulse used the same slow factor both ways, which is why
  // it read as "almost constant." Speed/size need to visibly track loud
  // vs quiet moment-to-moment, not ease into them.
  const fastFactor = normalized > energyNow ? 0.5 : 0.25;
  energyNow += (normalized - energyNow) * Math.min(1, fastFactor * dt);

  // Trend still eases slowly — this is what gives the "buildup over a
  // sustained loud section" feel for decay/density, kept separate so it
  // doesn't also mute the fast per-hit response above.
  energyTrend += (normalized - energyTrend) * Math.min(1, 0.06 * dt);

  const levels = [bassLevel, midLevel, trebleLevel];
  const SPAWN_RATE = 40;
  const AMBIENT_FLOOR = 0.05;
  for (let b = 0; b < 3; b++) {
    const rate = (AMBIENT_FLOOR + levels[b]) * SPAWN_RATE;
    bandSpawnAccum[b] += rate * (dt / 60);
    while (bandSpawnAccum[b] >= 1) {
      spawnBandParticle(PARTICLE_BANDS[b], levels[b]);
      bandSpawnAccum[b] -= 1;
    }
  }

  if (beatJustHit) {
    spawnBeatRing(bass);
    beatJustHit = false;
  }

  const decayScale = 1.7 - energyTrend * 1.1;
  // Much wider swing than before (was 0.5–1.3): quiet moments visibly
  // crawl, loud moments visibly rush.
  const speedScale = 0.3 + energyNow * 2.4;

  const overCap = particles.length - 1400;
  if (overCap > 0) {
    for (let i = 0; i < overCap; i++) particles[i].life -= 0.05;
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * speedScale * dt;
    p.y += p.vy * speedScale * dt;
    p.vx *= Math.pow(p.drag, dt);
    p.vy *= Math.pow(p.drag, dt);
    p.twinkle += p.twinkleSpeed * dt;
    p.life -= p.decay * decayScale * dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const hue = currentHue(p.hueOffset);
    const shimmer = 0.72 + Math.sin(p.twinkle) * 0.28;
    // Much wider swing than before (was 0.75–1.65): 0.4–2.1.
    const r = p.size * p.life * (0.4 + energyNow * 1.7);
    const alpha = p.life * shimmer * (0.45 + energyNow * 0.8);

    ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${Math.min(1, alpha)})`;
    const glow = r > 2.2 && alpha > 0.25;
    if (glow) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = ctx.fillStyle;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (glow) ctx.shadowBlur = 0;
  }
}

let kaleidoRotation = 0;
const KALEIDO_BARS = 28;
const smoothedKaleido = new Array(KALEIDO_BARS).fill(0);
let kaleidoFlash = 0;

// Precompute log-spaced band edges once — avoids recalculating Math.pow
// per frame. Each bar covers a proportionally wider slice of the higher,
// naturally-quieter frequencies instead of linear index spacing.
const KALEIDO_BAND_EDGES = (() => {
  const edges = [];
  const minFrac = 0.006; // skip the very first couple of bins (huge DC/sub-bass)
  const maxFrac = 0.5;
  for (let i = 0; i <= KALEIDO_BARS; i++) {
    const t = i / KALEIDO_BARS;
    edges.push(minFrac * Math.pow(maxFrac / minFrac, t));
  }
  return edges;
})();

function drawKaleidoscope(bassLevel, midLevel, trebleLevel) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const segments = 8;
  const segAngle = (Math.PI * 2) / segments;
  const maxR = Math.min(canvas.width, canvas.height) * 0.46;

  kaleidoRotation += 0.0012 + trebleLevel * 0.003 + beatPulse * 0.006;
  kaleidoFlash = Math.max(0, kaleidoFlash - 0.12);
  if (beatPulse > 0.75) kaleidoFlash = 1;

  for (let s = 0; s < segments; s++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s * segAngle + kaleidoRotation);
    const mirrored = s % 2 === 1;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, maxR, 0, segAngle);
    ctx.closePath();
    ctx.clip();

    for (let i = 0; i < KALEIDO_BARS; i++) {
      const raw = bandAverage(
        freqData,
        KALEIDO_BAND_EDGES[i],
        KALEIDO_BAND_EDGES[i + 1],
      );
      const tilt = 1 + (i / KALEIDO_BARS) * 1.6;
      const targetV = Math.min(1, Math.pow((raw / 255) * tilt, 0.7));

      if (targetV >= smoothedKaleido[i]) {
        smoothedKaleido[i] = targetV;
      } else {
        smoothedKaleido[i] += (targetV - smoothedKaleido[i]) * 0.22;
      }
      const v = smoothedKaleido[i];
      if (v < 0.03) continue;

      const t = i / KALEIDO_BARS;
      let aStart = t * segAngle;
      let aEnd = (t + 0.92 / KALEIDO_BARS) * segAngle;

      if (mirrored) {
        const newStart = segAngle - aEnd;
        const newEnd = segAngle - aStart;
        aStart = newStart;
        aEnd = newEnd;
      }

      const r =
        18 +
        v *
          maxR *
          (0.55 + midLevel * 0.25 + bassLevel * 0.2 + kaleidoFlash * 0.15);

      // Hue keyed to raw bar index only — NOT to the mirrored angle. The
      // shape mirroring above already makes bar i land in the mirrored
      // spot; tying color to the same bar index means the shared edge
      // between two wedges is always the same bar, hence the same color.
      const hue = currentHue(t);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, aStart, aEnd);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 90%, ${55 + v * 15}%, ${0.35 + v * 0.55})`;
      ctx.shadowBlur = 10;
      ctx.shadowColor = ctx.fillStyle;
      ctx.fill();
    }
    ctx.restore();
  }

  if (kaleidoFlash > 0.02) {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * (0.15 + (1 - kaleidoFlash) * 0.55), 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${currentHue(0)}, 90%, 70%, ${kaleidoFlash * 0.6})`;
    ctx.lineWidth = 3 + kaleidoFlash * 4;
    ctx.shadowBlur = 20;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.stroke();
  }

  const coreR = maxR * 0.035 * (1 + bassLevel * 0.7 + kaleidoFlash * 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${currentHue(0)}, 90%, 65%, 0.6)`;
  ctx.shadowBlur = 16;
  ctx.shadowColor = ctx.fillStyle;
  ctx.fill();

  ctx.shadowBlur = 0;
}

// ---------- main loop ----------
function loop(timestamp) {
  requestAnimationFrame(loop);
  if (!analyser) return;

  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  const bass = bandAverage(freqData, 0, 0.015); // ~0-300Hz (True Bass)
  const mid = bandAverage(freqData, 0.015, 0.1); // ~300-2000Hz (Mids)
  const treble = bandAverage(freqData, 0.1, 0.5); // ~2000-10000Hz (Highs)
  const bassLevel = normalizeEnergy(
    bass,
    AUDIO_TUNING.particleFloor,
    AUDIO_TUNING.particleRange,
  );
  const midLevel = normalizeEnergy(mid, 18, 180);
  const trebleLevel = normalizeEnergy(treble, 14, 170);
  updateBeat(bass, timestamp);

  if (THEMES[state.theme].colorCycle || THEMES[state.theme].cycle) {
    state.hueShift = (state.hueShift + 0.3 + mid * 0.01) % 360;
  }

  clearFrame(timestamp);
  switch (MODES[state.mode]) {
    case "bars":
      drawBars(bassLevel, midLevel, trebleLevel);
      break;
    case "radial":
      drawRadial(bassLevel, midLevel, trebleLevel);
      break;
    case "waveform":
      drawWaveform(bassLevel, midLevel, trebleLevel);
      break;
    case "particles":
      drawParticles(bass, bassLevel, midLevel, trebleLevel, timestamp);
      break;
    case "kaleidoscope":
      drawKaleidoscope(bassLevel, midLevel, trebleLevel);
      break;
  }
}

// ---------- input ----------
let hudTimeout;
function flashHud() {
  hud.classList.add("visible");
  clearTimeout(hudTimeout);
  hudTimeout = setTimeout(() => hud.classList.remove("visible"), 2500);
}
window.addEventListener("mousemove", flashHud);

window.addEventListener("keydown", (e) => {
  flashHud();
  if (e.key >= "1" && e.key <= "5") {
    state.mode = parseInt(e.key, 10) - 1;
    saveSettings();
  } else if (e.key.toLowerCase() === "c") {
    state.theme = (state.theme + 1) % THEMES.length;
    saveSettings();
  } else if (e.key.toLowerCase() === "f") {
    window.electronAPI.toggleFullscreen();
  } else if (e.key.toLowerCase() === "t") {
    window.electronAPI.toggleAlwaysOnTop();
  } else if (e.key.toLowerCase() === "b") {
    settingsPanel.classList.toggle("visible");
  } else if (e.key === " ") {
    setAutoCycle(!state.autoCycle);
    saveSettings();
  } else if (e.key === "Escape") {
    window.electronAPI.quit();
  }
});

// ---------- start ----------
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";
  errorMsg.style.display = "none";
  try {
    await initAudio();
    startOverlay.style.display = "none";
    flashHud();
    loop();
  } catch (err) {
    console.error(err);
    errorMsg.textContent =
      "Could not start: " +
      err.message +
      " — make sure audio is playing and try again.";
    errorMsg.style.display = "block";
    startBtn.disabled = false;
    startBtn.textContent = "▶ START";
  }
});
