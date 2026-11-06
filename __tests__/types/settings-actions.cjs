const Actions = require("../../src/settings-actions");
/** @param {import('../../src/settings-actions').Dependencies} dependencies */
function checkActions(dependencies) {
  const actions = Actions.create(dependencies);
  actions.set("sensitivity", 1.5);
  actions.set("valueHandling", "logarithmic");
  actions.set("miniOverlayShowBackground", true);
  actions.set("miniOverlayScale", 1.5);
  actions.set("miniOverlayOpacity", 0.5);
  actions.set("miniOverlayMaxFps", 30);
  actions.selectOverlayMode("orbit");
  actions.selectActiveMode("prism", true);
  // @ts-expect-error The overlay FPS choices are explicit.
  actions.set("miniOverlayMaxFps", 42);
  // @ts-expect-error Mode selection uses its dedicated action.
  actions.set("miniOverlayMode", "orbit");
  // @ts-expect-error Background visibility is a boolean setting.
  actions.set("miniOverlayShowBackground", "transparent");
  actions.selectMode("bars");
  actions.nextMode();
  actions.cycleTheme();
  actions.setModePreferences({ order: ["bars"], disabled: [] });
  actions.setMediaPosition("bars", "top-left");
  actions.setBackgroundImage({
    dataUrl: "data:image/png;base64,test",
    name: "cover.png",
  });
  actions.clearBackgroundImage();
  actions.initialize();
  actions.dispose();
  // @ts-expect-error Scalar settings preserve their value types.
  actions.set("sensitivity", "loud");
  // @ts-expect-error Unknown setting keys are rejected.
  actions.set("sensitivty", 1);
  // @ts-expect-error Unsupported response curve.
  actions.set("valueHandling", "squared");
  // @ts-expect-error Runtime animation fields are not settings commands.
  actions.set("hueShift", 50);
  // @ts-expect-error Numeric selection is maintained by the mode action.
  actions.set("mode", 2);
  // @ts-expect-error Composite image settings cannot be changed independently.
  actions.set("bgImageName", "cover.png");
  // @ts-expect-error Composite operations require complete payloads.
  actions.setBackgroundImage({ name: "cover.png" });
  // @ts-expect-error Unknown per-mode media placement.
  actions.setMediaPosition("bars", "center");
  // @ts-expect-error Mode preferences are lists of IDs.
  actions.setModePreferences({ order: [1, 2], disabled: [] });
}
module.exports = { checkActions };
