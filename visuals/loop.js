// ---------- main loop ----------
let lastFrameTime = 0;

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

  const bass = bandAverage(freqData, 0, 0.015); // ~0-300Hz (True Bass)
  const mid = bandAverage(freqData, 0.015, 0.1); // ~300-2000Hz (Mids)
  const treble = bandAverage(freqData, 0.1, 0.5); // ~2000-10000Hz (Highs)
  const rawBass = normalizeEnergy(
    bass,
    AUDIO_TUNING.particleFloor,
    AUDIO_TUNING.particleRange
  );
  const rawMid = normalizeEnergy(mid, 15, 165);
  const rawTreble = normalizeEnergy(treble, 12, 155);

  const bassLevel = Math.min(
    1,
    applyValueHandling(rawBass, state.valueHandling) * state.sensitivity
  );
  const midLevel = Math.min(
    1,
    applyValueHandling(rawMid, state.valueHandling) * state.sensitivity
  );
  const trebleLevel = Math.min(
    1,
    applyValueHandling(rawTreble, state.valueHandling) * state.sensitivity
  );
  updateBeat(bass, elapsedMs, dtSec);
  diagnosticCall("endAudio", audioTimer);

  if (THEMES[state.theme].colorCycle || THEMES[state.theme].cycle) {
    const { baseDegPerSec, midDegPerSecPerUnit } = VISUAL_TUNING.hueCycle;
    state.hueShift =
      (state.hueShift + (baseDegPerSec + mid * midDegPerSecPerUnit) * dtSec) %
      360;
  }

  const clearTimer = diagnosticCall("beginClear");
  clearFrame();
  diagnosticCall("endClear", clearTimer);

  const backgroundTimer = diagnosticCall("beginBackground");
  if (typeof renderProceduralBackground === "function") {
    renderProceduralBackground(
      dtSec,
      bassLevel,
      midLevel,
      trebleLevel,
      beatPulse
    );
  }
  diagnosticCall("endBackground", backgroundTimer);

  const fxTimer = diagnosticCall("beginFx");
  if (typeof updateFxLive === "function") {
    updateFxLive(bassLevel, midLevel, trebleLevel, beatPulse);
  }
  diagnosticCall("endFx", fxTimer);

  const modeTimer = diagnosticCall("beginRender");

  switch (MODES[state.mode]) {
    case "bars":
      drawBars(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "radial":
      drawRadial(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "waveform":
      drawWaveform(bassLevel, midLevel, trebleLevel);
      break;
    case "particles":
      drawParticles(bass, bassLevel, midLevel, trebleLevel, elapsedMs);
      break;
    case "kaleidoscope":
      drawKaleidoscope(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "tunnel":
      drawTunnel(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "waves":
      drawWaves(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "aurora":
      drawAurora(bassLevel, midLevel, trebleLevel, dtSec);
      break;
    case "cascade":
      drawCascade(bassLevel, midLevel, trebleLevel, dtSec);
      break;
  }
  diagnosticCall("endRender", modeTimer);

  const trailTimer = diagnosticCall("beginTrail");
  renderTrailHistory(timestamp);
  diagnosticCall("endTrail", trailTimer);
  diagnosticCall("endFrame");
}
