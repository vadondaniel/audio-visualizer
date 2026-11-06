// ---------- main loop ----------
let lastFrameTime = 0;
const overlayModeFit = { scale: 1, x: 0, y: 0 };

function diagnosticCall(method, ...args) {
  try {
    if (
      typeof diagnostics !== "undefined" &&
      diagnostics &&
      typeof diagnostics[method] === "function"
    ) {
      return diagnostics[method](...args);
    }
  } catch (error) {
    // Diagnostics must never be allowed to interrupt the renderer.
    // Rendering continues normally if profiling instrumentation fails.
  }
  return 0;
}

function loop(timestamp = performance.now()) {
  requestAnimationFrame(loop);

  if (!analyser) return;

  // AudioContext suspension is easy to miss because requestAnimationFrame
  // continues running and the analyser simply returns silence.
  if (audioCtx && audioCtx.state !== "running") {
    recoverAudioCapture();
    return;
  }

  diagnosticCall("tickStart", timestamp);

  if (lastFrameTime === 0) lastFrameTime = timestamp;
  const elapsedMs = Math.min(100, Math.max(0, timestamp - lastFrameTime));
  lastFrameTime = timestamp;
  const dtSec = elapsedMs / 1000;

  const audioTimer = diagnosticCall("beginAudio");
  analyser.getByteFrequencyData(freqData);
  analyser.getByteTimeDomainData(timeData);

  // Detect zombie capture streams that return all-zero data after a
  // device change that Chromium didn't report via track/stream events.
  checkSilence();

  updateBeat(AudioPipeline.legacyBass(freqData), elapsedMs, dtSec);
  const modeId = effectiveVisualMode();
  const frame = prepareVisualFrame(timestamp, elapsedMs, modeId);
  const { levels, motion, features, beatIntensity } = frame.signals;
  diagnosticCall("endAudio", audioTimer);

  if (THEMES[state.theme].colorCycle || THEMES[state.theme].cycle) {
    const { baseDegPerSec, midDegPerSecPerUnit } = VISUAL_TUNING.hueCycle;
    state.hueShift =
      (state.hueShift +
        (baseDegPerSec + features.legacyMid * midDegPerSecPerUnit) * dtSec) %
      360;
  }

  // Media metadata uses the renderer palette and this exact hue-cycle clock,
  // so its colors stay visually locked to the actual visualization.
  if (typeof syncMediaThemeColors === "function") {
    syncMediaThemeColors();
  }

  const overlayActive = isMiniOverlayActive();
  const presentation = overlayDrawSchedule.step(
    timestamp,
    overlayActive,
    state.miniOverlayMaxFps
  );
  if (!presentation.draw) {
    const updateTimer = diagnosticCall("beginRender");
    visualModeController.update(modeId, frame);
    diagnosticCall("endRender", updateTimer);
    return;
  }

  const clearTimer = diagnosticCall("beginClear");
  clearFrame();
  diagnosticCall("endClear", clearTimer);

  const backgroundTimer = diagnosticCall("beginBackground");
  updateProceduralBackground(
    overlayActive ? Math.min(100, presentation.elapsedMs) / 1000 : dtSec,
    motion.bass,
    beatPulse
  );
  if (!overlayActive || state.miniOverlayShowBackground) {
    drawProceduralBackground(
      levels.bass,
      levels.mid,
      levels.treble,
      beatIntensity
    );
  }
  diagnosticCall("endBackground", backgroundTimer);

  const fxTimer = diagnosticCall("beginFx");
  if (!overlayActive && typeof updateFxLive === "function") {
    updateFxLive(levels.bass, levels.mid, levels.treble, beatIntensity);
  }
  diagnosticCall("endFx", fxTimer);

  const modeTimer = diagnosticCall("beginRender");

  visualModeController.update(modeId, frame);
  const fit = overlayActive
    ? OverlayDisplay.fitBounds(
        visualModeController.getOverlayBounds(modeId, frame),
        frame.width,
        frame.height,
        overlayModeFit
      )
    : null;
  if (fit) {
    ctx.save();
    try {
      ctx.translate(fit.x, fit.y);
      ctx.scale(fit.scale, fit.scale);
      visualModeController.draw(modeId, ctx, frame);
    } finally {
      ctx.restore();
    }
  } else visualModeController.draw(modeId, ctx, frame);
  diagnosticCall("endRender", modeTimer);

  const trailTimer = diagnosticCall("beginTrail");
  renderTrailHistory(
    timestamp,
    state.trailsEnabled && !fit
      ? visualModeController.getRenderBounds(modeId, frame)
      : null
  );
  diagnosticCall("endTrail", trailTimer);
}
