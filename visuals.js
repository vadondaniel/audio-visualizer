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

  const isCenter = state.barsAlignment === "center";
  const centerY = canvas.height / 2;

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

  if (state.waveformStyle === "filled") {
    // Upper ribbon fill
    ctx.lineTo(canvas.width, midY);
    ctx.lineTo(0, midY);
    ctx.closePath();
    ctx.fillStyle = `hsla(${currentHue(0.5)}, 90%, 60%, 0.22)`;
    ctx.fill();

    // Symmetrical lower reflected harmonic ribbon
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const raw = (timeData[i] - 128) / 128;
      const y = midY - raw * amp * canvas.height * 0.32;
      const x = i * slice;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineTo(canvas.width, midY);
    ctx.lineTo(0, midY);
    ctx.closePath();
    ctx.fillStyle = `hsla(${currentHue(0.5)}, 90%, 60%, 0.12)`;
    ctx.fill();
  }
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

// ---------- Cyber Tunnel mode (True 3D Audio Vortex) ----------
let tunnelZOffset = 0;
let tunnelAngle = 0;
const TUNNEL_RINGS = 20;
const TUNNEL_SEGMENTS = 32;
// 2D grid of smoothed frequency values: [ringIndex][segmentIndex]
const tunnelGrid = Array.from({ length: TUNNEL_RINGS }, () =>
  new Array(TUNNEL_SEGMENTS).fill(0)
);

// 3D Starfield / Warp dust traveling down the tunnel
const tunnelStars = Array.from({ length: 90 }, () => ({
  x: (Math.random() - 0.5) * 2,
  y: (Math.random() - 0.5) * 2,
  z: Math.random(),
  speed: 0.4 + Math.random() * 0.8,
  size: 1.2 + Math.random() * 2.2,
}));

function drawTunnel(bassLevel, midLevel, trebleLevel, dtSec) {
  const energy = Math.min(
    1,
    bassLevel * 0.55 + midLevel * 0.3 + trebleLevel * 0.15
  );

  // 1. Visceral camera shake — ONLY kicks in on real beat hits & loud drops
  const shakeAmp = Math.pow(beatPulse, 1.5) * 8 + Math.pow(bassLevel, 2) * 4;
  const shakeX = shakeAmp > 0.4 ? (Math.random() - 0.5) * shakeAmp : 0;
  const shakeY = shakeAmp > 0.4 ? (Math.random() - 0.5) * shakeAmp : 0;

  const cx = canvas.width / 2 + shakeX;
  const cy = canvas.height / 2 + shakeY;

  // Aperture dynamic range:
  // Low intensity = tight, sleek, focused 0.38 cylindrical corridor
  // High intensity = massive 0.88 wide-angle warp vortex engulfing the screen
  const minDim = Math.min(canvas.width, canvas.height);
  const maxDim = Math.max(canvas.width, canvas.height);
  const maxR =
    minDim * 0.38 * (1 - energy) +
    maxDim * (0.42 + energy * 0.36 + beatPulse * 0.12) * energy;

  // Dynamic Camera Focal Depth:
  // Low intensity = deep telephoto lens (3.4 exponent), rings recede far into infinite distance
  // High intensity = wide-angle fisheye (2.2 exponent), rings rush past the camera
  const depthExp = 3.3 - energy * 1.05;

  // Speed dynamic range:
  // Low intensity = serene, hypnotic cruise (0.16)
  // High intensity = hypersonic warp jump (up to 5.0+)
  const currentSpeed =
    (0.16 + Math.pow(bassLevel, 1.5) * 2.9 + beatPulse * 3.7) * dtSec;
  tunnelZOffset = (tunnelZOffset + currentSpeed) % 1.0;
  tunnelAngle += (0.12 + trebleLevel * 0.9 + beatPulse * 0.5) * dtSec;

  const remaining = state.smoothingEnabled
    ? Math.exp(-VISUAL_TUNING.tunnel.releasePerSec * dtSec)
    : 0;

  // Low-intensity feature: Atmospheric Cosmic Nebula at the vanishing point
  // When music is quiet, a soft celestial aura fills the void, giving it depth and serene mood.
  // As energy peaks, the nebula gets vaporized by the blinding singularity.
  const lowIntensityAtmosphere = Math.max(0, 1 - energy * 1.4);
  if (lowIntensityAtmosphere > 0.05) {
    const nebR = maxR * 0.52;
    const nebGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nebR);
    const nebHue = (currentHue(0) + 35) % 360;
    nebGrad.addColorStop(
      0,
      `hsla(${nebHue}, 70%, 50%, ${0.26 * lowIntensityAtmosphere})`
    );
    nebGrad.addColorStop(
      0.5,
      `hsla(${(nebHue + 40) % 360}, 60%, 25%, ${0.12 * lowIntensityAtmosphere})`
    );
    nebGrad.addColorStop(1, "transparent");
    ctx.fillStyle = nebGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, nebR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Low-intensity feature: Futuristic Navigation Reticle / Calibrated Horizon Ring
  // Shows a crisp, subtle sci-fi HUD guidance ring when quiet, which shatters/fades under high energy
  if (lowIntensityAtmosphere > 0.15) {
    ctx.save();
    const reticleR = maxR * 0.16;
    ctx.strokeStyle = `hsla(${currentHue(0)}, 80%, 75%, ${0.22 * lowIntensityAtmosphere})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, reticleR, 0, Math.PI * 2);
    // 4 precision crosshair ticks
    for (let a = 0; a < 4; a++) {
      const ang = tunnelAngle * 0.5 + (a * Math.PI) / 2;
      const x1 = cx + Math.cos(ang) * (reticleR - 5);
      const y1 = cy + Math.sin(ang) * (reticleR - 5);
      const x2 = cx + Math.cos(ang) * (reticleR + 7);
      const y2 = cy + Math.sin(ang) * (reticleR + 7);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 2. Stars: tiny peaceful dots when quiet, stretching into warp lasers on high intensity
  const streakLength = Math.pow(energy, 1.8) * 0.22 + beatPulse * 0.08;
  for (let s of tunnelStars) {
    s.z -= currentSpeed * s.speed;
    if (s.z <= 0.02) {
      s.z += 1.0;
      s.x = (Math.random() - 0.5) * 2;
      s.y = (Math.random() - 0.5) * 2;
    }

    const z1 = Math.pow(s.z, 2.0);
    const sx1 = cx + (s.x / z1) * (canvas.width * 0.22);
    const sy1 = cy + (s.y / z1) * (canvas.height * 0.22);

    if (
      sx1 >= -50 &&
      sx1 <= canvas.width + 50 &&
      sy1 >= -50 &&
      sy1 <= canvas.height + 50
    ) {
      const starAlpha = (1 - s.z) * (0.2 + energy * 0.5 + beatPulse * 0.4);

      if (streakLength > 0.015) {
        // High intensity: hyperdrive laser streak
        const z2 = Math.pow(Math.min(1.0, s.z + streakLength), 2.0);
        const sx2 = cx + (s.x / z2) * (canvas.width * 0.22);
        const sy2 = cy + (s.y / z2) * (canvas.height * 0.22);

        ctx.strokeStyle = `hsla(${currentHue(s.z)}, 95%, ${80 + beatPulse * 15}%, ${starAlpha})`;
        ctx.lineWidth = s.size * (1 - s.z * 0.6) * (0.8 + beatPulse * 0.8);
        applyGlow(ctx.strokeStyle, 4 + beatPulse * 8);
        ctx.beginPath();
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(sx2, sy2);
        ctx.stroke();
      } else {
        // Low intensity: peaceful, round pinpoint stars drifting in the void
        const starR = s.size * (1 - s.z * 0.6) * 0.65;
        ctx.fillStyle = `hsla(${currentHue(s.z)}, 80%, 75%, ${starAlpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(sx1, sy1, starR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 3. Pre-calculate ring coordinates with per-vertex FFT spectrum displacement
  const ringPoints = [];

  for (let r = 0; r < TUNNEL_RINGS; r++) {
    const rawZ = (r / TUNNEL_RINGS + tunnelZOffset) % 1.0;
    const zDepth = Math.pow(rawZ, depthExp);
    if (zDepth < 0.005) {
      ringPoints.push(null);
      continue;
    }

    const ringRadius = zDepth * maxR;
    const ringRot = tunnelAngle + (1 - rawZ) * 2.2;
    const points = [];

    // In quiet passages: deformScale is low (rings retain clean geometric perfection)
    // In loud drops: deformScale triples and rings violently warp into audio shockwaves
    const deformScale = 0.15 + energy * 0.75 + beatPulse * 0.25;

    for (let seg = 0; seg < TUNNEL_SEGMENTS; seg++) {
      const normSeg =
        seg < TUNNEL_SEGMENTS / 2
          ? seg / (TUNNEL_SEGMENTS / 2)
          : (TUNNEL_SEGMENTS - seg) / (TUNNEL_SEGMENTS / 2);
      const binIdx = Math.floor(normSeg * (bufferLength * 0.38));
      const rawAmp = Math.pow(freqData[binIdx] / 255, 0.82);

      tunnelGrid[r][seg] = smoothTowards(tunnelGrid[r][seg], rawAmp, remaining);
      const v = tunnelGrid[r][seg];

      const deformedR = ringRadius * (0.92 + v * deformScale);
      const angle = (seg / TUNNEL_SEGMENTS) * Math.PI * 2 + ringRot;

      points.push({
        x: cx + Math.cos(angle) * deformedR,
        y: cy + Math.sin(angle) * deformedR,
        v,
      });
    }
    ringPoints.push({ points, rawZ, zDepth });
  }

  // 4. Draw illuminated tunnel wall panels between adjacent rings (Tron Grid Glow)
  // Completely invisible during quiet passages; lights up only on energy surges
  if (energy > 0.18 || beatPulse > 0.25) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let r = 0; r < TUNNEL_RINGS - 1; r++) {
      const ringA = ringPoints[r];
      const ringB = ringPoints[r + 1];
      if (!ringA || !ringB) continue;

      for (let seg = 0; seg < TUNNEL_SEGMENTS; seg += 2) {
        const nextSeg = (seg + 1) % TUNNEL_SEGMENTS;
        const vAvg = (ringA.points[seg].v + ringB.points[seg].v) / 2;
        if (vAvg < 0.24 && beatPulse < 0.35) continue;

        const panelAlpha =
          Math.min(0.42, vAvg * 0.45 + beatPulse * 0.28) * (1 - ringA.rawZ);
        const hue = currentHue(ringA.rawZ);

        ctx.fillStyle = `hsla(${hue}, 90%, 55%, ${panelAlpha})`;
        ctx.beginPath();
        ctx.moveTo(ringA.points[seg].x, ringA.points[seg].y);
        ctx.lineTo(ringA.points[nextSeg].x, ringA.points[nextSeg].y);
        ctx.lineTo(ringB.points[nextSeg].x, ringB.points[nextSeg].y);
        ctx.lineTo(ringB.points[seg].x, ringB.points[seg].y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // 5. Longitudinal perspective rails
  // Whisper-thin threads when quiet; bright neon highway beams when loud
  const railAlpha = 0.08 + energy * 0.45 + beatPulse * 0.35;
  ctx.lineWidth = 0.7 + energy * 1.6 + beatPulse * 1.8;
  const rails = 16;
  const railStep = TUNNEL_SEGMENTS / rails;

  for (let rl = 0; rl < rails; rl++) {
    const segIdx = Math.floor(rl * railStep);
    ctx.beginPath();
    let started = false;

    for (let r = 0; r < TUNNEL_RINGS; r++) {
      const ring = ringPoints[r];
      if (!ring) continue;
      const pt = ring.points[segIdx];
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }

    ctx.strokeStyle = `hsla(${currentHue(rl / rails)}, 90%, ${55 + energy * 20}%, ${railAlpha})`;
    if (energy > 0.2)
      applyGlow(ctx.strokeStyle, 6 + energy * 10 + beatPulse * 8);
    ctx.stroke();
  }

  // 6. Concentric tunnel rings
  // Thin, delicate geometric wireframes when quiet; thick saturated glowing arcs when loud
  for (let r = 0; r < TUNNEL_RINGS; r++) {
    const ring = ringPoints[r];
    if (!ring) continue;
    const { points, rawZ, zDepth } = ring;

    const baseRingAlpha = Math.min(1, Math.sin(rawZ * Math.PI) * 1.5);
    const ringAlpha = baseRingAlpha * (0.24 + energy * 0.76);
    const hue = currentHue(rawZ);

    ctx.beginPath();
    for (let i = 0; i <= TUNNEL_SEGMENTS; i++) {
      const pt = points[i % TUNNEL_SEGMENTS];
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();

    ctx.strokeStyle = `hsla(${hue}, 95%, ${50 + energy * 25 + beatPulse * 15}%, ${ringAlpha})`;
    ctx.lineWidth =
      (0.7 + zDepth * 3.0) * (0.5 + energy * 0.8) +
      bassLevel * 2.5 +
      beatPulse * 2.0;
    if (energy > 0.15)
      applyGlow(ctx.strokeStyle, 6 + energy * 12 + beatPulse * 10);
    ctx.stroke();
  }

  // 7. Shockwave blast rings erupting on beats
  if (beatPulse > 0.38) {
    const shockwaveR = maxR * (0.25 + (1 - beatPulse) * 0.7);
    ctx.beginPath();
    ctx.arc(cx, cy, shockwaveR, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${currentHue(0)}, 95%, 85%, ${beatPulse * 0.65})`;
    ctx.lineWidth = 2 + beatPulse * 6;
    applyGlow(ctx.strokeStyle, 24);
    ctx.stroke();
  }

  // 8. Pulsing vanishing point singularity in center
  // Low intensity: tiny 4px calm jewel in infinite distance with subtle breathing
  // High intensity: huge 45px blazing supernova core
  const lowPulse = Math.sin(Date.now() * 0.003) * 0.8;
  const centerR =
    Math.max(2.5, 4 + lowPulse * (1 - energy)) +
    energy * 18 +
    bassLevel * 22 +
    beatPulse * 26;
  ctx.beginPath();
  ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${currentHue(0)}, 95%, ${70 + energy * 18 + beatPulse * 12}%, ${0.4 + energy * 0.5 + beatPulse * 0.1})`;
  applyGlow(ctx.fillStyle, 8 + energy * 26 + beatPulse * 20);
  ctx.fill();

  ctx.shadowBlur = 0;
}

// ---------- Liquid Waves mode (True Spectral Fluid) ----------
const WAVES_LAYERS = 4;
const WAVES_POINTS = 64;
const wavesGrid = Array.from({ length: WAVES_LAYERS }, () =>
  new Array(WAVES_POINTS).fill(0)
);
const wavesPhaseDrift = [0, 1.4, 2.8, 4.2];

// Floating bioluminescent spores that drift across the fluid
const wavesSpores = Array.from({ length: 45 }, () => ({
  xNorm: Math.random(),
  layer: Math.floor(Math.random() * WAVES_LAYERS),
  speed: 0.04 + Math.random() * 0.08,
  size: 1.5 + Math.random() * 2.5,
  twinkle: Math.random() * Math.PI * 2,
}));

function drawWaves(bassLevel, midLevel, trebleLevel, dtSec) {
  const { releasePerSec } = VISUAL_TUNING.waves || { releasePerSec: 6.5 };
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  const segW = canvas.width / (WAVES_POINTS - 1);
  const midY = canvas.height * 0.62;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let l = 0; l < WAVES_LAYERS; l++) {
    const bandStart = l === 0 ? 0.005 : l === 1 ? 0.03 : l === 2 ? 0.1 : 0.22;
    const bandEnd = l === 0 ? 0.03 : l === 1 ? 0.1 : l === 2 ? 0.22 : 0.45;
    const layerHue = currentHue(l / WAVES_LAYERS);

    wavesPhaseDrift[l] += (0.6 + l * 0.3 + bassLevel * 0.5) * dtSec;
    const phase = wavesPhaseDrift[l];

    const layerBaseY = midY + (l - WAVES_LAYERS / 2) * 40;
    const maxLayerH = canvas.height * (0.24 + l * 0.06);

    const pts = [];
    for (let p = 0; p < WAVES_POINTS; p++) {
      const normX = p / (WAVES_POINTS - 1);
      const fFrac = bandStart + normX * (bandEnd - bandStart);
      const binIdx = Math.floor(fFrac * bufferLength);
      const rawV = Math.pow(freqData[binIdx] / 255, 0.82);

      wavesGrid[l][p] = smoothTowards(wavesGrid[l][p], rawV, remaining);
      const v = wavesGrid[l][p];

      const fluidRoll = Math.sin(normX * Math.PI * 2.5 + phase) * 0.15;
      const waveH = (v * 0.85 + fluidRoll + beatPulse * 0.15) * maxLayerH;
      const y = layerBaseY - waveH;
      pts.push({ x: p * segW, y });
    }

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
      layerBaseY - maxLayerH,
      0,
      canvas.height
    );
    grad.addColorStop(0, `hsla(${layerHue}, 90%, 65%, 0.42)`);
    grad.addColorStop(0.5, `hsla(${layerHue}, 85%, 45%, 0.18)`);
    grad.addColorStop(1, `hsla(${layerHue}, 80%, 20%, 0)`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

    ctx.strokeStyle = `hsl(${layerHue}, 95%, 72%)`;
    ctx.lineWidth = 2.4 + l * 0.4 + beatPulse * 1.2;
    applyGlow(ctx.strokeStyle, 16);
    ctx.stroke();

    for (let sp of wavesSpores) {
      if (sp.layer !== l) continue;
      sp.xNorm = (sp.xNorm + sp.speed * dtSec) % 1.0;
      sp.twinkle += dtSec * 4;

      const pIdx = Math.floor(sp.xNorm * (WAVES_POINTS - 1));
      const pt = pts[pIdx];
      if (!pt) continue;

      const sporeY = pt.y - 8 - Math.sin(sp.twinkle) * 12;
      const sporeAlpha = 0.5 + Math.sin(sp.twinkle) * 0.4 + beatPulse * 0.3;
      ctx.fillStyle = `hsla(${layerHue}, 95%, 85%, ${Math.min(1, sporeAlpha)})`;
      applyGlow(ctx.fillStyle, 10);
      ctx.beginPath();
      ctx.arc(pt.x, sporeY, sp.size * (1 + beatPulse * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
  ctx.shadowBlur = 0;
}

// ---------- Aurora Borealis mode (Sky Curtains & Solar Rays) ----------
const AURORA_LAYERS = 3;
const AURORA_POINTS = 56;
const auroraGrid = Array.from({ length: AURORA_LAYERS }, () =>
  new Array(AURORA_POINTS).fill(0)
);
const auroraPhaseDrift = [0, 1.8, 3.6];

// Twinkling night sky stars
const auroraStars = Array.from({ length: 60 }, () => ({
  x: Math.random(),
  y: Math.random() * 0.75, // in the upper 75% of sky
  size: 0.8 + Math.random() * 1.8,
  twinkle: Math.random() * Math.PI * 2,
  speed: 1.5 + Math.random() * 2.5,
}));

function drawAurora(bassLevel, midLevel, trebleLevel, dtSec) {
  const { releasePerSec } = VISUAL_TUNING.aurora;
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  const segW = canvas.width / (AURORA_POINTS - 1);
  const skyBaseY = canvas.height * 0.28; // Upper sky horizon

  // 1. Draw starry night sky background
  for (const s of auroraStars) {
    s.twinkle += dtSec * s.speed;
    const alpha = 0.25 + Math.sin(s.twinkle) * 0.25 + trebleLevel * 0.2;
    ctx.fillStyle = `rgba(240, 248, 255, ${Math.min(1, Math.max(0.05, alpha))})`;
    ctx.beginPath();
    ctx.arc(s.x * canvas.width, s.y * canvas.height, s.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let l = 0; l < AURORA_LAYERS; l++) {
    // Frequency band assignment per curtain layer:
    // Layer 0: Deep green sub-bass & bass curtain (slow sweeping majesty)
    // Layer 1: Cyan/teal vocal & mid harmonic drapery (responsive folding)
    // Layer 2: Violet/magenta high-mid & treble shimmer
    const bandStart = l === 0 ? 0.005 : l === 1 ? 0.04 : 0.15;
    const bandEnd = l === 0 ? 0.04 : l === 1 ? 0.15 : 0.42;
    const layerHue = currentHue(l / AURORA_LAYERS);

    auroraPhaseDrift[l] += (0.45 + l * 0.25 + bassLevel * 0.4) * dtSec;
    const phase = auroraPhaseDrift[l];

    const curtainTopY =
      skyBaseY + (l - AURORA_LAYERS / 2) * (canvas.height * 0.07);
    const maxDrop = canvas.height * (0.35 + l * 0.08);

    // Calculate upper spine points and lower curtain points
    const topPts = [];
    const botPts = [];

    for (let p = 0; p < AURORA_POINTS; p++) {
      const normX = p / (AURORA_POINTS - 1);
      const fFrac = bandStart + normX * (bandEnd - bandStart);
      const binIdx = Math.floor(fFrac * bufferLength);
      const rawV = Math.pow(freqData[binIdx] / 255, 0.82);

      auroraGrid[l][p] = smoothTowards(auroraGrid[l][p], rawV, remaining);
      const v = auroraGrid[l][p];

      // Celestial wind undulation
      const drapeFold =
        Math.sin(normX * Math.PI * 2.8 + phase) * 0.18 +
        Math.cos(normX * Math.PI * 5.2 - phase * 0.6) * 0.08;

      const topY = curtainTopY + drapeFold * (canvas.height * 0.08);
      // Vertical ray curtain drops downward from the sky
      const dropLen = (0.28 + v * 0.72 + beatPulse * 0.18) * maxDrop;
      const botY = topY + dropLen;

      topPts.push({ x: p * segW, y: topY });
      botPts.push({ x: p * segW, y: botY, v });
    }

    // 2. Draw vertical auroral light rays / pillars streaming downward
    const rayStep = 2;
    for (let p = 0; p < AURORA_POINTS; p += rayStep) {
      const v = botPts[p].v;
      if (v < 0.08 && beatPulse < 0.2) continue;

      const x = botPts[p].x;
      const y1 = topPts[p].y;
      const y2 = botPts[p].y;

      const rayGrad = ctx.createLinearGradient(x, y1, x, y2);
      rayGrad.addColorStop(0, `hsla(${layerHue}, 95%, 75%, 0)`);
      rayGrad.addColorStop(
        0.2,
        `hsla(${layerHue}, 95%, 65%, ${0.2 + v * 0.35})`
      );
      rayGrad.addColorStop(
        0.8,
        `hsla(${layerHue + 25}, 90%, 55%, ${0.15 + v * 0.25})`
      );
      rayGrad.addColorStop(1, `hsla(${layerHue + 45}, 85%, 45%, 0)`);

      ctx.strokeStyle = rayGrad;
      ctx.lineWidth = segW * rayStep * 0.9;
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.stroke();
    }

    // 3. Draw glowing translucent auroral veil / curtain with Bézier curves
    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y);

    // Curve along top edge
    for (let i = 0; i < topPts.length - 1; i++) {
      const xc = (topPts[i].x + topPts[i + 1].x) / 2;
      const yc = (topPts[i].y + topPts[i + 1].y) / 2;
      ctx.quadraticCurveTo(topPts[i].x, topPts[i].y, xc, yc);
    }
    ctx.lineTo(topPts[topPts.length - 1].x, topPts[topPts.length - 1].y);

    // Curve along bottom hanging edge in reverse
    for (let i = botPts.length - 1; i > 0; i--) {
      const xc = (botPts[i].x + botPts[i - 1].x) / 2;
      const yc = (botPts[i].y + botPts[i - 1].y) / 2;
      ctx.quadraticCurveTo(botPts[i].x, botPts[i].y, xc, yc);
    }
    ctx.lineTo(botPts[0].x, botPts[0].y);
    ctx.closePath();

    const curtainGrad = ctx.createLinearGradient(
      0,
      curtainTopY,
      0,
      curtainTopY + maxDrop
    );
    curtainGrad.addColorStop(0, `hsla(${layerHue - 15}, 95%, 70%, 0)`);
    curtainGrad.addColorStop(
      0.25,
      `hsla(${layerHue}, 95%, 62%, ${0.35 + bassLevel * 0.15})`
    );
    curtainGrad.addColorStop(
      0.75,
      `hsla(${layerHue + 30}, 90%, 50%, ${0.2 + midLevel * 0.12})`
    );
    curtainGrad.addColorStop(1, `hsla(${layerHue + 60}, 85%, 40%, 0)`);

    ctx.fillStyle = curtainGrad;
    ctx.fill();

    // 4. Luminous celestial spine (top edge glow)
    ctx.beginPath();
    ctx.moveTo(topPts[0].x, topPts[0].y);
    for (let i = 0; i < topPts.length - 1; i++) {
      const xc = (topPts[i].x + topPts[i + 1].x) / 2;
      const yc = (topPts[i].y + topPts[i + 1].y) / 2;
      ctx.quadraticCurveTo(topPts[i].x, topPts[i].y, xc, yc);
    }
    ctx.lineTo(topPts[topPts.length - 1].x, topPts[topPts.length - 1].y);

    ctx.strokeStyle = `hsla(${layerHue}, 95%, 80%, ${0.7 + beatPulse * 0.3})`;
    ctx.lineWidth = 2.0 + l * 0.4 + beatPulse * 1.5;
    applyGlow(ctx.strokeStyle, 18);
    ctx.stroke();
  }

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

  const bass = bandAverage(freqData, 0, 0.015); // ~0-300Hz (True Bass)
  const mid = bandAverage(freqData, 0.015, 0.1); // ~300-2000Hz (Mids)
  const treble = bandAverage(freqData, 0.1, 0.5); // ~2000-10000Hz (Highs)
  const bassLevel = Math.min(
    1,
    normalizeEnergy(
      bass,
      AUDIO_TUNING.particleFloor,
      AUDIO_TUNING.particleRange
    ) * state.sensitivity
  );
  const midLevel = Math.min(
    1,
    normalizeEnergy(mid, 18, 180) * state.sensitivity
  );
  const trebleLevel = Math.min(
    1,
    normalizeEnergy(treble, 14, 170) * state.sensitivity
  );
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
    case "tunnel":
      drawTunnel(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "waves":
      drawWaves(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "aurora":
      drawAurora(bassLevel, midLevel, trebleLevel, dtSec);
      break;
  }
}
