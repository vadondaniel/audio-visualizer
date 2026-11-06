/** @typedef {{setTraySettings:(value:import('./tray-controller').TraySettings)=>void,onTraySelect:(callback:(selection:import('./tray-controller').Selection)=>void)=>()=>void}} NativeApi */
/** @typedef {{state:import('./settings-actions').SettingsState,registry:import('./visual-contracts').Registry,modeList:typeof import('./mode-list'),themeIds:readonly string[],settingsActions:ReturnType<typeof import('./settings-actions').create>,isActive:()=>boolean,api:NativeApi}} Dependencies */

(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TrayControls = api;
})(globalThis, function () {
  /** @param {Dependencies} dependencies */
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
      disposed = false,
      unsubscribe;
    function sync() {
      if (!started || disposed) return;
      api.setTraySettings({
        modes: modeList
          .enabled(state.modeOrder, state.disabledModes)
          .map((id) => ({
            id,
            label: registry.get(id).label,
          })),
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
