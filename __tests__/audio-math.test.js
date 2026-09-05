const {
  bandAverage,
  normalizeEnergy,
  smoothTowards,
  computeHue,
  detectBeat,
  mergeSettings,
} = require("../audio-math");

describe("bandAverage", () => {
  test("averages the slice between two fractional positions", () => {
    const data = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]; // length 10
    // loFrac 0.2 -> index 2, hiFrac 0.6 -> index 6: [20,30,40,50] -> avg 35
    expect(bandAverage(data, 0.2, 0.6)).toBe(35);
  });

  test("covers the full array with 0..1", () => {
    const data = [0, 10, 20, 30];
    expect(bandAverage(data, 0, 1)).toBe(15);
  });

  test("never divides by zero for an empty slice", () => {
    const data = [1, 2, 3, 4];
    // loFrac === hiFrac collapses the slice to nothing
    expect(bandAverage(data, 0.5, 0.5)).toBe(0);
  });
});

describe("normalizeEnergy", () => {
  test("maps a value below the floor to 0", () => {
    expect(normalizeEnergy(5, 20, 210)).toBe(0);
  });

  test("maps a value at or above floor+range to 1", () => {
    expect(normalizeEnergy(230, 20, 210)).toBe(1);
    expect(normalizeEnergy(1000, 20, 210)).toBe(1);
  });

  test("scales linearly in between", () => {
    // floor 20, range 210 -> value 125 is halfway
    expect(normalizeEnergy(125, 20, 210)).toBeCloseTo(0.5);
  });

  test("uses sensible defaults when floor/range are omitted", () => {
    expect(normalizeEnergy(20)).toBe(0);
    expect(normalizeEnergy(230)).toBe(1);
  });
});

describe("smoothTowards", () => {
  test("jumps immediately when the target is higher (attack)", () => {
    expect(smoothTowards(0.2, 0.9, 0.5)).toBe(0.9);
    expect(smoothTowards(0.5, 0.5, 0.5)).toBe(0.5); // equal counts as "higher"
  });

  test("eases gradually when the target is lower (release)", () => {
    // remainingFraction 1 -> no movement yet
    expect(smoothTowards(1, 0, 1)).toBe(1);
    // remainingFraction 0 -> fully settled at target
    expect(smoothTowards(1, 0, 0)).toBe(0);
    // remainingFraction 0.5 -> halfway down
    expect(smoothTowards(1, 0, 0.5)).toBeCloseTo(0.5);
  });
});

describe("computeHue", () => {
  test("hue-shift theme (e.g. Neon/Fire) interpolates between its two hues", () => {
    const theme = { hues: [320, 200] };
    expect(computeHue(theme, 0, 0)).toBe(320);
    expect(computeHue(theme, 0, 0.5)).toBe(260);
  });

  test("colorCycle theme with no spread set is flat and just follows the shift", () => {
    const theme = { colorCycle: true };
    expect(computeHue(theme, 90, 0.75)).toBe(90);
    expect(computeHue(theme, 400, 0)).toBe(40); // wraps at 360
  });

  test("colorCycle theme with a spread varies hue across offset too", () => {
    const theme = { colorCycle: true, spread: 50 };
    expect(computeHue(theme, 90, 0)).toBe(90); // offset 0 -> no added spread
    expect(computeHue(theme, 90, 1)).toBe(140); // offset 1 -> full spread added
    expect(computeHue(theme, 90, 0.5)).toBe(115); // partway across
  });

  test("colorCycle spread still cycles with hueShift and wraps at 360", () => {
    const theme = { colorCycle: true, spread: 50 };
    expect(computeHue(theme, 340, 1)).toBe(30); // 340 + 50 = 390 -> wraps to 30
  });

  test("rainbow (static) theme spreads offset across the full spectrum", () => {
    const theme = { rainbow: true };
    expect(computeHue(theme, 999, 0.25)).toBe(90); // no rotation, shift ignored
  });

  test("rainbow + cycle theme rotates the spread over time", () => {
    const theme = { rainbow: true, cycle: true };
    expect(computeHue(theme, 45, 0.25)).toBe(135);
    expect(computeHue(theme, 350, 0.25)).toBe(80); // wraps at 360
  });
});

describe("detectBeat", () => {
  const tuning = {
    beatRatio: 1.25,
    beatFloor: 42,
    sustainedFloor: 150,
  };

  test("fires a spike when bass is well above the rolling average and loud enough", () => {
    const result = detectBeat({
      bass: 100,
      avg: 60, // 100 > 60 * 1.25 and > beatFloor
      beatCooldownMsLeft: 0,
      sustainedCooldownMsLeft: 1000,
      tuning,
    });
    expect(result.isSpike).toBe(true);
    expect(result.isBeat).toBe(true);
  });

  test("does not fire a spike while its cooldown is still active", () => {
    const result = detectBeat({
      bass: 100,
      avg: 60,
      beatCooldownMsLeft: 50,
      sustainedCooldownMsLeft: 1000,
      tuning,
    });
    expect(result.isSpike).toBe(false);
  });

  test("does not fire a spike if it's louder but not enough above the average", () => {
    const result = detectBeat({
      bass: 70,
      avg: 60, // ratio only ~1.17, under 1.25
      beatCooldownMsLeft: 0,
      sustainedCooldownMsLeft: 1000,
      tuning,
    });
    expect(result.isSpike).toBe(false);
  });

  test("fires sustained-loud when bass stays above the sustained floor", () => {
    const result = detectBeat({
      bass: 200,
      avg: 195, // ratio too low for a spike, but well above sustainedFloor
      beatCooldownMsLeft: 0,
      sustainedCooldownMsLeft: 0,
      tuning,
    });
    expect(result.isSpike).toBe(false);
    expect(result.isSustainedLoud).toBe(true);
    expect(result.isBeat).toBe(true);
  });

  test("reports no beat when quiet", () => {
    const result = detectBeat({
      bass: 10,
      avg: 8,
      beatCooldownMsLeft: 0,
      sustainedCooldownMsLeft: 0,
      tuning,
    });
    expect(result.isBeat).toBe(false);
  });
});

describe("mergeSettings", () => {
  const defaults = {
    bgType: "color",
    bgColor: "#0f0f1a",
    bgImageDataUrl: null,
    bgImageName: null,
    bgBrightness: 1,
    bgBlur: 0,
    mode: 0,
    theme: 0,
    autoCycle: false,
    smoothingEnabled: true,
    radialMode: "mirrored",
    kaleidoMaxRFrac: 0.46,
  };

  test("falls back to defaults when nothing was saved", () => {
    expect(mergeSettings(defaults, null, 5, 7)).toEqual(defaults);
  });

  test("applies each valid saved field over the defaults", () => {
    const saved = {
      bgType: "image",
      bgColor: "#ffffff",
      bgImageDataUrl: "data:image/jpeg;base64,abc",
      bgImageName: "wall.jpg",
      bgBrightness: 0.7,
      bgBlur: 4,
      mode: 2,
      theme: 3,
      autoCycle: true,
      smoothingEnabled: false,
      radialMode: "full",
      kaleidoMaxRFrac: 0.6,
    };
    expect(mergeSettings(defaults, saved, 5, 7)).toEqual(saved);
  });

  test("ignores a mode/theme index that's out of range (e.g. from an older version)", () => {
    const saved = { mode: 99, theme: -1 };
    const result = mergeSettings(defaults, saved, 5, 7);
    expect(result.mode).toBe(defaults.mode);
    expect(result.theme).toBe(defaults.theme);
  });

  test("ignores a malformed bgType instead of accepting garbage", () => {
    const saved = { bgType: "rainbow-unicorn" };
    expect(mergeSettings(defaults, saved, 5, 7).bgType).toBe("color");
  });

  test("never turns autoCycle on just because the key exists and is falsy", () => {
    const saved = { autoCycle: false };
    expect(mergeSettings(defaults, saved, 5, 7).autoCycle).toBe(false);
  });

  test("respects an explicit smoothingEnabled: false (not just truthy checks)", () => {
    const saved = { smoothingEnabled: false };
    expect(mergeSettings(defaults, saved, 5, 7).smoothingEnabled).toBe(false);
  });

  test("ignores an invalid radialMode value", () => {
    const saved = { radialMode: "spiral" };
    expect(mergeSettings(defaults, saved, 5, 7).radialMode).toBe("mirrored");
  });

  test("ignores a non-positive kaleidoMaxRFrac", () => {
    const saved = { kaleidoMaxRFrac: 0 };
    expect(mergeSettings(defaults, saved, 5, 7).kaleidoMaxRFrac).toBe(0.46);
  });
});
