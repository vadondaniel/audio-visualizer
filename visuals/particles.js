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
// Additional spectral descriptors for particle-mode dimensionality. These are
// deliberately low-cost: one linear scan of the analyser buffer per frame.
const particleAudio = {
  subBass: 0,
  bass: 0,
  mids: 0,
  presence: 0,
  air: 0,
  centroid: 0.5,
  flux: 0,
  contrast: 0,
  prevSpectrum: null,
};

function updateParticleAudioFeatures() {
  if (!freqData || !bufferLength) return particleAudio;

  // Approximate spectral regions without assuming a particular sample rate.
  // fftSize is 2048 in the audio engine, so these map closely to musical bands.
  const nyquist = audioCtx?.sampleRate ? audioCtx.sampleRate * 0.5 : 24000;
  const hzPerBin = nyquist / bufferLength;
  const bands = [
    [28, 90],
    [90, 250],
    [250, 2000],
    [2000, 6000],
    [6000, 16000],
  ];
  const sums = [0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0];
  let weighted = 0;
  let total = 0;
  let flux = 0;
  let peak = 0;

  if (
    !particleAudio.prevSpectrum ||
    particleAudio.prevSpectrum.length !== bufferLength
  ) {
    particleAudio.prevSpectrum = new Uint8Array(bufferLength);
  }

  for (let i = 1; i < bufferLength; i++) {
    const v = freqData[i] / 255;
    if (v <= 0) {
      particleAudio.prevSpectrum[i] = 0;
      continue;
    }

    const hz = i * hzPerBin;
    for (let b = 0; b < bands.length; b++) {
      if (hz >= bands[b][0] && hz < bands[b][1]) {
        sums[b] += v;
        counts[b]++;
        break;
      }
    }

    weighted += hz * v;
    total += v;
    peak = Math.max(peak, v);
    const previous = particleAudio.prevSpectrum[i] / 255;
    if (v > previous) flux += v - previous;
    particleAudio.prevSpectrum[i] = freqData[i];
  }

  const raw = sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0));
  const rawCentroid =
    total > 0 ? weighted / total / nyquist : particleAudio.centroid;
  const rawFlux = Math.min(1, flux / Math.max(12, bufferLength * 0.045));
  const mean = total / Math.max(1, bufferLength - 1);
  const rawContrast = Math.min(
    1,
    Math.max(0, (peak - mean) / Math.max(0.08, peak))
  );
  const smooth = 0.12;
  const attack = 0.28;

  particleAudio.subBass += (raw[0] - particleAudio.subBass) * smooth;
  particleAudio.bass += (raw[1] - particleAudio.bass) * smooth;
  particleAudio.mids += (raw[2] - particleAudio.mids) * smooth;
  particleAudio.presence += (raw[3] - particleAudio.presence) * smooth;
  particleAudio.air += (raw[4] - particleAudio.air) * smooth;
  particleAudio.centroid += (rawCentroid - particleAudio.centroid) * smooth;
  particleAudio.flux += (rawFlux - particleAudio.flux) * attack;
  particleAudio.contrast += (rawContrast - particleAudio.contrast) * smooth;

  return particleAudio;
}

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

// Reusable render buffers. Particle simulation remains object-based, but the hot
// rendering path stores only the values it actually needs and batches canvas work.
const PARTICLE_RENDER_CAP = VISUAL_TUNING.particles.cap;
const particleRender = {
  x: new Float32Array(PARTICLE_RENDER_CAP),
  y: new Float32Array(PARTICLE_RENDER_CAP),
  px: new Float32Array(PARTICLE_RENDER_CAP),
  py: new Float32Array(PARTICLE_RENDER_CAP),
  r: new Float32Array(PARTICLE_RENDER_CAP),
  alpha: new Float32Array(PARTICLE_RENDER_CAP),
  hue: new Float32Array(PARTICLE_RENDER_CAP),
  bin: new Uint8Array(PARTICLE_RENDER_CAP),
  alphaBin: new Uint8Array(PARTICLE_RENDER_CAP),
  count: 0,
};

const PARTICLE_HUE_BINS = 12;
const PARTICLE_ALPHA_BINS = 4;

function beginParticleBatch() {
  ctx.beginPath();
}

function drawParticles(bass, bassLevel, midLevel, trebleLevel, elapsedMs) {
  const dt = elapsedMs / FRAME_MS;

  const rawEnergy = applyValueHandling(
    bassLevel * 0.48 + midLevel * 0.3 + trebleLevel * 0.22,
    state.valueHandling
  );

  // Keep the history bounded without shifting the whole array every frame.
  const historyNow = { value: rawEnergy, t: audioClockMs };
  energyHistory.push(historyNow);
  while (
    energyHistory.length > 1 &&
    audioClockMs - energyHistory[0].t > ENERGY_HISTORY_MS
  ) {
    energyHistory.shift();
  }
  let histMin = 1;
  let histMax = 0;
  for (let i = 0; i < energyHistory.length; i++) {
    const e = energyHistory[i];
    if (e.value < histMin) histMin = e.value;
    if (e.value > histMax) histMax = e.value;
  }
  const span = Math.max(0.08, histMax - histMin);
  const normalized = Math.min(1, Math.max(0, (rawEnergy - histMin) / span));

  const fastFactor = normalized > energyNow ? 0.55 : 0.23;
  energyNow += (normalized - energyNow) * Math.min(1, fastFactor * dt);
  energyTrend += (normalized - energyTrend) * Math.min(1, 0.06 * dt);

  const audio = updateParticleAudioFeatures();
  const dimensionalBass = Math.min(1, bassLevel * 0.58 + audio.subBass * 0.82);
  const dimensionalMid = Math.min(
    1,
    midLevel * 0.48 + audio.mids * 0.88 + audio.presence * 0.22
  );
  const dimensionalTreble = Math.min(
    1,
    trebleLevel * 0.46 + audio.presence * 0.56 + audio.air * 0.78
  );
  const brightness = Math.min(1, audio.centroid * 1.5);
  const transient = Math.min(1, audio.flux * 1.55 + beatPulse * 0.72);
  const contrast = Math.min(1, audio.contrast * 1.25);

  particlePhase +=
    dt * (0.48 + trebleLevel * 1.25 + brightness * 1.05 + beatPulse * 1.4);

  const levels = [bassLevel, midLevel, trebleLevel];
  const SPAWN_RATE = 88 * Math.pow(state.particleDensity, 1.15);
  const AMBIENT_FLOOR = 0.045;
  for (let b = 0; b < 3; b++) {
    const bandLevel =
      b === 0
        ? Math.min(1, levels[b] * 0.62 + dimensionalBass * 0.7)
        : b === 1
          ? Math.min(1, levels[b] * 0.64 + dimensionalMid * 0.6)
          : Math.min(1, levels[b] * 0.58 + dimensionalTreble * 0.72);
    const rate =
      (AMBIENT_FLOOR + bandLevel * (b === 0 ? 0.9 : 1.08)) *
      SPAWN_RATE *
      (0.82 + contrast * 0.26);
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
  const speedScale =
    (0.24 + energyNow * 2.45 + dimensionalBass * 0.52 + transient * 0.48) *
    style.speed;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const minDim = Math.min(canvas.width, canvas.height);

  // Shockwaves are few enough to stay individually rendered, but avoid save/restore
  // churn and only touch the expensive glow state once per wave.
  ctx.globalCompositeOperation = "lighter";
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
    const alpha = Math.min(0.42, wave.life * 0.55);
    ctx.strokeStyle = `hsla(${hue}, 95%, 70%, ${alpha})`;
    ctx.lineWidth = wave.width * wave.life;
    ctx.shadowBlur = (12 + wave.life * 9) * state.glowIntensity;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(cx, cy, wave.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  const coreRadius = minDim * (0.055 + energyNow * 0.032 + beatPulse * 0.045);
  drawParticleSpectrum(bassLevel, midLevel, trebleLevel, coreRadius * 1.25);

  const overCap = particles.length - PARTICLE_RENDER_CAP;
  if (overCap > 0) {
    const trim = 0.055 * dt;
    for (let i = 0; i < overCap; i++) particles[i].life -= trim;
  }

  // Simulate once, store compact render data, then batch the expensive canvas work.
  // This is intentionally two-pass: extra JS comparisons are substantially cheaper
  // than thousands of beginPath()/fill()/stroke() calls on Canvas2D.
  const theme = THEMES[state.theme];
  const count = Math.min(particles.length, PARTICLE_RENDER_CAP);
  const rr = particleRender;
  rr.count = 0;

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
      (0.62 + energyNow * 1.45 + dimensionalMid * 1.25 + brightness * 0.42);
    p.vx += (nx * 0.018 + tangentX * vortex) * dt;
    p.vy += (ny * 0.018 + tangentY * vortex) * dt;

    const returnForce =
      Math.min(0.12, (dist / minDim) * 0.065) *
      (0.7 + energyNow * 0.82 + dimensionalBass * 0.45);

    // Midrange controls the spiral plane, while spectral flux adds short-lived
    // turbulence so drums and sharp attacks change the geometry rather than just
    // making everything brighter.
    const turbulence =
      (0.008 + transient * 0.026 + contrast * 0.012) *
      Math.sin(p.twinkle * 1.7 + particlePhase + p.hueOffset * 17);
    p.vx += (-ny * turbulence + nx * turbulence * 0.35) * dt;
    p.vy += (nx * turbulence + ny * turbulence * 0.35) * dt;
    p.vx -= nx * returnForce * dt;
    p.vy -= ny * returnForce * dt;

    p.x += p.vx * speedScale * dt;
    p.y += p.vy * speedScale * dt;
    p.vx *= Math.pow(p.drag, dt);
    p.vy *= Math.pow(p.drag, dt);
    p.twinkle +=
      p.twinkleSpeed *
      dt *
      (1 + trebleLevel * 1.8 + dimensionalTreble * 1.4 + transient * 0.85);
    p.life -= p.decay * decayScale * dt;

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
    if (rr.count >= count) continue;

    let hueOffset = p.hueOffset + p.z * 0.02;
    if (theme.rainbow) {
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
        p.z * (0.055 + brightness * 0.04) +
        dimensionalMid * 0.055 +
        dimensionalTreble * 0.035 +
        particlePhase * (0.0012 + brightness * 0.0009);
    }

    const hue = currentHue(hueOffset);
    const shimmer = 0.72 + Math.sin(p.twinkle) * 0.28;
    const depthScale =
      0.5 + p.z * (0.72 + dimensionalBass * 0.22) + brightness * 0.08;
    const r =
      p.size *
      depthScale *
      (0.26 + energyNow * 0.96 + dimensionalTreble * 0.34 + transient * 0.22) *
      (0.58 + p.life * 0.62);
    const alpha =
      p.life *
      shimmer *
      (0.46 + energyNow * 0.78 + dimensionalTreble * 0.26 + contrast * 0.12) *
      (0.68 + p.z * 0.36);

    // Tiny particles contribute little visually at peak intensity. Keep simulating
    // them, but skip their canvas representation when they fall below visibility.
    if (r < 0.72 || alpha < 0.055) continue;

    const idx = rr.count++;
    rr.x[idx] = p.x;
    rr.y[idx] = p.y;
    rr.px[idx] = p.px;
    rr.py[idx] = p.py;
    rr.r[idx] = r;
    rr.alpha[idx] = Math.min(1, alpha);
    rr.hue[idx] = hue;
    rr.bin[idx] = Math.max(
      0,
      Math.min(
        PARTICLE_HUE_BINS - 1,
        Math.floor(((hue % 360) / 360) * PARTICLE_HUE_BINS)
      )
    );
    rr.alphaBin[idx] = Math.max(
      0,
      Math.min(
        PARTICLE_ALPHA_BINS - 1,
        Math.floor(Math.min(0.999, rr.alpha[idx]) * PARTICLE_ALPHA_BINS)
      )
    );
  }

  // Batched trails: 12 hue groups, one stroke per group. Only sufficiently large
  // particles get trails, which preserves motion readability without spending work
  // on subpixel streaks.
  const trailWidthScale = theme.rainbow ? 0.78 : 0.55;
  for (let hb = 0; hb < PARTICLE_HUE_BINS; hb++) {
    beginParticleBatch();
    let hasPath = false;
    for (let i = 0; i < rr.count; i++) {
      if (rr.bin[i] !== hb || rr.r[i] <= 2.2) continue;
      const a = Math.min(0.28, rr.alpha[i] * trailWidthScale);
      if (a <= 0.02) continue;
      ctx.moveTo(rr.px[i], rr.py[i]);
      ctx.lineTo(rr.x[i], rr.y[i]);
      hasPath = true;
    }
    if (hasPath) {
      const hue = (hb + 0.5) * (360 / PARTICLE_HUE_BINS);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `hsla(${hue}, 92%, 68%, 0.22)`;
      ctx.lineWidth = Math.max(0.75, 1.0 + energyNow * 0.8);
      ctx.stroke();
    }
  }

  // Main particle bodies: 12 hue groups × 4 coarse alpha levels = at most 48 fills,
  // instead of thousands of individual fills. Quantization is effectively invisible
  // because the particles overlap and their positions remain fully continuous.
  const rainbowBoost = theme.rainbow ? 7 : 0;
  for (let ab = 0; ab < PARTICLE_ALPHA_BINS; ab++) {
    const alpha = (ab + 0.5) / PARTICLE_ALPHA_BINS;
    for (let hb = 0; hb < PARTICLE_HUE_BINS; hb++) {
      beginParticleBatch();
      let hasPath = false;
      for (let i = 0; i < rr.count; i++) {
        if (rr.bin[i] !== hb || rr.alphaBin[i] !== ab) continue;
        ctx.moveTo(rr.x[i] + rr.r[i], rr.y[i]);
        ctx.arc(rr.x[i], rr.y[i], rr.r[i], 0, Math.PI * 2);
        hasPath = true;
      }
      if (!hasPath) continue;
      const hue = (hb + 0.5) * (360 / PARTICLE_HUE_BINS);
      const lightness = Math.min(84, 71 + rainbowBoost + trebleLevel * 4);
      ctx.fillStyle = `hsla(${hue}, ${theme.rainbow ? 96 : 92}%, ${lightness}%, ${alpha})`;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      ctx.fill();
    }
  }

  // Glow is now a separate, coarse-grained pass. The shadow state changes only once
  // per hue bucket, and only large luminous particles participate.
  for (let hb = 0; hb < PARTICLE_HUE_BINS; hb++) {
    beginParticleBatch();
    let maxR = 0;
    let hasGlow = false;
    for (let i = 0; i < rr.count; i++) {
      const r = rr.r[i];
      if (rr.bin[i] !== hb || r <= 3.0 || rr.alpha[i] <= 0.18) continue;
      ctx.moveTo(rr.x[i] + r, rr.y[i]);
      ctx.arc(rr.x[i], rr.y[i], r, 0, Math.PI * 2);
      if (r > maxR) maxR = r;
      hasGlow = true;
    }
    if (!hasGlow) continue;
    const hue = (hb + 0.5) * (360 / PARTICLE_HUE_BINS);
    ctx.fillStyle = `hsla(${hue}, 100%, 72%, 0.28)`;
    const glow = Math.min(18, 3 + maxR * 1.8) * state.glowIntensity;
    ctx.shadowBlur = glow;
    ctx.shadowColor = ctx.fillStyle;
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  // Retain the strongest highlights, but only for genuinely large particles.
  if (theme.rainbow) {
    for (let hb = 0; hb < PARTICLE_HUE_BINS; hb++) {
      beginParticleBatch();
      let hasPath = false;
      for (let i = 0; i < rr.count; i++) {
        const r = rr.r[i];
        if (rr.bin[i] !== hb || r <= 5.4 || rr.alpha[i] <= 0.45) continue;
        ctx.moveTo(rr.x[i] - r * 1.8, rr.y[i]);
        ctx.lineTo(rr.x[i] + r * 1.8, rr.y[i]);
        ctx.moveTo(rr.x[i], rr.y[i] - r * 1.8);
        ctx.lineTo(rr.x[i], rr.y[i] + r * 1.8);
        hasPath = true;
      }
      if (hasPath) {
        const hue = (hb + 0.5) * (360 / PARTICLE_HUE_BINS);
        ctx.strokeStyle = `hsla(${hue}, 100%, 82%, 0.34)`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  drawParticleCore(
    Math.min(1, bassLevel * 0.7 + dimensionalBass * 0.5),
    Math.min(1, midLevel * 0.65 + dimensionalMid * 0.55),
    Math.min(1, trebleLevel * 0.62 + dimensionalTreble * 0.52),
    Math.min(1, energyNow * 0.72 + transient * 0.2 + contrast * 0.08)
  );
  ctx.globalCompositeOperation = "source-over";
}
