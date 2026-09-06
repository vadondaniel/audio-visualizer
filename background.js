// ---------- background & post-processing FX ----------

// state.bgType is the explicit switch: "color" | "nebula" | "stars" | "grid" | "image"
function applyBackground() {
  const isImage = state.bgType === "image";
  const isProcedural =
    state.bgType === "nebula" ||
    state.bgType === "stars" ||
    state.bgType === "grid";

  if (isImage && state.bgImageDataUrl) {
    bgLayer.style.backgroundImage = `url("${state.bgImageDataUrl}")`;
    bgLayer.style.backgroundColor = "transparent";
  } else {
    bgLayer.style.backgroundImage = "none";
    bgLayer.style.backgroundColor = isProcedural ? "#030308" : state.bgColor;
  }

  if (bgCanvas) {
    bgCanvas.style.display = isProcedural ? "block" : "none";
  }

  bgLayer.style.filter = isImage
    ? `brightness(${state.bgBrightness}) blur(${state.bgBlur}px)`
    : "none";
}

function updateBgRowsVisibility() {
  bgTypeSelect.value = state.bgType;
  const isImage = state.bgType === "image";
  const isColor = state.bgType === "color";
  bgColorRow.style.display = isColor ? "" : "none";
  bgImageRow.style.display = isImage ? "" : "none";
  brightnessRow.style.display = isImage ? "" : "none";
  blurRow.style.display = isImage ? "" : "none";
  bgImageName.textContent = state.bgImageName || "none chosen";
}

function applyFxOverlay() {
  if (!fxOverlay) return;
  fxOverlay.classList.toggle("has-vignette", !!state.reactiveVignette);
  fxOverlay.classList.toggle("has-crt", !!state.crtFilter);
  fxOverlay.classList.toggle("has-flash", !!state.beatFlash);
}

function updateFxLive(bassLevel, midLevel, trebleLevel, beatPulse) {
  if (!fxOverlay) return;

  if (state.reactiveVignette) {
    const pulsePx = Math.round(bassLevel * 45 + beatPulse * 38);
    const alpha = (0.4 + bassLevel * 0.35 + beatPulse * 0.2).toFixed(2);
    const glowHue = currentHue(0);
    const glowAlpha = (bassLevel * 0.38 + beatPulse * 0.25).toFixed(2);
    fxOverlay.style.setProperty("--vignette-pulse", `${pulsePx}px`);
    fxOverlay.style.setProperty("--vignette-alpha", alpha);
    fxOverlay.style.setProperty(
      "--vignette-glow",
      `hsla(${glowHue}, 90%, 65%, ${glowAlpha})`
    );
  }

  if (state.beatFlash) {
    const flashAlpha = (beatPulse * 0.28).toFixed(2);
    const flashHue = currentHue(0.5);
    fxOverlay.style.setProperty("--flash-alpha", flashAlpha);
    fxOverlay.style.setProperty(
      "--flash-color",
      `hsla(${flashHue}, 95%, 85%, 0.45)`
    );
  }
}

// Reads the chosen image file without re-encoding to preserve animated GIF/WEBP
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that image file"));
    reader.readAsDataURL(file);
  });
}

// ---------- procedural background systems ----------

// 1. Cosmic Nebula: Volumetric stellar nursery with filaments, embedded starlets, and dark dust lanes
const NEBULA_PUFFS = 26;
let nebulaSwirlTime = 0;

// Organic distribution along a galactic diagonal sweep
const nebulaPuffs = Array.from({ length: NEBULA_PUFFS }, (_, i) => {
  const t = i / (NEBULA_PUFFS - 1);
  const angle = (t - 0.5) * 1.8;
  const dist = Math.pow(Math.abs(t - 0.5) * 2, 1.2) * 0.48;

  return {
    t,
    dist,
    angle,
    orbitSpeed: (0.02 + Math.random() * 0.04) * (i % 2 === 0 ? 1 : -1),
    radNorm: 0.16 + Math.random() * 0.22,
    offsetRadius: Math.random() * 0.12,
    offsetAngle: Math.random() * Math.PI * 2,
    denseCore: i >= 10 && i <= 16,
    colorType: i % 3,
  };
});

// Embedded protostars & stellar dust
const NEBULA_STARS_COUNT = 55;
const nebulaProtostars = Array.from({ length: NEBULA_STARS_COUNT }, (_, i) => ({
  xNorm: 0.1 + Math.random() * 0.8,
  yNorm: 0.1 + Math.random() * 0.8,
  size: 0.6 + Math.random() * 1.8,
  twinkle: Math.random() * Math.PI * 2,
  speed: 1.5 + Math.random() * 3.0,
  isMajorStar: i < 3,
}));

// 2. Warp Starfield
const STAR_COUNT = 180;
const warpStars = Array.from({ length: STAR_COUNT }, () => ({
  x: (Math.random() - 0.5) * 2,
  y: (Math.random() - 0.5) * 2,
  z: 0.05 + Math.random() * 0.95,
  pz: 1,
}));

// 3. Synthwave Grid
let gridOffset = 0;

function renderProceduralBackground(
  dtSec,
  bassLevel,
  midLevel,
  trebleLevel,
  beatPulse
) {
  if (!bgCtx || !bgCanvas) return;
  const isProcedural =
    state.bgType === "nebula" ||
    state.bgType === "stars" ||
    state.bgType === "grid";
  if (!isProcedural) return;

  const W = bgCanvas.width;
  const H = bgCanvas.height;

  // Dark cosmic base clear
  bgCtx.fillStyle = "#020206";
  bgCtx.fillRect(0, 0, W, H);

  if (state.bgType === "nebula") {
    nebulaSwirlTime += dtSec * (0.25 + bassLevel * 0.5);
    const cx = W * 0.5;
    const cy = H * 0.48;

    bgCtx.save();

    // 1. Deep cosmic foundation glow
    const baseHue = currentHue(0);
    const secHue = (baseHue + 40) % 360;
    const deepHaze = bgCtx.createRadialGradient(
      cx,
      cy,
      W * 0.05,
      cx,
      cy,
      Math.max(W, H) * 0.65
    );
    deepHaze.addColorStop(
      0,
      `hsla(${baseHue}, 80%, 30%, ${0.12 + bassLevel * 0.12})`
    );
    deepHaze.addColorStop(
      0.5,
      `hsla(${secHue}, 75%, 20%, ${0.07 + midLevel * 0.08})`
    );
    deepHaze.addColorStop(1, "rgba(2, 2, 6, 0)");
    bgCtx.fillStyle = deepHaze;
    bgCtx.fillRect(0, 0, W, H);

    // 2. Render billowing gaseous puffs with screen blending
    bgCtx.globalCompositeOperation = "screen";

    for (const p of nebulaPuffs) {
      const currentAngle =
        p.angle + Math.sin(nebulaSwirlTime * p.orbitSpeed + p.t * 3) * 0.18;
      const rDist =
        (p.dist + Math.sin(nebulaSwirlTime * 0.3 + p.t * 4) * 0.03) *
        Math.max(W, H);

      const px =
        cx +
        Math.cos(currentAngle) * rDist +
        Math.cos(p.offsetAngle + nebulaSwirlTime * 0.1) * (p.offsetRadius * W);
      const py =
        cy +
        Math.sin(currentAngle) * rDist * 0.65 +
        Math.sin(p.offsetAngle + nebulaSwirlTime * 0.1) * (p.offsetRadius * H);

      const puffR =
        p.radNorm * Math.max(W, H) * (1 + bassLevel * 0.3 + beatPulse * 0.15);

      const grad = bgCtx.createRadialGradient(px, py, 0, px, py, puffR);
      const puffHue =
        p.colorType === 0
          ? baseHue
          : p.colorType === 1
            ? secHue
            : (baseHue + 80) % 360;
      const coreBoost = p.denseCore ? 0.08 + bassLevel * 0.14 : 0;
      const alpha = 0.06 + midLevel * 0.12 + beatPulse * 0.08 + coreBoost;

      grad.addColorStop(
        0,
        `hsla(${puffHue}, 90%, ${p.denseCore ? 75 : 60}%, ${alpha * 0.85})`
      );
      grad.addColorStop(0.35, `hsla(${puffHue}, 85%, 50%, ${alpha * 0.55})`);
      grad.addColorStop(0.7, `hsla(${secHue}, 80%, 38%, ${alpha * 0.22})`);
      grad.addColorStop(1, "rgba(2, 2, 8, 0)");

      bgCtx.fillStyle = grad;
      bgCtx.beginPath();
      bgCtx.arc(px, py, puffR, 0, Math.PI * 2);
      bgCtx.fill();
    }

    // 3. Embedded protostars & stellar nursery
    bgCtx.globalCompositeOperation = "lighter";
    for (const s of nebulaProtostars) {
      s.twinkle += dtSec * s.speed;
      const starAlpha = 0.25 + Math.sin(s.twinkle) * 0.3 + trebleLevel * 0.45;
      if (starAlpha <= 0.05) continue;

      const sx = s.xNorm * W;
      const sy = s.yNorm * H;
      const sRad = s.size * (1 + beatPulse * 0.4);

      bgCtx.fillStyle = `rgba(245, 250, 255, ${Math.min(1, starAlpha)})`;
      bgCtx.beginPath();
      bgCtx.arc(sx, sy, sRad, 0, Math.PI * 2);
      bgCtx.fill();

      // Diffraction cross-spikes on major stellar nursery anchors
      if (s.isMajorStar && starAlpha > 0.4) {
        const spikeLen = 14 + sRad * 8 + beatPulse * 10;
        bgCtx.strokeStyle = `rgba(220, 240, 255, ${starAlpha * 0.55})`;
        bgCtx.lineWidth = 1;
        bgCtx.beginPath();
        bgCtx.moveTo(sx - spikeLen, sy);
        bgCtx.lineTo(sx + spikeLen, sy);
        bgCtx.moveTo(sx, sy - spikeLen);
        bgCtx.lineTo(sx, sy + spikeLen);
        bgCtx.stroke();
      }
    }

    // 4. Subtle dark interstellar dust lanes (silhouette cutting through the gas)
    bgCtx.globalCompositeOperation = "source-over";
    for (let d = 0; d < 4; d++) {
      const dx = cx + Math.cos(d * 1.5 + nebulaSwirlTime * 0.05) * (W * 0.18);
      const dy = cy + Math.sin(d * 1.2 + nebulaSwirlTime * 0.04) * (H * 0.15);
      const dRad = (0.09 + d * 0.03) * Math.max(W, H);

      const dGrad = bgCtx.createRadialGradient(dx, dy, 0, dx, dy, dRad);
      dGrad.addColorStop(0, "rgba(2, 2, 6, 0.45)");
      dGrad.addColorStop(0.6, "rgba(2, 2, 6, 0.2)");
      dGrad.addColorStop(1, "rgba(2, 2, 6, 0)");

      bgCtx.fillStyle = dGrad;
      bgCtx.beginPath();
      bgCtx.arc(dx, dy, dRad, 0, Math.PI * 2);
      bgCtx.fill();
    }

    bgCtx.restore();
  } else if (state.bgType === "stars") {
    // Render 3D hyperspace warp stars accelerating with audio
    bgCtx.save();
    const cx = W / 2;
    const cy = H / 2;
    const warpSpeed = (0.28 + bassLevel * 1.8 + beatPulse * 1.5) * dtSec;
    const starHue = currentHue(0.2);

    for (const s of warpStars) {
      s.pz = s.z;
      s.z -= warpSpeed;
      if (s.z <= 0.02) {
        s.x = (Math.random() - 0.5) * 2;
        s.y = (Math.random() - 0.5) * 2;
        s.z = 1;
        s.pz = 1;
      }

      const k = 1 / s.z;
      const px = cx + s.x * k * cx;
      const py = cy + s.y * k * cy;

      const prevK = 1 / s.pz;
      const prevX = cx + s.x * prevK * cx;
      const prevY = cy + s.y * prevK * cy;

      if (px < 0 || px > W || py < 0 || py > H) {
        s.z = 1;
        continue;
      }

      const alpha = Math.min(1, (1 - s.z) * 1.3 + trebleLevel * 0.3);
      bgCtx.strokeStyle = `hsla(${starHue}, 90%, 80%, ${alpha})`;
      bgCtx.lineWidth = Math.max(1, (1 - s.z) * 2.8);
      bgCtx.beginPath();
      bgCtx.moveTo(prevX, prevY);
      bgCtx.lineTo(px, py);
      bgCtx.stroke();
    }
    bgCtx.restore();
  } else if (state.bgType === "grid") {
    // Render retro 80s synthwave perspective grid
    bgCtx.save();
    const horizonY = H * 0.55;
    const speed = (0.45 + bassLevel * 1.2 + beatPulse * 0.8) * dtSec;
    gridOffset = (gridOffset + speed) % 1;

    // Horizon glow
    const horizGrad = bgCtx.createLinearGradient(
      0,
      horizonY - 40,
      0,
      horizonY + 80
    );
    const gridHue = currentHue(0);
    horizGrad.addColorStop(
      0,
      `hsla(${gridHue + 40}, 90%, 65%, ${0.15 + bassLevel * 0.25 + beatPulse * 0.2})`
    );
    horizGrad.addColorStop(1, "rgba(2, 2, 8, 0)");
    bgCtx.fillStyle = horizGrad;
    bgCtx.fillRect(0, horizonY - 40, W, 120);

    // Perspective vertical fan lines
    bgCtx.strokeStyle = `hsla(${gridHue}, 85%, 60%, 0.22)`;
    bgCtx.lineWidth = 1.2;
    const fanLines = 18;
    for (let i = -fanLines; i <= fanLines; i++) {
      const bottomX = W / 2 + (i / fanLines) * (W * 1.1);
      bgCtx.beginPath();
      bgCtx.moveTo(W / 2, horizonY);
      bgCtx.lineTo(bottomX, H);
      bgCtx.stroke();
    }

    // Horizontal receding perspective lines
    const depthLines = 14;
    for (let i = 0; i < depthLines; i++) {
      const p = (i + gridOffset) / depthLines;
      const y = horizonY + Math.pow(p, 2.2) * (H - horizonY);
      const alpha = Math.min(0.7, p * 0.8 + bassLevel * 0.3);
      bgCtx.strokeStyle = `hsla(${gridHue}, 90%, 65%, ${alpha})`;
      bgCtx.lineWidth = 1 + p * 1.5;
      bgCtx.beginPath();
      bgCtx.moveTo(0, y);
      bgCtx.lineTo(W, y);
      bgCtx.stroke();
    }
    bgCtx.restore();
  }
}

// ---------- settings panel sync helpers ----------

function updateVisualOptionRows() {
  const currentMode = MODES[state.mode];
  barsAlignmentRow.style.display = currentMode === "bars" ? "" : "none";
  radialModeRow.style.display = currentMode === "radial" ? "" : "none";
  waveformStyleRow.style.display = currentMode === "waveform" ? "" : "none";
  kaleidoClipRow.style.display = currentMode === "kaleidoscope" ? "" : "none";
  cascadeFrequencyRow.style.display = currentMode === "cascade" ? "" : "none";
  const particleMode = currentMode === "particles";
  particleDensityRow.style.display = particleMode ? "" : "none";
  particleStyleRow.style.display = particleMode ? "" : "none";
  smoothingRow.style.display =
    currentMode === "particles" || currentMode === "waveform" ? "none" : "";
}

function syncSelectsToState() {
  modeSelect.value = state.mode;
  themeSelect.value = state.theme;
  updateVisualOptionRows();
}

function updateSliderLabels() {
  brightnessVal.textContent = `${Math.round(state.bgBrightness * 100)}%`;
  blurVal.textContent = `${state.bgBlur}px`;
  sensitivityVal.textContent = `${state.sensitivity.toFixed(1)}x`;
  glowVal.textContent = `${Math.round(state.glowIntensity * 100)}%`;
  trailDurationVal.textContent = `${state.trailDuration}ms`;
  trailFpsVal.textContent = `${state.trailMaxFps} FPS`;
  particleDensityVal.textContent = `${Math.round(state.particleDensity * 100)}%`;
}
