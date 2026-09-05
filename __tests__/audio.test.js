const { initAudio } = require("../audio");

describe("initAudio", () => {
  const originalNavigator = global.navigator;
  const originalMediaStream = global.MediaStream;
  const originalWindow = global.window;

  afterEach(() => {
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
});
