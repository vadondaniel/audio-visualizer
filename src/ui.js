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
  if (
    !panelOpen ||
    modeManager.open ||
    themeManager.open ||
    e.composedPath().includes(modeManager) ||
    e.composedPath().includes(themeManager)
  )
    return;
  if (settingsPanel.contains(e.target)) return;
  panelOpen = false;
  updatePanelVisibility();
});

function applyThemeUiColors() {
  SettingsPanel.paintTheme(document, state, THEMES, uiHueShift);
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

function updateTrailVisibility() {
  settingsPanelUi.trailRows();
}

// Settings initialization is owned by renderer-entry.

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
[settingsBtn, settingsPanel, document.getElementById("miniOverlayBtn")].forEach(
  (el) => {
    el.addEventListener("mouseenter", () => {
      hoveringPersistentUI = true;
      flashHud();
    });
    el.addEventListener("mouseleave", () => {
      hoveringPersistentUI = false;
      flashHud();
    });
  }
);

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
  c: () => settingsActions.cycleTheme(),
  f: () => window.electronAPI.toggleFullscreen(),
  t: () => window.electronAPI.toggleAlwaysOnTop(),
  s: () => {
    panelOpen = !panelOpen;
    updatePanelVisibility();
  },
  " ": () => {
    setAutoCycle(!state.autoCycle);
  },
  escape: () => window.electronAPI.quit(),
};

window.addEventListener("keydown", (e) => {
  if (isMiniOverlayActive()) {
    const key = e.key.toLowerCase();
    if (["escape", "s", "f", "t"].includes(key)) {
      e.preventDefault();
      if (key === "escape" || key === "s")
        key === "s" ? overlayUI.openSettings() : restoreNormalPresentation();
      return;
    }
  }
  // Let Escape close the hotkeys modal first before potentially quitting.
  if (e.key === "Escape" && hotkeysOverlay.classList.contains("visible")) {
    closeHotkeys();
    return;
  }
  if (themeManager.open) {
    if (e.key === "Escape") {
      e.preventDefault();
      setThemeManagerOpen(false);
    }
    return;
  }
  if (modeManager.open) {
    if (e.key === "Escape") {
      e.preventDefault();
      setModeManagerOpen(false);
    }
    return;
  }
  // Space and arrow keys belong to the controls while editing the mode list.
  if (
    e.target instanceof Node &&
    (modeManager.contains(e.target) ||
      themeManager.contains(e.target) ||
      ((e.target === manageModesBtn || e.target === manageThemesBtn) &&
        (e.key === " " || e.key === "Enter")))
  )
    return;
  flashHud();
  if (/^[1-9]$/.test(e.key)) {
    const enabledModes = ModeList.enabled(state.modeOrder, state.disabledModes);
    const mode = enabledModes[Number(e.key) - 1];
    if (!mode) return;
    settingsActions.selectActiveMode(mode, isMiniOverlayActive());
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
