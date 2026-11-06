/** @typedef {import('./mini-overlay').Presentation} Presentation */
/** @typedef {{miniOverlaySupported:boolean,onMiniOverlayState:(callback:(state:Presentation)=>void)=>()=>void,getMiniOverlayState:()=>Promise<Presentation>,enterMiniOverlay:()=>Promise<Presentation>,restoreNormalWindow:(settings?:boolean)=>Promise<Presentation>,lockMiniOverlay:()=>Promise<Presentation>,getMiniOverlayBounds:()=>Promise<import('./mini-overlay').Bounds|null>,setMiniOverlayBounds:(bounds:import('./mini-overlay').BoundsRequest)=>void}} NativeApi */
/** @typedef {{start:()=>void,dispose:()=>void,isActive:()=>boolean,initialize:()=>Promise<void>,enter:()=>Promise<void>,restore:(settings?:boolean)=>Promise<void>,lock:()=>Promise<void>}} Adapter */
/** @typedef {{window:Window,document:Document,api:NativeApi,actions:ReturnType<typeof import('./settings-actions').create>,timers:{setTimeout:(callback:()=>void,delay:number)=>unknown,clearTimeout:(id:unknown)=>void},snapSize:typeof import('./mini-overlay-math').snapSize,canCapture:()=>boolean,resetDrawDeadline:()=>void,showStart:()=>void,closePanels:()=>void,openSettings:()=>void,reportError:(message:string)=>void,onPresentationChange:()=>void}} Dependencies */

(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MiniOverlayUI = api;
})(globalThis, function () {
  /** @param {Dependencies} dependencies
   * @returns {Adapter} */
  function create({
    window,
    document,
    api,
    actions,
    timers,
    snapSize,
    canCapture,
    resetDrawDeadline,
    showStart,
    closePanels,
    openSettings,
    reportError,
    onPresentationChange,
  }) {
    let active = false,
      started = false,
      disposed = false,
      unsubscribe;
    const cleanup = [];
    const gestures = [];
    function listen(target, name, callback) {
      target.addEventListener(name, callback);
      cleanup.push(() => target.removeEventListener(name, callback));
    }
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

    let locked = false;
    let idleTimer;
    function showControls() {
      if (disposed || !active || locked) return;
      document.body.classList.add("overlay-controls-visible");
      timers.clearTimeout(idleTimer);
      idleTimer = timers.setTimeout(
        () => document.body.classList.remove("overlay-controls-visible"),
        2000
      );
    }
    /** @param {import('./mini-overlay').Presentation} value */
    function receive(value) {
      if (disposed || !started || !value) return;
      if (active !== value.active) resetDrawDeadline();
      active = value.active;
      onPresentationChange();
      locked = value.locked;
      if (!value.active || value.locked) {
        for (const end of gestures) end();
        showSize(false);
      }
      document.body.classList.toggle("mini-overlay", value.active);
      document.body.classList.toggle("overlay-locked", value.locked);
      controls.hidden = grip.hidden = !value.active || value.locked;
      lock.disabled = !value.canLock;
      lock.title = value.canLock
        ? "Lock overlay"
        : "Lock unavailable: tray icon could not be created";
      if (value.active) {
        closePanels();
        showControls();
      }
      if (value.openSettings) openSettings();
      if (value.error) reportError(value.error);
    }

    async function invoke(operation) {
      if (disposed) return;
      try {
        receive(await operation());
      } catch (error) {
        if (disposed) return;
        await api.restoreNormalWindow().catch(() => {});
        receive({
          active: false,
          locked: false,
          canLock: false,
          openSettings: false,
          error: error.message,
        });
      }
    }
    function drag(element, resizing) {
      let gesture = null,
        pointerId = null;
      const endGesture = () => {
        gesture = null;
        const id = pointerId;
        pointerId = null;
        if (id !== null && element.hasPointerCapture(id))
          element.releasePointerCapture(id);
        if (resizing) showSize(false);
      };
      gestures.push(endGesture);
      listen(element, "pointerdown", async (event) => {
        if (disposed || event.button !== 0 || locked || !active) return;
        if (!resizing && event.target.closest("button, input, select, a"))
          return;
        element.setPointerCapture(event.pointerId);
        pointerId = event.pointerId;
        if (resizing) showSize(true);
        const pending = { x: event.screenX, y: event.screenY, bounds: null };
        gesture = pending;
        try {
          const bounds = await api.getMiniOverlayBounds();
          if (!disposed && gesture === pending) pending.bounds = bounds;
        } catch {
          if (!disposed && gesture === pending) endGesture();
        }
      });
      listen(element, "pointermove", (event) => {
        if (!gesture?.bounds) return;
        const dx = event.screenX - gesture.x,
          dy = event.screenY - gesture.y;
        const bounds = gesture.bounds;
        api.setMiniOverlayBounds(
          resizing
            ? {
                ...bounds,
                ...(event.shiftKey
                  ? snapSize(bounds.width + dx, bounds.height + dy)
                  : { width: bounds.width + dx, height: bounds.height + dy }),
              }
            : { ...bounds, x: bounds.x + dx, y: bounds.y + dy }
        );
      });
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
        listen(element, name, () => {
          endGesture();
        });
    }

    function start() {
      if (started || disposed) return;
      started = true;
      listen(window, "resize", updateSize);
      entry.hidden = !api.miniOverlaySupported;
      listen(entry, "click", () => {
        if (!canCapture()) {
          showStart();
          return;
        }
        invoke(() => api.enterMiniOverlay());
      });
      listen(document.getElementById("miniOverlaySettings"), "click", () =>
        invoke(() => api.restoreNormalWindow(true))
      );
      listen(document.getElementById("miniOverlayReturn"), "click", () =>
        invoke(() => api.restoreNormalWindow())
      );
      listen(lock, "click", () => invoke(() => api.lockMiniOverlay()));
      listen(
        document.getElementById("miniOverlayBackgroundCheckbox"),
        "change",
        (event) =>
          actions.set("miniOverlayShowBackground", event.target.checked)
      );
      listen(
        document.getElementById("miniOverlayModeSelect"),
        "change",
        (event) => actions.selectOverlayMode(event.target.value)
      );
      listen(
        document.getElementById("miniOverlayScaleSlider"),
        "input",
        (event) =>
          actions.set("miniOverlayScale", Number(event.target.value) / 100)
      );
      listen(
        document.getElementById("miniOverlayOpacitySlider"),
        "input",
        (event) =>
          actions.set("miniOverlayOpacity", Number(event.target.value) / 100)
      );
      listen(
        document.getElementById("miniOverlayFpsSelect"),
        "change",
        (event) => actions.set("miniOverlayMaxFps", Number(event.target.value))
      );
      listen(window, "mousemove", showControls);
      listen(controls, "focusin", showControls);

      drag(document.body, false);
      drag(grip, true);
      unsubscribe = api.onMiniOverlayState(receive);
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      timers.clearTimeout(idleTimer);
      unsubscribe?.();
      for (const end of gestures) end();
      for (const release of cleanup.splice(0).reverse()) release();
    }
    async function initialize() {
      if (disposed || !started || !api.miniOverlaySupported) return;
      try {
        receive(await api.getMiniOverlayState());
      } catch (error) {
        if (disposed) return;
        await invoke(() => Promise.reject(error));
        throw error;
      }
    }
    return {
      start,
      dispose,
      isActive: () => active,
      initialize,
      enter: () => invoke(() => api.enterMiniOverlay()),
      restore: (settings = false) =>
        invoke(() => api.restoreNormalWindow(settings)),
      lock: () => invoke(() => api.lockMiniOverlay()),
    };
  }
  return { create };
});
