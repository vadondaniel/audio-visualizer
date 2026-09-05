// ---------- helpers ----------
function currentHue(offset = 0) {
  return computeHue(THEMES[state.theme], state.hueShift, offset);
}

function applyGlow(color, blur) {
  ctx.shadowBlur = blur;
  ctx.shadowColor = color;
}

// ---------- particle system (used by 'particles' mode) ----------
const particles = [];
let trailAge = 0;

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
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

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
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  ctx.lineCap = "round";

  for (let i = 0; i < barCount; i++) {
    const normalized =
      state.radialMode === "full"
        ? i / barCount
        : i < halfCount
          ? i / halfCount
          : (barCount - i - 1) / halfCount;
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

const bandSpawnAccum = [0, 0, 0];
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
    })
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
      })
    );
  }
}

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
const smoothedKaleido = new Array(KALEIDO_BARS).fill(0);
let kaleidoFlash = 0;

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

  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  for (let s = 0; s < segments; s++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s * segAngle + kaleidoRotation);
    const mirrored = s % 2 === 1;

    for (let i = 0; i < KALEIDO_BARS; i++) {
      const raw = bandAverage(
        freqData,
        KALEIDO_BAND_EDGES[i],
        KALEIDO_BAND_EDGES[i + 1]
      );
      const tilt = 1 + (i / KALEIDO_BARS) * 1.6;
      const rawV = Math.pow((raw / 255) * tilt, 0.7);
      const targetV = state.kaleidoClipEnabled ? Math.min(1, rawV) : rawV;
      smoothedKaleido[i] = smoothTowards(
        smoothedKaleido[i],
        targetV,
        remaining
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

  // AudioContext suspension is easy to miss because requestAnimationFrame
  // continues running and the analyser simply returns silence.
  if (audioCtx && audioCtx.state !== "running") {
    recoverAudioCapture();
    return;
  }

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
    AUDIO_TUNING.particleRange
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
