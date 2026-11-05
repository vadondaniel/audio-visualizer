(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry.registerFactory("bars", api.createMode);
})(globalThis, function () {
  function createMode(services) {
    const { VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;

    const { applyGlow } = services;

    function drawBars(ctx, frame) {
      const bassLevel = frame.signals.levels.bass;
      const midLevel = frame.signals.levels.mid;
      const state = frame.settings;
      const canvas = frame;
      const bands = frame.signals.bands;
      const beatPulse = frame.beat.pulse;

      const { baseYFrac, heightScale } = VISUAL_TUNING.bars;
      const barCount = 96;

      const w = canvas.width / barCount;
      const baseY = canvas.height * baseYFrac;

      const isCenter = state.barsAlignment === "center";
      const centerY = canvas.height / 2;

      for (let i = 0; i < barCount; i++) {
        const v = bands[i];

        const h =
          v *
          canvas.height *
          heightScale *
          (0.82 + bassLevel * 0.2 + midLevel * 0.12 + beatPulse * 0.15);
        const hue = currentHue(i / barCount);
        ctx.fillStyle = themeCssColor(hue, 90, 50 + v * 20, 1);
        applyGlow(ctx, ctx.fillStyle, 14, state.glowIntensity);

        if (isCenter) {
          const halfH = h * 0.68;
          ctx.fillRect(i * w, centerY - halfH, w * 0.8, halfH * 2);
        } else {
          ctx.fillRect(i * w, baseY - h, w * 0.8, h);
          // mirrored reflection below
          ctx.globalAlpha = 0.25;
          ctx.fillRect(i * w, baseY, w * 0.8, h * 0.35);
          ctx.globalAlpha = 1;
        }
      }
      ctx.shadowBlur = 0;
    }

    return {
      update() {},
      draw: drawBars,
      reset() {},
    };
  }
  return { createMode };
});
