const { ipcMain } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { runCheck } = require("./helpers/electron-harness.cjs");
runCheck(async ({ createWindow, loadRenderer, waitForPaint, artifactDir }) => {
  const window = createWindow({
    width: 1000,
    height: 700,
    webPreferences: { backgroundThrottling: false },
  });
  ipcMain.handle("overlay-enter", () => ({
    active: true,
    locked: false,
    canLock: true,
    openSettings: false,
    error: null,
  }));
  ipcMain.handle("overlay-restore", () => ({
    active: false,
    locked: false,
    canLock: true,
    openSettings: false,
    error: null,
  }));
  await loadRenderer(window);
  const result = await window.webContents.executeJavaScript(`(async()=>{
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  check(MODES.at(-1)==='rope'&&ModeRegistry.indexOf('rope')===11,'Rope appends after historical indices');
  check(Array.from(modeSelect.options).some(o=>o.textContent==='Rope'),'Rope discovered in selector');
  settingsActions.selectMode('rope');check(state.ropeLayout==='circular','Circular default');
  const control=document.getElementById('ropeLayoutSelect');check(document.getElementById('ropeLayoutRow').style.display==='','Rope layout visible');
  check(document.getElementById('prismLayoutRow').style.display==='none','Prism-specific control hidden');
  const saved=Storage.prototype.setItem;let writes=0;Storage.prototype.setItem=function(key,value){if(key===SETTINGS_KEY)writes++;return saved.call(this,key,value);};
  try{control.value='straight';control.dispatchEvent(new Event('change',{bubbles:true}));check(writes===1,'One saved layout action');loadSettings();check(writes===1&&control.value==='straight'&&state.ropeLayout==='straight','Restoration has no write');}
  finally{Storage.prototype.setItem=saved;}
  const input={sampleRate:48000,frequencyBytes:new Uint8Array(1024).fill(140),timeBytes:new Uint8Array(1024).fill(128),spectrumDb:new Float32Array(1024).fill(-40)};
  const pipeline=AudioPipeline.create();pipeline.update(input,state,{dtSec:1/60});const signals=pipeline.forMode('rope');check(signals.bands.length===96&&signals.bands.some(v=>v>0),'Finished Rope spectrum');
  const services={constants:{VISUAL_TUNING,THEMES},palette:{currentHue,themeCssColor},applyGlow:ModeRuntime.applyGlow,restore:ModeRuntime.restore,createRandom:()=>ModeRuntime.createRandom(123),loadImage:src=>{const image=new Image();image.src=src;return image;}};
  const sheets=[];let scenarios=0;
  for(const theme of ['Neon','White','Rainbow Cycle']){
   settingsActions.set('theme',themeIds.indexOf(theme));
   const sheet=document.createElement('canvas');sheet.width=1280;sheet.height=1750;
   const sheetCtx=sheet.getContext('2d');sheetCtx.fillStyle='#08080d';sheetCtx.fillRect(0,0,sheet.width,sheet.height);
   for(const [row,layout]of ['circular','circular-2','circular-4','straight','straight-2'].entries()){
    const mode=ModeRegistry.getFactories().rope(services),target=document.createElement('canvas');target.width=target.height=320;const ctx=target.getContext('2d',{willReadFrequently:true});
    const bands=new Float64Array(96),frame={width:320,height:320,settings:{...state,ropeLayout:layout,glowIntensity:1},signals:{...signals,bands},beat:{pulse:0,justHit:false},timestampMs:0,elapsedMs:1000/240,dtSec:1/240,audioClockMs:0,mediaArt:null};
    const baseline=mode.getOverlayBounds(frame);mode.update({...frame,dtSec:0});
    let checkpoint=0;
    for(let step=0;step<=1200;step++){
     if([0,24,120,1200].includes(step)){
      ctx.clearRect(0,0,320,320);mode.draw(ctx,frame);
      const pixels=ctx.getImageData(0,0,320,320).data;
      check(pixels.some((v,i)=>i%4===3&&v>0),'Visible '+layout+' '+theme+' '+step);
      const before=pixels.slice();ctx.clearRect(0,0,320,320);mode.draw(ctx,frame);
      check(ctx.getImageData(0,0,320,320).data.every((v,i)=>v===before[i]),'Repeated draw advances no simulation');
      sheetCtx.drawImage(target,checkpoint*320,row*350+30);sheetCtx.fillStyle='#ddd';sheetCtx.font='15px sans-serif';sheetCtx.fillText(layout+' '+['rest','pull (0.1s)','rebound (0.5s)','settled (5s)'][checkpoint],checkpoint*320+10,row*350+20);checkpoint++;
     }
     bands.fill(0);if(step<24)bands.fill(1,20,28);mode.update(frame);frame.timestampMs+=1000/240;
    }
    for(const [width,height]of [[160,160],[640,320],[320,640],[1280,720]])for(const glow of [0,1,2.5]){
     target.width=width;target.height=height;frame.width=width;frame.height=height;frame.settings.glowIntensity=glow;
     bands.fill(1);for(let i=0;i<12;i++)mode.update(frame);mode.draw(ctx,frame);
     const bounds=mode.getRenderBounds(frame),fit=mode.getOverlayBounds(frame);
     if(layout.startsWith('straight')){check(bounds===null&&fit===null,'Straight viewport bounds');}
     else{
      check(bounds&&fit&&bounds.width>=fit.width,'Circular reusable bounds');
      const pixels=ctx.getImageData(0,0,width,height).data;let outside=0;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<Math.floor(bounds.x)||y<Math.floor(bounds.y)||x>=Math.ceil(bounds.x+bounds.width)||y>=Math.ceil(bounds.y+bounds.height))outside+=pixels[(y*width+x)*4+3];
      check(outside===0,'No visible pixels excluded by conservative bounds');
     }
     scenarios++;
    }
    check((layout.startsWith('straight'))===(baseline===null),'Layout bounds match framing');
   }
   sheets.push({theme,png:sheet.toDataURL('image/png').split(',')[1]});
  }
  // Drive the actual host at a capped drawing rate while audio and springs keep updating.
  settingsActions.set('theme',themeIds.indexOf('Neon'));settingsActions.set('ropeLayout','circular');settingsActions.set('miniOverlayMaxFps',15);settingsActions.selectOverlayMode('rope');
  analyser={getFloatFrequencyData:data=>data.fill(-35),getByteFrequencyData:data=>data.fill(140),getByteTimeDomainData:data=>data.fill(128)};bassAnalyser=analyser;audioCtx={state:'running',sampleRate:48000};freqData=new Uint8Array(1024);timeData=new Uint8Array(2048);
  await overlayUI.enter();let updates=0,draws=0;const update=visualModeController.update,draw=visualModeController.draw,raf=window.requestAnimationFrame;
  try{window.requestAnimationFrame=()=>0;visualModeController.update=(...args)=>{updates++;return update(...args);};visualModeController.draw=(...args)=>{draws++;return draw(...args);};
   for(let i=0;i<30;i++)loop(10000+i*1000/60);check(updates===30&&draws<10&&draws>0,'Simulation advances between capped draws');
   const history=trailFrames.length;settingsActions.set('ropeLayout','straight');check(trailFrames.length===history,'Layout retains existing trail history');
   loop(11000);const latest=trailFrames.at(-1);check(latest&&latest.x===0&&latest.y===0&&latest.canvas.width===renderCanvas.width,'Straight uses full-canvas trail snapshots');
  }finally{visualModeController.update=update;visualModeController.draw=draw;window.requestAnimationFrame=raf;analyser=bassAnalyser=audioCtx=null;}
  await overlayUI.restore();settingsActions.set('ropeLayout','straight');startOverlay.style.display='none';settingsPanel.dispatchEvent(new MouseEvent('mouseenter'));panelOpen=true;flashHud();
  return {sheets,scenarios,updates,draws};
 })()`);
  for (const sheet of result.sheets)
    fs.writeFileSync(
      path.join(artifactDir, "rope-" + sheet.theme.replace(/ /g, "-") + ".png"),
      Buffer.from(sheet.png, "base64")
    );
  await waitForPaint(window, ["#settingsPanel"]);
  fs.writeFileSync(
    path.join(artifactDir, "rope-controls.png"),
    (await window.webContents.capturePage()).toPNG()
  );
  assert.equal(result.scenarios, 180);
  ipcMain.removeHandler("overlay-enter");
  ipcMain.removeHandler("overlay-restore");
  console.log(
    "PASS: Rope controls, persistence, 180 palette/glow/size bounds scenarios, deterministic pulse/rebound sheets, repeatable pixels, capped simulation, switching and trails"
  );
});
