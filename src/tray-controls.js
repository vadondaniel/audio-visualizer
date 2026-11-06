// Typed renderer boundary; no legacy capture globals are available here.
/** @typedef {{setTraySettings:(value:import('./tray-controller').TraySettings)=>void,onTraySelect:(callback:(selection:import('./tray-controller').Selection)=>void)=>()=>void}} TrayNativeApi */
/** @typedef {{state:import('./settings-actions').SettingsState,registry:import('./visual-contracts').Registry,modeList:typeof import('./mode-list'),themeIds:readonly string[],settingsActions:ReturnType<typeof import('./settings-actions').create>,isActive:()=>boolean,api:TrayNativeApi}} Dependencies */
/** @typedef {{start:()=>void,dispose:()=>void,sync:()=>void}} Adapter */

/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TrayControls = api;
})(globalThis, function () {
  /** @param {Dependencies} dependencies @returns {Adapter} */
  function create({
    state,
    registry,
    modeList,
    themeIds,
    settingsActions,
    isActive,
    api,
  }) {
    let started = false,
      disposed = false;
    /** @type {(()=>void)|undefined} */
    let unsubscribe;
    function sync() {
      if (!started || disposed) return;
      api.setTraySettings({
        modes: modeList
          .enabled(state.modeOrder, state.disabledModes)
          .map((id) => {
            const entry = registry.get(id);
            if (!entry) throw Error(`Unknown visual mode: ${id}`);
            return { id, label: entry.label };
          }),
        themes: modeList
          .enabled(state.themeOrder, state.disabledThemes)
          .map((id) => ({
            id,
            label: id,
          })),
        mode:
          isActive() && state.miniOverlayMode !== "follow"
            ? state.miniOverlayMode
            : registry.ids[state.mode],
        theme: themeIds[state.theme],
      });
    }

    return {
      sync,
      start() {
        if (started || disposed) return;
        started = true;
        unsubscribe = api.onTraySelect(({ kind, id }) => {
          if (disposed) return;
          if (kind === "mode") settingsActions.selectActiveMode(id, isActive());
          else if (
            kind === "theme" &&
            modeList
              .enabled(state.themeOrder, state.disabledThemes)
              .includes(id)
          )
            settingsActions.set("theme", themeIds.indexOf(id));
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribe?.();
      },
    };
  }
  return { create };
});
