const { ipcMain } = require("electron");
const IPC = require("../src/ipc-channels");
const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(async ({ createWindow, loadRenderer }) => {
  const window = createWindow();
  let menu;
  const receive = (event, value) => {
    if (event.sender === window.webContents) menu = value;
  };
  ipcMain.on(IPC.TRAY_SETTINGS, receive);
  try {
    await loadRenderer(window);
    const check = (value, message) => {
      if (!value) throw Error(message);
    };
    check(
      menu?.modes.length === 11 && menu.themes.length > 0,
      "Initial tray choices"
    );
    window.webContents.send(IPC.TRAY_SELECT, { kind: "mode", id: "prism" });
    window.webContents.send(IPC.TRAY_SELECT, { kind: "theme", id: "Ice" });
    await window.webContents.executeJavaScript(
      `new Promise(resolve=>setTimeout(resolve,30))`
    );
    const normal = await window.webContents.executeJavaScript(
      `({mode:ModeRegistry.ids[state.mode],theme:THEMES[state.theme].name,select:modeSelect.value,saved:JSON.parse(localStorage.getItem(SETTINGS_KEY))})`
    );
    check(
      normal.mode === "prism" &&
        normal.theme === "Ice" &&
        normal.select === "10",
      "Tray updates normal controls"
    );
    check(
      normal.saved.mode === 10 && normal.saved.theme === 3,
      "Tray persists choices"
    );
    await window.webContents.executeJavaScript(
      `miniOverlayActive=true;settingsActions.selectOverlayMode('orbit');`
    );
    window.webContents.send(IPC.TRAY_SELECT, { kind: "mode", id: "bars" });
    await window.webContents.executeJavaScript(
      `new Promise(resolve=>setTimeout(resolve,30))`
    );
    const overlay = await window.webContents.executeJavaScript(
      `({normal:ModeRegistry.ids[state.mode],overlay:state.miniOverlayMode,control:document.getElementById('miniOverlayModeSelect').value})`
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
    check(
      !menu.modes.some((x) => x.id === "bars") &&
        !menu.themes.some((x) => x.id === "Ice") &&
        menu.modes[0].id === "prism",
      "Tray follows enabled order and fallback"
    );
    console.log(
      "PASS: tray choices, actions, controls, persistence, independent overlay and preferences"
    );
  } finally {
    ipcMain.removeListener(IPC.TRAY_SETTINGS, receive);
  }
});
