const fs = require("node:fs");
const vm = require("node:vm");
const { makeCanvas, runtime } = require("./helpers/mode-fixture.cjs");

const source = fs.readFileSync(require.resolve("../src/background.js"), "utf8");
function fixture(type) {
  const canvas = makeCanvas();
  let randomCalls = 0;
  const random = runtime.createRandom(8932);
  const context = vm.createContext({
    state: { bgType: type },
    bgCanvas: { width: 800, height: 600 },
    bgCtx: canvas.ctx,
    currentHue: (offset) => 200 + offset * 80,
    Math: Object.assign(Object.create(Math), {
      random() {
        randomCalls++;
        return random();
      },
    }),
  });
  vm.runInContext(
    source.slice(
      source.indexOf("// ---------- procedural background systems"),
      source.indexOf("// ---------- settings panel sync helpers")
    ),
    context
  );
  return {
    context,
    canvas,
    randomCalls: () => randomCalls,
    snapshot: () =>
      vm.runInContext(
        "JSON.stringify({nebulaSwirlTime,nebulaProtostars,gridOffset,warpStars,warpProjections})",
        context
      ),
  };
}

test.each(["nebula", "stars", "grid"])(
  "%s hidden updates preserve state, random consumption, and the first visible drawing",
  (type) => {
    const visible = fixture(type),
      hidden = fixture(type);
    const initialRandom = hidden.randomCalls();
    for (let i = 0; i < 360; i++) {
      // Include switching and resize, with enough star travel to exercise respawns.
      for (const f of [visible, hidden]) {
        f.context.state.bgType = i >= 120 && i < 140 ? "color" : type;
        if (i === 180)
          Object.assign(f.context.bgCanvas, { width: 310, height: 760 });
      }
      const dt = i % 5 === 0 ? 0.1 : 1 / 60;
      visible.context.renderProceduralBackground(
        dt,
        0.7,
        0.5,
        0.6,
        0.4,
        0.3,
        0.2
      );
      hidden.context.updateProceduralBackground(dt, 0.3, 0.2);
      expect(hidden.canvas.events).toHaveLength(0);
    }
    expect(hidden.snapshot()).toBe(visible.snapshot());
    expect(hidden.randomCalls()).toBe(visible.randomCalls());
    if (type === "stars")
      expect(hidden.randomCalls()).toBeGreaterThan(initialRandom);
    visible.canvas.clear();
    visible.context.drawProceduralBackground(0.7, 0.5, 0.6, 0.4);
    const beforeDraw = hidden.snapshot();
    hidden.context.drawProceduralBackground(0.7, 0.5, 0.6, 0.4);
    expect(hidden.canvas.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(hidden.canvas.events)).toBe(
      JSON.stringify(visible.canvas.events)
    );
    expect(hidden.snapshot()).toBe(beforeDraw);
    const calls = hidden.randomCalls();
    hidden.context.drawProceduralBackground(0.7, 0.5, 0.6, 0.4);
    expect(hidden.randomCalls()).toBe(calls);
    expect(hidden.snapshot()).toBe(beforeDraw);
  }
);

test("off-screen star resets preserve previous depth and do not draw a reset star", () => {
  const f = fixture("stars");
  vm.runInContext("warpStars.forEach(s=>{s.x=2;s.y=2;s.z=.5;});", f.context);
  f.context.updateProceduralBackground(1 / 60, 0, 0);
  expect(
    vm.runInContext("warpStars.every(s=>s.z===1&&s.pz===.5)", f.context)
  ).toBe(true);
  f.context.drawProceduralBackground(0, 0, 0, 0);
  expect(
    f.canvas.events.filter(([operation]) => operation === "stroke")
  ).toHaveLength(0);
});
