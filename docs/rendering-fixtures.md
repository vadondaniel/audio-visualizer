# Rendering fixture provenance

The fixtures record deterministic canvas commands, not screenshots or GPU timing.
Their source history is part of their meaning:

| Fixture                       | Introduced in                                                | Purpose                                                                                                          |
| ----------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `mode-render-baseline.json`   | `90300db` — isolate modes behind a common lifecycle          | Historical raw-input rendering fingerprints across eight frames per scene.                                       |
| `mode-geometry-baseline.json` | `7b4acc0` — centralize audio processing with visual profiles | Finished-signal inputs and geometry fingerprints, separating geometry from intentional audio-processing changes. |

The historical raw-input fixture remains unchanged as a reference. Current
geometry assertions use explicit finished signals from the geometry fixture;
current pipeline behavior is tested separately. Replaying today's pipeline and
replacing the historical hashes would erase that distinction.

Prism's current two geometry hashes reflect its reviewed removal of the static
ring, upper-right seam, and counterclockwise frequency progression. Its stored
signal inputs and the other modes' expectations are unchanged.

## Deterministic setup

The mode fixture helper uses seeded random streams with default seed `12345`,
synthetic 1024-bin frequency data and waveform data, and a canvas recorder that
captures paths, drawing operations, styles, gradients, and transforms. It also
checks finite numeric drawing arguments and tracks balanced save/restore calls.
No music or decoded audio recordings belong in these fixtures.

Landscape uses the helper's 1000×800 canvas and default settings. Portrait uses
420×720, logarithmic response, sensitivity 2.5, Rainbow Cycle, filled waveform,
full radial layout, vortex particles, theme-filled Cascade, treble-to-bass
frequency order, and hue shift 87. The explicit fixture signals keep these
geometry checks independent of the current audio-control implementation.

The historical test at `90300db` hashes eight frames at
`1000 + frame * 1000 / 60` milliseconds. The pending beat occurs on the first
frame; its pulse is 0.8 for four frames and then zero, with the supplied bass
level changing from 0.8 to 0.1. The current geometry test uses fixed renderer and
audio timestamps of 1000 ms and pulse 0.8, updates once, then draws once with the
stored finished signals. Waveform samples retain the helper's signed synthetic
shape. Consult the historical test/helper at the relevant commit when examining
old fingerprints; the current helper has evolved with the pipeline.

Hashes are SHA-256 over serialized recorded canvas events. Historical
canonicalization rounds numeric values to seven decimal places. Geometry
canonicalization also rounds numeric components inside HSL/RGB color strings to
the same precision. These fingerprints are sensitive to command/style changes,
while avoiding insignificant floating-point representation differences.

## Reviewing a mismatch

For a structural refactor, expect fixture contents and hashes to remain unchanged.
Inspect the first differing drawing event, input signal, simulation step, or
random decision before changing expectations. Use audio tests to diagnose pipeline
changes and Electron previews to review actual appearance; neither replaces the
other.

An intentional visual change needs an explanation of the changed behavior and
review of the affected scenes and finished inputs. Update only the affected
expectations after that review, preserving provenance and deterministic setup.
Do not blindly regenerate fingerprints to make tests pass. No automatic fixture
rewrite command is provided.
