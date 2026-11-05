// Run with: npm run test:electron -- single-instance
const { runCheck } = require("./helpers/electron-harness.cjs");
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { acquireSingleInstance } = require("../src/single-instance");

const secondary = process.argv.includes("--secondary");
let window;
const calls = [];
const windowPolicy = {
  isDestroyed: () => window.isDestroyed(),
  isMinimized: () => true,
  restore: () => calls.push("restore"),
  show: () => calls.push("show"),
  focus: () => calls.push("focus"),
};
if (!acquireSingleInstance(app, () => (window ? windowPolicy : undefined))) {
  console.log("SECONDARY_EXIT");
} else if (secondary) {
  console.error("Secondary unexpectedly acquired the lock");
  app.exit(1);
} else {
  runCheck(async ({ createWindow }) => {
    window = createWindow({
      withRenderer: false,
      show: false,
      webPreferences: { partition: "single-instance-check" },
    });
    let child;
    try {
      await window.loadURL("about:blank");
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      child = spawn(process.execPath, [__filename, "--secondary"], {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Second launch did not exit")),
          10000
        );
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          code === 0
            ? resolve()
            : reject(Error(`Secondary exit ${code}: ${stderr}`));
        });
      });
      assert.match(stdout, /SECONDARY_EXIT/);
      assert.deepEqual(calls, ["restore", "show", "focus"]);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      assert.doesNotMatch(
        stderr,
        /Unable to move the cache|Unable to create cache|Gpu Cache Creation failed/
      );
      console.log(
        "PASS: real second Electron process exits cleanly, activates primary, and creates no second window or cache errors"
      );
    } finally {
      if (child && child.exitCode === null) child.kill();
    }
  });
}
