// ---------- app state ----------
// Single source of truth for everything that can change at runtime.
// Most keys are persisted to localStorage — see PERSISTED_KEYS below.
// --bg-default also appears as the bgColorInput value in index.html and as
// the CSS custom property in style.css — keep all three in sync.
const state = {
  mode: 0,
  theme: 0,
  colorGradientEnabled: true,
  autoCycle: false,
  autoCycleTimer: null,
  hueShift: 0,
  bgType: "color", // "color" | "image" — which one is actually shown
  bgColor: "#0f0f1a",
  bgImageDataUrl: null,
  bgImageName: null,
  bgBrightness: 1,
  bgBlur: 0,
  smoothingEnabled: true,
  radialMode: "mirrored", // "mirrored" | "full" — radial visual only
  kaleidoClipEnabled: true, // kaleidoscope visual only — see drawKaleidoscope
  barsAlignment: "bottom", // "bottom" | "center"
  waveformStyle: "line", // "line" | "filled"
  cascadeFrequencyOrder: "bass-to-treble", // "bass-to-treble" | "treble-to-bass"
  sensitivity: 1.0, // audio multiplier (0.5x - 2.5x)
  valueHandling: "exponential", // "exponential" | "logarithmic" | "linear"
  glowIntensity: 1.0, // bloom multiplier (0% - 200%)
  trailsEnabled: true,
  trailDuration: TRAIL_DURATION_MS,
  trailMaxFps: TRAIL_MAX_FPS,
  wakeLockEnabled: false,
  reactiveVignette: true, // audio-reactive peripheral pulse
  crtFilter: false, // retro CRT scanlines & chromatic fringe
  beatFlash: true, // cinematic transient beat flare
  particleDensity: 1.0, // overall particle population multiplier
  particleStyle: "flow", // "flow" | "burst" | "vortex"
};

// ---------- settings persistence ----------
const SETTINGS_KEY = "audioVisualizerSettings";
const PERSISTED_KEYS = [
  "bgType",
  "bgColor",
  "bgImageDataUrl",
  "bgImageName",
  "bgBrightness",
  "bgBlur",
  "mode",
  "theme",
  "colorGradientEnabled",
  "autoCycle",
  "smoothingEnabled",
  "radialMode",
  "kaleidoClipEnabled",
  "barsAlignment",
  "waveformStyle",
  "cascadeFrequencyOrder",
  "sensitivity",
  "valueHandling",
  "glowIntensity",
  "trailsEnabled",
  "trailDuration",
  "trailMaxFps",
  "wakeLockEnabled",
  "reactiveVignette",
  "crtFilter",
  "beatFlash",
  "particleDensity",
  "particleStyle",
];

function saveSettings() {
  try {
    const toSave = {};
    for (const key of PERSISTED_KEYS) toSave[key] = state[key];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
  } catch (e) {
    console.warn("Could not save settings", e);
  }
}

function setAutoCycle(enabled) {
  state.autoCycle = enabled;
  clearInterval(state.autoCycleTimer);
  if (enabled) {
    state.autoCycleTimer = setInterval(() => {
      state.mode = (state.mode + 1) % MODES.length;
      syncSelectsToState();
      saveSettings();
    }, 12000);
  }
}

// loadSettings restores persisted values and syncs the UI to them. It must
// be called after all DOM refs (dom.js), background helpers (background.js),
// and settings event listeners (ui.js) are in place — ui.js calls it at
// the end of its settings-listener block.
function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
  } catch (e) {
    saved = null;
  }
  Object.assign(
    state,
    mergeSettings(state, saved, MODES.length, THEMES.length)
  );
  if (state.autoCycle) setAutoCycle(true);

  bgColorInput.value = state.bgColor;
  brightnessSlider.value = state.bgBrightness;
  blurSlider.value = state.bgBlur;
  smoothingCheckbox.checked = state.smoothingEnabled;
  radialMirroredCheckbox.checked = state.radialMode === "mirrored";
  kaleidoClipCheckbox.checked = state.kaleidoClipEnabled;
  barsAlignmentSelect.value = state.barsAlignment;
  waveformStyleSelect.value = state.waveformStyle;
  cascadeFrequencyCheckbox.checked =
    state.cascadeFrequencyOrder === "treble-to-bass";
  sensitivitySlider.value = state.sensitivity;
  if (typeof valueHandlingSelect !== "undefined" && valueHandlingSelect)
    valueHandlingSelect.value = state.valueHandling;
  glowSlider.value = state.glowIntensity;
  colorGradientCheckbox.checked = state.colorGradientEnabled;
  trailsCheckbox.checked = state.trailsEnabled;
  trailDurationSlider.value = state.trailDuration;
  trailFpsSlider.value = state.trailMaxFps;
  wakeLockCheckbox.checked = state.wakeLockEnabled;
  if (typeof reactiveVignetteCheckbox !== "undefined")
    reactiveVignetteCheckbox.checked = state.reactiveVignette;
  if (typeof crtFilterCheckbox !== "undefined")
    crtFilterCheckbox.checked = state.crtFilter;
  if (typeof beatFlashCheckbox !== "undefined")
    beatFlashCheckbox.checked = state.beatFlash;
  particleDensitySlider.value = state.particleDensity;
  particleStyleSelect.value = state.particleStyle;
  updateSliderLabels();
  updateBgRowsVisibility();
  syncSelectsToState();
  applyBackground();
  if (typeof applyFxOverlay === "function") applyFxOverlay();
}
