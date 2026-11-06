# Running verification

Run commands from the repository root after installing the existing development
dependencies. No release build or media-watcher rebuild is required for these
JavaScript and Electron checks.

Electron checks run in hidden, non-focusable windows by default. Checks that
require native foreground windows are reported as **skipped**, not passed. Use
`npm run test:electron -- --interactive mode-manager mini-overlay` when desktop
interaction is convenient. The flag is required even when selecting a native
check explicitly; it is never enabled by an inherited environment variable.
Desktop-only entrypoints start with `// @verification-interactive` and also
declare `requiresDesktop` to the harness. The runner records their skip before
launching Electron; the harness independently guards direct invocations.

`npm run test:electron -- --interactive mini-overlay` checks the shared live renderer across
normal and transparent native hosts, synthetic audio continuity, overlay layers,
window bounds, lock confirmation, tray recovery, and background preferences.
Native desktop interaction should also be checked over another window when
changing the overlay's window or input policy.

| Command                   | Coverage                                                    |
| ------------------------- | ----------------------------------------------------------- |
| `npm test`                | Existing Jest entrypoint; normal Jest arguments still work. |
| `npm run test:unit`       | Complete JavaScript suite, run serially.                    |
| `npm run test:audio`      | Acquisition, audio math/pipeline, bass sensitivity.         |
| `npm run test:visuals`    | Mode lifecycle/geometry, Orbit, Prism, trails, registry.    |
| `npm run test:settings`   | Settings actions, mode preferences, media, window state.    |
| `npm run check:types`     | Focused JSDoc contracts and expected compiler errors.       |
| `npm run check`           | Type checking, then the complete serial JavaScript suite.   |
| `npm run test:electron`   | All discovered Electron checks, sequentially.               |
| `npm run benchmark:smoke` | Bounded four-mode benchmark entrypoint check.               |

Desktop checks are separate from `check`: they need a working graphical Windows
session and GPU. Bass-sensitivity checks use muted synthetic Web Audio; they do
not take over playback or require a microphone. Only explicitly interactive
checks may show windows or take focus. The single-instance check launches its own secondary
process and does not interact with an existing application instance.

Select Electron checks by their entrypoint basename, for example:

```powershell
npm run test:electron -- mode-manager settings-actions
npm run test:electron -- orbit prism
```

The launcher discovers `*.electron.cjs` files, rejects unknown names before
launching, deduplicates selections, and preserves their requested order. Prism
and Orbit share their assertions and rendering scenes. The older direct Orbit
`--prism` invocation remains supported, but npm commands provide timeout handling
and automatic profile cleanup.

Electron checks use harness `waitFor(description, read, accept, options)` for
observable completion. Probes run sequentially, default to 25 ms intervals and a
five-second deadline, and report the last observation on timeout. Pass `window`
in options to cancel when its renderer closes. `waitForPaint(window, selectors)`
waits for finite transitions on the inspected elements and two animation frames;
continuous animations are excluded. Matching helpers are installed only in test
renderers for assertions that run inside the page. All waits clean up on completion
or teardown. Real analyser settling and process/drag watchdogs remain explicit.
Derive incidental identities from registry/theme metadata; keep historical saved
indices and canonical-order fixtures explicit as compatibility assertions.
`setViewport` keeps the requested native size and awaits the renderer's agreement
with the granted content size, allowing one DIP of fractional-scaling rounding.

## Profiles, results, and failures

Electron commands use the project-local executable, clear `ELECTRON_RUN_AS_NODE`
in the child environment, and forward arguments without a shell. Each check gets
fresh user-data and session-data directories. Reloads within that check retain
preferences; different checks cannot inherit them. Single-instance children
inherit only their check's profile so they contend for the intended test lock.

Every invocation creates a unique directory beneath ignored `dist/verification`.
`results.json` records status, duration, exit code, and artifact/log paths. Each
case retains `output.log` and an `artifacts` directory containing its screenshots
or benchmark JSON/traces. Owned profile directories are removed after the process
exits; diagnostic artifacts remain available for review.

Each Electron check has a 45-second timeout, followed by at most five seconds for
termination. Failures, crashes, or timeouts return a nonzero command exit code;
later selected checks still run. There are no automatic retries. Ctrl+C stops the
active owned process tree and returns 130. If termination or profile cleanup
cannot be confirmed, execution stops, reports the cleanup error, and retains the
profile rather than proceeding unsafely. Cleanup paths must remain within the
created case directory; process termination targets only a launched PID tree.

The shared Electron harness owns window cleanup, metrics IPC, renderer readiness,
reloads, and unexpected renderer-error collection. New checks should use it and
await `loadRenderer`/`reloadRenderer`. Negative startup checks explicitly bypass
readiness and scope their expected error patterns around the failing operation;
unexpected errors elsewhere still fail the check.

## Benchmarks

`benchmark:smoke` uses Particles, Tunnel, Orbit, and Prism with mixed deterministic
synthetic audio, one repeat, 250 ms warmup and 1 second measurement per mode.
Tracing and operation counting are disabled. It always closes its window and has
a 60-second process timeout. This verifies execution and output, not a performance
budget: display refresh, GPU load, and scheduling affect short timing samples.
Benchmarks require a visible window to collect meaningful frame timings, so the
runner skips them unless `--interactive` is explicitly supplied. Use
`npm run benchmark:smoke -- --interactive` when a foreground run is convenient.
Hidden execution is not reported as a successful performance measurement.

Custom measurements retain the normal benchmark's options and measurement logic:

```powershell
npm run benchmark -- --interactive modes=orbit,prism scenarios=mixed repeats=2 duration=3000 trace=false
```

Use `key=value` arguments for reliable forwarding through npm on Windows. Normal
benchmarks also receive an isolated profile and retain JSON/traces under their
run's artifact directory. They have no forced timeout and preserve explicit
`keep-window=true`; use Ctrl+C when finished. The smoke preset rejects overrides
so it cannot accidentally become an unbounded interactive run.

See [rendering fixture provenance](rendering-fixtures.md) before changing a
geometry expectation. Run focused formatting checks on changed files as well;
the existing whole-project formatting commands remain available.

`render-visibility` is a hidden Electron check for background/FX visibility gates
and media text invalidation, including return without capture. Its operation
counters report eliminated canvas calls and character-style writes, not GPU or
FPS gains. Seeded background unit tests compare visible and hidden/resumed
simulation, random consumption, and drawing after respawns and resize.

`trail-cropping` compares full-canvas and cropped histories byte for byte and
checks that excluded regions are transparent. It uses a dedicated readback
surface and the same output context for both paths, avoiding readback-triggered
GPU/CPU blend-rounding differences. Rectangle areas and `pixels × 4` estimates
describe retained storage/work, not measured GPU memory or frame-rate gains.

`overlay-fitting` checks all modes in hidden square, wide, tall, and minimum-size
hosts, including maximum geometry, both Kaleidoscope clipping settings, stable
framing, manual zoom, full-size fitted trails, and state continuity on return.
It waits for canvas resize completion and uses a 0.0001 tolerance for
native Canvas matrix values to accommodate their Float32 precision. Screenshots and scenario records
are retained with the run artifacts.
