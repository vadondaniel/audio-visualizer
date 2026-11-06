// Settings commands own mutation and effects; UI adapters own DOM events and rendering.
/** @typedef {'auto'|'above'|'below'|'top-left'|'top'|'top-right'|'right'|'bottom-right'|'bottom'|'bottom-left'|'left'} MediaPosition */
/** @typedef {import('./visual-contracts').AudioSettings & import('./visual-contracts').VisualSettings & {autoCycle:boolean,miniOverlayShowBackground:boolean,miniOverlayScale:number,miniOverlayOpacity:number,miniOverlayMaxFps:0|15|30|60|120,bgType:'color'|'image'|'nebula'|'stars'|'grid',bgColor:string,bgBrightness:number,bgBlur:number,trailsEnabled:boolean,trailDuration:number,trailMaxFps:number,wakeLockEnabled:boolean,reactiveVignette:boolean,crtFilter:boolean,beatFlash:boolean,mediaMetadataEnabled:boolean,mediaDisplay:'title'|'title-artist'|'cover'|'cover-title'|'cover-title-artist'}} ScalarSettings */
/** @typedef {ScalarSettings & {miniOverlayMode:string,mode:number,modeOrder:string[],disabledModes:string[],themeOrder:string[],disabledThemes:string[],mediaTextPositions:Record<string,string>,bgImageDataUrl:string|null,bgImageName:string|null}} SettingsState */
/** @typedef {readonly (keyof SettingsState)[]} ChangedKeys */
/**
 * @typedef {object} Effects
 * @property {(keys:ChangedKeys|'all')=>void} syncControls
 * @property {()=>void} modeOptions
 * @property {()=>void} modeManager
 * @property {()=>void} visualOptions
 * @property {()=>void} theme
 * @property {()=>void} themeOptions
 * @property {()=>void} themeManager
 * @property {()=>void} labels
 * @property {()=>void} backgroundRows
 * @property {()=>void} background
 * @property {()=>void} fx
 * @property {()=>void} trailRows
 * @property {()=>void} bassRows
 * @property {()=>void} resetTrails
 * @property {()=>void} media
 * @property {(enabled:boolean)=>void} wakeLock
 * @property {(enabled:boolean)=>void} mediaWatching
 * @property {()=>void} clearImageInput
 */
/** @typedef {{state:SettingsState,registry:import('./visual-contracts').Registry,modeList:typeof import('./mode-list'),themeIds:readonly string[],save:()=>void,effects:Effects,timers:{setInterval:(callback:()=>void,delay:number)=>unknown,clearInterval:(id:unknown)=>void}}} Dependencies */

(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SettingsActions = api;
})(globalThis, function () {
  /** @type {Readonly<Record<'focus'|'free',readonly MediaPosition[]>>} */
  const MEDIA_POSITIONS = Object.freeze({
    focus: Object.freeze(/** @type {const} */ (["above", "below"])),
    free: Object.freeze(
      /** @type {const} */ ([
        "auto",
        "top-left",
        "top",
        "top-right",
        "right",
        "bottom-right",
        "bottom",
        "bottom-left",
        "left",
      ])
    ),
  });
  const allowedPositions = new Set(Object.values(MEDIA_POSITIONS).flat());

  /** @param {Dependencies} dependencies */
  function create({
    state,
    registry,
    modeList,
    themeIds,
    save,
    effects,
    timers,
  }) {
    /** @type {unknown} */
    let timer = null;
    function dispose() {
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
    }
    function scheduleCycle() {
      dispose();
      if (state.autoCycle) timer = timers.setInterval(nextMode, 12000);
    }
    function normalizeMode() {
      Object.assign(
        state,
        modeList.normalize(registry.ids, state.modeOrder, state.disabledModes)
      );
      const enabled = modeList.enabled(state.modeOrder, state.disabledModes);
      if (!enabled.includes(registry.ids[state.mode]))
        state.mode = registry.indexOf(enabled[0]);
      if (state.miniOverlayMode !== "follow") {
        if (!registry.get(state.miniOverlayMode))
          state.miniOverlayMode = "follow";
        else if (!enabled.includes(state.miniOverlayMode))
          state.miniOverlayMode = enabled[0];
      }
    }
    function normalizeMediaPosition() {
      const entry = registry.get(registry.ids[state.mode]);
      if (!entry) return;
      const current = state.mediaTextPositions[entry.id];
      if (
        !MEDIA_POSITIONS[entry.media.group].some(
          (position) => position === current
        )
      )
        state.mediaTextPositions[entry.id] = entry.media.defaultPosition;
    }
    function normalizeThemes() {
      const normalized = modeList.normalize(
        themeIds,
        state.themeOrder,
        state.disabledThemes
      );
      state.themeOrder = normalized.modeOrder;
      state.disabledThemes = normalized.disabledModes;
      const enabled = modeList.enabled(state.themeOrder, state.disabledThemes);
      if (!enabled.includes(themeIds[state.theme]))
        state.theme = themeIds.indexOf(enabled[0]);
    }
    /** @param {ChangedKeys} keys */
    function finish(keys) {
      /** @param {...(keyof SettingsState)} names */
      const has = (...names) => names.some((name) => keys.includes(name));
      const preferences = has("modeOrder", "disabledModes");
      const themePreferences = has("themeOrder", "disabledThemes");
      const mode = preferences || has("mode");
      const theme = has("theme");
      const media =
        mode ||
        theme ||
        has(
          "colorGradientEnabled",
          "glowIntensity",
          "mediaMetadataEnabled",
          "mediaDisplay",
          "mediaTextPositions"
        );
      if (media) normalizeMediaPosition();
      if (preferences) effects.modeOptions();
      if (themePreferences) effects.themeOptions();
      effects.syncControls(keys);
      if (mode || theme) effects.visualOptions();
      if (theme) effects.theme();
      if (
        has(
          "sensitivity",
          "bassSensitivityAmount",
          "glowIntensity",
          "trailDuration",
          "trailMaxFps",
          "bgBrightness",
          "bgBlur",
          "particleDensity"
        )
      )
        effects.labels();
      if (has("bassSensitivityEnabled")) effects.bassRows();
      if (has("trailsEnabled")) effects.trailRows();
      if (
        has("trailDuration", "trailMaxFps") ||
        (has("trailsEnabled") && !state.trailsEnabled)
      )
        effects.resetTrails();
      if (has("bgType", "bgImageDataUrl", "bgImageName"))
        effects.backgroundRows();
      if (
        has(
          "bgType",
          "bgColor",
          "bgImageDataUrl",
          "bgImageName",
          "bgBrightness",
          "bgBlur"
        )
      )
        effects.background();
      if (has("reactiveVignette", "crtFilter", "beatFlash")) effects.fx();
      if (media) effects.media();
      if (has("wakeLockEnabled")) effects.wakeLock(state.wakeLockEnabled);
      if (has("mediaMetadataEnabled"))
        effects.mediaWatching(state.mediaMetadataEnabled);
      if (has("autoCycle")) scheduleCycle();
      if (preferences) effects.modeManager();
      if (themePreferences) effects.themeManager();
      save();
    }
    /** @template {keyof ScalarSettings} K
     * @param {K} key
     * @param {ScalarSettings[K]} value */
    function set(key, value) {
      /** @type {ScalarSettings} */ (state)[key] = value;
      finish([key]);
    }
    /** @param {string} id */
    function selectMode(id) {
      if (!modeList.enabled(state.modeOrder, state.disabledModes).includes(id))
        return;
      state.mode = registry.indexOf(id);
      finish(["mode"]);
    }
    /** @param {string} id */
    function selectOverlayMode(id) {
      if (
        id !== "follow" &&
        !modeList.enabled(state.modeOrder, state.disabledModes).includes(id)
      )
        return;
      state.miniOverlayMode = id;
      finish(["miniOverlayMode"]);
    }
    /** @param {string} id @param {boolean} overlayActive */
    function selectActiveMode(id, overlayActive) {
      if (overlayActive && state.miniOverlayMode !== "follow")
        selectOverlayMode(id);
      else selectMode(id);
    }
    function nextMode() {
      selectMode(
        modeList.next(
          state.modeOrder,
          state.disabledModes,
          registry.ids[state.mode]
        )
      );
    }
    function cycleTheme() {
      const next = modeList.next(
        state.themeOrder,
        state.disabledThemes,
        themeIds[state.theme]
      );
      set("theme", themeIds.indexOf(next));
    }
    /** @param {{order:readonly string[],disabled:readonly string[]}} preferences */
    function setThemePreferences({ order, disabled }) {
      state.themeOrder = [...order];
      state.disabledThemes = [...disabled];
      normalizeThemes();
      finish(["themeOrder", "disabledThemes", "theme"]);
    }
    /** @param {{order:readonly string[],disabled:readonly string[]}} preferences */
    function setModePreferences({ order, disabled }) {
      state.modeOrder = [...order];
      state.disabledModes = [...disabled];
      normalizeMode();
      finish(["modeOrder", "disabledModes", "mode", "miniOverlayMode"]);
    }
    /** @param {string} id
     * @param {MediaPosition} position */
    function setMediaPosition(id, position) {
      if (!registry.get(id) || !allowedPositions.has(position)) return;
      state.mediaTextPositions[id] = position;
      finish(["mediaTextPositions"]);
    }
    /** @param {{dataUrl:string,name:string}} image */
    function setBackgroundImage({ dataUrl, name }) {
      state.bgImageDataUrl = dataUrl;
      state.bgImageName = name;
      state.bgType = "image";
      finish(["bgImageDataUrl", "bgImageName", "bgType"]);
    }
    function clearBackgroundImage() {
      state.bgImageDataUrl = null;
      state.bgImageName = null;
      state.bgType = "color";
      effects.clearImageInput();
      finish(["bgImageDataUrl", "bgImageName", "bgType"]);
    }
    function initialize() {
      normalizeMode();
      normalizeThemes();
      normalizeMediaPosition();
      effects.modeOptions();
      effects.themeOptions();
      effects.syncControls("all");
      effects.visualOptions();
      effects.labels();
      effects.backgroundRows();
      effects.background();
      effects.fx();
      effects.trailRows();
      effects.bassRows();
      effects.theme();
      effects.media();
      effects.modeManager();
      effects.themeManager();
      scheduleCycle();
      if (state.mediaMetadataEnabled) effects.mediaWatching(true);
    }
    return {
      set,
      selectMode,
      selectOverlayMode,
      selectActiveMode,
      nextMode,
      cycleTheme,
      setModePreferences,
      setThemePreferences,
      setMediaPosition,
      setBackgroundImage,
      clearBackgroundImage,
      initialize,
      dispose,
    };
  }
  return { create, MEDIA_POSITIONS };
});
