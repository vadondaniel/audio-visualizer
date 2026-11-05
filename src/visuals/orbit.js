// One spectrum quarter reflected across both local axes. The entire assembly
// shares one rotation; audio pulls the rope inward and pushes bars outward.
const ORBIT_BANDS = 40;
const ORBIT_ROPE_POINTS = 192;
const orbitSpectrum = new Float64Array(ORBIT_BANDS + 1);
const orbitRope = new Float64Array(ORBIT_ROPE_POINTS * 2);
const orbitDisplacement = new Float64Array(ORBIT_BANDS + 1);
const orbitVelocity = new Float64Array(ORBIT_BANDS + 1);
const orbitAcceleration = new Float64Array(ORBIT_BANDS + 1);
const orbitBandDb = new Float64Array(ORBIT_BANDS + 1);
let orbitFftDb = new Float32Array(0);
let orbitPeakDb = -65;
let orbitRotation = 0;

function orbitAudioLevel(db, referenceDb, curve, sensitivity) {
  // Work in amplitude, not the analyser's display-scaled bytes. Apply gain
  // before the selected curve, with headroom instead of flattening at 1.
  return spectrumResponseLevel(db, referenceDb, curve, sensitivity);
}

function updateOrbitSpectrum(dtSec) {
  if (orbitFftDb.length !== freqData.length)
    orbitFftDb = new Float32Array(freqData.length);
  if (typeof analyser !== "undefined" && analyser?.getFloatFrequencyData) {
    // Floats retain peaks above maxDecibels, where byte FFT data clips to 255.
    analyser.getFloatFrequencyData(orbitFftDb);
  } else {
    // Keep synthetic/benchmark analysers, which provide bytes only, usable.
    for (let i = 0; i < freqData.length; i++)
      orbitFftDb[i] = -100 + (freqData[i] * 70) / 255;
  }
  let peak = -65;
  for (let i = 0; i <= ORBIT_BANDS; i++) {
    const lo = Math.floor(
      0.002 * Math.pow(180, i / (ORBIT_BANDS + 1)) * freqData.length
    );
    const hi = Math.min(
      freqData.length,
      Math.max(
        lo + 1,
        Math.floor(
          0.002 * Math.pow(180, (i + 1) / (ORBIT_BANDS + 1)) * freqData.length
        )
      )
    );
    orbitBandDb[i] = spectrumBandDb(orbitFftDb, lo, hi);
    peak = Math.max(peak, orbitBandDb[i]);
  }
  // Fast peak tracking, slow recovery between hits. The floor prevents quiet
  // noise from being boosted into a full-strength spectrum.
  orbitPeakDb = Math.max(peak, orbitPeakDb - Math.max(0, dtSec) * 12);
  const remaining = state.smoothingEnabled
    ? Math.exp(-VISUAL_TUNING.orbit.releasePerSec * dtSec)
    : 0;
  for (let i = 0; i <= ORBIT_BANDS; i++) {
    const target = applyBassModulation(
      orbitAudioLevel(
        orbitBandDb[i],
        orbitPeakDb,
        state.valueHandling,
        state.sensitivity
      )
    );
    orbitSpectrum[i] = smoothTowards(orbitSpectrum[i], target, remaining);
  }
}

function advanceOrbitRope(displacement, velocity, target, acceleration, dtSec) {
  if (!Number.isFinite(dtSec) || dtSec <= 0) return;
  // Small, bounded steps keep the connected springs stable at low frame rates
  // and avoid trying to simulate a long pause when the app resumes.
  const duration = Math.min(0.1, dtSec);
  const steps = Math.ceil(duration * 240);
  const step = duration / steps;
  const damping = Math.exp(-18 * step);
  const end = displacement.length - 1;
  for (let iteration = 0; iteration < steps; iteration++) {
    for (let i = 0; i <= end; i++) {
      // Reflect the neighboring nodes at each axis, matching the four-way
      // geometry without pinning the rope or introducing a seam.
      const left = displacement[i === 0 ? 1 : i - 1];
      const right = displacement[i === end ? end - 1 : i + 1];
      acceleration[i] =
        320 * (target[i] - displacement[i]) +
        2200 * (left + right - 2 * displacement[i]);
    }
    for (let i = 0; i <= end; i++) {
      velocity[i] = (velocity[i] + acceleration[i] * step) * damping;
      displacement[i] += velocity[i] * step;
      if (displacement[i] < 0 || displacement[i] > 1) {
        displacement[i] = Math.min(1, Math.max(0, displacement[i]));
        velocity[i] = 0;
      }
    }
  }
}

function orbitRopeEnvelope(position) {
  const at = position * ORBIT_BANDS;
  const index = Math.floor(at);
  const fraction = at - index;
  return (
    orbitDisplacement[index] * (1 - fraction) +
    orbitDisplacement[Math.min(ORBIT_BANDS, index + 1)] * fraction
  );
}

function orbitMirrorPosition(angle) {
  const quarter = Math.PI / 2;
  const phase = ((angle % Math.PI) + Math.PI) % Math.PI;
  return phase <= quarter ? phase / quarter : (Math.PI - phase) / quarter;
}

function orbitInnerRadius(radius, level) {
  return radius * (0.92 - Math.min(1, Math.max(0, level)) * 0.5);
}

function orbitOuterLength(radius, level) {
  return radius * (0.025 + Math.min(1, Math.max(0, level)) * 0.7);
}

function orbitSmoothedBand(index, spread) {
  let sum = 0;
  for (let offset = -spread; offset <= spread; offset++)
    sum +=
      orbitSpectrum[Math.min(ORBIT_BANDS, Math.max(0, index + offset))] *
      (spread + 1 - Math.abs(offset));
  return sum / ((spread + 1) * (spread + 1));
}

function orbitEnvelope(position, spread = 2) {
  const at = position * ORBIT_BANDS;
  const index = Math.floor(at);
  const fraction = at - index;
  return (
    orbitSmoothedBand(index, spread) * (1 - fraction) +
    orbitSmoothedBand(index + 1, spread) * fraction
  );
}

function drawOrbit(bassLevel, midLevel, trebleLevel, dtSec) {
  const tuning = VISUAL_TUNING.orbit;
  updateOrbitSpectrum(dtSec);
  advanceOrbitRope(
    orbitDisplacement,
    orbitVelocity,
    orbitSpectrum,
    orbitAcceleration,
    dtSec
  );
  orbitRotation = (orbitRotation + tuning.spinPerSec * dtSec) % (Math.PI * 2);
  const size = Math.min(canvas.width, canvas.height);
  const radius =
    size * tuning.radiusFrac * (1 + bassLevel * 0.035 + beatPulse * 0.02);
  const gap = Math.max(4, size * 0.009);
  const barCount = 128;
  const barWidth = ((Math.PI * 2 * (radius + gap)) / barCount) * 0.73;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(orbitRotation);
  ctx.lineCap = "butt";
  ctx.lineWidth = barWidth;
  for (let i = 0; i < barCount; i++) {
    const angle = ((i + 0.5) * Math.PI * 2) / barCount;
    const position = orbitMirrorPosition(angle);
    const length = orbitOuterLength(radius, orbitEnvelope(position));
    const inner = radius + gap;
    ctx.strokeStyle = themeCssColor(currentHue(position), 90, 60, 1);
    applyGlow(ctx.strokeStyle, 2.5);
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
    ctx.lineTo(
      Math.cos(angle) * (inner + length),
      Math.sin(angle) * (inner + length)
    );
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle =
    THEMES[state.theme]?.monochrome === "black" ? "#f1f1f4" : "#050506";
  ctx.fill();
  ctx.strokeStyle = themeCssColor(currentHue(0.5), 70, 80, 0.9);
  ctx.lineWidth = Math.max(1.2, size * 0.0025);
  ctx.stroke();

  for (let i = 0; i < ORBIT_ROPE_POINTS; i++) {
    const angle = (i * Math.PI * 2) / ORBIT_ROPE_POINTS;
    const r = orbitInnerRadius(
      radius,
      orbitRopeEnvelope(orbitMirrorPosition(angle))
    );
    orbitRope[i * 2] = Math.cos(angle) * r;
    orbitRope[i * 2 + 1] = Math.sin(angle) * r;
  }
  ctx.beginPath();
  ctx.moveTo(orbitRope[0], orbitRope[1]);
  // Closed Catmull–Rom interpolation gives one continuous rope with a smooth
  // seam and smooth joins at all four reflection axes.
  for (let i = 0; i < ORBIT_ROPE_POINTS; i++) {
    const previous = ((i + ORBIT_ROPE_POINTS - 1) % ORBIT_ROPE_POINTS) * 2;
    const current = i * 2;
    const next = ((i + 1) % ORBIT_ROPE_POINTS) * 2;
    const following = ((i + 2) % ORBIT_ROPE_POINTS) * 2;
    ctx.bezierCurveTo(
      orbitRope[current] + (orbitRope[next] - orbitRope[previous]) / 6,
      orbitRope[current + 1] +
        (orbitRope[next + 1] - orbitRope[previous + 1]) / 6,
      orbitRope[next] - (orbitRope[following] - orbitRope[current]) / 6,
      orbitRope[next + 1] -
        (orbitRope[following + 1] - orbitRope[current + 1]) / 6,
      orbitRope[next],
      orbitRope[next + 1]
    );
  }
  ctx.closePath();
  const gradient = ctx.createLinearGradient(-radius, -radius, radius, radius);
  for (let i = 0; i <= 6; i++)
    gradient.addColorStop(i / 6, themeCssColor(currentHue(i / 6), 90, 70, 1));
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(2.5, size * 0.006);
  ctx.lineJoin = "round";
  applyGlow(themeCssColor(currentHue(0.5), 90, 65, 1), 12);
  ctx.stroke();
  ctx.restore();
}

if (typeof module === "object" && module.exports)
  module.exports = {
    orbitMirrorPosition,
    orbitInnerRadius,
    orbitOuterLength,
    advanceOrbitRope,
  };
