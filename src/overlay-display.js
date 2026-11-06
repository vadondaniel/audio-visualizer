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
  return { effectiveMode, createDrawSchedule };
});
