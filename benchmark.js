const { app, BrowserWindow, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const args = new Map();
for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith("--")) continue;
  const [key, value = "true"] = arg.slice(2).split("=");
  args.set(key, value);
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
const keepWindow = args.get("keep-window") === "true";

let mainWindow;

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
  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.once("did-finish-load", async () => {
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
    };

    try {
      await mainWindow.webContents.executeJavaScript(
        `window.__audioVisualizerBenchmark = ${JSON.stringify(parameters)};\n${runner}\n`,
        true
      );

      const result = await mainWindow.webContents.executeJavaScript(
        "window.__runAudioVisualizerBenchmark()",
        true
      );

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
  console.log(`Synthetic audio: deterministic 48 kHz / 2048 FFT`);
  console.log(
    `Measurement: ${durationMs / 1000}s per mode + ${warmupMs / 1000}s warmup`
  );
  console.log(
    `Baseline: glow ${result.baseline.glowIntensity}, trails ${result.baseline.trailsEnabled ? "on" : "off"}, background ${result.baseline.background}`
  );
  console.log("");

  const rows = result.results.map(({ mode, profile }) => {
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
      mode,
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
      `\nSlowest mode: ${slowest.mode} (${slowest.avg.toFixed(2)} ms/frame, ${slowest.fps.toFixed(1)} ideal FPS)`
    );
}

function format(ms) {
  return `${ms.toFixed(2)} ms`.padEnd(15);
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {});
