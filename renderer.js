// ---------- setup ----------
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const errorMsg = document.getElementById("errorMsg");
const hud = document.getElementById("hud");

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
};

// ---------- audio ----------
let analyser, freqData, timeData, bufferLength;
let bassHistory = [];
const BASS_HISTORY_LEN = 60;
let beatCooldown = 0;
let beatPulse = 0; // 0..1, decays each frame, spikes on detected beat

const AUDIO_TUNING = {
  beatRatio: 1.25,
  beatFloor: 42,
  beatCooldownFrames: 8,
  pulseDecay: 0.9,
  particleFloor: 26,
  particleRange: 210,
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

function updateBeat(bass) {
  bassHistory.push(bass);
  if (bassHistory.length > BASS_HISTORY_LEN) bassHistory.shift();
  const avg = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;

  beatCooldown = Math.max(0, beatCooldown - 1);
  if (
    bass > avg * AUDIO_TUNING.beatRatio &&
    bass > AUDIO_TUNING.beatFloor &&
    beatCooldown === 0
  ) {
    beatPulse = 1;
    beatCooldown = AUDIO_TUNING.beatCooldownFrames;
  }
  beatPulse *= AUDIO_TUNING.pulseDecay;
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

function drawBars() {
  const barCount = 96;
  const step = Math.floor(bufferLength / barCount);
  const w = canvas.width / barCount;
  const baseY = canvas.height * 0.75;

  for (let i = 0; i < barCount; i++) {
    const v = Math.pow(freqData[i * step] / 255, 0.82);
    const h = v * canvas.height * 0.6 * (1 + beatPulse * 0.15);
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

function drawRadial() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const baseR =
    Math.min(canvas.width, canvas.height) * 0.16 * (1 + beatPulse * 0.25);
  const barCount = 180;

  for (let i = 0; i < barCount; i++) {
    const idx = Math.floor((i / barCount) * bufferLength * 0.5);
    const v = Math.pow(freqData[idx] / 255, 0.82);
    const len = v * Math.min(canvas.width, canvas.height) * 0.32;
    const angle = (i / barCount) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * baseR;
    const y1 = cy + Math.sin(angle) * baseR;
    const x2 = cx + Math.cos(angle) * (baseR + len);
    const y2 = cy + Math.sin(angle) * (baseR + len);

    const hue = currentHue(i / barCount);
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
  ctx.shadowBlur = 0;
}

function drawWaveform() {
  const midY = canvas.height / 2;
  ctx.lineWidth = 2.5 + beatPulse * 3;
  const hue = currentHue(0);
  ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`;
  ctx.shadowBlur = 16;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.beginPath();
  const slice = canvas.width / bufferLength;
  for (let i = 0; i < bufferLength; i++) {
    // Multiply by 1.8 to amplify the visual height of the waveform
    const v = ((timeData[i] - 128) / 128) * 1.8;
    const y = midY + v * canvas.height * 0.32;
    const x = i * slice;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawParticles(bass, treble) {
  // 1. Organic Variance: Spawn a steady, scaling stream based on bass intensity
  const intensity = Math.min(
    1,
    Math.max(
      0,
      (bass - AUDIO_TUNING.particleFloor) / AUDIO_TUNING.particleRange,
    ),
  );
  if (intensity > 0.1 && Math.random() < intensity) {
    // Spawns 1 to 4 particles organically based on the volume
    spawnParticles(Math.ceil(intensity * 4), bass);
  }

  // 2. Explosive Burst: Huge explosion exactly on the kick drum
  if (beatPulse > 0.8) {
    // Burst amount scales with the power of the bass, and they fly out 50% faster
    spawnParticles(Math.floor(bass / 12), bass * 1.5);
    beatPulse = 0; // Consume the beat pulse immediately so it doesn't spew across multiple frames
  }

  // 3. Keep the list size manageable
  if (particles.length > 1200) particles.splice(0, particles.length - 1200);

  // 4. Update and draw the particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.twinkle += p.twinkleSpeed;
    p.life -= p.decay;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const hue = currentHue(p.hueOffset);
    const shimmer = 0.72 + Math.sin(p.twinkle) * 0.28;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life * 2, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${p.life * shimmer})`;
    ctx.shadowBlur = 8;
    ctx.shadowColor = ctx.fillStyle;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawKaleidoscope() {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const segments = 10;
  const segAngle = (Math.PI * 2) / segments;
  const barCount = 40;

  for (let s = 0; s < segments; s++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s * segAngle);
    if (s % 2 === 1) ctx.scale(1, -1); // mirror alternate segments

    for (let i = 0; i < barCount; i++) {
      const idx = Math.floor((i / barCount) * bufferLength * 0.5);
      const v = Math.min(1, Math.pow(freqData[idx] / 255, 0.82) * 1.2);
      const r1 = 20;
      const r2 =
        20 +
        v *
          Math.min(canvas.width, canvas.height) *
          0.38 *
          (1 + beatPulse * 0.4);
      const a = (i / barCount) * segAngle;
      const hue = currentHue(i / barCount + s / segments);

      ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }
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
  updateBeat(bass);

  if (THEMES[state.theme].colorCycle || THEMES[state.theme].cycle) {
    state.hueShift = (state.hueShift + 0.3 + mid * 0.01) % 360;
  }

  clearFrame(timestamp);
  switch (MODES[state.mode]) {
    case "bars":
      drawBars();
      break;
    case "radial":
      drawRadial();
      break;
    case "waveform":
      drawWaveform();
      break;
    case "particles":
      drawParticles(bass, treble);
      break;
    case "kaleidoscope":
      drawKaleidoscope();
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
  } else if (e.key.toLowerCase() === "c") {
    state.theme = (state.theme + 1) % THEMES.length;
  } else if (e.key.toLowerCase() === "f") {
    window.electronAPI.toggleFullscreen();
  } else if (e.key.toLowerCase() === "t") {
    window.electronAPI.toggleAlwaysOnTop();
  } else if (e.key === " ") {
    state.autoCycle = !state.autoCycle;
    if (state.autoCycle) {
      state.autoCycleTimer = setInterval(() => {
        state.mode = (state.mode + 1) % MODES.length;
      }, 12000);
    } else {
      clearInterval(state.autoCycleTimer);
    }
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
