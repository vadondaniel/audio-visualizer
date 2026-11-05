const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm");
const AudioMath = require("../src/audio-math");
const {
  prismInnerRadius,
  prismOuterRadius,
  prismBandEdge,
} = require("../src/visuals/prism");

test("active range trims quiet treble, follows recording level, and retains real high frequencies", () => {
  const { prismActiveEnd } = setup(null).context;
  const data = new Float32Array(1024).fill(-110);
  data.fill(-30, 2, 80);
  const narrow = prismActiveEnd(data);
  expect(narrow).toBeGreaterThanOrEqual(98);
  expect(narrow).toBeLessThan(120);
  expect(prismActiveEnd(Float32Array.from(data, (v) => v - 15))).toBe(narrow);
  data.fill(-40, 450, 460);
  expect(prismActiveEnd(data)).toBeGreaterThan(460);
  data.fill(-Infinity);
  expect(prismActiveEnd(data)).toBe(0);
  data.fill(-90);
  expect(prismActiveEnd(data)).toBe(0);
  for (const end of [98, 150, 250, 512])
    for (let i = 0; i < 96; i++)
      expect(prismBandEdge(i + 1, 1024, end)).toBeGreaterThan(
        prismBandEdge(i, 1024, end)
      );
});

test("range expands quickly, holds transient treble, contracts slowly, and stays fixed during silence", () => {
  const app = setup(null);
  let high = false,
    silent = false;
  app.context.analyser.getFloatFrequencyData = (data) => {
    data.fill(-Infinity);
    if (!silent) {
      data.fill(-30, 2, 80);
      if (high) data.fill(-35, 450, 460);
    }
  };
  app.draw();
  const narrow = app.read("prismRangeEnd");
  high = true;
  for (let i = 0; i < 60; i++) app.draw();
  const wide = app.read("prismRangeEnd");
  expect(wide).toBeGreaterThan(490);
  high = false;
  for (let i = 0; i < 30; i++) app.draw();
  expect(app.read("prismRangeEnd")).toBe(wide);
  for (let i = 0; i < 360; i++) app.draw();
  const contracted = app.read("prismRangeEnd");
  expect(contracted).toBeLessThan(160);
  expect(contracted).toBeGreaterThanOrEqual(narrow);
  silent = true;
  for (let i = 0; i < 60; i++) app.draw();
  expect(app.read("prismRangeEnd")).toBe(contracted);
});

test("frequency bands partition distinct FFT bins instead of duplicating bass bins", () => {
  for (const bins of [512, 1024, 2048]) {
    const edges = Array.from({ length: 97 }, (_, i) => prismBandEdge(i, bins));
    expect(edges[0]).toBe(Math.floor(bins * 0.002));
    expect(edges[96]).toBe(Math.floor(bins * 0.5));
    for (let i = 0; i < 96; i++) expect(edges[i + 1]).toBeGreaterThan(edges[i]);
  }
});

test("neighboring bass bins drive separate rendered bands", () => {
  const app = setup(null);
  for (const bin of [2, 3, 4, 5, 6]) {
    app.context.analyser.getFloatFrequencyData = (data) => {
      data.fill(-Infinity);
      data[bin] = -30;
    };
    app.draw();
    const active = app.read(
      "Array.from(prismSpectrum, (v,i)=>v>0?i:-1).filter(i=>i>=0)"
    );
    expect(active).toHaveLength(1);
    expect(prismBandEdge(active[0], 1024)).toBeLessThanOrEqual(bin);
    expect(prismBandEdge(active[0] + 1, 1024)).toBeGreaterThan(bin);
  }
});

function setup(bass = 0.5) {
  const ctx = Object.fromEntries(
    [
      "save",
      "restore",
      "translate",
      "beginPath",
      "moveTo",
      "lineTo",
      "closePath",
      "stroke",
      "fill",
      "arc",
    ].map((name) => [name, jest.fn()])
  );
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  const profile = Float32Array.from(
    { length: 1024 },
    (_, i) =>
      -70 +
      45 * Math.exp(-Math.pow((Math.log2(i + 1) - 4) / 0.7, 2)) +
      25 * Math.exp(-Math.pow((Math.log2(i + 1) - 7) / 0.5, 2))
  );
  const context = {
    AudioMath,
    ctx,
    canvas: { width: 1000, height: 800 },
    beatPulse: 0,
    freqData: new Uint8Array(1024).fill(255),
    analyser: { getFloatFrequencyData: (data) => data.set(profile) },
    state: {
      smoothingEnabled: false,
      valueHandling: "logarithmic",
      sensitivity: 2.4,
      theme: 0,
      hueShift: 0,
      colorGradientEnabled: true,
      bassSensitivityEnabled: bass !== null,
      bassSensitivityAmount: 0.5,
    },
  };
  vm.createContext(context);
  for (const file of ["constants.js", "visuals.js", "visuals/prism.js"])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "../src", file), "utf8"),
      context
    );
  context.updateBassSensitivity(bass, 10);
  return {
    context,
    ctx,
    read: (code) => vm.runInContext(code, context),
    draw: () => context.drawPrism(0, 0, 0, 1 / 60),
  };
}

test("triangular tips extend in opposite radial directions and stay within bounds", () => {
  expect(prismInnerRadius(100, 0)).toBe(100);
  expect(prismOuterRadius(100, 0)).toBe(100);
  expect(prismInnerRadius(100, 1)).toBeCloseTo(12);
  expect(prismOuterRadius(100, 1)).toBeCloseTo(210);
  const app = setup();
  app.draw();
  const outer = app.read("Array.from(prismOuter)"),
    inner = app.read("Array.from(prismInner)");
  for (let i = 0; i < outer.length; i += 2) {
    expect(Math.hypot(outer[i], outer[i + 1])).toBeGreaterThanOrEqual(
      172 - 1e-8
    );
    expect(Math.hypot(outer[i], outer[i + 1])).toBeLessThanOrEqual(
      172 * 2.1 + 1e-8
    );
    expect(Math.hypot(inner[i], inner[i + 1])).toBeLessThanOrEqual(172 + 1e-8);
    expect(Math.hypot(inner[i], inner[i + 1])).toBeGreaterThanOrEqual(
      172 * 0.12 - 1e-8
    );
  }
});

test("bands connect neighboring inner and outer peaks, including the closing seam", () => {
  const app = setup();
  app.draw();
  const count = app.read("PRISM_BANDS");
  const outer = app.read("Array.from(prismOuter)");
  const inner = app.read("Array.from(prismInner)");
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    expect(app.ctx.moveTo.mock.calls[i * 3]).toEqual(
      outer.slice(i * 2, i * 2 + 2)
    );
    expect(app.ctx.lineTo.mock.calls[i * 3]).toEqual(
      outer.slice(next * 2, next * 2 + 2)
    );
    expect(app.ctx.moveTo.mock.calls[i * 3 + 1]).toEqual(
      inner.slice(i * 2, i * 2 + 2)
    );
    expect(app.ctx.lineTo.mock.calls[i * 3 + 1]).toEqual(
      inner.slice(next * 2, next * 2 + 2)
    );
    expect(app.ctx.lineTo.mock.calls[i * 3 + 2]).toEqual(
      outer.slice(i * 2, i * 2 + 2)
    );
  }
  expect(app.ctx.save).toHaveBeenCalledTimes(1);
  expect(app.ctx.restore).toHaveBeenCalledTimes(1);
});

test("sensitivity and bass modulation preserve the spectrum's detail even when byte FFT data is clipped", () => {
  const stats = [0, null, 1].map((bass) => {
    const app = setup(bass);
    app.draw();
    return app.read(
      "({mean:prismSpectrum.reduce((a,b)=>a+b,0)/PRISM_BANDS,clipped:prismSpectrum.filter(v=>v>=0.999).length,range:Math.max(...prismSpectrum)-Math.min(...prismSpectrum)})"
    );
  });
  expect(stats[0].mean).toBeCloseTo(stats[1].mean * 0.5);
  expect(stats[2].mean).toBeGreaterThan(stats[1].mean);
  expect(stats[2].clipped).toBeLessThan(8);
  expect(stats[2].range).toBeGreaterThan(0.25);
});

test("silence leaves a finite circular baseline without triangular spikes", () => {
  const app = setup();
  app.context.analyser.getFloatFrequencyData = (data) => data.fill(-Infinity);
  app.draw();
  expect(app.read("prismSpectrum.every(v=>v===0)")).toBe(true);
  expect(app.read("[...prismInner,...prismOuter].every(Number.isFinite)")).toBe(
    true
  );
  expect(app.read("Array.from(prismInner)")).toEqual(
    app.read("Array.from(prismOuter)")
  );
});
