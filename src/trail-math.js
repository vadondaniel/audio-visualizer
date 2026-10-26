// Pure trail-history rules, kept independent of Canvas so their lifetime and
// capture behavior can be tested without a browser renderer.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TrailMath = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  function trailOpacity(ageMs, durationMs) {
    if (ageMs <= 0) return 1;
    if (ageMs >= durationMs) return 0;
    const remaining = 1 - ageMs / durationMs;
    return remaining * remaining * remaining;
  }

  function trailCaptureIntervalMs(durationMs, maxSnapshots, maxFps = 60) {
    const snapshotInterval = durationMs / maxSnapshots;
    const fpsInterval = 1000 / maxFps;
    return Math.max(snapshotInterval, fpsInterval);
  }

  function shouldCaptureTrail(
    timestampMs,
    lastCaptureMs,
    durationMs,
    maxSnapshots,
    maxFps = 60
  ) {
    return (
      lastCaptureMs === null ||
      timestampMs - lastCaptureMs >=
        trailCaptureIntervalMs(durationMs, maxSnapshots, maxFps)
    );
  }

  function isTrailFrameExpired(timestampMs, frameTimestampMs, durationMs) {
    return timestampMs - frameTimestampMs >= durationMs;
  }

  return {
    trailOpacity,
    trailCaptureIntervalMs,
    shouldCaptureTrail,
    isTrailFrameExpired,
  };
});
