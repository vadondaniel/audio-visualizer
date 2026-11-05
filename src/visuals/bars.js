(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry.registerFactory("bars", api.createMode);
})(globalThis, function () {
  function createMode(services) {
    const { VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;
    let signals, ctx, state, canvas, beatPulse;
    function bind(frame) {
      state = frame.settings;
      canvas = frame;
      signals = frame.signals;
      bands = signals.bands;

      beatPulse = frame.beat.pulse;
    }
    function applyGlow(color, blur) {
      ctx.shadowBlur = blur * state.glowIntensity;
      ctx.shadowColor = ctx.shadowBlur > 0 ? color : "transparent";
    }

    let bands;

    function drawBars(bassLevel, midLevel, trebleLevel, dtSec) {
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
        applyGlow(ctx.fillStyle, 14);

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
      update(frame) {
        bind(frame);
      },
      draw(context, frame) {
        ctx = context;
        bind(frame);
        drawBars(
          frame.signals.levels.bass,
          frame.signals.levels.mid,
          frame.signals.levels.treble,
          frame.dtSec
        );
      },
      reset() {},
    };
  }
  return { createMode };
});
