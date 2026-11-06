const fs = require("node:fs");
const vm = require("node:vm");
const { setup, canonical } = require("./helpers/mode-fixture.cjs");

// Expose private storage only in this VM, without adding a production debug API.
const source = fs.readFileSync(
  require.resolve("../src/visuals/particles"),
  "utf8"
);
function fixture() {
  const app = setup("particles");
  let storage;
  const context = {
    module: { exports: {} },
    structuredClone,
    capture: (value) => {
      storage = value;
    },
  };
  const marker = "    const initialRandomState = random.getState();";
  if (!source.includes(marker))
    throw Error("Missing Particles VM capture boundary");
  vm.runInNewContext(
    source.replace(
      marker,
      "    capture({particleRender, particleBatches, batchGroups, clearParticleBatches, bucketParticle, particles, random});\n" +
        marker
    ),
    context
  );
  const mode = context.module.exports.createMode(app.services);
  return { ...app, mode, storage };
}

function indices(group, bucket, count) {
  const result = [];
  for (let i = group.head[bucket]; i !== -1; i = group.next[i]) {
    if (i < 0 || i >= count || result.length >= count)
      throw Error("Invalid or cyclic batch link");
    result.push(i);
  }
  expect(group.tail[bucket]).toBe(result.at(-1) ?? -1);
  return result;
}

function scanReference(rr, rainbow) {
  const result = {
    trails: [],
    bodies: [],
    glow: [],
    highlights: [],
    glowMaxR: [],
    scans: 0,
  };
  for (const [kind, bucketCount] of [
    ["trails", 12],
    ["bodies", 48],
    ["glow", 12],
    ["highlights", 12],
  ]) {
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const members = [];
      let maxR = 0;
      if (kind !== "highlights" || rainbow) {
        for (let i = 0; i < rr.count; i++) {
          result.scans++;
          const hb = kind === "bodies" ? bucket % 12 : bucket;
          if (rr.bin[i] !== hb) continue;
          if (kind === "bodies" && rr.alphaBin[i] !== Math.floor(bucket / 12))
            continue;
          if (
            kind === "trails" &&
            (rr.r[i] <= 2.2 ||
              Math.min(0.28, rr.alpha[i] * (rainbow ? 0.78 : 0.55)) <= 0.02)
          )
            continue;
          if (kind === "glow" && (rr.r[i] <= 3 || rr.alpha[i] <= 0.18))
            continue;
          if (kind === "highlights" && (rr.r[i] <= 5.4 || rr.alpha[i] <= 0.45))
            continue;
          members.push(i);
          if (rr.r[i] > maxR) maxR = rr.r[i];
        }
      }
      result[kind].push(members);
      if (kind === "glow") result.glowMaxR.push(maxR);
    }
  }
  return result;
}

function checkBatches(storage, rainbow) {
  const { particleRender: rr, particleBatches: batches } = storage;
  const reference = scanReference(rr, rainbow);
  for (const kind of ["trails", "bodies", "glow", "highlights"])
    for (let bucket = 0; bucket < reference[kind].length; bucket++)
      expect(indices(batches[kind], bucket, rr.count)).toEqual(
        reference[kind][bucket]
      );
  expect(Array.from(batches.glowMaxR)).toEqual(reference.glowMaxR);
  return reference.scans;
}

test.each([false, true])(
  "stable bucket membership matches the scan reference, Rainbow=%s",
  (rainbow) => {
    const { storage } = fixture();
    const rr = storage.particleRender;
    const radii = [
      0.5,
      2.2 - 1e-8,
      2.2,
      2.2 + 1e-8,
      2.2 + 1e-5,
      3 - 1e-8,
      3,
      3 + 1e-6,
      5.4 - 1e-8,
      5.4,
      5.4 + 1e-6,
      12,
    ];
    const alphas = [
      0,
      0.02 / 0.78,
      0.02 / 0.55,
      0.18 - 1e-9,
      0.18,
      0.18 + 1e-7,
      0.45 - 1e-9,
      0.45,
      0.45 + 1e-7,
      0.51,
      0.76,
      1,
    ];
    for (const count of [0, 1, 48, rr.r.length, 1, 0]) {
      storage.clearParticleBatches();
      rr.count = count;
      for (let i = 0; i < count; i++) {
        rr.bin[i] = i % 12;
        rr.alphaBin[i] = Math.floor(i / 12) % 4;
        rr.r[i] = radii[Math.floor(i / 48) % radii.length];
        rr.alpha[i] = alphas[Math.floor(i / 12) % alphas.length];
        storage.bucketParticle(i, rainbow ? 0.78 : 0.55, rainbow);
      }
      expect(checkBatches(storage, rainbow)).toBe(count * (rainbow ? 84 : 72));
    }
  }
);

test("classification uses Float32 rounding at the original draw thresholds", () => {
  const { storage } = fixture(),
    rr = storage.particleRender;
  const samples = [
    [3 + 1e-8, 0.5],
    [5.4 - 1e-8, 0.5],
    [4, 0.18],
    [6, 0.45 + 1e-9],
  ];
  rr.count = samples.length;
  samples.forEach(([r, alpha], i) => {
    rr.bin[i] = 0;
    rr.alphaBin[i] = 0;
    rr.r[i] = r;
    rr.alpha[i] = alpha;
    storage.bucketParticle(i, 0.78, true);
  });
  checkBatches(storage, true);
  expect(indices(storage.particleBatches.glow, 0, rr.count)).not.toContain(0);
  expect(indices(storage.particleBatches.highlights, 0, rr.count)).toContain(1);
  expect(indices(storage.particleBatches.glow, 0, rr.count)).toContain(2);
  expect(
    indices(storage.particleBatches.highlights, 0, rr.count)
  ).not.toContain(3);
});

function buffers(storage) {
  return [
    storage.particleBatches.glowMaxR,
    ...storage.batchGroups.flatMap((group) => [
      group.head,
      group.tail,
      group.next,
    ]),
  ];
}
function snapshot(storage) {
  return JSON.stringify({
    buffers: buffers(storage).map((buffer) => Array.from(buffer)),
    particles: storage.particles,
    random: storage.random.getState(),
  });
}
function tick(app, i) {
  app.frame.timestampMs += 1000 / 60;
  app.frame.audioClockMs += 1000 / 60;
  app.frame.beat.justHit = i % 9 === 0;
  app.process();
  app.mode.update(app.frame);
}

test("updates rebuild buckets without drawing; theme switches and expiration leave no stale links", () => {
  const a = fixture();
  const allocations = buffers(a.storage);
  a.settings.particleDensity = 1.8;
  for (let i = 0; i < 120; i++) {
    if (i === 30) a.setTheme("Rainbow");
    if (i === 60) a.setTheme("Rainbow Cycle");
    if (i === 90) {
      a.setTheme("Neon");
      a.frame.width = 360;
      a.frame.height = 720;
    }
    tick(a, i);
    checkBatches(a.storage, i >= 30 && i < 90);
  }
  expect(a.storage.particleRender.count).toBeGreaterThan(0);
  a.storage.particles.forEach((particle) => {
    particle.life = 0;
  });
  tick(a, 121);
  checkBatches(a.storage, false);
  expect(a.storage.particleRender.count).toBeLessThan(10);
  buffers(a.storage).forEach((buffer, i) =>
    expect(buffer).toBe(allocations[i])
  );
});

test("drawing preserves prepared buckets, simulation, and random state; reset reuses storage and matches a fresh instance", () => {
  const a = fixture(),
    fresh = fixture();
  const allocations = buffers(a.storage);
  a.setTheme("Rainbow");
  fresh.setTheme("Rainbow");
  tick(a, 0);
  const untouched = snapshot(fresh.storage);
  const before = snapshot(a.storage);
  a.mode.draw(a.canvas.ctx, a.frame);
  const first = canonical(a.canvas.events);
  a.canvas.clear();
  a.mode.draw(a.canvas.ctx, a.frame);
  expect(canonical(a.canvas.events)).toEqual(first);
  expect(snapshot(a.storage)).toBe(before);
  expect(snapshot(fresh.storage)).toBe(untouched);
  for (let i = 1; i < 15; i++) tick(a, i);
  a.mode.reset();
  for (const group of a.storage.batchGroups) {
    expect(Array.from(group.head).every((value) => value === -1)).toBe(true);
    expect(Array.from(group.tail).every((value) => value === -1)).toBe(true);
    expect(Array.from(group.next).every((value) => value === -1)).toBe(true);
  }
  expect(
    Array.from(a.storage.particleBatches.glowMaxR).every((value) => value === 0)
  ).toBe(true);
  buffers(a.storage).forEach((buffer, i) =>
    expect(buffer).toBe(allocations[i])
  );
  a.pipeline.reset();
  Object.assign(a.frame, { timestampMs: 1000, audioClockMs: 1000 });
  tick(a, 0);
  tick(fresh, 0);
  expect(snapshot(a.storage)).toBe(snapshot(fresh.storage));
  a.canvas.clear();
  a.mode.draw(a.canvas.ctx, a.frame);
  fresh.mode.draw(fresh.canvas.ctx, fresh.frame);
  expect(canonical(a.canvas.events)).toEqual(canonical(fresh.canvas.events));
});

test.each(["Neon", "Rainbow"])(
  "%s classifies each accepted render index once, with no membership reads during draw",
  (theme) => {
    const a = fixture();
    a.setTheme(theme);
    let hueReads = 0,
      alphaReads = 0;
    const counted = (buffer, count) =>
      new Proxy(buffer, {
        get(target, key) {
          if (/^\d+$/.test(String(key))) count();
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    const rr = a.storage.particleRender;
    rr.bin = counted(rr.bin, () => hueReads++);
    rr.alphaBin = counted(rr.alphaBin, () => alphaReads++);
    for (let i = 0; i < 30; i++) {
      hueReads = alphaReads = 0;
      tick(a, i);
      expect(rr.count).toBeGreaterThan(0);
      expect(hueReads).toBe(rr.count);
      expect(alphaReads).toBe(rr.count);
      hueReads = alphaReads = 0;
      a.canvas.clear();
      a.mode.draw(a.canvas.ctx, a.frame);
      expect(hueReads).toBe(0);
      expect(alphaReads).toBe(0);
    }
  }
);
