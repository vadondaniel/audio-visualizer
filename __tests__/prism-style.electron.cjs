const { runCheck } = require("./helpers/electron-harness.cjs");
const fs = require("node:fs"),
  path = require("node:path");
runCheck(async ({ createWindow, loadRenderer, artifactDir }) => {
  const window = createWindow();
  await loadRenderer(window);
  const images = await window.webContents.executeJavaScript(`(()=>{
    const legacy={minLineWidth:1,lineWidthScale:.0018,contourAlpha:.4,spokeAlpha:.25,spokeAlphaGain:.45,glowBlur:8,glowBlurGain:7};
    const current={...VISUAL_TUNING.prism},results=[];
    const signals={levels:{bass:.2,mid:.3,treble:.2},bands:Float64Array.from({length:96},(_,i)=>.03+.55*Math.exp(-(((i-20)/10)**2))+.3*Math.exp(-(((i-60)/8)**2)))};
    try{
      for(const size of [320,700]){
        const sheet=document.createElement('canvas');sheet.width=size*2;sheet.height=size*2+60;
        const sheetCtx=sheet.getContext('2d');sheetCtx.fillStyle='#09090d';sheetCtx.fillRect(0,0,sheet.width,sheet.height);
        for(const [row,layout] of ['circular','straight'].entries()){
          const weights=[];
          for(const [column,style] of [legacy,current].entries()){
            Object.assign(VISUAL_TUNING.prism,style);
            const target=document.createElement('canvas');target.width=target.height=size;
            const ctx=target.getContext('2d');
            const settings={...state,prismLayout:layout,theme:THEMES.findIndex(t=>t.name==='Neon'),glowIntensity:1};
            visualModeController.render('prism',ctx,{width:size,height:size,settings,signals,beat:{pulse:0,justHit:false},timestampMs:1000,elapsedMs:16,dtSec:.016,audioClockMs:1000,mediaArt:null});
            const pixels=ctx.getImageData(0,0,size,size).data;let coverage=0;
            for(let i=3;i<pixels.length;i+=4)coverage+=pixels[i];weights.push(coverage);
            sheetCtx.drawImage(target,column*size,row*(size+30)+30);
            sheetCtx.fillStyle='#ddd';sheetCtx.font='16px sans-serif';sheetCtx.fillText(layout+' — '+(column?'stronger':'previous'),column*size+12,row*(size+30)+21);
          }
          if(weights[1]<=weights[0]*1.2)throw Error('Prism style did not meaningfully strengthen '+layout+' at '+size);
        }
        results.push({size,png:sheet.toDataURL('image/png').split(',')[1]});
      }
      return results;
    }finally{Object.assign(VISUAL_TUNING.prism,current);}
  })()`);
  for (const image of images)
    fs.writeFileSync(
      path.join(artifactDir, `prism-style-${image.size}.png`),
      Buffer.from(image.png, "base64")
    );
  console.log(
    "PASS: stronger circular and straight Prism at desktop and overlay sizes; comparison screenshots saved"
  );
});
