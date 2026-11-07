# Visual mode lifecycle

Each mode module exports `createMode(services)` in CommonJS and calls
`ModeRegistry.registerFactory(id, createMode)` in the browser. Loading a factory does not create
its simulation or load its assets. The application creates one instance per mode.

## Registry and startup

`src/mode-registry.js` owns canonical IDs, labels, module paths, audio profiles,
and media capabilities. Definitions and their nested records are immutable.
`MODES` and `AudioPipeline.PROFILES` are derived compatibility views; numeric saved
selections still refer to canonical order, independently of user ordering.
`mediaDefaults()` returns fresh preferences rather than exposing definition objects.

To add a mode using existing behavior, add its module and one registry entry:

- `id`, `label`, and `modulePath`: append the ID to preserve existing numeric selections.
- `audio`: select an existing `sampler`, band `count`, `release`, and any sampler-specific
  parameters. Sampling dispatch follows `sampler`, not the new mode's ID.
- `media`: select `group` (`free` compass positions or `focus` above/below),
  `defaultPosition`, `autoPlacement`, and `overlayCover`. Placement presets are
  `default`, `upper-center`, `left-below-center`, `left-mid`, `high-center`,
  `right-upper`, `left-bottom`, `right-bottom`, and `focus`.

Selectors, the manager, settings defaults, renderer instances, and benchmarks discover
the entry automatically. New sampling algorithms or controls still need implementation.
Unknown or duplicate factory registrations fail; created instances must implement
all three lifecycle methods.

`renderer-entry.js` loads modules sequentially in registry order, then initializes
the host, render loop, media UI, mode manager, and settings handlers. Await
`window.rendererReady` in Electron checks and benchmarks. Start remains disabled
until readiness; loading or registration failures reject readiness and show the
existing error area without removing the start overlay.

Instances expose:

- `update(frame)`: advance simulation once, prepare render data, consume randomness.
- `draw(ctx, frame)`: draw the prepared state without advancing simulation or events.
- `reset()`: restore initial state and random-stream position, retaining reusable storage.
- Optional `getRenderBounds(frame)`: return a borrowed canvas-space rectangle
  containing all painted pixels, including glow, or `null` for full canvas.
- Optional `getOverlayBounds(frame)`: return reusable maximum geometry bounds
  for mini-overlay fitting, excluding diffuse glow; missing/null keeps viewport framing.

The host calls update then draw only for the active mode. Switching, resizing, and
settings changes do not reset modes. Capture teardown/recovery resets all modes.
Drawing is enclosed in canvas save/restore by the controller; modes must balance
their own save/restore calls too. Draw requires an update after creation or reset.

Prism has a shared `prismLayout` setting: Circular (default) or Straight. Both use
the same audio history; Straight preserves its full-width geometry and returns
null trail/overlay bounds, while Circular retains cropping and automatic fitting.
Waveform keeps only Single line and Filled ribbon. Restore-time migration moves
legacy Waveform Prism selections to Prism, enabling it when needed. A valid saved
layout wins; otherwise normal-window appearance takes priority over an independent
mini-player selection. Migration does not save or move media-position preferences.

## Host presentation work

Procedural backgrounds have a separate update/draw lifecycle. Updates run on
eligible drawing frames with the existing elapsed time and unmodulated motion
inputs, including when the mini overlay hides its background. Drawing consumes
prepared state; Starfield projections are reused and respawns remain in update.
The compatibility `renderProceduralBackground` calls both. Overlay presentation
skips hidden background drawing and all live FX style updates without pausing
simulation or accumulating a catch-up step.

Orbit, Prism, Radial, and Kaleidoscope fit their maximum geometry into the mini
overlay with an 8 px display-space margin. Kaleidoscope bounds follow its clipping
setting. The host transforms drawing before rasterization, retaining actual frame
dimensions, simulation coordinates, native glow blur, and stable framing across
audio/hue changes. Backgrounds and controls are outside the transform. The saved
Visualizer scale remains an additional zoom; values above 100% can crop content.
Other modes retain their viewport compositions, including Cascade's scene particles.

Trail snapshots retain native-resolution rectangles for Orbit, Prism, and Radial.
Their reusable bounds use maximum geometry extents and conservative glow padding,
so audio peaks do not resize snapshot storage. Other modes use full-canvas history.
Each snapshot owns its origin; compositing preserves mixed-mode history and the
existing capture schedule and opacity. The pool prefers matching dimensions,
retains at most one unused spare, and zeroes discarded canvas dimensions on
release/reset. No production pixel readback is used.
Automatically fitted overlay drawing uses full-canvas history so native shadows
and the transformed geometry cannot be clipped by normal-window trail bounds.

External media text caches its character nodes and painted palette inputs.
Static frames do no repeated character writes; cycling themes use the renderer's
current hue on every animation frame. Visibility gates preserve pending changes.
Layout synchronizes colors after visibility flags, and the injected presentation
callback refreshes text on return even without capture. Internal artwork is
independent of this text cache.

## Frame inputs

The host reuses the frame object and its nested records. Treat them as read-only;
do not retain their values as history without copying the data needed.

- `width`, `height`: canvas pixels; `settings`: the read-only visual settings view.
  Audio controls belong to the pipeline and are excluded from this view.
- `timestampMs`: renderer timestamp; `elapsedMs`: clamped frame duration;
  `dtSec`: the same duration in seconds; `audioClockMs`: existing beat/history clock.
- `signals`: finished, borrowed audio outputs from the [audio pipeline](audio-pipeline.md).
  Modes receive final levels, unmodulated motion levels, their own spectral bands,
  signed waveform samples, and raw descriptors. They do not receive analyser buffers
  or audio-control helpers and must not reapply Sensitivity, curves, or bass gain.
  Waveform's Prism style uses Prism's spectral sampling and adaptive range,
  drawing connected peaks above and below a horizontal baseline. Its other
  styles continue to use signed waveform samples.
- `beat.pulse`, `beat.justHit`: existing beat state. The host clears a pending beat
  after Particles updates; modes never mutate shared beat state.
- `mediaArt`: a loaded, valid cover image when the current display enables it;
  otherwise null. Radial and Cascade retain their existing crop and fallback behavior.

## Renderer initialization

Mini-overlay gestures send explicit move/resize and edge-snap intent to the native
controller. Shared placement math permits overhang while retaining a 48 × 48 DIP
grab area on one monitor. Matching edges snap within 12 DIP; Alt bypasses that
magnetism while Shift retains aspect-ratio resizing. Resize keeps its top-left
anchor, raising minimum dimensions when needed; an infeasible ratio is rejected.
Saved overhang remains in place when recoverable, and lost positions recover fully
onto an available monitor. Full monitor bounds include taskbar areas. On Windows,
taskbar overlap enables a one-second, non-activating stacking refresh, including
while locked; auto-hide displays with no reserved work area also need it. The
refresh stops outside that area or on return/disposal and pauses for the lock
dialog and visible owned Settings windows. It never requests keyboard focus.

Renderer adapters are composed in `renderer-entry.js` after all module definitions
load. Settings, overlay, and tray factories have passive `create(dependencies)`
methods, guarded `start()` methods, and idempotent `dispose()` methods. The
bootstrap restores preferences, wires callbacks, starts subscriptions, initializes
settings effects once, and awaits the initial presentation before resolving
`window.rendererReady`. It owns unload and partial-startup cleanup.

Settings actions synchronize controls and tray choices through separate callbacks;
presentation changes notify the tray explicitly. The overlay adapter owns activity
state; rendering and shortcuts read it through `isMiniOverlayActive()`. Only
`renderer-bridge.js` connects these adapters to legacy UI/capture helpers. New
adapter dependencies belong in factory arguments, not script-order globals.

In the main process, `tray-controller.js` owns the native tray, menu choices,
validation, and selection callbacks. The main entry wires it to the persistent
renderer and overlay controller, creates the tray lazily on overlay entry, and
disposes it before the window hosts. Overlay locking queries tray availability;
choice updates refresh menus without publishing presentation events.

Floating Settings uses the same `settings-view.js` markup, `settings-panel.js`
control bindings/labels/conditional rows, palette painter, and preference managers
as the normal sidebar. `settings-client.js` is a UI mirror: it loads metadata but
no visual modes, capture, settings actions, or preference storage. The persistent
renderer remains the only settings owner. `settings-protocol.js` validates typed
commands using existing setting validation; the owner applies each through its
existing actions and publishes revisioned patches with effective-mode context.
Snapshots omit background image data, and patches contain only affected settings.

`settings-window.js` owns the singleton frameless, resizable settings window
and separately authenticates its sender and the owner renderer. It waits for owner readiness and initial UI
synchronization before an explicit open can show/focus the window. State patches
never raise it. Closing retains applied settings; return to normal, owner reload,
or quit closes it and cancels pending requests. Bounds last only for the session.
The existing Settings header is draggable, with a close button outside its drag
region.
Overlay gear/S opens the window; floating Escape dismisses a manager/shortcut
dialog first, then closes Settings. Opening and closing Settings never changes
overlay locking. Development diagnostics use owner-backed requests at 500 ms
only while their section is expanded.

## Injected services

Factories receive `constants`, `palette.currentHue`,
`palette.themeCssColor`, `loadImage(src)`, `restore(storage, initial)`,
and `createRandom()`. Random streams are instance-owned callable generators with
`getState()` and `setState()` for reset. The controller also accepts the host's
`consumeBeat()` callback. Modes do not access DOM globals, devices, or clocks.

`services.applyGlow(ctx, color, blur, intensity)` provides shared shadow scaling;
pass the current settings' glow intensity explicitly. Internal update functions
receive `frame`, and draw functions receive `(ctx, frame)`. Read frame fields and
borrowed signal buffers locally rather than binding them to instance variables.
Helpers take explicit frame/context dependencies plus meaningful geometry or
prepared visual values. Instance closures retain simulation state and reusable
render buffers, not the current frame or canvas context.

Particles prepares stable index buckets during update for trails, bodies, glow,
and Rainbow highlights. Membership uses the stored Float32 render values, and
links retain ascending render-index order within each batch. Drawing traverses
these reusable lists without rescanning the render buffer; reset clears bucket
state while retaining its typed storage. Canvas pass order and batching remain
unchanged. Focused tests compare membership with the original scan rules and
count membership reads rather than infer GPU or frame-rate gains.

Keep geometry, animation, and visual physics in modes. Sampling, normalization,
controls, and audio smoothing belong to the pipeline's named profiles.

## Checked contracts

Run `npm run check:types` for the focused, no-output JavaScript check. Shared
JSDoc contracts live in `src/visual-contracts.js`, a type-only module which is not
loaded by the renderer. It defines `Frame`, `Signals`, `Services`, lifecycle
factories, pipeline inputs, settings, and registry metadata. Import these types
in JSDoc when adding a factory or a helper that consumes frame/context inputs.

`Frame` has finished signals and read-only nested inputs; sample buffers expose
only indexed reads and length. These types express borrowed ownership, not runtime
freezing or copies. The host's `FrameStorage` permits nullable signals during
initialization/reset; `prepareVisualFrame` resolves them before returning a valid
`Frame`. Mode services exclude the controller's host-only beat-consumption hook.

The check covers every mode module, the registry, lifecycle runtime, audio
pipeline, and referenced math utilities. Browser namespace declarations provide
the script APIs without exposing legacy capture globals. The host adapter is
annotated for editors, but broad checking of legacy capture and UI code is deferred.
Settings, tray, overlay adapters, and their bootstrap composition are also checked.
Their DOM references and native APIs are explicit dependencies. Settings binding
helpers capture each key's value type and require string or boolean converters
for the corresponding DOM property. The legacy renderer bridge remains outside
the checked scope; only its typed composition entrypoint is declared globally.
Compile-only adapter fixtures verify invalid bindings, payloads, dependencies,
and lifecycle calls are rejected without exposing capture globals.
Null checking is enabled; implicit types remain permitted in unrelated helpers.
Prepared render records rely on the existing update-before-draw lifecycle, and
their initialization assertions are documented beside their reusable storage.

`__tests__/types/visual-contracts.cjs` contains positive examples and expected
compiler errors for invalid access, mutation, services, and lifecycle methods.
It is compiled, never executed. Runtime and geometry tests remain necessary:
types cannot verify signal ranges, simulation order, or buffer lifetimes.

`mode-geometry-baseline.json` supplies synthetic finished signals and drawing
fingerprints captured from the pre-pipeline implementations. The tests therefore
check geometry independently of intentional audio changes. The older
`mode-render-baseline.json` remains a historical raw-input reference; neither
fixture should be regenerated to conceal an unexplained rendering change.
No music files are test fixtures. See [fixture provenance](rendering-fixtures.md)
for their source commits and deterministic setup, and [verification commands](verification.md)
for focused tests, Electron checks, and bounded benchmarks.
