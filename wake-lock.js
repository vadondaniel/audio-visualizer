// ---------- screen wake lock ----------
// The lock is only held while the visualizer is running and the window is
// visible. Windows/Chromium can release it when visibility changes, so it is
// reacquired when the app becomes visible again.
let screenWakeLock = null;

async function requestWakeLock() {
  if (
    !state.wakeLockEnabled ||
    typeof navigator.wakeLock === "undefined" ||
    typeof audioCtx === "undefined" ||
    !audioCtx ||
    document.visibilityState !== "visible"
  )
    return;

  if (screenWakeLock && !screenWakeLock.released) return;

  try {
    screenWakeLock = await navigator.wakeLock.request("screen");
    screenWakeLock.addEventListener("release", () => {
      screenWakeLock = null;
      if (state.wakeLockEnabled && document.visibilityState === "visible")
        requestWakeLock();
    });
  } catch (err) {
    screenWakeLock = null;
    console.warn("Could not acquire screen wake lock", err);
  }
}

async function releaseWakeLock() {
  if (!screenWakeLock) return;
  const lock = screenWakeLock;
  screenWakeLock = null;
  try {
    await lock.release();
  } catch (err) {
    console.warn("Could not release screen wake lock", err);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") requestWakeLock();
  else releaseWakeLock();
});
