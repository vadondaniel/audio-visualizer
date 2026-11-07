// Restore-time compatibility only. This module never mutates live settings or saves.
/** @typedef {{waveformStyle?:unknown,prismLayout?:unknown,mode?:unknown,miniOverlayMode?:unknown,disabledModes?:unknown}} LegacyPrismSettings */
/** @template T @param {typeof globalThis} root @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SettingsMigrations = api;
})(globalThis, function () {
  /** @param {unknown} saved @param {import('./visual-contracts').Registry} registry */
  function migratePrismLayout(saved, registry) {
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return saved;
    const previous = /** @type {LegacyPrismSettings} */ (saved);
    if (previous.waveformStyle !== "prism") return saved;
    const normal =
      typeof previous.mode === "number" && Number.isInteger(previous.mode)
        ? registry.ids[previous.mode]
        : undefined;
    const mini = previous.miniOverlayMode;
    const explicit =
      previous.prismLayout === "circular" ||
      previous.prismLayout === "straight";
    const migrated = {
      ...previous,
      waveformStyle: "line",
      prismLayout: explicit
        ? previous.prismLayout
        : normal === "prism"
          ? "circular"
          : normal === "waveform"
            ? "straight"
            : mini === "prism"
              ? "circular"
              : "straight",
    };
    if (normal === "waveform") migrated.mode = registry.indexOf("prism");
    if (mini === "waveform") migrated.miniOverlayMode = "prism";
    if (
      (normal === "waveform" || mini === "waveform") &&
      Array.isArray(previous.disabledModes)
    )
      migrated.disabledModes = previous.disabledModes.filter(
        (id) => id !== "prism"
      );
    return migrated;
  }
  return { migratePrismLayout };
});
