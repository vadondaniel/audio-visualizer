// Shared resize policy for the renderer gesture and native size constraints.
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MiniOverlayMath = api;
})(globalThis, function () {
  const ASPECT_RATIOS = Object.freeze([
    1,
    4 / 3,
    3 / 2,
    16 / 9,
    3 / 4,
    2 / 3,
    9 / 16,
  ]);
  /** @param {number} width @param {number} height @param {number} ratio
   * @param {number} [maxWidth] @param {number} [maxHeight] */
  function fitSize(
    width,
    height,
    ratio,
    maxWidth = Infinity,
    maxHeight = Infinity
  ) {
    const minimum = Math.max(160, 160 / ratio);
    const maximum = Math.min(maxHeight, maxWidth / ratio);
    // Project the pointer's corner onto the aspect-ratio line, anchored top-left.
    const projected = (ratio * width + height) / (ratio * ratio + 1);
    const fitted = Math.min(maximum, Math.max(minimum, projected));
    return { width: Math.round(fitted * ratio), height: Math.round(fitted) };
  }
  /** @param {number} width @param {number} height */
  function snapSize(width, height) {
    const ratio = ASPECT_RATIOS.reduce((best, candidate) => {
      const distance = (value) => {
        const size = fitSize(width, height, value);
        return (size.width - width) ** 2 + (size.height - height) ** 2;
      };
      return distance(candidate) < distance(best) ? candidate : best;
    });
    return { ...fitSize(width, height, ratio), aspectRatio: ratio };
  }
  return { ASPECT_RATIOS, fitSize, snapSize };
});
