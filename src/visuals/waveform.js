/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry.registerFactory("waveform", api.createMode);
})(globalThis, function () {
  /**
   * @param {import("../visual-contracts").Services} services
   * @returns {import("../visual-contracts").Mode}
   */
  function createMode(services) {
    const { THEMES } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;

    const { applyGlow } = services;
    /** Connected spectral peaks above and below a straight baseline.
     * @param {CanvasRenderingContext2D} ctx
     * @param {import("../visual-contracts").Frame} frame */
    function drawPrismLine(ctx, frame) {
      const bands = frame.signals.bands;
      if (bands.length < 2) return;
      const midY = frame.height / 2;
      const span = frame.height * 0.38;
      const step = frame.width / (bands.length - 1);
      const size = Math.min(frame.width, frame.height);
      ctx.lineWidth = Math.max(1, size * 0.0018);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (let i = 0; i < bands.length; i++) {
        const level = Math.min(1, Math.max(0, bands[i]));
        const x = i * step;
        const top = midY - level * span;
        const bottom = midY + level * span;
        const hue = currentHue(i / (bands.length - 1));
        ctx.strokeStyle = themeCssColor(hue, 95, 70, 0.4 + level * 0.6);
        applyGlow(
          ctx,
          themeCssColor(hue, 95, 65, 1),
          8 + level * 7,
          frame.settings.glowIntensity
        );
        if (i + 1 < bands.length) {
          const next = Math.min(1, Math.max(0, bands[i + 1])) * span;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x + step, midY - next);
          ctx.moveTo(x, bottom);
          ctx.lineTo(x + step, midY + next);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x, bottom);
        ctx.lineTo(x, top);
        ctx.globalAlpha = 0.25 + level * 0.45;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = themeCssColor(hue, 85, 85, 0.65 + level * 0.35);
        for (const y of [top, bottom]) {
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.7, size * 0.0015), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    }
    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {import("../visual-contracts").Frame} frame
     */
    function drawWaveform(ctx, frame) {
      if (frame.settings.waveformStyle === "prism") {
        drawPrismLine(ctx, frame);
        return;
      }
      const {
        bass: bassLevel,
        mid: midLevel,
        treble: trebleLevel,
      } = frame.signals.levels;
      const state = frame.settings;
      const canvas = frame;
      const waveformSamples = frame.signals.waveform;
      const bufferLength = frame.signals.waveform.length;
      const beatPulse = frame.beat.pulse;

      const midY = canvas.height / 2;
      ctx.lineWidth = 2.5 + midLevel * 1.5 + trebleLevel + beatPulse * 3;
      ctx.lineJoin = "round";

      const stops = 6;
      const makeWaveformGradient = (alpha) => {
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
        for (let s = 0; s <= stops; s++) {
          gradient.addColorStop(
            s / stops,
            themeCssColor(currentHue(s / stops), 90, 60, alpha)
          );
        }
        return gradient;
      };

      const grad = makeWaveformGradient(1);
      ctx.strokeStyle = grad;
      const waveformTheme = THEMES[state.theme];
      const strokeWaveform = () => {
        if (waveformTheme.rainbow && state.glowIntensity > 0) {
          // Canvas shadows only accept one color. Blur the actual rainbow stroke
          // instead, so every part of the glow keeps the color of its outline.
          ctx.save();
          ctx.filter = `blur(${6 * state.glowIntensity}px)`;
          ctx.globalAlpha = Math.min(1, 0.65 * state.glowIntensity);
          ctx.lineWidth += 5 * state.glowIntensity;
          ctx.stroke();
          ctx.restore();
        }
        ctx.stroke();
      };

      if (waveformTheme.rainbow) {
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";
      } else {
        applyGlow(
          ctx,
          themeCssColor(currentHue(0.5), 90, 60, 1),
          16,
          state.glowIntensity
        );
      }

      const slice = canvas.width / bufferLength;
      const amp = 1.35 + midLevel * 0.35 + trebleLevel * 0.2 + bassLevel * 0.25;
      const buildWaveformPath = (reflected = false) => {
        ctx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          const raw = waveformSamples[i];
          const direction = reflected ? -1 : 1;
          const y = midY + direction * raw * amp * canvas.height * 0.32;
          const x = i * slice;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      };

      if (state.waveformStyle === "filled") {
        // Upper ribbon fill
        buildWaveformPath();
        ctx.lineTo(canvas.width, midY);
        ctx.lineTo(0, midY);
        ctx.closePath();
        ctx.fillStyle = makeWaveformGradient(0.22);
        ctx.fill();
        buildWaveformPath();
        strokeWaveform();

        // Symmetrical lower reflected harmonic ribbon
        buildWaveformPath(true);
        ctx.lineTo(canvas.width, midY);
        ctx.lineTo(0, midY);
        ctx.closePath();
        ctx.fillStyle = makeWaveformGradient(0.12);
        ctx.fill();
        buildWaveformPath(true);
        strokeWaveform();
      } else {
        buildWaveformPath();
        strokeWaveform();
      }
      ctx.shadowBlur = 0;
    }

    return {
      update() {},
      draw: drawWaveform,
      reset() {},
    };
  }
  return { createMode };
});
