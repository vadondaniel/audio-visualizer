const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(async ({ createWindow, loadRenderer }) => {
  const window = createWindow();
  await loadRenderer(window);
  await window.webContents.executeJavaScript(`(() => {
    const check=(value,message)=>{if(!value)throw Error(message);};
    settingsActions.selectMode('waveform');
    const select=document.getElementById('waveformStyleSelect');
    select.value='prism';select.dispatchEvent(new Event('change',{bubbles:true}));
    check(state.waveformStyle==='prism','Style control');
    check(JSON.parse(localStorage.getItem(SETTINGS_KEY)).waveformStyle==='prism','Style saved');
    loadSettings();check(state.waveformStyle==='prism'&&select.value==='prism','Style restored');
    const pipeline=AudioPipeline.create();
    const input={sampleRate:48000,frequencyBytes:new Uint8Array(1024).fill(100),timeBytes:new Uint8Array(1024).fill(128),spectrumDb:Float32Array.from({length:1024},(_,i)=>-90+50*Math.exp(-(((i-40)/25)**2)))};
    pipeline.update(input,state,{dtSec:1/60});
    const signals=pipeline.forMode('waveform');
    check(signals.bands.length===ModeRegistry.resolveAudioProfile('waveform',state).count&&signals.bands.some(x=>x>0),'Spectral input');
    const target=document.createElement('canvas');target.width=800;target.height=400;
    const context=target.getContext('2d');
    visualModeController.render('waveform',context,{width:800,height:400,settings:state,signals,beat:{pulse:0,justHit:false},timestampMs:1000,elapsedMs:16,dtSec:.016,audioClockMs:1000,mediaArt:null});
    check(context.getImageData(0,0,800,400).data.some((value,index)=>index%4===3&&value>0),'Visible rendered pixels');
  })()`);
  console.log(
    "PASS: Waveform Prism control, persistence, finished spectrum and canvas rendering"
  );
});
