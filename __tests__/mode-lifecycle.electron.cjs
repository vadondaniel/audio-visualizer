// Run with: npx electron __tests__/mode-lifecycle.electron.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "../src/preload.js"),
      additionalArguments: ["--app-packaged=true"],
      partition: "mode-lifecycle-check",
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  ipcMain.handle("get-performance-metrics", () => []);
  let failed = false;
  const errors = [];
  window.webContents.on("console-message", (e) => {
    if (e.level === "error") errors.push(e.message);
  });
  try {
    await window.loadFile(path.join(__dirname, "../src/index.html"));
    await window.webContents.executeJavaScript("window.rendererReady");
    await window.webContents.executeJavaScript(`(async () => {
      const check=(value,message)=>{if(!value)throw Error(message);};
      state.trailsEnabled=false;state.mediaMetadataEnabled=false;
      const installInput=()=>{
        bufferLength=1024;freqData=new Uint8Array(1024).fill(150);timeData=new Uint8Array(1024).fill(128);
        analyser={getFloatFrequencyData:data=>data.fill(-35)};
        audioCtx={sampleRate:48000,state:"running",close:async()=>{}};
      };
      installInput();
      const render=id=>{
        state.mode=MODES.indexOf(id);clearFrame();
        visualModeController.render(id,ctx,prepareVisualFrame(1000,1000/60,130,.5,.4,.3));
      };
      const originalRotate=ctx.rotate.bind(ctx);const rotations=[];
      ctx.rotate=angle=>{rotations.push(angle);originalRotate(angle);};
      render("orbit");const first=rotations.at(-1);
      render("prism");render("orbit");
      check(Math.abs(rotations.at(-1)-first*2)<1e-10,"Switching retains Orbit state and inactive modes do not advance");
      state.sensitivity=1.5;render("orbit");
      check(Math.abs(rotations.at(-1)-first*3)<1e-10,"Settings retain mode state");
      resize();render("orbit");
      check(Math.abs(rotations.at(-1)-first*4)<1e-10,"Resize retains mode state");
      cleanupAudioCapture();installInput();render("orbit");
      check(Math.abs(rotations.at(-1)-first)<1e-10,"Capture restart resets mode state");
      ctx.rotate=originalRotate;
      beatJustHit=true;render("bars");check(beatJustHit,"Other modes do not consume a pending beat");
      render("particles");check(!beatJustHit,"Host consumes Particles' beat after update");
      const image=new Image();image.src="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>');
      await image.decode();
      mediaState.thumbnailImage=image;mediaState.metadata={thumbnailDataUrl:image.src};
      state.mediaMetadataEnabled=true;state.mediaDisplay="cover-title-artist";
      check(prepareVisualFrame(1000,16,0,0,0,0).mediaArt===image,"Host resolves valid cover");
      const drawImage=ctx.drawImage.bind(ctx);let covers=0;
      ctx.drawImage=(...args)=>{if(args[0]===image)covers++;drawImage(...args);};
      render("radial");render("cascade");check(covers===2,"Radial and Cascade render the resolved cover");
      ctx.drawImage=drawImage;
      state.mediaDisplay="title";
      check(prepareVisualFrame(1000,16,0,0,0,0).mediaArt===null,"Title-only display excludes the cover");
      state.mediaDisplay="cover";state.mediaMetadataEnabled=false;
      check(prepareVisualFrame(1000,16,0,0,0,0).mediaArt===null,"Disabled metadata excludes cover");
      cleanupAudioCapture();
    })()`);
    if (errors.length) throw Error(errors.join("\n"));
    console.log(
      "PASS: mode switching, settings, resize, capture reset, beat ownership, and media-art routing"
    );
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.destroy();
    app.exit(failed ? 1 : 0);
  }
});
