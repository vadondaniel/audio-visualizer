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
  /** Fixed HTML contract; DOM lookup assertions stay at the legacy boundary. */
  const input = (id) =>
    /** @type {HTMLInputElement} */ (document.getElementById(id));
  const select = (id) =>
    /** @type {HTMLSelectElement} */ (document.getElementById(id));
  const element = (id) =>
    /** @type {HTMLElement} */ (document.getElementById(id));
  const button = (id) =>
    /** @type {HTMLButtonElement} */ (document.getElementById(id));
  const settingsControlBindings = [
    SettingsUI.valueBinding("mode", modeSelect, (value) => String(value)),
    SettingsUI.valueBinding("theme", themeSelect, (value) => String(value)),
    SettingsUI.valueBinding("bgColor", bgColorInput, (value) => String(value)),
    SettingsUI.valueBinding("bgBrightness", brightnessSlider, (value) =>
      String(value)
    ),
    SettingsUI.valueBinding("bgBlur", blurSlider, (value) => String(value)),
    SettingsUI.checkboxBinding(
      "miniOverlayShowBackground",
      input("miniOverlayBackgroundCheckbox"),
      (value) => value
    ),
    SettingsUI.valueBinding(
      "miniOverlayMode",
      select("miniOverlayModeSelect"),
      (value) => String(value)
    ),
    SettingsUI.valueBinding(
      "miniOverlayScale",
      input("miniOverlayScaleSlider"),
      (value) => String(value * 100)
    ),
    SettingsUI.valueBinding(
      "miniOverlayOpacity",
      input("miniOverlayOpacitySlider"),
      (value) => String(value * 100)
    ),
    SettingsUI.valueBinding(
      "miniOverlayMaxFps",
      select("miniOverlayFpsSelect"),
      (value) => String(value)
    ),
    SettingsUI.checkboxBinding(
      "smoothingEnabled",
      smoothingCheckbox,
      (value) => value
    ),
    SettingsUI.checkboxBinding(
      "radialMode",
      radialMirroredCheckbox,
      (value) => value === "mirrored"
    ),
    SettingsUI.checkboxBinding(
      "kaleidoClipEnabled",
      kaleidoClipCheckbox,
      (value) => value
    ),
    SettingsUI.valueBinding("barsAlignment", barsAlignmentSelect, (value) =>
      String(value)
    ),
    SettingsUI.valueBinding("waveformStyle", waveformStyleSelect, (value) =>
      String(value)
    ),
    SettingsUI.checkboxBinding(
      "cascadeFrequencyOrder",
      cascadeFrequencyCheckbox,
      (value) => value === "treble-to-bass"
    ),
    SettingsUI.valueBinding("cascadeFillStyle", cascadeFillSelect, (value) =>
      String(value)
    ),
    SettingsUI.valueBinding("sensitivity", sensitivitySlider, (value) =>
      String(value)
    ),
    SettingsUI.checkboxBinding(
      "bassSensitivityEnabled",
      bassSensitivityCheckbox,
      (value) => value
    ),
    SettingsUI.valueBinding(
      "bassSensitivityAmount",
      bassSensitivityAmountSlider,
      (value) => String(value * 100)
    ),
    SettingsUI.valueBinding("valueHandling", valueHandlingSelect, (value) =>
      String(value)
    ),
    SettingsUI.valueBinding("glowIntensity", glowSlider, (value) =>
      String(value)
    ),
    SettingsUI.checkboxBinding(
      "colorGradientEnabled",
      colorGradientCheckbox,
      (value) => value
    ),
    SettingsUI.checkboxBinding(
      "trailsEnabled",
      trailsCheckbox,
      (value) => value
    ),
    SettingsUI.valueBinding("trailDuration", trailDurationSlider, (value) =>
      String(value)
    ),
    SettingsUI.valueBinding("trailMaxFps", trailFpsSlider, (value) =>
      String(value)
    ),
    SettingsUI.checkboxBinding(
      "wakeLockEnabled",
      wakeLockCheckbox,
      (value) => value
    ),
    SettingsUI.checkboxBinding(
      "reactiveVignette",
      reactiveVignetteCheckbox,
      (value) => value
    ),
    SettingsUI.checkboxBinding(
      "crtFilter",
      crtFilterCheckbox,
      (value) => value
    ),
    SettingsUI.checkboxBinding(
      "beatFlash",
      beatFlashCheckbox,
      (value) => value
    ),
    SettingsUI.valueBinding("particleDensity", particleDensitySlider, (value) =>
      String(value)
    ),
    SettingsUI.valueBinding("particleStyle", particleStyleSelect, (value) =>
      String(value)
    ),
    SettingsUI.checkboxBinding(
      "mediaMetadataEnabled",
      mediaMetadataCheckbox,
      (value) => value
    ),
    SettingsUI.valueBinding("mediaDisplay", mediaDisplaySelect, (value) =>
      String(value)
    ),
  ];

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
      elements: {
        body: document.body,
        scaleLabel: element("miniOverlayScaleVal"),
        opacityLabel: element("miniOverlayOpacityVal"),
      },
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
    refreshMediaColors: () => syncMediaThemeColors(),
    overlay: {
      window,
      elements: {
        body: document.body,
        entry: button("miniOverlayBtn"),
        controls: element("miniOverlayControls"),
        grip: element("miniOverlayResize"),
        lock: button("miniOverlayLock"),
        size: element("miniOverlaySize"),
        settings: button("miniOverlaySettings"),
        returnButton: button("miniOverlayReturn"),
        background: input("miniOverlayBackgroundCheckbox"),
        mode: select("miniOverlayModeSelect"),
        scale: input("miniOverlayScaleSlider"),
        opacity: input("miniOverlayOpacitySlider"),
        fps: select("miniOverlayFpsSelect"),
      },
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
