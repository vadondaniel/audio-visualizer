/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry.registerFactory("kaleidoscope", api.createMode);
})(globalThis, function () {
  /**
   * @param {import("../visual-contracts").Services} services
   * @returns {import("../visual-contracts").Mode}
   */
  function createMode(services) {
    const { KALEIDO_BARS, VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;

    const { applyGlow } = services;
    const overlayBounds = { x: 0, y: 0, width: 0, height: 0 };
    const kaleidoSegmentValues = new Float64Array(KALEIDO_BARS);
    let kaleidoRotation = 0;

    let kaleidoFlash = 0;

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {import("../visual-contracts").Frame} frame
     */
    function drawKaleidoscope(ctx, frame) {
      const bassLevel = frame.signals.levels.bass;
      const midLevel = frame.signals.levels.mid;
      const state = frame.settings;
      const canvas = frame;

      const { maxRFrac, coreRFrac } = VISUAL_TUNING.kaleidoscope;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const segments = 8;
      const segAngle = (Math.PI * 2) / segments;
      const maxR = Math.min(canvas.width, canvas.height) * maxRFrac;

      for (let s = 0; s < segments; s++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s * segAngle + kaleidoRotation);
        const mirrored = s % 2 === 1;

        for (let i = 0; i < KALEIDO_BARS; i++) {
          const v = kaleidoSegmentValues[i];
          if (v < 0.03) continue;

          const t = i / KALEIDO_BARS;
          let aStart = t * segAngle;
          let aEnd = (t + 0.92 / KALEIDO_BARS) * segAngle;

          if (mirrored) {
            const newStart = segAngle - aEnd;
            const newEnd = segAngle - aStart;
            aStart = newStart;
            aEnd = newEnd;
          }

          const r =
            18 +
            v *
              maxR *
              (0.55 + midLevel * 0.25 + bassLevel * 0.2 + kaleidoFlash * 0.15);

          const hue = currentHue(t);

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, r, aStart, aEnd);
          ctx.closePath();
          ctx.fillStyle = themeCssColor(hue, 90, 55 + v * 15, 0.35 + v * 0.55);
          applyGlow(ctx, ctx.fillStyle, 10, state.glowIntensity);
          ctx.fill();
        }
        ctx.restore();
      }

      if (kaleidoFlash > 0.02) {
        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          maxR * (0.15 + (1 - kaleidoFlash) * 0.55),
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = themeCssColor(
          currentHue(0),
          90,
          70,
          kaleidoFlash * 0.6
        );
        ctx.lineWidth = 3 + kaleidoFlash * 4;
        applyGlow(ctx, ctx.strokeStyle, 20, state.glowIntensity);
        ctx.stroke();
      }

      const coreR =
        maxR * coreRFrac * (1 + bassLevel * 0.7 + kaleidoFlash * 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = themeCssColor(currentHue(0), 90, 65, 0.6);
      applyGlow(ctx, ctx.fillStyle, 16, state.glowIntensity);
      ctx.fill();

      ctx.shadowBlur = 0;
    }

    /**
     * @param {import("../visual-contracts").Frame} frame
     */
    function updateKaleidoscope(frame) {
      const dtSec = frame.dtSec;
      const state = frame.settings;
      const signals = frame.signals;
      const beatPulse = frame.beat.pulse;

      const { spinPerSec, spinTreblePerSec, spinBeatPerSec, flashDecayPerSec } =
        VISUAL_TUNING.kaleidoscope;
      kaleidoRotation +=
        (spinPerSec +
          signals.motion.treble * spinTreblePerSec +
          beatPulse * spinBeatPerSec) *
        dtSec;
      kaleidoFlash = Math.max(0, kaleidoFlash - flashDecayPerSec * dtSec);
      if (beatPulse > 0.75) kaleidoFlash = 1;

      // Visual exception: radial tilt and wedge expansion are geometry shaping.
      for (let i = 0; i < KALEIDO_BARS; i++) {
        const tilt = 1 + (i / KALEIDO_BARS) * 1.6;
        const rawV = Math.pow(signals.bands[i] * tilt, 0.7);
        kaleidoSegmentValues[i] = state.kaleidoClipEnabled
          ? Math.min(1, rawV)
          : rawV;
      }
    }

    /** Maximum rotated geometry; diffuse glow is covered by the presentation margin.
     * @param {import('../visual-contracts').Frame} frame
     * @returns {import('../visual-contracts').RenderBounds} */
    function getOverlayBounds(frame) {
      const size = Math.min(frame.width, frame.height);
      const tuning = VISUAL_TUNING.kaleidoscope;
      const maxR = size * tuning.maxRFrac;
      const maxTilt = 1 + ((KALEIDO_BARS - 1) / KALEIDO_BARS) * 1.6;
      const maxV = frame.settings.kaleidoClipEnabled
        ? 1
        : Math.pow(maxTilt, 0.7);
      const wedgeRadius = 18 + maxV * maxR * (0.55 + 0.25 + 0.2 + 0.15);
      const flashRadius = maxR * (0.15 + 0.55) + 7 / 2;
      const coreRadius = maxR * tuning.coreRFrac * (1 + 0.7 + 0.6);
      const extent = Math.max(wedgeRadius, flashRadius, coreRadius) + 2;
      overlayBounds.x = frame.width / 2 - extent;
      overlayBounds.y = frame.height / 2 - extent;
      overlayBounds.width = overlayBounds.height = extent * 2;
      return overlayBounds;
    }

    const initial = structuredClone({
      kaleidoSegmentValues,
      kaleidoRotation,
      kaleidoFlash,
    });
    return {
      getOverlayBounds,
      update: updateKaleidoscope,
      draw: drawKaleidoscope,
      reset() {
        services.restore(kaleidoSegmentValues, initial.kaleidoSegmentValues);
        kaleidoRotation = services.restore(
          kaleidoRotation,
          initial.kaleidoRotation
        );

        kaleidoFlash = services.restore(kaleidoFlash, initial.kaleidoFlash);
      },
    };
  }
  return { createMode };
});
