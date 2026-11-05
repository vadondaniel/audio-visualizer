// Run with: npx electron __tests__/bass-sensitivity.electron.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path"),
  fs = require("node:fs"),
  assert = require("node:assert/strict");

app.whenReady().then(async () => {
  let failed = false;
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "../src/preload.js"),
      additionalArguments: ["--app-packaged=true"],
      partition: "bass-sensitivity-check",
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  ipcMain.handle("get-performance-metrics", () => app.getAppMetrics());
  const errors = [];
  window.webContents.on("console-message", (e) => {
    if (e.level === "error") errors.push(e.message);
  });
  try {
    await window.loadFile(path.join(__dirname, "../src/index.html"));
    await window.webContents.executeJavaScript("window.rendererReady");
    const measured = await window.webContents.executeJavaScript(`(async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const detector = context.createAnalyser();
      const mute = context.createGain();
      detector.fftSize=2048;detector.smoothingTimeConstant=0;
      gain.gain.value=0.2;mute.gain.value=0;
      oscillator.connect(gain).connect(detector).connect(mute).connect(context.destination);
      const checkPipe=AudioPipeline.create();const db=new Float32Array(1024);
      const measure=()=>{detector.getFloatFrequencyData(db);return checkPipe.update({spectrumDb:db,frequencyBytes:new Uint8Array(1024),timeBytes:new Uint8Array(1024).fill(128),sampleRate:context.sampleRate},state,{dtSec:.1}).bassDriverLevel;};
      try {
        oscillator.frequency.value=100;oscillator.start();await context.resume();
        await new Promise(resolve=>setTimeout(resolve,150));
        const bass=measure();
        oscillator.frequency.value=1000;
        await new Promise(resolve=>setTimeout(resolve,150));
        return {bass,mid:measure()};
      } finally {
        oscillator.stop();await context.close();
      }
    })()`);
    assert.ok(measured.bass > 0.5, JSON.stringify(measured));
    assert.ok(measured.mid < 0.05, JSON.stringify(measured));
    console.log(
      "PASS: real Web Audio 100 Hz tone drives bass; equal-level 1 kHz tone is rejected"
    );
    const result = await window.webContents.executeJavaScript(`(() => {
      const check=(value,message)=>{if(!value)throw Error(message);};
      check(!state.bassSensitivityEnabled && state.bassSensitivityAmount===0.5,"Default is off with 50% amount");
      check(getComputedStyle(bassSensitivityAmountRow).display==="none","Amount hidden by default");
      bassSensitivityCheckbox.click();
      check(!bassSensitivityAmountRow.hidden,"Toggle reveals amount");
      bassSensitivityAmountSlider.value=75;
      bassSensitivityAmountSlider.dispatchEvent(new Event("input"));
      check(bassSensitivityAmountVal.textContent==="75%","Amount label");
      check(bassSensitivityRange.textContent.includes("0.25×") && bassSensitivityRange.textContent.includes("1.75×"),"Range label");
      valueHandlingSelect.value="logarithmic";
      valueHandlingSelect.dispatchEvent(new Event("change"));
      const controlPipe=AudioPipeline.create();const controlInput={spectrumDb:new Float32Array(1024).fill(-45),frequencyBytes:new Uint8Array(1024),timeBytes:new Uint8Array(1024).fill(128),sampleRate:48000};
      const process=()=>controlPipe.update(controlInput,state,{dtSec:.1});
      let processed;for(let i=0;i<30;i++)processed=process();
      check(Math.abs(processed.bassMultiplier-AudioMath.bassSensitivityTarget(0.5,0.75,"logarithmic"))<0.0001,"Curve is used by actual controls");
      bassSensitivityCheckbox.click();
      check(process().bassMultiplier===1,"Disabling resets immediately");
      bassSensitivityCheckbox.click();
      bassSensitivityAmountSlider.value=0;bassSensitivityAmountSlider.dispatchEvent(new Event("input"));
      processed=process();
      check(processed.bassMultiplier===1,"Zero amount preserves response");
      bassSensitivityAmountSlider.value=75;bassSensitivityAmountSlider.dispatchEvent(new Event("input"));
      return {amount:state.bassSensitivityAmount,curve:state.valueHandling};
    })()`);
    assert.equal(result.amount, 0.75);
    assert.equal(result.curve, "logarithmic");
    window.reload();
    await new Promise((resolve) =>
      window.webContents.once("did-finish-load", resolve)
    );
    await window.webContents.executeJavaScript("window.rendererReady");
    assert.equal(
      await window.webContents.executeJavaScript(
        "state.bassSensitivityEnabled && state.bassSensitivityAmount===0.75 && state.valueHandling==='logarithmic'"
      ),
      true
    );
    const modes = await window.webContents.executeJavaScript(`(() => {
      startOverlay.style.display="none";
      state.trailsEnabled=false;state.smoothingEnabled=false;
      bufferLength=1024;freqData=new Uint8Array(1024);timeData=new Uint8Array(1024);
      let inputBass=0;
      analyser={getByteFrequencyData:data=>{data.fill(100);data.fill(inputBass,0,15);},getByteTimeDomainData:data=>{for(let i=0;i<data.length;i++)data[i]=Math.round(128+35*Math.sin(i/16));},getFloatFrequencyData:data=>{for(let i=0;i<data.length;i++)data[i]=-65+35*Math.exp(-Math.pow((Math.log2(i+1)-4)/0.8,2));}};
      audioCtx={state:"running",sampleRate:48000};
      bassAnalyser={fftSize:2048,getFloatFrequencyData:data=>data.fill(inputBass===0?-Infinity:-25)};
      const originalRaf=window.requestAnimationFrame;
      window.requestAnimationFrame=()=>0;
      let timestamp=1000;
      const rendered=[];
      for(let mode=0;mode<MODES.length;mode++){
        state.mode=mode;syncSelectsToState();
        for(const bass of [0,255]){
          inputBass=bass;
          for(let frame=0;frame<5;frame++){timestamp+=1000/60;loop(timestamp);}
          if(!Number.isFinite(visualFrame.signals.bassMultiplier))throw Error("Nonfinite modulation in "+MODES[mode]);
        }
        rendered.push(MODES[mode]);
      }
      // Keep settings ready for the visual control check; no live capture is used.
      analyser=null;audioCtx=null;bassAnalyser=null;window.requestAnimationFrame=originalRaf;
      state.mode=MODES.indexOf("bars");syncSelectsToState();
      settingsBtn.click();
      [...settingsPanel.querySelectorAll(".settingsSectionTitle")].find(el=>el.textContent.trim()==="Audio").click();
      saveSettings();
      return rendered;
    })()`);
    assert.ok(
      modes.includes("bars") &&
        modes.includes("orbit") &&
        modes.includes("prism")
    );
    const dir = path.join(__dirname, "../dist/ui-check");
    fs.mkdirSync(dir, { recursive: true });
    for (const [width, height] of [
      [1280, 720],
      [640, 640],
    ]) {
      window.setContentSize(width, height);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await window.webContents.executeJavaScript("flashHud()");
      await window.webContents.executeJavaScript(
        "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"
      );
      const layout = await window.webContents.executeJavaScript(
        `(flashHud(), {visible:getComputedStyle(bassSensitivityAmountRow).display!=="none" && settingsPanel.classList.contains("visible"), fits:bassSensitivityAmountRow.scrollWidth<=bassSensitivityAmountRow.clientWidth, base:sensitivitySlider.value, range:bassSensitivityRange.textContent})`
      );
      assert.equal(layout.visible, true, JSON.stringify(layout));
      assert.equal(layout.fits, true);
      assert.equal(layout.base, "1");
      fs.writeFileSync(
        path.join(dir, `bass-sensitivity-${width}.png`),
        (await window.webContents.capturePage()).toPNG()
      );
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS: controls, curve wiring, range labels, immediate disable, zero amount, persistence, all registered modes, and two viewport sizes"
    );
  } catch (error) {
    console.error(error);
    console.error(errors);
    failed = true;
  } finally {
    window.destroy();
    app.exit(failed ? 1 : 0);
  }
});
