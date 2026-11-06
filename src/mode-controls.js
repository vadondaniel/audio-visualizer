const manageModesBtn = document.getElementById("manageModesBtn");
const modeManager = document.getElementById("modeManager");
const modeManagerList = document.getElementById("modeManagerList");

function modeLabel(id) {
  return ModeRegistry.get(id).label;
}

function rebuildModeOptions() {
  const enabled = ModeList.enabled(state.modeOrder, state.disabledModes);
  modeSelect.replaceChildren(
    ...enabled.map((id) => {
      const option = document.createElement("option");
      option.value = MODES.indexOf(id);
      option.textContent = modeLabel(id);
      return option;
    })
  );
  modeSelect.value = state.mode;
  const keys = document.getElementById("modeHotkeyKeys");
  const first = document.createElement("kbd");
  first.textContent = "1";
  keys.replaceChildren(first);
  if (enabled.length > 1) {
    const last = document.createElement("kbd");
    last.textContent = String(Math.min(9, enabled.length));
    keys.append("–", last);
  }
}

const modeManagerController = createPreferenceManager({
  flashHud: () => flashHud(),
  manageModesBtn,
  modeManager,
  modeManagerList,
  ordered: () => state.modeOrder,
  disabled: () => state.disabledModes,
  modeLabel,
  onChange: (preferences) => settingsActions.setModePreferences(preferences),
  key: "mode",
  kind: "mode",
  statusElement: document.getElementById("modeManagerStatus"),
  closeIds: ["closeModeManagerBtn", "doneModeManagerBtn"],
  shortcut: (id, enabled) => {
    const index = enabled.indexOf(id) + 1;
    return index > 0 && index <= 9 ? String(index) : "";
  },
});
function renderModeManager() {
  modeManagerController.render();
}
function setModeManagerOpen(open) {
  modeManagerController.setOpen(open);
}
function moveMode(id, to) {
  modeManagerController.move(id, to);
}
function applyModePreferences() {
  settingsActions.setModePreferences({
    order: state.modeOrder,
    disabled: state.disabledModes,
  });
}
