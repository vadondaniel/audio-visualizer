// Typed renderer boundary; no legacy capture globals are available here.
/** @typedef {import('./settings-actions').SettingsState} UISettingsState */
/** @typedef {{key:keyof UISettingsState,sync:(state:UISettingsState)=>void}} Binding */
/** @typedef {readonly Binding[]} Bindings */
/** @typedef {{body:HTMLElement,scaleLabel:HTMLElement,opacityLabel:HTMLElement}} Elements */
/** @typedef {{state:UISettingsState,elements:Elements,bindings:Bindings,resetDrawDeadline:()=>void,effects:Omit<import('./settings-actions').Effects,'syncControls'>}} Dependencies */
/** @typedef {{start:()=>void,dispose:()=>void,sync:(keys:import('./settings-actions').ChangedKeys|'all')=>void,effects:import('./settings-actions').Effects}} Adapter */

/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SettingsUI = api;
})(globalThis, function () {
  /** @template {keyof UISettingsState} K
   * @param {K} key @param {HTMLInputElement|HTMLSelectElement} element
   * @param {(value:UISettingsState[K])=>string} convert @returns {Binding} */
  function valueBinding(key, element, convert) {
    return {
      key,
      sync(state) {
        element.value = convert(state[key]);
      },
    };
  }
  /** @template {keyof UISettingsState} K
   * @param {K} key @param {HTMLInputElement} element
   * @param {(value:UISettingsState[K])=>boolean} convert @returns {Binding} */
  function checkboxBinding(key, element, convert) {
    return {
      key,
      sync(state) {
        element.checked = convert(state[key]);
      },
    };
  }
  /** @param {Dependencies} dependencies @returns {Adapter} */
  function create({
    state,
    elements,
    bindings: settingsControlBindings,
    resetDrawDeadline,
    effects,
  }) {
    let started = false,
      disposed = false;
    /** @param {import('./settings-actions').ChangedKeys|'all'} keys */
    function syncSettingsControls(keys) {
      elements.body.classList.toggle(
        "overlay-with-background",
        state.miniOverlayShowBackground
      );
      if (keys === "all" || keys.some((key) => key.startsWith("miniOverlay"))) {
        elements.body.style.setProperty(
          "--mini-overlay-scale",
          String(state.miniOverlayScale)
        );
        elements.body.style.setProperty(
          "--mini-overlay-opacity",
          String(state.miniOverlayOpacity)
        );
        elements.scaleLabel.textContent = `${Math.round(state.miniOverlayScale * 100)}%`;
        elements.opacityLabel.textContent = `${Math.round(state.miniOverlayOpacity * 100)}%`;
        if (keys === "all" || keys.includes("miniOverlayMaxFps"))
          resetDrawDeadline();
      }
      for (const binding of settingsControlBindings) {
        if (keys === "all" || keys.includes(binding.key)) binding.sync(state);
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
  return { create, valueBinding, checkboxBinding };
});
