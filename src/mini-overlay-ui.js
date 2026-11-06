// Typed renderer boundary; no legacy capture globals are available here.
/** @typedef {{body:HTMLElement,entry:HTMLButtonElement,controls:HTMLElement,grip:HTMLElement,lock:HTMLButtonElement,size:HTMLElement,settings:HTMLButtonElement,returnButton:HTMLButtonElement,background:HTMLInputElement,mode:HTMLSelectElement,scale:HTMLInputElement,opacity:HTMLInputElement,fps:HTMLSelectElement}} Elements */
/** @typedef {{x:number,y:number,bounds:import('./mini-overlay').Bounds|null}} Gesture */
/** @typedef {number} TimerHandle Browser window timer, not a Node timeout. */
/** @typedef {{setTimeout:(callback:()=>void,delay:number)=>TimerHandle,clearTimeout:(id:TimerHandle|undefined)=>void}} Timers */
/** @typedef {import('./mini-overlay').Presentation} OverlayPresentation */
/** @typedef {{miniOverlaySupported:boolean,openSettingsWindow:()=>Promise<void>,onMiniOverlayState:(callback:(state:OverlayPresentation)=>void)=>()=>void,getMiniOverlayState:()=>Promise<OverlayPresentation>,enterMiniOverlay:()=>Promise<OverlayPresentation>,restoreNormalWindow:(settings?:boolean)=>Promise<OverlayPresentation>,lockMiniOverlay:()=>Promise<OverlayPresentation>,getMiniOverlayBounds:()=>Promise<import('./mini-overlay').Bounds|null>,setMiniOverlayBounds:(bounds:import('./mini-overlay').BoundsRequest)=>void}} OverlayNativeApi */
/** @typedef {{start:()=>void,dispose:()=>void,isActive:()=>boolean,openSettings:()=>Promise<void>,initialize:()=>Promise<void>,enter:()=>Promise<void>,restore:(settings?:boolean)=>Promise<void>,lock:()=>Promise<void>}} Adapter */
/** @typedef {{window:Window,elements:Elements,api:OverlayNativeApi,actions:ReturnType<typeof import('./settings-actions').create>,timers:Timers,snapSize:typeof import('./mini-overlay-math').snapSize,canCapture:()=>boolean,resetDrawDeadline:()=>void,showStart:()=>void,closePanels:()=>void,openSettings:()=>void,reportError:(message:string)=>void,onPresentationChange:()=>void}} Dependencies */

/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MiniOverlayUI = api;
})(globalThis, function () {
  /** @param {Dependencies} dependencies
   * @returns {Adapter} */
  function create({
    window,
    elements,
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
      disposed = false;
    /** @type {(()=>void)|undefined} */
    let unsubscribe;
    /** @type {Array<()=>void>} */
    const cleanup = [];
    /** @type {Array<()=>void>} */
    const gestures = [];
    /** @template {keyof HTMLElementEventMap} K
     * @param {HTMLElement} target @param {K} name @param {(event:HTMLElementEventMap[K])=>void} callback */
    function listen(target, name, callback) {
      target.addEventListener(name, callback);
      cleanup.push(() => target.removeEventListener(name, callback));
    }
    /** @template {keyof WindowEventMap} K
     * @param {K} name @param {(event:WindowEventMap[K])=>void} callback */
    function listenWindow(name, callback) {
      window.addEventListener(name, callback);
      cleanup.push(() => window.removeEventListener(name, callback));
    }
    const { entry, controls, grip, lock, size } = elements;
    let resizing = false;
    function updateSize() {
      if (resizing)
        size.textContent = `${window.innerWidth} × ${window.innerHeight} px`;
    }
    /** @param {boolean} enabled */
    function showSize(enabled) {
      resizing = enabled;
      size.hidden = !enabled;
      elements.body.classList.toggle("overlay-resizing", enabled);
      updateSize();
    }

    let locked = false;
    /** @type {TimerHandle|undefined} */
    let idleTimer;
    function showControls() {
      if (disposed || !active || locked) return;
      elements.body.classList.add("overlay-controls-visible");
      timers.clearTimeout(idleTimer);
      idleTimer = timers.setTimeout(
        () => elements.body.classList.remove("overlay-controls-visible"),
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
      elements.body.classList.toggle("mini-overlay", value.active);
      elements.body.classList.toggle("overlay-locked", value.locked);
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

    /** @param {()=>Promise<OverlayPresentation>} operation */
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
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    /** @param {HTMLElement} element @param {boolean} resizing */
    function drag(element, resizing) {
      /** @type {Gesture|null} */
      let gesture = null;
      /** @type {number|null} */
      let pointerId = null;
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
        if (
          !resizing &&
          event.target instanceof Element &&
          event.target.closest("button, input, select, a")
        )
          return;
        element.setPointerCapture(event.pointerId);
        pointerId = event.pointerId;
        if (resizing) showSize(true);
        /** @type {Gesture} */
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
        api.setMiniOverlayBounds({
          ...(resizing
            ? {
                ...bounds,
                ...(event.shiftKey
                  ? snapSize(bounds.width + dx, bounds.height + dy)
                  : { width: bounds.width + dx, height: bounds.height + dy }),
              }
            : { ...bounds, x: bounds.x + dx, y: bounds.y + dy }),
          operation: resizing ? "resize" : "move",
          snapToEdges: !event.altKey,
        });
      });
      for (const name of /** @type {const} */ ([
        "pointerup",
        "pointercancel",
        "lostpointercapture",
      ]))
        listen(element, name, () => {
          endGesture();
        });
    }

    async function showSettings() {
      if (disposed || !active) return;
      try {
        await api.openSettingsWindow();
      } catch (error) {
        if (!disposed)
          reportError(error instanceof Error ? error.message : String(error));
      }
    }
    function start() {
      if (started || disposed) return;
      started = true;
      listenWindow("resize", updateSize);
      entry.hidden = !api.miniOverlaySupported;
      listen(entry, "click", () => {
        if (!canCapture()) {
          showStart();
          return;
        }
        invoke(() => api.enterMiniOverlay());
      });
      listen(elements.settings, "click", showSettings);
      listen(elements.returnButton, "click", () =>
        invoke(() => api.restoreNormalWindow())
      );
      listen(lock, "click", () => invoke(() => api.lockMiniOverlay()));
      listenWindow("mousemove", showControls);
      listen(controls, "focusin", showControls);

      drag(elements.body, false);
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
      openSettings: showSettings,
      initialize,
      enter: () => invoke(() => api.enterMiniOverlay()),
      restore: (settings = false) =>
        invoke(() => api.restoreNormalWindow(settings)),
      lock: () => invoke(() => api.lockMiniOverlay()),
    };
  }
  return { create };
});
