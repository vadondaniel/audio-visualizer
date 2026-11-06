const {
  waitFor,
  createPaintProbe,
} = require("./helpers/verification-waits.cjs");
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("immediate success returns the observation and removes its watchdog and signal listener", async () => {
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const value = { ready: true };
  await expect(
    waitFor(
      "ready",
      () => value,
      (v) => v.ready,
      { signal: controller.signal }
    )
  ).resolves.toBe(value);
  expect(jest.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

test("delayed observations are sequential, and asynchronous reads never overlap", async () => {
  let inFlight = 0,
    max = 0,
    calls = 0;
  const read = () =>
    new Promise((resolve) => {
      inFlight++;
      max = Math.max(max, inFlight);
      setTimeout(() => {
        inFlight--;
        resolve(++calls);
      }, 40);
    });
  const result = waitFor("third observation", read, (v) => v === 3);
  await jest.advanceTimersByTimeAsync(200);
  await expect(result).resolves.toBe(3);
  expect(max).toBe(1);
  expect(calls).toBe(3);
  expect(jest.getTimerCount()).toBe(0);
});

test("an unmet condition reports the expectation and last observation without retrying the check", async () => {
  const read = jest.fn(() => ({ selected: "bars" }));
  const promise = waitFor(
    "selected Prism",
    read,
    (v) => v.selected === "prism",
    { timeoutMs: 100, intervalMs: 25 }
  );
  const failure = expect(promise).rejects.toThrow(
    'Timed out after 100 ms waiting for selected Prism; last observed: {"selected":"bars"}'
  );
  await jest.advanceTimersByTimeAsync(100);
  await failure;
  expect(read).toHaveBeenCalledTimes(4);
  expect(jest.getTimerCount()).toBe(0);
});

test("hung probes time out and late completion cannot schedule another probe", async () => {
  let release;
  const read = jest.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const result = waitFor("IPC response", read, Boolean, { timeoutMs: 50 });
  const failure = expect(result).rejects.toThrow(
    "last observed: no observation"
  );
  await jest.advanceTimersByTimeAsync(50);
  await failure;
  release(false);
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([Error("probe failure"), undefined])(
  "probe rejections propagate unchanged: %p",
  async (error) => {
    await expect(
      waitFor("probe", () => Promise.reject(error), Boolean)
    ).rejects.toBe(error);
    expect(jest.getTimerCount()).toBe(0);
  }
);

test("acceptance exceptions propagate and abort cancels a pending asynchronous read", async () => {
  const error = Error("acceptance failure");
  await expect(
    waitFor(
      "predicate",
      () => 1,
      () => {
        throw error;
      }
    )
  ).rejects.toBe(error);
  const controller = new AbortController();
  const result = waitFor(
    "pending response",
    () => new Promise(() => {}),
    Boolean,
    { signal: controller.signal }
  );
  const failure = expect(result).rejects.toThrow("owner closed");
  controller.abort(Error("owner closed"));
  await failure;
  expect(jest.getTimerCount()).toBe(0);
});

test("an already aborted signal never starts the read", async () => {
  const controller = new AbortController();
  controller.abort();
  const read = jest.fn();
  await expect(
    waitFor("closed owner", read, Boolean, { signal: controller.signal })
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

function paintFixture() {
  const frames = new Map();
  let id = 0,
    animations = [];
  const request = jest.fn((callback) => {
    frames.set(++id, callback);
    return id;
  });
  const cancel = jest.fn((id) => frames.delete(id));
  const root = { getAnimations: () => animations };
  const paint = createPaintProbe(
    { querySelector: (selector) => (selector === "#missing" ? null : root) },
    request,
    cancel
  );
  return {
    paint,
    frames,
    cancel,
    animate: (value) => {
      animations = value;
    },
    tick: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
  };
}

test("paint waits for finite transitions and two frames, excluding continuous animations", () => {
  const f = paintFixture();
  const animation = {
    pending: false,
    playState: "running",
    effect: { getComputedTiming: () => ({ endTime: 300 }) },
  };
  const infinite = {
    ...animation,
    effect: { getComputedTiming: () => ({ endTime: Infinity }) },
  };
  f.animate([animation, infinite]);
  expect(f.paint.probe("a", ["body"])).toEqual({ frames: 0, animations: 1 });
  expect(f.frames.size).toBe(0);
  animation.playState = "finished";
  expect(f.paint.probe("a", ["body"]).frames).toBe(0);
  f.tick();
  expect(f.paint.probe("a", ["body"]).frames).toBe(1);
  f.tick();
  expect(f.paint.probe("a", ["body"])).toEqual({ frames: 2, animations: 0 });
  f.paint.cancel("a");
  expect(f.frames.size).toBe(0);
});

test("new transitions restart the frame count, and disposal cancels pending frame requests", () => {
  const f = paintFixture();
  f.paint.probe("a", ["body"]);
  f.tick();
  f.animate([
    {
      pending: true,
      playState: "running",
      effect: { getComputedTiming: () => ({ endTime: 100 }) },
    },
  ]);
  expect(f.paint.probe("a", ["body"])).toEqual({ frames: 0, animations: 1 });
  expect(f.frames.size).toBe(0);
  f.animate([]);
  f.paint.probe("a", ["body"]);
  f.paint.probe("b", ["body"]);
  expect(f.frames.size).toBe(2);
  f.paint.dispose();
  f.paint.dispose();
  expect(f.frames.size).toBe(0);
});

test("paint timeout and missing targets fail clearly and cancel outstanding frames", async () => {
  const f = paintFixture();
  await expect(
    waitFor(
      "paint missing",
      () => f.paint.probe("missing", ["#missing"]),
      (v) => v.frames === 2
    ).finally(() => f.paint.cancel("missing"))
  ).rejects.toThrow("Missing paint target: #missing");
  const pending = waitFor(
    "paint without frames",
    () => f.paint.probe("a", ["body"]),
    (v) => v.frames === 2,
    { timeoutMs: 50 }
  ).finally(() => f.paint.cancel("a"));
  const failure = expect(pending).rejects.toThrow("paint without frames");
  await jest.advanceTimersByTimeAsync(50);
  await failure;
  expect(f.frames.size).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
