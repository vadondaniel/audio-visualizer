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

const TUNNEL_RINGS = 30;
const TUNNEL_SEGMENTS = 48;
const TUNNEL_WALL_GROUPS = 12;
const tunnelSpectral = new Float32Array(TUNNEL_WALL_GROUPS);

// Reused geometry buffers. The old implementation allocated ~1,600 point
// objects plus nested arrays on every frame; keeping the hot path typed and
// contiguous reduces GC pressure substantially.
const tunnelX = new Float32Array(TUNNEL_RINGS * TUNNEL_SEGMENTS);
const tunnelY = new Float32Array(TUNNEL_RINGS * TUNNEL_SEGMENTS);
const tunnelEnergy = new Float32Array(TUNNEL_RINGS * TUNNEL_SEGMENTS);
const tunnelBeatFront = new Float32Array(TUNNEL_RINGS * TUNNEL_SEGMENTS);
const tunnelPhase = new Float32Array(TUNNEL_RINGS);
const tunnelDepth = new Float32Array(TUNNEL_RINGS);
const tunnelDepthEnergy = new Float32Array(TUNNEL_RINGS);

function tunnelIndex(ring, seg) {
  return ring * TUNNEL_SEGMENTS + seg;
}

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
  for (let i = tunnelDropPulses.length - 1; i >= 0; i--) {
    const pulse = tunnelDropPulses[i];
    pulse.phase -= dtSec * (0.38 + pulse.strength * 0.72);
    pulse.width = Math.min(0.13, pulse.width + dtSec * 0.02);
    pulse.strength *= Math.exp(-0.18 * dtSec);
    if (pulse.phase <= -0.08 || pulse.strength <= 0.03) {
      tunnelDropPulses.splice(i, 1);
    }
  }

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

  // Twelve broad spectral buckets are enough to maintain visible texture while
  // avoiding a fresh Float32Array allocation every frame.
  for (let b = 0; b < TUNNEL_WALL_GROUPS; b++) {
    const lo = 0.008 + (b / TUNNEL_WALL_GROUPS) ** 1.55 * 0.46;
    const hi = 0.012 + ((b + 1) / TUNNEL_WALL_GROUPS) ** 1.55 * 0.46;
    const raw = Math.pow(
      applyValueHandling(
        bandAverage(freqData, lo, hi) / 255,
        state.valueHandling
      ),
      0.86
    );
    tunnelSpectral[b] = smoothTowards(tunnelSpectral[b], raw, remaining);
  }

  // Geometry pass: contiguous typed buffers, no per-point objects.
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

    tunnelPhase[r] = phase;
    tunnelDepth[r] = depth;
    let ringEnergy = 0;

    for (let seg = 0; seg < TUNNEL_SEGMENTS; seg++) {
      const norm = seg / TUNNEL_SEGMENTS;
      const angle = norm * Math.PI * 2 + rotation;
      const band = Math.min(
        TUNNEL_WALL_GROUPS - 1,
        Math.floor(norm * TUNNEL_WALL_GROUPS)
      );
      const localSpectrum = tunnelSpectral[band];
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
      const idx = tunnelIndex(r, seg);

      tunnelX[idx] = cx + Math.cos(angle) * radial;
      tunnelY[idx] =
        cy +
        Math.sin(angle) * radial * verticalScale +
        Math.sin(angle * 2 + phase * 5) * radius * mids * 0.018;
      tunnelEnergy[idx] = localSpectrum;
      tunnelBeatFront[idx] = beatFront;
      ringEnergy += localSpectrum;
    }
    tunnelDepthEnergy[r] = ringEnergy / TUNNEL_SEGMENTS;
  }

  // Filled wall facets are grouped into twelve angular sectors. This keeps the
  // visible faceted surface, but collapses ~1,400 fill() calls into ~330.
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const ringsPerDepthGroup = 1;
  for (let r = 0; r < TUNNEL_RINGS - 1; r += ringsPerDepthGroup) {
    const aDepth = tunnelDepth[r];
    const depthVisibility = 0.12 + aDepth * 0.52;

    for (let g = 0; g < TUNNEL_WALL_GROUPS; g++) {
      const startSeg = Math.floor((g * TUNNEL_SEGMENTS) / TUNNEL_WALL_GROUPS);
      const endSeg = Math.floor(
        ((g + 1) * TUNNEL_SEGMENTS) / TUNNEL_WALL_GROUPS
      );
      let localSum = 0;
      let beatSum = 0;
      for (let seg = startSeg; seg < endSeg; seg++) {
        const next = seg + 1 === TUNNEL_SEGMENTS ? 0 : seg + 1;
        const ia = tunnelIndex(r, seg);
        const ib = tunnelIndex(r, next);
        const ic = tunnelIndex(r + 1, seg);
        localSum += tunnelEnergy[ia] + tunnelEnergy[ib] + tunnelEnergy[ic];
        beatSum +=
          tunnelBeatFront[ia] + tunnelBeatFront[ib] + tunnelBeatFront[ic];
      }

      const local = localSum / ((endSeg - startSeg) * 3);
      const localBeat = beatSum / ((endSeg - startSeg) * 3);
      const structure =
        0.22 +
        local * 0.4 +
        dormantMids * 0.07 +
        activeMids * 0.16 +
        peakMids * 0.28 +
        dormantTreble * 0.03 +
        activeTreble * 0.06 +
        peakTreble * 0.11 +
        localBeat * (0.2 + drop * 0.12);
      const alpha = Math.min(
        0.34,
        (0.075 + structure * 0.34) * depthVisibility
      );
      const hue = currentHue((g / TUNNEL_WALL_GROUPS) * 0.88 + aDepth * 0.12);

      ctx.fillStyle = `hsla(${hue}, 82%, ${42 + treble * 10}%, ${alpha})`;
      // Each sector is a single connected quad-strip instead of one path
      // sub-path per facet. The old version emitted 4 independent edges for
      // every facet (1,392 sub-paths across the wall); those explode into a
      // large number of Skia path/tessellation operations despite only ~348
      // Canvas fill() calls. A connected strip preserves the 12-sector
      // faceting while removing the redundant internal edges.
      ctx.beginPath();
      let seg = startSeg;
      let ia = tunnelIndex(r, seg);
      let ib = tunnelIndex(r + 1, seg);
      ctx.moveTo(tunnelX[ia], tunnelY[ia]);
      ctx.lineTo(tunnelX[ib], tunnelY[ib]);
      for (seg = startSeg + 1; seg < endSeg; seg++) {
        ia = tunnelIndex(r, seg);
        ib = tunnelIndex(r + 1, seg);
        ctx.lineTo(tunnelX[ib], tunnelY[ib]);
      }
      const finalA = tunnelIndex(r, endSeg % TUNNEL_SEGMENTS);
      const finalB = tunnelIndex(r + 1, endSeg % TUNNEL_SEGMENTS);
      ctx.lineTo(tunnelX[finalB], tunnelY[finalB]);
      ctx.lineTo(tunnelX[finalA], tunnelY[finalA]);
      for (seg = endSeg - 1; seg >= startSeg; seg--) {
        ia = tunnelIndex(r, seg);
        ctx.lineTo(tunnelX[ia], tunnelY[ia]);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();

  // Rails are batched into one path. A second, sparse accent pass preserves the
  // brightest treble detail without paying a shadow/glow cost per rail.
  const railCount = Math.round(
    9 + dormantTreble * 6 + activeTreble * 14 + peakTreble * 20
  );
  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  let railEnergyTotal = 0;
  for (let rail = 0; rail < railCount; rail++) {
    const seg = Math.floor((rail / railCount) * TUNNEL_SEGMENTS);
    const first = tunnelIndex(0, seg);
    ctx.moveTo(tunnelX[first], tunnelY[first]);
    for (let r = 1; r < TUNNEL_RINGS; r++) {
      const idx = tunnelIndex(r, seg);
      ctx.lineTo(tunnelX[idx], tunnelY[idx]);
    }
    railEnergyTotal +=
      tunnelDepthEnergy[Math.floor((rail / railCount) * TUNNEL_RINGS)];
  }
  const avgRailEnergy = railEnergyTotal / Math.max(1, railCount);
  ctx.strokeStyle = `hsla(${currentHue(treble * 0.08)}, 88%, ${51 + treble * 10}%, ${Math.min(
    0.86,
    0.28 + avgRailEnergy * 0.46 + peakTreble * 0.26
  )})`;
  ctx.lineWidth = 0.8 + treble * 1.55 + avgRailEnergy * 1.2;
  ctx.stroke();
  ctx.restore();

  // Depth rings: one base path, then only the strongest rings receive glow.
  ctx.save();
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let r = 0; r < TUNNEL_RINGS; r++) {
    for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
      const idx = tunnelIndex(r, seg % TUNNEL_SEGMENTS);
      if (seg === 0) ctx.moveTo(tunnelX[idx], tunnelY[idx]);
      else ctx.lineTo(tunnelX[idx], tunnelY[idx]);
    }
    ctx.closePath();
  }
  const baseRingEnergy =
    tunnelDepthEnergy[0] * 0.18 + tunnelDepthEnergy[TUNNEL_RINGS - 1] * 0.35;
  ctx.strokeStyle = `hsla(${currentHue(0.08)}, 92%, ${54 + treble * 10}%, ${Math.min(
    0.9,
    0.38 + baseRingEnergy + activeBass * 0.12 + peakBass * 0.18
  )})`;
  ctx.lineWidth = 0.9 + activeBass * 0.42 + peakBass * 0.82 + treble * 0.45;
  ctx.shadowBlur = 0;
  ctx.stroke();

  // Four nearest rings retain the characteristic luminous depth cues.
  for (let k = 0; k < 4; k++) {
    const r = TUNNEL_RINGS - 1 - k;
    const depth = tunnelDepth[r];
    const localEnergy = tunnelDepthEnergy[r];
    const beatFront = tunnelBeatFront[tunnelIndex(r, 0)];
    const alpha = Math.min(
      0.98,
      0.38 +
        depth * 0.42 +
        localEnergy * 0.22 +
        peakBass * 0.2 +
        peakMids * 0.12 +
        beatFront * 0.42 +
        drop * 0.1
    );
    ctx.beginPath();
    for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
      const idx = tunnelIndex(r, seg % TUNNEL_SEGMENTS);
      if (seg === 0) ctx.moveTo(tunnelX[idx], tunnelY[idx]);
      else ctx.lineTo(tunnelX[idx], tunnelY[idx]);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsla(${currentHue(tunnelPhase[r] * 0.82 + localEnergy * 0.18)}, 92%, ${54 + treble * 10}%, ${alpha})`;
    ctx.lineWidth =
      0.95 +
      depth * 1.2 +
      localEnergy * 0.9 +
      activeBass * 0.36 +
      peakBass * 0.6 +
      beatFront * (1.2 + drop);
    applyGlow(ctx.strokeStyle, 1 + depth * 1.8 + treble * 1.25);
    ctx.stroke();
  }
  ctx.restore();

  // Beat highlight: one ring, same visual behavior as before.
  if (tunnelPulse > 0.06) {
    let nearest = 0;
    let nearestDelta = Infinity;
    for (let r = 0; r < TUNNEL_RINGS; r++) {
      const delta = Math.abs(tunnelPhase[r] - tunnelPulsePhase);
      if (delta < nearestDelta) {
        nearest = r;
        nearestDelta = delta;
      }
    }
    const alpha = Math.min(0.9, 0.24 + tunnelPulse * 0.42 + mids * 0.12);
    ctx.save();
    ctx.beginPath();
    for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
      const idx = tunnelIndex(nearest, seg % TUNNEL_SEGMENTS);
      if (seg === 0) ctx.moveTo(tunnelX[idx], tunnelY[idx]);
      else ctx.lineTo(tunnelX[idx], tunnelY[idx]);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsla(${currentHue(tunnelPulsePhase)}, 96%, 76%, ${alpha})`;
    ctx.lineWidth = 1.2 + tunnelPulse * 2.4 + bass * 1.2;
    applyGlow(ctx.strokeStyle, 2 + tunnelPulse * 5);
    ctx.stroke();
    ctx.restore();
  }

  // Drop wavefronts remain separate, because these are the high-impact transient
  // events that should stay crisp rather than being folded into the base batches.
  for (let p = 0; p < tunnelDropPulses.length; p++) {
    const pulse = tunnelDropPulses[p];
    let nearest = 0;
    let nearestDelta = Infinity;
    for (let r = 0; r < TUNNEL_RINGS; r++) {
      const delta = Math.abs(tunnelPhase[r] - pulse.phase);
      if (delta < nearestDelta) {
        nearest = r;
        nearestDelta = delta;
      }
    }
    const pulseAlpha = Math.min(1, pulse.strength * 1.1);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
      const idx = tunnelIndex(nearest, seg % TUNNEL_SEGMENTS);
      if (seg === 0) ctx.moveTo(tunnelX[idx], tunnelY[idx]);
      else ctx.lineTo(tunnelX[idx], tunnelY[idx]);
    }
    ctx.closePath();
    ctx.strokeStyle = `hsla(${currentHue(0.04 + pulse.phase * 0.16)}, 100%, 82%, ${pulseAlpha})`;
    ctx.lineWidth = 3.2 + pulse.strength * 5.5 + bass * 2.2;
    applyGlow(ctx.strokeStyle, 5 + pulse.strength * 9);
    ctx.stroke();

    if (pulse.width > 0.045) {
      ctx.globalAlpha = pulseAlpha * 0.34;
      ctx.lineWidth *= 0.46;
      ctx.beginPath();
      for (let seg = 0; seg <= TUNNEL_SEGMENTS; seg++) {
        const idx = tunnelIndex(nearest, seg % TUNNEL_SEGMENTS);
        if (seg === 0) ctx.moveTo(tunnelX[idx], tunnelY[idx]);
        else ctx.lineTo(tunnelX[idx], tunnelY[idx]);
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
