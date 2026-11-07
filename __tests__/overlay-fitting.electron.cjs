const { ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(
  async ({
    createWindow,
    loadRenderer,
    setViewport,
    waitFor,
    waitForPaint,
    artifactDir,
  }) => {
    const window = createWindow({
      width: 320,
      height: 320,
      frame: false,
      minWidth: 160,
      minHeight: 160,
      backgroundColor: "#101018",
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
    try {
      await loadRenderer(window);
      await window.webContents.executeJavaScript(`(async()=>{
      const art=new Image();art.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#ff6f40"/><circle cx="40" cy="20" r="20" fill="#243780"/></svg>');await art.decode();
      window.overlayFitTest={art,time:1000,level:1,observations:[],rotations:[],activeId:null};
      settingsActions.selectMode('orbit');settingsActions.set('miniOverlayScale',1);
      settingsActions.set('miniOverlayMode','follow');settingsActions.set('miniOverlayMaxFps',60);
      settingsActions.set('trailsEnabled',true);settingsActions.set('miniOverlayShowBackground',true);settingsActions.set('bgType','grid');
      await overlayUI.enter();
    })()`);
      for (const [width, height] of [
        [320, 320],
        [640, 320],
        [320, 640],
        [160, 160],
      ]) {
        await setViewport(window, width, height);
        await waitFor(
          "canvas resized with overlay viewport",
          () =>
            window.webContents.executeJavaScript(
              "({width:canvas.width,height:canvas.height,innerWidth,innerHeight})"
            ),
          (value) =>
            value.width === value.innerWidth &&
            value.height === value.innerHeight,
          { window }
        );
        await window.webContents.executeJavaScript(`(()=>{
        const check=(value,message)=>{if(!value)throw Error(message);},near=(a,b)=>Math.abs(a-b)<1e-4; // Native Canvas matrices use Float32 precision.
        const test=window.overlayFitTest,normal=state.mode;
        const input={getFloatFrequencyData:data=>data.fill(-30),getByteFrequencyData:data=>data.fill(190),getByteTimeDomainData:data=>data.fill(128)};
        const prepare=prepareVisualFrame,draw=visualModeController.draw,rotate=ctx.rotate,background=drawProceduralBackground,raf=window.requestAnimationFrame;
        let observed;
        try{
          window.requestAnimationFrame=()=>0;
          freqData=new Uint8Array(1024);timeData=new Uint8Array(2048);bufferLength=1024;
          analyser=bassAnalyser=input;audioCtx={state:'running',sampleRate:48000};
          prepareVisualFrame=(...args)=>{
            const frame=prepare(...args),level=test.level;
            frame.signals={...frame.signals,levels:{bass:level,mid:level,treble:level},bands:new Float64Array(ModeRegistry.get(args[2]).audio.count).fill(level)};
            frame.beat={pulse:level,justHit:false};frame.mediaArt=test.art;return frame;
          };
          ctx.rotate=function(angle){if(test.activeId==='orbit')test.rotations.push(angle);return rotate.call(this,angle);};
          visualModeController.draw=(id,target,frame)=>{
            const matrix=target.getTransform();observed={id,matrix:[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f],width:frame.width,height:frame.height};
            test.activeId=id;try{return draw(id,target,frame);}finally{test.activeId=null;}
          };
          drawProceduralBackground=(...args)=>{check(bgCtx.getTransform().isIdentity,'Background transform leaked');return background(...args);};
          const tick=()=>{test.time+=40;loop(test.time);check(ctx.getTransform().isIdentity,'Mode transform leaked');};
          for(const id of MODES){
            settingsActions.selectOverlayMode(id);
            for(const clip of id==='kaleidoscope'?[true,false]:[true]){
            for(const layout of ['prism','rope'].includes(id)?['circular','straight']:['circular']){
              if(id==='prism')settingsActions.set('prismLayout',layout);
              if(id==='rope')settingsActions.set('ropeLayout',layout);
              settingsActions.set('kaleidoClipEnabled',clip);
              const fitted=['orbit','prism','radial','kaleidoscope','rope'].includes(id)&&!(['prism','rope'].includes(id)&&layout==='straight');
              test.level=1;settingsActions.set('glowIntensity',0);tick();
              check(observed.id===id&&observed.width===innerWidth&&observed.height===innerHeight,'Effective mode and real frame dimensions '+JSON.stringify({observed,innerWidth,innerHeight,active:overlayUI.isActive(),effective:effectiveVisualMode()}));
              const bounds=visualModeController.getOverlayBounds(id,visualFrame);
              const expected=OverlayDisplay.fitBounds(bounds,innerWidth,innerHeight,{scale:1,x:0,y:0});
              check((expected!==null)===fitted,'Framing capability '+id);
              if(fitted){
                const [a,b,c,d,e,f]=observed.matrix;
                check(near(a,expected.scale)&&near(d,expected.scale)&&near(e,expected.x)&&near(f,expected.y)&&b===0&&c===0,'Host applies computed fit '+id+' '+JSON.stringify({matrix:observed.matrix,expected}));
                check(near(e+(bounds.x+bounds.width/2)*a,innerWidth/2)&&near(f+(bounds.y+bounds.height/2)*d,innerHeight/2),'Centered maximum geometry '+id);
                const pixels=ctx.getImageData(0,0,renderCanvas.width,renderCanvas.height).data;
                for(let y=0;y<innerHeight;y++)for(let x=0;x<innerWidth;x++)if(x<7||x>=innerWidth-7||y<7||y>=innerHeight-7)
                  check(pixels[(y*innerWidth+x)*4+3]===0,'Geometry clips presentation margin '+id);
                const last=trailFrames.at(-1);check(last.x===0&&last.y===0&&last.canvas.width===innerWidth&&last.canvas.height===innerHeight,'Fitted trails retain full canvas '+id);
                const before=[...observed.matrix];
                test.level=0;state.hueShift=173;settingsActions.set('glowIntensity',2.5);tick();
                check(observed.matrix.every((value,i)=>near(value,before[i])),'Audio, hue and glow do not change framing '+id);
                settingsActions.set('miniOverlayScale',1.5);tick();
                check(observed.matrix.every((value,i)=>near(value,before[i])),'Manual zoom is additional to fit');
                check(getComputedStyle(canvas).transform==='matrix(1.5, 0, 0, 1.5, 0, 0)','Manual canvas zoom');
                settingsActions.set('miniOverlayScale',1);
              }else check(observed.matrix.every((value,i)=>near(value,[1,0,0,1,0,0][i])),'Viewport composition unchanged '+id);
              if(['prism','rope'].includes(id)&&layout==='straight'){
                check(bounds===null&&visualModeController.getRenderBounds(id,visualFrame)===null,'Straight Prism has no element bounds');
                const last=trailFrames.at(-1);check(last.x===0&&last.y===0&&last.canvas.width===innerWidth&&last.canvas.height===innerHeight,'Straight Prism full-canvas trails');
              }
              test.observations.push({id,width:innerWidth,height:innerHeight,clip,layout,fitted});
            }
            }
            check(state.mode===normal,'Independent overlay selection changed normal mode');
          }
          check(getComputedStyle(bgLayer).transform==='none','Background stays unscaled');
          check(!document.getElementById('visualSurface').contains(document.getElementById('miniOverlayControls')),'Controls stay outside visual scaling');
          settingsActions.selectOverlayMode('orbit');test.level=1;tick();
        }finally{
          analyser=null;bassAnalyser=null;audioCtx=null;
          prepareVisualFrame=prepare;visualModeController.draw=draw;ctx.rotate=rotate;drawProceduralBackground=background;window.requestAnimationFrame=raf;
        }
      })()`);
      }
      await setViewport(window, 320, 320);
      await waitFor(
        "normal-size canvas update",
        () =>
          window.webContents.executeJavaScript(
            "canvas.width===innerWidth&&canvas.height===innerHeight"
          ),
        (value) => value,
        { window }
      );
      const result = await window.webContents.executeJavaScript(`(async()=>{
      const check=(value,message)=>{if(!value)throw Error(message);},test=window.overlayFitTest;
      const prior=test.rotations.at(-1);
      await overlayUI.restore();
      const raf=window.requestAnimationFrame,rotate=ctx.rotate;
      try{
        window.requestAnimationFrame=()=>0;
        analyser=bassAnalyser={getFloatFrequencyData:data=>data.fill(-30),getByteFrequencyData:data=>data.fill(190),getByteTimeDomainData:data=>data.fill(128)};
        audioCtx={state:'running',sampleRate:48000};
        let phase,matrix;
        ctx.rotate=function(angle){matrix=this.getTransform();phase=angle;return rotate.call(this,angle);};
        test.time+=40;loop(test.time);
        check(matrix.a===1&&matrix.d===1&&matrix.b===0&&matrix.c===0&&matrix.e===canvas.width/2&&matrix.f===canvas.height/2,'Normal Orbit keeps its original centered layout');
        check(Math.abs(phase-prior-VISUAL_TUNING.orbit.spinPerSec*.04)<1e-8,'Presentation retains Orbit simulation state');
        check(getComputedStyle(canvas).transform==='none','Normal presentation removes manual overlay zoom');
        check(trailFrames.length>0,'Presentation transition retains trail history');
      }finally{analyser=null;bassAnalyser=null;audioCtx=null;window.requestAnimationFrame=raf;ctx.rotate=rotate;}
      await overlayUI.enter();
      const previewRaf=window.requestAnimationFrame;
      try{
        window.requestAnimationFrame=()=>0;
        analyser=bassAnalyser={getFloatFrequencyData:data=>data.fill(-30),getByteFrequencyData:data=>data.fill(190),getByteTimeDomainData:data=>data.fill(128)};
        audioCtx={state:'running',sampleRate:48000};test.time+=40;loop(test.time);
      }finally{analyser=null;bassAnalyser=null;audioCtx=null;window.requestAnimationFrame=previewRaf;}
      return {scenarios:test.observations.length,observations:test.observations};
    })()`);
      await waitForPaint(window, ["#visualSurface"]);
      fs.writeFileSync(
        path.join(artifactDir, "framing.json"),
        JSON.stringify(result, null, 2)
      );
      fs.writeFileSync(
        path.join(artifactDir, "overlay-fitting.png"),
        (await window.webContents.capturePage()).toPNG()
      );
      console.log(
        `PASS: ${result.scenarios} hidden framing scenarios, stable fit, peak geometry, native dimensions, zoom, trails, background isolation, and state continuity`
      );
    } finally {
      ipcMain.removeHandler("overlay-enter");
      ipcMain.removeHandler("overlay-restore");
    }
  }
);
