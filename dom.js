// ---------- DOM references ----------

// Canvas and startup UI
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const errorMsg = document.getElementById("errorMsg");

// Settings panel trigger
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");

// Visual / theme selectors
const modeSelect = document.getElementById("modeSelect");
const themeSelect = document.getElementById("themeSelect");
const barsAlignmentRow = document.getElementById("barsAlignmentRow");
const barsAlignmentSelect = document.getElementById("barsAlignmentSelect");
const waveformStyleRow = document.getElementById("waveformStyleRow");
const waveformStyleSelect = document.getElementById("waveformStyleSelect");
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
const glowSlider = document.getElementById("glowSlider");
const glowVal = document.getElementById("glowVal");

// Background controls
const bgLayer = document.getElementById("bgLayer");
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

// Hotkeys modal
const hotkeysBtn = document.getElementById("hotkeysBtn");
const hotkeysOverlay = document.getElementById("hotkeysOverlay");
const hotkeysCloseBtn = document.getElementById("hotkeysCloseBtn");

// ---------- canvas resize ----------
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
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
