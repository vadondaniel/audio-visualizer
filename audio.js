// ---------- audio state ----------
let audioCtx;
let audioStream;
let audioTrack;
let analyser, freqData, timeData, bufferLength;
let audioRecoveryPromise = null;

let audioClockMs = 0;
let bassHistory = [];

let beatCooldownMsLeft = 0;
let sustainedCooldownMsLeft = 0;
let beatPulse = 0;
let beatJustHit = false;

// ---------- audio capture ----------
async function initAudio() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true,
  });

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error(
      "No system audio track was returned. Make sure something is actually playing.",
    );
  }

  stream.getVideoTracks().forEach((t) => t.stop());

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

  const recover = () => recoverAudioCapture();
  audioTrack.addEventListener("unmute", recover);
  audioTrack.addEventListener("ended", recover);
  audioCtx.addEventListener("statechange", () => {
    if (audioCtx && audioCtx.state === "running") return;
    recoverAudioCapture();
  });

  // Chromium can leave a Web Audio context suspended after a long period of
  // silence. Explicitly resume it once the capture has been established.
  await audioCtx.resume();
}

async function recoverAudioCapture() {
  if (audioRecoveryPromise) return audioRecoveryPromise;

  audioRecoveryPromise = (async () => {
    const trackHasEnded = !audioTrack || audioTrack.readyState === "ended";
    if (!trackHasEnded && audioCtx && audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
        if (audioCtx.state === "running") return;
      } catch (err) {
        console.warn("Could not resume audio capture", err);
      }
    }

    if (trackHasEnded || !audioCtx || audioCtx.state === "closed") {
      const previousStream = audioStream;
      const previousContext = audioCtx;
      analyser = null;
      audioStream = null;
      audioTrack = null;
      if (previousStream)
        previousStream.getTracks().forEach((track) => track.stop());
      if (previousContext && previousContext.state !== "closed") {
        previousContext.close().catch(() => {});
      }

      try {
        await initAudio();
      } catch (err) {
        console.error("Could not recover audio capture", err);
      }
    }
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
