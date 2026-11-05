function acquireSingleInstance(app, getWindow) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on("second-instance", () => {
    const window = getWindow();
    // A second launch may arrive while the primary is still building/loading.
    // Its normal startup will show the window when it is ready.
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  return true;
}

module.exports = { acquireSingleInstance };
