const fs = require("node:fs"),
  path = require("node:path");
const { EventEmitter } = require("node:events");
const runner = require("../scripts/verification-runner.cjs");
const paths = require("../scripts/verification-paths.cjs");
const { buildChecks } = require("../scripts/verify.cjs");
let root;
beforeEach(() => {
  fs.mkdirSync(paths.verificationRoot, { recursive: true });
  root = fs.mkdtempSync(path.join(paths.verificationRoot, "unit-"));
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  fs.rmSync(paths.contained(paths.verificationRoot, root), {
    recursive: true,
    force: true,
  });
});
function child() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.destroy = jest.fn();
  child.stderr.destroy = jest.fn();
  child.unref = jest.fn();
  child.close = (code) => {
    child.exitCode = code;
    child.emit("close", code);
  };
  return child;
}
function launch(extra = {}, dependencies = {}) {
  const process = child(),
    spawn = jest.fn(() => process),
    terminate = jest.fn(async (target) => target.close(null));
  const promise = runner.runProcess(
    {
      executable: "local electron.exe",
      args: ["check with spaces.cjs", "value=a b"],
      cwd: root,
      env: { TEST: "yes" },
      timeoutMs: 45000,
      ...extra,
    },
    { spawn, terminate, ...dependencies }
  );
  return { process, spawn, terminate, promise };
}
test("discovery is automatic, selection is ordered/deduplicated, and unknown names are rejected", () => {
  fs.writeFileSync(path.join(root, "second.electron.cjs"), "");
  fs.writeFileSync(path.join(root, "first.electron.cjs"), "");
  fs.writeFileSync(path.join(root, "helper.cjs"), "");
  const checks = runner.discoverChecks(root);
  expect(checks.map((check) => check.name)).toEqual(["first", "second"]);
  expect(runner.selectChecks(checks, [])).toBe(checks);
  expect(
    runner
      .selectChecks(checks, ["second", "first", "second"])
      .map((check) => check.name)
  ).toEqual(["second", "first"]);
  expect(() => runner.selectChecks(checks, ["missing"])).toThrow(
    /Unknown Electron check/
  );
  expect(checks.every((check) => check.timeoutMs === 45000)).toBe(true);
});
test("environment forwarding removes the Electron Node flag and overrides inherited profiles without mutating the caller", () => {
  const env = Object.freeze({
    PATH: "test",
    ELECTRON_RUN_AS_NODE: "1",
    AV_VERIFICATION_PROFILE: "unrelated",
  });
  const result = runner.electronEnvironment(env, root);
  expect(result).toEqual({
    PATH: "test",
    AV_VERIFICATION_DIRECTORY: root,
    AV_VERIFICATION_PROFILE: path.join(root, "profile"),
  });
  expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
});
test("arguments with spaces are forwarded literally without a shell and logs capture both streams", async () => {
  const output = jest.fn();
  const a = launch({ onOutput: output });
  expect(a.spawn).toHaveBeenCalledWith(
    "local electron.exe",
    ["check with spaces.cjs", "value=a b"],
    expect.objectContaining({
      cwd: root,
      env: { TEST: "yes" },
      windowsHide: true,
    })
  );
  expect(a.spawn.mock.calls[0][2].shell).toBeUndefined();
  a.process.stdout.emit("data", Buffer.from("out"));
  a.process.stderr.emit("data", Buffer.from("err"));
  a.process.close(0);
  expect((await a.promise).status).toBe("passed");
  expect(output.mock.calls.map((call) => call[0])).toEqual([
    "stdout",
    "stderr",
  ]);
  expect(a.terminate).not.toHaveBeenCalled();
});
test.each([1, null])("nonzero exits and crashes fail (%s)", async (code) => {
  const a = launch();
  a.process.close(code);
  const result = await a.promise;
  expect(result.status).toBe("failed");
  expect(runner.exitCode([result])).toBe(1);
});
test("spawn errors fail without trying to kill another process", async () => {
  const a = launch();
  a.process.emit("error", Error("cannot launch"));
  expect(await a.promise).toMatchObject({
    status: "failed",
    error: "cannot launch",
  });
  expect(a.terminate).not.toHaveBeenCalled();
});
test("timeout terminates only the launched child tree and returns failure without retrying", async () => {
  jest.useFakeTimers();
  const a = launch();
  jest.advanceTimersByTime(45000);
  const result = await a.promise;
  expect(result.status).toBe("timed-out");
  expect(runner.exitCode([result])).toBe(1);
  expect(a.terminate).toHaveBeenCalledTimes(1);
  expect(a.terminate).toHaveBeenCalledWith(a.process);
  expect(a.spawn).toHaveBeenCalledTimes(1);
});
test("interruption terminates the active process and returns 130; pre-aborted runs never spawn", async () => {
  const controller = new AbortController();
  const a = launch({ signal: controller.signal });
  controller.abort();
  const result = await a.promise;
  expect(result.status).toBe("interrupted");
  expect(runner.exitCode([result])).toBe(130);
  expect(a.terminate).toHaveBeenCalledWith(a.process);
  const b = launch({ signal: controller.signal });
  expect((await b.promise).status).toBe("interrupted");
  expect(b.spawn).not.toHaveBeenCalled();
});
test("failed termination is bounded and prevents unsafe cleanup", async () => {
  jest.useFakeTimers();
  const terminate = jest.fn().mockRejectedValue(Error("termination failed"));
  const a = launch({}, { terminate });
  await jest.advanceTimersByTimeAsync(45000);
  await jest.advanceTimersByTimeAsync(5000);
  expect(await a.promise).toMatchObject({
    status: "timed-out",
    cleanupError: "termination failed",
  });
  expect(a.process.unref).toHaveBeenCalledTimes(1);
  expect(a.process.stdout.destroy).toHaveBeenCalledTimes(1);
  expect(a.process.stderr.destroy).toHaveBeenCalledTimes(1);
});
test("Windows termination targets an owned PID tree, never an executable name", async () => {
  const task = new EventEmitter(),
    spawn = jest.fn(() => task),
    owned = child();
  const promise = runner.terminateTree(owned, { platform: "win32", spawn });
  expect(spawn).toHaveBeenCalledWith(
    "taskkill.exe",
    ["/PID", "12345", "/T", "/F"],
    expect.objectContaining({ windowsHide: true })
  );
  task.emit("exit", 0);
  await promise;
  owned.exitCode = 0;
  await runner.terminateTree(owned, { platform: "win32", spawn });
  expect(spawn).toHaveBeenCalledTimes(1);
});
test("profile cleanup is confined and retains artifacts and unrelated preferences", () => {
  const directory = path.join(root, "case"),
    profile = path.join(directory, "profile");
  fs.mkdirSync(profile, { recursive: true });
  const artifact = path.join(directory, "preview.png");
  fs.writeFileSync(artifact, "keep");
  const unrelated = path.join(root, "Preferences");
  fs.writeFileSync(unrelated, "original");
  expect(() => paths.removeProfile(directory, directory)).toThrow(
    /outside owned/
  );
  expect(() => paths.removeProfile(directory, unrelated)).toThrow(
    /outside owned/
  );
  expect(() =>
    paths.removeProfile(directory, path.join(directory, "..", "Preferences"))
  ).toThrow(/outside owned/);
  paths.removeProfile(directory, profile);
  expect(fs.existsSync(profile)).toBe(false);
  expect(fs.readFileSync(artifact, "utf8")).toBe("keep");
  expect(fs.readFileSync(unrelated, "utf8")).toBe("original");
});
test("profile configuration isolates userData and sessionData and gives the secondary the same profile", () => {
  const original = {
    directory: process.env.AV_VERIFICATION_DIRECTORY,
    profile: process.env.AV_VERIFICATION_PROFILE,
  };
  process.env.AV_VERIFICATION_DIRECTORY = root;
  process.env.AV_VERIFICATION_PROFILE = path.join(root, "profile");
  const app = { setPath: jest.fn() };
  try {
    const first = paths.configureProfile(app),
      second = paths.configureProfile(app);
    expect(first.profile).toBe(second.profile);
    expect(app.setPath).toHaveBeenCalledWith("userData", first.profile);
    expect(app.setPath).toHaveBeenCalledWith("sessionData", first.profile);
    expect(paths.contained(root, first.profile)).toBe(first.profile);
  } finally {
    for (const [name, value] of [
      ["AV_VERIFICATION_DIRECTORY", original.directory],
      ["AV_VERIFICATION_PROFILE", original.profile],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
test("runs continue after a failure, save logs/results, and remove only distinct owned profiles", async () => {
  const checks = ["a", "b"].map((name) => ({
    name,
    entry: `${name}.cjs`,
    args: ["literal=a b"],
    timeoutMs: 45000,
  }));
  const seen = [];
  const run = jest.fn(async (options) => {
    seen.push(options);
    fs.mkdirSync(options.env.AV_VERIFICATION_PROFILE, { recursive: true });
    fs.writeFileSync(
      path.join(options.env.AV_VERIFICATION_PROFILE, "Preferences"),
      "temporary"
    );
    options.onOutput("stdout", Buffer.from("test log"));
    return {
      status: seen.length === 1 ? "failed" : "passed",
      code: seen.length === 1 ? 1 : 0,
    };
  });
  const summary = await runner.runChecks(checks, {
    runDirectory: root,
    executable: "electron",
    run,
    output: () => {},
  });
  expect(summary.exitCode).toBe(1);
  expect(run).toHaveBeenCalledTimes(2);
  expect(seen[0].env.AV_VERIFICATION_PROFILE).not.toBe(
    seen[1].env.AV_VERIFICATION_PROFILE
  );
  for (const options of seen) {
    expect(fs.existsSync(options.env.AV_VERIFICATION_PROFILE)).toBe(false);
    expect(options.args[1]).toBe("literal=a b");
  }
  expect(fs.readFileSync(path.join(root, "a/output.log"), "utf8")).toBe(
    "test log"
  );
  expect(
    JSON.parse(fs.readFileSync(path.join(root, "results.json"), "utf8"))
      .exitCode
  ).toBe(1);
});
test("cleanup failures stop further checks and return nonzero", async () => {
  const run = jest.fn().mockResolvedValue({ status: "passed", code: 0 });
  const summary = await runner.runChecks(
    ["a", "b"].map((name) => ({ name, entry: "check.cjs", args: [] })),
    {
      runDirectory: root,
      executable: "electron",
      run,
      remove: () => {
        throw Error("locked profile");
      },
    }
  );
  expect(summary.exitCode).toBe(1);
  expect(summary.results[0].cleanupError).toBe("locked profile");
  expect(run).toHaveBeenCalledTimes(1);
});
test("benchmark presets are bounded while custom benchmark options remain literal", () => {
  const [smoke] = buildChecks(["benchmark-smoke"]);
  expect(smoke.timeoutMs).toBe(60000);
  expect(smoke.args).toEqual([
    "modes=particles,tunnel,orbit,prism",
    "scenarios=mixed",
    "repeats=1",
    "warmup=250",
    "duration=1000",
    "trace=false",
    "ops=false",
    "keep-window=false",
  ]);
  expect(() => buildChecks(["benchmark-smoke", "keep-window=true"])).toThrow(
    /fixed bounded preset/
  );
  expect(
    buildChecks(["benchmark", "modes=orbit", "keep-window=true"])[0]
  ).toMatchObject({
    args: ["modes=orbit", "keep-window=true"],
    timeoutMs: null,
  });
  expect(() => buildChecks(["electron", "not-a-check"])).toThrow(
    /Unknown Electron/
  );
});
