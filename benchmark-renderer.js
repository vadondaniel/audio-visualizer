(() => {
  const params = window.__audioVisualizerBenchmark;
  const MODE_NAMES = Array.isArray(MODES) ? MODES.slice() : [];

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function buildSyntheticAudio() {
    const fftSize = 2048;
    const length = fftSize / 2;
    const freq = new Uint8Array(length);
    const time = new Uint8Array(length);
    const sampleRate = 48000;

    const gaussian = (x, center, width) => {
      const z = (x - center) / width;
      return Math.exp(-0.5 * z * z);
    };

    let virtualStart = performance.now();

    const analyserStub = {
      fftSize,
      smoothingTimeConstant: 0,
      get frequencyBinCount() {
        return length;
      },
      getByteFrequencyData(target) {
        const t = (performance.now() - virtualStart) / 1000;
        const beat = Math.pow(Math.max(0, Math.sin(Math.PI * t * 2)), 16);
        const bassPulse =
          0.55 + 0.45 * Math.max(0, Math.sin(t * Math.PI * 2 * 1.2 + 0.7));
        const midPulse =
          0.55 + 0.45 * Math.max(0, Math.sin(t * Math.PI * 2 * 2.4 + 1.1));
        const highPulse =
          0.45 + 0.55 * Math.max(0, Math.sin(t * Math.PI * 2 * 3.7 + 2.2));

        for (let i = 0; i < target.length; i++) {
          const hz = (i * sampleRate) / fftSize;
          const bass =
            gaussian(hz, 90, 75) * (55 + 170 * bassPulse + 40 * beat);
          const mids =
            gaussian(hz, 850, 420) * (30 + 125 * midPulse + 35 * beat);
          const highs =
            gaussian(hz, 5200, 2500) * (18 + 115 * highPulse + 25 * beat);
          const air = gaussian(hz, 11500, 4500) * (8 + 55 * highPulse);
          const ripple = (Math.sin(i * 0.23 + t * 8.0) + 1) * 4;
          target[i] = Math.min(
            255,
            Math.round(bass + mids + highs + air + ripple)
          );
        }
      },
      getByteTimeDomainData(target) {
        const t = (performance.now() - virtualStart) / 1000;
        for (let i = 0; i < target.length; i++) {
          const phase = (i / target.length) * Math.PI * 2;
          const signal =
            Math.sin(phase * 2 + t * 6.0) * 0.34 +
            Math.sin(phase * 7 + t * 10.0) * 0.18 +
            Math.sin(phase * 19 + t * 15.0) * 0.08;
          target[i] = Math.max(
            0,
            Math.min(255, Math.round(128 + signal * 110))
          );
        }
      },
    };

    return {
      analyser: analyserStub,
      resetClock() {
        virtualStart = performance.now();
      },
    };
  }

  function setBenchmarkBaseline() {
    state.theme = 0;
    state.bgType = "color";
    state.bgBrightness = 1;
    state.bgBlur = 0;
    state.glowIntensity = params.glowIntensity;
    state.trailsEnabled = params.trailsEnabled;
    state.trailDuration = params.trailDuration;
    state.trailMaxFps = params.trailMaxFps;
    state.reactiveVignette = false;
    state.crtFilter = false;
    state.beatFlash = false;
    state.particleDensity = params.particleDensity;
    state.particleStyle = params.particleStyle;
    state.sensitivity = 1;
    state.valueHandling = "exponential";
    state.smoothingEnabled = true;

    if (typeof applyBackground === "function") applyBackground();
    if (typeof applyFxOverlay === "function") applyFxOverlay();
    if (typeof resetTrailHistory === "function") resetTrailHistory();
    if (typeof clearFrame === "function") clearFrame();
  }

  async function runMode(modeName) {
    const modeIndex = MODE_NAMES.indexOf(modeName);
    if (modeIndex < 0) throw new Error(`Unknown mode: ${modeName}`);

    state.mode = modeIndex;
    if (typeof lastFrameTime !== "undefined") lastFrameTime = 0;
    if (typeof resetTrailHistory === "function") resetTrailHistory();
    if (typeof audioClockMs !== "undefined") audioClockMs = 0;
    if (typeof bassHistory !== "undefined") bassHistory.length = 0;
    if (typeof beatCooldownMsLeft !== "undefined") beatCooldownMsLeft = 0;
    if (typeof sustainedCooldownMsLeft !== "undefined")
      sustainedCooldownMsLeft = 0;
    if (typeof beatPulse !== "undefined") beatPulse = 0;
    if (typeof beatJustHit !== "undefined") beatJustHit = false;
    const audio = buildSyntheticAudio();
    analyser = audio.analyser;
    bufferLength = analyser.frequencyBinCount;
    freqData = new Uint8Array(bufferLength);
    timeData = new Uint8Array(bufferLength);
    audio.resetClock();

    // Let particle/tunnel/etc. state settle without including startup churn.
    await sleep(params.warmupMs);

    diagnostics.startProfile();
    audio.resetClock();
    await sleep(params.durationMs);
    const profile = diagnostics.stopProfile();

    return {
      mode: modeName,
      profile,
    };
  }

  window.__runAudioVisualizerBenchmark = async () => {
    if (window.__benchmarkRunning)
      throw new Error("Benchmark already running.");
    window.__benchmarkRunning = true;

    // Start the normal render loop exactly once. Audio is synthetic, so no
    // permissions or microphone/system-capture setup is involved.
    setBenchmarkBaseline();
    if (typeof startOverlay !== "undefined" && startOverlay)
      startOverlay.style.display = "none";
    if (!window.__benchmarkLoopStarted) {
      window.__benchmarkLoopStarted = true;
      loop();
    }

    const results = [];
    for (const modeName of MODE_NAMES) {
      results.push(await runMode(modeName));
    }

    window.__benchmarkRunning = false;
    return {
      type: "audio-visualizer-benchmark",
      generatedAt: new Date().toISOString(),
      parameters: params,
      baseline: {
        background: "color",
        glowIntensity: state.glowIntensity,
        trailsEnabled: state.trailsEnabled,
        trailDuration: state.trailDuration,
        trailMaxFps: state.trailMaxFps,
        particleDensity: state.particleDensity,
        particleStyle: state.particleStyle,
        reactiveVignette: false,
        crtFilter: false,
        beatFlash: false,
      },
      gpu: diagnostics.buildReport
        ? JSON.parse(diagnostics.buildReport())?.gpu
        : null,
      canvas: {
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        devicePixelRatio: window.devicePixelRatio,
      },
      audio: {
        type: "deterministic synthetic analyser",
        fftSize: 2048,
        sampleRate: 48000,
      },
      results,
    };
  };
})();
