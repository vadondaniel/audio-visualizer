// The only adapter bridge to legacy renderer globals. Bootstrap owns instances.
let settingsActions;
let overlayUI;
let settingsOwner;
let settingsPanelUi;
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
  const panel = (settingsPanelUi = SettingsPanel.create({
    document,
    state,
    registry: ModeRegistry,
    themes: THEMES,
    currentMode: () => MODES[state.mode],
    submit: (command) => settingsOwner.dispatch(command),
    reportError: (message) => console.warn(message),
  }));

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
    createSettingsOwner(actions, overlay) {
      settingsOwner = SettingsProtocol.createOwner({
        state,
        keys: PERSISTED_KEYS,
        actions,
        math: AudioMath,
        registry: ModeRegistry,
        themes: themeIds,
        effectiveMode: () =>
          OverlayDisplay.effectiveMode(state, overlay.isActive(), MODES),
        isActive: overlay.isActive,
        packaged: !!window.electronAPI?.isPackaged,
        api: {
          onRequest: (callback) =>
            window.electronAPI?.onSettingsRequest?.(callback) || (() => {}),
          reply: (value) => window.electronAPI?.replySettings?.(value),
          publish: (value) => window.electronAPI?.publishSettings?.(value),
        },
        diagnostics: readSettingsDiagnostics,
      });
      return {
        start() {
          settingsOwner.start();
          panel.start();
        },
        notify: settingsOwner.notify,
        dispose() {
          panel.dispose();
          settingsOwner.dispose();
        },
      };
    },
    settings: {
      state,
      elements: {
        body: document.body,
        scaleLabel: element("miniOverlayScaleVal"),
        opacityLabel: element("miniOverlayOpacityVal"),
      },
      bindings: panel.bindings,
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

/** @param {import('./settings-protocol').DiagnosticOperation} operation @returns {import('./settings-protocol').DiagnosticView} */
function readSettingsDiagnostics(operation) {
  if (!diagnostics) throw Error("Diagnostics unavailable");
  let clipboard = null;
  if (operation === "reset") diagnostics.reset();
  if (operation === "report") clipboard = diagnostics.buildReport();
  if (operation === "profile") {
    if (diagnostics.profileActive()) diagnostics.stopProfile();
    else diagnostics.startProfile();
  }
  if (operation === "copy-profile")
    clipboard = JSON.stringify(diagnostics.buildProfile(), null, 2);
  diagnostics.refresh();
  const rows = [...document.querySelectorAll("#diagnosticsSection [id]")]
    .filter((el) => !el.children.length && el.tagName !== "BUTTON")
    .map((el) => ({ id: el.id, text: el.textContent || "" }));
  return {
    rows,
    profileActive: diagnostics.profileActive(),
    copyEnabled: !document.getElementById("copyProfileBtn")?.disabled,
    clipboard,
  };
}
