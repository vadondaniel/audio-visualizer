const fs = require("node:fs"),
  path = require("node:path");
const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(async ({ createWindow, loadRenderer, waitForPaint, artifactDir }) => {
  const window = createWindow();
  await loadRenderer(window);
  await window.webContents.executeJavaScript(`(() => {
    const check=(value,message)=>{if(!value)throw Error(message);};
    check(state.prismLayout==='circular','Circular layout default');
    settingsActions.selectMode('waveform');
    check(Array.from(document.getElementById('waveformStyleSelect').options).map(o=>o.value).join(',')==='line,filled','Waveform only contains waveform styles');
    check(document.getElementById('prismLayoutRow').style.display==='none','Prism layout hidden for Waveform');
    settingsActions.selectMode('prism');
    check(document.getElementById('prismLayoutRow').style.display==='','Prism layout shown for Prism');
    const select=document.getElementById('prismLayoutSelect');
    select.value='straight';select.dispatchEvent(new Event('change',{bubbles:true}));
    check(state.prismLayout==='straight','Style control');
    check(JSON.parse(localStorage.getItem(SETTINGS_KEY)).prismLayout==='straight','Style saved');
    check(JSON.parse(localStorage.getItem(SETTINGS_KEY)).mode===ModeRegistry.indexOf('prism'),'Prism numeric selection persisted');
    loadSettings();check(state.prismLayout==='straight'&&select.value==='straight','Style restored');
    const normalSelection=state.mode,controller=visualModeController,hostPipeline=audioPipeline;
    const pipeline=AudioPipeline.create();
    const input={sampleRate:48000,frequencyBytes:new Uint8Array(1024).fill(100),timeBytes:new Uint8Array(1024).fill(128),spectrumDb:Float32Array.from({length:1024},(_,i)=>-90+50*Math.exp(-(((i-40)/25)**2)))};
    pipeline.update(input,state,{dtSec:1/60});
    const signals=pipeline.forMode('prism');
    check(signals.bands.length===ModeRegistry.resolveAudioProfile('prism',state).count&&signals.bands.some(x=>x>0),'Spectral input');
    const target=document.createElement('canvas');target.width=800;target.height=400;
    const context=target.getContext('2d');
    visualModeController.render('prism',context,{width:800,height:400,settings:state,signals,beat:{pulse:0,justHit:false},timestampMs:1000,elapsedMs:16,dtSec:.016,audioClockMs:1000,mediaArt:null});
    check(visualModeController.getOverlayBounds('prism',{width:800,height:400,settings:state})===null,'Straight keeps viewport framing');
    check(visualModeController.getRenderBounds('prism',{width:800,height:400,settings:state})===null,'Straight keeps full canvas trails');
    settingsActions.set('prismLayout','circular');check(visualModeController.getOverlayBounds('prism',{width:800,height:400,settings:state})!==null,'Circular fitting restored');
    check(state.mode===normalSelection&&visualModeController===controller&&audioPipeline===hostPipeline,'Layout switches retain mode and pipeline');
    check(context.getImageData(0,0,800,400).data.some((value,index)=>index%4===3&&value>0),'Visible rendered pixels');
    const saved={mode:ModeRegistry.indexOf('waveform'),miniOverlayMode:'prism',waveformStyle:'prism',disabledModes:['prism'],modeOrder:[...MODES]};
    localStorage.setItem(SETTINGS_KEY,JSON.stringify(saved));
    let writes=0;const save=Storage.prototype.setItem;Storage.prototype.setItem=function(){writes++;return save.apply(this,arguments);};
    try{loadSettings();check(writes===0,'Migration never saves');check(state.mode===ModeRegistry.indexOf('prism')&&state.prismLayout==='straight'&&state.waveformStyle==='line','Legacy straight migration and normal priority');check(!state.disabledModes.includes('prism'),'Migrated selection enables Prism');}
    finally{Storage.prototype.setItem=save;}
  })()`);
  await window.webContents.executeJavaScript(
    "startOverlay.style.display='none';settingsPanel.dispatchEvent(new MouseEvent('mouseenter'));panelOpen=true;flashHud();"
  );
  await waitForPaint(window, ["#settingsPanel"]);
  fs.writeFileSync(
    path.join(artifactDir, "prism-layout-controls.png"),
    (await window.webContents.capturePage()).toPNG()
  );
  console.log(
    "PASS: Prism layouts, legacy migration, controls, persistence, shared spectrum, bounds and canvas rendering"
  );
});
