const { ipcMain } = require("electron");
const { runCheck } = require("./helpers/electron-harness.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
runCheck(
  async ({
    createWindow,
    loadRenderer,
    reloadRenderer,
    waitForPaint,
    setViewport,
    artifactDir,
  }) => {
    const window = createWindow({
      width: 640,
      height: 480,
      backgroundColor: "#000000",
      webPreferences: {
        backgroundThrottling: false,
        partition: "overlay-display-check",
      },
    });

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
    await window.webContents.executeJavaScript(`(async()=>{
    const check=(value,message)=>{if(!value)throw Error(message);};
    const normalIndex=ModeRegistry.indexOf('bars'), enabled=ModeList.enabled(state.modeOrder,state.disabledModes);
    const control=(id,value,event='change')=>{const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event(event,{bubbles:true}));};
    check(state.miniOverlayScale===1&&state.miniOverlayOpacity===1&&state.miniOverlayMaxFps===60&&state.miniOverlayMode==='follow','Overlay defaults');
    check(document.getElementById('miniOverlayModeSelect').options.length===MODES.length+1,'Registry-driven overlay choices');
    let writes=0;const save=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key===SETTINGS_KEY)writes++;return save.call(this,key,value);};
    try{
      control('miniOverlayScaleSlider','150','input');control('miniOverlayOpacitySlider','50','input');control('miniOverlayFpsSelect','30');control('miniOverlayModeSelect','orbit');
      check(writes===4,'One save per display control');
    }finally{Storage.prototype.setItem=save;}
    check(state.mode===normalIndex&&modeSelect.value===String(normalIndex),'Normal selection unchanged');
    check(document.getElementById('miniOverlayScaleVal').textContent==='150%'&&document.getElementById('miniOverlayOpacityVal').textContent==='50%','Scale and opacity labels');
    check(getComputedStyle(canvas).transform==='none'&&getComputedStyle(document.getElementById('visualSurface')).opacity==='1','Normal presentation bypasses display controls');
    await overlayUI.enter();document.body.classList.add('mini-overlay');
    check(effectiveVisualMode()==='orbit','Independent effective mode');
    check(getComputedStyle(canvas).transform==='matrix(1.5, 0, 0, 1.5, 0, 0)','Centered visualizer scaling');
    const box=canvas.getBoundingClientRect();
    check(box.left<0&&box.right>innerWidth&&Math.abs((box.left+box.right)/2-innerWidth/2)<1,'Scale crops around window center');
    check(getComputedStyle(bgLayer).transform==='none','Background unscaled');
    check(getComputedStyle(document.getElementById('visualSurface')).opacity==='0.5','Grouped opacity');
    check(!document.getElementById('visualSurface').contains(document.getElementById('miniOverlayControls')),'Controls outside fading surface');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'3'}));
    check(state.miniOverlayMode===enabled[2]&&state.mode===normalIndex,'Overlay shortcut isolation');
    settingsActions.nextMode();check(state.mode===ModeRegistry.indexOf(enabled[1])&&effectiveVisualMode()===enabled[2],'Normal cycling leaves overlay fixed');
    settingsActions.selectOverlayMode('follow');window.dispatchEvent(new KeyboardEvent('keydown',{key:'1'}));
    check(state.mode===normalIndex&&state.miniOverlayMode==='follow'&&effectiveVisualMode()==='bars','Follow normal shortcut');
    settingsActions.selectOverlayMode('orbit');
    settingsActions.setModePreferences({order:[...MODES].reverse(),disabled:['orbit']});
    check(state.miniOverlayMode===MODES.at(-1)&&!Array.from(document.getElementById('miniOverlayModeSelect').options).some(o=>o.value==='orbit'),'Disabled overlay fallback and selector');
    settingsActions.setModePreferences({order:[...MODES],disabled:[]});
    analyser={getFloatFrequencyData:data=>data.fill(-40),getByteFrequencyData:data=>data.fill(140),getByteTimeDomainData:data=>{for(let i=0;i<data.length;i++)data[i]=128+Math.round(30*Math.sin(i/13));}};
    bassAnalyser=analyser;audioCtx={sampleRate:48000,state:'running'};freqData=new Uint8Array(1024);timeData=new Uint8Array(2048);
    analyser.getByteFrequencyData(freqData);analyser.getByteTimeDomainData(timeData);
    for(const id of MODES){
      settingsActions.selectOverlayMode(id);const frame=prepareVisualFrame(1000,16);
      check(frame.signals.bands.length===ModeRegistry.get(id).audio.count,'Effective audio profile '+id);
      clearFrame();visualModeController.update(effectiveVisualMode(),frame);visualModeController.draw(effectiveVisualMode(),ctx,frame);
    }
    settingsActions.set('miniOverlayScale',1);settingsActions.set('miniOverlayShowBackground',true);settingsActions.set('bgType','color');settingsActions.set('bgColor','#ff0000');
    displayCtx.save();displayCtx.setTransform(1,0,0,1,0,0);displayCtx.fillStyle='#0000ff';displayCtx.fillRect(0,0,canvas.width,canvas.height);displayCtx.restore();
    startOverlay.style.display='none';
    settingsActions.selectOverlayMode('orbit');
  })()`);
    await waitForPaint(window, ["#visualSurface"]);
    await window.webContents.executeJavaScript(
      `displayCtx.save();displayCtx.setTransform(1,0,0,1,0,0);displayCtx.globalAlpha=1;displayCtx.fillStyle='#0000ff';displayCtx.fillRect(0,0,canvas.width,canvas.height);displayCtx.restore();`
    );
    await waitForPaint(window, ["#visualSurface"]);
    const composed = await window.webContents.capturePage();
    fs.writeFileSync(
      path.join(artifactDir, "grouped-opacity.png"),
      composed.toPNG()
    );
    const pixels = composed.toBitmap(),
      offset = (40 * composed.getSize().width + 40) * 4;
    const [blue, , red, alpha] = pixels.subarray(offset, offset + 4);
    assert.ok(
      red < 5 &&
        blue > 100 &&
        (Math.abs(alpha - 128) < 5 || Math.abs(blue - 128) < 5),
      `Grouped fade must not leak red background through blue mode: ${[blue, red, alpha]}`
    );
    await window.webContents.executeJavaScript(`(async()=>{
    await overlayUI.restore();document.body.classList.remove('mini-overlay');
    if(getComputedStyle(canvas).transform!=='none'||getComputedStyle(document.getElementById('visualSurface')).opacity!=='1')throw Error('Normal display restoration');
    settingsActions.set('miniOverlayScale',1.5);
  })()`);
    await reloadRenderer(window);
    const restored = await window.webContents.executeJavaScript(
      `({scale:state.miniOverlayScale,opacity:state.miniOverlayOpacity,fps:state.miniOverlayMaxFps,mode:state.miniOverlayMode,active:isMiniOverlayActive(),selected:document.getElementById('miniOverlayModeSelect').value})`
    );
    assert.deepEqual(restored, {
      scale: 1.5,
      opacity: 0.5,
      fps: 30,
      mode: "orbit",
      active: false,
      selected: "orbit",
    });
    await window.webContents.executeJavaScript(`(async()=>{
      const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY));saved.miniOverlayMode='unknown';localStorage.setItem(SETTINGS_KEY,JSON.stringify(saved));
    })()`);
    await reloadRenderer(window);
    assert.equal(
      await window.webContents.executeJavaScript("state.miniOverlayMode"),
      "follow"
    );
    for (const width of [1280, 360]) {
      await setViewport(window, width, 720);
      await window.webContents.executeJavaScript(`(async()=>{
        startOverlay.style.display='none';panelOpen=true;flashHud();
        for(const section of settingsPanel.querySelectorAll('.settingsSection'))section.classList.toggle('collapsed',section.id!=='miniOverlaySection');
      })()`);
      await waitForPaint(window, ["#settingsPanel"]);
      await window.webContents.executeJavaScript(`(async()=>{
        document.getElementById('miniOverlaySection').scrollIntoView({block:'nearest'});
        if(settingsPanel.scrollWidth>settingsPanel.clientWidth)throw Error('Overlay settings overflow horizontally');
        if(document.getElementById('miniOverlayModeSelect').value!=='follow')throw Error('Restored mode control');
      })()`);
      fs.writeFileSync(
        path.join(artifactDir, `overlay-settings-${width}.png`),
        (await window.webContents.capturePage()).toPNG()
      );
    }
    console.log(
      "PASS: hidden display controls, grouped pixel opacity, scale isolation, all effective profiles/modes, shortcuts, cycle isolation, disabled fallback and persistence"
    );
  }
);
