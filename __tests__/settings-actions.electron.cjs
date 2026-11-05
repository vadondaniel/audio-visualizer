const { runCheck } = require("./helpers/electron-harness.cjs");
// Run with: npm run test:electron -- settings-actions

runCheck(async ({ createWindow, loadRenderer, errors }) => {
  const window = createWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: "settings-actions-check",

      backgroundThrottling: false,
    },
  });

  await loadRenderer(window);
  await window.webContents.executeJavaScript(`(async()=>{
      const check=(condition,message)=>{if(!condition)throw Error(message);};
      let writes=0,mediaRefreshes=0;
      const originalSave=Storage.prototype.setItem,originalMedia=updateMediaLayout;
      Storage.prototype.setItem=function(key,value){if(key===SETTINGS_KEY)writes++;return originalSave.call(this,key,value);};
      updateMediaLayout=function(){mediaRefreshes++;return originalMedia();};
      const event=(control,value,type='change')=>{control[control.type==='checkbox'?'checked':'value']=value;control.dispatchEvent(new Event(type,{bubbles:true}));};
      const key=value=>window.dispatchEvent(new KeyboardEvent('keydown',{key:value}));
      const saved=()=>JSON.parse(localStorage.getItem(SETTINGS_KEY));
      try{
        // Restore deliberately old preferences without saving during hydration.
        originalSave.call(localStorage,SETTINGS_KEY,JSON.stringify({mode:9,modeOrder:[...MODES].reverse(),disabledModes:['bars'],mediaArtistPosition:'above',theme:0}));
        loadSettings();
        check(writes===0,'Restoration must not write settings');
        check(state.mode===9&&state.modeOrder[0]==='prism'&&state.disabledModes.includes('bars'),'Legacy selection and mode preferences');
        check(state.mediaTextPositions.radial==='above'&&state.mediaTextPositions.cascade==='above','Legacy media migration');

        writes=0;mediaRefreshes=0;event(themeSelect,'1');
        check(writes===1&&mediaRefreshes===1,'Theme dropdown saves and refreshes media once');
        const selected={theme:state.theme,select:themeSelect.value,accent:document.documentElement.style.getPropertyValue('--accent-rgb'),gradient:colorGradientRow.style.display};
        event(themeSelect,'0');writes=0;mediaRefreshes=0;key('c');
        check(JSON.stringify(selected)===JSON.stringify({theme:state.theme,select:themeSelect.value,accent:document.documentElement.style.getPropertyValue('--accent-rgb'),gradient:colorGradientRow.style.display}),'Theme shortcut matches dropdown');
        check(writes===1&&mediaRefreshes===1,'Theme shortcut saves and refreshes media once');

        const target=ModeList.enabled(state.modeOrder,state.disabledModes)[1];
        writes=0;mediaRefreshes=0;event(modeSelect,String(MODES.indexOf(target)));
        const modeView={mode:state.mode,select:modeSelect.value,layout:mediaOverlay.dataset.mediaLayout,position:mediaTextPositionSelect.value};
        check(writes===1&&mediaRefreshes===1,'Mode dropdown saves and refreshes once');
        settingsActions.selectMode(ModeList.enabled(state.modeOrder,state.disabledModes)[0]);writes=0;mediaRefreshes=0;key('2');
        check(JSON.stringify(modeView)===JSON.stringify({mode:state.mode,select:modeSelect.value,layout:mediaOverlay.dataset.mediaLayout,position:mediaTextPositionSelect.value}),'Number shortcut matches dropdown');
        check(writes===1&&mediaRefreshes===1,'Mode shortcut saves and refreshes once');

        writes=0;event(sensitivitySlider,'1.8','input');
        check(state.sensitivity===1.8&&sensitivityVal.textContent==='1.8x'&&saved().sensitivity===1.8&&writes===1,'Sensitivity input, label and persistence');
        event(bassSensitivityCheckbox,true);event(bassSensitivityAmountSlider,'75','input');
        check(!bassSensitivityAmountRow.hidden&&state.bassSensitivityAmount===.75&&bassSensitivityAmountVal.textContent==='75%','Bass controls');
        event(trailsCheckbox,false);check(trailDurationRow.style.display==='none','Trail rows hide');
        event(trailsCheckbox,true);event(trailDurationSlider,'300','input');event(trailFpsSlider,'30','input');
        check(trailDurationVal.textContent==='300ms'&&trailFpsVal.textContent==='30 FPS','Trail labels');
        event(crtFilterCheckbox,true);check(fxOverlay.classList.contains('has-crt'),'FX application');

        event(mediaMetadataCheckbox,true);event(mediaDisplaySelect,'title-artist');
        settingsActions.selectMode('radial');event(mediaTextPositionSelect,'above');
        check(!mediaTextPositionRow.hidden&&mediaOverlay.dataset.position==='above','Focus media positioning');
        settingsActions.selectMode('orbit');event(mediaTextPositionSelect,'bottom-right');
        settingsActions.selectMode('radial');check(mediaTextPositionSelect.value==='above','Per-mode media positions');
        const positions=JSON.stringify(state.mediaTextPositions);updateMediaLayout();
        check(JSON.stringify(state.mediaTextPositions)===positions,'Rendering must not mutate preferences');

        const imageBytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNXYAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
        const transfer=new DataTransfer();transfer.items.add(new File([imageBytes],'settings-test.png',{type:'image/png'}));
        bgImageInput.files=transfer.files;writes=0;bgImageInput.dispatchEvent(new Event('change',{bubbles:true}));
        const deadline=performance.now()+2000;
        while(state.bgImageName!=='settings-test.png'&&performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
        check(state.bgType==='image'&&state.bgImageName==='settings-test.png'&&bgLayer.style.backgroundImage.includes('data:image/png')&&writes===1,'File input commits image once');
        event(brightnessSlider,'0.8','input');event(blurSlider,'4','input');
        check(bgLayer.style.filter.includes('brightness(0.8)')&&bgLayer.style.filter.includes('blur(4px)'),'Image controls apply');
        writes=0;clearBgImageBtn.click();
        check(state.bgType==='color'&&state.bgImageDataUrl===null&&state.bgImageName===null&&bgImageInput.value===''&&writes===1,'Image clearing is atomic');

        const before=saved();writes=0;loadSettings();
        check(writes===0&&JSON.stringify(saved())===JSON.stringify(before),'Restoring current preferences never saves');
        check(sensitivitySlider.value==='1.8'&&trailFpsSlider.value==='30'&&crtFilterCheckbox.checked&&bassSensitivityAmountSlider.value==='75','Restored controls');
      }finally{
        Storage.prototype.setItem=originalSave;updateMediaLayout=originalMedia;settingsActions.dispose();
      }
    })()`);
  for (const width of [1280, 360]) {
    window.setContentSize(width, 720);
    await window.webContents.executeJavaScript(
      `(()=>{settingsActions.selectMode('radial');settingsActions.setMediaPosition('radial','above');if(mediaOverlay.dataset.mediaLayout!=='focus'||mediaTextPositionSelect.value!=='above')throw Error('Focus layout');settingsActions.selectMode('orbit');settingsActions.setMediaPosition('orbit','bottom-right');if(mediaOverlay.dataset.mediaLayout!=='free'||mediaTextPositionSelect.value!=='bottom-right')throw Error('Free layout');})()`
    );
  }
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: settings controls, shortcut parity, single-save/media effects, legacy restoration, image input/clear, persistence, and desktop/narrow media positions"
  );
});
