# Mini overlay lifecycle

The main process owns two native `BaseWindow` hosts and one live
`WebContentsView`. The view moves between hosts; its renderer, capture session,
audio pipeline, mode instances, and media subscription stay alive. Native host
resize events update the view bounds, which use the existing canvas resize path.
The normal host remains hidden while the overlay is active, preserving its
normal bounds, maximized state, and always-on-top preference. Fullscreen is
temporarily exited and restored on return.

The overlay is transparent, frameless, and always on top. Its native resize
borders are disabled; dragging the visual surface and the resize grip send bounds
through typed preload operations. Main-process validation confines finite bounds
to a display's full bounds, allowing taskbar overlap. The initial corner is above
the taskbar, and the overlay's topmost level permits placement over it.
Holding Shift during resize snaps to square, 4:3, 3:2, or 16:9 and their portrait
equivalents. Shared resize math keeps the selected ratio when native display or
minimum-size constraints apply. The resize outline and dimensions use the actual
renderer viewport size; the grip and label have opaque high-contrast surfaces.
`mini-overlay.json` beneath userData stores bounds only;
display changes re-clamp them. Presentation and click-through locking are never
restored at startup. `miniOverlayShowBackground` uses the existing renderer
settings actions and saved-setting validation, independently of normal background
settings.

Overlay display controls use the same settings actions and persistence: scale
50–200%, grouped picture opacity 10–100%, and a 15/30/60/120 FPS or unlimited
canvas-drawing cap (60 by default). CSS scales only the presented mode canvas;
the background and canvas share one opacity surface while controls remain outside
it. These controls have no effect in the normal presentation.

An independent mode is stored by registry ID; `follow` uses the normal numeric
selection. One effective-mode resolver selects both audio profile and mode
instance. Overlay number shortcuts affect its independent selection, while
auto-cycle continues to change only the normal selection. Disabled selections
fall back during the same mode-preferences action; unknown saved IDs use Follow.

Audio acquisition, pipeline processing, beat/silence detection, and active-mode
updates continue at animation-frame cadence. The scheduled drawing deadline gates
mode drawing, procedural backgrounds, and trail capture/compositing. Backgrounds
receive elapsed time between draws; trails retain real capture timestamps. The
controller's `render` remains an update/draw compatibility composition. Canvas
resizing and capture reset retain their existing lifecycle behavior; scale,
opacity, and FPS edits do not clear simulation or trail history.

Overlay presentation hides external metadata and full-screen effects without
changing their preferences or media-art availability. Radial/Cascade artwork
inside the mode remains part of the mode rendering. The centered hover toolbar
returns to normal, opens overlay settings, or requests locking. A native modal
defaults to Cancel and explains tray recovery every time. Native mouse-ignore is
enabled only after confirmation resolves. The tray's Unlock action restores input;
its return action and a second app launch unlock and restore the normal host.

Only the persistent renderer may invoke overlay IPC. Capture must be running to
enter. An attachment failure returns to the normal host and reports the error.
Shutdown explicitly closes the renderer, both hosts, and tray because a
`WebContentsView` is not automatically destroyed with its host.

Unit tests cover policy, IPC ownership, bounds, settings, pointer gestures, and
shutdown. The native lifecycle check requires explicit `--interactive`; see
[verification commands](verification.md). Default verification cannot show or
focus windows, and skipped interactive checks are reported separately.
`npm run test:electron -- overlay-display` verifies display controls, effective
profiles, grouped pixel opacity, and persistence in a hidden window.
