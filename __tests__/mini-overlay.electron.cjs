// @verification-interactive
const { runCheck } = require("./helpers/electron-harness.cjs");
const electron = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const MiniOverlay = require("../src/mini-overlay");

runCheck(
  async ({ artifactDir, errors }) => {
    const root = path.resolve(__dirname, "..");
    const controller = MiniOverlay.create({
      electron,
      preload: path.join(root, "src/preload.js"),
      icon: path.join(root, "src/icon.png"),
      packaged: true,
      preferencesPath: path.join(artifactDir, "overlay-position.json"),
      onQuit: () => {},
    });
    const contents = controller.contents;
    contents.on("console-message", (event) => {
      if (event.level === "error") {
        errors.push(event.message);
        console.error(event.message);
      }
    });
    const unregister = MiniOverlay.registerIpc(
      electron.ipcMain,
      () => controller,
      async () =>
        contents.executeJavaScript("!!analyser && audioCtx.state==='running'")
    );
    const originalDialog = electron.dialog.showMessageBox;
    try {
      await contents.loadFile(path.join(root, "src/index.html"));
      await contents.executeJavaScript("window.rendererReady");
      assert.equal(controller.snapshot().active, false);
      await contents.executeJavaScript(
        `document.getElementById('miniOverlayBtn').click();if(startOverlay.style.display!=='flex')throw Error('Capture required');`
      );
      await contents.executeJavaScript(`(async()=>{
      window.captureForOverlay=new AudioContext();
      audioCtx=window.captureForOverlay;
      analyser=audioCtx.createAnalyser();analyser.fftSize=2048;
      bassAnalyser=analyser;
      freqData=new Uint8Array(analyser.frequencyBinCount);
      timeData=new Uint8Array(analyser.fftSize);
      window.overlayTone=audioCtx.createOscillator();overlayTone.frequency.value=440;
      const gain=audioCtx.createGain();gain.gain.value=0.15;
      overlayTone.connect(gain);gain.connect(analyser);overlayTone.start();
      await audioCtx.resume();
      window.originalOverlayAnalyser=analyser;
      startOverlay.style.display='none';
      settingsActions.set('trailsEnabled',false);
      settingsActions.selectMode('orbit');
      loop();
    })()`);
      const rendererId = contents.id;
      for (let i = 0; i < 3; i++) {
        await contents.executeJavaScript(
          "window.electronAPI.enterMiniOverlay()"
        );
        assert.equal(controller.snapshot().active, true);
        assert.equal(controller.contents.id, rendererId);
        assert.equal(controller.normal.isVisible(), false);
        await contents.executeJavaScript(
          `if(analyser!==originalOverlayAnalyser||audioCtx.state!=='running')throw Error('Capture restarted');`
        );
        controller.setBounds({ x: 80, y: 80, width: 360, height: 320 });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await contents.executeJavaScript(`(()=>{
        if(Math.abs(innerWidth-360)>2||Math.abs(innerHeight-320)>2||canvas.width!==innerWidth||canvas.height!==innerHeight)throw Error('View resize '+innerWidth+'x'+innerHeight);
        const visible=id=>getComputedStyle(document.getElementById(id)).visibility!=='hidden';
        if(visible('bgLayer')||visible('fxOverlay')||visible('mediaOverlay'))throw Error('Overlay layers visible');
        settingsActions.set('miniOverlayShowBackground',true);
        if(!visible('bgLayer'))throw Error('Configured background hidden');
        settingsActions.set('miniOverlayShowBackground',false);
      })()`);
        await contents.executeJavaScript(
          "window.electronAPI.restoreNormalWindow()"
        );
        assert.equal(controller.snapshot().active, false);
        assert.equal(controller.normal.isVisible(), true);
      }
      await contents.executeJavaScript("window.electronAPI.enterMiniOverlay()");
      await contents.executeJavaScript(`(async()=>{
      const cover=document.createElement('canvas');cover.width=cover.height=32;
      const paint=cover.getContext('2d');paint.fillStyle='#ff0000';paint.fillRect(0,0,32,32);
      const image=new Image();image.src=cover.toDataURL();await image.decode();
      mediaState.thumbnailImage=image;mediaState.metadata={thumbnailDataUrl:image.src,title:'Overlay cover'};
      state.mediaMetadataEnabled=true;state.mediaDisplay='cover-title-artist';
      for(const mode of ['radial','cascade']){
        settingsActions.selectMode(mode);
        const frame=prepareVisualFrame(performance.now(),16);
        if(frame.mediaArt!==image)throw Error('Internal cover removed in overlay');
        let covers=0;const drawImage=ctx.drawImage;
        ctx.drawImage=function(source,...args){if(source===image)covers++;return drawImage.call(this,source,...args);};
        try{visualModeController.render(mode,ctx,frame);}finally{ctx.drawImage=drawImage;}
        if(!covers)throw Error('Internal cover not drawn in '+mode);
      }
    })()`);
      for (const mode of require("../src/mode-registry").ids) {
        await contents.executeJavaScript(
          `settingsActions.selectMode(${JSON.stringify(mode)});`
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      await contents.executeJavaScript(
        `settingsActions.selectMode('orbit');document.body.classList.remove('overlay-controls-visible');document.activeElement.blur();`
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.writeFileSync(
        path.join(artifactDir, "overlay-transparent.png"),
        (await contents.capturePage()).toPNG()
      );
      // Canvas transparency alone is insufficient: verify Chromium's composed page too.
      const image = await contents.capturePage();
      const pixel = image.toBitmap();
      assert.equal(pixel[3], 0, "Surrounding page must have alpha zero");
      let finishDialog;
      electron.dialog.showMessageBox = () =>
        new Promise((resolve) => {
          finishDialog = resolve;
        });
      const pending = controller.lock();
      assert.equal(controller.snapshot().locked, false);
      finishDialog({ response: 0 });
      await pending;
      assert.equal(controller.snapshot().locked, false);
      const locked = controller.lock();
      finishDialog({ response: 1 });
      await locked;
      assert.equal(controller.snapshot().locked, true);
      controller.unlock();
      assert.equal(controller.snapshot().active, true);
      // Actual pointer-driven controls pass bounds through the preload IPC.
      await contents.executeJavaScript(`(()=>{
      const move=document.body;
      move.setPointerCapture=()=>{};
      move.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,screenX:100,screenY:100}));
    })()`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      await contents.executeJavaScript(`(()=>{
      const move=document.body;
      move.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,screenX:130,screenY:120}));
      move.dispatchEvent(new PointerEvent('pointerup',{pointerId:1}));
    })()`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(controller.getBounds().x, 110);
      await contents.executeJavaScript(
        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'s'}))"
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(controller.snapshot().active, false);
      await contents.executeJavaScript(`(()=>{
      const section=document.getElementById('miniOverlaySection');
      if(section.classList.contains('collapsed')||!settingsPanel.classList.contains('visible'))throw Error('Overlay Settings destination');
      const checkbox=document.getElementById('miniOverlayBackgroundCheckbox');checkbox.checked=true;
      checkbox.dispatchEvent(new Event('change'));
      if(!JSON.parse(localStorage.getItem(SETTINGS_KEY)).miniOverlayShowBackground)throw Error('Background preference persistence');
      if(analyser!==originalOverlayAnalyser)throw Error('Capture identity changed');
    })()`);
      console.log(
        "PASS: persistent renderer/capture, all modes, transparency, configured background, tray lock/cancel/unlock, resize, movement, settings and persistence"
      );
    } finally {
      electron.dialog.showMessageBox = originalDialog;
      if (!contents.isDestroyed())
        await contents
          .executeJavaScript("overlayTone?.stop();captureForOverlay?.close()")
          .catch(() => {});
      unregister();
      controller.dispose();
    }
  },
  { requiresDesktop: true }
);
