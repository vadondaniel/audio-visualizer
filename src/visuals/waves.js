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
    grad.addColorStop(0, themeCssColor(layerHue, 90, 65, 0.42));
    // At mid-depth: rich oceanic body
    grad.addColorStop(0.45, themeCssColor(layerHue, 85, 42, 0.18));
    // At deep floor: deep oceanic floor
    grad.addColorStop(1, themeCssColor(layerHue, 80, 15, 0.02));
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

    ctx.strokeStyle = themeCssColor(layerHue, 95, 72, 1);
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
          ctx.fillStyle = themeCssColor(layerHue, 95, 92, foamAlpha);
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

    ctx.fillStyle = themeCssColor(
      layerHue,
      95,
      sp.airborne ? 92 : 82,
      sporeAlpha
    );
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
