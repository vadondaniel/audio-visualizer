const { runCheck } = require("./helpers/electron-harness.cjs");
// Run with: npm run test:electron -- mode-manager

const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

runCheck(
  async ({ createWindow, loadRenderer, reloadRenderer, artifactDir }) => {
    const window = createWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        partition: "mode-manager-check",
      },
    });

    await loadRenderer(window);
    await window.webContents.executeJavaScript(
      'startOverlay.style.display = "none"; settingsBtn.click();'
    );
    const dir = artifactDir;

    if (process.argv.includes("--baseline")) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      fs.writeFileSync(
        path.join(dir, "modes-before.png"),
        (await window.webContents.capturePage()).toPNG()
      );
      console.log("Captured existing settings panel");
    } else {
      const result = await window.webContents.executeJavaScript(`(() => {
        const check = (value, message) => { if (!value) throw Error(message); };
        const control = (id, action) => [...modeManagerList.querySelectorAll("[data-mode]")].find(el => el.dataset.mode === id && el.dataset.action === action);
        check(!modeManager.open, "Manager must start closed");
        check(modeSelect.options.length === MODES.length, "Legacy/default mode list");
        manageModesBtn.click();
        check(modeManager.open && manageModesBtn.getAttribute("aria-expanded") === "true", "Open manager");
        check(modeManager.matches(":modal") && !settingsPanel.contains(modeManager), "Must be a modal dialog outside the sidebar");
        const data = new DataTransfer();
        const row = [...modeManagerList.children].find(row => row.dataset.mode === "cascade");
        const target = modeManagerList.firstElementChild;
        row.dispatchEvent(new DragEvent("dragstart", {bubbles:true, dataTransfer:data}));
        target.dispatchEvent(new DragEvent("dragover", {bubbles:true, cancelable:true, dataTransfer:data, clientY:target.getBoundingClientRect().top + 1}));
        modeManagerList.dispatchEvent(new DragEvent("drop", {bubbles:true, cancelable:true, dataTransfer:data}));
        check(state.modeOrder[0] === "cascade", "Drag moves to top");
        check(MODES[state.mode] === "bars", "Reorder must preserve current visual");
        const beforeCancel = state.modeOrder.join();
        const cancelRow = modeManagerList.lastElementChild;
        cancelRow.dispatchEvent(new DragEvent("dragstart", {bubbles:true, dataTransfer:data}));
        modeManagerList.firstElementChild.dispatchEvent(new DragEvent("dragover", {bubbles:true, cancelable:true, dataTransfer:data, clientY:modeManagerList.getBoundingClientRect().top}));
        cancelRow.dispatchEvent(new DragEvent("dragend", {bubbles:true, dataTransfer:data}));
        check(state.modeOrder.join() === beforeCancel && modeManagerList.firstElementChild.dataset.mode === "cascade", "Cancelled drag restores order");
        const handle = control("radial", "reorder");
        handle.focus();
        handle.dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowUp", bubbles:true, cancelable:true}));
        check(state.modeOrder[1] === "radial", "Keyboard reorder");
        control("radial", "reorder").dispatchEvent(new KeyboardEvent("keydown", {key:"ArrowDown", bubbles:true, cancelable:true}));
        control("bars", "enable").click();
        check(MODES[state.mode] === "cascade", "Disabling current mode selects first enabled mode");
        check(modeSelect.options[0].textContent === "Cascade" && modeSelect.options.length === MODES.length - 1, "Dropdown order and filtering");
        check(![...modeSelect.options].some(o => MODES[o.value] === "bars"), "Disabled mode excluded");
        setModeManagerOpen(false);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "2" }));
        setModeManagerOpen(true);
        check(MODES[state.mode] === "radial", "Hotkey uses enabled order");
        control("radial", "enable").focus();
        control("radial", "enable").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
        check(!state.autoCycle, "Editing a checkbox must not toggle auto-cycle");
        let tick;
        const original = window.setInterval;
        window.setInterval = (callback, delay) => { check(delay === 12000, "Cycle duration"); tick = callback; return 0; };
        setAutoCycle(true);
        window.setInterval = original;
        tick();
        check(MODES[state.mode] === "waveform", "Auto-cycle follows enabled order");
        setAutoCycle(false);
        for (const id of [...state.modeOrder]) {
          if (id !== "cascade" && !state.disabledModes.includes(id)) control(id, "enable").click();
        }
        check(control("cascade", "enable").disabled, "Cannot disable last mode");
        check(document.getElementById("modeHotkeyKeys").textContent === "1", "Shortcut range follows enabled count");
        control("radial", "enable").click();
        state.mode = MODES.indexOf("cascade");
        saveSettings();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        check(!modeManager.open && document.activeElement === manageModesBtn, "Escape closes editor and restores focus");
        manageModesBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
        check(MODES[state.mode] === "cascade", "Shortcuts still work after returning focus to Manage");
        manageModesBtn.click();
        openHotkeys();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        check(!hotkeysOverlay.classList.contains("visible") && modeManager.open, "Escape closes the topmost dialog first");
        setModeManagerOpen(false);
        return { order: state.modeOrder, disabled: state.disabledModes, mode: state.mode };
      })()`);
      assert.equal(result.order[0], "cascade");
      await reloadRenderer(window);
      const restored = await window.webContents.executeJavaScript(
        `({order:state.modeOrder,disabled:state.disabledModes,mode:state.mode, options:[...modeSelect.options].map(o=>o.textContent)})`
      );
      assert.deepEqual(restored.order, result.order);
      assert.deepEqual(restored.disabled, result.disabled);
      assert.equal(restored.mode, result.mode);
      assert.deepEqual(restored.options, ["Cascade", "Radial"]);
      await window.webContents.executeJavaScript(`(() => {
        if(MODES.length<=9)throw Error("This regression requires more than nine registered modes");
        state.disabledModes = [];
        applyModePreferences();
        window.dispatchEvent(new KeyboardEvent("keydown", {key:"9"}));
        if (MODES[state.mode] !== state.modeOrder[8]) throw Error("Number keys must still work with more than nine modes");
        state.mode = MODES.indexOf("cascade");
        state.disabledModes = ["bars"];
        applyModePreferences();
        startOverlay.style.display = "none";
        settingsBtn.click();
        setModeManagerOpen(true);
      })()`);
      // Drive Chromium's real drag-and-drop path from mouse input.
      await window.webContents.executeJavaScript(
        `window.dragEvents = []; for (const type of ["dragstart","dragover","drop","dragend"]) modeManagerList.addEventListener(type, e => window.dragEvents.push({type, target:e.target.className, mode:e.target.closest(".modeManagerRow")?.dataset.mode, y:e.clientY}), true);`
      );
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand("Input.setInterceptDrags", {
        enabled: true,
      });
      const points = await window.webContents.executeJavaScript(`(() => {
        const handle = modeManagerList.querySelector('[data-action="reorder"][data-mode="radial"]').getBoundingClientRect();
        const target = modeManagerList.firstElementChild.getBoundingClientRect();
        return { x:handle.left+handle.width/2, y:handle.top+handle.height/2, toX:target.left+50, toY:target.top+2 };
      })()`);
      let dragTimer;
      const intercepted = new Promise((resolve, reject) => {
        dragTimer = setTimeout(
          () => reject(Error("Native drag did not start")),
          4000
        );
        window.webContents.debugger.on("message", (_event, method, params) => {
          if (method === "Input.dragIntercepted") {
            clearTimeout(dragTimer);
            resolve(params.data);
          }
        });
      });
      await window.webContents.debugger.sendCommand(
        "Input.dispatchMouseEvent",
        { type: "mouseMoved", x: points.x, y: points.y }
      );
      await window.webContents.debugger.sendCommand(
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          x: points.x,
          y: points.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
        }
      );
      for (let i = 1; i <= 5; i++) {
        await window.webContents.debugger.sendCommand(
          "Input.dispatchMouseEvent",
          {
            type: "mouseMoved",
            x: points.x + 12 * i,
            y: points.y - 4 * i,
            button: "left",
            buttons: 1,
          }
        );
      }
      const dragData = await intercepted;
      for (const type of ["dragEnter", "dragOver", "drop"])
        await window.webContents.debugger.sendCommand(
          "Input.dispatchDragEvent",
          { type, x: points.toX, y: points.toY, data: dragData }
        );
      await window.webContents.debugger.sendCommand(
        "Input.dispatchMouseEvent",
        {
          type: "mouseReleased",
          x: points.toX,
          y: points.toY,
          button: "left",
          buttons: 0,
          clickCount: 1,
        }
      );
      window.webContents.debugger.detach();
      const dragResult = await window.webContents.executeJavaScript(
        "({first:state.modeOrder[0],events:window.dragEvents})"
      );
      if (dragResult.first !== "radial")
        console.log(JSON.stringify({ points, dragResult }));
      assert.equal(dragResult.first, "radial");
      for (const [width, height] of [
        [1280, 720],
        [640, 640],
        [360, 640],
      ]) {
        window.setContentSize(width, height);
        await window.webContents.executeJavaScript("flashHud()");
        await new Promise((resolve) => setTimeout(resolve, 250));
        const layout = await window.webContents.executeJavaScript(`(() => {
          const list = document.getElementById("modeManagerList");
          const row = list.querySelector("li");
          return { overflow: list.scrollWidth > list.clientWidth, checkboxWidth: getComputedStyle(row.querySelector("input")).width, listWidth: list.clientWidth, modal: modeManager.matches(":modal"), fits: modeManager.getBoundingClientRect().width <= innerWidth && modeManager.getBoundingClientRect().height <= innerHeight };
        })()`);
        assert.equal(layout.overflow, false);
        assert.equal(layout.modal, true);
        assert.equal(layout.fits, true);
        assert.ok(Math.abs(parseFloat(layout.checkboxWidth) - 16) < 0.1);
        assert.ok(layout.listWidth > 0);
        fs.writeFileSync(
          path.join(dir, "modes-" + width + ".png"),
          (await window.webContents.capturePage()).toPNG()
        );
      }
      console.log(
        "PASS: modal dialog, native mouse drag, cancelled drag, keyboard reorder, toggles, shortcuts, auto-cycle, persistence, and layouts at 1280/640/360 px"
      );
      await window.webContents.executeJavaScript(`(() => {
        document.getElementById("doneModeManagerBtn").click();
        if (modeManager.open || document.activeElement !== manageModesBtn || !settingsPanel.classList.contains("visible")) throw Error("Done must close the dialog and restore sidebar focus");
        manageModesBtn.click();
        document.getElementById("closeModeManagerBtn").click();
        if (modeManager.open || document.activeElement !== manageModesBtn) throw Error("Close button must restore focus");
        manageModesBtn.click();
        modeManager.dispatchEvent(new MouseEvent("click", {bubbles:true,clientX:0,clientY:0}));
        if (modeManager.open) throw Error("Backdrop closes the dialog");
      })()`);
    }
  }
);
