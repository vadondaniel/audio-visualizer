// Pure, DOM-free logic pulled out of renderer.js so it can be unit tested
// with plain Node/Jest (renderer.js itself talks to the canvas, audio
// devices, and localStorage directly, so it can only really run inside the
// app). Nothing in this file touches the window, the DOM, or Electron.
//
// Loaded two ways:
//  - In the browser: index.html includes this as a plain <script> before
//    renderer.js, so everything below ends up as `window.AudioMath`.
//  - In tests: `require("./audio-math")` gets the same object via
//    module.exports (Node has no `window`, so it falls back to that).
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AudioMath = factory();
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  // Averages a slice of a frequency-data array between two fractional
  // positions (0-1) along its length. Used to turn the raw FFT bins into a
  // single bass/mid/treble energy number.
  function bandAverage(data, loFrac, hiFrac) {
    const lo = Math.floor(data.length * loFrac);
    const hi = Math.floor(data.length * hiFrac);
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += data[i];
    return sum / Math.max(1, hi - lo);
  }

  // Maps a raw energy value onto a clamped 0-1 range, given a noise floor
  // to ignore and a range that maps to "full strength".
  function normalizeEnergy(value, floor = 20, range = 210) {
    return Math.min(1, Math.max(0, (value - floor) / range));
  }

  // Exponential ease used for every bar/particle/spin value in the app:
  // jumps up instantly, eases back down over `remainingFraction` (an
  // exp-decay term computed by the caller from a release rate and elapsed
  // time). Never eases *up* — that's what makes hits feel snappy and
  // releases feel smooth.
  function smoothTowards(current, target, remainingFraction) {
    return target >= current
      ? target
      : current + (target - current) * (1 - remainingFraction);
  }

  // Given a theme definition (as in renderer.js's THEMES array) and the
  // current global hue-cycle position, works out the hue for a point at
  // `offset` (0-1) along whatever's being drawn (e.g. a bar's position).
  function interpolateHue(a, b, t) {
    const delta = ((b - a + 540) % 360) - 180;
    return (a + delta * t + 360) % 360;
  }

  function computeHue(theme, hueShift, offset = 0, gradientEnabled = true) {
    if (theme.rainbow) {
      const rotation = theme.cycle ? hueShift : 0;
      // A visual rainbow runs through ROYGBIV rather than wrapping violet back
      // through red at the far edge. Keep the static rainbow fixed; only the
      // explicit Rainbow Cycle theme rotates it.
      return (offset * 300 + rotation) % 360;
    }
    if (theme.colorCycle) {
      const spread =
        theme.alwaysGradient || gradientEnabled ? theme.spread || 0 : 0;
      return (hueShift + offset * spread) % 360;
    }

    const useGradient = theme.alwaysGradient || gradientEnabled;
    const t = useGradient ? Math.min(1, Math.max(0, offset)) : 0;
    const stops =
      Array.isArray(theme.colorStops) && theme.colorStops.length
        ? theme.colorStops
        : null;

    if (stops) {
      if (stops.length === 1 || t <= stops[0].position)
        return ((stops[0].hue % 360) + 360) % 360;
      for (let i = 1; i < stops.length; i++) {
        const prev = stops[i - 1];
        const next = stops[i];
        if (t <= next.position) {
          const span = Math.max(1e-9, next.position - prev.position);
          const localT = (t - prev.position) / span;
          return interpolateHue(prev.hue, next.hue, localT);
        }
      }
      return ((stops[stops.length - 1].hue % 360) + 360) % 360;
    }

    // Backward-compatible two-hue themes. Hue ranges are directional and
    // interpolated along the shortest circular path.
    const [a = 0, b = a] = theme.hues || [0, 0];
    return interpolateHue(a, b, t);
  }

  // Decides whether the current bass reading counts as a "beat" — either a
  // sudden spike well above the recent rolling average, or just being loud
  // for a sustained stretch. Cooldowns (passed in, decremented by the
  // caller) stop either kind from re-firing every single frame.
  function detectBeat({
    bass,
    avg,
    beatCooldownMsLeft,
    sustainedCooldownMsLeft,
    tuning,
  }) {
    const isSpike =
      bass > avg * tuning.beatRatio &&
      bass > tuning.beatFloor &&
      beatCooldownMsLeft === 0;
    const isSustainedLoud =
      bass > tuning.sustainedFloor && sustainedCooldownMsLeft === 0;
    return { isSpike, isSustainedLoud, isBeat: isSpike || isSustainedLoud };
  }

  // Merges a settings object loaded from localStorage into a defaults
  // object, field by field, ignoring anything missing or malformed (e.g. a
  // settings file from an older version with a mode index that no longer
  // exists). Pulled out of loadSettings() so the validation rules can be
  // tested without touching localStorage at all.
  function mergeSettings(defaults, saved, validModeCount, validThemeCount) {
    const state = Object.assign({}, defaults);
    if (!saved || typeof saved !== "object") return state;

    const validBgTypes = ["color", "image", "nebula", "stars", "grid"];
    if (validBgTypes.includes(saved.bgType)) state.bgType = saved.bgType;
    if (saved.bgColor) state.bgColor = saved.bgColor;
    if (
      typeof saved.bgImageDataUrl === "string" ||
      saved.bgImageDataUrl === null
    )
      state.bgImageDataUrl = saved.bgImageDataUrl;
    if (typeof saved.bgImageName === "string" || saved.bgImageName === null)
      state.bgImageName = saved.bgImageName;
    if (
      Number.isFinite(saved.bgBrightness) &&
      saved.bgBrightness >= 0.2 &&
      saved.bgBrightness <= 1.6
    )
      state.bgBrightness = saved.bgBrightness;
    if (
      Number.isFinite(saved.bgBlur) &&
      saved.bgBlur >= 0 &&
      saved.bgBlur <= 20
    )
      state.bgBlur = saved.bgBlur;
    if (
      typeof saved.mode === "number" &&
      saved.mode >= 0 &&
      saved.mode < validModeCount
    )
      state.mode = saved.mode;
    if (
      typeof saved.theme === "number" &&
      saved.theme >= 0 &&
      saved.theme < validThemeCount
    )
      state.theme = saved.theme;
    if (typeof saved.colorGradientEnabled === "boolean")
      state.colorGradientEnabled = saved.colorGradientEnabled;
    if (typeof saved.autoCycle === "boolean") state.autoCycle = saved.autoCycle;
    if (typeof saved.smoothingEnabled === "boolean")
      state.smoothingEnabled = saved.smoothingEnabled;
    if (saved.radialMode === "mirrored" || saved.radialMode === "full")
      state.radialMode = saved.radialMode;
    if (typeof saved.kaleidoClipEnabled === "boolean")
      state.kaleidoClipEnabled = saved.kaleidoClipEnabled;
    if (saved.barsAlignment === "bottom" || saved.barsAlignment === "center")
      state.barsAlignment = saved.barsAlignment;
    if (saved.waveformStyle === "line" || saved.waveformStyle === "filled")
      state.waveformStyle = saved.waveformStyle;
    if (
      saved.cascadeFrequencyOrder === "bass-to-treble" ||
      saved.cascadeFrequencyOrder === "treble-to-bass"
    )
      state.cascadeFrequencyOrder = saved.cascadeFrequencyOrder;
    if (
      saved.cascadeFillStyle === "dark" ||
      saved.cascadeFillStyle === "light" ||
      saved.cascadeFillStyle === "theme"
    )
      state.cascadeFillStyle = saved.cascadeFillStyle;
    if (
      Number.isFinite(saved.sensitivity) &&
      saved.sensitivity >= 0.2 &&
      saved.sensitivity <= 3.0
    )
      state.sensitivity = saved.sensitivity;
    if (
      Number.isFinite(saved.glowIntensity) &&
      saved.glowIntensity >= 0 &&
      saved.glowIntensity <= 2.5
    )
      state.glowIntensity = saved.glowIntensity;
    if (typeof saved.trailsEnabled === "boolean")
      state.trailsEnabled = saved.trailsEnabled;
    if (
      Number.isFinite(saved.trailDuration) &&
      saved.trailDuration >= 80 &&
      saved.trailDuration <= 600
    )
      state.trailDuration = saved.trailDuration;
    if (
      Number.isFinite(saved.trailMaxFps) &&
      saved.trailMaxFps >= 15 &&
      saved.trailMaxFps <= 240
    )
      state.trailMaxFps = saved.trailMaxFps;
    if (typeof saved.wakeLockEnabled === "boolean")
      state.wakeLockEnabled = saved.wakeLockEnabled;
    if (typeof saved.reactiveVignette === "boolean")
      state.reactiveVignette = saved.reactiveVignette;
    if (typeof saved.crtFilter === "boolean") state.crtFilter = saved.crtFilter;
    if (typeof saved.beatFlash === "boolean") state.beatFlash = saved.beatFlash;
    if (
      Number.isFinite(saved.particleDensity) &&
      saved.particleDensity >= 0.5 &&
      saved.particleDensity <= 1.8
    )
      state.particleDensity = saved.particleDensity;
    if (
      saved.particleStyle === "flow" ||
      saved.particleStyle === "burst" ||
      saved.particleStyle === "vortex"
    )
      state.particleStyle = saved.particleStyle;
    if (typeof saved.mediaMetadataEnabled === "boolean")
      state.mediaMetadataEnabled = saved.mediaMetadataEnabled;
    if (
      saved.mediaDisplay === "title" ||
      saved.mediaDisplay === "title-artist" ||
      saved.mediaDisplay === "cover" ||
      saved.mediaDisplay === "cover-title" ||
      saved.mediaDisplay === "cover-title-artist"
    )
      state.mediaDisplay = saved.mediaDisplay;
    if (
      saved.mediaTextPositions &&
      typeof saved.mediaTextPositions === "object"
    ) {
      const allowed = new Set([
        "auto",
        "above",
        "below",
        "top-left",
        "top",
        "top-right",
        "right",
        "bottom-right",
        "bottom",
        "bottom-left",
        "left",
      ]);
      for (const [mode, position] of Object.entries(saved.mediaTextPositions)) {
        if (typeof mode === "string" && allowed.has(position))
          state.mediaTextPositions[mode] = position;
      }
    }
    if (
      saved.valueHandling === "exponential" ||
      saved.valueHandling === "logarithmic" ||
      saved.valueHandling === "linear"
    ) {
      state.valueHandling = saved.valueHandling;
    }

    return state;
  }

  // Applies the chosen audio scaling curve to a normalized 0..1 value.
  // - "exponential": sharpens peaks, compresses quiet floor (super punchy)
  // - "linear": direct 1:1 proportional response
  // - "logarithmic": perceptual decibel-style curve (amplifies quiet details, smooths peaks)
  function applyValueHandling(value, curve = "exponential") {
    const clamped = Math.max(0, Math.min(1, value));
    if (curve === "linear") {
      return clamped;
    }
    if (curve === "logarithmic") {
      return Math.log10(1 + 9 * clamped);
    }
    // Default: exponential (punchy)
    return Math.pow(clamped, 2.5);
  }

  return {
    bandAverage,
    normalizeEnergy,
    smoothTowards,
    computeHue,
    detectBeat,
    mergeSettings,
    applyValueHandling,
  };
});
