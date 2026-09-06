// ---------- helpers ----------
function currentHue(offset = 0) {
  return computeHue(
    THEMES[state.theme],
    state.hueShift,
    offset,
    THEMES[state.theme]?.alwaysGradient || state.colorGradientEnabled !== false
  );
}

let monochromeCanvas = null;

function applyMonochromeTheme() {
  const theme = THEMES[state.theme];
  if (theme?.monochrome !== "white" && theme?.monochrome !== "black") return;

  const W = renderCanvas.width;
  const H = renderCanvas.height;
  if (!W || !H) return;

  if (!monochromeCanvas) monochromeCanvas = document.createElement("canvas");
  if (monochromeCanvas.width !== W || monochromeCanvas.height !== H) {
    monochromeCanvas.width = W;
    monochromeCanvas.height = H;
  }

  const monoCtx = monochromeCanvas.getContext("2d");
  monoCtx.clearRect(0, 0, W, H);

  const gradientEnabled = state.colorGradientEnabled !== false;
  const isWhite = theme.monochrome === "white";
  let fillStyle;

  if (!gradientEnabled) {
    fillStyle = isWhite ? "#ffffff" : "#000000";
  } else {
    const grad = monoCtx.createLinearGradient(0, 0, W, 0);
    // The primary endpoint stays absolute; the secondary endpoint only
    // introduces a restrained amount of gray.
    if (isWhite) {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, "#dddddd");
    } else {
      grad.addColorStop(0, "#000000");
      grad.addColorStop(1, "#222222");
    }
    fillStyle = grad;
  }

  monoCtx.fillStyle = fillStyle;
  monoCtx.fillRect(0, 0, W, H);
  monoCtx.globalCompositeOperation = "destination-in";
  monoCtx.drawImage(renderCanvas, 0, 0);
  monoCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(monochromeCanvas, 0, 0);
  ctx.restore();
}

function currentThemeRenderFilter() {
  return "none";
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

function getTrailSnapshotLimit() {
  const desired = Math.ceil((state.trailDuration * state.trailMaxFps) / 1000);
  return Math.max(1, Math.min(180, desired + 1));
}

function captureTrailFrame(timestamp) {
  if (trailFrames.length >= getTrailSnapshotLimit()) {
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
    const presentStart =
      typeof diagnostics !== "undefined" ? diagnostics.beginPresent() : 0;
    displayCtx.save();
    displayCtx.setTransform(1, 0, 0, 1, 0, 0);
    displayCtx.globalAlpha = 1;
    displayCtx.clearRect(0, 0, canvas.width, canvas.height);
    displayCtx.filter = currentThemeRenderFilter();
    displayCtx.drawImage(renderCanvas, 0, 0);
    displayCtx.filter = "none";
    displayCtx.restore();
    if (typeof diagnostics !== "undefined")
      diagnostics.endPresent(presentStart);
    return;
  }

  discardExpiredTrailFrames(timestamp);
  const desiredSnapshots = Math.ceil(
    (state.trailDuration * state.trailMaxFps) / 1000
  );
  const snapshotLimit = Math.max(1, Math.min(180, desiredSnapshots + 1));
  const shouldCapture = TrailMath.shouldCaptureTrail(
    timestamp,
    lastTrailCaptureMs,
    state.trailDuration,
    snapshotLimit,
    state.trailMaxFps
  );
  if (shouldCapture) {
    const captureStart =
      typeof diagnostics !== "undefined" ? diagnostics.beginTrailCapture() : 0;
    captureTrailFrame(timestamp);
    if (typeof diagnostics !== "undefined")
      diagnostics.endTrailCapture(captureStart);
  }

  const compositeStart =
    typeof diagnostics !== "undefined" ? diagnostics.beginTrailComposite() : 0;
  displayCtx.save();
  displayCtx.setTransform(1, 0, 0, 1, 0, 0);
  displayCtx.globalCompositeOperation = "source-over";
  displayCtx.globalAlpha = 1;
  displayCtx.clearRect(0, 0, canvas.width, canvas.height);
  displayCtx.filter = currentThemeRenderFilter();
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
  displayCtx.filter = "none";
  displayCtx.restore();
  if (typeof diagnostics !== "undefined")
    diagnostics.endTrailComposite(compositeStart);
  const presentStart =
    typeof diagnostics !== "undefined" ? diagnostics.beginPresent() : 0;
  // The final display canvas is presented by Chromium after this function returns.
  if (typeof diagnostics !== "undefined") diagnostics.endPresent(presentStart);
}
