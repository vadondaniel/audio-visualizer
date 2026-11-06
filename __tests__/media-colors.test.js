const fs = require("node:fs");
const vm = require("node:vm");
const Registry = require("../src/mode-registry");

function fixture() {
  const writes = [];
  const element = () => ({
    children: [],
    style: { setProperty: (key, value) => writes.push([key, value]) },
    appendChild(child) {
      this.children.push(child);
    },
    replaceChildren() {
      this.children.length = 0;
    },
    querySelectorAll() {
      throw Error("Per-frame DOM query");
    },
  });
  const title = element(),
    artist = element();
  const context = vm.createContext({
    document: { createElement: element },
    state: {
      mediaMetadataEnabled: true,
      mediaDisplay: "title-artist",
      theme: 0,
      hueShift: 0,
      colorGradientEnabled: true,
      glowIntensity: 1,
      mode: 0,
    },
    THEMES: [
      { hue: 120 },
      { colorCycle: true },
      { rainbow: true, cycle: true },
    ],
    mediaState: { metadata: { title: "AB", artist: "CD" } },
    mediaTitle: title,
    mediaArtist: artist,
    overlay: false,
    isMiniOverlayActive: () => context.overlay,
    mediaHasContent: () =>
      context.state.mediaMetadataEnabled &&
      context.mediaState.metadata?.available !== false &&
      !!context.mediaState.metadata,
    currentHue: (offset) =>
      context.state.hueShift +
      offset * (context.state.colorGradientEnabled ? 360 : 0) +
      context.state.theme * 10,
    themeCssColor: (hue, saturation, lightness, alpha) =>
      `${hue}/${saturation}/${lightness}/${alpha}`,
    getGlowBlur: (blur) => blur * context.state.glowIntensity,
  });
  const source = fs.readFileSync(require.resolve("../src/media.js"), "utf8");
  vm.runInContext(
    source.slice(
      source.indexOf("const mediaTextCache"),
      source.indexOf("const MEDIA_POSITION_LABELS")
    ),
    context
  );
  context.setMediaText(title, "AB", "title");
  context.setMediaText(artist, "CD", "artist");
  writes.length = 0;
  return {
    context,
    title,
    artist,
    writes,
    paint: () => context.syncMediaThemeColors(),
  };
}

test("static frames do no repeated character writes or queries; indices are assigned only on rebuild", () => {
  const f = fixture();
  f.paint();
  expect(f.writes).toHaveLength(12); // Two palette values and blur per character.
  expect(f.writes.some(([key]) => key === "--media-char-index")).toBe(false);
  f.writes.length = 0;
  for (let i = 0; i < 144; i++) {
    f.context.state.hueShift++;
    f.paint();
  }
  expect(f.writes).toHaveLength(0); // Previously 4 chars * 4 writes * 144 frames = 2304.
  f.context.setMediaText(f.title, "AB", "title");
  expect(f.writes).toHaveLength(0);
  f.context.setMediaText(f.title, "NEW", "title");
  expect(f.writes.map(([key]) => key)).toEqual(
    Array(3).fill("--media-char-index")
  );
  f.writes.length = 0;
  f.paint();
  expect(f.writes).toHaveLength(9);
});

test("theme, gradient, and effective glow invalidate only the affected properties", () => {
  const f = fixture();
  f.paint();
  f.writes.length = 0;
  f.context.state.theme = 1;
  f.paint();
  expect(f.writes).toHaveLength(8);
  f.writes.length = 0;
  f.context.state.colorGradientEnabled = false;
  f.paint();
  expect(f.writes).toHaveLength(8);
  f.writes.length = 0;
  f.context.state.glowIntensity = 0.5;
  f.paint();
  expect(f.writes).toEqual([
    ["--media-char-glow-blur", "5.0px"],
    ["--media-char-glow-blur", "5.0px"],
    ["--media-char-glow-blur", "3.5px"],
    ["--media-char-glow-blur", "3.5px"],
  ]);
  f.writes.length = 0;
  f.paint();
  expect(f.writes).toHaveLength(0);
});

test.each([1, 2])(
  "cycling theme %s paints exact current hue each frame without rewriting blur",
  (theme) => {
    const f = fixture();
    f.context.state.theme = theme;
    f.paint();
    for (const hue of [0.1, 19.123, 359.99, 0]) {
      f.writes.length = 0;
      f.context.state.hueShift = hue;
      f.paint();
      expect(f.writes).toHaveLength(8);
      expect(f.writes[0]).toEqual([
        "--media-char-stroke",
        `${hue + theme * 10}/95/68/1`,
      ]);
      expect(f.writes[2]).toEqual([
        "--media-char-stroke",
        `${hue + theme * 10 + 360}/95/68/1`,
      ]);
    }
  }
);

test.each(["disabled", "unavailable", "overlay", "cover"])(
  "%s skips color writes while retaining hidden invalidation",
  (reason) => {
    const f = fixture();
    f.paint();
    f.writes.length = 0;
    if (reason === "disabled") f.context.state.mediaMetadataEnabled = false;
    if (reason === "unavailable")
      f.context.mediaState.metadata.available = false;
    if (reason === "overlay") f.context.overlay = true;
    if (reason === "cover") f.context.state.mediaDisplay = "cover";
    f.context.state.theme = 2;
    f.context.state.glowIntensity = 0.2;
    f.context.mediaState.metadata.title = "new";
    f.context.setMediaText(f.title, "new", "title");
    f.writes.length = 0;
    for (let i = 0; i < 20; i++) {
      f.context.state.hueShift++;
      f.paint();
    }
    expect(f.writes).toHaveLength(0);
    f.context.state.mediaMetadataEnabled = true;
    f.context.mediaState.metadata.available = true;
    f.context.overlay = false;
    f.context.state.mediaDisplay = "title-artist";
    f.paint();
    expect(f.writes).toHaveLength(15);
    expect(f.writes[0]).toEqual(["--media-char-stroke", "40/95/68/1"]);
  }
);

test("layout updates visibility before painting; independently excluded elements stay dirty", () => {
  const f = fixture();
  const source = fs.readFileSync(require.resolve("../src/media.js"), "utf8");
  Object.assign(f.context, {
    MODES: Registry.ids,
    ModeRegistry: Registry,
    mediaOverlay: { dataset: {}, classList: { toggle() {} } },
    mediaArtWrap: {},
    mediaCopy: {},
    syncMediaPositionOptions() {},
    getMediaPosition: () => "auto",
  });
  vm.runInContext(
    source.slice(
      source.indexOf("function updateMediaLayout()"),
      source.indexOf("function updateMediaArtAspectRatio")
    ),
    f.context
  );
  f.context.state.mediaDisplay = "title";
  f.context.updateMediaLayout();
  expect(f.title.hidden).toBe(false);
  expect(f.artist.hidden).toBe(true);
  expect(f.writes).toHaveLength(6);
  f.writes.length = 0;
  f.context.mediaState.metadata.title = "";
  f.context.state.mediaDisplay = "title-artist";
  f.context.updateMediaLayout();
  expect(f.title.hidden).toBe(true);
  expect(f.artist.hidden).toBe(false);
  expect(f.writes).toHaveLength(6);
});
