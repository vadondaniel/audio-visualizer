const { ipcMain } = require("electron");
const IPC = require("../src/ipc-channels");
const { EventEmitter } = require("node:events");
const TrayController = require("../src/tray-controller");
const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(async ({ createWindow, loadRenderer, waitFor }) => {
  const window = createWindow();
  let nativeMenu;
  // Exercise native-controller composition without creating an OS tray or window.
  const nativeTray = TrayController.create({
    Tray: class extends EventEmitter {
      setToolTip() {}
      setContextMenu(menu) {
        nativeMenu = menu;
      }
      isDestroyed() {
        return false;
      }
      destroy() {}
    },
    Menu: { buildFromTemplate: (menu) => menu },
    icon: "unused-test-icon",
    onSelect: (selection) => {
      if (!window.webContents.isDestroyed())
        window.webContents.send(IPC.TRAY_SELECT, selection);
    },
    onUnlock() {},
    onReturn() {},
    onQuit() {},
  });
  const removeTrayIpc = TrayController.registerIpc(
    ipcMain,
    () => window.webContents,
    () => nativeTray
  );
  let menu;
  const receive = (event, value) => {
    if (event.sender === window.webContents) menu = value;
  };
  ipcMain.on(IPC.TRAY_SETTINGS, receive);
  try {
    const presentation = (active) => ({
      active,
      locked: false,
      canLock: true,
      openSettings: false,
      error: null,
    });
    ipcMain.handle("overlay-enter", () => presentation(true));
    ipcMain.handle("overlay-restore", () => presentation(false));
    await loadRenderer(window);
    const expected = await window.webContents.executeJavaScript(
      `({modes:ModeRegistry.ids,themes:THEMES.map(theme=>theme.name),prism:ModeRegistry.indexOf('prism'),ice:THEMES.findIndex(theme=>theme.name==='Ice')})`
    );
    await waitFor(
      "initial tray inventory",
      () => menu,
      (value) =>
        value &&
        JSON.stringify(value.modes.map((item) => item.id)) ===
          JSON.stringify(expected.modes) &&
        JSON.stringify(value.themes.map((item) => item.id)) ===
          JSON.stringify(expected.themes),
      { window }
    );
    nativeTray.ensure();
    const check = (value, message) => {
      if (!value) throw Error(message);
    };
    check(
      JSON.stringify(menu.modes.map((item) => item.id)) ===
        JSON.stringify(expected.modes) &&
        JSON.stringify(menu.themes.map((item) => item.id)) ===
          JSON.stringify(expected.themes),
      "Initial tray choices"
    );
    nativeMenu
      .find((item) => item.label === "Visual mode")
      .submenu.find((item) => item.label === "Prism")
      .click();
    nativeMenu
      .find((item) => item.label === "Color theme")
      .submenu.find((item) => item.label === "Ice")
      .click();
    const normal = await waitFor(
      "tray selection, controls, persistence and menu marks",
      async () => ({
        ...(await window.webContents.executeJavaScript(
          `({mode:ModeRegistry.ids[state.mode],theme:THEMES[state.theme].name,select:modeSelect.value,saved:JSON.parse(localStorage.getItem(SETTINGS_KEY))})`
        )),
        modeMarked: nativeMenu[0].submenu.find((item) => item.label === "Prism")
          .checked,
        themeMarked: nativeMenu[1].submenu.find((item) => item.label === "Ice")
          .checked,
      }),
      (value) =>
        value.mode === "prism" &&
        value.theme === "Ice" &&
        value.select === String(expected.prism) &&
        value.saved?.mode === expected.prism &&
        value.saved?.theme === expected.ice &&
        value.modeMarked &&
        value.themeMarked,
      { window }
    );
    check(
      normal.mode === "prism" &&
        normal.theme === "Ice" &&
        normal.select === String(expected.prism),
      "Tray updates normal controls"
    );
    check(
      normal.saved.mode === expected.prism &&
        normal.saved.theme === expected.ice,
      "Tray persists choices"
    );
    await window.webContents.executeJavaScript(
      `(async()=>{await overlayUI.enter();settingsActions.selectOverlayMode('orbit');})()`
    );
    nativeMenu
      .find((item) => item.label === "Visual mode")
      .submenu.find((item) => item.label === "Bars")
      .click();
    const overlay = await waitFor(
      "independent overlay tray selection",
      () =>
        window.webContents.executeJavaScript(
          `({normal:ModeRegistry.ids[state.mode],overlay:state.miniOverlayMode,control:document.getElementById('miniOverlayModeSelect').value})`
        ),
      (value) =>
        value.normal === "prism" &&
        value.overlay === "bars" &&
        value.control === "bars",
      { window }
    );
    check(
      overlay.normal === "prism" &&
        overlay.overlay === "bars" &&
        overlay.control === "bars",
      "Independent overlay routing"
    );
    await window.webContents.executeJavaScript(
      `settingsActions.setModePreferences({order:[...state.modeOrder].reverse(),disabled:['bars']});settingsActions.setThemePreferences({order:[...state.themeOrder].reverse(),disabled:['Ice']});`
    );
    await waitFor(
      "filtered and reordered tray choices",
      () => menu,
      (value) =>
        !value.modes.some((item) => item.id === "bars") &&
        !value.themes.some((item) => item.id === "Ice") &&
        value.modes[0].id === expected.modes.at(-1),
      { window }
    );
    check(
      !menu.modes.some((x) => x.id === "bars") &&
        !menu.themes.some((x) => x.id === "Ice") &&
        menu.modes[0].id === expected.modes.at(-1),
      "Tray follows enabled order and fallback"
    );
    console.log(
      "PASS: tray choices, actions, controls, persistence, independent overlay and preferences"
    );
  } finally {
    removeTrayIpc();
    nativeTray.dispose();
    ipcMain.removeListener(IPC.TRAY_SETTINGS, receive);
  }
});
