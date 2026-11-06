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
