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

function renderModeManager() {
  const enabled = ModeList.enabled(state.modeOrder, state.disabledModes);
  const focused = document.activeElement;
  const focusId = focused?.dataset.mode;
  const focusAction = focused?.dataset.action;
  modeManagerList.replaceChildren(
    ...state.modeOrder.map((id) => {
      const row = document.createElement("li");
      row.className = "modeManagerRow";
      row.dataset.enabled = String(enabled.includes(id));
      row.dataset.mode = id;
      row.draggable = true;
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "modeDragHandle";
      handle.dataset.mode = id;
      handle.dataset.action = "reorder";
      handle.setAttribute(
        "aria-label",
        `Reorder ${modeLabel(id)}. Use up and down arrow keys.`
      );
      handle.title = "Drag to reorder, or use arrow keys";
      handle.innerHTML =
        '<svg width="16" height="20" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="5" r="1.3"/><circle cx="11" cy="5" r="1.3"/><circle cx="5" cy="10" r="1.3"/><circle cx="11" cy="10" r="1.3"/><circle cx="5" cy="15" r="1.3"/><circle cx="11" cy="15" r="1.3"/></svg>';
      const label = document.createElement("label");
      label.className = "modeManagerLabel";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = enabled.includes(id);
      checkbox.disabled = enabled.length === 1 && checkbox.checked;
      checkbox.dataset.mode = id;
      checkbox.dataset.action = "enable";
      if (checkbox.disabled) checkbox.title = "Keep at least one mode enabled";
      const name = document.createElement("span");
      name.textContent = modeLabel(id);
      label.append(checkbox, name);
      const key = document.createElement("span");
      key.className = "modeShortcut";
      const shortcut = enabled.indexOf(id) + 1;
      key.textContent = shortcut > 0 && shortcut <= 9 ? String(shortcut) : "";
      row.append(handle, label, key);
      return row;
    })
  );
  if (focusId) {
    const controls = [
      ...modeManagerList.querySelectorAll(
        "button[data-mode], input[data-mode]"
      ),
    ];
    const target =
      controls.find(
        (el) =>
          el.dataset.mode === focusId &&
          el.dataset.action === focusAction &&
          !el.disabled
      ) || controls.find((el) => el.dataset.mode === focusId && !el.disabled);
    target?.focus();
  }
}

function setModeManagerOpen(open) {
  manageModesBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    renderModeManager();
    if (!modeManager.open) modeManager.showModal();
  } else {
    modeManager.close();
    flashHud();
    manageModesBtn.focus();
  }
}

function applyModePreferences() {
  settingsActions.setModePreferences({
    order: state.modeOrder,
    disabled: state.disabledModes,
  });
}

manageModesBtn.addEventListener("click", () => setModeManagerOpen(true));
modeManagerList.addEventListener("change", (e) => {
  const control = e.target.closest('input[data-action="enable"]');
  if (!control) return;
  const id = control.dataset.mode;
  const disabled = control.checked
    ? state.disabledModes.filter((mode) => mode !== id)
    : [...state.disabledModes, id];
  settingsActions.setModePreferences({ order: state.modeOrder, disabled });
});
// Reorder with the keyboard as well as pointer dragging.
function moveMode(id, to) {
  const from = state.modeOrder.indexOf(id);
  if (from < 0 || to < 0 || to >= state.modeOrder.length || from === to) return;
  const order = [...state.modeOrder];
  order.splice(from, 1);
  order.splice(to, 0, id);
  settingsActions.setModePreferences({ order, disabled: state.disabledModes });
  document.getElementById("modeManagerStatus").textContent =
    `${modeLabel(id)} moved to position ${to + 1}`;
}

modeManagerList.addEventListener("keydown", (e) => {
  const handle = e.target.closest('[data-action="reorder"]');
  if (!handle || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  moveMode(
    handle.dataset.mode,
    state.modeOrder.indexOf(handle.dataset.mode) +
      (e.key === "ArrowUp" ? -1 : 1)
  );
});

let draggedMode = null;
let dragPlacement = null;
modeManagerList.addEventListener("dragstart", (e) => {
  const row = e.target.closest(".modeManagerRow");
  if (!row || e.target.closest("input")) {
    e.preventDefault();
    return;
  }
  draggedMode = row.dataset.mode;
  dragPlacement = null;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", draggedMode);
  row.dataset.dragging = "true";
});
modeManagerList.addEventListener("dragover", (e) => {
  if (!draggedMode) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const target = e.target.closest(".modeManagerRow");
  for (const row of modeManagerList.children) delete row.dataset.drop;
  if (target && target.dataset.mode !== draggedMode) {
    const bounds = target.getBoundingClientRect();
    const after = e.clientY >= bounds.top + bounds.height / 2;
    dragPlacement = { id: target.dataset.mode, after };
    target.dataset.drop = after ? "after" : "before";
  } else dragPlacement = null;
  const bounds = modeManagerList.getBoundingClientRect();
  if (e.clientY < bounds.top + 28) modeManagerList.scrollBy(0, -12);
  else if (e.clientY > bounds.bottom - 28) modeManagerList.scrollBy(0, 12);
});
modeManagerList.addEventListener("drop", (e) => {
  if (!draggedMode) return;
  e.preventDefault();
  const id = draggedMode;
  const order = state.modeOrder.filter((mode) => mode !== id);
  if (dragPlacement) {
    const to = order.indexOf(dragPlacement.id) + Number(dragPlacement.after);
    order.splice(to, 0, id);
  }
  const nextOrder = dragPlacement ? order : state.modeOrder;
  draggedMode = null;
  dragPlacement = null;
  settingsActions.setModePreferences({
    order: nextOrder,
    disabled: state.disabledModes,
  });
  modeManagerList
    .querySelector(`[data-action="reorder"][data-mode="${id}"]`)
    ?.focus();
  document.getElementById("modeManagerStatus").textContent =
    `${modeLabel(id)} moved to position ${state.modeOrder.indexOf(id) + 1}`;
});
modeManagerList.addEventListener("dragend", () => {
  draggedMode = null;
  dragPlacement = null;
  renderModeManager(); // Cancelled drags restore the saved order.
});
for (const id of ["closeModeManagerBtn", "doneModeManagerBtn"])
  document
    .getElementById(id)
    .addEventListener("click", () => setModeManagerOpen(false));
modeManager.addEventListener("cancel", (e) => {
  e.preventDefault();
  setModeManagerOpen(false);
});
modeManager.addEventListener("click", (e) => {
  if (e.target !== modeManager) return;
  const bounds = modeManager.getBoundingClientRect();
  if (
    e.clientX < bounds.left ||
    e.clientX > bounds.right ||
    e.clientY < bounds.top ||
    e.clientY > bounds.bottom
  )
    setModeManagerOpen(false);
});
