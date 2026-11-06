// Compile-only examples of the real adapter and composition boundaries.
const SettingsUI = require("../../src/settings-ui");
const OverlayUI = require("../../src/mini-overlay-ui");
const TrayUI = require("../../src/tray-controls");
const Entry = require("../../src/renderer-entry");
const Actions = require("../../src/settings-actions");

/** @param {import('../../src/settings-ui').Dependencies} settings
 * @param {import('../../src/mini-overlay-ui').Dependencies} overlay
 * @param {import('../../src/tray-controls').Dependencies} tray
 * @param {import('../../src/renderer-entry').Bridge} bridge
 * @param {HTMLInputElement} input @param {HTMLSelectElement} select */
function contracts(settings, overlay, tray, bridge, input, select) {
  const value = SettingsUI.valueBinding("sensitivity", input, (v) =>
    v.toFixed(1)
  );
  const checkbox = SettingsUI.checkboxBinding(
    "smoothingEnabled",
    input,
    (v) => v
  );
  SettingsUI.checkboxBinding("radialMode", input, (v) => v === "mirrored");
  SettingsUI.valueBinding("waveformStyle", select, (v) => v);
  const controls = SettingsUI.create({
    ...settings,
    bindings: [value, checkbox],
  });
  controls.start();
  controls.sync(["sensitivity"]);
  controls.dispose();
  const presentation = OverlayUI.create(overlay);
  presentation.start();
  presentation.initialize();
  presentation.restore(true);
  presentation.dispose();
  const trayUI = TrayUI.create(tray);
  trayUI.start();
  trayUI.sync();
  trayUI.dispose();
  Entry.startAdapters({
    SettingsUI,
    MiniOverlayUI: OverlayUI,
    TrayControls: TrayUI,
    SettingsActions: Actions,
    bridge,
  });
  const native = Entry.nativeCapabilities();
  native.getMiniOverlayState().then((state) => state.active);
  native.onTraySelect((selection) => {
    const id = selection.id;
    return id;
  });
  // @ts-expect-error Invalid setting key.
  SettingsUI.valueBinding("sensitivty", input, String);
  // @ts-expect-error Numeric settings remain numeric inside converters.
  SettingsUI.valueBinding("sensitivity", input, (v) => v.toUpperCase());
  // @ts-expect-error Value bindings require explicit string conversion.
  SettingsUI.valueBinding("sensitivity", input, (v) => v);
  // @ts-expect-error Checkbox converters return booleans.
  SettingsUI.checkboxBinding("smoothingEnabled", input, (v) => String(v));
  // @ts-expect-error Select elements cannot be checkbox targets.
  SettingsUI.checkboxBinding("smoothingEnabled", select, (v) => v);
  // @ts-expect-error A settings control binding is not an untyped tuple.
  SettingsUI.create({ ...settings, bindings: [[input, "checked"]] });
  // @ts-expect-error Required callback cannot be absent.
  OverlayUI.create({ ...overlay, resetDrawDeadline: undefined });
  OverlayUI.create({
    ...overlay,
    // @ts-expect-error Lock must be an actual button.
    elements: { ...overlay.elements, lock: select },
  });
  OverlayUI.create({
    ...overlay,
    // @ts-expect-error Native calls resolve a presentation, not a boolean.
    api: { ...overlay.api, lockMiniOverlay: async () => true },
  });
  // @ts-expect-error Native selection payload uses the shared discriminant.
  native.onTraySelect(({ color }) => color);
  // @ts-expect-error Payload must include both ordered choice lists.
  native.setTraySettings({ mode: "bars", theme: "Ice" });
  // @ts-expect-error Tray requires activity as a function.
  TrayUI.create({ ...tray, isActive: true });
  Entry.startAdapters({
    // @ts-expect-error Bootstrap requires real factories.
    SettingsUI: {},
    MiniOverlayUI: OverlayUI,
    TrayControls: TrayUI,
    SettingsActions: Actions,
    bridge,
  });
  // @ts-expect-error Lifecycle start accepts no settings or event payload.
  presentation.start(true);
  // @ts-expect-error Restore takes a boolean, not a style name.
  presentation.restore("prism");
  // @ts-expect-error Legacy raw capture globals remain unavailable.
  analyser.getByteFrequencyData(freqData);
}
module.exports = { contracts };
