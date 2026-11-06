const {
  resolveBounds,
  recoverBounds,
  hasGrabArea,
  ASPECT_RATIOS,
} = require("../src/mini-overlay-math");
const area = { x: 0, y: 0, width: 1920, height: 1080 };
const rectangle = (changes = {}) => ({
  x: 100,
  y: 100,
  width: 320,
  height: 320,
  ...changes,
});
const move = (changes) =>
  rectangle({ operation: "move", snapToEdges: true, ...changes });
const resize = (changes) =>
  rectangle({ operation: "resize", snapToEdges: true, ...changes });
const resolve = (value) => resolveBounds(value, area, [area]);

test.each([
  [{ x: -272 }, { x: -272, y: 100 }],
  [{ y: -272 }, { x: 100, y: -272 }],
  [{ x: 1872 }, { x: 1872, y: 100 }],
  [{ y: 1032 }, { x: 100, y: 1032 }],
  [
    { x: -10000, y: -10000 },
    { x: -272, y: -272 },
  ],
  [
    { x: 10000, y: 10000 },
    { x: 1872, y: 1032 },
  ],
])("overhang retains a grab area: %p", (changes, expected) => {
  const result = resolve(move(changes));
  expect(result).toEqual(rectangle(expected));
  expect(hasGrabArea(result, [area])).toBe(true);
});

test.each([
  [{ x: -12 }, { x: 0 }],
  [{ x: 12 }, { x: 0 }],
  [{ x: -13 }, { x: -13 }],
  [{ x: 13 }, { x: 13 }],
  [{ x: 1588 }, { x: 1600 }],
  [{ x: 1612 }, { x: 1600 }],
  [{ x: 1613 }, { x: 1613 }],
  [{ y: -12 }, { y: 0 }],
  [{ y: -13 }, { y: -13 }],
  [{ y: 748 }, { y: 760 }],
  [{ y: 772 }, { y: 760 }],
  [{ y: 773 }, { y: 773 }],
  [
    { x: -8, y: 766 },
    { x: 0, y: 760 },
  ],
])(
  "magnetic movement snaps only inside the 12 px zone: %p",
  (input, expected) => {
    expect(resolve(move(input))).toEqual(rectangle(expected));
  }
);

test("Alt intent and requests without gesture metadata bypass snapping without removing recovery", () => {
  expect(resolve(move({ x: -8, y: 766, snapToEdges: false }))).toEqual(
    rectangle({ x: -8, y: 766 })
  );
  expect(resolve(rectangle({ x: 8, y: 8, snapToEdges: true }))).toEqual(
    rectangle({ x: 8, y: 8 })
  );
  expect(resolve(move({ x: -9999, snapToEdges: false })).x).toBe(-272);
});

test("negative monitors, seams, and gaps use all monitor bounds without trapping movement", () => {
  const left = { x: -1280, y: 0, width: 1280, height: 1024 };
  const distant = { x: 2500, y: 200, width: 1000, height: 900 };
  const displays = [area, left, distant];
  expect(resolveBounds(move({ x: -1288 }), left, displays).x).toBe(-1280);
  expect(resolveBounds(move({ x: -328 }), left, displays).x).toBe(-320);
  expect(resolveBounds(move({ x: -13 }), area, displays).x).toBe(-13);
  expect(resolveBounds(move({ x: 13 }), area, displays).x).toBe(13);
  expect(resolveBounds(move({ x: 2493, y: 300 }), distant, displays).x).toBe(
    2500
  );
  const gap = resolveBounds(move({ x: 2150, y: 300 }), distant, displays);
  expect(gap.x).toBe(2228);
  expect(hasGrabArea(gap, displays)).toBe(true);
});

test("independent axis snaps cannot leave a window stranded between diagonal monitors", () => {
  const diagonal = { x: 2000, y: 1200, width: 800, height: 600 };
  for (const x of [1870, 1905, 1995, 2010])
    for (const y of [1030, 1085, 1190, 1205]) {
      const result = resolveBounds(move({ x, y }), area, [area, diagonal]);
      expect(hasGrabArea(result, [area, diagonal])).toBe(true);
    }
});

test("snapping ignores edge extensions from monitors outside the window's span", () => {
  const below = { x: 20, y: 2000, width: 1904, height: 1080 };
  const right = { x: 2500, y: 20, width: 1000, height: 1000 };
  const displays = [area, below, right];
  expect(resolveBounds(move({ x: 22 }), area, displays).x).toBe(22);
  expect(resolveBounds(move({ y: 22 }), area, displays).y).toBe(22);
  expect(resolveBounds(resize({ width: 1823 }), area, displays).width).toBe(
    1820
  );
  expect(resolveBounds(resize({ height: 915 }), area, displays).height).toBe(
    915
  );
});

test("bottom-right resizing snaps moving edges and can continue through them", () => {
  expect(resolve(resize({ width: 1815, height: 975 }))).toEqual(
    rectangle({ width: 1820, height: 980 })
  );
  expect(resolve(resize({ width: 1833, height: 993 }))).toEqual(
    rectangle({ width: 1833, height: 993 })
  );
  expect(
    resolve(resize({ width: 1815, height: 975, snapToEdges: false }))
  ).toEqual(rectangle({ width: 1815, height: 975 }));
  expect(resolve(resize({ width: 99999, height: -99999 }))).toEqual(
    rectangle({ width: 1920, height: 160 })
  );
});

test("off-screen resize anchors raise minimum dimensions rather than moving", () => {
  expect(
    resolve(resize({ x: -272, y: -252, width: 160, height: 160 }))
  ).toEqual({ x: -272, y: -252, width: 320, height: 300 });
  const result = resolve(
    resize({ x: -300, y: -100, width: 160, height: 160, aspectRatio: 16 / 9 })
  );
  expect(result).toEqual({ x: -300, y: -100, width: 348, height: 196 });
  expect(hasGrabArea(result, [area])).toBe(true);
});

test("infeasible resize anchors or ratios are rejected without teleporting the window", () => {
  expect(resolve(resize({ x: 5000, y: 5000 }))).toBeNull();
  expect(
    resolve(
      resize({ x: -1700, y: -900, width: 1080, height: 1080, aspectRatio: 1 })
    )
  ).toBeNull();
  expect(
    resolve(
      resize({
        x: -1700,
        y: -900,
        width: 1920,
        height: 1080,
        aspectRatio: 16 / 9,
      })
    )
  ).toMatchObject({ x: -1700, y: -900, width: 1920, height: 1080 });
});

test("ratio edge snapping chooses the nearest corner and favors right-edge ties", () => {
  const square = { x: 0, y: 0, width: 1000, height: 1000 };
  expect(
    resolveBounds(
      resize({ x: 100, y: 105, width: 898, height: 898, aspectRatio: 1 }),
      square,
      [square]
    )
  ).toEqual({ x: 100, y: 105, width: 900, height: 900 });
  expect(
    resolveBounds(
      resize({ x: 100, y: 104, width: 898, height: 898, aspectRatio: 1 }),
      square,
      [square]
    )
  ).toEqual({ x: 100, y: 104, width: 900, height: 900 });
  expect(
    resolveBounds(
      resize({ x: 100, y: 108, width: 894, height: 894, aspectRatio: 1 }),
      square,
      [square]
    )
  ).toEqual({ x: 100, y: 108, width: 892, height: 892 });
});

test.each(ASPECT_RATIOS)(
  "ratio %s survives edge snaps, bypass, size limits, and off-screen anchors",
  (ratio) => {
    for (const [x, y] of [
      [-272, -272],
      [100, 100],
      [1872, 1032],
    ])
      for (const [width, height] of [
        [1, 1],
        [10000, 10000],
        [1818, 978],
        [500, 400],
      ])
        for (const snapToEdges of [true, false]) {
          const result = resolve(
            resize({ x, y, width, height, aspectRatio: ratio, snapToEdges })
          );
          expect(result).not.toBeNull();
          expect(result.x).toBe(x);
          expect(result.y).toBe(y);
          expect(result.width).toBeGreaterThanOrEqual(160);
          expect(result.height).toBeGreaterThanOrEqual(160);
          expect(result.width).toBeLessThanOrEqual(1920);
          expect(result.height).toBeLessThanOrEqual(1080);
          expect(
            Math.abs(result.width - result.height * ratio)
          ).toBeLessThanOrEqual(1);
          expect(hasGrabArea(result, [area])).toBe(true);
        }
  }
);

test("restoration preserves recoverable overhang and recovers lost or oversized bounds fully", () => {
  expect(recoverBounds(rectangle({ x: -272, y: 1032 }), area, [area])).toEqual(
    rectangle({ x: -272, y: 1032 })
  );
  expect(recoverBounds(rectangle({ x: 9999, y: -9999 }), area, [area])).toEqual(
    rectangle({ x: 1600, y: 0 })
  );
  const smaller = { x: -800, y: -100, width: 800, height: 600 };
  const recovered = recoverBounds(
    rectangle({ x: -1200, y: -400, width: 1920, height: 1080 }),
    smaller,
    [smaller]
  );
  expect(recovered).toEqual({ x: -1200, y: -400, width: 800, height: 600 });
  expect(hasGrabArea(recovered, [smaller])).toBe(true);
});
