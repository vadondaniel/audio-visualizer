// ---------- settings panel: open/close + auto-hide ----------
// The gear button fades with mouse inactivity exactly like #hud (see
// flashHud below). The panel itself only shows when BOTH the person has
// opened it AND the mouse is currently active — so it fades away together
// with the rest of the UI on an idle screen instead of staying pinned
// open forever once toggled on.
let panelOpen = false;
function updatePanelVisibility() {
  settingsPanel.classList.toggle("visible", panelOpen && hudActive);
}

// Collapsible accordion sections: only one open at a time.
settingsPanel.addEventListener("click", (e) => {
  const title = e.target.closest(".settingsSectionTitle");
  if (!title) return;
  const section = title.closest(".settingsSection");
  if (!section) return;

  const isCollapsed = section.classList.contains("collapsed");
  // Collapse every section first
  for (const s of settingsPanel.querySelectorAll(".settingsSection")) {
    s.classList.add("collapsed");
  }
  // If the clicked one was collapsed, expand it (otherwise all stay collapsed)
  if (isCollapsed) section.classList.remove("collapsed");
});

settingsBtn.addEventListener("click", (e) => {
  panelOpen = !panelOpen;
  flashHud();
  updatePanelVisibility();
  e.stopPropagation(); // don't let the same click immediately close it below
});

// Click-outside-to-dismiss: only cares about closing, never opening —
// opening is settingsBtn/"S"'s job above.
window.addEventListener("click", (e) => {
  if (!panelOpen) return;
  if (settingsPanel.contains(e.target)) return;
  panelOpen = false;
  updatePanelVisibility();
});

modeSelect.addEventListener("change", (e) => {
  state.mode = parseInt(e.target.value, 10);
  updateVisualOptionRows();
  if (typeof refreshMediaForMode === "function") refreshMediaForMode();
  saveSettings();
});

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hueToChannel = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
    Math.round(hueToChannel(p, q, h) * 255),
    Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
  ];
}

function applyThemeUiColors() {
  const theme = THEMES[state.theme] || THEMES[0];
  const root = document.documentElement;
  let start;
  let end;

  // UI accents are related to the visual theme, but they need to remain
  // usable as interface chrome.  In particular, Black/White get distinct
  // neutral ramps rather than collapsing to the same "readable" gray.
  if (theme.monochrome === "white") {
    start = [255, 255, 255];
    end = [214, 214, 214];
  } else if (theme.monochrome === "black") {
    start = [150, 150, 150];
    end = [88, 88, 88];
  } else if (theme.colorCycle) {
    // Color Cycle represents one hue moving around the wheel, not a
    // miniature rainbow. Keep the UI on that single moving hue with a
    // restrained lightness ramp.
    const hue = ((uiHueShift % 360) + 360) % 360;
    start = hslToRgb(hue, 88, 62);
    end = hslToRgb(hue, 70, 42);
  } else if (theme.rainbow && theme.cycle) {
    // Rainbow Cycle is the full-spectrum variant: two visibly separated
    // points from the rotating spectrum make the distinction from Color
    // Cycle obvious.
    const hue = ((uiHueShift % 360) + 360) % 360;
    start = hslToRgb(hue, 92, 62);
    end = hslToRgb(hue + 210, 92, 62);
  } else if (theme.rainbow) {
    // Static Rainbow gets a representative red -> blue UI ramp rather than
    // the narrow violet segment used by the Violet theme.
    start = hslToRgb(0, 92, 62);
    end = hslToRgb(210, 92, 62);
  } else if (theme.name === "Violet") {
    // Keep Violet unmistakably purple rather than looking like a slice of
    // the full Rainbow palette.
    start = hslToRgb(270, 78, 55);
    end = hslToRgb(300, 70, 74);
  } else if (theme.colorStops?.length) {
    const first = theme.colorStops[0];
    const last = theme.colorStops[theme.colorStops.length - 1];
    start = hslToRgb(first.hue, 88, 62);
    end = hslToRgb(last.hue, 88, 62);
  } else {
    start = hslToRgb(320, 88, 62);
    end = hslToRgb(190, 88, 62);
  }

  const luminance = (rgb) =>
    0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

  // Cycling palettes must not flip the UI foreground between black and white
  // as the moving accent crosses a luminance threshold. That reads as UI
  // flicker rather than part of the color cycle. Keep one stable foreground
  // for the whole cycle.
  let contrast;
  if (theme.colorCycle || (theme.rainbow && theme.cycle)) {
    contrast = [245, 246, 250];
  } else {
    contrast =
      (luminance(start) + luminance(end)) / 2 > 155
        ? [11, 11, 16]
        : [245, 246, 250];
  }

  root.style.setProperty("--accent-rgb", start.join(", "));
  root.style.setProperty("--accent-2-rgb", end.join(", "));
  root.style.setProperty("--accent-contrast-rgb", contrast.join(", "));
}

let uiAccentAnimationFrame = null;
let lastUiAccentUpdate = 0;
let uiHueShift = 0;
let uiHueClock = null;
function updateCyclingUiAccent(timestamp = performance.now()) {
  const theme = THEMES[state.theme] || THEMES[0];
  const shouldCycle = Boolean(
    theme.colorCycle || (theme.rainbow && theme.cycle)
  );

  if (!shouldCycle) {
    uiAccentAnimationFrame = null;
    return;
  }

  if (uiHueClock == null) uiHueClock = timestamp;
  const dtMs = Math.min(100, Math.max(0, timestamp - uiHueClock));
  uiHueClock = timestamp;

  // The landing screen does not run the audio renderer yet, so it cannot
  // rely on state.hueShift being advanced by the main visual loop. Keep a
  // small independent UI hue clock so cycling themes visibly cycle before
  // START as well. Once audio is running, this remains intentionally
  // independent so the UI never adds work to the renderer's hot path.
  const cycleSpeed = VISUAL_TUNING.hueCycle.baseDegPerSec;
  uiHueShift = (uiHueShift + (cycleSpeed * dtMs) / 1000) % 360;

  // UI accents do not need display-rate stylesheet updates. 30 Hz keeps the
  // controls feeling alive without needlessly touching the stylesheet every frame.
  if (timestamp - lastUiAccentUpdate >= 33) {
    lastUiAccentUpdate = timestamp;
    applyThemeUiColors();
  }

  uiAccentAnimationFrame = requestAnimationFrame(updateCyclingUiAccent);
}

function restartUiAccentAnimation() {
  if (uiAccentAnimationFrame !== null) {
    cancelAnimationFrame(uiAccentAnimationFrame);
    uiAccentAnimationFrame = null;
  }
  lastUiAccentUpdate = 0;
  uiHueClock = null;
  uiHueShift = ((state.hueShift % 360) + 360) % 360;
  const theme = THEMES[state.theme] || THEMES[0];
  if (theme.colorCycle || (theme.rainbow && theme.cycle)) {
    uiAccentAnimationFrame = requestAnimationFrame(updateCyclingUiAccent);
  }
}

themeSelect.addEventListener("change", (e) => {
  state.theme = parseInt(e.target.value, 10);
  applyThemeUiColors();
  restartUiAccentAnimation();
  updateVisualOptionRows();
  saveSettings();
});

colorGradientCheckbox.addEventListener("change", (e) => {
  state.colorGradientEnabled = e.target.checked;
  saveSettings();
});

smoothingCheckbox.addEventListener("change", (e) => {
  state.smoothingEnabled = e.target.checked;
  saveSettings();
});

barsAlignmentSelect.addEventListener("change", (e) => {
  state.barsAlignment = e.target.value;
  saveSettings();
});

waveformStyleSelect.addEventListener("change", (e) => {
  state.waveformStyle = e.target.value;
  saveSettings();
});

cascadeFrequencyCheckbox.addEventListener("change", (e) => {
  state.cascadeFrequencyOrder = e.target.checked
    ? "treble-to-bass"
    : "bass-to-treble";
  saveSettings();
});

cascadeFillSelect.addEventListener("change", (e) => {
  state.cascadeFillStyle = e.target.value;
  saveSettings();
});

radialMirroredCheckbox.addEventListener("change", (e) => {
  state.radialMode = e.target.checked ? "mirrored" : "full";
  saveSettings();
});

kaleidoClipCheckbox.addEventListener("change", (e) => {
  state.kaleidoClipEnabled = e.target.checked;
  saveSettings();
});

sensitivitySlider.addEventListener("input", (e) => {
  state.sensitivity = parseFloat(e.target.value);
  updateSliderLabels();
  saveSettings();
});

if (valueHandlingSelect) {
  valueHandlingSelect.addEventListener("change", (e) => {
    state.valueHandling = e.target.value;
    saveSettings();
  });
}

glowSlider.addEventListener("input", (e) => {
  state.glowIntensity = parseFloat(e.target.value);
  updateSliderLabels();
  saveSettings();
});

trailsCheckbox.addEventListener("change", (e) => {
  state.trailsEnabled = e.target.checked;
  updateTrailVisibility();
  if (!state.trailsEnabled) resetTrailHistory();
  saveSettings();
});

trailDurationSlider.addEventListener("input", (e) => {
  state.trailDuration = parseInt(e.target.value, 10);
  updateSliderLabels();
  resetTrailHistory();
  saveSettings();
});

trailFpsSlider.addEventListener("input", (e) => {
  state.trailMaxFps = parseInt(e.target.value, 10);
  updateSliderLabels();
  resetTrailHistory();
  saveSettings();
});

wakeLockCheckbox.addEventListener("change", (e) => {
  state.wakeLockEnabled = e.target.checked;
  if (state.wakeLockEnabled) requestWakeLock();
  else releaseWakeLock();
  saveSettings();
});

function updateTrailVisibility() {
  const display = state.trailsEnabled ? "" : "none";
  trailDurationRow.style.display = display;
  trailFpsRow.style.display = display;
}

bgTypeSelect.addEventListener("change", (e) => {
  state.bgType = e.target.value;
  updateBgRowsVisibility();
  applyBackground();
  saveSettings();
});

bgColorInput.addEventListener("input", (e) => {
  state.bgColor = e.target.value;
  applyBackground();
  saveSettings();
});

bgImageInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    state.bgImageDataUrl = await readImageFile(file);
    state.bgImageName = file.name;
    state.bgType = "image";
    updateBgRowsVisibility();
    applyBackground();
    saveSettings();
  } catch (err) {
    console.warn("Could not use that background image", err);
  }
});

clearBgImageBtn.addEventListener("click", () => {
  state.bgImageDataUrl = null;
  state.bgImageName = null;
  state.bgType = "color";
  bgImageInput.value = "";
  updateBgRowsVisibility();
  applyBackground();
  saveSettings();
});

brightnessSlider.addEventListener("input", (e) => {
  state.bgBrightness = parseFloat(e.target.value);
  updateSliderLabels();
  applyBackground();
  saveSettings();
});

blurSlider.addEventListener("input", (e) => {
  state.bgBlur = parseFloat(e.target.value);
  updateSliderLabels();
  applyBackground();
  saveSettings();
});

reactiveVignetteCheckbox.addEventListener("change", (e) => {
  state.reactiveVignette = e.target.checked;
  applyFxOverlay();
  saveSettings();
});

crtFilterCheckbox.addEventListener("change", (e) => {
  state.crtFilter = e.target.checked;
  applyFxOverlay();
  saveSettings();
});

beatFlashCheckbox.addEventListener("change", (e) => {
  state.beatFlash = e.target.checked;
  applyFxOverlay();
  saveSettings();
});

function wireParticleSlider(slider, key) {
  slider.addEventListener("input", (e) => {
    state[key] = parseFloat(e.target.value);
    updateSliderLabels();
    saveSettings();
  });
}

wireParticleSlider(particleDensitySlider, "particleDensity");

particleStyleSelect.addEventListener("change", (e) => {
  state.particleStyle = e.target.value;
  saveSettings();
});

mediaMetadataCheckbox.addEventListener("change", (e) => {
  setMediaMetadataEnabled(e.target.checked);
});

mediaDisplaySelect.addEventListener("change", (e) => {
  state.mediaDisplay = e.target.value;
  updateMediaLayout();
  mediaTextPositionRow.hidden =
    !state.mediaMetadataEnabled ||
    !["title", "title-artist", "cover-title", "cover-title-artist"].includes(
      state.mediaDisplay
    );
  saveSettings();
});

mediaTextPositionSelect.addEventListener("change", (e) => {
  state.mediaTextPosition = e.target.value;
  updateMediaLayout();
  saveSettings();
});

// Initialize settings from localStorage into UI and state
loadSettings();
if (state.mediaMetadataEnabled && window.electronAPI?.setMediaMetadataEnabled) {
  window.electronAPI.setMediaMetadataEnabled(true);
}
applyThemeUiColors();
restartUiAccentAnimation();
updateTrailVisibility();

// ---------- input & hud ----------
let hudTimeout;
let hudActive = false;
// Whether the pointer currently rests over one of the elements that would
// otherwise auto-hide (hud/settingsBtn/settingsPanel). While true, the
// hide countdown is suspended entirely — resting the mouse on a slider or
// dropdown doesn't fire "mousemove" continuously, so without this the UI
// could fade out from under the cursor mid-interaction.
let hoveringPersistentUI = false;

// The gear button and the settings panel (when open) both ride along
// with #hud's show-on-activity/fade-on-idle cycle — see
// updatePanelVisibility above, which reads hudActive too.
function flashHud() {
  hudActive = true;
  settingsBtn.classList.add("visible");
  updatePanelVisibility();
  clearTimeout(hudTimeout);
  if (hoveringPersistentUI) return; // don't schedule a hide while the pointer is resting on the UI
  hudTimeout = setTimeout(() => {
    hudActive = false;
    settingsBtn.classList.remove("visible");
    updatePanelVisibility();
  }, 2500);
}
window.addEventListener("mousemove", flashHud);

// Pause the auto-hide countdown while hovering the HUD, gear button, or
// open settings panel, and resume a fresh countdown on mouse-leave.
[settingsBtn, settingsPanel].forEach((el) => {
  el.addEventListener("mouseenter", () => {
    hoveringPersistentUI = true;
    flashHud();
  });
  el.addEventListener("mouseleave", () => {
    hoveringPersistentUI = false;
    flashHud();
  });
});

// ---------- hotkeys modal ----------
function openHotkeys() {
  hotkeysOverlay.classList.add("visible");
}
function closeHotkeys() {
  hotkeysOverlay.classList.remove("visible");
}

hotkeysBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  openHotkeys();
});
hotkeysCloseBtn.addEventListener("click", closeHotkeys);
hotkeysOverlay.addEventListener("click", (e) => {
  if (e.target === hotkeysOverlay) closeHotkeys();
});

const KEY_ACTIONS = {
  c: () => {
    state.theme = (state.theme + 1) % THEMES.length;
    applyThemeUiColors();
    restartUiAccentAnimation();
    syncSelectsToState();
    saveSettings();
  },
  f: () => window.electronAPI.toggleFullscreen(),
  t: () => window.electronAPI.toggleAlwaysOnTop(),
  s: () => {
    panelOpen = !panelOpen;
    updatePanelVisibility();
  },
  " ": () => {
    setAutoCycle(!state.autoCycle);
    saveSettings();
  },
  escape: () => window.electronAPI.quit(),
};

window.addEventListener("keydown", (e) => {
  // Let Escape close the hotkeys modal first before potentially quitting.
  if (e.key === "Escape" && hotkeysOverlay.classList.contains("visible")) {
    closeHotkeys();
    return;
  }
  flashHud();
  if (e.key >= "1" && e.key <= String(MODES.length)) {
    state.mode = parseInt(e.key, 10) - 1;
    syncSelectsToState();
    if (typeof refreshMediaForMode === "function") refreshMediaForMode();
    saveSettings();
    return;
  }
  const action = KEY_ACTIONS[e.key.toLowerCase()];
  if (action) action();
});

// ---------- start ----------
startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";
  errorMsg.style.display = "none";
  try {
    await initAudio();
    requestWakeLock();
    startOverlay.style.display = "none";
    flashHud();
    loop();
  } catch (err) {
    console.error(err);
    errorMsg.textContent =
      "Could not start: " +
      err.message +
      " — make sure audio is playing and try again.";
    errorMsg.style.display = "block";
    startBtn.disabled = false;
    startBtn.textContent = "▶ START";
  }
});
