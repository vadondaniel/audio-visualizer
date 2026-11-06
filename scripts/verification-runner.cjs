const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const {
  projectRoot,
  contained,
  createRunDirectory,
  removeProfile,
} = require("./verification-paths.cjs");

function discoverChecks(directory = path.join(projectRoot, "__tests__")) {
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".electron.cjs"))
    .sort()
    .map((file) => ({
      name: file.slice(0, -".electron.cjs".length),
      entry: path.join(directory, file),
      args: [],
      timeoutMs: 45000,
      interactiveOnly: fs
        .readFileSync(path.join(directory, file), "utf8")
        .startsWith("// @verification-interactive"),
    }));
}
function selectChecks(checks, names) {
  if (!names.length) return checks;
  const unknown = names.filter(
    (name) => !checks.some((check) => check.name === name)
  );
  if (unknown.length)
    throw Error(
      `Unknown Electron check(s): ${unknown.join(", ")}. Available: ${checks.map((check) => check.name).join(", ")}`
    );
  return [...new Set(names)].map((name) =>
    checks.find((check) => check.name === name)
  );
}
function electronEnvironment(env, directory) {
  const result = {
    ...env,
    AV_VERIFICATION_DIRECTORY: directory,
    AV_VERIFICATION_PROFILE: path.join(directory, "profile"),
  };
  delete result.ELECTRON_RUN_AS_NODE;
  return result;
}
function terminateTree(
  child,
  {
    platform = process.platform,
    spawn = childProcess.spawn,
    kill = process.kill,
  } = {}
) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  if (platform !== "win32") {
    try {
      kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") return Promise.reject(error);
    }
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const task = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      {
        windowsHide: true,
        stdio: "ignore",
        timeout: 4000,
        killSignal: "SIGKILL",
      }
    );
    task.once("error", reject);
    task.once("exit", (code) =>
      code === 0 || child.exitCode !== null || child.signalCode !== null
        ? resolve()
        : reject(
            Error(
              `Could not stop owned process tree ${child.pid}: taskkill exit ${code}`
            )
          )
    );
  });
}

function runProcess(
  { executable, args, cwd, env, timeoutMs, signal, onOutput = () => {} },
  {
    spawn = childProcess.spawn,
    terminate = terminateTree,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}
) {
  if (signal?.aborted)
    return Promise.resolve({ status: "interrupted", code: null });
  return new Promise((resolve) => {
    let child,
      watchdog,
      terminationWatchdog,
      finished = false,
      reason = null,
      cleanupError;
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      clearTimer(watchdog);
      clearTimer(terminationWatchdog);
      signal?.removeEventListener("abort", abort);
      resolve({
        pid: child?.pid,
        status:
          reason ||
          (error
            ? "failed"
            : code === 77
              ? "skipped"
              : code !== 0
                ? "failed"
                : "passed"),
        skipReason:
          code === 77
            ? "Requires explicit --interactive desktop verification"
            : undefined,
        code,
        error: error?.message,
        cleanupError,
      });
    };
    const stop = (status) => {
      if (finished || reason) return;
      reason = status;
      // Bound cleanup too; a surviving child prevents profile deletion.
      terminationWatchdog = setTimer(() => {
        cleanupError ||= "Owned process did not close after termination";
        // An OS-level termination failure must not keep the launcher itself hung.
        // Retain the profile and PID for diagnosis; never delete live-process data.
        child.stdout?.destroy?.();
        child.stderr?.destroy?.();
        child.unref?.();
        finish(null);
      }, 5000);
      Promise.resolve()
        .then(() => terminate(child))
        .catch((error) => {
          cleanupError = error.message;
        });
    };
    const abort = () => stop("interrupted");
    try {
      child = spawn(executable, args, {
        cwd,
        env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (chunk) => onOutput("stdout", chunk));
      child.stderr?.on("data", (chunk) => onOutput("stderr", chunk));
      child.once("error", (error) => finish(null, error));
      child.once("close", (code) => finish(code));
      if (timeoutMs != null)
        watchdog = setTimer(() => stop("timed-out"), timeoutMs);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    } catch (error) {
      finish(null, error);
    }
  });
}

function exitCode(results, interrupted = false) {
  return interrupted ||
    results.some((result) => result.status === "interrupted")
    ? 130
    : results.some(
          (result) =>
            !["passed", "skipped"].includes(result.status) ||
            result.cleanupError
        )
      ? 1
      : 0;
}
async function runChecks(
  checks,
  {
    executable,
    runDirectory = createRunDirectory("run"),
    env = process.env,
    signal,
    run = runProcess,
    remove = removeProfile,
    output = (stream, chunk) => process[stream].write(chunk),
  } = {}
) {
  const results = [];
  for (const check of checks) {
    if (signal?.aborted) break;
    const directory = contained(
      runDirectory,
      path.join(runDirectory, check.name)
    );
    const artifacts = path.join(directory, "artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    const log = path.join(directory, "output.log");
    fs.writeFileSync(log, "");
    if (check.interactiveOnly && !check.interactive) {
      const skipReason = "Requires explicit --interactive desktop verification";
      fs.writeFileSync(log, `SKIP: ${skipReason}\n`);
      results.push({
        name: check.name,
        status: "skipped",
        skipReason,
        elapsedMs: 0,
        log,
        artifacts,
      });
      console.log(`\n${check.name}: skipped (${skipReason})`);
      continue;
    }
    const childEnv = electronEnvironment(env, directory);
    childEnv.AV_VERIFICATION_INTERACTIVE = check.interactive ? "1" : "0";
    console.log(`\nRunning ${check.name}`);
    const start = Date.now();
    const result = await run({
      executable,
      args: [check.entry, ...check.args],
      cwd: artifacts,
      env: childEnv,
      timeoutMs: check.timeoutMs,
      signal,
      onOutput: (stream, chunk) => {
        fs.appendFileSync(log, chunk);
        output(stream, chunk);
      },
    });
    if (!result.cleanupError) {
      try {
        remove(directory, childEnv.AV_VERIFICATION_PROFILE);
      } catch (error) {
        result.cleanupError = error.message;
      }
    }
    results.push({
      ...result,
      name: check.name,
      elapsedMs: Date.now() - start,
      log,
      artifacts,
    });
    console.log(
      `${check.name}: ${result.status}${result.cleanupError ? ` (cleanup: ${result.cleanupError})` : ""}`
    );
    if (result.cleanupError) break; // Never continue while an owned process might survive.
  }
  const summary = {
    results,
    interrupted: Boolean(signal?.aborted),
    exitCode: exitCode(results, signal?.aborted),
    runDirectory,
  };
  fs.writeFileSync(
    path.join(runDirectory, "results.json"),
    JSON.stringify(summary, null, 2)
  );
  console.log(
    `\n${results.filter((result) => result.status === "passed").length}/${checks.length} passed; ${results.filter((result) => result.status === "skipped").length} skipped. Results: ${runDirectory}`
  );
  return summary;
}
module.exports = {
  discoverChecks,
  selectChecks,
  electronEnvironment,
  terminateTree,
  runProcess,
  exitCode,
  runChecks,
};
