// Settings-only messages. Runtime audio, image buffers, and arbitrary calls never cross this boundary.
/** @typedef {import('./settings-actions').SettingsState} State */
/** @typedef {Omit<import('./settings-actions').ScalarSettings,'theme'>} Scalars */
/** @typedef {{[K in keyof Scalars]:{type:'set',key:K,value:Scalars[K]}}[keyof Scalars]} ScalarCommand */
/** @typedef {ScalarCommand|{type:'mode',id:string}|{type:'overlay-mode',id:string}|{type:'theme',index:number}|{type:'mode-preferences'|'theme-preferences',order:readonly string[],disabled:readonly string[]}|{type:'media-position',position:import('./settings-actions').MediaPosition}|{type:'background',dataUrl:string,name:string}|{type:'clear-background'}} Command */
/** @typedef {{revision:number,values:Partial<State>,effectiveMode:string,packaged:boolean}} Patch */
/** @typedef {Patch & {values:State}} Snapshot */
/** @typedef {'snapshot'|'report'|'reset'|'profile'|'copy-profile'} DiagnosticOperation */
/** @typedef {{rows:readonly {id:string,text:string}[],profileActive:boolean,copyEnabled:boolean,clipboard:string|null}} DiagnosticView */
/** @typedef {{id:number,operation:'snapshot'|'command'|'diagnostics',command?:Command,diagnostic?:DiagnosticOperation}} Request */
/** @typedef {{id:number,ok:true,value:Snapshot|{revision:number}|DiagnosticView}|{id:number,ok:false,error:string}} Reply */
/** @typedef {{onRequest:(callback:(request:Request)=>void)=>()=>void,reply:(reply:Reply)=>void,publish:(patch:Patch)=>void}} OwnerApi */
/** @typedef {{getState:()=>Promise<Snapshot>,dispatch:(command:Command)=>Promise<{revision:number}>,diagnostics:(operation:DiagnosticOperation)=>Promise<DiagnosticView>,onPatch:(callback:(patch:Patch)=>void)=>()=>void,ready:()=>Promise<void>,close:()=>void}} ClientApi */

/** @template T @param {typeof globalThis} root @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SettingsProtocol = api;
})(globalThis, function () {
  /** @type {readonly (keyof Scalars)[]} */
  const scalarKeys = [
    "bgType",
    "bgColor",
    "bgBrightness",
    "bgBlur",
    "miniOverlayShowBackground",
    "miniOverlayScale",
    "miniOverlayOpacity",
    "miniOverlayMaxFps",
    "autoCycle",
    "smoothingEnabled",
    "radialMode",
    "kaleidoClipEnabled",
    "barsAlignment",
    "waveformStyle",
    "prismLayout",
    "cascadeFrequencyOrder",
    "cascadeFillStyle",
    "sensitivity",
    "bassSensitivityEnabled",
    "bassSensitivityAmount",
    "valueHandling",
    "glowIntensity",
    "trailsEnabled",
    "trailDuration",
    "trailMaxFps",
    "wakeLockEnabled",
    "reactiveVignette",
    "crtFilter",
    "beatFlash",
    "particleDensity",
    "particleStyle",
    "mediaMetadataEnabled",
    "mediaDisplay",
  ];
  /** @param {unknown} value @param {typeof import('./audio-math')} math @param {import('./visual-contracts').Registry} registry @param {readonly string[]} themes @returns {value is Command} */
  function validCommand(value, math, registry, themes) {
    if (!value || typeof value !== "object") return false;
    const c =
      /** @type {{type?:unknown,key?:unknown,value?:unknown,id?:unknown,index?:unknown,order?:unknown,disabled?:unknown,position?:unknown,dataUrl?:unknown,name?:unknown}} */ (
        value
      );
    if (c.type === "set") {
      if (!scalarKeys.some((key) => key === c.key)) return false;
      const key = /** @type {keyof Scalars} */ (c.key);
      if (
        key === "bgColor" &&
        (typeof c.value !== "string" || !/^#[0-9a-f]{6}$/i.test(c.value))
      )
        return false;
      const checked = math.mergeSettings(
        {},
        { [key]: c.value },
        registry.ids.length,
        themes.length
      );
      return (
        Object.prototype.hasOwnProperty.call(checked, key) &&
        Object.is(Reflect.get(checked, key), c.value)
      );
    }
    if (c.type === "mode")
      return typeof c.id === "string" && !!registry.get(c.id);
    if (c.type === "overlay-mode")
      return (
        typeof c.id === "string" && (c.id === "follow" || !!registry.get(c.id))
      );
    if (c.type === "theme")
      return (
        typeof c.index === "number" &&
        Number.isInteger(c.index) &&
        c.index >= 0 &&
        c.index < themes.length
      );
    if (c.type === "mode-preferences" || c.type === "theme-preferences") {
      const inventory = c.type === "mode-preferences" ? registry.ids : themes;
      return (
        Array.isArray(c.order) &&
        Array.isArray(c.disabled) &&
        c.order.length === inventory.length &&
        new Set(c.order).size === inventory.length &&
        c.order.every(
          (id) => typeof id === "string" && inventory.includes(id)
        ) &&
        new Set(c.disabled).size === c.disabled.length &&
        c.disabled.length < inventory.length &&
        c.disabled.every(
          (id) => typeof id === "string" && inventory.includes(id)
        )
      );
    }
    if (c.type === "media-position")
      return (
        typeof c.position === "string" &&
        [
          "auto",
          "above",
          "below",
          "top-left",
          "top",
          "top-right",
          "right",
          "bottom-right",
          "bottom",
          "bottom-left",
          "left",
        ].includes(c.position)
      );
    if (c.type === "background")
      return (
        typeof c.name === "string" &&
        c.name.length > 0 &&
        typeof c.dataUrl === "string" &&
        /^data:image\/[a-z0-9.+-]+[;,]/i.test(c.dataUrl)
      );
    return c.type === "clear-background";
  }
  /** @param {unknown} value @returns {value is Patch} */
  function isPatch(value) {
    if (!value || typeof value !== "object") return false;
    const patch = /** @type {Partial<Patch>} */ (value);
    return (
      Number.isSafeInteger(patch.revision) &&
      typeof patch.revision === "number" &&
      patch.revision >= 0 &&
      typeof patch.effectiveMode === "string" &&
      typeof patch.packaged === "boolean" &&
      !!patch.values &&
      typeof patch.values === "object"
    );
  }
  /** @param {{state:State,keys:readonly (keyof State)[],actions:ReturnType<typeof import('./settings-actions').create>,math:typeof import('./audio-math'),registry:import('./visual-contracts').Registry,themes:readonly string[],effectiveMode:()=>string,isActive:()=>boolean,packaged:boolean,api:OwnerApi,diagnostics:(operation:DiagnosticOperation)=>DiagnosticView}} dependencies */
  function createOwner({
    state,
    keys,
    actions,
    math,
    registry,
    themes,
    effectiveMode,
    isActive,
    packaged,
    api,
    diagnostics,
  }) {
    let revision = 0,
      disposed = false;
    /** @type {(()=>void)|undefined} */ let unsubscribe;
    /** @param {readonly (keyof State)[]} changed @returns {Partial<State>} */
    function values(changed) {
      const result = /** @type {Partial<State>} */ ({});
      for (const key of changed) {
        if (!keys.includes(key)) continue;
        // Controls need the name/type, never a copy of the configured image.
        Object.assign(result, {
          [key]: key === "bgImageDataUrl" ? null : structuredClone(state[key]),
        });
      }
      return result;
    }
    /** @returns {Snapshot} */
    function snapshot() {
      return {
        revision,
        values: /** @type {State} */ (values(keys)),
        effectiveMode: effectiveMode(),
        packaged,
      };
    }
    /** @param {import('./settings-actions').ChangedKeys|'all'} changed */
    function notify(changed) {
      if (!disposed) {
        revision++;
        api.publish({
          revision,
          values: values(changed === "all" ? keys : changed),
          effectiveMode: effectiveMode(),
          packaged,
        });
      }
    }
    /** @param {Command} c */
    function dispatch(c) {
      if (!validCommand(c, math, registry, themes))
        throw Error("Invalid settings command");
      switch (c.type) {
        case "set":
          actions.set(c.key, c.value);
          break;
        case "mode":
          actions.selectActiveMode(c.id, isActive());
          break;
        case "overlay-mode":
          actions.selectOverlayMode(c.id);
          break;
        case "theme":
          actions.set("theme", c.index);
          break;
        case "mode-preferences":
          actions.setModePreferences(c);
          break;
        case "theme-preferences":
          actions.setThemePreferences(c);
          break;
        case "media-position":
          actions.setMediaPosition(effectiveMode(), c.position);
          break;
        case "background":
          actions.setBackgroundImage(c);
          break;
        case "clear-background":
          actions.clearBackgroundImage();
          break;
      }
    }
    return {
      snapshot,
      notify,
      dispatch,
      start() {
        if (disposed || unsubscribe) return;
        unsubscribe = api.onRequest((request) => {
          if (disposed || !Number.isSafeInteger(request.id)) return;
          try {
            let value;
            if (request.operation === "snapshot") value = snapshot();
            else if (request.operation === "command" && request.command) {
              dispatch(request.command);
              value = { revision };
            } else if (
              request.operation === "diagnostics" &&
              !packaged &&
              request.diagnostic &&
              [
                "snapshot",
                "report",
                "reset",
                "profile",
                "copy-profile",
              ].includes(request.diagnostic)
            )
              value = diagnostics(request.diagnostic);
            else throw Error("Unsupported settings request");
            api.reply({ id: request.id, ok: true, value });
          } catch (error) {
            api.reply({
              id: request.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        unsubscribe?.();
        unsubscribe = undefined;
      },
    };
  }
  return { scalarKeys, validCommand, isPatch, createOwner };
});
