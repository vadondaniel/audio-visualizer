(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.VisualModes ??= {}).prism = api.createMode;
})(globalThis, function () {
  const PRISM_BANDS = 96;
  function prismBandEdge(
    index,
    binCount,
    rangeEnd = Math.floor(binCount * 0.5)
  ) {
    const start = Math.floor(binCount * 0.002);
    const end = Math.min(
      Math.floor(binCount * 0.5),
      Math.max(start + PRISM_BANDS, Math.round(rangeEnd))
    );
    // Reserve one distinct bin per band, then distribute the remaining bins
    // logarithmically. Pure log spacing repeats bins at the bass end.
    const extra = Math.max(0, end - start - PRISM_BANDS);
    return Math.min(
      binCount,
      Math.floor(
        start + index + (extra * (Math.pow(250, index / PRISM_BANDS) - 1)) / 249
      )
    );
  }
  function prismOuterRadius(radius, level) {
    return radius * (1 + Math.min(1, Math.max(0, level)) * 1.1);
  }
  function prismInnerRadius(radius, level) {
    return radius * (1 - Math.min(1, Math.max(0, level)) * 0.88);
  }
  function prismActiveEnd(data, spectrumBandDb) {
    const start = Math.floor(data.length * 0.002);
    const end = Math.floor(data.length * 0.5);
    let peak = -Infinity;
    for (let i = start; i < end; i++)
      if (Number.isFinite(data[i])) peak = Math.max(peak, data[i]);
    // Silence must not remap the spectrum. A relative threshold follows the
    // recording level; the absolute floor excludes background noise.
    if (peak <= -75) return 0;
    const threshold = Math.max(-80, peak - 18);
    let last = start;
    for (let lo = start; lo < end; lo += 4) {
      const hi = Math.min(end, lo + 4);
      if (spectrumBandDb(data, lo, hi) >= threshold) last = hi;
    }
    return Math.min(
      end,
      Math.max(start + PRISM_BANDS, Math.ceil(last * 1.1) + 4)
    );
  }
  function prismAudioLevel(
    db,
    referenceDb,
    curve,
    sensitivity,
    applyValueHandling
  ) {
    if (!Number.isFinite(db) || db <= -100) return 0;
    // A 45 dB display range preserves musical detail before the selected
    // response curve. Applying exponential to amplitude ratios crushes it.
    const level = Math.max(0, Math.min(1, 1 + (db - referenceDb) / 45));
    const gain = Math.max(0.5, Math.min(2.5, sensitivity));
    return applyValueHandling((level * gain) / (1 + (gain - 1) * level), curve);
  }
  function createMode(services) {
    const { smoothTowards, applyValueHandling, spectrumBandDb } = services.math;
    const { VISUAL_TUNING } = services.constants;
    const currentHue = services.palette.currentHue;
    const themeCssColor = services.palette.themeCssColor;
    const applyBassModulation = services.modulate;
    let ctx, state, canvas, freqData, readFloatSpectrum;
    function bind(frame) {
      state = frame.settings;
      canvas = frame;
      freqData = frame.audio.frequencyBytes;
      readFloatSpectrum = frame.audio.readFloatSpectrum;
    }
    function applyGlow(color, blur) {
      ctx.shadowBlur = blur * state.glowIntensity;
      ctx.shadowColor = ctx.shadowBlur > 0 ? color : "transparent";
    }
    // Radial bands join their neighboring peaks on both sides of the circle.

    const prismSpectrum = new Float64Array(PRISM_BANDS);
    const prismBandDb = new Float64Array(PRISM_BANDS);
    const prismOuter = new Float64Array(PRISM_BANDS * 2);
    const prismInner = new Float64Array(PRISM_BANDS * 2);
    let prismFftDb = null;
    let prismPeakDb = -65;
    let prismRangeEnd = 0;
    let prismRangeHold = 0;

    function updatePrismSpectrum(dtSec) {
      if (!prismFftDb || prismFftDb.length !== freqData.length) {
        prismRangeEnd = 0;
        prismRangeHold = 0;
      }
      prismFftDb = readFloatSpectrum();
      const activeEnd = prismActiveEnd(prismFftDb, spectrumBandDb);
      const dt = Math.max(0, dtSec);
      if (!prismRangeEnd)
        prismRangeEnd = activeEnd || Math.floor(freqData.length * 0.5);
      if (activeEnd > prismRangeEnd) {
        prismRangeEnd +=
          (activeEnd - prismRangeEnd) * (1 - Math.exp(-dt / 0.15));
        prismRangeHold = 0.5;
      } else {
        prismRangeHold = Math.max(0, prismRangeHold - dt);
        if (activeEnd && prismRangeHold === 0)
          prismRangeEnd +=
            (activeEnd - prismRangeEnd) * (1 - Math.exp(-dt / 1.5));
      }
      let peak = -65;
      for (let i = 0; i < PRISM_BANDS; i++) {
        const lo = prismBandEdge(i, freqData.length, prismRangeEnd);
        const hi = prismBandEdge(i + 1, freqData.length, prismRangeEnd);
        prismBandDb[i] = spectrumBandDb(prismFftDb, lo, hi);
        peak = Math.max(peak, prismBandDb[i]);
      }
      prismPeakDb = Math.max(peak, prismPeakDb - Math.max(0, dtSec) * 12);
      const remaining = state.smoothingEnabled
        ? Math.exp(-VISUAL_TUNING.prism.releasePerSec * dtSec)
        : 0;
      for (let i = 0; i < PRISM_BANDS; i++) {
        const target = applyBassModulation(
          prismAudioLevel(
            prismBandDb[i],
            prismPeakDb,
            state.valueHandling,
            state.sensitivity,
            applyValueHandling
          )
        );
        prismSpectrum[i] = smoothTowards(prismSpectrum[i], target, remaining);
      }
    }

    function drawPrism(bassLevel, midLevel, trebleLevel, dtSec) {
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
        applyGlow(themeCssColor(hue, 95, 65, 1), 8 + level * 7);
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

    function updatePrism(bassLevel, midLevel, trebleLevel, dtSec) {
      updatePrismSpectrum(dtSec);
    }

    const initial = structuredClone({
      prismSpectrum,
      prismBandDb,
      prismOuter,
      prismInner,
      prismPeakDb,
      prismRangeEnd,
      prismRangeHold,
    });
    return {
      update(frame) {
        bind(frame);
        updatePrism(
          frame.levels.bass,
          frame.levels.mid,
          frame.levels.treble,
          frame.dtSec
        );
      },
      draw(context, frame) {
        ctx = context;
        bind(frame);
        drawPrism(
          frame.levels.bass,
          frame.levels.mid,
          frame.levels.treble,
          frame.dtSec
        );
      },
      reset() {
        services.restore(prismSpectrum, initial.prismSpectrum);
        services.restore(prismBandDb, initial.prismBandDb);
        services.restore(prismOuter, initial.prismOuter);
        services.restore(prismInner, initial.prismInner);
        prismPeakDb = services.restore(prismPeakDb, initial.prismPeakDb);
        prismRangeEnd = services.restore(prismRangeEnd, initial.prismRangeEnd);
        prismRangeHold = services.restore(
          prismRangeHold,
          initial.prismRangeHold
        );
        prismFftDb = null;
      },
    };
  }
  return {
    createMode,
    prismBandEdge,
    prismInnerRadius,
    prismOuterRadius,
    prismActiveEnd,
    prismAudioLevel,
  };
});
