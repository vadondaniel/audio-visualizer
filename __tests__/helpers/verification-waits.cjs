// Self-contained functions also installed in isolated verification renderers.
function waitFor(
  description,
  read,
  accept,
  { timeoutMs = 5000, intervalMs = 25, signal } = {}
) {
  return new Promise((resolve, reject) => {
    let settled = false,
      poll,
      deadline,
      last;
    const cleanup = () => {
      clearTimeout(poll);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
    };
    const finish = (error, value, failed = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (failed) reject(error);
      else resolve(value);
    };
    const abort = () =>
      finish(
        signal.reason instanceof Error
          ? signal.reason
          : Error(`Aborted waiting for ${description}`),
        undefined,
        true
      );
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    deadline = setTimeout(() => {
      let observed;
      try {
        observed = JSON.stringify(last) ?? "no observation";
      } catch {
        observed = String(last);
      }
      finish(
        Error(
          `Timed out after ${timeoutMs} ms waiting for ${description}; last observed: ${observed}`
        ),
        undefined,
        true
      );
    }, timeoutMs);
    async function probe() {
      try {
        const value = await read();
        if (settled) return;
        last = value;
        if (accept(value)) {
          finish(null, value);
          return;
        }
        poll = setTimeout(probe, intervalMs);
      } catch (error) {
        finish(error, undefined, true);
      }
    }
    probe();
  });
}

function createPaintProbe(document, requestFrame, cancelFrame) {
  const pending = new Map();
  function cancel(id) {
    const state = pending.get(id);
    if (state?.request !== null && state?.request !== undefined)
      cancelFrame(state.request);
    pending.delete(id);
  }
  function probe(id, selectors) {
    let state = pending.get(id);
    if (!state) {
      state = { frames: 0, request: null };
      pending.set(id, state);
    }
    const roots = selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) throw Error(`Missing paint target: ${selector}`);
      return element;
    });
    const animations = new Set(
      roots.flatMap((element) => element.getAnimations({ subtree: true }))
    );
    const active = [...animations].filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return (
        timing &&
        Number.isFinite(timing.endTime) &&
        (animation.pending || animation.playState === "running")
      );
    });
    if (active.length) {
      if (state.request !== null) cancelFrame(state.request);
      state.request = null;
      state.frames = 0;
    } else if (state.frames < 2 && state.request === null) {
      const tick = () => {
        state.frames++;
        state.request = state.frames < 2 ? requestFrame(tick) : null;
      };
      state.request = requestFrame(tick);
    }
    return { frames: state.frames, animations: active.length };
  }
  return {
    probe,
    cancel,
    dispose() {
      for (const id of pending.keys()) cancel(id);
    },
  };
}
module.exports = { waitFor, createPaintProbe };
