(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    const button = document.getElementById("startBtn");
    button.disabled = true;
    root.rendererReady = api.initialize(
      root.ModeRegistry,
      api.scriptLoader(document)
    );
    root.rendererReady.then(
      () => {
        button.disabled = false;
      },
      (error) => {
        const message = document.getElementById("errorMsg");
        message.textContent = `Could not initialize visualizer: ${error.message}`;
        message.classList.add("startupError");
        console.error(error);
      }
    );
  }
})(globalThis, function () {
  function scriptLoader(document) {
    return (src) =>
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        const view = document.defaultView;
        const cleanup = () => {
          view.removeEventListener("error", onError);
          script.onload = null;
          script.onerror = null;
        };
        const onError = (event) => {
          if (event.filename === script.src) {
            cleanup();
            reject(Error(event.message));
          }
        };
        view.addEventListener("error", onError);
        script.onload = () => {
          cleanup();
          resolve();
        };
        script.onerror = () => {
          cleanup();
          reject(Error(`Could not load ${src}`));
        };
        document.body.appendChild(script);
      });
  }
  async function initialize(registry, loadScript) {
    await registry.loadFactories(loadScript);
    for (const path of [
      "visual-mode-host.js",
      "visuals/loop.js",
      "settings-actions.js",
      "media.js",
      "preference-manager.js",
      "mode-controls.js",
      "theme-controls.js",
      "settings-ui.js",
      "ui.js",
      "mini-overlay-math.js",
      "mini-overlay-ui.js",
      "tray-controls.js",
    ])
      await loadScript(path);
  }
  return { initialize, scriptLoader };
});
