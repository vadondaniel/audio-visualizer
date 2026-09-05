const {
  trailOpacity,
  trailCaptureIntervalMs,
  shouldCaptureTrail,
  isTrailFrameExpired,
} = require("../trail-math");

describe("trailOpacity", () => {
  test("starts fully visible and reaches zero at the finite lifetime", () => {
    expect(trailOpacity(0, 220)).toBe(1);
    expect(trailOpacity(220, 220)).toBe(0);
    expect(trailOpacity(300, 220)).toBe(0);
  });

  test("decays smoothly with a cubic curve", () => {
    expect(trailOpacity(110, 220)).toBeCloseTo(0.125);
    expect(trailOpacity(55, 220)).toBeGreaterThan(trailOpacity(110, 220));
  });
});

describe("trail history timing", () => {
  test("captures every normal display frame and caps high-refresh capture rate", () => {
    expect(trailCaptureIntervalMs(220, 24)).toBeCloseTo(220 / 24);
    expect(shouldCaptureTrail(0, null, 220, 24)).toBe(true);
    expect(shouldCaptureTrail(16.67, 0, 220, 24)).toBe(true);
    expect(shouldCaptureTrail(6, 0, 220, 24)).toBe(false);
    expect(shouldCaptureTrail(9.17, 0, 220, 24)).toBe(true);
  });

  test("keeps a 240 Hz trail within the snapshot cap for its full lifetime", () => {
    let lastCapture = null;
    let captures = 0;
    for (let timestamp = 0; timestamp < 220; timestamp += 1000 / 240) {
      if (shouldCaptureTrail(timestamp, lastCapture, 220, 24)) {
        lastCapture = timestamp;
        captures += 1;
      }
    }

    expect(captures).toBeLessThanOrEqual(24);
  });

  test("expires each snapshot at its own lifetime without a global reset", () => {
    expect(isTrailFrameExpired(219.99, 0, 220)).toBe(false);
    expect(isTrailFrameExpired(220, 0, 220)).toBe(true);
  });
});
