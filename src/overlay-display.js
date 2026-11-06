// Overlay presentation policy; simulation and audio acquisition remain at rAF rate.
/** @template T @param {typeof globalThis} root
 * @param {(timing:typeof import('./trail-math'))=>T} build */
(function (root, build) {
  if (typeof module === "object" && module.exports)
    module.exports = build(require("./trail-math"));
  else root.OverlayDisplay = build(root.TrailMath);
})(globalThis, function (timing) {
  /** @param {{mode:number,miniOverlayMode:string}} settings
   * @param {boolean} active @param {readonly string[]} ids */
  function effectiveMode(settings, active, ids) {
    return active &&
      settings.miniOverlayMode !== "follow" &&
      ids.includes(settings.miniOverlayMode)
      ? settings.miniOverlayMode
      : ids[settings.mode];
  }
  /** @typedef {{scale:number,x:number,y:number}} OverlayFit */
  /** Fit maximum geometry with a fixed display-space margin; no pixel rounding.
   * @param {import('./visual-contracts').RenderBounds|null} bounds
   * @param {number} width
   * @param {number} height
   * @param {OverlayFit} result
   * @returns {OverlayFit|null} */
  function fitBounds(bounds, width, height, result) {
    result.scale = 1;
    result.x = result.y = 0;
    const margin = 8;
    if (
      !bounds ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= margin * 2 ||
      height <= margin * 2 ||
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      !Number.isFinite(bounds.x + bounds.width) ||
      !Number.isFinite(bounds.y + bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    )
      return null;
    const scale = Math.min(
      (width - margin * 2) / bounds.width,
      (height - margin * 2) / bounds.height
    );
    const x = width / 2 - (bounds.x + bounds.width / 2) * scale;
    const y = height / 2 - (bounds.y + bounds.height / 2) * scale;
    if (
      !Number.isFinite(scale) ||
      scale <= 0 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    )
      return null;
    result.scale = scale;
    result.x = x;
    result.y = y;
    return result;
  }

  function createDrawSchedule() {
    /** @type {number|null} */
    let deadline = null;
    /** @type {number|null} */
    let lastDraw = null;
    let previousActive = false,
      previousCap = 0;
    const result = { draw: true, elapsedMs: 0 };
    function reset() {
      deadline = lastDraw = null;
    }
    function resetDeadline() {
      deadline = null;
    }
    /** @param {number} timestamp @param {boolean} active @param {number} fps */
    function step(timestamp, active, fps) {
      if (active !== previousActive || fps !== previousCap) deadline = null;
      previousActive = active;
      previousCap = fps;
      result.draw =
        !active || fps === 0 || timing.shouldCaptureTrail(timestamp, deadline);
      result.elapsedMs =
        lastDraw === null ? 0 : Math.max(0, timestamp - lastDraw);
      if (result.draw) {
        lastDraw = timestamp;
        deadline =
          active && fps > 0
            ? timing.advanceTrailCaptureDeadline(
                timestamp,
                deadline,
                1000 / fps
              )
            : null;
      }
      return result;
    }
    return { step, reset, resetDeadline };
  }
  return { effectiveMode, createDrawSchedule, fitBounds };
});
