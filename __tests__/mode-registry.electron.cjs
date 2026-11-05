const { runCheck } = require("./helpers/electron-harness.cjs");
// Run with: npm run test:electron -- mode-registry
const { net } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { fileURLToPath } = require("node:url");
runCheck(async ({ createWindow, loadRenderer, expectRendererErrors }) => {
  const window = createWindow({
    packaged: false,
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      partition: "registry-integration",

      backgroundThrottling: false,
    },
  });

  let failure = null;
  const registryPath = path.resolve(__dirname, "../src/mode-registry.js");
  const syntheticPath = path.resolve(__dirname, "../src/visuals/test-mode.js");
  window.webContents.session.protocol.handle("file", async (request) => {
    const file = path.resolve(fileURLToPath(request.url));
    if (file === registryPath) {
      const source =
        fs.readFileSync(registryPath, "utf8") +
        `\n{
    const base=globalThis.ModeRegistry;
    const extra={...base.get('bars'),id:'test-mode',label:'Test Mode',modulePath:'visuals/test-mode.js',media:{...base.get('bars').media,defaultPosition:'bottom'}};
    if(!sessionStorage.getItem('registry-test-seeded')){
      localStorage.setItem('audioVisualizerSettings',JSON.stringify({mode:9,modeOrder:[...base.ids].reverse(),disabledModes:['bars'],mediaTextPositions:{radial:'above',orbit:'bottom-right'}}));
      sessionStorage.setItem('registry-test-seeded','true');
    }
    globalThis.ModeRegistry=Object.freeze({...base.createRegistry([...base.entries,extra]),createRegistry:base.createRegistry});
   }`;
      return new Response(source, {
        headers: { "content-type": "application/javascript" },
      });
    }
    if (file === syntheticPath) {
      if (failure === "missing")
        return new Response("missing", { status: 404 });
      const code =
        failure === "runtime"
          ? 'throw Error("Synthetic runtime failure");'
          : failure === "unregistered"
            ? "// deliberately no factory"
            : `ModeRegistry.registerFactory('test-mode',services=>ModeRegistry.getFactories().bars(services));`;
      return new Response(code, {
        headers: { "content-type": "application/javascript" },
      });
    }
    return net.fetch(request.url, { bypassCustomProtocolHandlers: true });
  });

  try {
    await loadRenderer(window);
    const result = await window.webContents.executeJavaScript(`(()=>{
    const check=(value,message)=>{if(!value)throw Error(message);};
    check(!startBtn.disabled,'Start becomes enabled after readiness');
    check(MODES[state.mode]==='orbit','Old numeric selection still means Orbit');
    check(state.modeOrder[0]==='prism'&&state.modeOrder.at(-1)==='test-mode','Saved order preserved and new mode appended');
    check(state.disabledModes.includes('bars')&&!state.disabledModes.includes('test-mode'),'New mode enabled without changing disabled modes');
    check(state.mediaTextPositions.radial==='above'&&state.mediaTextPositions.orbit==='bottom-right'&&state.mediaTextPositions['test-mode']==='bottom','Saved and new media defaults');
    check([...modeSelect.options].some(option=>option.textContent==='Test Mode'),'Selector discovers registry label');
    manageModesBtn.click();check([...modeManagerList.children].some(row=>row.dataset.mode==='test-mode'),'Manager discovers new registry entry');setModeManagerOpen(false);
    state.mode=MODES.indexOf('test-mode');syncSelectsToState();
    check(mediaOverlay.dataset.mediaLayout==='free'&&mediaOverlay.dataset.position==='bottom','Synthetic mode uses media capabilities');
    const pipe=AudioPipeline.create();pipe.update({sampleRate:48000,spectrumDb:new Float32Array(1024).fill(-45),frequencyBytes:new Uint8Array(1024).fill(120),timeBytes:new Uint8Array(1024).fill(128)},state,{dtSec:.1});
    check(pipe.forMode('test-mode').bands.length===96,'Synthetic mode uses declared sampler');
    return {count:MODES.length,factories:Object.keys(ModeRegistry.getFactories()).length};
  })()`);
    assert.equal(result.count, 12);
    assert.equal(result.factories, 12);
    // The benchmark must discover the new mode through the same metadata.
    await window.webContents.executeJavaScript(
      `window.__audioVisualizerBenchmark={requestedModes:['test-mode'],scenarios:['silence'],repeats:1,warmupMs:1,durationMs:80,operationCounts:false,renderTracing:false};\n` +
        fs.readFileSync(
          path.join(__dirname, "../benchmarks/benchmark-renderer.js"),
          "utf8"
        )
    );
    const benchmark = await window.webContents.executeJavaScript(
      "window.__runAudioVisualizerBenchmark()"
    );
    assert.equal(benchmark.results.length, 1);
    assert.equal(benchmark.results[0].mode, "test-mode");
    for (const kind of ["missing", "unregistered", "runtime"]) {
      failure = kind;
      await expectRendererErrors(
        window,
        /Could not load visuals\/test-mode\.js|Module did not register mode: test-mode|Synthetic runtime failure|Failed to load resource/,
        async () => {
          await loadRenderer(window, { waitForReady: false });
          const error = await window.webContents.executeJavaScript(
            "window.rendererReady.then(()=>null,error=>error.message)"
          );
          assert.ok(error, `Startup must reject ${kind}`);
          const visible = await window.webContents.executeJavaScript(
            `({disabled:document.getElementById('startBtn').disabled,error:getComputedStyle(document.getElementById('errorMsg')).display,message:document.getElementById('errorMsg').textContent,host:typeof visualModeController})`
          );
          assert.equal(visible.disabled, true);
          assert.equal(visible.error, "block");
          assert.match(visible.message, /Could not initialize/);
          assert.equal(visible.host, "undefined");
        }
      );
    }
    console.log(
      "PASS: synthetic mode discovery, saved settings, selector/manager, media defaults, benchmark discovery, and visible startup failures"
    );
  } finally {
    window.webContents.session.protocol.unhandle("file");
  }
});
