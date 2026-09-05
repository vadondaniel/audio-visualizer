// ---------- app state ----------
// Single source of truth for everything that can change at runtime.
// Most keys are persisted to localStorage — see PERSISTED_KEYS below.
// --bg-default also appears as the bgColorInput value in index.html and as
// the CSS custom property in style.css — keep all three in sync.
const state = {
  mode: 0,
  theme: 0,
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
  "autoCycle",
  "smoothingEnabled",
  "radialMode",
  "kaleidoClipEnabled",
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
  updateSliderLabels();
  updateBgRowsVisibility();
  syncSelectsToState();
  applyBackground();
}
