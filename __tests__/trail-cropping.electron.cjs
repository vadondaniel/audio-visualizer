const fs = require("node:fs");
const path = require("node:path");
const { runCheck } = require("./helpers/electron-harness.cjs");

runCheck(async ({ createWindow, loadRenderer, artifactDir }) => {
  const window = createWindow({ width: 960, height: 540 });
  await loadRenderer(window);
  const results = await window.webContents.executeJavaScript(`(async()=>{
    const check=(value,message)=>{if(!value)throw Error(message);};
    const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="white"/><circle cx="40" cy="20" r="20" fill="red"/></svg>');await image.decode();
    freqData=new Uint8Array(1024).fill(150);timeData=new Uint8Array(2048).fill(128);
    bassAnalyser={getFloatFrequencyData:data=>data.fill(-35)};audioCtx={sampleRate:48000};
    // Composite both paths into the same context to avoid backend-specific blend rounding.
    const fullOutput=canvas,fullCtx=displayCtx;
    const readback=document.createElement('canvas'),readCtx=readback.getContext('2d',{willReadFrequently:true});
    function readPixels(source){
      if(readback.width!==source.width||readback.height!==source.height){readback.width=source.width;readback.height=source.height;}
      readCtx.clearRect(0,0,readback.width,readback.height);readCtx.drawImage(source,0,0);
      return readCtx.getImageData(0,0,readback.width,readback.height).data;
    }
    const fullFrames=[];let comparisons=0,discardedRegions=0;
    const themes=['Neon','White','Black','Rainbow Cycle'];
    const checkPixels=(a,b,label)=>{check(a.length===b.length,'Pixel dimensions '+label);for(let i=0;i<a.length;i++)if(a[i]!==b[i])throw Error(label+' pixel byte '+i+': '+Array.from(a.slice(i-i%4,i-i%4+4))+' != '+Array.from(b.slice(i-i%4,i-i%4+4)));};
    function reference(now,captured){
      while(fullFrames.length&&now-fullFrames[0].timestamp>=state.trailDuration){const old=fullFrames.shift();old.canvas.width=old.canvas.height=0;}
      if(captured){
        if(fullFrames.length>=getTrailSnapshotLimit()){const old=fullFrames.shift();old.canvas.width=old.canvas.height=0;}
        const surface=document.createElement('canvas');surface.width=renderCanvas.width;surface.height=renderCanvas.height;
        surface.getContext('2d').drawImage(renderCanvas,0,0);fullFrames.push({canvas:surface,timestamp:now});
      }
      fullCtx.save();fullCtx.setTransform(1,0,0,1,0,0);fullCtx.globalCompositeOperation="source-over";
      fullCtx.globalAlpha=1;fullCtx.clearRect(0,0,fullOutput.width,fullOutput.height);
      for(const f of fullFrames){fullCtx.globalAlpha=TrailMath.trailOpacity(now-f.timestamp,state.trailDuration);fullCtx.drawImage(f.canvas,0,0);}
      if(!captured){fullCtx.globalAlpha=1;fullCtx.drawImage(renderCanvas,0,0);}
      fullCtx.restore();
    }
    function frameFor(id,now,level){
      const frame=prepareVisualFrame(now,1000/60,id);
      frame.signals={...frame.signals,levels:{bass:level,mid:level,treble:level},bands:new Float64Array(ModeRegistry.get(id).audio.count).fill(level)};
      frame.beat={pulse:level,justHit:level===1};frame.mediaArt=image;
      return frame;
    }
    try{
      state.trailsEnabled=true;state.trailDuration=220;state.trailMaxFps=60;
      for(const [width,height]of [[960,540],[540,960],[640,640],[160,200]]){
        canvas.width=renderCanvas.width=fullOutput.width=width;canvas.height=renderCanvas.height=fullOutput.height=height;
        for(const id of ['orbit','prism','radial'])for(const glow of [0,.5,1,2.5]){
          resetTrailHistory();fullFrames.splice(0).forEach(f=>{f.canvas.width=f.canvas.height=0;});visualModeController.reset();
          state.glowIntensity=glow;
          const times=[0,8,20,35,43,240,241];
          for(let step=0;step<times.length;step++){
            const now=times[step],level=step===0?0:step===1||step===2?1:.63;
            state.theme=THEMES.findIndex(t=>t.name===themes[step%themes.length]);state.hueShift=step*31.25;
            const frame=frameFor(id,now,level);clearFrame();visualModeController.update(id,frame);visualModeController.draw(id,ctx,frame);
            const rawBounds=visualModeController.getRenderBounds(id,frame);check(rawBounds!==null,"Bounded mode must expose bounds: "+id);
            const rect=TrailMath.resolveTrailBounds(rawBounds,width,height,{});
            const pixels=readPixels(renderCanvas);
            for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<rect.x||x>=rect.x+rect.width||y<rect.y||y>=rect.y+rect.height){
              if(pixels[(y*width+x)*4+3]!==0)throw Error(id+' painted outside bounds at '+x+','+y+' glow '+glow);discardedRegions++;
            }
            const captured=TrailMath.shouldCaptureTrail(now,nextTrailCaptureMs);
            renderTrailHistory(now,rawBounds);const actualPixels=readPixels(canvas);reference(now,captured);
            checkPixels(actualPixels,readPixels(fullOutput),id+' '+width+'x'+height+' glow '+glow+' step '+step);comparisons++;
          }
        }
      }
      // Preserve mixed origins and full-size fallback while switching modes and glow.
      resetTrailHistory();fullFrames.splice(0).forEach(f=>{f.canvas.width=f.canvas.height=0;});
      canvas.width=renderCanvas.width=fullOutput.width=960;canvas.height=renderCanvas.height=fullOutput.height=540;
      for(const [step,id]of ['prism','bars','orbit','radial','prism'].entries()){
        const now=step*20;state.glowIntensity=step%2?2.5:0;
        const frame=frameFor(id,now,.8);clearFrame();visualModeController.update(id,frame);visualModeController.draw(id,ctx,frame);
        const bounds=visualModeController.getRenderBounds(id,frame);check(id!=='bars'||bounds===null,'Unsupported mode falls back');
        const captured=TrailMath.shouldCaptureTrail(now,nextTrailCaptureMs);renderTrailHistory(now,bounds);const actualPixels=readPixels(canvas);reference(now,captured);
        checkPixels(actualPixels,readPixels(fullOutput),'Mixed history '+id);comparisons++;
      }
      return {comparisons,discardedRegionPixelsVerified:discardedRegions};
    }finally{
      resetTrailHistory();for(const f of fullFrames)f.canvas.width=f.canvas.height=0;
      readback.width=readback.height=0;bassAnalyser=null;audioCtx=null;
    }
  })()`);
  fs.writeFileSync(
    path.join(artifactDir, "pixel-comparison.json"),
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results));
});
