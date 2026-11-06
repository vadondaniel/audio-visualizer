const IPC = require("./ipc-channels");

/** @typedef {{id:string,label:string}} Choice */
/** @typedef {{modes:Choice[],themes:Choice[],mode:string,theme:string}} TraySettings */
/** @typedef {{kind:'mode'|'theme',id:string}} Selection */
/** @typedef {{active:boolean,locked:boolean}} Presentation */

/** @param {unknown} value @returns {value is Choice[]} */
function validItems(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every(
      (item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        item.id.length <= 100 &&
        item.label.length <= 100
    ) &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}
/** @param {unknown} value @returns {value is TraySettings} */
function validChoices(value) {
  return (
    !!value &&
    typeof value === "object" &&
    "modes" in value &&
    "themes" in value &&
    "mode" in value &&
    "theme" in value &&
    validItems(value.modes) &&
    validItems(value.themes) &&
    value.modes.some((item) => item.id === value.mode) &&
    value.themes.some((item) => item.id === value.theme)
  );
}

/** Owns only the native tray and its menu; application operations are callbacks.
 * @param {{Tray:typeof import('electron').Tray,Menu:Pick<typeof import('electron').Menu,'buildFromTemplate'>,icon:string,onSelect:(selection:Selection)=>void,onUnlock:()=>void,onReturn:()=>void,onQuit:()=>void}} dependencies */
function create({ Tray, Menu, icon, onSelect, onUnlock, onReturn, onQuit }) {
  /** @type {import('electron').Tray|null} */
  let tray = null;
  let disposed = false;
  /** @type {TraySettings} */
  let choices = { modes: [], themes: [], mode: "", theme: "" };
  let presentation = { active: false, locked: false };
  const isAvailable = () => !disposed && tray !== null && !tray.isDestroyed();
  /** @param {()=>void} callback */
  const guarded = (callback) => () => {
    if (isAvailable()) callback();
  };
  const returnToNormal = guarded(onReturn);
  /** @param {'mode'|'theme'} kind @param {Choice[]} items */
  function submenu(kind, items) {
    return items.map(({ id, label }) => ({
      label,
      type: /** @type {const} */ ("radio"),
      checked: choices[kind] === id,
      click: guarded(() => onSelect({ kind, id })),
    }));
  }
  function refresh() {
    if (!tray || !isAvailable()) return;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "Visual mode",
          enabled: choices.modes.length > 0,
          submenu: submenu("mode", choices.modes),
        },
        {
          label: "Color theme",
          enabled: choices.themes.length > 0,
          submenu: submenu("theme", choices.themes),
        },
        { type: "separator" },
        {
          label: "Unlock mini overlay",
          enabled: presentation.active && presentation.locked,
          click: guarded(onUnlock),
        },
        { label: "Return to normal", click: returnToNormal },
        { type: "separator" },
        { label: "Quit", click: guarded(onQuit) },
      ])
    );
  }
  function release() {
    const owned = tray;
    tray = null;
    if (!owned) return;
    owned.removeListener("double-click", returnToNormal);
    if (!owned.isDestroyed()) owned.destroy();
  }
  function ensure() {
    if (disposed) return false;
    if (isAvailable()) return true;
    try {
      release();
      tray = new Tray(icon);
      tray.setToolTip("Audio Visualizer");
      tray.on("double-click", returnToNormal);
      refresh();
      return true;
    } catch (error) {
      release();
      console.warn("Tray unavailable", error);
      return false;
    }
  }
  /** @param {unknown} value */
  function setChoices(value) {
    if (disposed || !validChoices(value)) return;
    choices = value;
    refresh();
  }
  /** @param {Presentation} value */
  function setPresentation(value) {
    if (disposed) return;
    presentation = { active: value.active, locked: value.locked };
    refresh();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    release();
  }
  return { ensure, isAvailable, setChoices, setPresentation, dispose };
}

/** @param {import('electron').IpcMain} ipcMain
 * @param {()=>import('electron').WebContents|undefined} getContents
 * @param {()=>ReturnType<typeof create>|undefined} getController */
function registerIpc(ipcMain, getContents, getController) {
  const settings = (event, value) => {
    const contents = getContents();
    if (contents && !contents.isDestroyed() && event.sender === contents)
      getController()?.setChoices(value);
  };
  ipcMain.on(IPC.TRAY_SETTINGS, settings);
  return () => ipcMain.removeListener(IPC.TRAY_SETTINGS, settings);
}
module.exports = { create, registerIpc };
