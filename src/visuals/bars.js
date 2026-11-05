(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.VisualModes ??= {}).bars = api.createMode;
})(globalThis, function () {
  function createMode(services) {
    const { smoothTowards, applyValueHandling } = services.math;
    const { VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;
    const applyBassModulation = services.modulate;
    let ctx, state, canvas, freqData, bufferLength, beatPulse;
    function bind(frame) {
      state = frame.settings;
      canvas = frame;
      freqData = frame.audio.frequencyBytes;
      bufferLength = frame.audio.frequencyBytes.length;
      beatPulse = frame.beat.pulse;
    }
    function applyGlow(color, blur) {
      ctx.shadowBlur = blur * state.glowIntensity;
      ctx.shadowColor = ctx.shadowBlur > 0 ? color : "transparent";
    }
    function updateBars(bassLevel, midLevel, trebleLevel, dtSec) {
      const remaining = state.smoothingEnabled
        ? Math.exp(-VISUAL_TUNING.bars.releasePerSec * dtSec)
        : 0;
      const step = Math.max(1, Math.floor((bufferLength * 0.69) / 96));
      for (let i = 0; i < 96; i++) {
        const targetV = applyBassModulation(
          applyValueHandling(freqData[i * step] / 255, state.valueHandling)
        );
        smoothedBars[i] = smoothTowards(smoothedBars[i], targetV, remaining);
      }
    }
    const smoothedBars = new Array(96).fill(0);

    function drawBars(bassLevel, midLevel, trebleLevel, dtSec) {
      const { baseYFrac, heightScale } = VISUAL_TUNING.bars;
      const barCount = 96;

      const w = canvas.width / barCount;
      const baseY = canvas.height * baseYFrac;

      const isCenter = state.barsAlignment === "center";
      const centerY = canvas.height / 2;

      for (let i = 0; i < barCount; i++) {
        const v = smoothedBars[i];

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

    const initial = structuredClone({ smoothedBars });
    return {
      update(frame) {
        bind(frame);
        updateBars(
          frame.levels.bass,
          frame.levels.mid,
          frame.levels.treble,
          frame.dtSec
        );
      },
      draw(context, frame) {
        ctx = context;
        bind(frame);
        drawBars(
          frame.levels.bass,
          frame.levels.mid,
          frame.levels.treble,
          frame.dtSec
        );
      },
      reset() {
        services.restore(smoothedBars, initial.smoothedBars);
      },
    };
  }
  return { createMode };
});
