// ---------- helpers ----------
function currentHue(offset = 0) {
  return computeHue(THEMES[state.theme], state.hueShift, offset);
}

function applyGlow(color, blur) {
  const scaled = blur * state.glowIntensity;
  ctx.shadowBlur = scaled;
  ctx.shadowColor = scaled > 0 ? color : "transparent";
}

// ---------- particle system (used by 'particles' mode) ----------
const particles = [];
const trailFrames = [];
const trailCanvasPool = [];
let lastTrailCaptureMs = null;

// ---------- draw modes ----------
function resetTrailHistory() {
  trailFrames.length = 0;
  trailCanvasPool.length = 0;
  lastTrailCaptureMs = null;
}

function clearFrame() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, renderCanvas.width, renderCanvas.height);
  ctx.restore();
}

function takeTrailCanvas() {
  const frameCanvas = trailCanvasPool.pop() || document.createElement("canvas");
  if (
    frameCanvas.width !== renderCanvas.width ||
    frameCanvas.height !== renderCanvas.height
  ) {
    frameCanvas.width = renderCanvas.width;
    frameCanvas.height = renderCanvas.height;
  }
  return frameCanvas;
}

function discardExpiredTrailFrames(timestamp) {
  while (
    trailFrames.length &&
    TrailMath.isTrailFrameExpired(
      timestamp,
      trailFrames[0].timestamp,
      state.trailDuration
    )
  ) {
    trailCanvasPool.push(trailFrames.shift().canvas);
  }
}

function captureTrailFrame(timestamp) {
  if (trailFrames.length >= TRAIL_MAX_SNAPSHOTS) {
    trailCanvasPool.push(trailFrames.shift().canvas);
  }
  const frameCanvas = takeTrailCanvas();
  const frameCtx = frameCanvas.getContext("2d");
  frameCtx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
  frameCtx.drawImage(renderCanvas, 0, 0);
  trailFrames.push({ canvas: frameCanvas, timestamp });
  lastTrailCaptureMs = timestamp;
}

function renderTrailHistory(timestamp) {
  if (!state.trailsEnabled) {
    resetTrailHistory();
    displayCtx.save();
    displayCtx.setTransform(1, 0, 0, 1, 0, 0);
    displayCtx.globalAlpha = 1;
    displayCtx.clearRect(0, 0, canvas.width, canvas.height);
    displayCtx.drawImage(renderCanvas, 0, 0);
    displayCtx.restore();
    return;
  }

  discardExpiredTrailFrames(timestamp);
  const shouldCapture = TrailMath.shouldCaptureTrail(
    timestamp,
    lastTrailCaptureMs,
    state.trailDuration,
    TRAIL_MAX_SNAPSHOTS
  );
  if (shouldCapture) captureTrailFrame(timestamp);

  displayCtx.save();
  displayCtx.setTransform(1, 0, 0, 1, 0, 0);
  displayCtx.globalCompositeOperation = "source-over";
  displayCtx.globalAlpha = 1;
  displayCtx.clearRect(0, 0, canvas.width, canvas.height);
  for (const frame of trailFrames) {
    displayCtx.globalAlpha = TrailMath.trailOpacity(
      timestamp - frame.timestamp,
      state.trailDuration
    );
    displayCtx.drawImage(frame.canvas, 0, 0);
  }
  if (!shouldCapture) {
    displayCtx.globalAlpha = 1;
    displayCtx.drawImage(renderCanvas, 0, 0);
  }
  displayCtx.restore();
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

  const isCenter = state.barsAlignment === "center";
  const centerY = canvas.height / 2;

  for (let i = 0; i < barCount; i++) {
    const targetV = applyValueHandling(
      freqData[i * step] / 255,
      state.valueHandling
    );
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

    if (isCenter) {
      const halfH = h * 0.68;
      ctx.fillRect(i * w, centerY - halfH, w * 0.8, halfH * 2);
    } else {
      ctx.fillRect(i * w, baseY - h, w * 0.8, h);
      // mirrored reflection below
      ctx.globalAlpha = 0.25;
      ctx.fillRect(i * w, baseY, w * 0.8, h * 0.35);
      ctx.globalAlpha = 1;
    }
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
    const targetV = applyValueHandling(
      freqData[idx] / 255,
      state.valueHandling
    );
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

  const stops = 6;
  const makeWaveformGradient = (alpha) => {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    for (let s = 0; s <= stops; s++) {
      gradient.addColorStop(
        s / stops,
        `hsla(${currentHue(s / stops)}, 90%, 60%, ${alpha})`
      );
    }
    return gradient;
  };

  const grad = makeWaveformGradient(1);
  ctx.strokeStyle = grad;
  const waveformTheme = THEMES[state.theme];
  const strokeWaveform = () => {
    if (waveformTheme.rainbow && state.glowIntensity > 0) {
      // Canvas shadows only accept one color. Blur the actual rainbow stroke
      // instead, so every part of the glow keeps the color of its outline.
      ctx.save();
      ctx.filter = `blur(${6 * state.glowIntensity}px)`;
      ctx.globalAlpha = Math.min(1, 0.65 * state.glowIntensity);
      ctx.lineWidth += 5 * state.glowIntensity;
      ctx.stroke();
      ctx.restore();
    }
    ctx.stroke();
  };

  if (waveformTheme.rainbow) {
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  } else {
    applyGlow(`hsl(${currentHue(0.5)}, 90%, 60%)`, 16);
  }

  const slice = canvas.width / bufferLength;
  const amp = 1.35 + midLevel * 0.35 + trebleLevel * 0.2 + bassLevel * 0.25;
  const buildWaveformPath = (reflected = false) => {
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const raw = (timeData[i] - 128) / 128;
      const direction = reflected ? -1 : 1;
      const y = midY + direction * raw * amp * canvas.height * 0.32;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };

  if (state.waveformStyle === "filled") {
    // Upper ribbon fill
    buildWaveformPath();
    ctx.lineTo(canvas.width, midY);
    ctx.lineTo(0, midY);
    ctx.closePath();
    ctx.fillStyle = makeWaveformGradient(0.22);
    ctx.fill();
    buildWaveformPath();
    strokeWaveform();

    // Symmetrical lower reflected harmonic ribbon
    buildWaveformPath(true);
    ctx.lineTo(canvas.width, midY);
    ctx.lineTo(0, midY);
    ctx.closePath();
    ctx.fillStyle = makeWaveformGradient(0.12);
    ctx.fill();
    buildWaveformPath(true);
    strokeWaveform();
  } else {
    buildWaveformPath();
    strokeWaveform();
  }
  ctx.shadowBlur = 0;
}

const bandSpawnAccum = [0, 0, 0];
const energyHistory = [];
const PARTICLE_STYLES = {
  flow: {
    size: 1.0,
    speed: 1.0,
    spread: 1.0,
    orbit: 0.85,
    burst: 1.0,
    life: 1.0,
  },
  burst: {
    size: 1.22,
    speed: 1.28,
    spread: 0.72,
    orbit: 0.25,
    burst: 2.1,
    life: 0.82,
  },
  vortex: {
    size: 0.88,
    speed: 0.78,
    spread: 1.18,
    orbit: 2.35,
    burst: 0.65,
    life: 1.22,
  },
};

function getParticleStyle() {
  return PARTICLE_STYLES[state.particleStyle] || PARTICLE_STYLES.flow;
}

const particleShockwaves = [];
let energyNow = 0;
let energyTrend = 0;
let particlePhase = 0;

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
  orbitStrength = 0,
  outwardBias = 1,
  z = 0.5,
}) {
  return {
    x,
    y,
    px: x,
    py: y,
    vx: Math.cos(angle) * speed * outwardBias,
    vy: Math.sin(angle) * speed * outwardBias,
    life: 1,
    decay,
    drag,
    size,
    orbitStrength,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed:
      twinkleSpeed !== undefined ? twinkleSpeed : 0.08 + Math.random() * 0.16,
    hueOffset,
    z,
  };
}

function spawnBandParticle(band, energyRatio) {
  const style = getParticleStyle();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const angle = Math.random() * Math.PI * 2;
  const spawnRadius =
    Math.pow(Math.random(), 2.2) *
    Math.min(canvas.width, canvas.height) *
    0.035 *
    style.spread;
  const tangentBias =
    band === PARTICLE_BANDS[2]
      ? 0.32
      : band === PARTICLE_BANDS[1]
        ? 0.18
        : 0.08;
  const speed =
    (1.3 + Math.random() * 5.4) *
    band.speedMul *
    style.speed *
    (0.55 + energyRatio * 1.9);
  const x = cx + Math.cos(angle) * spawnRadius;
  const y = cy + Math.sin(angle) * spawnRadius;
  particles.push(
    makeParticle({
      x,
      y,
      angle,
      speed,
      decay: ((0.006 + Math.random() * 0.012) * band.decayMul) / style.life,
      drag: 0.972 + Math.random() * 0.022,
      size:
        (1.35 + Math.random() * 3.9) *
        band.sizeMul *
        style.size *
        (0.72 + energyRatio * 0.9),
      hueOffset: band.hueT + (Math.random() - 0.5) * 0.08,
      orbitStrength: tangentBias * (0.65 + energyRatio * 1.7) * style.orbit,
      outwardBias: 0.65 + Math.random() * 0.55,
      z: 0.25 + Math.random() * 0.75,
    })
  );
}

function spawnBeatRing(bass, bassLevel) {
  const style = getParticleStyle();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const count = Math.max(8, Math.floor((bass / 4.2) * style.burst));
  const speed = 4.2 + bassLevel * 7.5;
  const rotation = particlePhase * 0.7;

  particleShockwaves.push({
    radius: Math.min(canvas.width, canvas.height) * 0.045,
    speed: 7 + bassLevel * 13,
    life: 1,
    width: 2.5 + bassLevel * 5,
    hueOffset: 0.5,
  });

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rotation;
    particles.push(
      makeParticle({
        x: cx,
        y: cy,
        angle,
        speed: speed * (0.86 + Math.random() * 0.26) * style.speed,
        decay: (0.014 + Math.random() * 0.008) / style.life,
        drag: 0.957 + Math.random() * 0.014,
        size: (2.4 + Math.random() * 2.8 + bassLevel * 2) * style.size,
        hueOffset: 0.03 + (Math.random() - 0.5) * 0.12,
        twinkleSpeed: 0.16 + Math.random() * 0.1,
        orbitStrength: (0.08 + Math.random() * 0.14) * style.orbit,
        outwardBias: 1,
        z: 0.7 + Math.random() * 0.3,
      })
    );
  }
}

function drawParticleSpectrum(bassLevel, midLevel, trebleLevel, radius) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const dots = 110;
  const energy = bassLevel * 0.55 + midLevel * 0.3 + trebleLevel * 0.15;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < dots; i++) {
    const t = i / dots;
    const sample = Math.min(
      bufferLength - 1,
      Math.floor(t * bufferLength * 0.42)
    );
    const v = applyValueHandling(freqData[sample] / 255, state.valueHandling);
    const angle = t * Math.PI * 2 + particlePhase * (0.025 + energy * 0.02);
    const wobble = 1 + Math.sin(particlePhase * 1.4 + i * 1.73) * 0.055;
    const dist = radius * (1.05 + v * (0.75 + energy * 1.3)) * wobble;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const r = 0.45 + v * 1.25 + trebleLevel * 0.45;
    const alpha = 0.14 + v * 0.34 + energy * 0.08;
    const hue = currentHue(t + particlePhase * 0.006);

    ctx.fillStyle = `hsla(${hue}, 96%, 72%, ${Math.min(0.65, alpha)})`;
    if (r > 1.2) applyGlow(ctx.fillStyle, 4 + v * 5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function drawParticleCore(bassLevel, midLevel, trebleLevel, energy) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const minDim = Math.min(canvas.width, canvas.height);
  const pulse = 0.55 + energy * 0.75 + beatPulse * 0.95;
  const coreR = minDim * (0.028 + pulse * 0.022);
  const haloR = coreR * (3.8 + midLevel * 2.8 + beatPulse * 3.5);
  const hue = currentHue(0.48);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  halo.addColorStop(0, `hsla(${hue}, 100%, 86%, ${0.5 + energy * 0.22})`);
  halo.addColorStop(0.08, `hsla(${hue}, 100%, 70%, ${0.26 + energy * 0.24})`);
  halo.addColorStop(
    0.32,
    `hsla(${currentHue(0.18)}, 95%, 58%, ${0.08 + midLevel * 0.11})`
  );
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2);

  for (let ring = 0; ring < 3; ring++) {
    const r = coreR * (1.9 + ring * 1.85 + beatPulse * (1.2 + ring * 0.7));
    ctx.strokeStyle = `hsla(${currentHue(0.48 + ring * 0.1)}, 100%, 72%, ${0.16 + energy * 0.14 - ring * 0.035})`;
    ctx.lineWidth = 1.1 + beatPulse * (1.3 - ring * 0.25);
    applyGlow(ctx.strokeStyle, 7 + beatPulse * 5);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, "rgba(255, 255, 255, 0.96)");
  core.addColorStop(0.16, `hsla(${hue}, 100%, 86%, 0.96)`);
  core.addColorStop(
    0.62,
    `hsla(${currentHue(0.82)}, 100%, 62%, ${0.72 + beatPulse * 0.18})`
  );
  core.addColorStop(1, `hsla(${currentHue(0.15)}, 100%, 48%, 0)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawParticles(bass, bassLevel, midLevel, trebleLevel, elapsedMs) {
  const dt = elapsedMs / FRAME_MS;
  particlePhase += dt * (0.55 + trebleLevel * 1.9 + beatPulse * 1.4);

  const rawEnergy = applyValueHandling(
    bassLevel * 0.48 + midLevel * 0.3 + trebleLevel * 0.22,
    state.valueHandling
  );

  energyHistory.push({ value: rawEnergy, t: audioClockMs });
  while (
    energyHistory.length &&
    audioClockMs - energyHistory[0].t > ENERGY_HISTORY_MS
  ) {
    energyHistory.shift();
  }
  let histMin = 1;
  let histMax = 0;
  for (const e of energyHistory) {
    if (e.value < histMin) histMin = e.value;
    if (e.value > histMax) histMax = e.value;
  }
  const span = Math.max(0.08, histMax - histMin);
  const normalized = Math.min(1, Math.max(0, (rawEnergy - histMin) / span));

  const fastFactor = normalized > energyNow ? 0.55 : 0.23;
  energyNow += (normalized - energyNow) * Math.min(1, fastFactor * dt);
  energyTrend += (normalized - energyTrend) * Math.min(1, 0.06 * dt);

  const levels = [bassLevel, midLevel, trebleLevel];
  const SPAWN_RATE = 88 * Math.pow(state.particleDensity, 1.15);
  const AMBIENT_FLOOR = 0.045;
  for (let b = 0; b < 3; b++) {
    const rate =
      (AMBIENT_FLOOR + levels[b] * (b === 0 ? 0.95 : 1.15)) * SPAWN_RATE;
    bandSpawnAccum[b] += rate * (dt / 60);
    while (bandSpawnAccum[b] >= 1) {
      spawnBandParticle(PARTICLE_BANDS[b], levels[b]);
      bandSpawnAccum[b] -= 1;
    }
  }

  if (beatJustHit) {
    spawnBeatRing(bass, bassLevel);
    beatJustHit = false;
  }

  const decayScale = 1.55 - energyTrend * 0.9;
  const style = getParticleStyle();
  const speedScale = (0.28 + energyNow * 2.95) * style.speed;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const minDim = Math.min(canvas.width, canvas.height);

  // Large bass hits create a subtle expanding shockwave independently of the particles.
  for (let i = particleShockwaves.length - 1; i >= 0; i--) {
    const wave = particleShockwaves[i];
    wave.radius += wave.speed * dt;
    wave.speed *= Math.pow(0.985, dt);
    wave.life -= (0.011 + (wave.radius / minDim) * 0.006) * dt;
    if (wave.life <= 0) {
      particleShockwaves.splice(i, 1);
      continue;
    }
    const hue = currentHue(wave.hueOffset);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = `hsla(${hue}, 95%, 70%, ${Math.min(0.42, wave.life * 0.55)})`;
    ctx.lineWidth = wave.width * wave.life;
    applyGlow(ctx.strokeStyle, 12 + wave.life * 9);
    ctx.beginPath();
    ctx.arc(cx, cy, wave.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  const coreRadius = minDim * (0.055 + energyNow * 0.032 + beatPulse * 0.045);
  // Keep the reactive structure deliberately understated so the particles remain the subject.
  drawParticleSpectrum(bassLevel, midLevel, trebleLevel, coreRadius * 1.25);

  const overCap = particles.length - VISUAL_TUNING.particles.cap;
  if (overCap > 0) {
    const trim = 0.055 * dt;
    for (let i = 0; i < overCap; i++) particles[i].life -= trim;
  }

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.px = p.x;
    p.py = p.y;

    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const nx = dx / dist;
    const ny = dy / dist;
    const tangentX = -ny;
    const tangentY = nx;
    const vortex =
      p.orbitStrength *
      (0.8 + Math.min(2.5, 180 / dist)) *
      (0.7 + energyNow * 1.8);
    p.vx += (nx * 0.018 + tangentX * vortex) * dt;
    p.vy += (ny * 0.018 + tangentY * vortex) * dt;

    // Pull particles very slightly back toward the field center instead of letting
    // a few loud notes permanently eject them off-screen.
    const returnForce =
      Math.min(0.11, (dist / minDim) * 0.065) * (0.75 + energyNow);
    p.vx -= nx * returnForce * dt;
    p.vy -= ny * returnForce * dt;

    p.x += p.vx * speedScale * dt;
    p.y += p.vy * speedScale * dt;
    p.vx *= Math.pow(p.drag, dt);
    p.vy *= Math.pow(p.drag, dt);
    p.twinkle += p.twinkleSpeed * dt * (1 + trebleLevel * 2.5);
    p.life -= p.decay * decayScale * dt;

    // Respawn long-lived ambience before it has enough time to visibly clump at an edge.
    const margin = minDim * 0.13;
    if (
      p.x < -margin ||
      p.x > canvas.width + margin ||
      p.y < -margin ||
      p.y > canvas.height + margin
    ) {
      p.life *= 0.55;
    }

    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }

    const theme = THEMES[state.theme];
    let hueOffset = p.hueOffset + p.z * 0.02;
    if (theme.rainbow) {
      // A plain rainbow offset gave the three particle bands only a few
      // dominant hues (roughly red/cyan/magenta). Spread the spectrum over
      // each particle's actual position instead, with a small depth/band
      // perturbation so nearby particles still form coherent color clusters.
      const angle01 =
        (Math.atan2(p.y - cy, p.x - cx) + Math.PI) / (Math.PI * 2);
      const radius01 = Math.min(
        1,
        Math.hypot(p.x - cx, p.y - cy) / (minDim * 0.72)
      );
      hueOffset =
        angle01 * 0.72 +
        radius01 * 0.18 +
        p.hueOffset * 0.1 +
        p.z * 0.07 +
        particlePhase * 0.0015;
    }
    const hue = currentHue(hueOffset);
    const shimmer = 0.72 + Math.sin(p.twinkle) * 0.28;
    const depthScale = 0.58 + p.z * 0.72;
    const r =
      p.size * depthScale * (0.28 + energyNow * 1.15) * (0.58 + p.life * 0.62);
    const alpha =
      p.life * shimmer * (0.48 + energyNow * 0.92) * (0.72 + p.z * 0.35);
    const glow = r > 2.0 && alpha > 0.16;

    const rainbowBoost = theme.rainbow
      ? 4 + Math.sin(((hue * Math.PI) / 180) * 3) * 3
      : 0;
    const lightness = Math.min(
      84,
      66 + p.z * 16 + rainbowBoost + trebleLevel * 4
    );
    const saturation = theme.rainbow
      ? Math.min(100, 88 + p.z * 8 + trebleLevel * 4)
      : 96;

    const particleAlpha = Math.min(1, alpha);

    // Rainbow particles need separation on pale backgrounds, but a black
    // contour looks unnatural on dark backgrounds. Use the particle's own
    // hue at a deeper value instead: it reads as chromatic depth rather than
    // an outline, and remains compatible with both light and dark surfaces.
    if (theme.rainbow) {
      const rimLightness = Math.max(24, lightness - 34);
      const rimAlpha = Math.min(0.52, 0.1 + particleAlpha * 0.22);
      ctx.shadowBlur = 0;
      ctx.fillStyle = `hsla(${hue}, ${Math.min(100, saturation + 4)}%, ${rimLightness}%, ${rimAlpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + Math.max(0.55, r * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }

    if (r > 2.2) {
      if (theme.rainbow) {
        const trailRimAlpha = Math.min(0.34, 0.06 + particleAlpha * 0.12);
        ctx.strokeStyle = `hsla(${hue}, ${Math.min(100, saturation + 2)}%, ${Math.max(22, lightness - 30)}%, ${trailRimAlpha})`;
        ctx.lineWidth = Math.max(1.1, r * 0.8);
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.strokeStyle = `hsla(${hue}, 92%, 68%, ${Math.min(0.38, alpha * 0.45)})`;
      ctx.lineWidth = Math.max(0.55, r * 0.55);
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${particleAlpha})`;
    if (glow) applyGlow(ctx.fillStyle, 5 + r * 2.8);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Tiny specular point helps the particles read as luminous points rather
    // than flat colored blobs, especially when the background is near-white.
    if (theme.rainbow && r > 2.6 && particleAlpha > 0.35) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.48, particleAlpha * 0.42)})`;
      ctx.beginPath();
      ctx.arc(
        p.x - r * 0.22,
        p.y - r * 0.22,
        Math.max(0.45, r * 0.16),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    if (r > 4.8 && alpha > 0.55) {
      ctx.strokeStyle = `hsla(${currentHue(p.hueOffset + 0.35)}, 100%, 82%, ${Math.min(0.5, alpha * 0.45)})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x - r * 1.8, p.y);
      ctx.lineTo(p.x + r * 1.8, p.y);
      ctx.moveTo(p.x, p.y - r * 1.8);
      ctx.lineTo(p.x, p.y + r * 1.8);
      ctx.stroke();
    }
  }

  ctx.restore();
  drawParticleCore(bassLevel, midLevel, trebleLevel, energyNow);
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
      const handled = applyValueHandling(raw / 255, state.valueHandling);
      const rawV = Math.pow(handled * tilt, 0.7);
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

// ---------- Cyber Tunnel mode (spatial, audio-dimensional tunnel) ----------
let tunnelTravel = 0;
let tunnelTwist = 0;
let tunnelAngle = 0;
let tunnelPulse = 0;
let tunnelPulsePhase = 0;
let tunnelBassSmoothed = 0;
let tunnelMidSmoothed = 0;
let tunnelTrebleSmoothed = 0;
let tunnelBassPrev = 0;
let tunnelMidPrev = 0;
let tunnelTreblePrev = 0;
let tunnelDropPulses = [];
let tunnelDropCooldown = 0;

const TUNNEL_RINGS = 34;
const TUNNEL_SEGMENTS = 48;
const tunnelGrid = Array.from(
  { length: TUNNEL_RINGS },
  () => new Float32Array(TUNNEL_SEGMENTS)
);

function drawTunnel(bassLevel, midLevel, trebleLevel, dtSec) {
  const remaining = state.smoothingEnabled
    ? Math.exp(-VISUAL_TUNING.tunnel.releasePerSec * dtSec)
    : 0;
  const time = performance.now() * 0.001;

  tunnelBassSmoothed = smoothTowards(tunnelBassSmoothed, bassLevel, remaining);
  tunnelMidSmoothed = smoothTowards(tunnelMidSmoothed, midLevel, remaining);
  tunnelTrebleSmoothed = smoothTowards(
    tunnelTrebleSmoothed,
    trebleLevel,
    remaining
  );

  const bass = tunnelBassSmoothed;
  const mids = tunnelMidSmoothed;
  const treble = tunnelTrebleSmoothed;

  // Deliberate three-territory response: dormant, active, and peak each occupy
  // a broad region of the input range. The functions remain continuous inside
  // each territory, so the tunnel keeps scaling instead of behaving like a switch.
  const territory = (v, lo, hi) => {
    const x = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return x * x * (3 - 2 * x);
  };
  const dormantBass = territory(bass, 0.0, 0.34);
  const activeBass = territory(bass, 0.24, 0.72);
  const peakBass = territory(bass, 0.58, 1.0);
  const dormantMids = territory(mids, 0.0, 0.36);
  const activeMids = territory(mids, 0.27, 0.7);
  const peakMids = territory(mids, 0.56, 1.0);
  const dormantTreble = territory(treble, 0.0, 0.32);
  const activeTreble = territory(treble, 0.23, 0.68);
  const peakTreble = territory(treble, 0.56, 1.0);

  // Preserve strong musical drops as separate transient energy. This is additive
  // to the three territories rather than replacing them with a single intensity.
  const bassAttack = Math.max(0, (bass - tunnelBassPrev) * 18);
  const midAttack = Math.max(0, (mids - tunnelMidPrev) * 18);
  const trebleAttack = Math.max(0, (treble - tunnelTreblePrev) * 18);
  tunnelBassPrev = bass;
  tunnelMidPrev = mids;
  tunnelTreblePrev = treble;

  const beat = Math.pow(Math.max(0, beatPulse), 0.68);
  const drop = Math.min(
    1.8,
    Math.max(0, bassAttack * 0.48 + midAttack * 0.28 + trebleAttack * 0.22)
  );
  tunnelPulse = Math.max(
    tunnelPulse * Math.exp(-6.4 * dtSec),
    beat * 0.72,
    Math.min(1, drop)
  );

  // Drops are discrete spatial events layered over the continuous tunnel motion.
  // A strong rising transient launches a bright pulse from the viewer's side of
  // the tunnel toward the vanishing point. The cooldown prevents sustained loud
  // passages from turning into a permanent pulse train.
  tunnelDropCooldown = Math.max(0, tunnelDropCooldown - dtSec);
  const dropStrength = Math.min(1, drop * 0.92 + beat * 0.34);
  if (tunnelDropCooldown <= 0 && dropStrength > 0.22) {
    tunnelDropPulses.push({
      phase: 0.98,
      strength: dropStrength,
      width: 0.042,
    });
    if (dropStrength > 0.62) {
      tunnelDropPulses.push({
        phase: 0.94,
        strength: dropStrength * 0.58,
        width: 0.07,
      });
    }
    tunnelDropCooldown = 0.16 + (1 - dropStrength) * 0.26;
  }
  for (const pulse of tunnelDropPulses) {
    pulse.phase -= dtSec * (0.38 + pulse.strength * 0.72);
    pulse.width = Math.min(0.13, pulse.width + dtSec * 0.02);
    pulse.strength *= Math.exp(-0.18 * dtSec);
  }
  tunnelDropPulses = tunnelDropPulses.filter(
    (pulse) => pulse.phase > -0.08 && pulse.strength > 0.03
  );

  // Each frequency dimension owns different spatial qualities. The territories
  // make dormant/active/peak perceptually distinct without hard on/off gates.
  const travelSpeed =
    0.02 +
    dormantBass * 0.08 +
    activeBass * 0.23 +
    peakBass * 0.34 +
    bassAttack * 0.11 +
    mids * 0.055 +
    treble * 0.018 +
    beat * (0.05 + bass * 0.12);
  tunnelTravel = (tunnelTravel + travelSpeed * dtSec) % 1;

  tunnelTwist +=
    (0.004 +
      dormantTreble * 0.055 +
      activeTreble * 0.18 +
      peakTreble * 0.34 +
      trebleAttack * 0.2) *
    dtSec;
  tunnelAngle +=
    (0.0015 +
      dormantTreble * 0.02 +
      activeTreble * 0.055 +
      peakTreble * 0.115 +
      activeMids * 0.025 +
      trebleAttack * 0.045) *
    dtSec;
  tunnelPulsePhase =
    (tunnelPulsePhase +
      (0.1 + dormantBass * 0.12 + activeBass * 0.32 + peakBass * 0.66) *
        dtSec) %
    1;

  const W = canvas.width;
  const H = canvas.height;
  const minDim = Math.min(W, H);
  const diagonal = Math.hypot(W, H);
  const cx =
    W * 0.5 + Math.sin(time * 0.24 + tunnelTwist * 0.45) * minDim * 0.004;
  const cy =
    H * 0.5 + Math.cos(time * 0.21 + tunnelTwist * 0.31) * minDim * 0.003;

  // The overall tunnel remains large at all times. Bass changes its physical
  // breathing and perspective instead of switching the tunnel on/off.
  const farRadius = minDim * (0.018 + dormantBass * 0.012 + activeBass * 0.018);
  const nearRadius =
    diagonal *
    (0.64 +
      dormantBass * 0.025 +
      activeBass * 0.08 +
      peakBass * 0.17 +
      drop * 0.035);

  const broadDeform =
    0.008 +
    dormantMids * 0.035 +
    activeMids * 0.085 +
    peakMids * 0.16 +
    midAttack * 0.055;
  const fineDeform =
    0.003 +
    dormantTreble * 0.012 +
    activeTreble * 0.028 +
    peakTreble * 0.062 +
    trebleAttack * 0.018;
  const twistAmount =
    0.035 +
    dormantTreble * 0.16 +
    activeTreble * 0.42 +
    peakTreble * 0.92 +
    trebleAttack * 0.18;
  const verticalScale =
    0.96 +
    dormantBass * 0.018 +
    activeBass * 0.045 +
    peakBass * 0.085 +
    mids * 0.035;

  const rings = [];

  // A few broad spectral buckets give the walls several simultaneous, graded
  // responses rather than making all of the detail follow the same three values.
  const spectralBands = 12;
  const spectral = new Float32Array(spectralBands);
  for (let b = 0; b < spectralBands; b++) {
    const lo = 0.008 + (b / spectralBands) ** 1.55 * 0.46;
    const hi = 0.012 + ((b + 1) / spectralBands) ** 1.55 * 0.46;
    const raw = Math.pow(
      applyValueHandling(
        bandAverage(freqData, lo, hi) / 255,
        state.valueHandling
      ),
      0.86
    );
    spectral[b] = smoothTowards(spectral[b], raw, remaining);
  }

  for (let r = 0; r < TUNNEL_RINGS; r++) {
    const phase = (r / TUNNEL_RINGS + tunnelTravel) % 1;
    const depth = Math.pow(phase, 1.28);
    const depthEase = depth * depth * (3 - 2 * depth);
    const radius =
      farRadius + (nearRadius - farRadius) * depthEase * (1 + bass * 0.035);
    const rotation =
      tunnelAngle +
      (1 - depth) * twistAmount * 0.72 +
      tunnelTwist * (0.035 + treble * 0.075);
    const points = [];

    for (let seg = 0; seg < TUNNEL_SEGMENTS; seg++) {
      const norm = seg / TUNNEL_SEGMENTS;
      const angle = norm * Math.PI * 2 + rotation;
      const band = Math.min(
        spectralBands - 1,
        Math.floor(norm * spectralBands)
      );
      const localSpectrum = spectral[band];

      const broadWave =
        Math.sin(
          seg * (0.34 + mids * 0.42) +
            phase * (4.5 + mids * 7) +
            time * (0.5 + mids * 1.15) +
            tunnelTwist * 0.28
        ) * broadDeform;
      const secondaryWave =
        Math.sin(
          seg * 1.3 -
            phase * (2.8 + mids * 4.5) -
            time * 0.35 +
            tunnelTwist * 0.12
        ) *
        mids *
        0.048;
      const fineWave =
        Math.sin(
          seg * (2.0 + treble * 2.8) +
            phase * (8 + treble * 8) -
            time * (0.65 + treble * 2.4) +
            tunnelTwist
        ) * fineDeform;
      const spectralWave =
        (localSpectrum - 0.24) * (0.012 + mids * 0.11 + treble * 0.035);

      const beatDistance = Math.abs(phase - tunnelPulsePhase);
      const beatFront =
        tunnelPulse * Math.exp(-Math.pow(beatDistance / 0.075, 2));
      const beatWarp = beatFront * (0.018 + bass * 0.045);

      const radiusWarp =
        1 + broadWave + secondaryWave + fineWave + spectralWave + beatWarp;
      const radial =
        radius *
        radiusWarp *
        (1 + Math.sin(phase * 5.4 + tunnelTwist * 0.3) * treble * 0.02);

      points.push({
        x: cx + Math.cos(angle) * radial,
        y:
          cy +
          Math.sin(angle) * radial * verticalScale +
          Math.sin(angle * 2 + phase * 5) * radius * mids * 0.018,
        v: localSpectrum,
        beatFront,
      });
    }

    rings.push({ phase, depth, points });
  }

  // Filled wall facets provide a readable tunnel surface. Their opacity varies
  // continuously with depth, local spectrum and the mids/treble content.
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r];
    const b = rings[r + 1];
    const depthVisibility = 0.12 + a.depth * 0.52;

    for (let seg = 0; seg < TUNNEL_SEGMENTS; seg++) {
      const next = (seg + 1) % TUNNEL_SEGMENTS;
      const local = (a.points[seg].v + a.points[next].v + b.points[seg].v) / 3;
      const structure =
        0.22 +
        local * 0.4 +
        dormantMids * 0.07 +
        activeMids * 0.16 +
        peakMids * 0.28 +
        dormantTreble * 0.03 +
        activeTreble * 0.06 +
        peakTreble * 0.11 +
        a.points[seg].beatFront * (0.2 + drop * 0.12);
      const alpha = Math.min(
        0.34,
        (0.075 + structure * 0.34) * depthVisibility
      );

      const hue = currentHue((seg / TUNNEL_SEGMENTS) * 0.88 + a.phase * 0.12);
      ctx.fillStyle = `hsla(${hue}, 82%, ${42 + treble * 10}%, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(a.points[seg].x, a.points[seg].y);
      ctx.lineTo(a.points[next].x, a.points[next].y);
      ctx.lineTo(b.points[next].x, b.points[next].y);
      ctx.lineTo(b.points[seg].x, b.points[seg].y);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // Longitudinal ribs: always present, with continuous amplitude and density
  // changes as treble rises.
  const railCount = Math.round(
    9 + dormantTreble * 6 + activeTreble * 14 + peakTreble * 20
  );
  ctx.save();
  ctx.lineCap = "round";
  for (let rail = 0; rail < railCount; rail++) {
    const seg = Math.floor((rail / railCount) * TUNNEL_SEGMENTS);
    const hue = currentHue((rail / railCount) * 0.95 + treble * 0.08);
    let previous = null;
    let averageEnergy = 0;

    ctx.beginPath();
    for (const ring of rings) {
      const pt = ring.points[seg];
      if (previous) {
        ctx.moveTo(previous.x, previous.y);
        ctx.lineTo(pt.x, pt.y);
      }
      previous = pt;
      averageEnergy += pt.v;
    }

    averageEnergy /= rings.length;
    const railEnergy =
      0.28 +
      averageEnergy * 0.46 +
      dormantTreble * 0.08 +
      activeTreble * 0.18 +
      peakTreble * 0.34 +
      activeMids * 0.08 +
      trebleAttack * 0.07;

    ctx.strokeStyle = `hsla(${hue}, 88%, ${51 + treble * 10}%, ${Math.min(0.9, railEnergy)})`;
    ctx.lineWidth = 0.8 + treble * 1.7 + averageEnergy * 1.4;
    applyGlow(ctx.strokeStyle, 1 + treble * 2.8);
    ctx.stroke();
  }
  ctx.restore();

  // Depth rings remain the strongest spatial cue. Bass changes scale/weight,
  // treble changes their crispness, and local spectrum gives each ring its own
  // level instead of making the whole tunnel breathe in lockstep.
  ctx.save();
  ctx.lineJoin = "round";
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    const depth = ring.depth;
    const localEnergy =
      ring.points.reduce((sum, point) => sum + point.v, 0) / ring.points.length;
    const visibility = 0.18 + depth * 0.82;
    const alpha = Math.min(
      0.98,
      0.26 +
        visibility * 0.34 +
        localEnergy * 0.24 +
        dormantBass * 0.06 +
        activeBass * 0.1 +
        peakBass * 0.18 +
        dormantMids * 0.03 +
        activeMids * 0.08 +
        peakMids * 0.14 +
        ring.points[0].beatFront * 0.42 +
        drop * 0.12
    );
    const hue = currentHue(ring.phase * 0.82 + localEnergy * 0.18);

    ctx.beginPath();
    for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
      const pt = ring.points[seg % TUNNEL_SEGMENTS];
      if (seg === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsla(${hue}, 92%, ${54 + treble * 10}%, ${alpha})`;
    ctx.lineWidth =
      0.85 +
      depth * 1.35 +
      localEnergy * 1.0 +
      dormantBass * 0.25 +
      activeBass * 0.55 +
      peakBass * 0.95 +
      dormantMids * 0.12 +
      activeMids * 0.28 +
      peakMids * 0.48 +
      ring.points[0].beatFront * (1.4 + drop * 1.2);
    applyGlow(ctx.strokeStyle, 1 + visibility * 2.4 + treble * 1.8);
    ctx.stroke();
  }
  ctx.restore();

  // Beat pulses: the regular beat can still highlight one ring, while a real
  // drop gets its own travelling wavefront that visibly moves through depth.
  if (tunnelPulse > 0.06) {
    let nearest = null;
    let nearestDelta = Infinity;
    for (const ring of rings) {
      const delta = Math.abs(ring.phase - tunnelPulsePhase);
      if (delta < nearestDelta) {
        nearest = ring;
        nearestDelta = delta;
      }
    }

    if (nearest) {
      const alpha = Math.min(0.9, 0.24 + tunnelPulse * 0.42 + mids * 0.12);
      ctx.save();
      ctx.beginPath();
      for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
        const pt = nearest.points[seg % TUNNEL_SEGMENTS];
        if (seg === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.strokeStyle = `hsla(${currentHue(tunnelPulsePhase)}, 96%, 76%, ${alpha})`;
      ctx.lineWidth = 1.2 + tunnelPulse * 2.4 + bass * 1.2;
      applyGlow(ctx.strokeStyle, 2 + tunnelPulse * 5);
      ctx.stroke();
      ctx.restore();
    }
  }

  for (const pulse of tunnelDropPulses) {
    let nearest = null;
    let nearestDelta = Infinity;
    for (const ring of rings) {
      const delta = Math.abs(ring.phase - pulse.phase);
      if (delta < nearestDelta) {
        nearest = ring;
        nearestDelta = delta;
      }
    }
    if (!nearest) continue;

    const pulseAlpha = Math.min(1, pulse.strength * 1.1);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
      const pt = nearest.points[seg % TUNNEL_SEGMENTS];
      if (seg === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsla(${currentHue(0.04 + pulse.phase * 0.16)}, 100%, 82%, ${pulseAlpha})`;
    ctx.lineWidth = 3.2 + pulse.strength * 5.5 + bass * 2.2;
    applyGlow(ctx.strokeStyle, 5 + pulse.strength * 9);
    ctx.stroke();

    // A softer adjacent ring makes the event read as a travelling pressure wave
    // instead of a single flashing outline.
    if (pulse.width > 0.045) {
      ctx.globalAlpha = pulseAlpha * 0.34;
      ctx.lineWidth *= 0.46;
      ctx.beginPath();
      for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
        const pt = nearest.points[seg % TUNNEL_SEGMENTS];
        if (seg === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.shadowBlur = 0;
}

function normHue(seg) {
  return (seg / TUNNEL_SEGMENTS) * 0.18;
}

// ---------- Liquid Waves mode (True Spectral Fluid Dynamics) ----------
const WAVES_LAYERS = 4;
const WAVES_POINTS = 80;
const WAVES_BANDS = 16;
const wavesSmoothedBands = new Float32Array(WAVES_BANDS).fill(0);
const wavesPhase = [0, 1.4, 2.8, 4.2];

// Dynamic bioluminescent spores / airborne spray particles
const WAVES_SPORES_COUNT = 55;
const wavesSpores = Array.from({ length: WAVES_SPORES_COUNT }, () => ({
  xNorm: Math.random(),
  layer: Math.floor(Math.random() * WAVES_LAYERS),
  speed: 0.02 + Math.random() * 0.05,
  size: 1.4 + Math.random() * 2.2,
  twinkle: Math.random() * Math.PI * 2,
  twinkleSpeed: 2.0 + Math.random() * 3.0,
  airborne: false,
  yOffset: 0,
  vy: 0,
  vx: 0,
}));

function drawWaves(bassLevel, midLevel, trebleLevel, dtSec) {
  const { releasePerSec } = VISUAL_TUNING.waves || { releasePerSec: 6.5 };
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  // 1. Smooth 16 musical frequency bands (from 35 Hz sub-bass to 16 kHz brilliance)
  // This eliminates high-frequency FFT pixel noise while capturing every musical nuance
  for (let b = 0; b < WAVES_BANDS; b++) {
    const loFrac = Math.pow(b / WAVES_BANDS, 2.0) * 0.72 + 0.005;
    const hiFrac = Math.pow((b + 1) / WAVES_BANDS, 2.0) * 0.72 + 0.01;
    const rawVal = Math.pow(
      applyValueHandling(
        bandAverage(freqData, loFrac, hiFrac) / 255,
        state.valueHandling
      ),
      0.85
    );
    wavesSmoothedBands[b] = smoothTowards(
      wavesSmoothedBands[b],
      rawVal,
      remaining
    );
  }

  // Smooth interpolation helper for spectral energy across normalized position u [0, 1]
  function getSpectralEnergy(u) {
    const pos = Math.max(0, Math.min(WAVES_BANDS - 1, u * (WAVES_BANDS - 1)));
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const v0 = wavesSmoothedBands[idx];
    const v1 = wavesSmoothedBands[Math.min(WAVES_BANDS - 1, idx + 1)];
    // Smooth cosine interpolation ensures continuous fluid curvature without jagged stair-steps
    const t = (1 - Math.cos(frac * Math.PI)) * 0.5;
    return v0 + (v1 - v0) * t;
  }

  // Distinct musical frequency roles:
  const subBass = wavesSmoothedBands[0] * 0.6 + wavesSmoothedBands[1] * 0.4;
  const punchBass = wavesSmoothedBands[2] * 0.5 + wavesSmoothedBands[3] * 0.5;
  const lowMids = wavesSmoothedBands[4] * 0.4 + wavesSmoothedBands[5] * 0.6;
  const mids =
    (wavesSmoothedBands[6] + wavesSmoothedBands[7] + wavesSmoothedBands[8]) / 3;
  const highs =
    (wavesSmoothedBands[9] + wavesSmoothedBands[10] + wavesSmoothedBands[11]) /
    3;
  const air =
    (wavesSmoothedBands[12] +
      wavesSmoothedBands[13] +
      wavesSmoothedBands[14] +
      wavesSmoothedBands[15]) /
    4;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  // Cache of calculated surface points per layer for spore collision and foam highlights
  const layerPoints = [];

  for (let l = 0; l < WAVES_LAYERS; l++) {
    const layerHue = currentHue(l / WAVES_LAYERS);

    // Dynamic wave phase accumulation:
    // Layers drift at distinct harmonic speeds and alternating directions for natural fluid parallax
    const speedDir = l % 2 === 0 ? 1 : -0.75;
    wavesPhase[l] +=
      (0.42 + l * 0.16 + punchBass * 0.75 + beatPulse * 0.35) *
      speedDir *
      dtSec;
    const phase = wavesPhase[l];

    // Layer depth staging & maximum amplitude
    const layerBaseY = canvas.height * (0.58 + l * 0.08);
    const maxLayerH = canvas.height * (0.16 + l * 0.05);

    // Gerstner Wave crest peaking:
    // Pronounced Gerstner steepness curve:
    // Below threshold: pure smooth glassy swells (steepness ~ 0.02)
    // Above threshold: crests curl and peak into sharp oceanic breakers
    const peakEnergy =
      Math.pow(punchBass, 1.6) * 0.55 + Math.pow(beatPulse, 1.4) * 0.35;
    const steepness = Math.min(0.65, 0.02 + peakEnergy) * (1 - l * 0.12);

    const pts = [];

    for (let p = 0; p < WAVES_POINTS; p++) {
      const u = p / (WAVES_POINTS - 1);
      const spec = getSpectralEnergy(u);

      // 1. Primary Deep Ocean Swell (Sub-bass): lifts the entire fluid body
      const k1 = 1.0 + l * 0.22;
      const s1 = Math.sin(u * Math.PI * 2 * k1 - phase * 0.85);
      const c1 = Math.cos(u * Math.PI * 2 * k1 - phase * 0.85);
      const swellPower =
        Math.pow(subBass, 1.6) * 0.72 + Math.pow(punchBass, 1.4) * 0.3;
      const swell = s1 * (0.14 + swellPower);

      // 2. Rhythmic Harmonic Roller (Punch Bass & Low-Mids): creates rolling waves that follow the rhythm
      const k2 = 2.2 + l * 0.35;
      const s2 = Math.sin(u * Math.PI * 2 * k2 + phase * 1.15);
      const roller = s2 * (0.12 + lowMids * 0.38 + punchBass * 0.2);

      // 3. Melodic Traveling Ripple (Mids & Vocals): standing wave harmonics moving with the melody
      const k3 = 5.2 + l * 0.6;
      const s3 = Math.sin(u * Math.PI * 2 * k3 - phase * 1.9);
      const melodic = s3 * (spec * 0.52 + mids * 0.22);

      // 4. Capillary Ripple Shimmer (Highs & Treble):
      // In quiet acoustic sections: delicate, glassy ripples that glisten with guitar strums and vocal plucks
      // In loud sections: high-frequency surface chop
      const k4 = 14.0 + l * 2.0;
      const s4 = Math.sin(u * Math.PI * 2 * k4 + phase * 3.4);
      const capillary = s4 * (0.02 + highs * 0.1 + air * 0.08);

      const totalH = (swell + roller + melodic + capillary) * maxLayerH;
      const y = layerBaseY - totalH;

      // Gerstner horizontal crest-peaking displacement
      let x = u * canvas.width - c1 * steepness * 36;
      if (p === 0) x = 0;
      else if (p === WAVES_POINTS - 1) x = canvas.width;

      pts.push({ x, y, u, crestAmp: swell + roller });
    }

    layerPoints.push(pts);

    // 2. Draw Translucent Oceanic Gradient Body
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    ctx.lineTo(pts[0].x, pts[0].y);

    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();

    const grad = ctx.createLinearGradient(
      0,
      layerBaseY - maxLayerH * 1.3,
      0,
      canvas.height
    );
    // At surface: luminous translucent neon
    grad.addColorStop(0, `hsla(${layerHue}, 90%, 65%, 0.42)`);
    // At mid-depth: rich oceanic body
    grad.addColorStop(0.45, `hsla(${layerHue}, 85%, 42%, 0.18)`);
    // At deep floor: deep oceanic floor
    grad.addColorStop(1, `hsla(${layerHue}, 80%, 15%, 0.02)`);
    ctx.fillStyle = grad;
    ctx.fill();

    // 3. Draw Glowing Surface Crest Line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

    ctx.strokeStyle = `hsl(${layerHue}, 95%, 72%)`;
    ctx.lineWidth = 1.8 + l * 0.4 + punchBass * 1.6 + beatPulse * 1.2;
    applyGlow(ctx.strokeStyle, 12 + punchBass * 12);
    ctx.stroke();

    // 4. Dynamic Crest Foam (Pronounced threshold on surges & beat hits)
    if (punchBass > 0.32 || beatPulse > 0.38) {
      for (let i = 2; i < pts.length - 2; i += 2) {
        if (pts[i].crestAmp > 0.28) {
          const foamAlpha = Math.min(
            0.85,
            (pts[i].crestAmp - 0.28) * 2.2 + beatPulse * 0.45
          );
          ctx.fillStyle = `hsla(${layerHue}, 95%, 92%, ${foamAlpha})`;
          ctx.beginPath();
          ctx.arc(pts[i].x, pts[i].y, 2.2 + beatPulse * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // 5. Bioluminescent Spores & Airborne Spray Simulation
  // Quiet passages: Spores bob peacefully on the glassy surface, softly twinkling
  // Loud drops / beat kicks: Spores are thrown into the air as glowing ballistic spray!
  for (let sp of wavesSpores) {
    sp.twinkle += dtSec * sp.twinkleSpeed;
    const layerPts = layerPoints[sp.layer] || layerPoints[0];
    const pIdx = Math.floor(sp.xNorm * (WAVES_POINTS - 1));
    const surfacePt = layerPts[pIdx] || {
      x: sp.xNorm * canvas.width,
      y: canvas.height * 0.65,
    };

    if (sp.airborne) {
      // Ballistic physics trajectory
      sp.yOffset += sp.vy * dtSec;
      sp.vy += 460 * dtSec; // Gravity pulling spray back down to water
      sp.xNorm = (sp.xNorm + (sp.vx / canvas.width) * dtSec + 1.0) % 1.0;

      // Splash back down onto water surface
      if (sp.yOffset >= 0) {
        sp.yOffset = 0;
        sp.airborne = false;
        sp.vy = 0;
      }
    } else {
      // Resting on water surface: drift gently with horizontal wave current
      sp.xNorm = (sp.xNorm + sp.speed * dtSec) % 1.0;

      // Beat hits launch spores into airborne spray
      if (beatPulse > 0.42 || (punchBass > 0.52 && Math.random() < 0.35)) {
        sp.airborne = true;
        sp.vy = -(150 + Math.random() * 220 + beatPulse * 260);
        sp.vx = (Math.random() - 0.5) * 95;
      }
    }

    const sporeX = surfacePt.x;
    const sporeY = surfacePt.y + sp.yOffset - 3;
    const layerHue = currentHue(sp.layer / WAVES_LAYERS);

    // In quiet passages: peaceful, soft twinkling glow
    // In spray mode: bright, radiant glowing sparks
    const alphaBase = sp.airborne ? 0.85 : 0.45;
    const sporeAlpha = Math.min(
      1,
      alphaBase + Math.sin(sp.twinkle) * 0.35 + beatPulse * 0.25
    );

    ctx.fillStyle = `hsla(${layerHue}, 95%, ${sp.airborne ? 92 : 82}%, ${sporeAlpha})`;
    applyGlow(ctx.fillStyle, sp.airborne ? 16 : 8);
    ctx.beginPath();
    ctx.arc(
      sporeX,
      sporeY,
      sp.size * (sp.airborne ? 1.4 : 1.0) * (1 + beatPulse * 0.3),
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  ctx.restore();
  ctx.shadowBlur = 0;
}

// ---------- Aurora Borealis mode (Celestial Audiorange Curtains) ----------
const AURORA_BANDS = 24;
const auroraSmoothedBands = new Array(AURORA_BANDS).fill(0);
const AURORA_CURTAINS = 3;
const AURORA_POINTS = 64;
const auroraPhase = [0, 1.4, 2.9];
let auroraSmoothedIntensity = 0;

// Starfield spanning the night sky
const auroraStars = Array.from({ length: 90 }, () => ({
  x: Math.random(),
  y: Math.random() * 0.88,
  size: 0.6 + Math.random() * 1.6,
  twinkle: Math.random() * Math.PI * 2,
  speed: 1.2 + Math.random() * 2.6,
}));

// Floating solar ion sparks (dancing freely in the geomagnetic field)
const auroraSparks = Array.from({ length: 45 }, () => ({
  x: Math.random(),
  y: 0.2 + Math.random() * 0.7,
  size: 0.8 + Math.random() * 1.8,
  speedY: -0.04 - Math.random() * 0.08,
  driftX: (Math.random() - 0.5) * 0.04,
  life: Math.random(),
  maxLife: 2.2 + Math.random() * 3.2,
}));

function drawAurora(bassLevel, midLevel, trebleLevel, dtSec) {
  const { releasePerSec } = VISUAL_TUNING.aurora || { releasePerSec: 6.5 };
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  const W = canvas.width;
  const H = canvas.height;

  // 1. Smooth 24 audiorange frequency bands (from sub-bass ~30Hz to brilliance ~15kHz)
  // This maps the entire audio spectrum continuously across the visualizer width
  for (let b = 0; b < AURORA_BANDS; b++) {
    const loFrac = Math.pow(b / AURORA_BANDS, 2.0) * 0.72 + 0.005;
    const hiFrac = Math.pow((b + 1) / AURORA_BANDS, 2.0) * 0.72 + 0.012;
    const rawVal =
      Math.pow(
        applyValueHandling(
          bandAverage(freqData, loFrac, hiFrac) / 255,
          state.valueHandling
        ),
        0.82
      ) * state.sensitivity;
    auroraSmoothedBands[b] = smoothTowards(
      auroraSmoothedBands[b],
      Math.min(1, rawVal),
      remaining
    );
  }

  // Smooth interpolation helper for spectral energy across normalized position u [0, 1]
  function getSpectralEnergy(u) {
    const pos = Math.max(0, Math.min(AURORA_BANDS - 1, u * (AURORA_BANDS - 1)));
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const v0 = auroraSmoothedBands[idx];
    const v1 = auroraSmoothedBands[Math.min(AURORA_BANDS - 1, idx + 1)];
    const t = (1 - Math.cos(frac * Math.PI)) * 0.5;
    return v0 + (v1 - v0) * t;
  }

  // Macroscopic intensity: drives dramatic curtain height expansion and ionization
  const rawIntensity = applyValueHandling(
    Math.min(1, bassLevel * 0.45 + midLevel * 0.35 + trebleLevel * 0.2),
    state.valueHandling
  );
  auroraSmoothedIntensity = smoothTowards(
    auroraSmoothedIntensity,
    rawIntensity,
    remaining
  );
  const intensity = auroraSmoothedIntensity;

  // 2. Celestial background: Twinkling arctic starfield
  ctx.save();
  for (const s of auroraStars) {
    s.twinkle += dtSec * s.speed;
    const alpha = 0.2 + Math.sin(s.twinkle) * 0.22 + trebleLevel * 0.3;
    ctx.fillStyle = `rgba(230, 245, 255, ${Math.min(1, Math.max(0.04, alpha))})`;
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, s.size, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. High-altitude cosmic ambient airglow (deepens with volume/intensity)
  const airglowGrad = ctx.createRadialGradient(
    W * 0.5,
    H * 0.22,
    W * 0.05,
    W * 0.5,
    H * 0.42,
    W * 0.85
  );
  const skyThemeHue = currentHue(0.1);
  airglowGrad.addColorStop(
    0,
    `hsla(${skyThemeHue + 60}, 85%, 45%, ${0.06 + intensity * 0.16 + beatPulse * 0.08})`
  );
  airglowGrad.addColorStop(
    0.5,
    `hsla(${skyThemeHue + 20}, 90%, 35%, ${0.04 + intensity * 0.12})`
  );
  airglowGrad.addColorStop(1, "rgba(2, 6, 18, 0)");
  ctx.fillStyle = airglowGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.globalCompositeOperation = "screen";

  // 4. Render 3 layered, undulating auroral curtains across the sky
  for (let c = 0; c < AURORA_CURTAINS; c++) {
    // Phase drift across the sky
    const driftSpeed = 0.18 + (2 - c) * 0.12 + intensity * 0.25;
    auroraPhase[c] += driftSpeed * dtSec;
    const phase = auroraPhase[c];

    // Curtain baseline elevation: curtains drape gracefully in the sky
    const baseElevationY = H * (0.64 + (c - 1) * 0.075);

    // Height scale dynamically transforms from quiet calm to sky-filling eruption:
    // Low intensity: thin serene ribbon (~15% screen height)
    // High intensity + beats: massive billowing drapes (~75% screen height)
    const baseMaxHeight =
      H * (0.15 + c * 0.04 + intensity * 0.48 + beatPulse * 0.12);

    // Dynamic color ionization gradient:
    // Lower border: Emerald/Cyan (atomic oxygen 557.7nm)
    // Mid drapery: Teal/Lilac
    // High corona: Violet/Crimson (high-altitude atomic oxygen 630nm)
    const baseCurtainHue = currentHue(c * 0.22);
    const midCurtainHue = (baseCurtainHue + 38) % 360;
    const topCurtainHue = (baseCurtainHue + 92) % 360;

    // Draw 2 overlapping translucent pleats per curtain to create natural volumetric folds
    for (let pleat = 0; pleat < 2; pleat++) {
      const pleatPhase = phase + pleat * 0.85;
      const pleatHeightScale = pleat === 0 ? 1.0 : 0.82;
      const pts = [];

      for (let p = 0; p <= AURORA_POINTS; p++) {
        const u = p / AURORA_POINTS;
        const x = u * W;

        // Audiorange spectral energy at normalized position u across the curtain
        const spec = getSpectralEnergy(u);

        // Local curtain height directly sculpted by the audiorange spectrum:
        // When bass hits (left), bass peaks rise; when vocals/mids sing (center), middle folds surge!
        const localHeight =
          baseMaxHeight *
          pleatHeightScale *
          (0.24 + Math.pow(spec, 0.85) * (0.76 + intensity * 0.65));

        // Serpentine traveling wave folds (undulating with spectral energy)
        const w1 = Math.sin(u * Math.PI * 3.2 - pleatPhase) * 0.45;
        const w2 =
          Math.sin(u * Math.PI * 6.4 + pleatPhase * 1.25) *
          (0.18 + spec * 0.35 + intensity * 0.15);
        const w3 =
          Math.cos(u * Math.PI * 11.2 - pleatPhase * 0.5) *
          (0.06 + spec * 0.22 + trebleLevel * 0.1);
        const totalWave = w1 + w2 + w3;

        // Celestial arch across the sky
        const skyArch = Math.sin(u * Math.PI) * (H * 0.08);
        const yBottom =
          baseElevationY - skyArch + totalWave * (H * (0.03 + spec * 0.06));
        const yTop =
          yBottom -
          localHeight *
            (0.78 + Math.sin(u * Math.PI * 3.6 + pleatPhase * 0.7) * 0.22);

        pts.push({ x, yBottom, yTop, spec });
      }

      // Draw flowing silk curtain body
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].yBottom);

      // Lower edge curve
      for (let i = 0; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].yBottom + pts[i + 1].yBottom) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].yBottom, xc, yc);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].yBottom);

      // Upper edge curve in reverse
      for (let i = pts.length - 1; i > 0; i--) {
        const xc = (pts[i].x + pts[i - 1].x) / 2;
        const yc = (pts[i].yTop + pts[i - 1].yTop) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].yTop, xc, yc);
      }
      ctx.lineTo(pts[0].x, pts[0].yTop);
      ctx.closePath();

      const curtainGrad = ctx.createLinearGradient(
        0,
        baseElevationY + H * 0.04,
        0,
        baseElevationY - baseMaxHeight
      );
      const alphaBase =
        (pleat === 0 ? 0.2 : 0.12) + intensity * 0.38 + beatPulse * 0.16;
      curtainGrad.addColorStop(
        0,
        `hsla(${baseCurtainHue}, 96%, 68%, ${alphaBase * 0.9})`
      );
      curtainGrad.addColorStop(
        0.28,
        `hsla(${baseCurtainHue}, 92%, 60%, ${alphaBase * 0.75})`
      );
      curtainGrad.addColorStop(
        0.65,
        `hsla(${midCurtainHue}, 90%, 54%, ${alphaBase * 0.5})`
      );
      curtainGrad.addColorStop(
        0.92,
        `hsla(${topCurtainHue}, 85%, 48%, ${alphaBase * 0.22})`
      );
      curtainGrad.addColorStop(1, `hsla(${topCurtainHue}, 85%, 45%, 0)`);

      ctx.fillStyle = curtainGrad;
      ctx.fill();

      // Features for the primary pleat:
      if (pleat === 0) {
        // A. Dynamic delicate vertical ray fluting (magnetic field lines dancing with spectrum)
        const rayStep = c === 2 ? 1 : 2;
        for (let i = 0; i < pts.length; i += rayStep) {
          const pt = pts[i];
          if (pt.spec < 0.12 && intensity < 0.2) continue;

          const rayAlpha = Math.min(
            0.65,
            (pt.spec * 0.45 + beatPulse * 0.2) * (0.35 + intensity * 0.65)
          );
          if (rayAlpha < 0.04) continue;

          const rayGrad = ctx.createLinearGradient(
            pt.x,
            pt.yBottom,
            pt.x,
            pt.yTop
          );
          rayGrad.addColorStop(
            0,
            `hsla(${baseCurtainHue}, 98%, 78%, ${rayAlpha})`
          );
          rayGrad.addColorStop(
            0.3,
            `hsla(${baseCurtainHue}, 95%, 68%, ${rayAlpha * 0.8})`
          );
          rayGrad.addColorStop(
            0.7,
            `hsla(${midCurtainHue}, 92%, 58%, ${rayAlpha * 0.5})`
          );
          rayGrad.addColorStop(1, `hsla(${topCurtainHue}, 88%, 50%, 0)`);

          ctx.strokeStyle = rayGrad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(pt.x, pt.yBottom);
          ctx.lineTo(pt.x, pt.yTop);
          ctx.stroke();
        }

        // B. Sharp luminous lower edge arc (100km atomic oxygen boundary)
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].yBottom);
        for (let i = 0; i < pts.length - 1; i++) {
          const xc = (pts[i].x + pts[i + 1].x) / 2;
          const yc = (pts[i].yBottom + pts[i + 1].yBottom) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].yBottom, xc, yc);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].yBottom);

        const edgeAlpha = Math.min(
          1,
          0.35 + intensity * 0.55 + beatPulse * 0.25
        );
        ctx.strokeStyle = `hsla(${baseCurtainHue}, 100%, 82%, ${edgeAlpha})`;
        ctx.lineWidth =
          1.4 + (c === 2 ? 1.6 : 0.6) + intensity * 1.2 + beatPulse * 1.2;
        applyGlow(
          `hsla(${baseCurtainHue}, 100%, 75%, ${edgeAlpha})`,
          10 + intensity * 14 + c * 4
        );
        ctx.stroke();
      }
    }
  }

  // 5. Floating solar ion sparks (swirling and ascending along geomagnetic field lines)
  for (const sp of auroraSparks) {
    sp.life += dtSec;
    if (sp.life > sp.maxLife) {
      sp.life = 0;
      sp.x = Math.random();
      sp.y = 0.75 + Math.random() * 0.2;
    }
    sp.y += sp.speedY * dtSec * (1 + intensity * 1.2 + bassLevel * 0.8);
    sp.x += sp.driftX * dtSec;

    const sparkProg = sp.life / sp.maxLife;
    const sparkAlpha =
      Math.sin(sparkProg * Math.PI) *
      (0.25 + trebleLevel * 0.5 + intensity * 0.3);
    if (sparkAlpha > 0.04) {
      const sparkHue = currentHue(sp.x);
      ctx.fillStyle = `hsla(${sparkHue}, 95%, 85%, ${sparkAlpha})`;
      ctx.beginPath();
      ctx.arc(
        sp.x * W,
        sp.y * H,
        sp.size * (1 + beatPulse * 0.6 + intensity * 0.4),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  ctx.restore();
  ctx.shadowBlur = 0;

  // 6. Subtle atmospheric horizon vignette (open, deep night sky - no blocked polygons)
  const skyVignette = ctx.createLinearGradient(0, H * 0.75, 0, H);
  const floorHue = currentHue(0.05);
  skyVignette.addColorStop(0, "rgba(2, 6, 18, 0)");
  skyVignette.addColorStop(
    1,
    `hsla(${floorHue}, 80%, 20%, ${0.08 + intensity * 0.12 + beatPulse * 0.08})`
  );
  ctx.fillStyle = skyVignette;
  ctx.fillRect(0, H * 0.75, W, H * 0.25);
}

// ---------- Cascade mode (Trap / NCS 180° Mirrored Intense Wave Visualizer) ----------
const CASCADE_BARS = 128;
const cascadeLiveBands = new Float32Array(CASCADE_BARS).fill(0);
const cascadeSustainedPeaks = new Float32Array(CASCADE_BARS).fill(0);
const cascadeDropRipples = [];
let cascadeDropTime = 0;
let cascadeDropImpulse = 0;

// Floating background bass bokeh sparks (flying outward from the center)
const cascadeParticles = Array.from({ length: 60 }, () => ({
  angle: Math.random() * Math.PI * 2,
  distFrac: 0.2 + Math.random() * 0.8,
  size: 1.5 + Math.random() * 3.5,
  speed: 0.15 + Math.random() * 0.4,
  twinkle: Math.random() * Math.PI * 2,
  twinkleSpeed: 2.0 + Math.random() * 3.5,
}));

const centerLogoImg = new Image();
centerLogoImg.src = "icon.png";
let centerLogoLoaded = false;
centerLogoImg.onload = () => {
  centerLogoLoaded = true;
};

function drawCascade(bassLevel, midLevel, trebleLevel, dtSec) {
  const { releasePerSec } = VISUAL_TUNING.cascade || {
    releasePerSec: 7.2,
  };
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const minDim = Math.min(W, H);

  const subBass =
    Math.min(1, bandAverage(freqData, 0.003, 0.035) / 200) * state.sensitivity;
  const punchBass = bassLevel * 0.7 + midLevel * 0.3;
  const energy = subBass * 0.55 + punchBass * 0.35 + trebleLevel * 0.1;

  // Drop ripple impulse decay
  cascadeDropTime += dtSec;
  cascadeDropImpulse = Math.max(0, cascadeDropImpulse - dtSec * 3.2);

  // Trigger drop ripple on punchy beat drops
  if (beatPulse > 0.48) {
    cascadeDropImpulse = beatPulse;
    const lastRipple = cascadeDropRipples[cascadeDropRipples.length - 1];
    if (!lastRipple || lastRipple.age > 0.14) {
      cascadeDropRipples.push({
        offset: 0,
        maxOffset: minDim * (0.16 + beatPulse * 0.24),
        intensity: beatPulse,
        age: 0,
        life: 0.5 + beatPulse * 0.3,
      });
    }
  }

  // Update drop ripples
  for (let s = cascadeDropRipples.length - 1; s >= 0; s--) {
    const sw = cascadeDropRipples[s];
    sw.age += dtSec;
    if (sw.age >= sw.life) {
      cascadeDropRipples.splice(s, 1);
    } else {
      sw.offset += (sw.maxOffset / sw.life) * dtSec;
    }
  }

  // Central disc radius: tight, punchy, scales slightly on beat drops
  const discBaseR = minDim * 0.19 * (1 + subBass * 0.04 + beatPulse * 0.06);
  // Wave baseline sits tucked slightly inside the disc bezel so low amplitudes and top exclusion stay hidden
  const waveBaseR = discBaseR - 6;

  // 1. Draw floating ambient bass bokeh sparks in the background
  ctx.save();
  for (const p of cascadeParticles) {
    p.distFrac += p.speed * dtSec * (1 + energy * 1.5 + beatPulse * 2.2);
    if (p.distFrac > 1.25) {
      p.distFrac = 0.22 + Math.random() * 0.1;
      p.angle = Math.random() * Math.PI * 2;
    }
    p.twinkle += dtSec * p.twinkleSpeed;
    const px = cx + Math.cos(p.angle) * (p.distFrac * minDim * 0.65);
    const py = cy + Math.sin(p.angle) * (p.distFrac * minDim * 0.65);
    const pAlpha =
      Math.min(1, Math.sin(p.distFrac * Math.PI * 0.8)) *
      (0.25 + Math.sin(p.twinkle) * 0.2 + energy * 0.35);

    if (pAlpha > 0.04) {
      const pHue = currentHue(p.distFrac);
      ctx.fillStyle = `hsla(${pHue}, 90%, 75%, ${pAlpha})`;
      applyGlow(ctx.fillStyle, 8);
      ctx.beginPath();
      ctx.arc(px, py, p.size * (1 + beatPulse * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // 2. Direct frequency sampling across the 180° arc with high dynamic threshold
  // (keeps 90% of the circle flat against the rim with barely any peaks, only erupting on true hits)
  const halfCount = CASCADE_BARS / 2;
  const peakDecay = Math.exp(-3.5 * dtSec);
  const maxWaveHeight = minDim * 0.22; // Full dramatic scale for hits

  const rawTargets = new Float32Array(CASCADE_BARS);
  const minBin = 2; // ~43 Hz (sub-bass kick)
  const maxBin = Math.floor(bufferLength * 0.32); // ~2800 Hz (musical presence)

  for (let i = 0; i < CASCADE_BARS; i++) {
    const u =
      i < halfCount ? i / halfCount : (CASCADE_BARS - i - 1) / halfCount;

    // Exclude top ~24% (u near 0) and bottom ~20% (u near 1.0)
    let dampen = 0;
    if (u > 0.08 && u < 0.92) {
      const topT = Math.min(1, (u - 0.08) / 0.12);
      const topFactor = topT * topT * (3 - 2 * topT);
      const bottomT = Math.min(1, (0.92 - u) / 0.12);
      const bottomFactor = bottomT * bottomT * (3 - 2 * bottomT);
      dampen = topFactor * bottomFactor;
    }

    // Map active wing range (0.12 to 0.82) across the full musical frequency spectrum
    // (sub-bass kicks at upper flank, treble at lower flank by default)
    const uActive = Math.max(0, Math.min(1, (u - 0.12) / (0.82 - 0.12)));
    const frequencyT =
      state.cascadeFrequencyOrder === "treble-to-bass" ? 1 - uActive : uActive;
    const binIdx = Math.round(minBin * Math.pow(maxBin / minBin, frequencyT));
    const rawVal = freqData[Math.min(bufferLength - 1, binIdx)] / 255;

    // High threshold floor: below threshold is strictly 0 (barely any peaks!)
    const threshold = 0.4;
    let punch = 0;
    if (rawVal > threshold) {
      const norm = (rawVal - threshold) / (1 - threshold);
      punch = applyValueHandling(norm, state.valueHandling) * state.sensitivity;
    }

    rawTargets[i] = punch * dampen;
  }

  // 3. Elastic neighbor coupling: when a frequency punches, it tugs its neighbors along into a fluid wave
  const coupledTargets = new Float32Array(CASCADE_BARS);
  for (let i = 0; i < CASCADE_BARS; i++) {
    const prev = rawTargets[(i - 1 + CASCADE_BARS) % CASCADE_BARS];
    const curr = rawTargets[i];
    const next = rawTargets[(i + 1) % CASCADE_BARS];
    coupledTargets[i] = prev * 0.25 + curr * 0.5 + next * 0.25;
  }

  // Dynamic shudder ripple on drops & update live bands
  for (let i = 0; i < CASCADE_BARS; i++) {
    const u =
      i < halfCount ? i / halfCount : (CASCADE_BARS - i - 1) / halfCount;
    const rippleShudder =
      coupledTargets[i] > 0.02
        ? cascadeDropImpulse *
          Math.sin(u * Math.PI * 6 - cascadeDropTime * 14) *
          (minDim * 0.03)
        : 0;

    const targetH = Math.max(
      0,
      Math.min(
        maxWaveHeight,
        coupledTargets[i] * maxWaveHeight * (1 + subBass * 0.3) + rippleShudder
      )
    );

    cascadeLiveBands[i] = smoothTowards(
      cascadeLiveBands[i],
      targetH,
      remaining
    );

    cascadeSustainedPeaks[i] = Math.max(
      cascadeLiveBands[i],
      cascadeSustainedPeaks[i] * peakDecay
    );
  }

  // Pre-calculate full loop points around the circle
  const fullLoopPts = [];
  for (let i = 0; i < CASCADE_BARS; i++) {
    // Start at top (-PI/2) and wrap around
    const angle = (i / CASCADE_BARS) * Math.PI * 2 - Math.PI / 2;
    fullLoopPts.push({
      angle,
      amp: cascadeLiveBands[i],
      sustainedAmp: cascadeSustainedPeaks[i],
    });
  }

  // Helper to trace smooth closed wave path at an offset from waveBaseR
  function traceContour(offset = 0, useSustained = false) {
    ctx.beginPath();
    for (let i = 0; i <= CASCADE_BARS; i++) {
      const pt = fullLoopPts[i % CASCADE_BARS];
      const h = useSustained ? pt.sustainedAmp : pt.amp;
      const r = waveBaseR + h + offset;
      const x = cx + Math.cos(pt.angle) * r;
      const y = cy + Math.sin(pt.angle) * r;

      if (i === 0) ctx.moveTo(x, y);
      else {
        const prev = fullLoopPts[(i - 1 + CASCADE_BARS) % CASCADE_BARS];
        const prevH = useSustained ? prev.sustainedAmp : prev.amp;
        const prevR = waveBaseR + prevH + offset;
        const prevX = cx + Math.cos(prev.angle) * prevR;
        const prevY = cy + Math.sin(prev.angle) * prevR;
        const mx = (prevX + x) / 2;
        const my = (prevY + y) / 2;
        ctx.quadraticCurveTo(prevX, prevY, mx, my);
      }
    }
    ctx.closePath();
  }

  // 4. On drops, pulse ripples through the circle with the intensity of the pulses
  const themeHue = currentHue(0);
  const accentHue = (themeHue + 25) % 360;
  const cascadeRingStyle = (alpha, lightness) => {
    const theme = THEMES[state.theme];
    if (!theme.rainbow) {
      return `hsla(${themeHue}, 100%, ${lightness}%, ${alpha})`;
    }

    // The contour is circular, so a conic gradient follows its geometry.
    // Using currentHue(0) alone would make Rainbow themes solid red because
    // computeHue intentionally ignores the offset for that case.
    const gradient = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    const stops = 6;
    for (let s = 0; s <= stops; s++) {
      gradient.addColorStop(
        s / stops,
        `hsla(${currentHue(s / stops)}, 100%, ${lightness}%, ${alpha})`
      );
    }
    return gradient;
  };

  ctx.save();
  for (const sw of cascadeDropRipples) {
    const swFrac = sw.age / sw.life;
    const swAlpha =
      Math.sin((1 - swFrac) * Math.PI * 0.5) * sw.intensity * 0.85;
    if (swAlpha < 0.02) continue;

    traceContour(sw.offset, false);
    ctx.strokeStyle = `hsla(${currentHue(swFrac * 0.3)}, 95%, 72%, ${swAlpha})`;
    ctx.lineWidth = Math.max(
      1.2,
      2.8 * (1 - swFrac) * (1 + sw.intensity * 0.5)
    );
    applyGlow(ctx.strokeStyle, 10 * (1 - swFrac) * sw.intensity);
    ctx.stroke();
  }
  ctx.restore();

  // 5. Draw Dark Solid Silhouette Backdrop under the live wave contour
  ctx.save();
  traceContour(4);
  ctx.fillStyle = "rgba(6, 6, 12, 0.94)";
  ctx.fill();
  ctx.restore();

  // 6. Draw Multi-Layered Concentric Wave Lines (Outer Neon, Crisp White, Inner Neon)
  ctx.save();
  // Layer A: Outer Neon Glow Contour (Intense peaks)
  traceContour(6);
  ctx.strokeStyle = cascadeRingStyle(0.95, 65);
  ctx.lineWidth = 3.6 + beatPulse * 1.4;
  applyGlow(
    THEMES[state.theme].rainbow ? "rgba(255, 255, 255, 0.7)" : ctx.strokeStyle,
    14 + beatPulse * 10
  );
  ctx.stroke();

  // Layer B: Black Contrast Separation Gap
  traceContour(3.8);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.95)";
  ctx.lineWidth = 3.0;
  ctx.stroke();

  // Layer C: Middle Crisp White Accent Line (signature highlight line)
  traceContour(2.2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.98)";
  ctx.lineWidth = 2.0;
  applyGlow("rgba(255, 255, 255, 0.85)", 6);
  ctx.stroke();

  // Layer D: Inner Neon Line
  traceContour(0);
  ctx.strokeStyle = THEMES[state.theme].rainbow
    ? cascadeRingStyle(0.9, 70)
    : `hsla(${accentHue}, 100%, 70%, 0.9)`;
  ctx.lineWidth = 2.6 + beatPulse * 1.0;
  applyGlow(
    THEMES[state.theme].rainbow ? "rgba(255, 255, 255, 0.7)" : ctx.strokeStyle,
    8
  );
  ctx.stroke();
  ctx.restore();

  // 6. Draw Sustained Peaks (Floating Peak-Hold Dots hovering above the crests)
  ctx.save();
  for (let i = 0; i < CASCADE_BARS; i += 2) {
    const pt = fullLoopPts[i];
    if (pt.sustainedAmp < 12) continue;
    const peakR = waveBaseR + pt.sustainedAmp + 10;
    const px = cx + Math.cos(pt.angle) * peakR;
    const py = cy + Math.sin(pt.angle) * peakR;
    const peakAlpha = Math.min(1, (pt.sustainedAmp - 10) / 25);

    ctx.fillStyle = `hsla(${(themeHue + 40) % 360}, 100%, 85%, ${peakAlpha * 0.9})`;
    applyGlow(ctx.fillStyle, 6);
    ctx.beginPath();
    ctx.arc(px, py, 2.0 + beatPulse * 1.0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 8. Draw Central Emblem & Disc (on top of wave baseline, hiding low values and top exclusion)
  ctx.save();
  // Outer black bezel
  ctx.beginPath();
  ctx.arc(cx, cy, discBaseR, 0, Math.PI * 2);
  ctx.fillStyle = "#080811";
  ctx.fill();
  ctx.strokeStyle = `hsla(${themeHue}, 90%, 65%, 0.85)`;
  ctx.lineWidth = 2.8 + beatPulse * 1.8;
  applyGlow(ctx.strokeStyle, 12 + beatPulse * 8);
  ctx.stroke();

  // Render centered logo / icon inside circular clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, discBaseR - 3, 0, Math.PI * 2);
  ctx.clip();

  if (centerLogoLoaded && centerLogoImg.width > 0) {
    const imgSize = (discBaseR - 3) * 2.02;
    ctx.drawImage(
      centerLogoImg,
      cx - imgSize / 2,
      cy - imgSize / 2,
      imgSize,
      imgSize
    );
  } else {
    // Futuristic EDM Speaker Disc fallback
    const discGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, discBaseR);
    discGrad.addColorStop(0, `hsla(${themeHue}, 95%, 45%, 0.9)`);
    discGrad.addColorStop(0.5, `hsla(${(themeHue + 40) % 360}, 90%, 25%, 0.7)`);
    discGrad.addColorStop(1, "#04040a");
    ctx.fillStyle = discGrad;
    ctx.fill();

    for (let g = 1; g <= 4; g++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (discBaseR * g) / 5, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${themeHue}, 80%, 70%, ${0.25 + beatPulse * 0.25})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  ctx.restore();

  // Subtle gloss reflection across the top of the disc glass
  const glossGrad = ctx.createLinearGradient(cx, cy - discBaseR, cx, cy);
  glossGrad.addColorStop(0, "rgba(255, 255, 255, 0.25)");
  glossGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.beginPath();
  ctx.arc(cx, cy, discBaseR - 3, Math.PI, Math.PI * 2);
  ctx.fillStyle = glossGrad;
  ctx.fill();

  ctx.restore();
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

  // Detect zombie capture streams that return all-zero data after a
  // device change that Chromium didn't report via track/stream events.
  checkSilence();

  const bass = bandAverage(freqData, 0, 0.015); // ~0-300Hz (True Bass)
  const mid = bandAverage(freqData, 0.015, 0.1); // ~300-2000Hz (Mids)
  const treble = bandAverage(freqData, 0.1, 0.5); // ~2000-10000Hz (Highs)
  const rawBass = normalizeEnergy(
    bass,
    AUDIO_TUNING.particleFloor,
    AUDIO_TUNING.particleRange
  );
  const rawMid = normalizeEnergy(mid, 15, 165);
  const rawTreble = normalizeEnergy(treble, 12, 155);

  const bassLevel = Math.min(
    1,
    applyValueHandling(rawBass, state.valueHandling) * state.sensitivity
  );
  const midLevel = Math.min(
    1,
    applyValueHandling(rawMid, state.valueHandling) * state.sensitivity
  );
  const trebleLevel = Math.min(
    1,
    applyValueHandling(rawTreble, state.valueHandling) * state.sensitivity
  );
  updateBeat(bass, elapsedMs, dtSec);

  if (THEMES[state.theme].colorCycle || THEMES[state.theme].cycle) {
    const { baseDegPerSec, midDegPerSecPerUnit } = VISUAL_TUNING.hueCycle;
    state.hueShift =
      (state.hueShift + (baseDegPerSec + mid * midDegPerSecPerUnit) * dtSec) %
      360;
  }

  clearFrame();

  if (typeof renderProceduralBackground === "function") {
    renderProceduralBackground(
      dtSec,
      bassLevel,
      midLevel,
      trebleLevel,
      beatPulse
    );
  }
  if (typeof updateFxLive === "function") {
    updateFxLive(bassLevel, midLevel, trebleLevel, beatPulse);
  }

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
    case "tunnel":
      drawTunnel(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "waves":
      drawWaves(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "aurora":
      drawAurora(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "cascade":
      drawCascade(bassLevel, midLevel, trebleLevel, dtSec);
      break;
  }
  renderTrailHistory(timestamp);
}
