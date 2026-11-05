const fs = require("fs");
const vm = require("vm");
const path = require("path");

// Exercise the real metadata handler with controllable asynchronous Image callbacks.
function setup() {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/media.js"),
    "utf8"
  );
  const images = [];
  const element = () => ({
    classList: { add: jest.fn(), remove: jest.fn() },
    style: { removeProperty: jest.fn() },
    removeAttribute: jest.fn(),
  });
  const context = {
    mediaState: { metadata: null, imageSrc: null, thumbnailImage: null },
    mediaArt: element(),
    mediaArtWrap: element(),
    mediaOverlay: element(),
    mediaTitle: element(),
    mediaArtist: element(),
    updateMediaArtAspectRatio: jest.fn(),
    updateMediaLayout: jest.fn(),
    setMediaText: jest.fn(),
    requestAnimationFrame: jest.fn(),
    Image: function () {
      images.push(this);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf("function updateMediaMetadata("),
      source.indexOf("if (window.electronAPI?.onMediaMetadata)")
    ),
    context
  );
  return { ...context, images, update: context.updateMediaMetadata };
}

test("an old cover loading after the new cover cannot replace it", () => {
  const app = setup();
  app.update({ title: "old", thumbnailDataUrl: "data:old" });
  app.update({ title: "new", thumbnailDataUrl: "data:new" });
  app.images[1].onload();
  app.images[0].onload();
  expect(app.mediaState.thumbnailImage).toBe(app.images[1]);
  expect(app.updateMediaArtAspectRatio).toHaveBeenCalledTimes(1);
});

test("an old cover error cannot hide the new cover", () => {
  const app = setup();
  app.update({ thumbnailDataUrl: "data:old" });
  app.update({ thumbnailDataUrl: "data:new" });
  app.images[1].onload();
  app.mediaArt.classList.remove.mockClear();
  app.images[0].onerror();
  expect(app.mediaState.thumbnailImage).toBe(app.images[1]);
  expect(app.mediaArt.classList.remove).not.toHaveBeenCalled();
});

test("clearing metadata invalidates any pending cover load", () => {
  const app = setup();
  app.update({ thumbnailDataUrl: "data:old" });
  app.update(null);
  app.images[0].onload();
  expect(app.mediaState.thumbnailImage).toBeNull();
  expect(app.updateMediaArtAspectRatio).not.toHaveBeenCalled();
});
