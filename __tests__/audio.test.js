const {
  initAudio,
  cleanupAudioCapture,
  recoverAudioCapture,
} = require("../audio");

describe("initAudio", () => {
  const originalNavigator = global.navigator;
  const originalMediaStream = global.MediaStream;
  const originalWindow = global.window;

  afterEach(() => {
    cleanupAudioCapture();
    global.navigator = originalNavigator;
    global.MediaStream = originalMediaStream;
    global.window = originalWindow;
    jest.restoreAllMocks();
  });

  test("turns a denied capture request into an actionable error", async () => {
    global.navigator = {
      mediaDevices: {
        getDisplayMedia: jest.fn().mockRejectedValue({
          name: "NotAllowedError",
        }),
      },
    };

    await expect(initAudio()).rejects.toThrow(
      "Audio capture was blocked. Allow capture when prompted, then try again."
    );
  });

  test("stops returned tracks and rejects when no audio track is available", async () => {
    const videoTrack = { stop: jest.fn() };
    const stream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [videoTrack],
      getTracks: () => [videoTrack],
    };
    global.navigator = {
      mediaDevices: {
        getDisplayMedia: jest.fn().mockResolvedValue(stream),
      },
    };

    await expect(initAudio()).rejects.toThrow(
      "No system audio track was returned. Make sure something is actually playing."
    );
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
  });

  test("initializes loopback audio and discards the video track", async () => {
    const audioTrack = {
      readyState: "live",
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      stop: jest.fn(),
    };
    const videoTrack = { stop: jest.fn() };
    const source = { connect: jest.fn() };
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 1024,
    };
    const context = {
      state: "running",
      createMediaStreamSource: jest.fn(() => source),
      createAnalyser: jest.fn(() => analyser),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      resume: jest.fn().mockImplementation(async () => {
        context.state = "running";
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const stream = {
      active: true,
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [videoTrack],
      addEventListener: jest.fn(),
    };

    global.navigator = {
      mediaDevices: {
        getDisplayMedia: jest.fn().mockResolvedValue(stream),
      },
    };
    global.MediaStream = jest.fn(() => ({
      getTracks: () => [audioTrack],
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
    global.window = {
      AudioContext: jest.fn(() => context),
    };

    await expect(initAudio()).resolves.toBeUndefined();

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({
      video: true,
      audio: true,
    });
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(global.MediaStream).toHaveBeenCalledWith([audioTrack]);
    expect(context.createAnalyser).toHaveBeenCalledTimes(1);
    expect(analyser.fftSize).toBe(2048);
    expect(analyser.smoothingTimeConstant).toBe(0.82);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(context.resume).toHaveBeenCalledTimes(1);

    context.state = "suspended";
    await expect(recoverAudioCapture()).resolves.toBeUndefined();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  test("cleans up when the audio engine cannot reach the running state", async () => {
    const audioTrack = {
      readyState: "live",
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      stop: jest.fn(),
    };
    const videoTrack = { stop: jest.fn() };
    const context = {
      state: "suspended",
      createMediaStreamSource: jest.fn(() => ({ connect: jest.fn() })),
      createAnalyser: jest.fn(() => ({ frequencyBinCount: 64 })),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      resume: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const stream = {
      getAudioTracks: () => [audioTrack],
      getVideoTracks: () => [videoTrack],
    };

    global.navigator = {
      mediaDevices: {
        getDisplayMedia: jest.fn().mockResolvedValue(stream),
      },
    };
    global.MediaStream = jest.fn(() => ({
      getTracks: () => [audioTrack],
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
    global.window = { AudioContext: jest.fn(() => context) };

    await expect(initAudio()).rejects.toThrow(
      "The audio engine did not start."
    );
    expect(audioTrack.stop).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });
});
