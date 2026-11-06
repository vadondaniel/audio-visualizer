// The only adapter bridge to legacy renderer globals. Bootstrap owns instances.
let settingsActions;
let overlayUI;
function isMiniOverlayActive() {
  return overlayUI ? overlayUI.isActive() : false;
}
function restoreNormalPresentation(openSettings = false) {
  return overlayUI.restore(openSettings);
}
/** @returns {import('./renderer-entry').Bridge} */
function createRendererBridge() {
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
    miniOverlayMode: [
      document.getElementById("miniOverlayModeSelect"),
      "value",
    ],
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
    miniOverlayMaxFps: [
      document.getElementById("miniOverlayFpsSelect"),
      "value",
    ],
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

  return {
    state,
    registry: ModeRegistry,
    modeList: ModeList,
    themeIds,
    window,
    nativeApi: window.electronAPI,
    restore: restoreSettings,
    save: saveSettings,
    bind(actions, overlay) {
      settingsActions = actions;
      overlayUI = overlay;
    },
    settings: {
      state,
      document,
      bindings: settingsControlBindings,
      resetDrawDeadline: () => overlayDrawSchedule.resetDeadline(),
      effects: {
        modeOptions: () => {
          rebuildModeOptions();
          const select = document.getElementById("miniOverlayModeSelect");
          select.replaceChildren();
          const follow = document.createElement("option");
          follow.value = "follow";
          follow.textContent = "Follow normal window";
          select.append(follow);
          for (const id of ModeList.enabled(
            state.modeOrder,
            state.disabledModes
          )) {
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
        themeOptions: rebuildThemeOptions,
        themeManager: () => {
          if (themeManager.open) renderThemeManager();
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
    },
    overlay: {
      window,
      document,
      snapSize: MiniOverlayMath.snapSize,
      canCapture: () =>
        !!analyser && !!audioCtx && audioCtx.state === "running",
      resetDrawDeadline: () => overlayDrawSchedule.resetDeadline(),
      showStart() {
        startOverlay.style.display = "flex";
        startBtn.focus();
      },
      closePanels() {
        panelOpen = false;
        updatePanelVisibility();
        closeHotkeys();
        if (modeManager.open) setModeManagerOpen(false);
        if (themeManager.open) setThemeManagerOpen(false);
      },
      openSettings() {
        panelOpen = true;
        flashHud();
        for (const section of settingsPanel.querySelectorAll(
          ".settingsSection"
        ))
          section.classList.toggle(
            "collapsed",
            section.id !== "miniOverlaySection"
          );
        document
          .getElementById("miniOverlaySection")
          .scrollIntoView({ block: "nearest" });
        document.getElementById("miniOverlayModeSelect").focus();
      },
      reportError(error) {
        errorMsg.textContent = error;
        errorMsg.style.display = "block";
        startOverlay.style.display = "flex";
      },
    },
  };
}
