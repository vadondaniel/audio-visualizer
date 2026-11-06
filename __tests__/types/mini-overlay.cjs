/** @param {import('../../src/mini-overlay').BoundsRequest} value */
function acceptsBounds(value) {
  return value;
}
acceptsBounds({ x: 0, y: 0, width: 320, height: 180, aspectRatio: 16 / 9 });
// @ts-expect-error Bounds remain numeric across preload IPC.
acceptsBounds({ x: 0, y: 0, width: "320", height: 180 });
// @ts-expect-error Aspect ratios are numeric, not UI labels.
acceptsBounds({ x: 0, y: 0, width: 320, height: 180, aspectRatio: "16:9" });
