// Persist mode names so preferences survive additions to the built-in list.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ModeList = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalize(modes, order, disabled) {
    const known = new Set(modes);
    const modeOrder = [
      ...new Set([
        ...(Array.isArray(order) ? order.filter((id) => known.has(id)) : []),
        ...modes,
      ]),
    ];
    const disabledModes = [
      ...new Set(
        Array.isArray(disabled) ? disabled.filter((id) => known.has(id)) : []
      ),
    ];
    if (modeOrder.length && disabledModes.length === modeOrder.length)
      disabledModes.splice(disabledModes.indexOf(modeOrder[0]), 1);
    return { modeOrder, disabledModes };
  }

  function enabled(order, disabled) {
    return order.filter((id) => !disabled.includes(id));
  }

  function next(order, disabled, current) {
    const available = enabled(order, disabled);
    return available[(available.indexOf(current) + 1) % available.length];
  }

  return { normalize, enabled, next };
});
