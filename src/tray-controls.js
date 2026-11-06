// Tray commands use the same actions as controls and shortcuts, including the
// independent overlay selection. Native menus never mutate renderer state.
function syncTraySettings() {
  window.electronAPI?.setTraySettings?.({
    modes: ModeList.enabled(state.modeOrder, state.disabledModes).map((id) => ({
      id,
      label: ModeRegistry.get(id).label,
    })),
    themes: ModeList.enabled(state.themeOrder, state.disabledThemes).map(
      (id) => ({
        id,
        label: id,
      })
    ),
    mode:
      miniOverlayActive && state.miniOverlayMode !== "follow"
        ? state.miniOverlayMode
        : ModeRegistry.ids[state.mode],
    theme: themeIds[state.theme],
  });
}
const removeTrayListener = window.electronAPI?.onTraySelect?.(
  ({ kind, id }) => {
    if (kind === "mode")
      settingsActions.selectActiveMode(id, miniOverlayActive);
    else if (
      kind === "theme" &&
      ModeList.enabled(state.themeOrder, state.disabledThemes).includes(id)
    )
      settingsActions.set("theme", themeIds.indexOf(id));
  }
);
window.addEventListener("unload", () => removeTrayListener?.());
syncTraySettings();
