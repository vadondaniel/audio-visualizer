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

settingsBtn.addEventListener("click", (e) => {
  panelOpen = !panelOpen;
  flashHud();
  updatePanelVisibility();
  e.stopPropagation(); // don't let the same click immediately close it below
});

// Click-outside-to-dismiss: only cares about closing, never opening —
// opening is settingsBtn/"B"'s job above.
window.addEventListener("click", (e) => {
  if (!panelOpen) return;
  if (settingsPanel.contains(e.target)) return;
  panelOpen = false;
  updatePanelVisibility();
});

modeSelect.addEventListener("change", (e) => {
  state.mode = parseInt(e.target.value, 10);
  updateVisualOptionRows();
  saveSettings();
});

themeSelect.addEventListener("change", (e) => {
  state.theme = parseInt(e.target.value, 10);
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

glowSlider.addEventListener("input", (e) => {
  state.glowIntensity = parseFloat(e.target.value);
  updateSliderLabels();
  saveSettings();
});

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

// Initialize settings from localStorage into UI and state
loadSettings();

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
    syncSelectsToState();
    saveSettings();
  },
  f: () => window.electronAPI.toggleFullscreen(),
  t: () => window.electronAPI.toggleAlwaysOnTop(),
  b: () => {
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
