const {
  ASPECT_RATIOS,
  fitSize,
  snapSize,
} = require("../src/mini-overlay-math");
test.each(ASPECT_RATIOS)(
  "Shift snapping retains exact common aspect ratio %s",
  (ratio) => {
    const width = 600 * ratio,
      height = 600;
    const result = snapSize(width, height);
    expect(result.aspectRatio).toBe(ratio);
    expect(result.width).toBe(Math.round(width));
    expect(result.height).toBe(height);
  }
);
test("snapping chooses the nearest pointer corner without changing the top-left anchor", () => {
  expect(snapSize(638, 362)).toMatchObject({ aspectRatio: 16 / 9 });
  expect(snapSize(401, 299)).toMatchObject({ aspectRatio: 4 / 3 });
  expect(snapSize(299, 301)).toMatchObject({ aspectRatio: 1 });
  expect(snapSize(361, 639)).toMatchObject({ aspectRatio: 9 / 16 });
});
test.each(ASPECT_RATIOS)(
  "size constraints retain aspect ratio %s at minimum and display limits",
  (ratio) => {
    for (const [width, height] of [
      [10, 10],
      [10000, 10000],
    ]) {
      const size = fitSize(width, height, ratio, 1920, 1080);
      expect(size.width).toBeGreaterThanOrEqual(160);
      expect(size.height).toBeGreaterThanOrEqual(160);
      expect(size.width).toBeLessThanOrEqual(1920);
      expect(size.height).toBeLessThanOrEqual(1080);
      expect(Math.abs(size.width - size.height * ratio)).toBeLessThanOrEqual(1);
    }
  }
);
