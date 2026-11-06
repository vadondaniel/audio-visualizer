// Browser adapter. Actions decide what changed; these callbacks only render it.
const settingsControlBindings = {
  mode: [modeSelect, "value"],
  theme: [themeSelect, "value"],
  bgColor: [bgColorInput, "value"],
  bgBrightness: [brightnessSlider, "value"],
  bgBlur: [blurSlider, "value"],
  miniOverlayShowBackground: [
    document.getElementById("miniOverlayBackgroundCheckbox"),
    "checked",
  ],
  miniOverlayMode: [document.getElementById("miniOverlayModeSelect"), "value"],
  miniOverlayScale: [
    document.getElementById("miniOverlayScaleSlider"),
    "value",
    (value) => value * 100,
  ],
  miniOverlayOpacity: [
    document.getElementById("miniOverlayOpacitySlider"),
    "value",
    (value) => value * 100,
  ],
  miniOverlayMaxFps: [document.getElementById("miniOverlayFpsSelect"), "value"],
  smoothingEnabled: [smoothingCheckbox, "checked"],
  radialMode: [
    radialMirroredCheckbox,
    "checked",
    (value) => value === "mirrored",
  ],
  kaleidoClipEnabled: [kaleidoClipCheckbox, "checked"],
  barsAlignment: [barsAlignmentSelect, "value"],
  waveformStyle: [waveformStyleSelect, "value"],
  cascadeFrequencyOrder: [
    cascadeFrequencyCheckbox,
    "checked",
    (value) => value === "treble-to-bass",
  ],
  cascadeFillStyle: [cascadeFillSelect, "value"],
  sensitivity: [sensitivitySlider, "value"],
  bassSensitivityEnabled: [bassSensitivityCheckbox, "checked"],
  bassSensitivityAmount: [
    bassSensitivityAmountSlider,
    "value",
    (value) => value * 100,
  ],
  valueHandling: [valueHandlingSelect, "value"],
  glowIntensity: [glowSlider, "value"],
  colorGradientEnabled: [colorGradientCheckbox, "checked"],
  trailsEnabled: [trailsCheckbox, "checked"],
  trailDuration: [trailDurationSlider, "value"],
  trailMaxFps: [trailFpsSlider, "value"],
  wakeLockEnabled: [wakeLockCheckbox, "checked"],
  reactiveVignette: [reactiveVignetteCheckbox, "checked"],
  crtFilter: [crtFilterCheckbox, "checked"],
  beatFlash: [beatFlashCheckbox, "checked"],
  particleDensity: [particleDensitySlider, "value"],
  particleStyle: [particleStyleSelect, "value"],
  mediaMetadataEnabled: [mediaMetadataCheckbox, "checked"],
  mediaDisplay: [mediaDisplaySelect, "value"],
};

/** @param {import('./settings-actions').ChangedKeys|'all'} keys */
function syncSettingsControls(keys) {
  document.body.classList.toggle(
    "overlay-with-background",
    state.miniOverlayShowBackground
  );
  if (keys === "all" || keys.some((key) => key.startsWith("miniOverlay"))) {
    document.body.style.setProperty(
      "--mini-overlay-scale",
      state.miniOverlayScale
    );
    document.body.style.setProperty(
      "--mini-overlay-opacity",
      state.miniOverlayOpacity
    );
    document.getElementById("miniOverlayScaleVal").textContent =
      `${Math.round(state.miniOverlayScale * 100)}%`;
    document.getElementById("miniOverlayOpacityVal").textContent =
      `${Math.round(state.miniOverlayOpacity * 100)}%`;
    if (
      (keys === "all" || keys.includes("miniOverlayMaxFps")) &&
      typeof overlayDrawSchedule !== "undefined"
    )
      overlayDrawSchedule.resetDeadline();
  }
  for (const key of keys === "all"
    ? Object.keys(settingsControlBindings)
    : keys) {
    const binding = settingsControlBindings[key];
    if (!binding) continue;
    const [element, property, convert] = binding;
    if (element) element[property] = convert ? convert(state[key]) : state[key];
  }
}

const settingsActions = SettingsActions.create({
  state,
  registry: ModeRegistry,
  modeList: ModeList,
  themeCount: THEMES.length,
  save: saveSettings,
  timers: {
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (id) => window.clearInterval(id),
  },
  effects: {
    syncControls: syncSettingsControls,
    modeOptions: () => {
      rebuildModeOptions();
      const select = document.getElementById("miniOverlayModeSelect");
      select.replaceChildren();
      const follow = document.createElement("option");
      follow.value = "follow";
      follow.textContent = "Follow normal window";
      select.append(follow);
      for (const id of ModeList.enabled(state.modeOrder, state.disabledModes)) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = ModeRegistry.get(id).label;
        select.append(option);
      }
    },
    modeManager: () => {
      if (modeManager.open) renderModeManager();
    },
    visualOptions: updateVisualOptionRows,
    theme: () => {
      applyThemeUiColors();
      restartUiAccentAnimation();
    },
    labels: updateSliderLabels,
    backgroundRows: updateBgRowsVisibility,
    background: applyBackground,
    fx: applyFxOverlay,
    trailRows: () => updateTrailVisibility(),
    bassRows: () => {
      bassSensitivityAmountRow.hidden = !state.bassSensitivityEnabled;
    },
    resetTrails: resetTrailHistory,
    media: applyMediaMetadataUi,
    wakeLock: (enabled) => {
      if (enabled) requestWakeLock();
      else releaseWakeLock();
    },
    mediaWatching: (enabled) =>
      window.electronAPI?.setMediaMetadataEnabled?.(enabled),
    clearImageInput: () => {
      bgImageInput.value = "";
    },
  },
});
window.addEventListener("unload", () => settingsActions.dispose());
