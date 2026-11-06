const IPC = Object.freeze({
  TOGGLE_FULLSCREEN: "toggle-fullscreen",
  TOGGLE_ALWAYS_ON_TOP: "toggle-always-on-top",
  QUIT_APP: "quit-app",
  GET_PERFORMANCE_METRICS: "get-performance-metrics",
  SET_MEDIA_METADATA_ENABLED: "set-media-metadata-enabled",
  MEDIA_METADATA: "media-metadata",
  OVERLAY_ENTER: "overlay-enter",
  OVERLAY_RESTORE: "overlay-restore",
  OVERLAY_LOCK: "overlay-lock",
  OVERLAY_STATE: "overlay-state",
  OVERLAY_GET_STATE: "overlay-get-state",
  OVERLAY_GET_BOUNDS: "overlay-get-bounds",
  OVERLAY_SET_BOUNDS: "overlay-set-bounds",
});

module.exports = IPC;
