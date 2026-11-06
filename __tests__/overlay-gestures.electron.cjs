const { ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { registerIpc, validBoundsRequest } = require("../src/mini-overlay");
const { resolveBounds } = require("../src/mini-overlay-math");
const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(async ({ createWindow, loadRenderer, waitFor, artifactDir }) => {
  const window = createWindow({
    frame: false,
    width: 320,
    height: 320,
    webPreferences: {
      additionalArguments: ["--app-packaged=true", "--mini-overlay-supported"],
    },
  });
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  let bounds = { x: 100, y: 100, width: 320, height: 300 },
    active = false,
    locked = false;
  const requests = [];
  const controller = {
    contents: window.webContents,
    snapshot: () => ({
      active,
      locked,
      canLock: true,
      openSettings: false,
      error: null,
    }),
    enter() {
      active = true;
      return this.snapshot();
    },
    restore() {
      active = locked = false;
      return this.snapshot();
    },
    lock() {
      locked = true;
      return this.snapshot();
    },
    getBounds: () => ({ ...bounds }),
    setBounds(value) {
      requests.push(value);
      if (!active || locked || !validBoundsRequest(value)) return;
      const next = resolveBounds(value, area, [area]);
      if (next) bounds = next;
    },
  };
  // Exercise real ownership/channel registration and preload roundtrips without
  // moving a native window or invoking the foreground-only lock dialog.
  const remove = registerIpc(
    ipcMain,
    () => controller,
    async () => true
  );
  const run = (code) => window.webContents.executeJavaScript(code);
  try {
    await loadRenderer(window);
    await run(`(async()=>{
      overlayUI.dispose();window.gestureBoundsReads=0;window.gestureReleases=0;
      overlayUI=MiniOverlayUI.create({
        ...createRendererBridge().overlay,actions:settingsActions,
        api:{...window.electronAPI,getMiniOverlayBounds:async()=>{const value=await window.electronAPI.getMiniOverlayBounds();window.gestureBoundsReads++;return value;}},
        timers:{setTimeout:(fn,ms)=>window.setTimeout(fn,ms),clearTimeout:id=>window.clearTimeout(id)},
        onPresentationChange:()=>syncMediaThemeColors(),
      });
      overlayUI.start();await overlayUI.initialize();await overlayUI.enter();
      for(const target of [document.body,document.getElementById('miniOverlayResize')]){
        target.setPointerCapture=()=>{};target.hasPointerCapture=()=>true;target.releasePointerCapture=()=>window.gestureReleases++;
      }
      window.gestureEvent=(id,type,values={})=>{
        const target=id==='body'?document.body:document.getElementById('miniOverlayResize');
        target.dispatchEvent(new PointerEvent(type,{button:0,pointerId:17,screenX:100,screenY:100,...values}));
      };
    })()`);
    async function begin(id) {
      const before = await run("window.gestureBoundsReads");
      await run(`window.gestureEvent(${JSON.stringify(id)},'pointerdown')`);
      await waitFor(
        "gesture received native anchor",
        () => run("window.gestureBoundsReads"),
        (value) => value === before + 1,
        { window }
      );
    }
    async function event(id, type, values = {}) {
      // The get-bounds reply is an IPC barrier for prior bounds sends.
      return run(
        `(()=>{window.gestureEvent(${JSON.stringify(id)},${JSON.stringify(type)},${JSON.stringify(values)});return window.electronAPI.getMiniOverlayBounds();})()`
      );
    }
    await begin("body");
    await event("body", "pointermove", { screenX: -8 });
    assert.deepEqual(bounds, { x: 0, y: 100, width: 320, height: 300 });
    assert.equal(requests.at(-1).operation, "move");
    assert.equal(requests.at(-1).snapToEdges, true);
    await event("body", "pointermove", { screenX: -13 });
    assert.equal(bounds.x, -13);
    await event("body", "pointermove", { screenX: -8, altKey: true });
    assert.equal(bounds.x, -8);
    await event("body", "pointermove", {
      screenX: -9999,
      screenY: -9999,
      altKey: true,
    });
    assert.deepEqual(bounds, { x: -272, y: -252, width: 320, height: 300 });
    await event("body", "pointerup");
    const afterUp = requests.length;
    await event("body", "pointermove", { screenX: 900 });
    assert.equal(requests.length, afterUp);

    bounds = { x: 100, y: 100, width: 320, height: 300 };
    await begin("resize");
    await event("resize", "pointermove", { screenX: 1595, screenY: 775 });
    assert.deepEqual(bounds, { x: 100, y: 100, width: 1820, height: 980 });
    assert.equal(requests.at(-1).operation, "resize");
    await event("resize", "pointermove", {
      screenX: 1595,
      screenY: 775,
      altKey: true,
    });
    assert.deepEqual(bounds, { x: 100, y: 100, width: 1815, height: 975 });
    await event("resize", "pointermove", {
      screenX: 1595,
      screenY: 821,
      shiftKey: true,
    });
    assert.equal(requests.at(-1).aspectRatio, 16 / 9);
    assert.deepEqual(bounds, { x: 100, y: 100, width: 1820, height: 1024 });
    await event("resize", "pointermove", {
      screenX: 1595,
      screenY: 821,
      shiftKey: true,
      altKey: true,
    });
    assert.equal(requests.at(-1).snapToEdges, false);
    assert.equal(requests.at(-1).aspectRatio, 16 / 9);
    assert.ok(Math.abs(bounds.width - (bounds.height * 16) / 9) <= 1);
    assert.notEqual(bounds.width, 1820);
    await event("resize", "pointercancel");
    const afterCancel = requests.length;
    await event("resize", "pointermove", { screenX: 999 });
    assert.equal(requests.length, afterCancel);

    bounds = { x: -272, y: -252, width: 320, height: 300 };
    await begin("resize");
    await event("resize", "pointermove", { screenX: -500, screenY: -500 });
    assert.deepEqual(bounds, { x: -272, y: -252, width: 320, height: 300 });
    await event("resize", "lostpointercapture");
    const beforeLock = { ...bounds };
    await run("overlayUI.lock()");
    await event("body", "pointerdown");
    await event("body", "pointermove", { screenX: 999 });
    await run(
      "(()=>{window.electronAPI.setMiniOverlayBounds({x:0,y:0,width:160,height:160,operation:'move',snapToEdges:true});return window.electronAPI.getMiniOverlayBounds();})()"
    );
    assert.deepEqual(bounds, beforeLock);
    await run("overlayUI.restore()");
    assert.equal(active, false);
    assert.equal(locked, false);
    assert.ok((await run("window.gestureReleases")) >= 3);
    fs.writeFileSync(
      path.join(artifactDir, "gesture-requests.json"),
      JSON.stringify(requests, null, 2)
    );
    console.log(
      "PASS: hidden pointer/preload/IPC gestures, magnetic release, Alt, Shift+Alt, off-screen resize anchors, cleanup and lock rejection"
    );
  } finally {
    if (!window.isDestroyed()) await run("overlayUI.dispose()").catch(() => {});
    remove();
  }
});
