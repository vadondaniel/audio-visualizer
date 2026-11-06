// Presentation controls do not change capture, mode instances, or visual settings.
let miniOverlayActive = false;
(function () {
  const api = window.electronAPI;
  const entry = document.getElementById("miniOverlayBtn");
  const controls = document.getElementById("miniOverlayControls");
  const grip = document.getElementById("miniOverlayResize");
  const lock = document.getElementById("miniOverlayLock");
  const size = document.getElementById("miniOverlaySize");
  let resizing = false;
  function updateSize() {
    if (resizing)
      size.textContent = `${window.innerWidth} × ${window.innerHeight} px`;
  }
  function showSize(enabled) {
    resizing = enabled;
    size.hidden = !enabled;
    document.body.classList.toggle("overlay-resizing", enabled);
    updateSize();
  }
  window.addEventListener("resize", updateSize);
  let locked = false;
  let idleTimer;
  function showControls() {
    if (!miniOverlayActive || locked) return;
    document.body.classList.add("overlay-controls-visible");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => document.body.classList.remove("overlay-controls-visible"),
      2000
    );
  }
  /** @param {import('./mini-overlay').Presentation} value */
  function receive(value) {
    if (!value) return;
    if (
      miniOverlayActive !== value.active &&
      typeof overlayDrawSchedule !== "undefined"
    )
      overlayDrawSchedule.resetDeadline();
    miniOverlayActive = value.active;
    locked = value.locked;
    if (!value.active || value.locked) showSize(false);
    document.body.classList.toggle("mini-overlay", value.active);
    document.body.classList.toggle("overlay-locked", value.locked);
    controls.hidden = grip.hidden = !value.active || value.locked;
    lock.disabled = !value.canLock;
    lock.title = value.canLock
      ? "Lock overlay"
      : "Lock unavailable: tray icon could not be created";
    if (value.active) {
      panelOpen = false;
      updatePanelVisibility();
      closeHotkeys();
      if (modeManager.open) setModeManagerOpen(false);
      showControls();
    }
    if (value.openSettings) {
      panelOpen = true;
      flashHud();
      for (const section of settingsPanel.querySelectorAll(".settingsSection"))
        section.classList.toggle(
          "collapsed",
          section.id !== "miniOverlaySection"
        );
      document
        .getElementById("miniOverlaySection")
        .scrollIntoView({ block: "nearest" });
      document.getElementById("miniOverlayModeSelect").focus();
    }
    if (value.error) {
      errorMsg.textContent = value.error;
      errorMsg.style.display = "block";
      startOverlay.style.display = "flex";
    }
  }
  async function invoke(operation) {
    try {
      receive(await operation());
    } catch (error) {
      await api?.restoreNormalWindow?.().catch(() => {});
      receive({
        active: false,
        locked: false,
        canLock: false,
        openSettings: false,
        error: error.message,
      });
    }
  }
  entry.hidden = !api?.miniOverlaySupported;
  entry.addEventListener("click", () => {
    if (!analyser || !audioCtx || audioCtx.state !== "running") {
      startOverlay.style.display = "flex";
      startBtn.focus();
      return;
    }
    invoke(() => api.enterMiniOverlay());
  });
  document
    .getElementById("miniOverlaySettings")
    .addEventListener("click", () =>
      invoke(() => api.restoreNormalWindow(true))
    );
  document
    .getElementById("miniOverlayReturn")
    .addEventListener("click", () => invoke(() => api.restoreNormalWindow()));
  lock.addEventListener("click", () => invoke(() => api.lockMiniOverlay()));
  document
    .getElementById("miniOverlayBackgroundCheckbox")
    .addEventListener("change", (event) =>
      settingsActions.set("miniOverlayShowBackground", event.target.checked)
    );
  document
    .getElementById("miniOverlayModeSelect")
    .addEventListener("change", (event) =>
      settingsActions.selectOverlayMode(event.target.value)
    );
  document
    .getElementById("miniOverlayScaleSlider")
    .addEventListener("input", (event) =>
      settingsActions.set("miniOverlayScale", Number(event.target.value) / 100)
    );
  document
    .getElementById("miniOverlayOpacitySlider")
    .addEventListener("input", (event) =>
      settingsActions.set(
        "miniOverlayOpacity",
        Number(event.target.value) / 100
      )
    );
  document
    .getElementById("miniOverlayFpsSelect")
    .addEventListener("change", (event) =>
      settingsActions.set("miniOverlayMaxFps", Number(event.target.value))
    );
  window.addEventListener("mousemove", showControls);
  controls.addEventListener("focusin", showControls);

  function drag(element, resizing) {
    let gesture = null;
    element.addEventListener("pointerdown", async (event) => {
      if (event.button !== 0 || locked || !miniOverlayActive) return;
      if (!resizing && event.target.closest("button, input, select, a")) return;
      element.setPointerCapture(event.pointerId);
      if (resizing) showSize(true);
      const pending = { x: event.screenX, y: event.screenY, bounds: null };
      gesture = pending;
      try {
        pending.bounds = await api.getMiniOverlayBounds();
      } catch {
        gesture = null;
        if (resizing) showSize(false);
      }
    });
    element.addEventListener("pointermove", (event) => {
      if (!gesture?.bounds) return;
      const dx = event.screenX - gesture.x,
        dy = event.screenY - gesture.y;
      const bounds = gesture.bounds;
      api.setMiniOverlayBounds(
        resizing
          ? {
              ...bounds,
              ...(event.shiftKey
                ? MiniOverlayMath.snapSize(
                    bounds.width + dx,
                    bounds.height + dy
                  )
                : { width: bounds.width + dx, height: bounds.height + dy }),
            }
          : { ...bounds, x: bounds.x + dx, y: bounds.y + dy }
      );
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
      element.addEventListener(name, () => {
        gesture = null;
        if (resizing) showSize(false);
      });
  }
  drag(document.body, false);
  drag(grip, true);
  const unsubscribe = api?.onMiniOverlayState?.(receive);
  if (api?.miniOverlaySupported) invoke(() => api.getMiniOverlayState());
  window.addEventListener("unload", () => {
    clearTimeout(idleTimer);
    unsubscribe?.();
  });
})();
