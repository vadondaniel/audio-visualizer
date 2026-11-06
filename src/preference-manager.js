// Shared modal interaction for ordered, enabled preference lists.
function createPreferenceManager({
  document = globalThis.document,
  modeList = ModeList,
  flashHud = () => {},
  manageModesBtn,
  modeManager,
  modeManagerList,
  ordered,
  disabled,
  modeLabel,
  onChange,
  key,
  kind,
  statusElement,
  closeIds,
  shortcut,
}) {
  const cleanup = [];
  function listen(target, type, fn) {
    target.addEventListener(type, fn);
    cleanup.push(() => target.removeEventListener(type, fn));
  }
  function render() {
    const enabled = modeList.enabled(ordered(), disabled());
    const focused = document.activeElement;
    const focusId = focused?.dataset[key];
    const focusAction = focused?.dataset.action;
    modeManagerList.replaceChildren(
      ...ordered().map((id) => {
        const row = document.createElement("li");
        row.className = "modeManagerRow";
        row.dataset.enabled = String(enabled.includes(id));
        row.dataset[key] = id;
        row.draggable = true;
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "modeDragHandle";
        handle.dataset[key] = id;
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
        checkbox.dataset[key] = id;
        checkbox.dataset.action = "enable";
        if (checkbox.disabled)
          checkbox.title = `Keep at least one ${kind} enabled`;
        const name = document.createElement("span");
        name.textContent = modeLabel(id);
        label.append(checkbox, name);
        const hint = document.createElement("span");
        hint.className = "modeShortcut";
        hint.textContent = shortcut ? shortcut(id, enabled) : "";
        row.append(handle, label, hint);
        return row;
      })
    );
    if (focusId) {
      const controls = [...modeManagerList.querySelectorAll("button, input")];
      const target =
        controls.find(
          (el) =>
            el.dataset[key] === focusId &&
            el.dataset.action === focusAction &&
            !el.disabled
        ) || controls.find((el) => el.dataset[key] === focusId && !el.disabled);
      target?.focus();
    }
  }

  function setOpen(open) {
    manageModesBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      render();
      if (!modeManager.open) modeManager.showModal();
    } else {
      modeManager.close();
      flashHud();
      manageModesBtn.focus();
    }
  }

  listen(manageModesBtn, "click", () => setOpen(true));
  listen(modeManagerList, "change", (e) => {
    const control = e.target.closest('input[data-action="enable"]');
    if (!control) return;
    const id = control.dataset[key];
    const nextDisabled = control.checked
      ? disabled().filter((mode) => mode !== id)
      : [...disabled(), id];
    onChange({ order: ordered(), disabled: nextDisabled });
  });
  // Reorder with the keyboard as well as pointer dragging.
  function move(id, to) {
    const from = ordered().indexOf(id);
    if (from < 0 || to < 0 || to >= ordered().length || from === to) return;
    const order = [...ordered()];
    order.splice(from, 1);
    order.splice(to, 0, id);
    onChange({ order, disabled: disabled() });
    statusElement.textContent = `${modeLabel(id)} moved to position ${to + 1}`;
  }

  listen(modeManagerList, "keydown", (e) => {
    const handle = e.target.closest('[data-action="reorder"]');
    if (!handle || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    move(
      handle.dataset[key],
      ordered().indexOf(handle.dataset[key]) + (e.key === "ArrowUp" ? -1 : 1)
    );
  });

  let draggedMode = null;
  let dragPlacement = null;
  listen(modeManagerList, "dragstart", (e) => {
    const row = e.target.closest(".modeManagerRow");
    if (!row || e.target.closest("input")) {
      e.preventDefault();
      return;
    }
    draggedMode = row.dataset[key];
    dragPlacement = null;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", draggedMode);
    row.dataset.dragging = "true";
  });
  listen(modeManagerList, "dragover", (e) => {
    if (!draggedMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = e.target.closest(".modeManagerRow");
    for (const row of modeManagerList.children) delete row.dataset.drop;
    if (target && target.dataset[key] !== draggedMode) {
      const bounds = target.getBoundingClientRect();
      const after = e.clientY >= bounds.top + bounds.height / 2;
      dragPlacement = { id: target.dataset[key], after };
      target.dataset.drop = after ? "after" : "before";
    } else dragPlacement = null;
    const bounds = modeManagerList.getBoundingClientRect();
    if (e.clientY < bounds.top + 28) modeManagerList.scrollBy(0, -12);
    else if (e.clientY > bounds.bottom - 28) modeManagerList.scrollBy(0, 12);
  });
  listen(modeManagerList, "drop", (e) => {
    if (!draggedMode) return;
    e.preventDefault();
    const id = draggedMode;
    const order = ordered().filter((mode) => mode !== id);
    if (dragPlacement) {
      const to = order.indexOf(dragPlacement.id) + Number(dragPlacement.after);
      order.splice(to, 0, id);
    }
    const nextOrder = dragPlacement ? order : ordered();
    draggedMode = null;
    dragPlacement = null;
    onChange({
      order: nextOrder,
      disabled: disabled(),
    });
    [...modeManagerList.querySelectorAll('[data-action="reorder"]')]
      .find((control) => control.dataset[key] === id)
      ?.focus();
    statusElement.textContent = `${modeLabel(id)} moved to position ${ordered().indexOf(id) + 1}`;
  });
  listen(modeManagerList, "dragend", () => {
    draggedMode = null;
    dragPlacement = null;
    render(); // Cancelled drags restore the saved order.
  });
  for (const id of closeIds)
    listen(document.getElementById(id), "click", () => setOpen(false));
  listen(modeManager, "cancel", (e) => {
    e.preventDefault();
    setOpen(false);
  });
  listen(modeManager, "click", (e) => {
    if (e.target !== modeManager) return;
    const bounds = modeManager.getBoundingClientRect();
    if (
      e.clientX < bounds.left ||
      e.clientX > bounds.right ||
      e.clientY < bounds.top ||
      e.clientY > bounds.bottom
    )
      setOpen(false);
  });

  return {
    render,
    setOpen,
    move,
    dispose() {
      for (const release of cleanup.splice(0)) release();
      draggedMode = null;
      dragPlacement = null;
    },
  };
}
