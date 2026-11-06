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
   * @param {number} [maxWidth] @param {number} [maxHeight]
   * @param {number} [minWidth] @param {number} [minHeight] */
  function fitSize(
    width,
    height,
    ratio,
    maxWidth = Infinity,
    maxHeight = Infinity,
    minWidth = 160,
    minHeight = 160
  ) {
    const minimum = Math.max(minHeight, minWidth / ratio);
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
  /** @typedef {import('./mini-overlay').Bounds} Bounds */
  /** @typedef {import('./mini-overlay').BoundsRequest} BoundsRequest */
  const GRAB_SIZE = 48;
  const SNAP_DISTANCE = 12;
  /** @param {number} value @param {number} minimum @param {number} maximum */
  const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));

  /** Full on-screen recovery; retained for existing callers.
   * @param {Bounds} bounds @param {Bounds} area @returns {Bounds} */
  function clampBounds(bounds, area) {
    const width = Math.round(
      clamp(bounds.width, Math.min(160, area.width), area.width)
    );
    const height = Math.round(
      clamp(bounds.height, Math.min(160, area.height), area.height)
    );
    return {
      width,
      height,
      x: Math.round(clamp(bounds.x, area.x, area.x + area.width - width)),
      y: Math.round(clamp(bounds.y, area.y, area.y + area.height - height)),
    };
  }
  /** @param {Bounds} bounds @param {Bounds} area */
  function overlapWidth(bounds, area) {
    return (
      Math.min(bounds.x + bounds.width, area.x + area.width) -
      Math.max(bounds.x, area.x)
    );
  }
  /** @param {Bounds} bounds @param {Bounds} area */
  function overlapHeight(bounds, area) {
    return (
      Math.min(bounds.y + bounds.height, area.y + area.height) -
      Math.max(bounds.y, area.y)
    );
  }
  /** @param {Bounds} bounds @param {readonly Bounds[]} areas */
  function hasGrabArea(bounds, areas) {
    return areas.some(
      (area) =>
        overlapWidth(bounds, area) >=
          Math.min(GRAB_SIZE, area.width, bounds.width) &&
        overlapHeight(bounds, area) >=
          Math.min(GRAB_SIZE, area.height, bounds.height)
    );
  }

  /** Preserve intentional overhang on restore; lost windows recover fully on-screen.
   * @param {Bounds} bounds @param {Bounds} area @param {readonly Bounds[]} areas */
  function recoverBounds(bounds, area, areas) {
    const recovered = clampBounds(bounds, area);
    const placed = {
      ...recovered,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
    };
    return hasGrabArea(placed, areas.length ? areas : [area])
      ? placed
      : recovered;
  }
  /** @param {Bounds} bounds @param {readonly Bounds[]} areas */
  function keepGrabArea(bounds, areas) {
    if (hasGrabArea(bounds, areas)) return bounds;
    let best = bounds,
      distance = Infinity;
    for (const area of areas) {
      const x = Math.round(
        clamp(
          bounds.x,
          area.x + Math.min(GRAB_SIZE, area.width) - bounds.width,
          area.x + area.width - Math.min(GRAB_SIZE, area.width)
        )
      );
      const y = Math.round(
        clamp(
          bounds.y,
          area.y + Math.min(GRAB_SIZE, area.height) - bounds.height,
          area.y + area.height - Math.min(GRAB_SIZE, area.height)
        )
      );
      const squared = (x - bounds.x) ** 2 + (y - bounds.y) ** 2;
      if (squared < distance) {
        best = { ...bounds, x, y };
        distance = squared;
      }
    }
    return best;
  }
  /** @param {number} value @param {number[]} candidates @param {(candidate:number)=>boolean} accept */
  function nearestEdge(value, candidates, accept) {
    let best = value,
      distance = SNAP_DISTANCE + 1;
    for (const candidate of candidates) {
      const delta = Math.abs(candidate - value);
      if (delta <= SNAP_DISTANCE && delta < distance && accept(candidate)) {
        best = candidate;
        distance = delta;
      }
    }
    return best;
  }
  /** Resolve one gesture request; native display discovery remains in the main process.
   * @param {BoundsRequest} value @param {Bounds} area @param {readonly Bounds[]} displays
   * @returns {Bounds|null} */
  function resolveBounds(value, area, displays) {
    const areas = [area, ...displays.filter((display) => display !== area)];
    const x = Math.round(value.x),
      y = Math.round(value.y);
    const maxWidth = area.width,
      maxHeight = area.height;
    let minWidth = Math.min(160, maxWidth),
      minHeight = Math.min(160, maxHeight);
    const ratio =
      typeof value.aspectRatio === "number" &&
      ASPECT_RATIOS.includes(value.aspectRatio)
        ? value.aspectRatio
        : null;
    if (value.operation === "resize") {
      // Grow the minimum size rather than moving a valid off-screen resize anchor.
      let feasibleAnchor = false;
      for (const target of areas) {
        const grabWidth = Math.min(GRAB_SIZE, target.width),
          grabHeight = Math.min(GRAB_SIZE, target.height);
        const requiredWidth = Math.max(minWidth, target.x + grabWidth - x);
        const requiredHeight = Math.max(minHeight, target.y + grabHeight - y);
        const feasible =
          x <= target.x + target.width - grabWidth &&
          y <= target.y + target.height - grabHeight &&
          requiredWidth <= maxWidth &&
          requiredHeight <= maxHeight &&
          (ratio === null ||
            Math.max(requiredHeight, requiredWidth / ratio) <=
              Math.min(maxHeight, maxWidth / ratio));
        if (feasible) {
          minWidth = requiredWidth;
          minHeight = requiredHeight;
          feasibleAnchor = true;
          break;
        }
      }
      // A ratio that cannot fit at this anchor must not teleport the window.
      if (!feasibleAnchor) return null;
    }
    const size =
      ratio === null
        ? {
            width: Math.round(clamp(value.width, minWidth, maxWidth)),
            height: Math.round(clamp(value.height, minHeight, maxHeight)),
          }
        : fitSize(
            value.width,
            value.height,
            ratio,
            maxWidth,
            maxHeight,
            minWidth,
            minHeight
          );
    let bounds = { x, y, ...size };
    if (value.snapToEdges === true && value.operation === "move") {
      bounds.x = nearestEdge(
        bounds.x,
        areas
          .filter(
            (target) =>
              overlapHeight(bounds, target) >=
              Math.min(GRAB_SIZE, bounds.height, target.height)
          )
          .flatMap((target) => [
            target.x,
            target.x + target.width - bounds.width,
          ]),
        (candidate) => hasGrabArea({ ...bounds, x: candidate }, areas)
      );
      bounds.y = nearestEdge(
        bounds.y,
        areas
          .filter(
            (target) =>
              overlapWidth(bounds, target) >=
              Math.min(GRAB_SIZE, bounds.width, target.width)
          )
          .flatMap((target) => [
            target.y,
            target.y + target.height - bounds.height,
          ]),
        (candidate) => hasGrabArea({ ...bounds, y: candidate }, areas)
      );
    } else if (value.snapToEdges === true && value.operation === "resize") {
      if (ratio === null) {
        bounds.width = nearestEdge(
          bounds.width,
          areas
            .filter(
              (target) =>
                overlapHeight(bounds, target) >=
                Math.min(GRAB_SIZE, bounds.height, target.height)
            )
            .map((target) => target.x + target.width - x),
          (candidate) =>
            candidate >= minWidth &&
            candidate <= maxWidth &&
            hasGrabArea({ ...bounds, width: candidate }, areas)
        );
        bounds.height = nearestEdge(
          bounds.height,
          areas
            .filter(
              (target) =>
                overlapWidth(bounds, target) >=
                Math.min(GRAB_SIZE, bounds.width, target.width)
            )
            .map((target) => target.y + target.height - y),
          (candidate) =>
            candidate >= minHeight &&
            candidate <= maxHeight &&
            hasGrabArea({ ...bounds, height: candidate }, areas)
        );
      } else {
        let best = bounds,
          distance = Infinity;
        // Right-edge candidates precede bottom-edge candidates, preserving the tie policy.
        for (const axis of ["right", "bottom"])
          for (const target of areas) {
            const edgeSize =
              axis === "right"
                ? target.x + target.width - x
                : target.y + target.height - y;
            const currentSize = axis === "right" ? bounds.width : bounds.height;
            if (Math.abs(edgeSize - currentSize) > SNAP_DISTANCE) continue;
            const width = axis === "right" ? edgeSize : edgeSize * ratio;
            const height = axis === "bottom" ? edgeSize : edgeSize / ratio;
            if (
              width < minWidth ||
              width > maxWidth ||
              height < minHeight ||
              height > maxHeight
            )
              continue;
            const candidate = {
              x,
              y,
              ...fitSize(
                width,
                height,
                ratio,
                maxWidth,
                maxHeight,
                minWidth,
                minHeight
              ),
            };
            const squared =
              (candidate.width - bounds.width) ** 2 +
              (candidate.height - bounds.height) ** 2;
            if (squared < distance && hasGrabArea(candidate, [target])) {
              best = candidate;
              distance = squared;
            }
          }
        bounds = best;
      }
    }
    return keepGrabArea(bounds, areas);
  }

  return {
    ASPECT_RATIOS,
    fitSize,
    snapSize,
    GRAB_SIZE,
    SNAP_DISTANCE,
    clampBounds,
    hasGrabArea,
    recoverBounds,
    resolveBounds,
  };
});
