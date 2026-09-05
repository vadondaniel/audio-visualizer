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
let smoothedTunnelEnergy = 0;
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
  const remaining = state.smoothingEnabled
    ? Math.exp(-VISUAL_TUNING.tunnel.releasePerSec * dtSec)
    : 0;

  const rawEnergy = bassLevel * 0.55 + midLevel * 0.3 + trebleLevel * 0.15;
  smoothedTunnelEnergy = smoothTowards(
    smoothedTunnelEnergy,
    rawEnergy,
    remaining
  );
  // Gamma contrast curve: low levels stay serene; high levels punch through clearly
  const energy = Math.min(1, Math.pow(smoothedTunnelEnergy, 1.12));
  const surgeEnergy = Math.pow(energy, 1.75);

  // 1. Visceral camera shake — ONLY kicks in on real beat hits & loud drops
  const isImpact = beatPulse > 0.55 || bassLevel > 0.7;
  const shakeAmp = isImpact
    ? Math.pow(beatPulse, 1.8) * 9 + Math.pow(bassLevel - 0.45, 2) * 8
    : 0;
  const shakeX = shakeAmp > 0.5 ? (Math.random() - 0.5) * shakeAmp : 0;
  const shakeY = shakeAmp > 0.5 ? (Math.random() - 0.5) * shakeAmp : 0;

  const cx = canvas.width / 2 + shakeX;
  const cy = canvas.height / 2 + shakeY;

  // Aperture dynamic range:
  // Pronounced aperture threshold:
  // Below threshold: narrow, deep, sleek 0.35 cylindrical corridor
  // Above threshold: massive 0.88 wide-angle warp vortex
  const minDim = Math.min(canvas.width, canvas.height);
  const maxDim = Math.max(canvas.width, canvas.height);
  const maxR =
    minDim * 0.35 * (1 - surgeEnergy * 0.86) +
    maxDim * (0.44 + surgeEnergy * 0.38 + beatPulse * 0.15) * surgeEnergy;

  // Dynamic Camera Focal Depth:
  // Low intensity = deep telephoto lens (3.4 exponent), rings recede far into infinite distance
  // High intensity = wide-angle fisheye (2.15 exponent), rings rush past the camera
  const depthExp = 3.4 - surgeEnergy * 1.25;

  // Speed dynamic range:
  // Low intensity = serene, hypnotic cruise (0.15)
  // High intensity = supersonic hyperdrive surge (up to 6.0+)
  const warpBoost =
    Math.pow(energy, 2.2) * 3.8 + Math.pow(beatPulse, 1.6) * 4.2;
  const currentSpeed = (0.15 + warpBoost) * dtSec;
  tunnelZOffset = (tunnelZOffset + currentSpeed) % 1.0;
  tunnelAngle += (0.1 + trebleLevel * 0.85 + beatPulse * 0.5) * dtSec;

  // Low-intensity feature: Atmospheric Cosmic Nebula at the vanishing point
  // Pronounced threshold: HUD and nebula remain clean and steady for energy < 0.42,
  // then dramatically glitch and shatter when entering warp speed!
  const inLowRegime = energy < 0.42 && beatPulse < 0.45;
  const hudAlpha = inLowRegime
    ? Math.max(0, 1 - Math.pow(energy / 0.42, 2.0))
    : 0;
  if (hudAlpha > 0.05) {
    const nebR = maxR * 0.52;
    const nebGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, nebR);
    const nebHue = (currentHue(0) + 35) % 360;
    nebGrad.addColorStop(0, `hsla(${nebHue}, 70%, 50%, ${0.28 * hudAlpha})`);
    nebGrad.addColorStop(
      0.5,
      `hsla(${(nebHue + 40) % 360}, 60%, 25%, ${0.14 * hudAlpha})`
    );
    nebGrad.addColorStop(1, "transparent");
    ctx.fillStyle = nebGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, nebR, 0, Math.PI * 2);
    ctx.fill();

    // Futuristic Navigation Reticle / Calibrated Horizon Ring
    ctx.save();
    const reticleR = maxR * 0.16;
    ctx.strokeStyle = `hsla(${currentHue(0)}, 80%, 75%, ${0.24 * hudAlpha})`;
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
  // Pronounced star threshold:
  // Below threshold: 100% crisp pinpoint stars drifting peacefully
  // Above threshold: Instant hyperdrive warp laser streaks!
  const isWarp = energy > 0.38 || beatPulse > 0.42;
  const streakLength = isWarp
    ? Math.pow(energy, 1.5) * 0.28 + beatPulse * 0.1
    : 0;

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

    // Pronounced deformation threshold:
    // Rings remain pristine and smooth below threshold,
    // aggressively rippling into audio shockwaves above threshold
    const deformScale = 0.08 + Math.pow(energy, 1.6) * 0.85 + beatPulse * 0.35;

    for (let seg = 0; seg < TUNNEL_SEGMENTS; seg++) {
      const normSeg =
        seg < TUNNEL_SEGMENTS / 2
          ? seg / (TUNNEL_SEGMENTS / 2)
          : (TUNNEL_SEGMENTS - seg) / (TUNNEL_SEGMENTS / 2);
      const binIdx = Math.floor(normSeg * (bufferLength * 0.38));
      const rawAmp = Math.pow(freqData[binIdx] / 255, 0.82);

      tunnelGrid[r][seg] = smoothTowards(tunnelGrid[r][seg], rawAmp, remaining);
      const v = tunnelGrid[r][seg];

      const deformedR = ringRadius * (0.94 + v * deformScale);
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
  // Pronounced wall panel threshold:
  // Dark and sleek during low/medium intensity,
  // igniting with intense neon screen glow during high-intensity drops
  if (energy > 0.38 || beatPulse > 0.42) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let r = 0; r < TUNNEL_RINGS - 1; r++) {
      const ringA = ringPoints[r];
      const ringB = ringPoints[r + 1];
      if (!ringA || !ringB) continue;

      for (let seg = 0; seg < TUNNEL_SEGMENTS; seg += 2) {
        const nextSeg = (seg + 1) % TUNNEL_SEGMENTS;
        const vAvg = (ringA.points[seg].v + ringB.points[seg].v) / 2;
        if (vAvg < 0.28 && beatPulse < 0.42) continue;

        const panelAlpha =
          Math.min(0.45, vAvg * 0.48 + beatPulse * 0.3) * (1 - ringA.rawZ);
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
  const railAlpha = 0.08 + Math.pow(energy, 1.4) * 0.5 + beatPulse * 0.35;
  ctx.lineWidth = 0.7 + Math.pow(energy, 1.4) * 1.8 + beatPulse * 1.8;
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
    if (energy > 0.25)
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
    const ringAlpha = baseRingAlpha * (0.22 + Math.pow(energy, 1.3) * 0.78);
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
      (0.7 + zDepth * 3.0) * (0.5 + Math.pow(energy, 1.3) * 0.8) +
      Math.pow(energy, 1.5) * 2.8 +
      beatPulse * 2.0;
    if (energy > 0.2)
      applyGlow(ctx.strokeStyle, 6 + energy * 12 + beatPulse * 10);
    ctx.stroke();
  }

  // 7. Shockwave blast rings erupting on beats
  if (beatPulse > 0.42) {
    const prog1 = Math.pow(1 - beatPulse, 0.75);
    const prog2 = Math.pow(1 - beatPulse, 1.1);
    const shockwaveR1 = maxR * (0.15 + prog1 * 0.85);
    const shockwaveR2 = maxR * (0.08 + prog2 * 0.65);

    ctx.beginPath();
    ctx.arc(cx, cy, shockwaveR1, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${currentHue(0)}, 95%, 88%, ${beatPulse * 0.75})`;
    ctx.lineWidth = 2.5 + beatPulse * 6;
    applyGlow(ctx.strokeStyle, 26);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, shockwaveR2, 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${currentHue(0.2)}, 90%, 75%, ${beatPulse * 0.45})`;
    ctx.lineWidth = 1.5 + beatPulse * 3;
    ctx.stroke();
  }

  // 8. Pulsing vanishing point singularity in center
  // Low intensity: tiny 4px calm jewel in infinite distance with subtle breathing
  // High intensity: huge 45px blazing supernova core
  const lowPulse = Math.sin(Date.now() * 0.003) * 0.8;
  const centerR =
    Math.max(2.5, 4 + lowPulse * (1 - energy)) +
    Math.pow(energy, 1.6) * 20 +
    Math.pow(bassLevel, 1.5) * 24 +
    beatPulse * 26;
  ctx.beginPath();
  ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${currentHue(0)}, 95%, ${70 + energy * 18 + beatPulse * 12}%, ${0.4 + energy * 0.5 + beatPulse * 0.1})`;
  applyGlow(ctx.fillStyle, 8 + energy * 26 + beatPulse * 20);
  ctx.fill();

  ctx.shadowBlur = 0;
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
    const rawVal = Math.pow(bandAverage(freqData, loFrac, hiFrac) / 255, 0.85);
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
      Math.pow(bandAverage(freqData, loFrac, hiFrac) / 255, 0.82) *
      state.sensitivity;
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
  const rawIntensity = Math.min(
    1,
    bassLevel * 0.45 + midLevel * 0.35 + trebleLevel * 0.2
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
    normalizeEnergy(mid, 15, 165) * state.sensitivity
  );
  const trebleLevel = Math.min(
    1,
    normalizeEnergy(treble, 12, 155) * state.sensitivity
  );
  updateBeat(bass, elapsedMs, dtSec);

  if (THEMES[state.theme].colorCycle || THEMES[state.theme].cycle) {
    const { baseDegPerSec, midDegPerSecPerUnit } = VISUAL_TUNING.hueCycle;
    state.hueShift =
      (state.hueShift + (baseDegPerSec + mid * midDegPerSecPerUnit) * dtSec) %
      360;
  }

  clearFrame(elapsedMs);

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
  }
}
