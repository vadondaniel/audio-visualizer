/** @typedef {{state:import('./settings-actions').SettingsState,registry:import('./visual-contracts').Registry,modeList:typeof import('./mode-list'),themeIds:readonly string[],window:Window,nativeApi?:Partial<import('./mini-overlay-ui').NativeApi & import('./tray-controls').NativeApi>,restore:()=>void,save:()=>void,bind:(actions:ReturnType<typeof import('./settings-actions').create>,overlay:import('./mini-overlay-ui').Adapter)=>void,settings:import('./settings-ui').Dependencies,overlay:Omit<import('./mini-overlay-ui').Dependencies,'api'|'actions'|'timers'|'onPresentationChange'>}} Bridge */

(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    const button = document.getElementById("startBtn");
    button.disabled = true;
    root.rendererReady = api
      .initialize(root.ModeRegistry, api.scriptLoader(document), () =>
        api.startAdapters({
          SettingsUI: root.SettingsUI,
          MiniOverlayUI: root.MiniOverlayUI,
          TrayControls: root.TrayControls,
          SettingsActions: root.SettingsActions,
          bridge: createRendererBridge(),
        })
      )
      .then(() => undefined);
    root.rendererReady.then(
      () => {
        button.disabled = false;
      },
      (error) => {
        const message = document.getElementById("errorMsg");
        message.textContent = `Could not initialize visualizer: ${error.message}`;
        message.classList.add("startupError");
        console.error(error);
      }
    );
  }
})(globalThis, function () {
  function scriptLoader(document) {
    return (src) =>
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        const view = document.defaultView;
        const cleanup = () => {
          view.removeEventListener("error", onError);
          script.onload = null;
          script.onerror = null;
        };
        const onError = (event) => {
          if (event.filename === script.src) {
            cleanup();
            reject(Error(event.message));
          }
        };
        view.addEventListener("error", onError);
        script.onload = () => {
          cleanup();
          resolve();
        };
        script.onerror = () => {
          cleanup();
          reject(Error(`Could not load ${src}`));
        };
        document.body.appendChild(script);
      });
  }
  async function initialize(registry, loadScript, start = () => {}) {
    await registry.loadFactories(loadScript);
    for (const path of [
      "renderer-bridge.js",
      "visual-mode-host.js",
      "visuals/loop.js",
      "settings-actions.js",
      "media.js",
      "preference-manager.js",
      "mode-controls.js",
      "theme-controls.js",
      "settings-ui.js",
      "ui.js",
      "mini-overlay-math.js",
      "mini-overlay-ui.js",
      "tray-controls.js",
    ])
      await loadScript(path);
    return start();
  }
  // Optional desktop capabilities are selected once, outside the adapters.
  function nativeCapabilities(api) {
    const noop = () => {};
    const normal = () =>
      Promise.resolve({
        active: false,
        locked: false,
        canLock: false,
        openSettings: false,
        error: null,
      });
    const unavailable = {
      miniOverlaySupported: false,
      onMiniOverlayState: () => noop,
      onTraySelect: () => noop,
      setTraySettings: noop,
      getMiniOverlayState: normal,
      enterMiniOverlay: normal,
      restoreNormalWindow: normal,
      lockMiniOverlay: normal,
      getMiniOverlayBounds: () => Promise.resolve(null),
      setMiniOverlayBounds: noop,
    };
    if (!api) return unavailable;
    if (api.miniOverlaySupported) {
      for (const method of [
        "onMiniOverlayState",
        "getMiniOverlayState",
        "enterMiniOverlay",
        "restoreNormalWindow",
        "lockMiniOverlay",
        "getMiniOverlayBounds",
        "setMiniOverlayBounds",
      ])
        if (typeof api[method] !== "function")
          throw Error(`Missing native capability: ${method}`);
    }
    if (api.setTraySettings || api.onTraySelect) {
      if (
        typeof api.setTraySettings !== "function" ||
        typeof api.onTraySelect !== "function"
      )
        throw Error("Incomplete native tray capability");
    }
    return { ...unavailable, ...api };
  }
  /** Compose all callbacks before starting any subscriptions or effects.
   * @param {{SettingsUI:typeof import('./settings-ui'),MiniOverlayUI:typeof import('./mini-overlay-ui'),TrayControls:typeof import('./tray-controls'),SettingsActions:typeof import('./settings-actions'),bridge:Bridge}} dependencies */
  async function startAdapters({
    SettingsUI,
    MiniOverlayUI,
    TrayControls,
    SettingsActions,
    bridge,
  }) {
    const owned = [];
    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      bridge.window.removeEventListener("unload", dispose);
      for (const instance of owned.reverse()) {
        try {
          instance.dispose();
        } catch (error) {
          console.error("Adapter cleanup failed", error);
        }
      }
    }
    try {
      const api = nativeCapabilities(bridge.nativeApi);
      bridge.restore();
      const settings = SettingsUI.create(bridge.settings);
      owned.push(settings);
      let tray,
        presentationReady = false;
      const syncTray = () => {
        if (presentationReady && !disposed) tray.sync();
      };
      const actions = SettingsActions.create({
        state: bridge.state,
        registry: bridge.registry,
        modeList: bridge.modeList,
        themeIds: bridge.themeIds,
        save: bridge.save,
        timers: {
          setInterval: (fn, delay) => bridge.window.setInterval(fn, delay),
          clearInterval: (id) => bridge.window.clearInterval(id),
        },
        effects: {
          ...settings.effects,
          syncControls(keys) {
            settings.sync(keys);
            if (
              keys === "all" ||
              keys.some((key) =>
                [
                  "mode",
                  "miniOverlayMode",
                  "theme",
                  "modeOrder",
                  "disabledModes",
                  "themeOrder",
                  "disabledThemes",
                ].includes(key)
              )
            )
              syncTray();
          },
        },
      });
      owned.push(actions);
      const overlay = MiniOverlayUI.create({
        ...bridge.overlay,
        api,
        actions,
        timers: {
          setTimeout: (fn, delay) => bridge.window.setTimeout(fn, delay),
          clearTimeout: (id) => bridge.window.clearTimeout(id),
        },
        onPresentationChange: syncTray,
      });
      owned.push(overlay);
      tray = TrayControls.create({
        state: bridge.state,
        registry: bridge.registry,
        modeList: bridge.modeList,
        themeIds: bridge.themeIds,
        settingsActions: actions,
        api,
        isActive: overlay.isActive,
      });
      owned.push(tray);
      bridge.bind(actions, overlay);
      bridge.window.addEventListener("unload", dispose);
      settings.start();
      tray.start();
      overlay.start();
      actions.initialize();
      await overlay.initialize();
      presentationReady = true;
      syncTray();
      return { actions, overlay, settings, tray, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }
  return { initialize, scriptLoader, startAdapters, nativeCapabilities };
});
