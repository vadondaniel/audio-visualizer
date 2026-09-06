const { app, BrowserWindow, screen, ipcMain } = require("electron");
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

let mainWindow;
let currentDisplayInfo = null;
let lastProgressLine = false;

// benchmark.js is the Electron main-process entry point, so the normal
// application's main.js IPC handlers are not loaded. The live diagnostics
// module still sees getPerformanceMetrics() in preload.js, therefore provide
// the same handler here instead of spamming the benchmark with missing-IPC
// errors.
ipcMain.handle("get-performance-metrics", () => app.getAppMetrics());

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
    `Measurement: ${durationMs / 1000}s per mode + ${warmupMs / 1000}s warmup`
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
    "Ideal FPS",
    "Mode JS",
    "Frame gap",
    "GPU proc CPU",
  ]
    .map((s) => s.padEnd(15))
    .join("");
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    console.log(
      [
        row.mode.padEnd(15),
        format(row.avg),
        format(row.p95),
        `${row.fps.toFixed(1)} FPS`.padEnd(15),
        format(row.js),
        format(row.gap),
        Number.isFinite(row.gpu)
          ? `${row.gpu.toFixed(1)}%`.padEnd(15)
          : "n/a".padEnd(15),
      ].join("")
    );
  }

  const slowest = rows
    .filter((r) => Number.isFinite(r.avg))
    .sort((a, b) => b.avg - a.avg)[0];
  if (slowest)
    console.log(
      `\nSlowest run: ${slowest.mode} (${slowest.avg.toFixed(2)} ms/frame, ${slowest.fps.toFixed(1)} ideal FPS)`
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
