(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.VisualModes ??= {}).kaleidoscope = api.createMode;
})(globalThis, function () {
  function createMode(services) {
    const { KALEIDO_BARS, VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;
    let signals, ctx, state, canvas, beatPulse;
    function bind(frame) {
      state = frame.settings;
      canvas = frame;
      signals = frame.signals;

      beatPulse = frame.beat.pulse;
    }
    function applyGlow(color, blur) {
      ctx.shadowBlur = blur * state.glowIntensity;
      ctx.shadowColor = ctx.shadowBlur > 0 ? color : "transparent";
    }
    const kaleidoSegmentValues = new Float64Array(KALEIDO_BARS);
    let kaleidoRotation = 0;

    let kaleidoFlash = 0;

    function drawKaleidoscope(bassLevel, midLevel, trebleLevel, dtSec) {
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
          applyGlow(ctx.fillStyle, 10);
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
        applyGlow(ctx.strokeStyle, 20);
        ctx.stroke();
      }

      const coreR =
        maxR * coreRFrac * (1 + bassLevel * 0.7 + kaleidoFlash * 0.6);
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = themeCssColor(currentHue(0), 90, 65, 0.6);
      applyGlow(ctx.fillStyle, 16);
      ctx.fill();

      ctx.shadowBlur = 0;
    }

    function updateKaleidoscope(bassLevel, midLevel, trebleLevel, dtSec) {
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

    const initial = structuredClone({
      kaleidoSegmentValues,
      kaleidoRotation,
      kaleidoFlash,
    });
    return {
      update(frame) {
        bind(frame);
        updateKaleidoscope(
          frame.signals.levels.bass,
          frame.signals.levels.mid,
          frame.signals.levels.treble,
          frame.dtSec
        );
      },
      draw(context, frame) {
        ctx = context;
        bind(frame);
        drawKaleidoscope(
          frame.signals.levels.bass,
          frame.signals.levels.mid,
          frame.signals.levels.treble,
          frame.dtSec
        );
      },
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
