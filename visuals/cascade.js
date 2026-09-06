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
      ctx.fillStyle = themeCssColor(pHue, 90, 75, pAlpha);
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
      return themeCssColor(themeHue, 100, lightness, alpha);
    }

    // The contour is circular, so a conic gradient follows its geometry.
    // Using currentHue(0) alone would make Rainbow themes solid red because
    // computeHue intentionally ignores the offset for that case.
    const gradient = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    const stops = 6;
    for (let s = 0; s <= stops; s++) {
      gradient.addColorStop(
        s / stops,
        themeCssColor(currentHue(s / stops), 100, lightness, alpha)
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
    ctx.strokeStyle = themeCssColor(currentHue(swFrac * 0.3), 95, 72, swAlpha);
    ctx.lineWidth = Math.max(
      1.2,
      2.8 * (1 - swFrac) * (1 + sw.intensity * 0.5)
    );
    applyGlow(ctx.strokeStyle, 10 * (1 - swFrac) * sw.intensity);
    ctx.stroke();
  }
  ctx.restore();

  // 5. Draw configurable silhouette fill under the live wave contour
  ctx.save();
  traceContour(4);
  const cascadeFillStyle = state.cascadeFillStyle || "dark";
  if (cascadeFillStyle === "light") {
    ctx.fillStyle = "rgba(245, 246, 250, 0.94)";
  } else if (cascadeFillStyle === "theme") {
    const fillTheme = THEMES[state.theme];
    if (fillTheme?.rainbow) {
      const fillGradient = ctx.createConicGradient(-Math.PI / 2, cx, cy);
      const stops = 8;
      for (let s = 0; s <= stops; s++) {
        const p = s / stops;
        fillGradient.addColorStop(
          p,
          themeCssColor(currentHue(p), 78, 22, 0.94)
        );
      }
      ctx.fillStyle = fillGradient;
    } else if (
      state.colorGradientEnabled !== false ||
      fillTheme.alwaysGradient
    ) {
      const fillGradient = ctx.createLinearGradient(0, 0, W, H);
      const stops = 6;
      for (let s = 0; s <= stops; s++) {
        const p = s / stops;
        fillGradient.addColorStop(
          p,
          themeCssColor(currentHue(p), 78, 22, 0.94)
        );
      }
      ctx.fillStyle = fillGradient;
    } else {
      ctx.fillStyle = themeCssColor(themeHue, 78, 22, 0.94);
    }
  } else {
    ctx.fillStyle = "rgba(6, 6, 12, 0.94)";
  }
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
    : themeCssColor(accentHue, 100, 70, 0.9);
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

    ctx.fillStyle = themeCssColor(
      (themeHue + 40) % 360,
      100,
      85,
      peakAlpha * 0.9
    );
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
  ctx.strokeStyle = themeCssColor(themeHue, 90, 65, 0.85);
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
    discGrad.addColorStop(0, themeCssColor(themeHue, 95, 45, 0.9));
    discGrad.addColorStop(
      0.5,
      themeCssColor((themeHue + 40) % 360, 90, 25, 0.7)
    );
    discGrad.addColorStop(1, "#04040a");
    ctx.fillStyle = discGrad;
    ctx.fill();

    for (let g = 1; g <= 4; g++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (discBaseR * g) / 5, 0, Math.PI * 2);
      ctx.strokeStyle = themeCssColor(
        themeHue,
        80,
        70,
        0.25 + beatPulse * 0.25
      );
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
