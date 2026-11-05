# Settings actions

`SettingsActions.create(dependencies)` owns interactive settings changes. It is
DOM-free and receives the mutable state, mode registry/list helpers, theme count,
persistence, timers, and named effect callbacks. Its JSDoc contracts and expected
compiler-error fixtures are checked by `npm run check:types`.

Use `set(key, value)` for an already-parsed scalar setting. Composite and derived
changes use `selectMode(id)`, `nextMode()`, `cycleTheme()`,
`setModePreferences({order, disabled})`, `setMediaPosition(id, position)`,
`setBackgroundImage({dataUrl, name})`, or `clearBackgroundImage()`. Runtime animation
values and individual image fields are excluded from the scalar setter. Existing
saved-setting validation remains in the restoration path; actions do not add
different ranges or clamp values from the controls.

Each command finishes state changes and active media-position normalization
before rendering controls or applying effects, then saves once. Effects are chosen
once per operation: dependent rows/labels, mode/theme/media presentation,
backgrounds, overlays, trail resets, wake locking, or media-watcher IPC. Duration
and FPS commands clear trails; disabling trails clears them; unrelated commands
leave simulation history alone. Mode preferences retain canonical numeric
selection and use the existing enabled-mode fallback.

`settings-ui.js` adapts these effects to browser helpers and synchronizes only
changed controls. File decoding, input parsing, dialog/focus handling, and drag
feedback stay in UI code. Background-image decoding commits its completed result
through one action; failures retain the prior state, and completion order is
unchanged. Rendering helpers never repair or persist settings. Media placement
options share the action module's capability groups while labels remain in the UI.

`restoreSettings()` only reads, validates, and migrates saved data. `loadSettings()`
then calls `initialize()` to synchronize controls and restore effects without
saving or clearing trails. Initialization restores enabled media watching and
auto-cycle, but wake-lock acquisition retains its capture/visibility timing.
The action instance owns one 12-second interval: enabling replaces it, ticks use
`nextMode()`, and disabling or `dispose()` clears it. The browser disposes it on
unload; no timer handle belongs to persisted state.

The renderer bootstrap loads the action module before media/mode controls, then
the browser adapter before UI initialization. Existing command helpers delegate
to the same instance. `syncSelectsToState()` remains a rendering-only helper for
diagnostics and checks that directly prepare state; interactive callers should
use actions.

Verification: `npm test -- --runInBand __tests__/settings-actions.test.js` checks
state/effect ordering, persistence counts, composites, placement normalization,
restoration, and timer ownership. Run the Electron settings-actions, mode-manager,
and bass-sensitivity checks for real controls, shortcuts, drag ordering, file
input, persistence, and viewport behavior. Geometry fixtures are unchanged.
