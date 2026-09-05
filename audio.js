// ---------- audio state ----------
let audioCtx;
let audioStream;
let audioTrack;
let analyser, freqData, timeData, bufferLength;
let audioRecoveryPromise = null;
let audioRecoveryTimer = null;
let audioRecoveryAttempt = 0;
let audioEventCleanup = [];

let audioClockMs = 0;
let bassHistory = [];

let beatCooldownMsLeft = 0;
let sustainedCooldownMsLeft = 0;
let beatPulse = 0;
let beatJustHit = false;

// ---------- audio capture ----------
async function initAudio() {
  clearTimeout(audioRecoveryTimer);
  audioRecoveryTimer = null;

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
  } catch (err) {
    throw new Error(formatAudioCaptureError(err));
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error(
      "No system audio track was returned. Make sure something is actually playing."
    );
  }

  stream.getVideoTracks().forEach((t) => t.stop());

  try {
    audioStream = new MediaStream(audioTracks);
    audioTrack = audioTracks[0];
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(audioStream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);

    bufferLength = analyser.frequencyBinCount;
    freqData = new Uint8Array(bufferLength);
    timeData = new Uint8Array(bufferLength);

    const track = audioTrack;
    const context = audioCtx;
    const recover = () => {
      if (audioTrack === track && audioCtx === context) recoverAudioCapture();
    };
    const onStateChange = () => {
      if (audioCtx !== context || context.state === "running") return;
      recoverAudioCapture();
    };
    track.addEventListener("ended", recover);
    context.addEventListener("statechange", onStateChange);
    audioEventCleanup = [
      () => track.removeEventListener("ended", recover),
      () => context.removeEventListener("statechange", onStateChange),
    ];

    // The stream can become inactive without the track emitting `ended`.
    audioStream.addEventListener("inactive", recover);
    audioEventCleanup.push(() =>
      audioStream.removeEventListener("inactive", recover)
    );

    // Chromium can leave a Web Audio context suspended after a long period of
    // silence. Explicitly resume it once the capture has been established.
    await context.resume();
    if (context.state !== "running") {
      throw new Error("The audio engine did not start.");
    }
    audioRecoveryAttempt = 0;
  } catch (err) {
    cleanupAudioCapture();
    throw err;
  }
}

function formatAudioCaptureError(err) {
  if (!err || !err.name) return err?.message || "Audio capture failed.";
  if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
    return "Audio capture was blocked. Allow capture when prompted, then try again.";
  }
  if (err.name === "NotFoundError" || err.name === "NotReadableError") {
    return "Windows could not provide a system-audio source. Make sure a playback device is available.";
  }
  return err.message || "Audio capture failed.";
}

// Keep the user-facing error translation testable without loading Electron or
// constructing browser media devices. The renderer still uses this function
// exactly as before when this file is loaded as a plain script.
if (typeof module === "object" && module.exports) {
  module.exports = { formatAudioCaptureError, initAudio };
}

function cleanupAudioCapture() {
  audioEventCleanup.forEach((cleanup) => cleanup());
  audioEventCleanup = [];
  if (audioStream) audioStream.getTracks().forEach((track) => track.stop());
  if (audioCtx && audioCtx.state !== "closed") audioCtx.close().catch(() => {});
  audioStream = null;
  audioTrack = null;
  audioCtx = null;
  analyser = null;
  freqData = null;
  timeData = null;
  bufferLength = 0;
}

function scheduleAudioRecovery() {
  if (audioRecoveryTimer) return;
  const delayMs = Math.min(10000, 500 * 2 ** audioRecoveryAttempt);
  audioRecoveryAttempt += 1;
  audioRecoveryTimer = setTimeout(() => {
    audioRecoveryTimer = null;
    recoverAudioCapture();
  }, delayMs);
}

async function recoverAudioCapture() {
  if (audioRecoveryPromise) return audioRecoveryPromise;

  audioRecoveryPromise = (async () => {
    const trackHasEnded = !audioTrack || audioTrack.readyState === "ended";
    const streamIsInactive = !audioStream || audioStream.active === false;
    if (
      !trackHasEnded &&
      !streamIsInactive &&
      audioCtx &&
      (audioCtx.state === "suspended" || audioCtx.state === "interrupted")
    ) {
      try {
        await audioCtx.resume();
        if (audioCtx.state === "running") {
          audioRecoveryAttempt = 0;
          return;
        }
      } catch (err) {
        console.warn("Could not resume audio capture", err);
      }
    }

    if (
      trackHasEnded ||
      streamIsInactive ||
      !audioCtx ||
      audioCtx.state === "closed"
    ) {
      cleanupAudioCapture();
      try {
        await initAudio();
        return;
      } catch (err) {
        console.warn(
          "Could not recover audio capture:",
          formatAudioCaptureError(err)
        );
      }
    }

    // Keep trying with exponential backoff instead of retrying on every frame
    // or giving up after a single transient Windows/Chromium failure.
    scheduleAudioRecovery();
  })().finally(() => {
    audioRecoveryPromise = null;
  });

  return audioRecoveryPromise;
}

// ---------- beat detection ----------
function updateBeat(bass, elapsedMs, dtSec) {
  audioClockMs += elapsedMs;

  bassHistory.push({ bass, t: audioClockMs });
  while (
    bassHistory.length &&
    audioClockMs - bassHistory[0].t > BASS_HISTORY_MS
  ) {
    bassHistory.shift();
  }
  const avg = bassHistory.reduce((a, e) => a + e.bass, 0) / bassHistory.length;

  beatCooldownMsLeft = Math.max(0, beatCooldownMsLeft - elapsedMs);
  sustainedCooldownMsLeft = Math.max(0, sustainedCooldownMsLeft - elapsedMs);

  const { isSpike, isSustainedLoud } = detectBeat({
    bass,
    avg,
    beatCooldownMsLeft,
    sustainedCooldownMsLeft,
    tuning: AUDIO_TUNING,
  });

  if (isSpike || isSustainedLoud) {
    beatPulse = 1;
    beatJustHit = true;
    if (isSpike) {
      beatCooldownMsLeft = AUDIO_TUNING.beatCooldownMs;
    } else {
      sustainedCooldownMsLeft = AUDIO_TUNING.sustainedIntervalMs;
    }
  }

  beatPulse *= Math.exp(-AUDIO_TUNING.pulseDecayPerSec * dtSec);
}
