// Pure trail-history rules, kept independent of Canvas so their lifetime and
// capture behavior can be tested without a browser renderer.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TrailMath = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const CAPTURE_TOLERANCE_MS = 0.01;

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

  function shouldCaptureTrail(timestampMs, nextCaptureMs) {
    return (
      nextCaptureMs === null ||
      timestampMs + CAPTURE_TOLERANCE_MS >= nextCaptureMs
    );
  }

  function advanceTrailCaptureDeadline(timestampMs, nextCaptureMs, intervalMs) {
    if (nextCaptureMs === null) return timestampMs + intervalMs;
    // Preserve the schedule's phase, skipping missed slots rather than capturing
    // them in a burst. Include the due-check tolerance when advancing a boundary.
    const elapsedMs = Math.max(0, timestampMs - nextCaptureMs);
    const slots =
      Math.floor((elapsedMs + CAPTURE_TOLERANCE_MS) / intervalMs) + 1;
    return nextCaptureMs + slots * intervalMs;
  }

  function isTrailFrameExpired(timestampMs, frameTimestampMs, durationMs) {
    return timestampMs - frameTimestampMs >= durationMs;
  }

  // Reuse the caller's output record; malformed or empty bounds retain the full frame.
  /** @param {import('./visual-contracts').RenderBounds|null|undefined} bounds
   * @param {number} width
   * @param {number} height
   * @param {{x:number,y:number,width:number,height:number}} result */
  function resolveTrailBounds(bounds, width, height, result) {
    result.x = result.y = 0;
    result.width = width;
    result.height = height;
    if (
      !bounds ||
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      return result;
    const x = Math.max(0, Math.floor(bounds.x));
    const y = Math.max(0, Math.floor(bounds.y));
    const right = Math.min(width, Math.ceil(bounds.x + bounds.width));
    const bottom = Math.min(height, Math.ceil(bounds.y + bounds.height));
    if (right <= x || bottom <= y) return result;
    result.x = x;
    result.y = y;
    result.width = right - x;
    result.height = bottom - y;
    return result;
  }

  return {
    resolveTrailBounds,
    trailOpacity,
    trailCaptureIntervalMs,
    shouldCaptureTrail,
    advanceTrailCaptureDeadline,
    isTrailFrameExpired,
  };
});
