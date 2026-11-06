const manageThemesBtn = document.getElementById("manageThemesBtn");
const themeManager = document.getElementById("themeManager");
const themeManagerList = document.getElementById("themeManagerList");
const themeIds = THEMES.map((theme) => theme.name);
function rebuildThemeOptions() {
  themeSelect.replaceChildren(
    ...ModeList.enabled(state.themeOrder, state.disabledThemes).map((id) => {
      const option = document.createElement("option");
      option.value = themeIds.indexOf(id);
      option.textContent = id;
      return option;
    })
  );
  themeSelect.value = state.theme;
}
const themeManagerController = createPreferenceManager({
  flashHud: () => flashHud(),
  manageModesBtn: manageThemesBtn,
  modeManager: themeManager,
  modeManagerList: themeManagerList,
  ordered: () => state.themeOrder,
  disabled: () => state.disabledThemes,
  modeLabel: (id) => id,
  onChange: (preferences) => settingsActions.setThemePreferences(preferences),
  key: "theme",
  kind: "theme",
  statusElement: document.getElementById("themeManagerStatus"),
  closeIds: ["closeThemeManagerBtn", "doneThemeManagerBtn"],
});
function renderThemeManager() {
  themeManagerController.render();
}
function setThemeManagerOpen(open) {
  themeManagerController.setOpen(open);
}
