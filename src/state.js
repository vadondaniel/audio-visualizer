// ---------- app state ----------
// Single source of truth for everything that can change at runtime.
// Most keys are persisted to localStorage — see PERSISTED_KEYS below.
// --bg-default also appears as the bgColorInput value in index.html and as
// the CSS custom property in style.css — keep all three in sync.
const state = {
  mode: 0,
  modeOrder: [...MODES],
  disabledModes: [],
  theme: 0,
  themeOrder: THEMES.map((theme) => theme.name),
  disabledThemes: [],
  colorGradientEnabled: true,
  autoCycle: false,
  hueShift: 0,
  bgType: "color", // "color" | "image" — which one is actually shown
  bgColor: "#0f0f1a",
  bgImageDataUrl: null,
  bgImageName: null,
  bgBrightness: 1,
  bgBlur: 0,
  miniOverlayShowBackground: false,
  miniOverlayScale: 1,
  miniOverlayOpacity: 1,
  miniOverlayMaxFps: 60,
  miniOverlayMode: "follow",
  smoothingEnabled: true,
  radialMode: "mirrored", // "mirrored" | "full" — radial visual only
  kaleidoClipEnabled: true, // kaleidoscope visual only — see drawKaleidoscope
  barsAlignment: "bottom", // "bottom" | "center"
  waveformStyle: "line", // "line" | "filled"
  prismLayout: "circular", // "circular" | "straight"
  cascadeFrequencyOrder: "bass-to-treble", // "bass-to-treble" | "treble-to-bass"
  cascadeFillStyle: "dark", // "dark" | "light" | "theme"
  sensitivity: 1.0, // audio multiplier (0.5x - 2.5x)
  bassSensitivityEnabled: false,
  bassSensitivityAmount: 0.5,
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
  mediaMetadataEnabled: false,
  mediaDisplay: "cover-title-artist", // "title" | "title-artist" | "cover" | "cover-title" | "cover-title-artist"
  mediaTextPositions: ModeRegistry.mediaDefaults(),
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
  "miniOverlayShowBackground",
  "miniOverlayScale",
  "miniOverlayOpacity",
  "miniOverlayMaxFps",
  "miniOverlayMode",
  "mode",
  "modeOrder",
  "disabledModes",
  "theme",
  "themeOrder",
  "disabledThemes",
  "colorGradientEnabled",
  "autoCycle",
  "smoothingEnabled",
  "radialMode",
  "kaleidoClipEnabled",
  "barsAlignment",
  "waveformStyle",
  "prismLayout",
  "cascadeFrequencyOrder",
  "cascadeFillStyle",
  "sensitivity",
  "bassSensitivityEnabled",
  "bassSensitivityAmount",
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
  "mediaMetadataEnabled",
  "mediaDisplay",
  "mediaTextPositions",
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

// Compatibility commands delegate to the shared settings actions.
function setAutoCycle(enabled) {
  settingsActions.set("autoCycle", enabled);
}
function loadSettings() {
  restoreSettings();
  settingsActions.initialize();
}

// Restoration only parses, validates, and migrates persisted data.
function restoreSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
  } catch (e) {
    saved = null;
  }
  saved = SettingsMigrations.migratePrismLayout(saved, ModeRegistry);
  // Keep the earlier media-position key readable so existing settings do not reset.
  if (saved) {
    if (saved.mediaTextPositions == null) {
      saved.mediaTextPositions = {};
    }
    if (
      saved.mediaTextPositions &&
      typeof saved.mediaTextPositions === "object"
    ) {
      // Migrate the old single-position setting into the current mode only;
      // future mode switches now retain independent positions.
      const legacy =
        saved.mediaTextPosition === "above" ||
        saved.mediaTextPosition === "below"
          ? saved.mediaTextPosition
          : saved.mediaArtistPosition === "above" ||
              saved.mediaArtistPosition === "below"
            ? saved.mediaArtistPosition
            : null;
      if (legacy && saved.mediaTextPositions.cascade == null)
        saved.mediaTextPositions.cascade = legacy;
      if (legacy && saved.mediaTextPositions.radial == null)
        saved.mediaTextPositions.radial = legacy;
    }
  }
  Object.assign(
    state,
    mergeSettings(state, saved, MODES.length, THEMES.length)
  );
  Object.assign(
    state,
    ModeList.normalize(MODES, saved?.modeOrder, saved?.disabledModes)
  );
}
