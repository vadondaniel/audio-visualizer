// ---------- helpers ----------
function currentHue(offset = 0) {
  const theme = THEMES[state.theme];
  // Monochrome themes still use the normal color-producing render paths.
  // Encode the spatial offset as a pseudo-hue so themeCssColor can turn it
  // into a subtle black/white gradient without a post-render image filter.
  if (theme?.monochrome === "white" || theme?.monochrome === "black") {
    const gradientEnabled = state.colorGradientEnabled !== false;
    if (!gradientEnabled) return 0;
    return Math.min(1, Math.max(0, offset)) * 360;
  }

  return computeHue(
    theme,
    state.hueShift,
    offset,
    theme?.alwaysGradient || state.colorGradientEnabled !== false
  );
}

function themeCssColor(hue, saturation = 90, lightness = 60, alpha = 1) {
  const theme = THEMES[state.theme];
  if (theme?.monochrome === "white" || theme?.monochrome === "black") {
    if (state.colorGradientEnabled === false) {
      const value = theme.monochrome === "white" ? 255 : 0;
      return `rgba(${value}, ${value}, ${value}, ${alpha})`;
    }

    // A modest luminance-only spread: the base theme color remains the
    // endpoint, while spatial variation is introduced by the offset encoded
    // in currentHue(). No canvas readback or second canvas is required.
    const position = ((((Number(hue) || 0) % 360) + 360) % 360) / 360;
    const maxShift = theme.monochrome === "white" ? 50 : 48;
    const value =
      theme.monochrome === "white"
        ? Math.round(255 - position * maxShift)
        : Math.round(position * maxShift);
    return `rgba(${value}, ${value}, ${value}, ${alpha})`;
  }

  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
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
    displayCtx.drawImage(renderCanvas, 0, 0);
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
  displayCtx.restore();
  if (typeof diagnostics !== "undefined")
    diagnostics.endTrailComposite(compositeStart);
  const presentStart =
    typeof diagnostics !== "undefined" ? diagnostics.beginPresent() : 0;
  // The final display canvas is presented by Chromium after this function returns.
  if (typeof diagnostics !== "undefined") diagnostics.endPresent(presentStart);
}
