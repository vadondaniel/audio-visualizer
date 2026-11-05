const { normalize, enabled, next } = require("../src/mode-list");

const modes = ["bars", "radial", "cascade"];

test("existing settings default to every mode in the built-in order", () => {
  expect(normalize(modes)).toEqual({ modeOrder: modes, disabledModes: [] });
});

test("restores name-based preferences, drops unknown entries and duplicates, and appends new modes", () => {
  expect(
    normalize(
      [...modes, "new-mode"],
      ["cascade", "missing", "bars", "cascade"],
      ["bars", "missing", "bars"]
    )
  ).toEqual({
    modeOrder: ["cascade", "bars", "radial", "new-mode"],
    disabledModes: ["bars"],
  });
});

test.each([null, false, 123, "cascade", {}])(
  "invalid preference collections recover safely: %p",
  (value) => {
    expect(normalize(modes, value, value)).toEqual({
      modeOrder: modes,
      disabledModes: [],
    });
  }
);

test("invalid all-disabled preferences keep the first ordered mode enabled", () => {
  const preferences = normalize(modes, ["cascade", "radial", "bars"], modes);
  expect(enabled(preferences.modeOrder, preferences.disabledModes)).toEqual([
    "cascade",
  ]);
});

test("cycles through enabled modes in custom order and wraps", () => {
  const order = ["cascade", "bars", "radial"];
  expect(enabled(order, ["bars"])).toEqual(["cascade", "radial"]);
  expect(next(order, ["bars"], "cascade")).toBe("radial");
  expect(next(order, ["bars"], "radial")).toBe("cascade");
  expect(next(order, ["bars"], "missing")).toBe("cascade");
  expect(next(order, ["bars", "radial"], "cascade")).toBe("cascade");
});
