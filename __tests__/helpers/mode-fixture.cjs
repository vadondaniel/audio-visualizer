const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const math = require("../../src/audio-math");
const runtime = require("../../src/mode-runtime");
const names = [
  "bars",
  "radial",
  "waveform",
  "particles",
  "kaleidoscope",
  "tunnel",
  "waves",
  "aurora",
  "cascade",
  "orbit",
  "prism",
];
const root = path.resolve(__dirname, "../..");
function makeCanvas() {
  const events = [],
    stack = [];
  let pathData = [],
    state;
  const defaults = () => ({
    fillStyle: "#000",
    strokeStyle: "#000",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    shadowBlur: 0,
    shadowColor: "transparent",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    filter: "none",
    transform: [],
  });
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (key in state) return state[key];
        if (key === "save")
          return () =>
            stack.push({ ...state, transform: [...state.transform] });
        if (key === "restore")
          return () => {
            state = stack.pop() || defaults();
          };
        if (key === "beginPath")
          return () => {
            pathData = [];
          };
        if (String(key).startsWith("create"))
          return (...args) => {
            const gradient = { type: key, args, stops: [] };
            gradient.addColorStop = (...stop) => gradient.stops.push(stop);
            return gradient;
          };
        return (...args) => {
          if (args.some((v) => typeof v === "number" && !Number.isFinite(v)))
            throw Error(`Nonfinite ${key}: ${args}`);
          if (
            [
              "translate",
              "rotate",
              "scale",
              "setTransform",
              "transform",
            ].includes(key)
          )
            state.transform.push([key, ...args]);
          else if (
            ["fill", "stroke", "fillRect", "strokeRect", "drawImage"].includes(
              key
            )
          ) {
            const { fillStyle, strokeStyle, ...style } = state;
            events.push([
              key,
              args,
              key === "fill" || key === "stroke" ? [...pathData] : null,
              { ...style, color: key === "stroke" ? strokeStyle : fillStyle },
            ]);
          } else if (key !== "clearRect") pathData.push([key, ...args]);
        };
      },
      set(_, key, value) {
        state[key] = value;
        return true;
      },
    }
  );
  state = defaults();
  return {
    ctx,
    events,
    clear() {
      events.length = 0;
      pathData = [];
      state = defaults();
      stack.length = 0;
    },
    get depth() {
      return stack.length;
    },
  };
}
function setup(name, { seed = 12345 } = {}) {
  const canvas = makeCanvas();
  const rng = runtime.createRandom(seed);
  const context = {
    AudioMath: math,
    ctx: canvas.ctx,
    Math: Object.assign(Object.create(Math), { random: rng }),
    structuredClone,
    Image: class {
      complete = false;
      width = 0;
    },
    performance: { now: () => frame.timestampMs },
    audioClockMs: 0,
    beatPulse: 0,
    beatJustHit: false,
    mediaState: {},
    MEDIA_DISPLAYS: { "cover-title-artist": { cover: true } },
  };
  vm.createContext(context);
  for (const file of ["constants.js", "state.js", "visuals.js"]) {
    let source = fs.readFileSync(path.join(root, "src", file), "utf8");
    if (file === "state.js")
      source = source.split("// ---------- settings persistence")[0];
    vm.runInContext(source, context);
  }
  const constants = vm.runInContext(
    "({VISUAL_TUNING,THEMES,PARTICLE_BANDS,KALEIDO_BARS,KALEIDO_BAND_EDGES,FRAME_MS,ENERGY_HISTORY_MS})",
    context
  );
  const settings = vm.runInContext("state", context);
  const spectrum = new Float32Array(1024);
  const frame = {
    width: 1000,
    height: 800,
    settings,
    timestampMs: 1000,
    elapsedMs: 1000 / 60,
    dtSec: 1 / 60,
    audioClockMs: 1000,
    mediaArt: null,
    levels: { rawBass: 120, bass: 0.5, mid: 0.4, treble: 0.3 },
    beat: { pulse: 0.7, justHit: true },
    audio: {
      sampleRate: 48000,
      frequencyBytes: new Uint8Array(1024),
      timeBytes: new Uint8Array(1024),
      readFloatSpectrum: () => spectrum,
    },
  };
  for (let i = 0; i < 1024; i++) {
    frame.audio.frequencyBytes[i] = Math.round(80 + 65 * Math.sin(i / 27));
    frame.audio.timeBytes[i] = Math.round(128 + 50 * Math.sin(i / 13));
    spectrum[i] =
      -75 +
      45 * Math.exp(-Math.pow((Math.log2(i + 1) - 4) / 0.7, 2)) +
      22 * Math.exp(-Math.pow((Math.log2(i + 1) - 7) / 0.5, 2));
  }
  let gain = 1;
  const services = {
    math,
    constants,
    restore: runtime.restore,
    createRandom: () => rng,
    loadImage: () => ({ complete: false, width: 0 }),
    palette: {
      currentHue: context.currentHue,
      themeCssColor: context.themeCssColor,
    },
    modulate: (v) => math.applyBassGain(v, gain),
  };
  const mode = require(path.join(root, "src/visuals", name + ".js")).createMode(
    services
  );
  return {
    mode,
    frame,
    services,
    canvas,
    spectrum,
    settings,
    constants,
    setGain(v) {
      gain = v;
    },
    setTheme(name) {
      settings.theme = constants.THEMES.findIndex((t) => t.name === name);
    },
    render() {
      canvas.clear();
      mode.update(frame);
      mode.draw(canvas.ctx, frame);
      return canvas.events;
    },
  };
}
function canonical(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) =>
      typeof v === "number" ? Math.round(v * 1e7) / 1e7 : v
    )
  );
}
function spyCanvas(fixture, mock) {
  const functions = {};
  const ctx = new Proxy(fixture.canvas.ctx, {
    get(target, key) {
      if (key === "clearMocks")
        return () => Object.values(functions).forEach((fn) => fn.mockClear());
      const value = target[key];
      return typeof value === "function"
        ? (functions[key] ||= mock(value))
        : value;
    },
  });
  return ctx;
}
module.exports = { names, setup, makeCanvas, canonical, runtime, spyCanvas };
