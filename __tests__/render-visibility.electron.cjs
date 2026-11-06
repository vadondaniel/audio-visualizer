const { ipcMain } = require("electron");
const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(async ({ createWindow, loadRenderer }) => {
  const window = createWindow({ width: 800, height: 600 });
  const presentation = (active) => ({
    active,
    locked: false,
    canLock: true,
    openSettings: false,
    error: null,
  });
  ipcMain.handle("overlay-enter", () => presentation(true));
  ipcMain.handle("overlay-restore", () => presentation(false));
  try {
    await loadRenderer(window);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const check=(value,message)=>{if(!value)throw Error(message);};
      const setProperty=CSSStyleDeclaration.prototype.setProperty;
      let textWrites=0,fxWrites=0,backgroundDraws=0;
      CSSStyleDeclaration.prototype.setProperty=function(key,value,priority){
        if(key.startsWith('--media-char-'))textWrites++;
        if(this===fxOverlay.style)fxWrites++;
        return setProperty.call(this,key,value,priority);
      };
      const fill=bgCtx.fillRect;
      bgCtx.fillRect=function(...args){backgroundDraws++;return fill.apply(this,args);};
      const raf=window.requestAnimationFrame;
      try {
        settingsActions.set('mediaMetadataEnabled',true);
        settingsActions.set('mediaDisplay','title-artist');
        settingsActions.set('theme',THEMES.findIndex(t=>!t.colorCycle&&!t.cycle));
        updateMediaMetadata({available:true,title:'AB',artist:'CD'});
        textWrites=0;
        for(let i=0;i<144;i++)syncMediaThemeColors();
        check(textWrites===0,'Unchanged static frames write zero character properties');
        settingsActions.set('theme',THEMES.findIndex(t=>t.rainbow&&t.cycle));
        textWrites=0;state.hueShift=19.123;syncMediaThemeColors();
        check(textWrites===8,'Cycling frame writes only palette properties');
        check(mediaTitle.firstChild.style.getPropertyValue('--media-char-stroke')===themeCssColor(currentHue(0),95,68,1),'Exact renderer cycle color');
        await overlayUI.enter();
        textWrites=0;state.hueShift=71.25;syncMediaThemeColors();
        check(textWrites===0,'Overlay skips external text painting');
        updateMediaMetadata({available:true,title:'NEW',artist:'CD'});
        textWrites=0;syncMediaThemeColors();
        check(textWrites===0,'Hidden metadata remains unpainted');
        check(!analyser,'Return test has no capture');
        await overlayUI.restore();
        check(textWrites===13,'Return immediately paints new title and current artist without capture');
        check(mediaTitle.firstChild.style.getPropertyValue('--media-char-stroke')===themeCssColor(currentHue(0),95,68,1),'Return uses latest hue');
        settingsActions.set('mediaDisplay','cover');textWrites=0;state.hueShift++;syncMediaThemeColors();
        check(textWrites===0,'Cover-only skips text painting');
        settingsActions.set('mediaDisplay','title');
        check(textWrites===6,'Title visibility paints only its palette');
        settingsActions.set('glowIntensity',.5);
        check(mediaTitle.firstChild.style.getPropertyValue('--media-char-glow-blur')==='5.0px','Glow setting refreshes without capture');
        await overlayUI.enter();
        settingsActions.set('miniOverlayShowBackground',false);
        settingsActions.set('miniOverlayMaxFps',30);
        settingsActions.set('reactiveVignette',true);settingsActions.set('beatFlash',true);
        window.requestAnimationFrame=()=>0;
        bufferLength=1024;freqData=new Uint8Array(1024);timeData=new Uint8Array(2048);
        analyser={getFloatFrequencyData:data=>data.fill(-40),getByteFrequencyData:data=>data.fill(140),getByteTimeDomainData:data=>data.fill(128)};
        bassAnalyser=analyser;audioCtx={state:'running',sampleRate:48000};
        let ticks=1000;
        for(const type of ['nebula','grid','stars']){
          settingsActions.set('bgType',type);
          overlayDrawSchedule.reset();backgroundDraws=0;fxWrites=0;
          for(let i=0;i<60;i++)loop(ticks+i*1000/60);
          check(backgroundDraws===0,'Hidden background never draws: '+type);
          check(fxWrites===0,'Hidden effects never write: '+type);
          ticks+=1000;
        }
        settingsActions.set('miniOverlayShowBackground',true);
        backgroundDraws=0;
        for(let i=0;i<60;i++)loop(ticks+i*1000/60);
        check(backgroundDraws===30,'Background draws at overlay FPS cap when enabled');
        check(fxWrites===0,'Effects stay hidden with background enabled');
        analyser=null;
        await overlayUI.restore();
        analyser=bassAnalyser;fxWrites=0;
        loop(ticks+1000);
        check(fxWrites===5,'Normal presentation refreshes all enabled live effects');
        return {staticCharacterWritesPer144Frames:0,cyclingWritesPer4Characters:8,hiddenBackgroundDraws:0,overlayFxWrites:0};
      } finally {
        analyser=null;bassAnalyser=null;audioCtx=null;
        window.requestAnimationFrame=raf;
        CSSStyleDeclaration.prototype.setProperty=setProperty;
        bgCtx.fillRect=fill;
      }
    })()`);
    console.log(JSON.stringify(result));
  } finally {
    ipcMain.removeHandler("overlay-enter");
    ipcMain.removeHandler("overlay-restore");
  }
});
