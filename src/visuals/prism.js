/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry.registerFactory("prism", api.createMode);
})(globalThis, function () {
  const PRISM_BANDS = 96;

  function prismOuterRadius(radius, level) {
    return radius * (1 + Math.min(1, Math.max(0, level)) * 1.1);
  }
  function prismInnerRadius(radius, level) {
    return radius * (1 - Math.min(1, Math.max(0, level)) * 0.88);
  }

  /**
   * @param {import("../visual-contracts").Services} services
   * @returns {import("../visual-contracts").Mode}
   */
  function createMode(services) {
    const { VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;

    const { applyGlow } = services;
    // Radial bands join their neighboring peaks on both sides of the circle.

    const prismOuter = new Float64Array(PRISM_BANDS * 2);
    const prismInner = new Float64Array(PRISM_BANDS * 2);

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {import("../visual-contracts").Frame} frame
     */
    function drawPrism(ctx, frame) {
      const bassLevel = frame.signals.levels.bass;
      const state = frame.settings;
      const canvas = frame;
      const prismSpectrum = frame.signals.bands;

      const size = Math.min(canvas.width, canvas.height);
      const radius =
        size * VISUAL_TUNING.prism.radiusFrac * (1 + bassLevel * 0.035);
      const step = (Math.PI * 2) / PRISM_BANDS;
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.lineWidth = Math.max(1, size * 0.0018);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (let i = 0; i < PRISM_BANDS; i++) {
        const angle = i * step - Math.PI / 2;
        const tipAngle = angle + step / 2;
        const level = prismSpectrum[i];
        const outer = prismOuterRadius(radius, level),
          inner = prismInnerRadius(radius, level);
        const oX = Math.cos(tipAngle) * outer,
          oY = Math.sin(tipAngle) * outer;
        const iX = Math.cos(tipAngle) * inner,
          iY = Math.sin(tipAngle) * inner;
        prismOuter[i * 2] = oX;
        prismOuter[i * 2 + 1] = oY;
        prismInner[i * 2] = iX;
        prismInner[i * 2 + 1] = iY;
      }
      for (let i = 0; i < PRISM_BANDS; i++) {
        const next = (i + 1) % PRISM_BANDS;
        const level = prismSpectrum[i];
        const oX = prismOuter[i * 2],
          oY = prismOuter[i * 2 + 1];
        const iX = prismInner[i * 2],
          iY = prismInner[i * 2 + 1];
        const hue = currentHue(i / PRISM_BANDS);
        // Connect actual neighboring peaks, including the closing seam.
        ctx.beginPath();
        ctx.moveTo(oX, oY);
        ctx.lineTo(prismOuter[next * 2], prismOuter[next * 2 + 1]);
        ctx.moveTo(iX, iY);
        ctx.lineTo(prismInner[next * 2], prismInner[next * 2 + 1]);
        ctx.strokeStyle = themeCssColor(hue, 95, 70, 0.4 + level * 0.6);
        applyGlow(
          ctx,
          themeCssColor(hue, 95, 65, 1),
          8 + level * 7,
          state.glowIntensity
        );
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(iX, iY);
        ctx.lineTo(oX, oY);
        ctx.globalAlpha = 0.25 + level * 0.45;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(iX, iY, Math.max(0.7, size * 0.0015), 0, Math.PI * 2);
        ctx.fillStyle = themeCssColor(hue, 85, 85, 0.65 + level * 0.35);
        ctx.fill();
        if (level > 0.25) {
          ctx.beginPath();
          ctx.arc(oX, oY, Math.max(1, size * 0.002), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(1, size * 0.0016);
      // Match each arc to the band centered on it, including animated themes.
      for (let i = 0; i < PRISM_BANDS; i++) {
        const angle = i * step - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(0, 0, radius, angle, angle + step);
        ctx.strokeStyle = themeCssColor(
          currentHue(i / PRISM_BANDS),
          95,
          70,
          0.75
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    const initial = structuredClone({ prismOuter, prismInner });
    return {
      update() {},
      draw: drawPrism,
      reset() {
        services.restore(prismOuter, initial.prismOuter);
        services.restore(prismInner, initial.prismInner);
      },
    };
  }
  return { createMode, prismInnerRadius, prismOuterRadius };
});
