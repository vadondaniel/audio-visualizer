(() => {
  const params = window.__audioVisualizerBenchmark || {};
  // `MODES` is declared as a top-level `const` by constants.js. Electron's
  // executeJavaScript path can expose page globals slightly differently across
  // versions/worlds, so do not let mode discovery silently produce an empty
  // benchmark. Keep the same canonical ordering as constants.js as a fallback.
  const FALLBACK_MODE_NAMES = [
    "bars",
    "radial",
    "waveform",
    "particles",
    "kaleidoscope",
    "tunnel",
    "waves",
    "aurora",
    "cascade",
  ];
  const MODE_NAMES =
    Array.isArray(MODES) && MODES.length
      ? MODES.slice()
      : FALLBACK_MODE_NAMES.slice();
  const SCENARIO_NAMES = ["mixed", "drop", "bass", "highs", "full", "silence"];
  const scenarios = (
    Array.isArray(params.scenarios) && params.scenarios.length
      ? params.scenarios
      : ["mixed"]
  ).filter((name) => SCENARIO_NAMES.includes(name));
  const repeats = Math.max(1, Math.floor(Number(params.repeats) || 1));
  const seed = Number.isFinite(params.seed)
    ? Math.trunc(params.seed)
    : 20260906;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function makeRng(initialSeed) {
    let s = initialSeed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  }

  function scenarioStrengths(name, t) {
    const pulse = Math.max(0, Math.sin(Math.PI * t * 2));
    const dropPulse = Math.pow(pulse, 28);
    const bass =
      0.55 + 0.45 * Math.max(0, Math.sin(t * Math.PI * 2 * 1.2 + 0.7));
    const mid =
      0.55 + 0.45 * Math.max(0, Math.sin(t * Math.PI * 2 * 2.4 + 1.1));
    const high =
      0.45 + 0.55 * Math.max(0, Math.sin(t * Math.PI * 2 * 3.7 + 2.2));
    switch (name) {
      case "drop":
        return {
          bass: 0.85 + dropPulse * 0.15,
          mid: 0.72 + dropPulse * 0.28,
          high: 0.68 + dropPulse * 0.32,
          beat: dropPulse,
        };
      case "bass":
        return { bass: 0.9, mid: 0.22, high: 0.08, beat: Math.pow(pulse, 20) };
      case "highs":
        return { bass: 0.12, mid: 0.35, high: 1, beat: Math.pow(pulse, 12) };
      case "full":
        return { bass: 1, mid: 1, high: 1, beat: Math.pow(pulse, 8) };
      case "silence":
        return { bass: 0.03, mid: 0.02, high: 0.01, beat: 0 };
      default:
        return { bass, mid, high, beat: Math.pow(pulse, 16) };
    }
  }

  function buildSyntheticAudio(scenarioName, scenarioSeed) {
    const fftSize = 2048;
    const length = fftSize / 2;
    const freq = new Uint8Array(length);
    const time = new Uint8Array(length);
    const sampleRate = 48000;
    const rng = makeRng(scenarioSeed);
    const noise = new Float32Array(length);
    for (let i = 0; i < noise.length; i++) noise[i] = rng() * 2 - 1;
    let virtualStart = performance.now();

    const gaussian = (x, center, width) => {
      const z = (x - center) / width;
      return Math.exp(-0.5 * z * z);
    };

    const analyserStub = {
      fftSize,
      smoothingTimeConstant: 0.82,
      get frequencyBinCount() {
        return length;
      },
      getByteFrequencyData(target) {
        const t = (performance.now() - virtualStart) / 1000;
        const strengths = scenarioStrengths(scenarioName, t);
        for (let i = 0; i < target.length; i++) {
          const hz = (i * sampleRate) / fftSize;
          const bass =
            gaussian(hz, 90, 75) *
            (10 + 230 * strengths.bass + 45 * strengths.beat);
          const mids =
            gaussian(hz, 850, 420) *
            (5 + 155 * strengths.mid + 40 * strengths.beat);
          const highs =
            gaussian(hz, 5200, 2500) *
            (3 + 130 * strengths.high + 30 * strengths.beat);
          const air = gaussian(hz, 11500, 4500) * (2 + 55 * strengths.high);
          const ripple = (Math.sin(i * 0.23 + t * 8.0) + 1) * 4;
          target[i] = Math.min(
            255,
            Math.round(
              bass +
                mids +
                highs +
                air +
                ripple * (scenarioName === "silence" ? 0 : 1)
            )
          );
        }
      },
      getByteTimeDomainData(target) {
        const t = (performance.now() - virtualStart) / 1000;
        const strengths = scenarioStrengths(scenarioName, t);
        const isSilent = scenarioName === "silence";

        // The real AnalyserNode returns 1024 time-domain samples for the
        // app's 2048-point FFT. Give those samples broadband, audio-like
        // variation rather than a few slow, obvious sine waves.
        const envelope = isSilent
          ? 0.003
          : Math.min(
              1.15,
              0.1 +
                0.28 * strengths.bass +
                0.22 * strengths.mid +
                0.2 * strengths.high +
                0.42 * strengths.beat
            );
        const phaseDrift = t * 0.9;
        let filteredNoise = 0;

        for (let i = 0; i < target.length; i++) {
          const x = i / target.length;
          const phase = x * Math.PI * 2;

          const low =
            Math.sin(phase * 4.0 + phaseDrift) *
              0.16 *
              (0.55 + 0.45 * strengths.bass) +
            Math.sin(phase * 6.0 - phaseDrift * 0.7 + 0.8) *
              0.09 *
              strengths.bass +
            Math.sin(phase * 9.0 + 1.7) * 0.06 * strengths.bass;

          const mid =
            Math.sin(phase * 13.0 + t * 6.7) * 0.11 * strengths.mid +
            Math.sin(phase * 19.0 - t * 8.3 + 0.4) * 0.09 * strengths.mid +
            Math.sin(phase * 27.0 + t * 11.1 + 1.6) * 0.07 * strengths.mid +
            Math.sin(phase * 35.0 - t * 13.7 + 2.4) * 0.05 * strengths.mid;

          const high =
            Math.sin(phase * 47.0 + t * 17.3) * 0.05 * strengths.high +
            Math.sin(phase * 59.0 - t * 21.1 + 0.9) * 0.04 * strengths.high +
            Math.sin(phase * 73.0 + t * 25.7 + 2.0) * 0.03 * strengths.high +
            Math.sin(phase * 91.0 - t * 31.7) * 0.025 * strengths.high;

          // Low-pass deterministic noise adds the dense, irregular texture
          // visible in a real time-domain capture without nondeterminism.
          filteredNoise = filteredNoise * 0.78 + noise[i] * 0.22;

          let signal =
            low + mid + high + filteredNoise * (0.08 + 0.1 * strengths.high);
          signal += Math.sin(i * 0.71 + t * 37.0) * 0.022 * strengths.high;
          signal *= envelope;

          target[i] = Math.max(
            0,
            Math.min(255, Math.round(128 + signal * 120))
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
    state.waveformStyle = params.waveformStyle || "filled";
    state.sensitivity = 1;
    state.valueHandling = "exponential";
    state.smoothingEnabled = true;
    if (typeof applyBackground === "function") applyBackground();
    if (typeof applyFxOverlay === "function") applyFxOverlay();
    if (typeof resetTrailHistory === "function") resetTrailHistory();
    if (typeof clearFrame === "function") clearFrame();
  }

  function installOperationCounter() {
    if (!params.operationCounts || window.__benchmarkOpCounterInstalled)
      return null;
    const proto = CanvasRenderingContext2D?.prototype;
    if (!proto) return null;
    const names = [
      "beginPath",
      "closePath",
      "fill",
      "stroke",
      "fillRect",
      "strokeRect",
      "clearRect",
      "rect",
      "arc",
      "arcTo",
      "ellipse",
      "moveTo",
      "lineTo",
      "bezierCurveTo",
      "quadraticCurveTo",
      "save",
      "restore",
      "translate",
      "rotate",
      "scale",
      "setTransform",
      "resetTransform",
      "fillText",
      "strokeText",
      "drawImage",
      "putImageData",
      "getImageData",
      "createImageData",
      "clip",
      "isPointInPath",
      "createLinearGradient",
      "createRadialGradient",
      "createConicGradient",
      "createPattern",
      "measureText",
    ];
    const originals = new Map();
    let active = null;
    for (const name of names) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      originals.set(name, original);
      proto[name] = function (...args) {
        if (active) active[name] = (active[name] || 0) + 1;
        return original.apply(this, args);
      };
    }
    window.__benchmarkOpCounterInstalled = true;
    return {
      start() {
        active = {};
      },
      stop() {
        const out = active || {};
        active = null;
        return out;
      },
      restore() {
        for (const [name, fn] of originals) proto[name] = fn;
        window.__benchmarkOpCounterInstalled = false;
      },
    };
  }

  let benchmarkVisible = !document.hidden;
  let benchmarkDisplayInfo = params.displayInfo || null;
  let displaySettling = false;
  let displayChangePauseTimer = null;

  function displayLabel(info = benchmarkDisplayInfo) {
    if (!info) return "display unknown";
    const hz = Number(info.displayFrequency);
    return Number.isFinite(hz) && hz > 0
      ? `${info.label || "display"} @ ${hz} Hz`
      : `${info.label || "display"} @ refresh unknown`;
  }

  function benchmarkPaused() {
    return document.hidden || displaySettling;
  }

  async function sleepActive(durationMs) {
    const target = Math.max(0, Number(durationMs) || 0);
    const started = performance.now();
    let activeElapsed = 0;
    let last = started;
    while (activeElapsed < target) {
      await sleep(Math.min(50, Math.max(10, target - activeElapsed)));
      const now = performance.now();
      if (!benchmarkPaused()) activeElapsed += Math.max(0, now - last);
      last = now;
    }
    return activeElapsed;
  }

  function pauseBenchmark(reason) {
    if (!window.__benchmarkRunning) return;
    if (reason.startsWith("window hidden")) benchmarkVisible = false;
    if (reason.startsWith("display")) displaySettling = true;
    if (typeof diagnostics?.pause === "function") diagnostics.pause(reason);
    console.log(`[benchmark] PAUSE — ${reason}`);
  }

  function maybeResumeBenchmark(reason) {
    if (document.hidden || displaySettling) return;
    benchmarkVisible = true;
    if (typeof diagnostics?.resume === "function") diagnostics.resume();
    console.log(`[benchmark] RESUME — ${reason} · ${displayLabel()}`);
  }

  function setDisplayInfo(info) {
    const oldId = benchmarkDisplayInfo?.id;
    const oldHz = Number(benchmarkDisplayInfo?.displayFrequency) || null;
    benchmarkDisplayInfo = info || null;
    window.__benchmarkDisplayInfo = benchmarkDisplayInfo;
    if (typeof diagnostics?.setDisplayInfo === "function")
      diagnostics.setDisplayInfo(benchmarkDisplayInfo);

    const newId = benchmarkDisplayInfo?.id;
    const newHz = Number(benchmarkDisplayInfo?.displayFrequency) || null;
    if (window.__benchmarkRunning && (oldId !== newId || oldHz !== newHz)) {
      clearTimeout(displayChangePauseTimer);
      displaySettling = true;
      pauseBenchmark(`display changed → ${displayLabel()}`);
      displayChangePauseTimer = setTimeout(() => {
        displaySettling = false;
        maybeResumeBenchmark("display settled");
      }, 750);
    }
  }

  window.__setBenchmarkDisplayInfo = setDisplayInfo;

  function onVisibilityChange() {
    benchmarkVisible = !document.hidden;
    if (!window.__benchmarkRunning) return;
    if (document.hidden) {
      pauseBenchmark("window hidden");
    } else {
      maybeResumeBenchmark("window visible");
    }
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  async function runOperationCount(
    modeName,
    scenarioName,
    repeat,
    scenarioSeed,
    progressIndex,
    progressTotal
  ) {
    const counter = installOperationCounter();
    if (!counter) return null;
    while (benchmarkPaused()) await sleep(100);
    console.log(
      `[benchmark] PROGRESS — OPS ${progressIndex}/${progressTotal} · ${modeName} [${scenarioName}/${repeat}] · ${displayLabel()}`
    );
    state.mode = MODE_NAMES.indexOf(modeName);
    const audio = buildSyntheticAudio(scenarioName, scenarioSeed);
    analyser = audio.analyser;
    bufferLength = analyser.frequencyBinCount;
    freqData = new Uint8Array(bufferLength);
    timeData = new Uint8Array(bufferLength);
    audio.resetClock();
    if (typeof resetTrailHistory === "function") resetTrailHistory();
    await sleepActive(250);
    counter.start();
    await sleepActive(
      Math.max(250, Number(params.operationDurationMs) || 1000)
    );
    const counts = counter.stop();
    console.log(
      `[benchmark] PROGRESS — OPS ${progressIndex}/${progressTotal} done · ${modeName} [${scenarioName}/${repeat}]`
    );
    return {
      mode: modeName,
      scenario: scenarioName,
      repeat,
      durationMs: Math.max(250, Number(params.operationDurationMs) || 1000),
      counts,
    };
  }

  async function traceStart(meta) {
    if (
      !params.renderTracing ||
      typeof window.electronAPI?.benchmarkStartRenderTrace !== "function"
    )
      return false;
    try {
      const ok = await window.electronAPI.benchmarkStartRenderTrace(meta);
      if (ok) {
        performance.mark("benchmark-render-start");
        return true;
      }
    } catch (error) {
      console.warn("[benchmark] Rendering trace start failed:", error);
    }
    return false;
  }

  async function traceStop(meta) {
    if (
      !params.renderTracing ||
      typeof window.electronAPI?.benchmarkStopRenderTrace !== "function"
    )
      return null;
    try {
      performance.mark("benchmark-render-end");
      return await window.electronAPI.benchmarkStopRenderTrace(meta);
    } catch (error) {
      console.warn("[benchmark] Rendering trace stop failed:", error);
      return { available: false, error: error?.message || String(error) };
    }
  }

  async function runMode(
    modeName,
    scenarioName,
    repeat,
    scenarioSeed,
    progressIndex,
    progressTotal
  ) {
    while (benchmarkPaused()) await sleep(100);
    console.log(
      `[benchmark] PROGRESS — TIMING ${progressIndex}/${progressTotal} · ${modeName} [${scenarioName}/${repeat}] · ${displayLabel()}`
    );
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
    const audio = buildSyntheticAudio(scenarioName, scenarioSeed);
    analyser = audio.analyser;
    bufferLength = analyser.frequencyBinCount;
    freqData = new Uint8Array(bufferLength);
    timeData = new Uint8Array(bufferLength);
    audio.resetClock();
    await sleepActive(params.warmupMs);
    const tracingStarted = await traceStart({
      mode: modeName,
      scenario: scenarioName,
      repeat,
    });
    diagnostics.startProfile();
    audio.resetClock();
    await sleepActive(params.durationMs);
    const profile = diagnostics.stopProfile();
    const rendering = tracingStarted
      ? await traceStop({ mode: modeName, scenario: scenarioName, repeat })
      : null;
    const avg = profile?.buckets?.[0]?.frame?.avg;
    const p95 = profile?.buckets?.[0]?.frame?.p95;
    console.log(
      `[benchmark] PROGRESS — TIMING ${progressIndex}/${progressTotal} done · ${modeName} [${scenarioName}/${repeat}] avg=${Number.isFinite(avg) ? avg.toFixed(2) : "?"}ms p95=${Number.isFinite(p95) ? p95.toFixed(2) : "?"}ms · ${displayLabel()}`
    );
    return {
      mode: modeName,
      scenario: scenarioName,
      repeat,
      profile,
      rendering,
    };
  }

  function shuffle(array, rng) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  window.__runAudioVisualizerBenchmark = async () => {
    if (window.__benchmarkRunning)
      throw new Error("Benchmark already running.");
    window.__benchmarkRunning = true;
    if (!MODE_NAMES.length) {
      window.__benchmarkRunning = false;
      throw new Error("Benchmark has no visual modes configured.");
    }
    if (!scenarios.length) {
      window.__benchmarkRunning = false;
      throw new Error(
        "Benchmark has no valid scenarios. Requested: " +
          JSON.stringify(params.scenarios)
      );
    }
    setBenchmarkBaseline();
    if (typeof startOverlay !== "undefined" && startOverlay)
      startOverlay.style.display = "none";
    if (!window.__benchmarkLoopStarted) {
      window.__benchmarkLoopStarted = true;
      loop();
    }

    const results = [];
    const operationResults = [];
    const runPlan = [];
    let planIndex = 0;
    for (let repeat = 1; repeat <= repeats; repeat++) {
      for (const scenario of scenarios) {
        const modes = shuffle(
          MODE_NAMES.slice(),
          makeRng(seed + repeat * 1009 + scenario.length * 37)
        );
        for (const mode of modes)
          runPlan.push({ mode, scenario, repeat, order: planIndex++ });
      }
    }

    console.log(
      `[benchmark] PROGRESS — 0/${runPlan.length} timing · ${params.operationCounts ? `0/${runPlan.length} ops · ` : ""}${displayLabel()}`
    );

    for (let planIndex = 0; planIndex < runPlan.length; planIndex++) {
      const item = runPlan[planIndex];
      while (benchmarkPaused()) await sleep(100);
      const scenarioSeed =
        seed +
        item.repeat * 1000003 +
        item.scenario.length * 1009 +
        item.mode.length * 17;
      const run = await runMode(
        item.mode,
        item.scenario,
        item.repeat,
        scenarioSeed,
        planIndex + 1,
        runPlan.length
      );
      run.executionOrder = item.order;
      results.push(run);
      if (params.operationCounts) {
        const opResult = await runOperationCount(
          item.mode,
          item.scenario,
          item.repeat,
          scenarioSeed,
          planIndex + 1,
          runPlan.length
        );
        if (opResult) {
          opResult.executionOrder = item.order;
          operationResults.push(opResult);
        }
      }
    }

    window.__benchmarkRunning = false;
    return {
      type: "audio-visualizer-benchmark",
      generatedAt: new Date().toISOString(),
      parameters: params,
      execution: {
        scenarios,
        repeats,
        seed,
        randomizedOrder: true,
        runCount: runPlan.length,
        completedCount: results.length,
        display: benchmarkDisplayInfo,
      },
      baseline: {
        background: "color",
        glowIntensity: state.glowIntensity,
        trailsEnabled: state.trailsEnabled,
        trailDuration: state.trailDuration,
        trailMaxFps: state.trailMaxFps,
        particleDensity: state.particleDensity,
        particleStyle: state.particleStyle,
        waveformStyle: state.waveformStyle,
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
        scenarios,
      },
      renderingMeasurement: {
        enabled: Boolean(params.renderTracing),
        traceCategorySet: [
          "blink.user_timing",
          "cc",
          "compositor",
          "gpu",
          "viz",
          "disabled-by-default-skia",
          "disabled-by-default-skia.gpu",
          "disabled-by-default-viz.gpu_composite_time",
          "disabled-by-default-display.framedisplayed",
        ],
        note: "Trace durations are summed Chromium/Skia/GPU/compositor work across threads; overlapping events can exceed wall-clock frame time. Raster work is per isolated mode run, so it is attributable to that mode's rendering workload.",
      },
      results,
      operationCounts: operationResults,
    };
  };
})();
