# Visual mode lifecycle

Each mode module exports `createMode(services)` in CommonJS and registers its
factory under `VisualModes[id]` in the browser. Loading a factory does not create
its simulation or load its assets. The application creates one instance per mode.

Instances expose:

- `update(frame)`: advance simulation once, prepare render data, consume randomness.
- `draw(ctx, frame)`: draw the prepared state without advancing simulation or events.
- `reset()`: restore initial state and random-stream position, retaining reusable storage.

The host calls update then draw only for the active mode. Switching, resizing, and
settings changes do not reset modes. Capture teardown/recovery resets all modes.
Drawing is enclosed in canvas save/restore by the controller; modes must balance
their own save/restore calls too. Draw requires an update after creation or reset.

## Frame inputs

The host reuses the frame object and its nested records. Treat them as read-only;
do not retain their values as history without copying the data needed.

- `width`, `height`: canvas pixels; `settings`: current application settings.
- `timestampMs`: renderer timestamp; `elapsedMs`: clamped frame duration;
  `dtSec`: the same duration in seconds; `audioClockMs`: existing beat/history clock.
- `signals`: finished, borrowed audio outputs from the [audio pipeline](audio-pipeline.md).
  Modes receive final levels, unmodulated motion levels, their own spectral bands,
  signed waveform samples, and raw descriptors. They do not receive analyser buffers
  or audio-control helpers and must not reapply Sensitivity, curves, or bass gain.
- `beat.pulse`, `beat.justHit`: existing beat state. The host clears a pending beat
  after Particles updates; modes never mutate shared beat state.
- `mediaArt`: a loaded, valid cover image when the current display enables it;
  otherwise null. Radial and Cascade retain their existing crop and fallback behavior.

## Injected services

Factories receive `constants`, `palette.currentHue`,
`palette.themeCssColor`, `loadImage(src)`, `restore(storage, initial)`,
and `createRandom()`. Random streams are instance-owned callable generators with
`getState()` and `setState()` for reset. The controller also accepts the host's
`consumeBeat()` callback. Modes do not access DOM globals, devices, or clocks.

Keep geometry, animation, and visual physics in modes. Sampling, normalization,
controls, and audio smoothing belong to the pipeline's named profiles.

`mode-geometry-baseline.json` supplies synthetic finished signals and drawing
fingerprints captured from the pre-pipeline implementations. The tests therefore
check geometry independently of intentional audio changes. The older
`mode-render-baseline.json` remains a historical raw-input reference; neither
fixture should be regenerated to conceal an unexplained rendering change.
No music files are test fixtures.
