// ---------- performance diagnostics ----------
// Low-overhead runtime profiler. The live HUD keeps a small rolling window;
// explicit profiling stores streaming aggregates, so a profile can run
// indefinitely without retaining one object/array per frame.
const diagnostics = (() => {
  const SAMPLE_COUNT = 240;
  const HISTOGRAM_BIN_MS = 0.1;
  const HISTOGRAM_BINS = 1024; // 0..102.3 ms, with the last bin also absorbing larger values.

  const frameMs = new Float64Array(SAMPLE_COUNT);
  const audioMs = new Float64Array(SAMPLE_COUNT);
  const backgroundMs = new Float64Array(SAMPLE_COUNT);
  const fxMs = new Float64Array(SAMPLE_COUNT);
  const modeMs = new Float64Array(SAMPLE_COUNT);
  const trailMs = new Float64Array(SAMPLE_COUNT);
  const trailCaptureMs = new Float64Array(SAMPLE_COUNT);
  const trailCompositeMs = new Float64Array(SAMPLE_COUNT);
  const presentMs = new Float64Array(SAMPLE_COUNT);
  const unaccountedMs = new Float64Array(SAMPLE_COUNT);

  let index = 0;
  let sampleCount = 0;
  let slowFrames = 0;
  let rafLast = 0;
  let running = false;
  let refreshEstimate = 60;
  let frameOpen = 0;
  let currentSlot = 0;
  let profile = null;
  let lastProfile = null;
  let ui = null;
  let gpuInfo = null;

  const PROFILE_KEYS = [
    "mode",
    "theme",
    "glowIntensity",
    "trailsEnabled",
    "trailDuration",
    "trailMaxFps",
    "particleDensity",
    "particleStyle",
    "bgType",
    "bgBrightness",
    "bgBlur",
    "reactiveVignette",
    "crtFilter",
    "beatFlash",
    "sensitivity",
    "valueHandling",
    "smoothingEnabled",
  ];

  const ANALYSIS_KEYS = [
    "mode",
    "bgType",
    "bgBrightness",
    "bgBlur",
    "glowIntensity",
    "trailsEnabled",
    "trailDuration",
    "trailMaxFps",
    "reactiveVignette",
    "crtFilter",
    "beatFlash",
    "particleDensity",
    "particleStyle",
  ];

  const PHASE_NAMES = [
    "frame",
    "audio",
    "background",
    "fx",
    "mode",
    "trail",
    "trailCapture",
    "trailComposite",
    "present",
    "unaccounted",
  ];

  function makeMetric() {
    return {
      count: 0,
      sum: 0,
      min: Infinity,
      max: 0,
      histogram: new Uint32Array(HISTOGRAM_BINS),
    };
  }

  function addMetric(metric, value, count = 1) {
    if (!metric || !Number.isFinite(value) || count <= 0) return;
    metric.count += count;
    metric.sum += value * count;
    if (value < metric.min) metric.min = value;
    if (value > metric.max) metric.max = value;
    const bin = Math.min(
      HISTOGRAM_BINS - 1,
      Math.max(0, Math.floor(value / HISTOGRAM_BIN_MS))
    );
    metric.histogram[bin] += count;
  }

  function mergeMetric(target, source) {
    if (!source || !source.count) return;
    target.count += source.count;
    target.sum += source.sum;
    if (source.min < target.min) target.min = source.min;
    if (source.max > target.max) target.max = source.max;
    for (let i = 0; i < HISTOGRAM_BINS; i++)
      target.histogram[i] += source.histogram[i];
  }

  function metricPercentile(metric, p) {
    if (!metric?.count) return 0;
    const wanted = Math.max(1, Math.ceil(metric.count * p));
    let cumulative = 0;
    for (let i = 0; i < HISTOGRAM_BINS; i++) {
      cumulative += metric.histogram[i];
      if (cumulative >= wanted)
        return i * HISTOGRAM_BIN_MS + HISTOGRAM_BIN_MS / 2;
    }
    return metric.max;
  }

  function summarizeMetric(metric) {
    if (!metric?.count) return { avg: 0, p95: 0, max: 0 };
    return {
      avg: metric.sum / metric.count,
      p95: metricPercentile(metric, 0.95),
      max: metric.max,
    };
  }

  function push(buffer, value, slot = index) {
    buffer[slot] = Number.isFinite(value) ? value : 0;
  }

  function advanceFrame() {
    index = (index + 1) % SAMPLE_COUNT;
    sampleCount = Math.min(SAMPLE_COUNT, sampleCount + 1);
  }

  function collect(buffer) {
    const out = [];
    const count = sampleCount;
    const start = (index - count + SAMPLE_COUNT) % SAMPLE_COUNT;
    for (let i = 0; i < count; i++)
      out.push(buffer[(start + i) % SAMPLE_COUNT]);
    return out;
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  function average(values) {
    if (!values.length) return 0;
    let total = 0;
    for (const value of values) total += value;
    return total / values.length;
  }

  function estimateRefresh(dt) {
    if (dt < 4 || dt > 50) return;
    const hz = 1000 / dt;
    refreshEstimate += (hz - refreshEstimate) * 0.04;
  }

  function frameBudget() {
    return 1000 / Math.max(30, refreshEstimate);
  }

  function detectGpu() {
    if (gpuInfo) return gpuInfo;
    try {
      const testCanvas = document.createElement("canvas");
      testCanvas.width = 1;
      testCanvas.height = 1;
      const gl =
        testCanvas.getContext("webgl2", {
          failIfMajorPerformanceCaveat: false,
        }) ||
        testCanvas.getContext("webgl", { failIfMajorPerformanceCaveat: false });
      if (!gl)
        return (gpuInfo = { renderer: "Unavailable", vendor: "Unavailable" });
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      gpuInfo = {
        renderer: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        vendor: ext
          ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
          : gl.getParameter(gl.VENDOR),
      };
      return gpuInfo;
    } catch {
      return (gpuInfo = { renderer: "Unavailable", vendor: "Unavailable" });
    }
  }

  function currentModeName() {
    return typeof MODES !== "undefined" && typeof state !== "undefined"
      ? MODES[state.mode]
      : "unknown";
  }

  function getSettingsSnapshot() {
    if (typeof state === "undefined") return {};
    const out = {};
    for (const key of PROFILE_KEYS) {
      if (key === "mode") out[key] = currentModeName();
      else if (key === "theme" && typeof THEMES !== "undefined")
        out[key] = THEMES[state.theme]?.name ?? state.theme;
      else out[key] = state[key];
    }
    return out;
  }

  function stableSettingsKey(settings) {
    return JSON.stringify(settings);
  }

  function makeBucket(settings, key) {
    const phases = {};
    for (const name of PHASE_NAMES) phases[name] = makeMetric();
    return {
      key,
      settings,
      samples: 0,
      durationMs: 0,
      phases,
      slowFrames: 0,
      particleCountTotal: 0,
      trailFramesTotal: 0,
    };
  }

  function ensureProfileBucket() {
    if (!profile) return null;
    const settings = getSettingsSnapshot();
    const key = stableSettingsKey(settings);
    let bucket = profile.buckets.get(key);
    if (!bucket) {
      bucket = makeBucket(settings, key);
      profile.buckets.set(key, bucket);
    }
    return bucket;
  }

  function addSampleToBucket(bucket, slot) {
    const values = {
      frame: frameMs[slot],
      audio: audioMs[slot],
      background: backgroundMs[slot],
      fx: fxMs[slot],
      mode: modeMs[slot],
      trail: trailMs[slot],
      trailCapture: trailCaptureMs[slot],
      trailComposite: trailCompositeMs[slot],
      present: presentMs[slot],
      unaccounted: unaccountedMs[slot],
    };
    bucket.samples++;
    bucket.durationMs += values.frame;
    for (const name of PHASE_NAMES)
      addMetric(bucket.phases[name], values[name]);

    const particleCount =
      typeof particles !== "undefined" && Array.isArray(particles)
        ? particles.length
        : 0;
    const trailCount =
      typeof trailFrames !== "undefined" && Array.isArray(trailFrames)
        ? trailFrames.length
        : 0;
    bucket.particleCountTotal += particleCount;
    bucket.trailFramesTotal += trailCount;

    if (values.frame > frameBudget() * 1.75) bucket.slowFrames++;
  }

  function pushProfileSample(slot) {
    if (!profile) return;
    const bucket = ensureProfileBucket();
    if (!bucket) return;
    addSampleToBucket(bucket, slot);
    profile.samples++;
  }

  function getProcessMetrics() {
    try {
      if (window.electronAPI?.getPerformanceMetrics)
        return window.electronAPI.getPerformanceMetrics();
    } catch {
      // Native process metrics are optional.
    }
    return Promise.resolve(null);
  }

  function sampleProcessMetrics() {
    if (!profile) return;
    profile.processSamples++;
    getProcessMetrics().then((metrics) => {
      if (!metrics || !profile) return;
      for (const metric of metrics) {
        const key = metric.type || metric.name || String(metric.pid);
        let aggregate = profile.processMetrics.get(key);
        if (!aggregate) {
          aggregate = { samples: 0, cpu: makeMetric(), memory: makeMetric() };
          profile.processMetrics.set(key, aggregate);
        }
        addMetric(aggregate.cpu, Number(metric.cpu?.percent) || 0);
        addMetric(
          aggregate.memory,
          Number(metric.memory?.workingSetSize || 0) / 1024
        );
        aggregate.samples++;
      }
    });
  }

  function formatMs(value) {
    return `${value.toFixed(1)} ms`;
  }

  function formatFps(value) {
    return `${Math.round(value)} FPS`;
  }

  function current() {
    const framesWindow = collect(frameMs);
    const renderWindow = collect(modeMs);
    const trailWindow = collect(trailMs);
    const avgFrame = average(framesWindow);
    return {
      fps: avgFrame > 0 ? 1000 / avgFrame : 0,
      avgFrame,
      p95Frame: percentile(framesWindow, 0.95),
      maxFrame: framesWindow.length ? Math.max(...framesWindow) : 0,
      avgRender: average(renderWindow),
      p95Render: percentile(renderWindow, 0.95),
      avgTrail: average(trailWindow),
      p95Trail: percentile(trailWindow, 0.95),
      avgBackground: average(collect(backgroundMs)),
      p95Background: percentile(collect(backgroundMs), 0.95),
      avgFx: average(collect(fxMs)),
      p95Fx: percentile(collect(fxMs), 0.95),
      avgPresent: average(collect(presentMs)),
      p95Present: percentile(collect(presentMs), 0.95),
      slowFrames,
      samples: sampleCount,
      refreshEstimate,
      particleCount:
        typeof particles !== "undefined" && Array.isArray(particles)
          ? particles.length
          : null,
      trailFrames:
        typeof trailFrames !== "undefined" && Array.isArray(trailFrames)
          ? trailFrames.length
          : null,
    };
  }

  function buildReport(extra = {}) {
    const stats = current();
    const canvasInfo = {
      cssWidth: window.innerWidth,
      cssHeight: window.innerHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      devicePixelRatio: window.devicePixelRatio,
    };
    let memory = null;
    if (performance.memory) {
      memory = {
        usedMB: performance.memory.usedJSHeapSize / 1048576,
        totalMB: performance.memory.totalJSHeapSize / 1048576,
        limitMB: performance.memory.jsHeapSizeLimit / 1048576,
      };
    }
    const report = {
      app: "Audio Visualizer",
      generatedAt: new Date().toISOString(),
      runtime: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        language: navigator.language,
      },
      visual: getSettingsSnapshot(),
      audio: {
        running: !!analyser,
        contextState: typeof audioCtx !== "undefined" ? audioCtx?.state : null,
        sampleRate:
          typeof audioCtx !== "undefined" ? audioCtx?.sampleRate : null,
        fftSize:
          typeof analyser !== "undefined" && analyser ? analyser.fftSize : null,
        smoothingEnabled: state.smoothingEnabled,
        sensitivity: state.sensitivity,
      },
      canvas: canvasInfo,
      performance: stats,
      memory,
      gpu: detectGpu(),
      ...extra,
    };
    return JSON.stringify(report, null, 2);
  }

  function summarizeProfileBucket(bucket) {
    const result = {
      settings: bucket.settings,
      samples: bucket.samples,
      durationMs: bucket.durationMs,
    };
    for (const [name, metric] of Object.entries(bucket.phases))
      result[name] = summarizeMetric(metric);
    result.slowFrames = bucket.slowFrames;
    result.avgParticleCount = bucket.samples
      ? bucket.particleCountTotal / bucket.samples
      : 0;
    result.avgTrailFrames = bucket.samples
      ? bucket.trailFramesTotal / bucket.samples
      : 0;
    return result;
  }

  function buildSettingsAnalysis(buckets) {
    const byKey = {};
    for (const settingKey of ANALYSIS_KEYS) {
      const values = new Map();
      for (const bucket of buckets) {
        if (bucket.samples < 30) continue;
        const value = bucket.settings[settingKey];
        const key = JSON.stringify(value);
        let entry = values.get(key);
        if (!entry) {
          entry = {
            value,
            samples: 0,
            frame: makeMetric(),
            mode: makeMetric(),
            trail: makeMetric(),
            present: makeMetric(),
          };
          values.set(key, entry);
        }
        entry.samples += bucket.samples;
        mergeMetric(entry.frame, bucket.frameMetric);
        mergeMetric(entry.mode, bucket.modeMetric);
        mergeMetric(entry.trail, bucket.trailMetric);
        mergeMetric(entry.present, bucket.presentMetric);
      }
      byKey[settingKey] = [...values.values()]
        .map((entry) => ({
          value: entry.value,
          samples: entry.samples,
          frame: summarizeMetric(entry.frame),
          mode: summarizeMetric(entry.mode),
          trail: summarizeMetric(entry.trail),
          present: summarizeMetric(entry.present),
        }))
        .sort((a, b) => a.frame.avg - b.frame.avg);
    }
    return byKey;
  }

  function buildProfile() {
    if (!profile) return lastProfile;
    const rawBuckets = [...profile.buckets.values()];
    const buckets = rawBuckets
      .sort((a, b) => b.samples - a.samples)
      .map((bucket) => {
        const summary = summarizeProfileBucket(bucket);
        summary.frameMetric = bucket.phases.frame;
        summary.modeMetric = bucket.phases.mode;
        summary.trailMetric = bucket.phases.trail;
        summary.presentMetric = bucket.phases.present;
        return summary;
      });

    const settingsAnalysis = buildSettingsAnalysis(buckets);
    for (const bucket of buckets) {
      delete bucket.frameMetric;
      delete bucket.modeMetric;
      delete bucket.trailMetric;
      delete bucket.presentMetric;
    }

    const processSummary = {};
    for (const [key, aggregate] of profile.processMetrics) {
      processSummary[key] = {
        cpuPercentAvg: summarizeMetric(aggregate.cpu).avg,
        cpuPercentP95: summarizeMetric(aggregate.cpu).p95,
        memoryMBAvg: summarizeMetric(aggregate.memory).avg,
        memoryMBP95: summarizeMetric(aggregate.memory).p95,
        samples: aggregate.samples,
      };
    }

    return {
      app: "Audio Visualizer",
      type: "profile",
      startedAt: profile.startedAt,
      durationMs: Math.max(0, performance.now() - profile.startedPerfMs),
      sampleCount: profile.samples,
      retention: "streaming aggregates; no frame-count stop",
      buckets,
      process: processSummary,
      settingsAnalysis,
      gpu: detectGpu(),
      refreshEstimate,
      canvas: {
        cssWidth: window.innerWidth,
        cssHeight: window.innerHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        devicePixelRatio: window.devicePixelRatio,
      },
      audio: {
        sampleRate:
          typeof audioCtx !== "undefined" ? audioCtx?.sampleRate : null,
        fftSize:
          typeof analyser !== "undefined" && analyser ? analyser.fftSize : null,
      },
    };
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      return copied;
    }
  }

  async function copyReport() {
    return copyText(buildReport());
  }

  async function copyProfile() {
    const report = buildProfile();
    return report ? copyText(JSON.stringify(report, null, 2)) : false;
  }

  function reset() {
    frameMs.fill(0);
    audioMs.fill(0);
    backgroundMs.fill(0);
    fxMs.fill(0);
    modeMs.fill(0);
    trailMs.fill(0);
    trailCaptureMs.fill(0);
    trailCompositeMs.fill(0);
    presentMs.fill(0);
    unaccountedMs.fill(0);
    index = 0;
    sampleCount = 0;
    slowFrames = 0;
    rafLast = 0;
  }

  function startProfile() {
    if (profile) return false;
    reset();
    lastProfile = null;
    profile = {
      startedAt: new Date().toISOString(),
      startedPerfMs: performance.now(),
      samples: 0,
      processSamples: 0,
      processMetrics: new Map(),
      buckets: new Map(),
      nextProcessSamplePerfMs: performance.now(),
    };
    running = true;
    updateProfileUi();
    return true;
  }

  function stopProfile() {
    if (!profile) return lastProfile;
    const finished = buildProfile();
    lastProfile = finished;
    profile = null;
    updateProfileUi();
    return finished;
  }

  function profileActive() {
    return !!profile;
  }

  function tickStart(timestamp) {
    if (!running && !profile) return;

    if (rafLast > 0) {
      if (frameOpen)
        push(
          unaccountedMs,
          Math.max(0, performance.now() - frameOpen),
          currentSlot
        );
      if (profile) {
        pushProfileSample(currentSlot);
        const now = performance.now();
        if (now >= profile.nextProcessSamplePerfMs) {
          profile.nextProcessSamplePerfMs = now + 1000;
          sampleProcessMetrics();
        }
      }

      advanceFrame();
      currentSlot = index;
      const dt = timestamp - rafLast;
      push(frameMs, dt, currentSlot);
      estimateRefresh(dt);
      if (dt > frameBudget() * 1.75) slowFrames++;
    } else {
      currentSlot = index;
    }

    rafLast = timestamp;
    frameOpen = performance.now();
  }

  function beginPhase() {
    return running || profile ? performance.now() : 0;
  }
  function endPhase(buffer, start) {
    if (start) push(buffer, performance.now() - start, currentSlot);
  }
  function beginAudio() {
    return beginPhase();
  }
  function endAudio(start) {
    endPhase(audioMs, start);
  }
  function beginBackground() {
    return beginPhase();
  }
  function endBackground(start) {
    endPhase(backgroundMs, start);
  }
  function beginFx() {
    return beginPhase();
  }
  function endFx(start) {
    endPhase(fxMs, start);
  }
  function beginRender() {
    return beginPhase();
  }
  function endRender(start) {
    endPhase(modeMs, start);
  }
  function beginTrail() {
    return beginPhase();
  }
  function endTrail(start) {
    endPhase(trailMs, start);
  }
  function beginTrailCapture() {
    return beginPhase();
  }
  function endTrailCapture(start) {
    endPhase(trailCaptureMs, start);
  }
  function beginTrailComposite() {
    return beginPhase();
  }
  function endTrailComposite(start) {
    endPhase(trailCompositeMs, start);
  }
  function beginPresent() {
    return beginPhase();
  }
  function endPresent(start) {
    endPhase(presentMs, start);
  }

  function updateProfileUi() {
    if (!ui) return;
    ui.profileButton.textContent = profile ? "Stop profile" : "Record profile";
    ui.profileButton.classList.toggle("recording", !!profile);
    ui.profileStatus.textContent = profile
      ? `${profile.samples.toLocaleString()} frames · ${profile.buckets.size} configurations · streaming`
      : lastProfile
        ? `${lastProfile.sampleCount.toLocaleString()} frames captured · ${lastProfile.buckets.length} configurations`
        : "Record while switching modes/settings, then copy the profile.";
    ui.copyProfile.disabled = !profile && !lastProfile;
  }

  function renderUi() {
    if (!ui) return;
    const stats = current();
    ui.fps.textContent = stats.fps ? formatFps(stats.fps) : "—";
    ui.frame.textContent = stats.avgFrame ? formatMs(stats.avgFrame) : "—";
    ui.render.textContent = stats.p95Render ? formatMs(stats.p95Render) : "—";
    ui.trail.textContent = stats.p95Trail ? formatMs(stats.p95Trail) : "—";
    ui.layers.textContent =
      stats.p95Background || stats.p95Fx
        ? `BG ${formatMs(stats.p95Background)} · FX ${formatMs(stats.p95Fx)}`
        : "—";
    ui.load.textContent =
      stats.particleCount == null ? "—" : `${stats.particleCount} particles`;
    ui.detail.textContent =
      `BG ${formatMs(stats.p95Background)} · MODE ${formatMs(stats.p95Render)} · TRAIL ${formatMs(stats.p95Trail)} · FX ${formatMs(stats.p95Fx)} · ${Math.round(stats.refreshEstimate)} Hz` +
      (stats.slowFrames ? ` · ${stats.slowFrames} slow` : "");
    updateProfileUi();
  }

  function init() {
    ui = {
      root: document.getElementById("diagnosticsStatus"),
      fps: document.getElementById("diagFps"),
      frame: document.getElementById("diagFrame"),
      render: document.getElementById("diagRender"),
      trail: document.getElementById("diagTrail"),
      load: document.getElementById("diagLoad"),
      detail: document.getElementById("diagDetail"),
      layers: document.getElementById("diagLayers"),
      profileButton: document.getElementById("recordProfileBtn"),
      copyProfile: document.getElementById("copyProfileBtn"),
      profileStatus: document.getElementById("profileStatus"),
    };

    document
      .getElementById("copyDiagnosticsBtn")
      ?.addEventListener("click", async () => {
        const ok = await copyReport();
        const button = document.getElementById("copyDiagnosticsBtn");
        if (!button) return;
        const original = button.textContent;
        button.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(() => (button.textContent = original), 1200);
      });

    document
      .getElementById("resetDiagnosticsBtn")
      ?.addEventListener("click", () => {
        reset();
        renderUi();
      });

    ui.profileButton?.addEventListener("click", async () => {
      if (profile) {
        const finished = stopProfile();
        const ok = await copyText(JSON.stringify(finished, null, 2));
        ui.profileStatus.textContent = ok
          ? "Profile copied. You can paste it here."
          : "Profile captured; copy failed.";
      } else {
        startProfile();
      }
    });

    ui.copyProfile?.addEventListener("click", async () => {
      const ok = await copyProfile();
      ui.profileStatus.textContent = ok
        ? "Profile copied."
        : "No active profile.";
    });

    setInterval(renderUi, 500);
    renderUi();
  }

  function start() {
    running = true;
  }

  return {
    init,
    start,
    tickStart,
    beginAudio,
    endAudio,
    beginBackground,
    endBackground,
    beginFx,
    endFx,
    beginRender,
    endRender,
    beginTrail,
    endTrail,
    beginTrailCapture,
    endTrailCapture,
    beginTrailComposite,
    endTrailComposite,
    beginPresent,
    endPresent,
    current,
    buildReport,
    copyReport,
    startProfile,
    stopProfile,
    profileActive,
    buildProfile,
    copyProfile,
  };
})();

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      diagnostics.init();
      diagnostics.start();
    },
    { once: true }
  );
} else {
  diagnostics.init();
  diagnostics.start();
}
