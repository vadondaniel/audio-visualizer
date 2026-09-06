// ---------- DOM references ----------

// Canvas and startup UI
const canvas = document.getElementById("canvas");
const displayCtx = canvas.getContext("2d");
const renderCanvas = document.createElement("canvas");
let ctx = renderCanvas.getContext("2d");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const errorMsg = document.getElementById("errorMsg");

// Settings panel trigger
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");

// Visual / theme selectors
const modeSelect = document.getElementById("modeSelect");
const themeSelect = document.getElementById("themeSelect");
const colorGradientRow = document.getElementById("colorGradientRow");
const colorGradientCheckbox = document.getElementById("colorGradientCheckbox");
const barsAlignmentRow = document.getElementById("barsAlignmentRow");
const barsAlignmentSelect = document.getElementById("barsAlignmentSelect");
const waveformStyleRow = document.getElementById("waveformStyleRow");
const waveformStyleSelect = document.getElementById("waveformStyleSelect");
const cascadeFrequencyRow = document.getElementById("cascadeFrequencyRow");
const cascadeFrequencyCheckbox = document.getElementById(
  "cascadeFrequencyCheckbox"
);
const cascadeFillRow = document.getElementById("cascadeFillRow");
const cascadeFillSelect = document.getElementById("cascadeFillSelect");
const smoothingRow = document.getElementById("smoothingRow");
const smoothingCheckbox = document.getElementById("smoothingCheckbox");
const radialModeRow = document.getElementById("radialModeRow");
const radialMirroredCheckbox = document.getElementById(
  "radialMirroredCheckbox"
);
const kaleidoClipRow = document.getElementById("kaleidoClipRow");
const kaleidoClipCheckbox = document.getElementById("kaleidoClipCheckbox");
const sensitivitySlider = document.getElementById("sensitivitySlider");
const sensitivityVal = document.getElementById("sensitivityVal");
const valueHandlingSelect = document.getElementById("valueHandlingSelect");
const glowSlider = document.getElementById("glowSlider");
const glowVal = document.getElementById("glowVal");
const trailsCheckbox = document.getElementById("trailsCheckbox");
const trailDurationRow = document.getElementById("trailDurationRow");
const trailDurationSlider = document.getElementById("trailDurationSlider");
const trailDurationVal = document.getElementById("trailDurationVal");
const trailFpsSlider = document.getElementById("trailFpsSlider");
const trailFpsVal = document.getElementById("trailFpsVal");
const wakeLockCheckbox = document.getElementById("wakeLockCheckbox");

// Background controls
const bgLayer = document.getElementById("bgLayer");
const bgCanvas = document.getElementById("bgCanvas");
const bgCtx = bgCanvas ? bgCanvas.getContext("2d") : null;
const bgTypeSelect = document.getElementById("bgTypeSelect");
const bgColorRow = document.getElementById("bgColorRow");
const bgImageRow = document.getElementById("bgImageRow");
const bgColorInput = document.getElementById("bgColorInput");
const bgImageInput = document.getElementById("bgImageInput");
const bgImageName = document.getElementById("bgImageName");
const clearBgImageBtn = document.getElementById("clearBgImageBtn");
const brightnessRow = document.getElementById("brightnessRow");
const brightnessSlider = document.getElementById("brightnessSlider");
const brightnessVal = document.getElementById("brightnessVal");
const blurRow = document.getElementById("blurRow");
const blurSlider = document.getElementById("blurSlider");
const blurVal = document.getElementById("blurVal");

// Post-Processing & FX overlay
const fxOverlay = document.getElementById("fxOverlay");
const reactiveVignetteCheckbox = document.getElementById(
  "reactiveVignetteCheckbox"
);
const crtFilterCheckbox = document.getElementById("crtFilterCheckbox");
const beatFlashCheckbox = document.getElementById("beatFlashCheckbox");

// Particle-mode controls
const particleDensityRow = document.getElementById("particleDensityRow");
const particleStyleRow = document.getElementById("particleStyleRow");
const particleDensitySlider = document.getElementById("particleDensitySlider");
const particleDensityVal = document.getElementById("particleDensityVal");
const particleStyleSelect = document.getElementById("particleStyleSelect");

const diagnosticsStatus = document.getElementById("diagnosticsStatus");
const diagFps = document.getElementById("diagFps");
const diagFrame = document.getElementById("diagFrame");
const diagRender = document.getElementById("diagRender");
const diagTrail = document.getElementById("diagTrail");
const diagLoad = document.getElementById("diagLoad");
const diagDetail = document.getElementById("diagDetail");

// Hotkeys modal
const hotkeysBtn = document.getElementById("hotkeysBtn");
const hotkeysOverlay = document.getElementById("hotkeysOverlay");
const hotkeysCloseBtn = document.getElementById("hotkeysCloseBtn");

// ---------- canvas resize ----------
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  renderCanvas.width = window.innerWidth;
  renderCanvas.height = window.innerHeight;
  if (bgCanvas) {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  if (typeof resetTrailHistory === "function") resetTrailHistory();
}
window.addEventListener("resize", resize);
resize();

// ---------- populate dropdowns ----------
// Built from MODES/THEMES (constants.js) so adding a new entry there
// auto-populates the settings panel dropdowns without touching HTML.
MODES.forEach((name, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
  modeSelect.appendChild(opt);
});
THEMES.forEach((theme, i) => {
  const opt = document.createElement("option");
  opt.value = i;
  opt.textContent = theme.name;
  themeSelect.appendChild(opt);
});
