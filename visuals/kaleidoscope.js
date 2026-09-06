let kaleidoRotation = 0;
const smoothedKaleido = new Array(KALEIDO_BARS).fill(0);
let kaleidoFlash = 0;

function drawKaleidoscope(bassLevel, midLevel, trebleLevel, dtSec) {
  const {
    maxRFrac,
    coreRFrac,
    releasePerSec,
    spinPerSec,
    spinTreblePerSec,
    spinBeatPerSec,
    flashDecayPerSec,
  } = VISUAL_TUNING.kaleidoscope;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const segments = 8;
  const segAngle = (Math.PI * 2) / segments;
  const maxR = Math.min(canvas.width, canvas.height) * maxRFrac;

  kaleidoRotation +=
    (spinPerSec + trebleLevel * spinTreblePerSec + beatPulse * spinBeatPerSec) *
    dtSec;
  kaleidoFlash = Math.max(0, kaleidoFlash - flashDecayPerSec * dtSec);
  if (beatPulse > 0.75) kaleidoFlash = 1;

  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  for (let s = 0; s < segments; s++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(s * segAngle + kaleidoRotation);
    const mirrored = s % 2 === 1;

    for (let i = 0; i < KALEIDO_BARS; i++) {
      const raw = bandAverage(
        freqData,
        KALEIDO_BAND_EDGES[i],
        KALEIDO_BAND_EDGES[i + 1]
      );
      const tilt = 1 + (i / KALEIDO_BARS) * 1.6;
      const handled = applyValueHandling(raw / 255, state.valueHandling);
      const rawV = Math.pow(handled * tilt, 0.7);
      const targetV = state.kaleidoClipEnabled ? Math.min(1, rawV) : rawV;
      smoothedKaleido[i] = smoothTowards(
        smoothedKaleido[i],
        targetV,
        remaining
      );
      const v = smoothedKaleido[i];
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
    ctx.arc(cx, cy, maxR * (0.15 + (1 - kaleidoFlash) * 0.55), 0, Math.PI * 2);
    ctx.strokeStyle = themeCssColor(currentHue(0), 90, 70, kaleidoFlash * 0.6);
    ctx.lineWidth = 3 + kaleidoFlash * 4;
    applyGlow(ctx.strokeStyle, 20);
    ctx.stroke();
  }

  const coreR = maxR * coreRFrac * (1 + bassLevel * 0.7 + kaleidoFlash * 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = themeCssColor(currentHue(0), 90, 65, 0.6);
  applyGlow(ctx.fillStyle, 16);
  ctx.fill();

  ctx.shadowBlur = 0;
}
