const smoothedRadial = new Array(180).fill(0);

function drawRadial(bassLevel, midLevel, trebleLevel, dtSec) {
  const { baseRFrac, lengthScale, releasePerSec } = VISUAL_TUNING.radial;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const baseR =
    Math.min(canvas.width, canvas.height) *
    baseRFrac *
    (1 + bassLevel * 0.2 + beatPulse * 0.25);
  const barCount = 180;
  const halfCount = barCount / 2;
  const remaining = state.smoothingEnabled
    ? Math.exp(-releasePerSec * dtSec)
    : 0;

  ctx.lineCap = "round";

  for (let i = 0; i < barCount; i++) {
    const normalized =
      state.radialMode === "full"
        ? i / barCount
        : i < halfCount
          ? i / halfCount
          : (barCount - i - 1) / halfCount;
    const idx = Math.floor(normalized * bufferLength * 0.5);
    const targetV = applyValueHandling(
      freqData[idx] / 255,
      state.valueHandling
    );
    smoothedRadial[i] = smoothTowards(smoothedRadial[i], targetV, remaining);
    const v = smoothedRadial[i];

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
    applyGlow(ctx.strokeStyle, 10);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Central focus: when media art is available, let radial use the same
  // focal treatment as cascade rather than showing a generic color disc.
  const focusR = baseR * 0.8;
  const currentMediaArt =
    typeof mediaState !== "undefined" &&
    state.mediaMetadataEnabled &&
    mediaState.metadata?.thumbnailDataUrl &&
    mediaState.thumbnailImage?.complete &&
    mediaState.thumbnailImage.naturalWidth > 0 &&
    mediaState.thumbnailImage.naturalHeight > 0
      ? mediaState.thumbnailImage
      : null;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, focusR, 0, Math.PI * 2);
  ctx.clip();
  if (currentMediaArt) {
    const imgSize = focusR * 2.04;
    ctx.drawImage(
      currentMediaArt,
      cx - imgSize / 2,
      cy - imgSize / 2,
      imgSize,
      imgSize
    );
  } else {
    const focusGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, focusR);
    focusGrad.addColorStop(0, themeCssColor(currentHue(0), 90, 60, 0.48));
    focusGrad.addColorStop(1, themeCssColor(currentHue(0.15), 90, 26, 0.24));
    ctx.fillStyle = focusGrad;
    ctx.fill();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, focusR, 0, Math.PI * 2);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = themeCssColor(currentHue(0), 90, 70, 0.76);
  applyGlow(ctx.strokeStyle, 10);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.lineCap = "butt";
}
