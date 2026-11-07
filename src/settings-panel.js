// Shared UI-only settings boundary.
/** @typedef {{document:Document,state:import('./settings-actions').SettingsState,registry:import('./visual-contracts').Registry,themes:readonly import('./visual-contracts').Theme[],currentMode:()=>string,submit:(command:import('./settings-protocol').Command)=>void,reportError:(message:string)=>void}} Dependencies */

/** @template T @param {typeof globalThis} root @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SettingsPanel = api;
})(globalThis, function () {
  function hslToRgb(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;

    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }

    const hueToChannel = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hueToChannel(p, q, h + 1 / 3) * 255),
      Math.round(hueToChannel(p, q, h) * 255),
      Math.round(hueToChannel(p, q, h - 1 / 3) * 255),
    ];
  }

  /** @param {Document} document @param {import('./settings-actions').SettingsState} state @param {readonly import('./visual-contracts').Theme[]} THEMES @param {number} uiHueShift */
  function paintTheme(document, state, THEMES, uiHueShift) {
    const theme = THEMES[state.theme] || THEMES[0];
    const root = document.documentElement;
    let start;
    let end;

    // UI accents are related to the visual theme, but they need to remain
    // usable as interface chrome.  In particular, Black/White get distinct
    // neutral ramps rather than collapsing to the same "readable" gray.
    if (theme.monochrome === "white") {
      start = [255, 255, 255];
      end = [214, 214, 214];
    } else if (theme.monochrome === "black") {
      start = [150, 150, 150];
      end = [88, 88, 88];
    } else if (theme.colorCycle) {
      // Color Cycle represents one hue moving around the wheel, not a
      // miniature rainbow. Keep the UI on that single moving hue with a
      // restrained lightness ramp.
      const hue = ((uiHueShift % 360) + 360) % 360;
      start = hslToRgb(hue, 88, 62);
      end = hslToRgb(hue, 70, 42);
    } else if (theme.rainbow && theme.cycle) {
      // Rainbow Cycle is the full-spectrum variant: two visibly separated
      // points from the rotating spectrum make the distinction from Color
      // Cycle obvious.
      const hue = ((uiHueShift % 360) + 360) % 360;
      start = hslToRgb(hue, 92, 62);
      end = hslToRgb(hue + 210, 92, 62);
    } else if (theme.rainbow) {
      // Static Rainbow gets a representative red -> blue UI ramp rather than
      // the narrow violet segment used by the Violet theme.
      start = hslToRgb(0, 92, 62);
      end = hslToRgb(210, 92, 62);
    } else if (theme.name === "Violet") {
      // Keep Violet unmistakably purple rather than looking like a slice of
      // the full Rainbow palette.
      start = hslToRgb(270, 78, 55);
      end = hslToRgb(300, 70, 74);
    } else if (theme.colorStops?.length) {
      const first = theme.colorStops[0];
      const last = theme.colorStops[theme.colorStops.length - 1];
      start = hslToRgb(first.hue, 88, 62);
      end = hslToRgb(last.hue, 88, 62);
    } else {
      start = hslToRgb(320, 88, 62);
      end = hslToRgb(190, 88, 62);
    }

    const luminance = (rgb) =>
      0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

    // Cycling palettes must not flip the UI foreground between black and white
    // as the moving accent crosses a luminance threshold. That reads as UI
    // flicker rather than part of the color cycle. Keep one stable foreground
    // for the whole cycle.
    let contrast;
    if (theme.colorCycle || (theme.rainbow && theme.cycle)) {
      contrast = [245, 246, 250];
    } else {
      contrast =
        (luminance(start) + luminance(end)) / 2 > 155
          ? [11, 11, 16]
          : [245, 246, 250];
    }

    root.style.setProperty("--accent-rgb", start.join(", "));
    root.style.setProperty("--accent-2-rgb", end.join(", "));
    root.style.setProperty("--accent-contrast-rgb", contrast.join(", "));
  }

  /** @param {Dependencies} dependencies */
  function create({
    document,
    state,
    registry,
    themes: THEMES,
    currentMode,
    submit,
    reportError,
  }) {
    const element = (id) => {
      const el = document.getElementById(id);
      if (!el) throw Error(`Missing settings element: ${id}`);
      return el;
    };
    const input = (id) => /** @type {HTMLInputElement} */ (element(id));
    const select = (id) => /** @type {HTMLSelectElement} */ (element(id));
    const barsAlignmentSelect = select("barsAlignmentSelect");
    const bassSensitivityAmountSlider = input("bassSensitivityAmountSlider");
    const bassSensitivityCheckbox = input("bassSensitivityCheckbox");
    const beatFlashCheckbox = input("beatFlashCheckbox");
    const bgColorInput = input("bgColorInput");
    const bgImageInput = input("bgImageInput");
    const bgTypeSelect = select("bgTypeSelect");
    const blurSlider = input("blurSlider");
    const brightnessSlider = input("brightnessSlider");
    const cascadeFillSelect = select("cascadeFillSelect");
    const cascadeFrequencyCheckbox = input("cascadeFrequencyCheckbox");
    const clearBgImageBtn = element("clearBgImageBtn");
    const colorGradientCheckbox = input("colorGradientCheckbox");
    const crtFilterCheckbox = input("crtFilterCheckbox");
    const glowSlider = input("glowSlider");
    const kaleidoClipCheckbox = input("kaleidoClipCheckbox");
    const mediaDisplaySelect = select("mediaDisplaySelect");
    const mediaMetadataCheckbox = input("mediaMetadataCheckbox");
    const mediaTextPositionSelect = select("mediaTextPositionSelect");
    const modeSelect = select("modeSelect");
    const particleDensitySlider = input("particleDensitySlider");
    const particleStyleSelect = select("particleStyleSelect");
    const radialMirroredCheckbox = input("radialMirroredCheckbox");
    const reactiveVignetteCheckbox = input("reactiveVignetteCheckbox");
    const sensitivitySlider = input("sensitivitySlider");
    const smoothingCheckbox = input("smoothingCheckbox");
    const themeSelect = select("themeSelect");
    const trailDurationRow = element("trailDurationRow");
    const trailDurationSlider = input("trailDurationSlider");
    const trailFpsRow = element("trailFpsRow");
    const trailFpsSlider = input("trailFpsSlider");
    const trailsCheckbox = input("trailsCheckbox");
    const valueHandlingSelect = select("valueHandlingSelect");
    const wakeLockCheckbox = input("wakeLockCheckbox");
    const prismLayoutSelect = select("prismLayoutSelect");
    const prismLayoutRow = element("prismLayoutRow");
    const waveformStyleSelect = select("waveformStyleSelect");
    const barsAlignmentRow = element("barsAlignmentRow");
    const bassSensitivityAmountVal = element("bassSensitivityAmountVal");
    const bassSensitivityRange = element("bassSensitivityRange");
    const bgColorRow = element("bgColorRow");
    const bgImageName = element("bgImageName");
    const bgImageRow = element("bgImageRow");
    const blurRow = element("blurRow");
    const blurVal = element("blurVal");
    const brightnessRow = element("brightnessRow");
    const brightnessVal = element("brightnessVal");
    const cascadeFillRow = element("cascadeFillRow");
    const cascadeFrequencyRow = element("cascadeFrequencyRow");
    const colorGradientRow = element("colorGradientRow");
    const glowVal = element("glowVal");
    const kaleidoClipRow = element("kaleidoClipRow");
    const particleDensityRow = element("particleDensityRow");
    const particleDensityVal = element("particleDensityVal");
    const particleStyleRow = element("particleStyleRow");
    const radialModeRow = element("radialModeRow");
    const sensitivityVal = element("sensitivityVal");
    const smoothingRow = element("smoothingRow");
    const trailDurationVal = element("trailDurationVal");
    const trailFpsVal = element("trailFpsVal");
    const waveformStyleRow = element("waveformStyleRow");
    const SettingsUI =
      typeof module === "object" && module.exports
        ? require("./settings-ui")
        : globalThis.SettingsUI;
    const settingsControlBindings = [
      SettingsUI.valueBinding("mode", modeSelect, (value) => String(value)),
      SettingsUI.valueBinding("theme", themeSelect, (value) => String(value)),
      SettingsUI.valueBinding("bgColor", bgColorInput, (value) =>
        String(value)
      ),
      SettingsUI.valueBinding("bgBrightness", brightnessSlider, (value) =>
        String(value)
      ),
      SettingsUI.valueBinding("bgBlur", blurSlider, (value) => String(value)),
      SettingsUI.checkboxBinding(
        "miniOverlayShowBackground",
        input("miniOverlayBackgroundCheckbox"),
        (value) => value
      ),
      SettingsUI.valueBinding(
        "miniOverlayMode",
        select("miniOverlayModeSelect"),
        (value) => String(value)
      ),
      SettingsUI.valueBinding(
        "miniOverlayScale",
        input("miniOverlayScaleSlider"),
        (value) => String(value * 100)
      ),
      SettingsUI.valueBinding(
        "miniOverlayOpacity",
        input("miniOverlayOpacitySlider"),
        (value) => String(value * 100)
      ),
      SettingsUI.valueBinding(
        "miniOverlayMaxFps",
        select("miniOverlayFpsSelect"),
        (value) => String(value)
      ),
      SettingsUI.checkboxBinding(
        "smoothingEnabled",
        smoothingCheckbox,
        (value) => value
      ),
      SettingsUI.checkboxBinding(
        "radialMode",
        radialMirroredCheckbox,
        (value) => value === "mirrored"
      ),
      SettingsUI.checkboxBinding(
        "kaleidoClipEnabled",
        kaleidoClipCheckbox,
        (value) => value
      ),
      SettingsUI.valueBinding("barsAlignment", barsAlignmentSelect, (value) =>
        String(value)
      ),
      SettingsUI.valueBinding(
        "prismLayout",
        prismLayoutSelect,
        (value) => value
      ),
      SettingsUI.valueBinding("waveformStyle", waveformStyleSelect, (value) =>
        String(value)
      ),
      SettingsUI.checkboxBinding(
        "cascadeFrequencyOrder",
        cascadeFrequencyCheckbox,
        (value) => value === "treble-to-bass"
      ),
      SettingsUI.valueBinding("cascadeFillStyle", cascadeFillSelect, (value) =>
        String(value)
      ),
      SettingsUI.valueBinding("sensitivity", sensitivitySlider, (value) =>
        String(value)
      ),
      SettingsUI.checkboxBinding(
        "bassSensitivityEnabled",
        bassSensitivityCheckbox,
        (value) => value
      ),
      SettingsUI.valueBinding(
        "bassSensitivityAmount",
        bassSensitivityAmountSlider,
        (value) => String(value * 100)
      ),
      SettingsUI.valueBinding("valueHandling", valueHandlingSelect, (value) =>
        String(value)
      ),
      SettingsUI.valueBinding("glowIntensity", glowSlider, (value) =>
        String(value)
      ),
      SettingsUI.checkboxBinding(
        "colorGradientEnabled",
        colorGradientCheckbox,
        (value) => value
      ),
      SettingsUI.checkboxBinding(
        "trailsEnabled",
        trailsCheckbox,
        (value) => value
      ),
      SettingsUI.valueBinding("trailDuration", trailDurationSlider, (value) =>
        String(value)
      ),
      SettingsUI.valueBinding("trailMaxFps", trailFpsSlider, (value) =>
        String(value)
      ),
      SettingsUI.checkboxBinding(
        "wakeLockEnabled",
        wakeLockCheckbox,
        (value) => value
      ),
      SettingsUI.checkboxBinding(
        "reactiveVignette",
        reactiveVignetteCheckbox,
        (value) => value
      ),
      SettingsUI.checkboxBinding(
        "crtFilter",
        crtFilterCheckbox,
        (value) => value
      ),
      SettingsUI.checkboxBinding(
        "beatFlash",
        beatFlashCheckbox,
        (value) => value
      ),
      SettingsUI.valueBinding(
        "particleDensity",
        particleDensitySlider,
        (value) => String(value)
      ),
      SettingsUI.valueBinding("particleStyle", particleStyleSelect, (value) =>
        String(value)
      ),
      SettingsUI.checkboxBinding(
        "mediaMetadataEnabled",
        mediaMetadataCheckbox,
        (value) => value
      ),
      SettingsUI.valueBinding("mediaDisplay", mediaDisplaySelect, (value) =>
        String(value)
      ),
    ];
    let started = false,
      disposed = false;
    /** @type {Array<()=>void>} */ const cleanup = [];
    /** @template {keyof HTMLElementEventMap} K @param {HTMLElement} el @param {K} type @param {(event:HTMLElementEventMap[K])=>void} fn */
    function listen(el, type, fn) {
      el.addEventListener(type, fn);
      cleanup.push(() => el.removeEventListener(type, fn));
    }
    /** @param {File} file @returns {Promise<string>} */
    function readImageFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== "string") {
            reject(Error("Could not read image"));
            return;
          }
          const dataUrl = reader.result,
            image = document.createElement("img");
          image.onload = () => {
            image.onload = image.onerror = null;
            resolve(dataUrl);
          };
          image.onerror = () => {
            image.onload = image.onerror = null;
            reject(Error("Could not decode that image"));
          };
          image.src = dataUrl;
        };
        reader.onerror = () => reject(Error("Could not read image"));
        reader.readAsDataURL(file);
      });
    }
    function updateVisualOptionRows() {
      const mode = currentMode();
      barsAlignmentRow.style.display = mode === "bars" ? "" : "none";
      radialModeRow.style.display = mode === "radial" ? "" : "none";
      prismLayoutRow.style.display = mode === "prism" ? "" : "none";
      waveformStyleRow.style.display = mode === "waveform" ? "" : "none";
      kaleidoClipRow.style.display = mode === "kaleidoscope" ? "" : "none";
      cascadeFrequencyRow.style.display = mode === "cascade" ? "" : "none";
      cascadeFillRow.style.display = mode === "cascade" ? "" : "none";
      const particleMode = mode === "particles";
      particleDensityRow.style.display = particleMode ? "" : "none";
      particleStyleRow.style.display = particleMode ? "" : "none";
      const theme = THEMES[state.theme];
      const gradientAvailable = !theme.rainbow && !theme.alwaysGradient;
      colorGradientRow.style.display = gradientAvailable ? "" : "none";
      colorGradientCheckbox.disabled = !gradientAvailable;
      smoothingRow.style.display =
        mode === "particles" || mode === "waveform" ? "none" : "";
    }

    /** @param {import('./settings-actions').ChangedKeys|'all'} [keys] */
    function updateSliderLabels(keys = "all") {
      const changed = (key) => keys === "all" || keys.includes(key);
      if (changed("bgBrightness"))
        brightnessVal.textContent = `${Math.round(state.bgBrightness * 100)}%`;
      if (changed("bgBlur")) blurVal.textContent = `${state.bgBlur}px`;
      if (changed("sensitivity"))
        sensitivityVal.textContent = `${state.sensitivity.toFixed(1)}x`;
      if (changed("bassSensitivityAmount"))
        bassSensitivityAmountVal.textContent = `${Math.round(state.bassSensitivityAmount * 100)}%`;
      const amount = state.bassSensitivityAmount;
      const formatMultiplier = (value) => `${Number(value.toFixed(2))}×`;
      if (changed("bassSensitivityAmount"))
        bassSensitivityRange.textContent = `No bass: ${formatMultiplier(1 - amount)} · Strong bass: ${formatMultiplier(1 + amount)}`;
      if (changed("glowIntensity"))
        glowVal.textContent = `${Math.round(state.glowIntensity * 100)}%`;
      if (changed("trailDuration"))
        trailDurationVal.textContent = `${state.trailDuration}ms`;
      if (changed("trailMaxFps"))
        trailFpsVal.textContent = `${state.trailMaxFps} FPS`;
      if (changed("particleDensity"))
        particleDensityVal.textContent = `${Math.round(state.particleDensity * 100)}%`;
    }
    function updateBgRowsVisibility() {
      bgTypeSelect.value = state.bgType;
      const isImage = state.bgType === "image";
      const isColor = state.bgType === "color";
      bgColorRow.style.display = isColor ? "" : "none";
      bgImageRow.style.display = isImage ? "" : "none";
      brightnessRow.style.display = isImage ? "" : "none";
      blurRow.style.display = isImage ? "" : "none";
      bgImageName.textContent = state.bgImageName || "none chosen";
    }

    function updateTrailVisibility() {
      const display = state.trailsEnabled ? "" : "none";
      trailDurationRow.style.display = display;
      trailFpsRow.style.display = display;
    }

    /** @template {keyof import('./settings-protocol').Scalars} K
     * @param {K} key @param {HTMLInputElement|HTMLSelectElement} control
     * @param {(value:string,checked:boolean)=>import('./settings-protocol').Scalars[K]} convert */
    function bindValue(key, control, convert) {
      listen(
        control,
        control instanceof HTMLInputElement && control.type === "range"
          ? "input"
          : control.type === "color"
            ? "input"
            : "change",
        () => {
          const value = convert(
            control.value,
            control instanceof HTMLInputElement && control.checked
          );
          // Keep correlation at this generic boundary; each converter is checked against its key.
          submit(
            /** @type {import('./settings-protocol').ScalarCommand} */ ({
              type: "set",
              key,
              value,
            })
          );
        }
      );
    }
    function start() {
      if (started || disposed) return;
      started = true;
      listen(themeSelect, "change", () =>
        submit({ type: "theme", index: Number(themeSelect.value) })
      );
      listen(modeSelect, "change", () =>
        submit({ type: "mode", id: registry.ids[Number(modeSelect.value)] })
      );
      bindValue("colorGradientEnabled", colorGradientCheckbox, (v, c) => c);
      bindValue("smoothingEnabled", smoothingCheckbox, (v, c) => c);
      bindValue(
        "barsAlignment",
        barsAlignmentSelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['barsAlignment']} */ (
            v
          )
      );
      bindValue(
        "prismLayout",
        prismLayoutSelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['prismLayout']} */ (
            v
          )
      );
      bindValue(
        "waveformStyle",
        waveformStyleSelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['waveformStyle']} */ (
            v
          )
      );
      bindValue("cascadeFrequencyOrder", cascadeFrequencyCheckbox, (v, c) =>
        c ? "treble-to-bass" : "bass-to-treble"
      );
      bindValue(
        "cascadeFillStyle",
        cascadeFillSelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['cascadeFillStyle']} */ (
            v
          )
      );
      bindValue("radialMode", radialMirroredCheckbox, (v, c) =>
        c ? "mirrored" : "full"
      );
      bindValue("kaleidoClipEnabled", kaleidoClipCheckbox, (v, c) => c);
      bindValue("sensitivity", sensitivitySlider, (v) => Number(v));
      bindValue("bassSensitivityEnabled", bassSensitivityCheckbox, (v, c) => c);
      bindValue(
        "bassSensitivityAmount",
        bassSensitivityAmountSlider,
        (v) => Number(v) / 100
      );
      bindValue(
        "valueHandling",
        valueHandlingSelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['valueHandling']} */ (
            v
          )
      );
      bindValue("glowIntensity", glowSlider, (v) => Number(v));
      bindValue("trailsEnabled", trailsCheckbox, (v, c) => c);
      bindValue("trailDuration", trailDurationSlider, (v) => Number(v));
      bindValue("trailMaxFps", trailFpsSlider, (v) => Number(v));
      bindValue("wakeLockEnabled", wakeLockCheckbox, (v, c) => c);
      bindValue(
        "bgType",
        bgTypeSelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['bgType']} */ (
            v
          )
      );
      bindValue("bgColor", bgColorInput, (v) => v);
      bindValue("bgBrightness", brightnessSlider, (v) => Number(v));
      bindValue("bgBlur", blurSlider, (v) => Number(v));
      bindValue("reactiveVignette", reactiveVignetteCheckbox, (v, c) => c);
      bindValue("crtFilter", crtFilterCheckbox, (v, c) => c);
      bindValue("beatFlash", beatFlashCheckbox, (v, c) => c);
      bindValue("particleDensity", particleDensitySlider, (v) => Number(v));
      bindValue(
        "particleStyle",
        particleStyleSelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['particleStyle']} */ (
            v
          )
      );
      bindValue("mediaMetadataEnabled", mediaMetadataCheckbox, (v, c) => c);
      bindValue(
        "mediaDisplay",
        mediaDisplaySelect,
        (v) =>
          /** @type {import('./settings-actions').SettingsState['mediaDisplay']} */ (
            v
          )
      );
      bindValue(
        "miniOverlayShowBackground",
        input("miniOverlayBackgroundCheckbox"),
        (v, c) => c
      );
      bindValue(
        "miniOverlayScale",
        input("miniOverlayScaleSlider"),
        (v) => Number(v) / 100
      );
      bindValue(
        "miniOverlayOpacity",
        input("miniOverlayOpacitySlider"),
        (v) => Number(v) / 100
      );
      listen(select("miniOverlayModeSelect"), "change", () =>
        submit({
          type: "overlay-mode",
          id: select("miniOverlayModeSelect").value,
        })
      );
      listen(select("miniOverlayFpsSelect"), "change", () => {
        const fps = Number(select("miniOverlayFpsSelect").value);
        if (fps === 0 || fps === 15 || fps === 30 || fps === 60 || fps === 120)
          submit({ type: "set", key: "miniOverlayMaxFps", value: fps });
      });
      listen(mediaTextPositionSelect, "change", () =>
        submit({
          type: "media-position",
          position: /** @type {import('./settings-actions').MediaPosition} */ (
            mediaTextPositionSelect.value
          ),
        })
      );
      listen(clearBgImageBtn, "click", () => {
        bgImageInput.value = "";
        submit({ type: "clear-background" });
      });
      listen(bgImageInput, "change", async () => {
        const file = bgImageInput.files?.[0];
        if (!file) return;
        try {
          const dataUrl = await readImageFile(file);
          if (!disposed)
            submit({ type: "background", dataUrl, name: file.name });
        } catch (error) {
          if (!disposed)
            reportError(error instanceof Error ? error.message : String(error));
        }
      });
    }

    return {
      start,
      bindings: settingsControlBindings,
      rows: updateVisualOptionRows,
      labels: updateSliderLabels,
      backgroundRows: updateBgRowsVisibility,
      trailRows: updateTrailVisibility,
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const release of cleanup.splice(0)) release();
      },
    };
  }
  return { create, paintTheme };
});
