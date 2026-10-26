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
    themeCssColor(
      skyThemeHue + 60,
      85,
      45,
      0.06 + intensity * 0.16 + beatPulse * 0.08
    )
  );
  airglowGrad.addColorStop(
    0.5,
    themeCssColor(skyThemeHue + 20, 90, 35, 0.04 + intensity * 0.12)
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
        themeCssColor(baseCurtainHue, 96, 68, alphaBase * 0.9)
      );
      curtainGrad.addColorStop(
        0.28,
        themeCssColor(baseCurtainHue, 92, 60, alphaBase * 0.75)
      );
      curtainGrad.addColorStop(
        0.65,
        themeCssColor(midCurtainHue, 90, 54, alphaBase * 0.5)
      );
      curtainGrad.addColorStop(
        0.92,
        themeCssColor(topCurtainHue, 85, 48, alphaBase * 0.22)
      );
      curtainGrad.addColorStop(1, themeCssColor(topCurtainHue, 85, 45, 0));

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
            themeCssColor(baseCurtainHue, 98, 78, rayAlpha)
          );
          rayGrad.addColorStop(
            0.3,
            themeCssColor(baseCurtainHue, 95, 68, rayAlpha * 0.8)
          );
          rayGrad.addColorStop(
            0.7,
            themeCssColor(midCurtainHue, 92, 58, rayAlpha * 0.5)
          );
          rayGrad.addColorStop(1, themeCssColor(topCurtainHue, 88, 50, 0));

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
        ctx.strokeStyle = themeCssColor(baseCurtainHue, 100, 82, edgeAlpha);
        ctx.lineWidth =
          1.4 + (c === 2 ? 1.6 : 0.6) + intensity * 1.2 + beatPulse * 1.2;
        applyGlow(
          themeCssColor(baseCurtainHue, 100, 75, edgeAlpha),
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
      ctx.fillStyle = themeCssColor(sparkHue, 95, 85, sparkAlpha);
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
    themeCssColor(floorHue, 80, 20, 0.08 + intensity * 0.12 + beatPulse * 0.08)
  );
  ctx.fillStyle = skyVignette;
  ctx.fillRect(0, H * 0.75, W, H * 0.25);
}
