const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  contentTracing,
} = require("electron");
const path = require("path");
const fs = require("fs");

const args = new Map();

// npm 11 parses unknown `--foo=bar` arguments as npm config and exposes them
// as npm_config_foo instead of reliably forwarding them through the command
// line. Read both sources so `npm run benchmark -- --foo=bar` works across
// npm/Electron versions.
const rawArgv = [
  ...process.argv.slice(2),
  ...(process.env.npm_config_argv
    ? (() => {
        try {
          const parsed = JSON.parse(process.env.npm_config_argv);
          return Array.isArray(parsed?.original) ? parsed.original : [];
        } catch {
          return [];
        }
      })()
    : []),
];

for (let i = 0; i < rawArgv.length; i++) {
  const arg = rawArgv[i];
  if (arg === "--") continue;
  if (!arg.startsWith("--")) continue;
  const body = arg.slice(2);
  const eq = body.indexOf("=");
  if (eq >= 0) {
    args.set(body.slice(0, eq), body.slice(eq + 1));
  } else {
    const next = rawArgv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(body, next);
      i++;
    } else {
      args.set(body, "true");
    }
  }
}

// npm 11 can consume unknown script flags as npm config variables. Merge
// those variables in after CLI parsing, but only for benchmark-specific keys.
const npmOptionNames = [
  "duration",
  "warmup",
  "glow",
  "trail-duration",
  "trail-fps",
  "particle-density",
  "particle-style",
  "waveform-style",
  "keep-window",
  "trails",
  "repeats",
  "scenarios",
  "ops",
  "operation-counts",
  "seed",
];
for (const name of npmOptionNames) {
  const envName = `npm_config_${name.replace(/-/g, "_")}`;
  if (process.env[envName] !== undefined && !args.has(name)) {
    args.set(name, process.env[envName]);
  }
}

function numberArg(name, fallback, min, max) {
  const value = Number(args.get(name));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

const durationMs = numberArg("duration", 5000, 1000, 60000) * 1;
const warmupMs = numberArg("warmup", 1000, 250, 10000) * 1;
const glowIntensity = numberArg("glow", 0.5, 0, 2);
const trailDuration = numberArg("trail-duration", 140, 20, 1000);
const trailMaxFps = numberArg("trail-fps", 60, 15, 240);
const particleDensity = numberArg("particle-density", 1, 0.25, 3);
const particleStyle = args.get("particle-style") || "flow";
const waveformStyleArg = args.get("waveform-style") || "filled";
const waveformStyle = waveformStyleArg === "filled" ? "filled" : "line";
const keepWindow = args.get("keep-window") === "true";
const repeats = Math.max(
  1,
  Math.min(10, Math.floor(numberArg("repeats", 1, 1, 10)))
);
const scenarios = (args.get("scenarios") || "mixed")
  .split(/[\s,]+/)
  .map((value) => value.trim())
  .filter(Boolean);
const operationCounts =
  args.get("ops") === "true" || args.get("operation-counts") === "true";
const seed = Math.floor(numberArg("seed", 20260906, 0, 0x7fffffff));
const renderTracing = args.get("render-trace") !== "false";
const keepTraceFiles = args.get("keep-traces") === "true";
const traceDir = path.join(process.cwd(), "benchmark-traces");

let mainWindow;
let currentDisplayInfo = null;
let lastProgressLine = false;

// benchmark.js is the Electron main-process entry point, so the normal
// application's main.js IPC handlers are not loaded. The live diagnostics
// module still sees getPerformanceMetrics() in preload.js, therefore provide
// the same handler here instead of spamming the benchmark with missing-IPC
// errors.
ipcMain.handle("get-performance-metrics", () => app.getAppMetrics());

let activeTrace = null;

const TRACE_CATEGORIES = [
  "blink.user_timing",
  "cc",
  "compositor",
  "gpu",
  "viz",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-cc.debug",
  "disabled-by-default-skia",
  "disabled-by-default-skia.gpu",
  "disabled-by-default-viz.gpu_composite_time",
  "disabled-by-default-display.framedisplayed",
];

async function startRenderTrace(meta = {}) {
  if (!renderTracing) return null;
  if (activeTrace) throw new Error("A rendering trace is already active.");
  fs.mkdirSync(traceDir, { recursive: true });
  await contentTracing.startRecording({
    included_categories: TRACE_CATEGORIES,
    traceOptions: "record-until-full",
  });
  activeTrace = { ...meta, startedAt: Date.now() };
  return true;
}

function normalizeTraceEvents(trace) {
  if (!trace) return [];
  if (Array.isArray(trace)) return trace;
  if (Array.isArray(trace.traceEvents)) return trace.traceEvents;
  return [];
}

function eventCategory(event) {
  return String(event?.cat || "").toLowerCase();
}

function eventName(event) {
  return String(event?.name || "").toLowerCase();
}

function isSlice(event) {
  return Number.isFinite(Number(event?.ts)) && Number(event?.dur) >= 0;
}

function traceRenderingMeasurement(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { error: `trace parse failed: ${error.message}` };
  }

  const events = normalizeTraceEvents(raw);
  const marks = events
    .filter(
      (e) =>
        String(e?.cat || "").includes("blink.user_timing") &&
        /benchmark-render-(start|end)/i.test(String(e?.name || ""))
    )
    .sort((a, b) => Number(a.ts) - Number(b.ts));

  const startMark = marks.find((e) =>
    /benchmark-render-start/i.test(String(e.name))
  );
  const endMark = [...marks]
    .reverse()
    .find((e) => /benchmark-render-end/i.test(String(e.name)));
  const lo = Number(startMark?.ts);
  const hi = Number(endMark?.ts);
  const bounded =
    Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo
      ? events.filter(
          (e) =>
            Number.isFinite(Number(e.ts)) &&
            Number(e.ts) >= lo &&
            Number(e.ts) <= hi
        )
      : events;

  const sums = {
    raster: { durationUs: 0, count: 0 },
    skia: { durationUs: 0, count: 0 },
    gpu: { durationUs: 0, count: 0 },
    compositor: { durationUs: 0, count: 0 },
    present: { durationUs: 0, count: 0 },
    rasterTask: { durationUs: 0, count: 0 },
    canvasFlush: { durationUs: 0, count: 0 },
  };
  const topEvents = new Map();

  const rasterName =
    /raster|rastertask|rasterizer|paintcanvas|canvas2d|record.*picture|draw.*picture|skia/i;
  const gpuName =
    /gpu|grcontext|commandbuffer|d3d|angle|glcontext|submit.*frame|swap/i;
  const compositorName =
    /compositor|composite|drawframe|drawquads|tile|layer.?tree|activate|surface/i;
  const presentName =
    /frame.?present|present.*frame|display.*frame|swapbuffers/i;

  for (const event of bounded) {
    if (!isSlice(event)) continue;
    const durUs = Number(event.dur);
    const cat = eventCategory(event);
    const name = eventName(event);
    if (durUs <= 0) continue;

    if (
      cat.includes("skia") ||
      rasterName.test(name) ||
      cat.includes("gpu") ||
      cat.includes("cc") ||
      cat.includes("compositor") ||
      cat.includes("viz")
    ) {
      const key = String(event.name || "<unnamed>");
      const existing = topEvents.get(key) || {
        name: key,
        durationUs: 0,
        count: 0,
        categories: new Set(),
      };
      existing.durationUs += durUs;
      existing.count++;
      for (const c of cat.split(",")) existing.categories.add(c);
      topEvents.set(key, existing);
    }

    if (/^rastertask$|rasterizer.*runonworkerthread|raster.*task/.test(name)) {
      sums.rasterTask.durationUs += durUs;
      sums.rasterTask.count++;
    }
    if (
      /canvas2dlayerbridge::flush|canvas2dlayerbridge::flushrecordingonly|canvas2dlayerbridge::finalizeframe/.test(
        name
      )
    ) {
      sums.canvasFlush.durationUs += durUs;
      sums.canvasFlush.count++;
    }

    if (cat.includes("display.framedisplayed") || presentName.test(name)) {
      sums.present.durationUs += durUs;
      sums.present.count++;
    }
    if (cat.includes("skia")) {
      sums.skia.durationUs += durUs;
      sums.skia.count++;
    }
    if (
      rasterName.test(name) &&
      (cat.includes("skia") ||
        cat.includes("cc") ||
        cat.includes("gpu") ||
        cat.includes("viz") ||
        cat.includes("compositor"))
    ) {
      sums.raster.durationUs += durUs;
      sums.raster.count++;
    }
    if (
      cat.includes("gpu") ||
      cat.includes("skia.gpu") ||
      (gpuName.test(name) &&
        (cat.includes("gpu") || cat.includes("viz") || cat.includes("cc")))
    ) {
      sums.gpu.durationUs += durUs;
      sums.gpu.count++;
    }
    if (
      (cat.includes("cc") ||
        cat.includes("compositor") ||
        cat.includes("viz")) &&
      compositorName.test(name)
    ) {
      sums.compositor.durationUs += durUs;
      sums.compositor.count++;
    }
  }

  const wallMs =
    Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo
      ? (hi - lo) / 1000
      : null;
  const toMetric = (value) => Number((value / 1000).toFixed(3));
  const hottestEvents = [...topEvents.values()]
    .sort((a, b) => b.durationUs - a.durationUs)
    .slice(0, 20)
    .map((event) => ({
      name: event.name,
      durationMs: toMetric(event.durationUs),
      count: event.count,
      categories: [...event.categories],
    }));
  return {
    available: true,
    traceEventCount: bounded.length,
    traceWindowMs: wallMs,
    marksFound: Boolean(startMark && endMark),
    raster: { ms: toMetric(sums.raster.durationUs), count: sums.raster.count },
    skia: { ms: toMetric(sums.skia.durationUs), count: sums.skia.count },
    gpu: { ms: toMetric(sums.gpu.durationUs), count: sums.gpu.count },
    compositor: {
      ms: toMetric(sums.compositor.durationUs),
      count: sums.compositor.count,
    },
    present: {
      ms: toMetric(sums.present.durationUs),
      count: sums.present.count,
    },
    rasterTask: {
      ms: toMetric(sums.rasterTask.durationUs),
      count: sums.rasterTask.count,
    },
    canvasFlush: {
      ms: toMetric(sums.canvasFlush.durationUs),
      count: sums.canvasFlush.count,
    },
    hottestEvents,
  };
}

async function stopRenderTrace(meta = {}) {
  if (!activeTrace) return null;
  const traceMeta = activeTrace;
  activeTrace = null;
  let tempPath = null;
  try {
    tempPath = await contentTracing.stopRecording();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safe =
      `${traceMeta.mode || "mode"}-${traceMeta.scenario || "scenario"}-r${traceMeta.repeat || 0}-${stamp}`.replace(
        /[^a-zA-Z0-9._-]+/g,
        "_"
      );
    const destination = path.join(traceDir, `${safe}.json`);
    fs.copyFileSync(tempPath, destination);
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    const measurement = traceRenderingMeasurement(destination);
    const output = { ...meta, ...measurement };
    if (keepTraceFiles) output.traceFile = destination;
    else {
      try {
        fs.unlinkSync(destination);
      } catch {}
    }
    return output;
  } catch (error) {
    try {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    return {
      ...meta,
      available: false,
      error: error?.message || String(error),
    };
  }
}

ipcMain.handle("benchmark-start-render-trace", async (_event, meta) =>
  startRenderTrace(meta)
);
ipcMain.handle("benchmark-stop-render-trace", async (_event, meta) =>
  stopRenderTrace(meta)
);

function getWindowDisplayInfo() {
  if (!mainWindow) return null;
  try {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds);
    return {
      id: display.id,
      label: display.label || `Display ${display.id}`,
      displayFrequency: Number(display.displayFrequency) || null,
      scaleFactor: display.scaleFactor,
      bounds: display.bounds,
      workArea: display.workArea,
    };
  } catch {
    return null;
  }
}

function sendDisplayInfo() {
  const next = getWindowDisplayInfo();
  if (!next || !mainWindow?.webContents) return;
  const changed =
    !currentDisplayInfo ||
    currentDisplayInfo.id !== next.id ||
    Number(currentDisplayInfo.displayFrequency) !==
      Number(next.displayFrequency) ||
    currentDisplayInfo.scaleFactor !== next.scaleFactor;
  currentDisplayInfo = next;
  if (!changed) return;
  const payload = JSON.stringify(currentDisplayInfo);
  mainWindow.webContents
    .executeJavaScript(`window.__setBenchmarkDisplayInfo?.(${payload})`, true)
    .catch(() => {});
}

function writeProgress(message, { final = false } = {}) {
  if (process.stdout.isTTY && !final) {
    process.stdout.write(`\r\x1b[2K${message}`);
    lastProgressLine = true;
    return;
  }
  if (process.stdout.isTTY && lastProgressLine) process.stdout.write("\n");
  lastProgressLine = false;
  process.stdout.write(`${message}\n`);
}

function createWindow() {
  const displays = screen.getAllDisplays();
  const target = displays.length > 1 ? displays[1] : displays[0];
  const { x, y, width, height } = target.workArea;

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: true,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.setFullScreenable(false);

  // Forward benchmark progress messages from the renderer to the terminal.
  // Only messages prefixed with [benchmark] are shown, so normal app console
  // noise does not make the benchmark output unreadable.
  mainWindow.webContents.on("console-message", (_event, _level, message) => {
    if (typeof message !== "string" || !message.startsWith("[benchmark]"))
      return;
    if (message.startsWith("[benchmark] PROGRESS")) {
      writeProgress(message.replace("[benchmark] ", ""));
    } else if (
      message.startsWith("[benchmark] PAUSE") ||
      message.startsWith("[benchmark] RESUME")
    ) {
      writeProgress(message.replace("[benchmark] ", ""));
    } else if (message.startsWith("[benchmark] DONE")) {
      writeProgress(message.replace("[benchmark] ", ""), { final: true });
    } else {
      // Keep non-progress benchmark diagnostics readable without flooding the terminal.
      if (lastProgressLine) process.stdout.write("\n");
      lastProgressLine = false;
      console.log(message);
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("move", sendDisplayInfo);
  mainWindow.on("resize", sendDisplayInfo);

  const displayPoll = setInterval(() => {
    if (!mainWindow?.isDestroyed()) sendDisplayInfo();
  }, 500);
  mainWindow.on("closed", () => clearInterval(displayPoll));

  mainWindow.webContents.once("did-finish-load", async () => {
    sendDisplayInfo();
    const runner = fs.readFileSync(
      path.join(__dirname, "benchmark-renderer.js"),
      "utf8"
    );
    const parameters = {
      durationMs,
      warmupMs,
      glowIntensity,
      trailDuration,
      trailMaxFps,
      trailsEnabled: args.get("trails") === "true",
      particleDensity,
      particleStyle,
      waveformStyle,
      repeats,
      scenarios,
      operationCounts,
      seed,
      renderTracing,
      keepTraceFiles,
      displayInfo: currentDisplayInfo,
    };

    try {
      if (lastProgressLine) process.stdout.write("\n");
      console.log(
        `Parsed benchmark args: repeats=${repeats}, scenarios=${scenarios.join(",")}, ops=${operationCounts ? "true" : "false"}, waveform=${waveformStyle}, seed=${seed}`
      );

      await mainWindow.webContents.executeJavaScript(
        `window.__audioVisualizerBenchmark = ${JSON.stringify(parameters)};\n${runner}\n`,
        true
      );

      const result = await mainWindow.webContents.executeJavaScript(
        "window.__runAudioVisualizerBenchmark()",
        true
      );

      result.cli = {
        durationMs,
        warmupMs,
        glowIntensity,
        trailDuration,
        trailMaxFps,
        trailsEnabled: args.get("trails") === "true",
        particleDensity,
        particleStyle,
        waveformStyle,
        keepWindow,
        repeats,
        scenarios,
        operationCounts,
        seed,
        renderTracing,
        keepTraceFiles,
        displayInfo: currentDisplayInfo,
      };

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputPath = path.join(process.cwd(), `benchmark-${stamp}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

      printSummary(result);
      console.log(`\nFull result: ${outputPath}`);

      if (!keepWindow) {
        mainWindow.close();
        app.quit();
      }
    } catch (error) {
      console.error("Benchmark failed:", error?.stack || error);
      app.exit(1);
    }
  });
}

function printSummary(result) {
  console.log("\nAudio Visualizer renderer benchmark");
  console.log(
    `Canvas: ${result.canvas.canvasWidth}×${result.canvas.canvasHeight} @ DPR ${result.canvas.devicePixelRatio}`
  );
  if (result.cli?.displayInfo) {
    const d = result.cli.displayInfo;
    console.log(
      `Display: ${d.label || `Display ${d.id}`} @ ${d.displayFrequency || "?"} Hz`
    );
  }
  console.log(`Synthetic audio: deterministic 48 kHz / 2048 FFT`);
  console.log(
    `Measurement: ${durationMs / 1000}s per mode + ${warmupMs / 1000}s warmup · Chromium rendering trace: ${renderTracing ? "on" : "off"}`
  );
  console.log(
    `Scenarios: ${scenarios.join(", ")} · repeats: ${repeats} · randomized order: yes · operation counts: ${operationCounts ? "yes" : "no"}`
  );
  console.log(
    `Baseline: glow ${result.baseline.glowIntensity}, trails ${result.baseline.trailsEnabled ? "on" : "off"}, waveform ${result.baseline.waveformStyle || waveformStyle}, background ${result.baseline.background}`
  );
  console.log("");

  const rows = result.results.map(({ mode, scenario, repeat, profile }) => {
    const bucket = profile?.buckets?.[0];
    if (!bucket)
      return {
        mode,
        avg: NaN,
        p95: NaN,
        fps: NaN,
        js: NaN,
        gap: NaN,
        gpu: NaN,
      };

    const gpu = profile?.process?.GPU?.cpuPercentAvg;
    return {
      mode: `${mode} [${scenario}/${repeat}]`,
      avg: bucket.frame.avg,
      p95: bucket.frame.p95,
      fps: bucket.frame.avg > 0 ? 1000 / bucket.frame.avg : 0,
      js: bucket.mode.avg,
      gap: bucket.frameGap?.avg ?? 0,
      gpu: Number.isFinite(gpu) ? gpu : NaN,
    };
  });

  const header = [
    "Mode",
    "Frame avg",
    "Frame P95",
    "RasterTask",
    "CanvasFlush",
    "Skia",
    "GPU trace",
    "Compositor",
  ]
    .map((s) => s.padEnd(15))
    .join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    const tracing = result.results.find(
      (r) => `${r.mode} [${r.scenario}/${r.repeat}]` === row.mode
    )?.rendering;
    console.log(
      [
        row.mode.padEnd(15),
        format(row.avg),
        format(row.p95),
        tracing?.rasterTask?.ms != null
          ? `${tracing.rasterTask.ms.toFixed(2)} ms`.padEnd(15)
          : "n/a".padEnd(15),
        tracing?.canvasFlush?.ms != null
          ? `${tracing.canvasFlush.ms.toFixed(2)} ms`.padEnd(15)
          : "n/a".padEnd(15),
        tracing?.skia?.ms != null
          ? `${tracing.skia.ms.toFixed(2)} ms`.padEnd(15)
          : "n/a".padEnd(15),
        tracing?.gpu?.ms != null
          ? `${tracing.gpu.ms.toFixed(2)} ms`.padEnd(15)
          : "n/a".padEnd(15),
        tracing?.compositor?.ms != null
          ? `${tracing.compositor.ms.toFixed(2)} ms`.padEnd(15)
          : "n/a".padEnd(15),
      ].join("")
    );
  }

  const slowest = rows
    .filter((r) => Number.isFinite(r.avg))
    .sort((a, b) => b.avg - a.avg)[0];
  if (slowest)
    console.log(
      `\nSlowest run: ${slowest.mode} (${slowest.avg.toFixed(2)} ms/frame)`
    );
  if (result.execution)
    console.log(
      `Completed: ${result.execution.completedCount}/${result.execution.runCount} timing runs`
    );
  if (Array.isArray(result.operationCounts) && result.operationCounts.length)
    console.log(`Operation-count runs: ${result.operationCounts.length}`);
}

function format(ms) {
  return `${ms.toFixed(2)} ms`.padEnd(15);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {});
