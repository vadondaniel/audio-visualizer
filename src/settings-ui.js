/** @typedef {import('./settings-actions').SettingsState} SettingsState */
/** @typedef {Partial<{[K in keyof SettingsState]: readonly [HTMLInputElement|HTMLSelectElement,'value'|'checked',((value:SettingsState[K])=>number|string|boolean)?]}>} Bindings */
/** @typedef {{state:SettingsState,document:Document,bindings:Bindings,resetDrawDeadline:()=>void,effects:Omit<import('./settings-actions').Effects,'syncControls'>}} Dependencies */

(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SettingsUI = api;
})(globalThis, function () {
  /** @param {Dependencies} dependencies */
  function create({
    state,
    document,
    bindings: settingsControlBindings,
    resetDrawDeadline,
    effects,
  }) {
    let started = false,
      disposed = false;
    /** @param {import('./settings-actions').ChangedKeys|'all'} keys */
    function syncSettingsControls(keys) {
      document.body.classList.toggle(
        "overlay-with-background",
        state.miniOverlayShowBackground
      );
      if (keys === "all" || keys.some((key) => key.startsWith("miniOverlay"))) {
        document.body.style.setProperty(
          "--mini-overlay-scale",
          state.miniOverlayScale
        );
        document.body.style.setProperty(
          "--mini-overlay-opacity",
          state.miniOverlayOpacity
        );
        document.getElementById("miniOverlayScaleVal").textContent =
          `${Math.round(state.miniOverlayScale * 100)}%`;
        document.getElementById("miniOverlayOpacityVal").textContent =
          `${Math.round(state.miniOverlayOpacity * 100)}%`;
        if (keys === "all" || keys.includes("miniOverlayMaxFps"))
          resetDrawDeadline();
      }
      for (const key of keys === "all"
        ? Object.keys(settingsControlBindings)
        : keys) {
        const binding = settingsControlBindings[key];
        if (!binding) continue;
        const [element, property, convert] = binding;
        if (element)
          element[property] = convert ? convert(state[key]) : state[key];
      }
    }

    /** @param {import('./settings-actions').ChangedKeys|'all'} keys */
    function sync(keys) {
      if (started && !disposed) syncSettingsControls(keys);
    }
    return {
      start() {
        if (!disposed) started = true;
      },
      sync,
      effects: {
        ...effects,
        syncControls: sync,
      },
      dispose() {
        disposed = true;
        started = false;
      },
    };
  }
  return { create };
});
