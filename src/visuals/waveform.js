function drawWaveform(bassLevel, midLevel, trebleLevel) {
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
    applyGlow(themeCssColor(currentHue(0.5), 90, 60, 1), 16);
  }

  const slice = canvas.width / bufferLength;
  const amp = 1.35 + midLevel * 0.35 + trebleLevel * 0.2 + bassLevel * 0.25;
  const buildWaveformPath = (reflected = false) => {
    ctx.beginPath();
    for (let i = 0; i < bufferLength; i++) {
      const raw = (timeData[i] - 128) / 128;
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
