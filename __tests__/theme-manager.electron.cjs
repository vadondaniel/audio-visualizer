const { runCheck } = require("./helpers/electron-harness.cjs");
const fs = require("node:fs"),
  path = require("node:path");
const assert = require("node:assert/strict");
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
      width: 1280,
      height: 720,
      webPreferences: {
        backgroundThrottling: false,
        partition: "theme-manager-check",
      },
    });
    await loadRenderer(window);
    const saved = await window.webContents.executeJavaScript(`(()=>{
    const check=(value,message)=>{if(!value)throw Error(message);};
    const control=(id,action)=>Array.from(themeManagerList.querySelectorAll('[data-theme]')).find(el=>el.dataset.theme===id&&el.dataset.action===action);
    check(themeSelect.options.length===THEMES.length&&state.theme===0,'Old numeric selection');
    startOverlay.style.display='none';panelOpen=true;flashHud();manageThemesBtn.click();
    check(themeManager.open&&themeManager.matches(':modal')&&!settingsPanel.contains(themeManager),'Separate theme dialog');
    let saves=0;const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key===SETTINGS_KEY)saves++;return write.call(this,key,value);};
    try{
      const data=new DataTransfer(),row=Array.from(themeManagerList.children).find(row=>row.dataset.theme==='Rainbow Cycle'),target=themeManagerList.firstElementChild;
      row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientY:target.getBoundingClientRect().top+1}));
      themeManagerList.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));
      check(state.themeOrder[0]==='Rainbow Cycle'&&state.theme===0&&saves===1,'Drag order and single-save; current selection preserved');
      const prior=state.themeOrder.join();const cancelled=themeManagerList.lastElementChild;
      cancelled.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));
      themeManagerList.firstElementChild.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:data,clientY:0}));
      cancelled.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:data}));
      check(state.themeOrder.join()===prior&&!themeManagerList.querySelector('[data-drop]'),'Cancelled drag preserves order and clears feedback');
      const handle=control('Fire','reorder');handle.focus();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
      check(state.themeOrder[1]==='Fire'&&document.activeElement.dataset.theme==='Fire','Keyboard reorder retains focus');
      control('Neon','enable').click();check(THEMES[state.theme].name==='Rainbow Cycle','Disabled selected fallback');
      check(themeSelect.options[0].textContent==='Rainbow Cycle'&&!Array.from(themeSelect.options).some(option=>option.textContent==='Neon'),'Filtered ordered dropdown');
      const beforeKey=state.theme;window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}));check(state.theme===beforeKey,'No global shortcuts while managing');
      setThemeManagerOpen(false);window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}));check(THEMES[state.theme].name==='Fire','C follows enabled order');
      const options=Array.from(themeSelect.options);themeSelect.value=options.at(-1).value;themeSelect.dispatchEvent(new Event('change'));window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}));check(THEMES[state.theme].name==='Rainbow Cycle','C wraps');
      setThemeManagerOpen(true);
      for(const id of state.themeOrder)if(id!=='Ice'&&!state.disabledThemes.includes(id))control(id,'enable').click();
      check(control('Ice','enable').disabled,'Last enabled theme protected');
      setThemeManagerOpen(false);window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}));check(THEMES[state.theme].name==='Ice','Single theme cycling');
      // Re-enable all without changing the current canonical numeric index.
      settingsActions.setThemePreferences({order:state.themeOrder,disabled:[]});
      manageThemesBtn.click();window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      check(!themeManager.open&&document.activeElement===manageThemesBtn,'Escape closes dialog and restores focus');
      manageThemesBtn.click();document.getElementById('closeThemeManagerBtn').click();check(!themeManager.open,'Close theme dialog');
      manageThemesBtn.click();themeManager.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:0,clientY:0}));check(!themeManager.open,'Theme backdrop dismissal');
      // Both consumers use the shared manager: retain mode reorder/toggle behavior.
      manageModesBtn.click();const modesBefore=state.modeOrder.join();
      modeManagerList.querySelector('[data-mode="radial"][data-action="reorder"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
      check(state.modeOrder[0]==='radial'&&state.modeOrder.join()!==modesBefore,'Mode manager retains keyboard behavior');
      setModeManagerOpen(false);
    }finally{Storage.prototype.setItem=write;}
    return {order:state.themeOrder,disabled:state.disabledThemes,theme:state.theme};
  })()`);
    await reloadRenderer(window);
    assert.deepEqual(
      await window.webContents.executeJavaScript(
        "({order:state.themeOrder,disabled:state.disabledThemes,theme:state.theme})"
      ),
      saved
    );
    for (const width of [1280, 360]) {
      await setViewport(window, width, 720);
      await window.webContents.executeJavaScript(
        `startOverlay.style.display='none';panelOpen=true;flashHud();setThemeManagerOpen(true);`
      );
      await waitForPaint(window, ["#themeManager"]);
      const fit = await window.webContents.executeJavaScript(
        `(()=>{const rect=themeManager.getBoundingClientRect();return {fits:rect.width<=innerWidth&&rect.height<=innerHeight,overflow:themeManagerList.scrollWidth>themeManagerList.clientWidth};})()`
      );
      assert.equal(fit.fits, true);
      assert.equal(fit.overflow, false);
      fs.writeFileSync(
        path.join(artifactDir, "themes-" + width + ".png"),
        (await window.webContents.capturePage()).toPNG()
      );
      await window.webContents.executeJavaScript(
        `document.getElementById('doneThemeManagerBtn').click();if(themeManager.open||document.activeElement!==manageThemesBtn)throw Error('Done focus');`
      );
    }
    console.log(
      "PASS: theme modal, drag/cancel, keyboard ordering, enabled filtering, selection fallback, C cycling, persistence, responsive layout and shared mode manager"
    );
  }
);
