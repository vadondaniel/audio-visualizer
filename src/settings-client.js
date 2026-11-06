// Shared UI-only settings boundary.
/** @typedef {{document:Document,modeList:typeof import('./mode-list'),flashHud:()=>void,manageModesBtn:HTMLElement,modeManager:HTMLDialogElement,modeManagerList:HTMLElement,ordered:()=>string[],disabled:()=>string[],modeLabel:(id:string)=>string,onChange:(preferences:{order:string[],disabled:string[]})=>void,key:string,kind:string,statusElement:HTMLElement,closeIds:string[],shortcut?:(id:string,enabled:string[])=>string}} ManagerOptions */
/** @typedef {{document:Document,window:Window,api:import('./settings-protocol').ClientApi,registry:import('./visual-contracts').Registry,themes:readonly import('./visual-contracts').Theme[],modeList:typeof import('./mode-list'),createManager:(options:ManagerOptions)=>{render:()=>void,setOpen:(open:boolean)=>void,dispose:()=>void},cycleSpeed:number}} Dependencies */

/** @template T @param {typeof globalThis} root
 * @param {(panel:typeof import('./settings-panel'),protocol:typeof import('./settings-protocol'),view:typeof import('./settings-view'))=>T} build */
(function (root, build) {
  if (typeof module === "object" && module.exports)
    module.exports = build(
      require("./settings-panel"),
      require("./settings-protocol"),
      require("./settings-view")
    );
  else
    root.SettingsClient = build(
      root.SettingsPanel,
      root.SettingsProtocol,
      root.SettingsView
    );
})(globalThis, function (SettingsPanel, SettingsProtocol, SettingsView) {
  /** UI mirror only: no SettingsActions, localStorage, capture, or native-window authority.
   * @param {Dependencies} dependencies */
  function create({
    document,
    window,
    api,
    registry,
    themes,
    modeList,
    createManager,
    cycleSpeed,
  }) {
    let disposed = false,
      started = false,
      revision = -1,
      effectiveMode = "",
      packaged = true;
    /** @type {import('./settings-actions').SettingsState|null} */ let state =
      null;
    /** @type {ReturnType<typeof import('./settings-panel').create>|null} */ let panel =
      null;
    /** @type {Array<{render:()=>void,setOpen:(open:boolean)=>void,dispose:()=>void}>} */ const managers =
      [];
    /** @type {Array<()=>void>} */ const cleanup = [];
    /** @type {number|undefined} */ let diagnosticTimer, accentFrame;
    let diagnosticBusy = false,
      hue = 0,
      lastHue = 0,
      lastPaint = 0;
    /** @type {import('./settings-protocol').Patch[]} */ let early = [];
    /** @param {string} id */ function element(id) {
      const el = document.getElementById(id);
      if (!el) throw Error(`Missing settings element: ${id}`);
      return el;
    }
    /** @param {string} id */ const select = (id) =>
      /** @type {HTMLSelectElement} */ (element(id));
    /** @param {unknown} error */ function report(error) {
      if (disposed) return;
      const el = element("settingsError");
      el.textContent = error instanceof Error ? error.message : String(error);
      el.hidden = false;
    }
    /** @template {keyof HTMLElementEventMap} K @param {HTMLElement} target @param {K} name @param {(event:HTMLElementEventMap[K])=>void} callback */
    function listen(target, name, callback) {
      target.addEventListener(name, callback);
      cleanup.push(() => target.removeEventListener(name, callback));
    }
    /** @param {import('./settings-protocol').Command} command */ function submit(
      command
    ) {
      if (!disposed)
        void api.dispatch(command).then(() => {
          if (!disposed) {
            const error = element("settingsError");
            error.hidden = true;
            error.textContent = "";
          }
        }, report);
    }
    /** @param {HTMLSelectElement} control @param {readonly string[]} ids @param {(id:string)=>string} value @param {(id:string)=>string} label */
    function options(control, ids, value, label) {
      control.replaceChildren(
        ...ids.map((id) => {
          const option = document.createElement("option");
          option.value = value(id);
          option.textContent = label(id);
          return option;
        })
      );
    }
    function modeLabel(id) {
      const entry = registry.get(id);
      if (!entry) throw Error(`Unknown mode: ${id}`);
      return entry.label;
    }
    /** @param {import('./settings-actions').ChangedKeys|'all'} keys @param {boolean} contextChanged */
    function sync(keys, contextChanged) {
      if (!state || !panel || disposed) return;
      const changed = (key) => keys === "all" || keys.includes(key);
      const modeChoices = changed("modeOrder") || changed("disabledModes");
      const themeChoices = changed("themeOrder") || changed("disabledThemes");
      if (modeChoices) {
        const enabled = modeList.enabled(state.modeOrder, state.disabledModes);
        options(
          select("modeSelect"),
          enabled,
          (id) => String(registry.indexOf(id)),
          modeLabel
        );
        options(
          select("miniOverlayModeSelect"),
          ["follow", ...enabled],
          (id) => id,
          (id) => (id === "follow" ? "Follow normal window" : modeLabel(id))
        );
        const keys = element("modeHotkeyKeys");
        keys.replaceChildren();
        for (const text of enabled.length > 1
          ? ["1", "–", String(Math.min(9, enabled.length))]
          : ["1"]) {
          const k = document.createElement(text === "–" ? "span" : "kbd");
          k.textContent = text;
          keys.append(k);
        }
        if (
          managers[0] &&
          /** @type {HTMLDialogElement} */ (element("modeManager")).open
        )
          managers[0].render();
      }
      if (themeChoices) {
        options(
          select("themeSelect"),
          modeList.enabled(state.themeOrder, state.disabledThemes),
          (id) => String(themes.findIndex((theme) => theme.name === id)),
          (id) => id
        );
        if (
          managers[1] &&
          /** @type {HTMLDialogElement} */ (element("themeManager")).open
        )
          managers[1].render();
      }
      for (const binding of panel.bindings)
        if (keys === "all" || keys.includes(binding.key)) binding.sync(state);
      if (modeChoices || contextChanged || changed("mode"))
        select("modeSelect").value = String(registry.indexOf(effectiveMode));
      if (contextChanged || changed("mode") || changed("theme") || modeChoices)
        panel.rows();
      if (changed("bgType") || changed("bgImageName")) panel.backgroundRows();
      if (changed("trailsEnabled")) panel.trailRows();
      if (changed("bassSensitivityEnabled"))
        element("bassSensitivityAmountRow").hidden =
          !state.bassSensitivityEnabled;
      // Labels are cheap and do not rebuild or move focused controls.
      panel.labels(keys);
      if (changed("miniOverlayScale"))
        element("miniOverlayScaleVal").textContent =
          `${Math.round(state.miniOverlayScale * 100)}%`;
      if (changed("miniOverlayOpacity"))
        element("miniOverlayOpacityVal").textContent =
          `${Math.round(state.miniOverlayOpacity * 100)}%`;
      if (changed("theme"))
        SettingsPanel.paintTheme(document, state, themes, hue);
      if (contextChanged || changed("mediaTextPositions")) {
        const entry = registry.get(effectiveMode);
        if (!entry) throw Error(`Unknown mode: ${effectiveMode}`);
        const labels = {
          auto: "Best fit",
          above: "Above focus",
          below: "Below focus",
          "top-left": "Top left",
          top: "Top",
          "top-right": "Top right",
          right: "Right",
          "bottom-right": "Bottom right",
          bottom: "Bottom",
          "bottom-left": "Bottom left",
          left: "Left",
        };
        const positions =
          entry.media.group === "focus"
            ? ["above", "below"]
            : [
                "auto",
                "top-left",
                "top",
                "top-right",
                "right",
                "bottom-right",
                "bottom",
                "bottom-left",
                "left",
              ];
        options(
          select("mediaTextPositionSelect"),
          positions,
          (id) => id,
          (id) => labels[id]
        );
        select("mediaTextPositionSelect").value =
          state.mediaTextPositions[effectiveMode] ||
          entry.media.defaultPosition;
      }
      if (changed("mediaMetadataEnabled") || changed("mediaDisplay")) {
        element("mediaDisplayRow").hidden = !state.mediaMetadataEnabled;
        element("mediaTextPositionRow").hidden =
          !state.mediaMetadataEnabled || state.mediaDisplay === "cover";
      }
    }
    /** @param {import('./settings-protocol').Patch} patch */
    function receive(patch) {
      if (disposed || !SettingsProtocol.isPatch(patch)) return;
      if (!state) {
        early.push(patch);
        return;
      }
      if (patch.revision <= revision) return;
      revision = patch.revision;
      const contextChanged = effectiveMode !== patch.effectiveMode;
      effectiveMode = patch.effectiveMode;
      Object.assign(state, patch.values);
      sync(
        /** @type {import('./settings-actions').ChangedKeys} */ (
          Object.keys(patch.values)
        ),
        contextChanged
      );
    }
    let diagnosticWork = Promise.resolve();
    /** @param {import('./settings-protocol').DiagnosticOperation} operation */
    async function diagnostics(operation = "snapshot") {
      if (disposed || packaged || (diagnosticBusy && operation === "snapshot"))
        return;
      diagnosticBusy = true;
      try {
        const work = diagnosticWork.then(() => {
          if (disposed) return null;
          return api.diagnostics(operation);
        });
        diagnosticWork = work.then(
          () => undefined,
          () => undefined
        );
        const view = await work;
        if (!view) return;
        if (disposed) return;
        for (const row of view.rows) {
          const el = document.getElementById(row.id);
          if (el) el.textContent = row.text;
        }
        element("recordProfileBtn").textContent = view.profileActive
          ? "Stop recording"
          : "Record profile";
        /** @type {HTMLButtonElement} */ (element("copyProfileBtn")).disabled =
          !view.copyEnabled;
        if (view.clipboard)
          await window.navigator.clipboard.writeText(view.clipboard);
      } catch (error) {
        report(error);
      } finally {
        diagnosticBusy = false;
      }
    }
    function diagnosticVisibility() {
      window.clearInterval(diagnosticTimer);
      diagnosticTimer = undefined;
      if (
        !packaged &&
        !element("diagnosticsSection").classList.contains("collapsed")
      ) {
        void diagnostics();
        diagnosticTimer = window.setInterval(() => void diagnostics(), 500);
      }
    }
    function animate(timestamp) {
      if (disposed || !state) return;
      if (lastHue)
        hue =
          (hue + (Math.min(100, timestamp - lastHue) * cycleSpeed) / 1000) %
          360;
      lastHue = timestamp;
      const theme = themes[state.theme];
      if (
        (theme.colorCycle || (theme.rainbow && theme.cycle)) &&
        timestamp - lastPaint >= 33
      ) {
        SettingsPanel.paintTheme(document, state, themes, hue);
        lastPaint = timestamp;
      }
      accentFrame = window.requestAnimationFrame(animate);
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      window.clearInterval(diagnosticTimer);
      if (accentFrame !== undefined) window.cancelAnimationFrame(accentFrame);
      panel?.dispose();
      for (const manager of managers) manager.dispose();
      for (const release of cleanup.splice(0)) release();
      early = [];
    }
    async function start() {
      if (started || disposed) return;
      started = true;
      try {
        SettingsView.mount(document);
        cleanup.push(api.onPatch(receive));
        const snapshot = await api.getState();
        if (disposed) return;
        if (
          !SettingsProtocol.isPatch(snapshot) ||
          !registry.get(snapshot.effectiveMode)
        )
          throw Error("Invalid initial settings");
        state = snapshot.values;
        revision = snapshot.revision;
        effectiveMode = snapshot.effectiveMode;
        packaged = snapshot.packaged;
        const mountedPanel = SettingsPanel.create({
          document,
          state,
          registry,
          themes,
          currentMode: () => effectiveMode,
          submit,
          reportError: report,
        });
        panel = mountedPanel;
        const current = () => {
          if (!state) throw Error("Settings not initialized");
          return state;
        };
        for (const kind of ["mode", "theme"]) {
          const mode = kind === "mode",
            title = mode ? "Mode" : "Theme";
          managers.push(
            createManager({
              document,
              modeList,
              flashHud: () => {},
              manageModesBtn: element(
                mode ? "manageModesBtn" : "manageThemesBtn"
              ),
              modeManager: /** @type {HTMLDialogElement} */ (
                element(kind + "Manager")
              ),
              modeManagerList: element(kind + "ManagerList"),
              ordered: () =>
                mode ? current().modeOrder : current().themeOrder,
              disabled: () =>
                mode ? current().disabledModes : current().disabledThemes,
              modeLabel: mode ? modeLabel : (id) => id,
              onChange: (preferences) =>
                submit({
                  type: mode ? "mode-preferences" : "theme-preferences",
                  ...preferences,
                }),
              key: kind,
              kind,
              statusElement: element(kind + "ManagerStatus"),
              closeIds: [
                "close" + title + "ManagerBtn",
                "done" + title + "ManagerBtn",
              ],
              shortcut: mode
                ? (id, enabled) => {
                    const i = enabled.indexOf(id) + 1;
                    return i > 0 && i <= 9 ? String(i) : "";
                  }
                : undefined,
            })
          );
        }
        for (const section of document.querySelectorAll(".settingsSection"))
          section.classList.toggle(
            "collapsed",
            section.id !== "miniOverlaySection"
          );
        element("diagnosticsSection").hidden = packaged;
        const closeButton = element("closeSettingsWindowBtn");
        closeButton.hidden = false;
        listen(closeButton, "click", () => api.close());
        listen(element("settingsPanel"), "click", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const title = target.closest(".settingsSectionTitle"),
            section = title?.closest(".settingsSection");
          if (!section) return;
          const collapsed = section.classList.contains("collapsed");
          for (const other of document.querySelectorAll(".settingsSection"))
            other.classList.add("collapsed");
          section.classList.toggle("collapsed", !collapsed);
          diagnosticVisibility();
        });
        const hotkeys = element("hotkeysOverlay");
        listen(element("hotkeysBtn"), "click", () =>
          hotkeys.classList.add("visible")
        );
        listen(element("hotkeysCloseBtn"), "click", () =>
          hotkeys.classList.remove("visible")
        );
        listen(hotkeys, "click", (event) => {
          if (event.target === hotkeys) hotkeys.classList.remove("visible");
        });
        const keydown = (event) => {
          if (event.key !== "Escape") return;
          if (
            managers.some(
              (_, i) =>
                /** @type {HTMLDialogElement} */ (
                  element(i ? "themeManager" : "modeManager")
                ).open
            )
          )
            return;
          event.preventDefault();
          if (hotkeys.classList.contains("visible"))
            hotkeys.classList.remove("visible");
          else api.close();
        };
        window.addEventListener("keydown", keydown);
        cleanup.push(() => window.removeEventListener("keydown", keydown));
        for (const [id, op] of /** @type {const} */ ([
          ["copyDiagnosticsBtn", "report"],
          ["resetDiagnosticsBtn", "reset"],
          ["recordProfileBtn", "profile"],
          ["copyProfileBtn", "copy-profile"],
        ]))
          listen(element(id), "click", () => void diagnostics(op));
        mountedPanel.start();
        sync("all", true);
        for (const patch of early) receive(patch);
        early = [];
        accentFrame = window.requestAnimationFrame(animate);
        window.addEventListener("unload", dispose, { once: true });
        cleanup.push(() => window.removeEventListener("unload", dispose));
        await api.ready();
      } catch (error) {
        report(error);
        dispose();
        throw error;
      }
    }
    return { start, dispose };
  }
  return { create };
});
