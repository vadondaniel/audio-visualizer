const {
  trailOpacity,
  trailCaptureIntervalMs,
  shouldCaptureTrail,
  advanceTrailCaptureDeadline,
  isTrailFrameExpired,
} = require("../src/trail-math");

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
    expect(trailCaptureIntervalMs(220, 24, 60)).toBeCloseTo(1000 / 60);
    expect(shouldCaptureTrail(0, null)).toBe(true);
    expect(shouldCaptureTrail(16.67, 1000 / 60)).toBe(true);
    expect(shouldCaptureTrail(6, 1000 / 60)).toBe(false);
    expect(shouldCaptureTrail(9.17, 1000 / 120)).toBe(true);
  });

  test("keeps a 240 Hz trail within the snapshot cap for its full lifetime", () => {
    let nextCapture = null;
    let captures = 0;
    for (let timestamp = 0; timestamp < 220; timestamp += 1000 / 240) {
      if (shouldCaptureTrail(timestamp, nextCapture)) {
        nextCapture = advanceTrailCaptureDeadline(
          timestamp,
          nextCapture,
          trailCaptureIntervalMs(220, 24)
        );
        captures += 1;
      }
    }

    expect(captures).toBeLessThanOrEqual(24);
  });

  test.each(
    [60, 120, 144, 165, 240].flatMap((hz) =>
      [15, 30, 60, 120, 240].map((fps) => [hz, fps])
    )
  )("sustains the achievable rate at %i Hz with a %i FPS cap", (hz, fps) => {
    let nextCapture = null;
    let captures = 0;
    const limit = Math.ceil((220 * fps) / 1000) + 1;
    const interval = trailCaptureIntervalMs(220, limit, fps);
    for (let frame = 0; frame < hz * 10; frame++) {
      const now = (frame * 1000) / hz;
      if (shouldCaptureTrail(now, nextCapture)) {
        captures++;
        nextCapture = advanceTrailCaptureDeadline(now, nextCapture, interval);
      }
    }
    expect(Math.abs(captures - Math.min(hz, fps) * 10)).toBeLessThanOrEqual(1);
  });

  test("tolerates rounding at a deadline without accepting substantially early frames", () => {
    expect(shouldCaptureTrail(100 - 1e-10, 100)).toBe(true);
    expect(shouldCaptureTrail(99.995, 100)).toBe(true);
    expect(shouldCaptureTrail(99.98, 100)).toBe(false);
    expect(advanceTrailCaptureDeadline(99.995, 100, 20)).toBe(120);
    expect(advanceTrailCaptureDeadline(119.995, 100, 20)).toBe(140);
  });

  test("anchors the first deadline and skips missed deadlines after a long pause", () => {
    expect(advanceTrailCaptureDeadline(123, null, 20)).toBe(143);
    const next = advanceTrailCaptureDeadline(10005, 20, 20);
    expect(next).toBe(10020);
    expect(shouldCaptureTrail(10005, next)).toBe(false);
    expect(shouldCaptureTrail(10010, next)).toBe(false);
    expect(shouldCaptureTrail(10020, next)).toBe(true);
  });

  test("expires each snapshot at its own lifetime without a global reset", () => {
    expect(isTrailFrameExpired(219.99, 0, 220)).toBe(false);
    expect(isTrailFrameExpired(220, 0, 220)).toBe(true);
  });
});
