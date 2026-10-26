const { toggleAlwaysOnTop } = require("../src/window-state");

describe("toggleAlwaysOnTop", () => {
  test("enables floating z-order and repairs the window position", () => {
    const window = {
      isAlwaysOnTop: jest.fn(() => false),
      setAlwaysOnTop: jest.fn(),
      moveTop: jest.fn(),
      focus: jest.fn(),
    };

    expect(toggleAlwaysOnTop(window)).toBe(true);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, "floating");
    expect(window.moveTop).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  test("disables always-on-top without disturbing the current window", () => {
    const window = {
      isAlwaysOnTop: jest.fn(() => true),
      setAlwaysOnTop: jest.fn(),
      moveTop: jest.fn(),
      focus: jest.fn(),
    };

    expect(toggleAlwaysOnTop(window)).toBe(false);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(false, "normal");
    expect(window.moveTop).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });
});
