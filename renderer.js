// ---------- setup ----------
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

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const errorMsg = document.getElementById("errorMsg");
const hud = document.getElementById("hud");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const bgLayer = document.getElementById("bgLayer");
const bgTypeSelect = document.getElementById("bgTypeSelect");
const bgColorRow = document.getElementById("bgColorRow");
const bgImageRow = document.getElementById("bgImageRow");
const bgColorInput = document.getElementById("bgColorInput");
const bgImageInput = document.getElementById("bgImageInput");
const bgImageName = document.getElementById("bgImageName");
const clearBgImageBtn = document.getElementById("clearBgImageBtn");
const brightnessSlider = document.getElementById("brightnessSlider");
const brightnessVal = document.getElementById("brightnessVal");
const blurSlider = document.getElementById("blurSlider");
const blurVal = document.getElementById("blurVal");
const modeSelect = document.getElementById("modeSelect");
const themeSelect = document.getElementById("themeSelect");

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
  { name: "Color Cycle", colorCycle: true, spread: 30 }, // rotates over time, with a hue gradient across each visual so it isn't flat
  { name: "Rainbow", rainbow: true }, // fixed full spectrum across each visual
  { name: "Rainbow Cycle", rainbow: true, cycle: true }, // spectrum rotates
  { name: "Ice", hues: [190, 260] }, // blue -> purple
];

const MODES = ["bars", "radial", "waveform", "particles", "kaleidoscope"];

// Populate the settings-panel dropdowns straight from MODES/THEMES so a
// new visual or theme added above shows up here automatically instead of
// needing a matching edit in the HTML.
MODES.forEach((name, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
  modeSelect.appendChild(opt);
});
THEMES.forEach((theme, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = theme.name;
  themeSelect.appendChild(opt);
});

const state = {
  mode: 0,
  theme: 0,
  autoCycle: false,
  autoCycleTimer: null,
  hueShift: 0,
  bgType: "color", // "color" | "image" — which one is actually shown
  bgColor: "#0f0f1a",
  bgImageDataUrl: null,
  bgImageName: null,
  bgBrightness: 1,
  bgBlur: 0,
};

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

// ---------- settings persistence ----------
const SETTINGS_KEY = "audioVisualizerSettings";
const PERSISTED_KEYS = [
  "bgType",
  "bgColor",
  "bgImageDataUrl",
  "bgImageName",
  "bgBrightness",
  "bgBlur",
  "mode",
  "theme",
  "autoCycle",
];

// state.bgType is the explicit switch — an uploaded image stays remembered
// even while "Solid color" is selected, so flipping the dropdown back to
// "Image" doesn't require re-picking the file.
function applyBackground() {
  if (state.bgType === "image" && state.bgImageDataUrl) {
    bgLayer.style.backgroundImage = `url("${state.bgImageDataUrl}")`;
  } else {
    bgLayer.style.backgroundImage = "none";
    bgLayer.style.backgroundColor = state.bgColor;
  }
  // Filter lives on #bgLayer only (see index.html) — never on #canvas or
  // the UI — so cranking blur/brightness can't wash out the visuals.
  bgLayer.style.filter = `brightness(${state.bgBrightness}) blur(${state.bgBlur}px)`;
}

function updateBgRowsVisibility() {
  bgTypeSelect.value = state.bgType;
  bgColorRow.style.display = state.bgType === "color" ? "" : "none";
  bgImageRow.style.display = state.bgType === "image" ? "" : "none";
  bgImageName.textContent = state.bgImageName || "none chosen";
}

// Background images are stored as data URLs in localStorage, which has a
// ~5-10MB quota shared across everything else we save. A phone photo
// easily blows past that on its own, so the save silently failed and the
// image never survived a restart. Downscaling to a sane max resolution
// and re-encoding as JPEG keeps it well under quota — the background is
// cover-fit and blurred/dimmed anyway, so full original resolution buys
// nothing visible.
const BG_IMAGE_MAX_DIMENSION = 1920;
const BG_IMAGE_JPEG_QUALITY = 0.82;

function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(
        1,
        BG_IMAGE_MAX_DIMENSION / Math.max(img.width, img.height),
      );
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      off.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(off.toDataURL("image/jpeg", BG_IMAGE_JPEG_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image file"));
    };
    img.src = objectUrl;
  });
}

// Keeps the dropdowns showing whatever visual/theme is actually active,
// whether that came from the dropdown, a keyboard shortcut, or a restored
// setting on launch.
function syncSelectsToState() {
  modeSelect.value = state.mode;
  themeSelect.value = state.theme;
}

function updateSliderLabels() {
  brightnessVal.textContent = `${Math.round(state.bgBrightness * 100)}%`;
  blurVal.textContent = `${state.bgBlur}px`;
}

function saveSettings() {
  try {
    const toSave = {};
    for (const key of PERSISTED_KEYS) toSave[key] = state[key];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("Could not save settings", e);
  }
}

function setAutoCycle(enabled) {
  state.autoCycle = enabled;
  clearInterval(state.autoCycleTimer);
  if (enabled) {
    state.autoCycleTimer = setInterval(() => {
      state.mode = (state.mode + 1) % MODES.length;
      syncSelectsToState();
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
  Object.assign(
    state,
    mergeSettings(state, saved, MODES.length, THEMES.length),
  );
  if (state.autoCycle) setAutoCycle(true);

  bgColorInput.value = state.bgColor;
  brightnessSlider.value = state.bgBrightness;
  blurSlider.value = state.bgBlur;
  updateSliderLabels();
  updateBgRowsVisibility();
  syncSelectsToState();
  applyBackground();
}

// ---------- settings panel: open/close + auto-hide ----------
// The gear button fades with mouse inactivity exactly like #hud (see
// flashHud below). The panel itself only shows when BOTH the person has
// opened it AND the mouse is currently active — so it fades away together
// with the rest of the UI on an idle screen instead of staying pinned
// open forever once toggled on.
let panelOpen = false;
function updatePanelVisibility() {
  settingsPanel.classList.toggle("visible", panelOpen && hudActive);
}

settingsBtn.addEventListener("click", (e) => {
  panelOpen = !panelOpen;
  flashHud();
  updatePanelVisibility();
  e.stopPropagation(); // don't let the same click immediately close it below
});

// Click-outside-to-dismiss: only cares about closing, never opening —
// opening is settingsBtn/"B"'s job above.
window.addEventListener("click", (e) => {
  if (!panelOpen) return;
  if (settingsPanel.contains(e.target)) return;
  panelOpen = false;
  updatePanelVisibility();
});

modeSelect.addEventListener("change", (e) => {
  state.mode = parseInt(e.target.value, 10);
  saveSettings();
});

themeSelect.addEventListener("change", (e) => {
  state.theme = parseInt(e.target.value, 10);
  saveSettings();
});

bgTypeSelect.addEventListener("change", (e) => {
  state.bgType = e.target.value;
  updateBgRowsVisibility();
  applyBackground();
  saveSettings();
});

bgColorInput.addEventListener("input", (e) => {
  state.bgColor = e.target.value;
  applyBackground();
  saveSettings();
});

bgImageInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    state.bgImageDataUrl = await resizeImageFile(file);
    state.bgImageName = file.name;
    state.bgType = "image";
    updateBgRowsVisibility();
    applyBackground();
    saveSettings();
  } catch (err) {
    console.warn("Could not use that background image", err);
  }
});

clearBgImageBtn.addEventListener("click", () => {
  state.bgImageDataUrl = null;
  state.bgImageName = null;
  state.bgType = "color";
  bgImageInput.value = "";
  updateBgRowsVisibility();
  applyBackground();
  saveSettings();
});

brightnessSlider.addEventListener("input", (e) => {
  state.bgBrightness = parseFloat(e.target.value);
  updateSliderLabels();
  applyBackground();
  saveSettings();
});

blurSlider.addEventListener("input", (e) => {
  state.bgBlur = parseFloat(e.target.value);
  updateSliderLabels();
  applyBackground();
  saveSettings();
});

loadSettings();

// ---------- audio ----------
let analyser, freqData, timeData, bufferLength;

let audioClockMs = 0;

const BASS_HISTORY_MS = 1000;
let bassHistory = [];

let beatCooldownMsLeft = 0;
let sustainedCooldownMsLeft = 0;
let beatPulse = 0;
let beatJustHit = false;

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
  return computeHue(THEMES[state.theme], state.hueShift, offset);
}

function applyGlow(color, blur) {
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
}

function updateBeat(bass, elapsedMs, dtSec) {
  audioClockMs += elapsedMs;

  bassHistory.push({ bass, t: audioClockMs });
  while (
    bassHistory.length &&
    audioClockMs - bassHistory[0].t > BASS_HISTORY_MS
  ) {
    bassHistory.shift();
  }
  const avg = bassHistory.reduce((a, e) => a + e.bass, 0) / bassHistory.length;

  beatCooldownMsLeft = Math.max(0, beatCooldownMsLeft - elapsedMs);
  sustainedCooldownMsLeft = Math.max(0, sustainedCooldownMsLeft - elapsedMs);

  const { isSpike, isSustainedLoud } = detectBeat({
    bass,
    avg,
    beatCooldownMsLeft,
    sustainedCooldownMsLeft,
    tuning: AUDIO_TUNING,
  });

  if (isSpike || isSustainedLoud) {
    beatPulse = 1;
    beatJustHit = true;
    if (isSpike) {
      beatCooldownMsLeft = AUDIO_TUNING.beatCooldownMs;
    } else {
      sustainedCooldownMsLeft = AUDIO_TUNING.sustainedIntervalMs;
    }
  }

  beatPulse *= Math.exp(-AUDIO_TUNING.pulseDecayPerSec * dtSec);
}

// ---------- particle system (used by 'particles' mode) ----------
const particles = [];
let trailAge = 0;
const TRAIL_TIMEOUT_MS = 15000;

// ---------- draw modes ----------
function clearFrame(elapsedMs) {
  trailAge += elapsedMs;
  const dtSec = elapsedMs / 1000;
  const remainingAlpha = Math.exp(-VISUAL_TUNING.trail.fadePerSec * dtSec);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(0, 0, 0, ${1 - remainingAlpha})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  if (trailAge >= TRAIL_TIMEOUT_MS) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    trailAge = 0;
  }
}

const smoothedBars = new Array(96).fill(0);

function drawBars(bassLevel, midLevel, trebleLevel, dtSec) {
  const { baseYFrac, heightScale, releasePerSec } = VISUAL_TUNING.bars;
  const barCount = 96;
  const step = Math.max(1, Math.floor((bufferLength * 0.69) / barCount));
  const w = canvas.width / barCount;
  const baseY = canvas.height * baseYFrac;
  const remaining = Math.exp(-releasePerSec * dtSec);

  for (let i = 0; i < barCount; i++) {
    const targetV = Math.pow(freqData[i * step] / 255, 0.82);
    smoothedBars[i] = smoothTowards(smoothedBars[i], targetV, remaining);
    const v = smoothedBars[i];

    const h =
      v *
      canvas.height *
      heightScale *
      (0.82 + bassLevel * 0.2 + midLevel * 0.12 + beatPulse * 0.15);
    const hue = currentHue(i / barCount);
    ctx.fillStyle = `hsl(${hue}, 90%, ${50 + v * 20}%)`;
    applyGlow(ctx.fillStyle, 14);
    ctx.fillRect(i * w, baseY - h, w * 0.8, h);
    // mirrored reflection below
    ctx.globalAlpha = 0.25;
    ctx.fillRect(i * w, baseY, w * 0.8, h * 0.35);
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0;
}

const smoothedRadial = new Array(180).fill(0);

function drawRadial(bassLevel, midLevel, trebleLevel, dtSec) {
  const { baseRFrac, lengthScale, releasePerSec } = VISUAL_TUNING.radial;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const baseR =
    Math.min(canvas.width, canvas.height) *
    baseRFrac *
    (1 + bassLevel * 0.2 + beatPulse * 0.25);
  const barCount = 180;
  const halfCount = barCount / 2;
  const remaining = Math.exp(-releasePerSec * dtSec);

  ctx.lineCap = "round";

  for (let i = 0; i < barCount; i++) {
    const normalized =
      i < halfCount ? i / halfCount : (barCount - i - 1) / halfCount;
    const idx = Math.floor(normalized * bufferLength * 0.5);
    const targetV = Math.pow(freqData[idx] / 255, 0.82);
    smoothedRadial[i] = smoothTowards(smoothedRadial[i], targetV, remaining);
    const v = smoothedRadial[i];

    const len =
      v *
      Math.min(canvas.width, canvas.height) *
      lengthScale *
      (0.8 + midLevel * 0.25 + trebleLevel * 0.2);
    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(angle) * baseR;
    const y1 = cy + Math.sin(angle) * baseR;
    const x2 = cx + Math.cos(angle) * (baseR + len);
    const y2 = cy + Math.sin(angle) * (baseR + len);

    const hue = currentHue(normalized);
    ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`;
    ctx.lineWidth = 2.4;
    applyGlow(ctx.strokeStyle, 10);
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

function drawWaveform(bassLevel, midLevel, trebleLevel) {
  const midY = canvas.height / 2;
  ctx.lineWidth = 2.5 + midLevel * 1.5 + trebleLevel + beatPulse * 3;
  ctx.lineJoin = "round";

  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  const stops = 6;
  for (let s = 0; s <= stops; s++) {
    grad.addColorStop(s / stops, `hsl(${currentHue(s / stops)}, 90%, 60%)`);
  }
  ctx.strokeStyle = grad;
  applyGlow(`hsl(${currentHue(0.5)}, 90%, 60%)`, 16);

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

const ENERGY_HISTORY_MS = 3000;
const energyHistory = [];
let energyNow = 0;
let energyTrend = 0;

function makeParticle({
  x,
  y,
  angle,
  speed,
  decay,
  drag,
  size,
  hueOffset,
  twinkleSpeed,
}) {
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 1,
    decay,
    drag,
    size,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed:
      twinkleSpeed !== undefined ? twinkleSpeed : 0.08 + Math.random() * 0.16,
    hueOffset,
  };
}

function spawnBandParticle(band, energyRatio) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const angle = Math.random() * Math.PI * 2;
  const speed =
    (1.4 + Math.random() * 5.6) * band.speedMul * (0.6 + energyRatio * 1.6);
  particles.push(
    makeParticle({
      x: cx,
      y: cy,
      angle,
      speed,
      decay: (0.007 + Math.random() * 0.014) * band.decayMul,
      drag: 0.975 + Math.random() * 0.02,
      size:
        (1.5 + Math.random() * 3.5) * band.sizeMul * (0.8 + energyRatio * 0.6),
      hueOffset: band.hueT + (Math.random() - 0.5) * 0.06,
    }),
  );
}

function spawnBeatRing(bass) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const count = Math.max(12, Math.floor(bass / 6));
  const speed = 4 + Math.min(1, bass / 255) * 6;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    particles.push(
      makeParticle({
        x: cx,
        y: cy,
        angle,
        speed,
        decay: 0.018,
        drag: 0.965,
        size: 3.5,
        hueOffset: 0.0,
        twinkleSpeed: 0.12,
      }),
    );
  }
}

const FRAME_MS = 1000 / 60;

function drawParticles(bass, bassLevel, midLevel, trebleLevel, elapsedMs) {
  const dt = elapsedMs / FRAME_MS;

  const rawEnergy = bassLevel * 0.5 + midLevel * 0.3 + trebleLevel * 0.2;

  energyHistory.push({ value: rawEnergy, t: audioClockMs });
  while (
    energyHistory.length &&
    audioClockMs - energyHistory[0].t > ENERGY_HISTORY_MS
  ) {
    energyHistory.shift();
  }
  let histMin = 1,
    histMax = 0;
  for (const e of energyHistory) {
    if (e.value < histMin) histMin = e.value;
    if (e.value > histMax) histMax = e.value;
  }
  const span = Math.max(0.08, histMax - histMin);
  const normalized = Math.min(1, Math.max(0, (rawEnergy - histMin) / span));

  const fastFactor = normalized > energyNow ? 0.5 : 0.25;
  energyNow += (normalized - energyNow) * Math.min(1, fastFactor * dt);
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
  const speedScale = 0.3 + energyNow * 2.4;

  const overCap = particles.length - VISUAL_TUNING.particles.cap;
  if (overCap > 0) {
    const trim = 0.05 * dt;
    for (let i = 0; i < overCap; i++) particles[i].life -= trim;
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
    const r = p.size * p.life * (0.4 + energyNow * 1.7);
    const alpha = p.life * shimmer * (0.45 + energyNow * 0.8);

    ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${Math.min(1, alpha)})`;
    const glow = r > 2.2 && alpha > 0.25;
    if (glow) applyGlow(ctx.fillStyle, 8);
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

function drawKaleidoscope(bassLevel, midLevel, trebleLevel, dtSec) {
  const {
    maxRFrac,
    coreRFrac,
    releasePerSec,
    spinPerSec,
    spinTreblePerSec,
    spinBeatPerSec,
    flashDecayPerSec,
  } = VISUAL_TUNING.kaleidoscope;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const segments = 8;
  const segAngle = (Math.PI * 2) / segments;
  const maxR = Math.min(canvas.width, canvas.height) * maxRFrac;

  kaleidoRotation +=
    (spinPerSec + trebleLevel * spinTreblePerSec + beatPulse * spinBeatPerSec) *
    dtSec;
  kaleidoFlash = Math.max(0, kaleidoFlash - flashDecayPerSec * dtSec);
  if (beatPulse > 0.75) kaleidoFlash = 1;

  const remaining = Math.exp(-releasePerSec * dtSec);

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
      smoothedKaleido[i] = smoothTowards(
        smoothedKaleido[i],
        targetV,
        remaining,
      );
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

      const hue = currentHue(t);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, aStart, aEnd);
      ctx.closePath();
      ctx.fillStyle = `hsla(${hue}, 90%, ${55 + v * 15}%, ${0.35 + v * 0.55})`;
      applyGlow(ctx.fillStyle, 10);
      ctx.fill();
    }
    ctx.restore();
  }

  if (kaleidoFlash > 0.02) {
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * (0.15 + (1 - kaleidoFlash) * 0.55), 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${currentHue(0)}, 90%, 70%, ${kaleidoFlash * 0.6})`;
    ctx.lineWidth = 3 + kaleidoFlash * 4;
    applyGlow(ctx.strokeStyle, 20);
    ctx.stroke();
  }

  const coreR = maxR * coreRFrac * (1 + bassLevel * 0.7 + kaleidoFlash * 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${currentHue(0)}, 90%, 65%, 0.6)`;
  applyGlow(ctx.fillStyle, 16);
  ctx.fill();

  ctx.shadowBlur = 0;
}

// ---------- main loop ----------
let lastFrameTime = 0;

function loop(timestamp = performance.now()) {
  requestAnimationFrame(loop);
  if (!analyser) return;

  if (lastFrameTime === 0) lastFrameTime = timestamp;
  const elapsedMs = Math.min(100, Math.max(0, timestamp - lastFrameTime));
  lastFrameTime = timestamp;
  const dtSec = elapsedMs / 1000;

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
  updateBeat(bass, elapsedMs, dtSec);

  if (THEMES[state.theme].colorCycle || THEMES[state.theme].cycle) {
    const { baseDegPerSec, midDegPerSecPerUnit } = VISUAL_TUNING.hueCycle;
    state.hueShift =
      (state.hueShift + (baseDegPerSec + mid * midDegPerSecPerUnit) * dtSec) %
      360;
  }

  clearFrame(elapsedMs);
  switch (MODES[state.mode]) {
    case "bars":
      drawBars(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "radial":
      drawRadial(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "waveform":
      drawWaveform(bassLevel, midLevel, trebleLevel);
      break;
    case "particles":
      drawParticles(bass, bassLevel, midLevel, trebleLevel, elapsedMs);
      break;
    case "kaleidoscope":
      drawKaleidoscope(bassLevel, midLevel, trebleLevel, dtSec);
      break;
  }
}

// ---------- input ----------
let hudTimeout;
let hudActive = false;
// The gear button and the settings panel (when open) both ride along
// with #hud's show-on-activity/fade-on-idle cycle — see
// updatePanelVisibility above, which reads hudActive too.
function flashHud() {
  hudActive = true;
  hud.classList.add("visible");
  settingsBtn.classList.add("visible");
  updatePanelVisibility();
  clearTimeout(hudTimeout);
  hudTimeout = setTimeout(() => {
    hudActive = false;
    hud.classList.remove("visible");
    settingsBtn.classList.remove("visible");
    updatePanelVisibility();
  }, 2500);
}
window.addEventListener("mousemove", flashHud);

const KEY_ACTIONS = {
  c: () => {
    state.theme = (state.theme + 1) % THEMES.length;
    syncSelectsToState();
    saveSettings();
  },
  f: () => window.electronAPI.toggleFullscreen(),
  t: () => window.electronAPI.toggleAlwaysOnTop(),
  b: () => {
    panelOpen = !panelOpen;
    updatePanelVisibility();
  },
  " ": () => {
    setAutoCycle(!state.autoCycle);
    saveSettings();
  },
  escape: () => window.electronAPI.quit(),
};

window.addEventListener("keydown", (e) => {
  flashHud();
  if (e.key >= "1" && e.key <= "5") {
    state.mode = parseInt(e.key, 10) - 1;
    syncSelectsToState();
    saveSettings();
    return;
  }
  const action = KEY_ACTIONS[e.key.toLowerCase()];
  if (action) action();
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
