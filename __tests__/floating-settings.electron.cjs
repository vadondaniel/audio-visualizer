const { ipcMain, screen } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { runCheck } = require("./helpers/electron-harness.cjs");
const SettingsWindow = require("../src/settings-window");
const IPC = require("../src/ipc-channels");

runCheck(
  async ({
    createWindow,
    loadRenderer,
    waitFor,
    installWaiters,
    waitForPaint,
    artifactDir,
  }) => {
    const owner = createWindow({
      width: 640,
      height: 480,
      packaged: false,
      webPreferences: { backgroundThrottling: false },
    });
    let active = true,
      locked = false;
    const presentation = () => ({
      active,
      locked,
      canLock: true,
      openSettings: false,
      error: null,
    });
    ipcMain.handle(IPC.OVERLAY_ENTER, presentation);
    ipcMain.handle(IPC.OVERLAY_RESTORE, () => {
      active = false;
      controller.presentationChanged(presentation());
      return presentation();
    });
    let presentations = 0;
    const controller = SettingsWindow.create({
      createWindow: (options) =>
        createWindow({
          ...options,
          withRenderer: false,
          webPreferences: {
            ...options.webPreferences,
            backgroundThrottling: false,
          },
        }),
      present: () => {
        presentations++;
      },
      ipc: ipcMain,
      screen,
      getOwner: () => owner.webContents,
      waitForOwner: () =>
        owner.webContents.executeJavaScript("window.rendererReady"),
      getOverlay: () => owner,
      isActive: () => active,
      htmlPath: path.resolve(__dirname, "../src/settings.html"),
      preload: path.resolve(__dirname, "../src/settings-preload.js"),
      reportError: (message) => {
        throw Error(message);
      },
    });
    const run = (code) => owner.webContents.executeJavaScript(code);
    const state = () =>
      run(
        "({mode:state.mode,overlay:state.miniOverlayMode,gain:state.sensitivity,theme:state.theme,writes:window.settingsWrites,position:state.mediaTextPositions.radial,background:state.bgImageName})"
      );
    await loadRenderer(owner);
    await run(`(async()=>{
    analyser={getFloatFrequencyData:data=>data.fill(-40),getByteFrequencyData:data=>data.fill(140),getByteTimeDomainData:data=>data.fill(128)};
    bassAnalyser=analyser;audioCtx={sampleRate:48000,state:'running'};freqData=new Uint8Array(1024);timeData=new Uint8Array(2048);
    window.cycleTimers=new Set();const nativeInterval=window.setInterval.bind(window),nativeClear=window.clearInterval.bind(window);
    window.setInterval=(fn,ms)=>{const id=nativeInterval(fn,ms);if(ms===12000)window.cycleTimers.add(id);return id;};window.clearInterval=id=>{window.cycleTimers.delete(id);nativeClear(id);};
    settingsActions.selectOverlayMode('orbit');settingsActions.set('autoCycle',true);
    await overlayUI.enter();
    window.identity={analyser,bassAnalyser,audioCtx,pipeline:audioPipeline,controller:visualModeController,actions:settingsActions,cycle:[...window.cycleTimers][0],contents:window};
    const save=Storage.prototype.setItem;window.settingsWrites=0;Storage.prototype.setItem=function(key,value){if(key===SETTINGS_KEY)window.settingsWrites++;return save.call(this,key,value);};
  })()`);
    const before = await state();
    await run("overlayUI.openSettings()");
    const first = controller.getWindow();
    assert(first);
    assert.equal(first.isMenuBarVisible(), false);
    assert.equal(
      await first.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('.settingsHeader')).getPropertyValue('-webkit-app-region')"
      ),
      "drag"
    );
    assert.equal(
      await first.webContents.executeJavaScript(
        "getComputedStyle(document.getElementById('closeSettingsWindowBtn')).getPropertyValue('-webkit-app-region')"
      ),
      "no-drag"
    );
    await installWaiters(first);
    const client = (code) => first.webContents.executeJavaScript(code);
    const inspect = () =>
      client(
        `({mode:document.getElementById('modeSelect').value,gain:document.getElementById('sensitivitySlider').value,theme:document.getElementById('themeSelect').value,error:document.getElementById('settingsError').textContent,mini:!document.getElementById('miniOverlaySection').classList.contains('collapsed')})`
      );
    assert.equal((await inspect()).mini, true);
    assert.equal((await state()).writes, 0);
    assert.equal(
      await client(
        "typeof analyser+'|'+typeof audioPipeline+'|'+typeof settingsActions+'|'+typeof visualModeController"
      ),
      "undefined|undefined|undefined|undefined"
    );
    assert.equal(await client("!!document.getElementById('canvas')"), false);
    const change = (id, value, type = "change") =>
      client(
        `(()=>{const el=document.getElementById(${JSON.stringify(id)});el[el.type==='checkbox'?'checked':'value']=${JSON.stringify(value)};el.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));})()`
      );
    await change("sensitivitySlider", "1.8", "input");
    await waitFor(
      "floating gain saved",
      state,
      (s) => s.gain === 1.8 && s.writes === 1,
      { window: owner }
    );
    await waitFor(
      "floating gain label",
      () => client("document.getElementById('sensitivityVal').textContent"),
      (v) => v === "1.8x",
      { window: first }
    );
    const radial = await run("ModeRegistry.indexOf('radial')");
    await change("modeSelect", String(radial));
    await waitFor(
      "independent radial",
      state,
      (s) => s.overlay === "radial" && s.mode === before.mode && s.writes === 2,
      { window: owner }
    );
    await waitFor(
      "mode-specific radial row",
      () => client("document.getElementById('radialModeRow').style.display"),
      (v) => v === "",
      { window: first }
    );
    await change("mediaMetadataCheckbox", true);
    await change("mediaTextPositionSelect", "above");
    await waitFor(
      "effective media position",
      state,
      (s) => s.position === "above" && s.writes === 4,
      { window: owner }
    );
    const fireIndex = await run("themeIds.indexOf('Fire')");
    await run(
      "settingsActions.set('sensitivity',2);settingsActions.set('theme',themeIds.indexOf('Fire'));settingsActions.nextMode();"
    );
    await waitFor(
      "external control synchronization",
      inspect,
      (v) =>
        v.gain === "2" &&
        v.mode === String(radial) &&
        v.theme === String(fireIndex),
      { window: first }
    );
    ipcMain.emit(
      IPC.SETTINGS_PATCH,
      { sender: owner.webContents },
      {
        revision: 1,
        values: { sensitivity: 0.5 },
        effectiveMode: "bars",
        packaged: false,
      }
    );
    const focusCount = presentations;
    await run("settingsActions.set('glowIntensity',1.5)");
    await waitFor(
      "external glow label",
      () => client("document.getElementById('glowVal').textContent"),
      (v) => v === "150%",
      { window: first }
    );
    assert.equal(presentations, focusCount);
    assert.equal((await inspect()).gain, "2");
    const orbitBefore = await run("state.modeOrder.indexOf('orbit')");
    // Shared manager keyboard ordering and enable filtering.
    await client(
      "document.getElementById('manageModesBtn').click();document.querySelector('#modeManagerList button[data-mode=orbit]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));"
    );
    await waitFor(
      "manager reorder applied",
      () => run("state.modeOrder.indexOf('orbit')"),
      (v) => v === orbitBefore - 1,
      { window: owner }
    );
    await client(
      "document.querySelector('#modeManagerList input[data-mode=bars]').click()"
    );
    await waitFor(
      "disabled mode removed",
      () =>
        client(
          "Array.from(document.getElementById('modeSelect').options).some(o=>o.textContent==='Bars')"
        ),
      (v) => !v,
      { window: first }
    );
    await client(
      "document.getElementById('doneModeManagerBtn').click();document.getElementById('manageThemesBtn').click();document.querySelector('#themeManagerList input[data-theme=Neon]').click();"
    );
    await waitFor(
      "disabled color removed",
      () =>
        client(
          "Array.from(document.getElementById('themeSelect').options).some(o=>o.textContent==='Neon')"
        ),
      (v) => !v,
      { window: first }
    );
    await client("document.getElementById('doneThemeManagerBtn').click()");
    // Image decoding stays in the choosing renderer; only one composite reaches the owner.
    const writes = (await state()).writes;
    await client(
      `(()=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNXYAAAAASUVORK5CYII='),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'floating.png',{type:'image/png'}));const input=document.getElementById('bgImageInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`
    );
    await waitFor(
      "image action committed once",
      state,
      (v) => v.background === "floating.png" && v.writes === writes + 1,
      { window: owner }
    );
    await waitFor(
      "image name synchronized",
      () => client("document.getElementById('bgImageName').textContent"),
      (v) => v === "floating.png",
      { window: first }
    );
    await client(
      `(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['broken image'],'broken.png',{type:'image/png'}));const input=document.getElementById('bgImageInput');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`
    );
    await waitFor(
      "corrupt image rejected before action",
      () => client("document.getElementById('settingsError').textContent"),
      (v) => v.includes("decode"),
      { window: first }
    );
    assert.equal((await state()).background, "floating.png");
    assert.equal((await state()).writes, writes + 1);
    await client("document.getElementById('clearBgImageBtn').click()");
    await waitFor(
      "image clear committed once",
      state,
      (v) => v.background === null && v.writes === writes + 2,
      { window: owner }
    );
    await client(
      "document.getElementById('hotkeysBtn').click();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));"
    );
    assert.equal(first.isDestroyed(), false);
    await client("document.getElementById('manageModesBtn').click()");
    await client(
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));document.getElementById('modeManager').dispatchEvent(new Event('cancel',{cancelable:true}));"
    );
    assert.equal(first.isDestroyed(), false);
    assert.equal(
      await client("document.getElementById('modeManager').open"),
      false
    );
    // Repeated explicit opens keep current navigation and singleton identity.
    await client(
      "document.getElementById('sensitivitySlider').closest('.settingsSection').querySelector('.settingsSectionTitle').click()"
    );
    const focusBefore = presentations;
    await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'s'}))");
    await waitFor(
      "S focuses existing settings",
      () => presentations,
      (v) => v === focusBefore + 1,
      { window: owner }
    );
    assert.equal(controller.getWindow(), first);
    assert.equal(
      await client(
        "document.getElementById('sensitivitySlider').closest('.settingsSection').classList.contains('collapsed')"
      ),
      false
    );
    locked = true;
    owner.webContents.send(IPC.OVERLAY_STATE, presentation());
    await waitFor(
      "locked owner",
      () => run("document.body.classList.contains('overlay-locked')"),
      Boolean,
      { window: owner }
    );
    await change("sensitivitySlider", "1.6", "input");
    await waitFor(
      "locked settings remain interactive",
      state,
      (v) => v.gain === 1.6,
      { window: owner }
    );
    assert.equal(locked, true);
    await waitForPaint(first, ["#settingsPanel"]);
    fs.writeFileSync(
      path.join(artifactDir, "floating-settings.png"),
      (await first.webContents.capturePage()).toPNG()
    );
    assert.equal((await inspect()).error, "");
    await client(
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))"
    );
    await waitFor("floating Escape closes", () => first.isDestroyed(), Boolean);
    assert.equal(active, true);
    assert.equal(locked, true);
    await run(
      `(()=>{const i=window.identity;if(analyser!==i.analyser||bassAnalyser!==i.bassAnalyser||audioCtx!==i.audioCtx||audioPipeline!==i.pipeline||visualModeController!==i.controller||settingsActions!==i.actions||!state.autoCycle||window.cycleTimers.size!==1||!window.cycleTimers.has(i.cycle))throw Error('Opening settings replaced live resources');})()`
    );
    await run("overlayUI.openSettings()");
    const second = controller.getWindow();
    assert(second !== first);
    await second.webContents.executeJavaScript(
      "document.getElementById('closeSettingsWindowBtn').click()"
    );
    await waitFor(
      "header close leaves overlay running",
      () => second.isDestroyed(),
      Boolean
    );
    assert.equal(active, true);
    assert.equal(locked, true);
    await run("overlayUI.openSettings()");
    const third = controller.getWindow();
    await run("overlayUI.restore()");
    await waitFor("return closes settings", () => third.isDestroyed(), Boolean);
    assert.equal(active, false);
    controller.dispose();
    ipcMain.removeHandler(IPC.OVERLAY_ENTER);
    ipcMain.removeHandler(IPC.OVERLAY_RESTORE);
    console.log(
      "PASS: shared floating settings, singleton/readiness, live actions and persistence, independent mode/media context, managers, images, external sync, locked interaction, Escape and renderer continuity. Native stacking/focus skipped without --interactive."
    );
  }
);
