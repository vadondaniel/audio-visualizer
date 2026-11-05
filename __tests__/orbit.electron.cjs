// Run with: npx electron __tests__/orbit.electron.cjs [--prism]
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const mode = process.argv.includes("--prism") ? "prism" : "orbit";

app.whenReady().then(async () => {
  let failed = false;
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "../src/preload.js"),
      additionalArguments: ["--app-packaged=true"],
      partition: `visual-${mode}-check`,
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
    const dir = path.join(__dirname, "../dist/ui-check");
    fs.mkdirSync(dir, { recursive: true });
    for (const [width, height, theme, silent] of [
      [1280, 720, "White", false],
      [1280, 720, "Neon", false],
      [420, 720, "Neon", false],
      [1280, 720, "Neon", true],
    ]) {
      window.setContentSize(width, height);
      await window.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
      );
      const result = await window.webContents.executeJavaScript(`(() => {
        startOverlay.style.display = "none";
        state.bgType = "color";
        state.bgColor = "#11111a";
        state.trailsEnabled = false;
        applyBackground();
        state.theme = THEMES.findIndex(t => t.name === ${JSON.stringify(theme)});
        applyThemeUiColors();
        modeSelect.value = MODES.indexOf("${mode}");
        modeSelect.dispatchEvent(new Event("change"));
        bufferLength = 1024;
        freqData = new Uint8Array(bufferLength);timeData=new Uint8Array(bufferLength).fill(128);
        for (let i=0;i<bufferLength;i++) {
          const x = Math.log2(i+1);
          freqData[i] = ${silent ? "0" : "Math.min(255, 24 + 225*Math.exp(-Math.pow((x-3.3)/0.9,2)) + 170*Math.exp(-Math.pow((x-6.1)/0.6,2)) + 95*Math.exp(-Math.pow((x-7.6)/0.4,2)))"};
        }
        resetVisualModes();
        const renderMode = (timestamp) => visualModeController.render("${mode}",ctx,
          prepareVisualFrame(timestamp,1000/60,0,${silent ? "0,0,0" : "0.5,0.4,0.3"}));
        // Let the connected rope respond before taking the steady-audio preview.
        for (let frame=0; frame<60; frame++) {
          ctx.clearRect(0,0,renderCanvas.width,renderCanvas.height);
          renderMode(performance.now());
        }
        ctx.clearRect(0,0,renderCanvas.width,renderCanvas.height);
        renderMode(performance.now());
        renderTrailHistory(performance.now());
        let lit = 0;
        const pixels = displayCtx.getImageData(0,0,canvas.width,canvas.height).data;
        for(let i=3;i<pixels.length;i+=4) if(pixels[i]) lit++;
        saveSettings();
        return {mode:MODES[state.mode],inList:state.modeOrder.includes("${mode}"), enabled:!state.disabledModes.includes("${mode}"), lit};
      })()`);
      assert.equal(result.mode, mode);
      assert.equal(result.inList, true);
      assert.equal(result.enabled, true);
      assert.ok(result.lit > 1000);
      await window.webContents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
      );
      assert.ok(
        await window.webContents.executeJavaScript(
          "displayCtx.getImageData(0,0,canvas.width,canvas.height).data.some((value,index) => index % 4 === 3 && value > 0)"
        ),
        "Presented canvas must still contain the rendered visual"
      );
      const canvasPng = await window.webContents.executeJavaScript(
        "canvas.toDataURL('image/png')"
      );
      fs.writeFileSync(
        path.join(
          dir,
          `${mode}-${width}-${theme}${silent ? "-silent" : ""}-canvas.png`
        ),
        Buffer.from(canvasPng.split(",")[1], "base64")
      );
      fs.writeFileSync(
        path.join(
          dir,
          `${mode}-${width}-${theme}${silent ? "-silent" : ""}.png`
        ),
        (await window.webContents.capturePage()).toPNG()
      );
    }
    await window.reload();
    await new Promise((resolve) =>
      window.webContents.once("did-finish-load", resolve)
    );
    await window.webContents.executeJavaScript("window.rendererReady");
    assert.equal(
      await window.webContents.executeJavaScript("MODES[state.mode]"),
      mode
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS: ${mode} renders in White/Neon, portrait, and silence; mode selection persists; no renderer errors`
    );
  } catch (error) {
    console.error(error);
    failed = true;
  } finally {
    window.destroy();
    app.exit(failed ? 1 : 0);
  }
});
