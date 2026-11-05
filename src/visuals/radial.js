(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry.registerFactory("radial", api.createMode);
})(globalThis, function () {
  function createMode(services) {
    const { VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;

    const { applyGlow } = services;

    function drawRadial(ctx, frame) {
      const {
        bass: bassLevel,
        mid: midLevel,
        treble: trebleLevel,
      } = frame.signals.levels;
      const state = frame.settings;
      const canvas = frame;
      const bands = frame.signals.bands;
      const beatPulse = frame.beat.pulse;
      const mediaArt = frame.mediaArt;

      const { baseRFrac, lengthScale } = VISUAL_TUNING.radial;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const baseR =
        Math.min(canvas.width, canvas.height) *
        baseRFrac *
        (1 + bassLevel * 0.2 + beatPulse * 0.25);
      const barCount = 180;
      const halfCount = barCount / 2;

      ctx.lineCap = "round";

      for (let i = 0; i < barCount; i++) {
        const normalized =
          state.radialMode === "full"
            ? i / barCount
            : i < halfCount
              ? i / halfCount
              : (barCount - i - 1) / halfCount;

        const v = bands[i];

        const len =
          v *
          Math.min(canvas.width, canvas.height) *
          lengthScale *
          (0.8 + midLevel * 0.25 + trebleLevel * 0.2);
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(angle) * baseR;
        const y1 = cy + Math.sin(angle) * baseR;
        const x2 = cx + Math.cos(angle) * (baseR + len);
        const y2 = cy + Math.sin(angle) * (baseR + len);

        const hue = currentHue(normalized);
        ctx.strokeStyle = themeCssColor(hue, 90, 60, 1);
        ctx.lineWidth = 2.4;
        applyGlow(ctx, ctx.strokeStyle, 10, state.glowIntensity);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // Central focus: when media art is available, let radial use the same
      // focal treatment as cascade rather than showing a generic color disc.
      const focusR = baseR * 0.8;
      const currentMediaArt = mediaArt;

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, focusR, 0, Math.PI * 2);
      ctx.clip();
      if (currentMediaArt) {
        const destSize = focusR * 2.04;
        const sourceW = currentMediaArt.naturalWidth;
        const sourceH = currentMediaArt.naturalHeight;
        const sourceRatio = sourceW / sourceH;
        const cropRatio = 1;
        let sourceX = 0;
        let sourceY = 0;
        let cropW = sourceW;
        let cropH = sourceH;
        if (sourceRatio > cropRatio) {
          cropW = sourceH * cropRatio;
          sourceX = (sourceW - cropW) / 2;
        } else if (sourceRatio < cropRatio) {
          cropH = sourceW / cropRatio;
          sourceY = (sourceH - cropH) / 2;
        }
        ctx.drawImage(
          currentMediaArt,
          sourceX,
          sourceY,
          cropW,
          cropH,
          cx - destSize / 2,
          cy - destSize / 2,
          destSize,
          destSize
        );
      } else {
        const focusGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, focusR);
        focusGrad.addColorStop(0, themeCssColor(currentHue(0), 90, 60, 0.48));
        focusGrad.addColorStop(
          1,
          themeCssColor(currentHue(0.15), 90, 26, 0.24)
        );
        ctx.fillStyle = focusGrad;
        ctx.fill();
      }
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, focusR, 0, Math.PI * 2);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = themeCssColor(currentHue(0), 90, 70, 0.76);
      applyGlow(ctx, ctx.strokeStyle, 10, state.glowIntensity);
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.lineCap = "butt";
    }

    return {
      update() {},
      draw: drawRadial,
      reset() {},
    };
  }
  return { createMode };
});
