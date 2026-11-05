# Audio processing

`AudioPipeline.create()` owns the measurements and controls used by every mode.
Call `update(input, settings, timing)` once per render frame, then `forMode(id)`
for the active mode. Both return reused, read-only output records. `reset()` clears
history and source references while retaining reusable buffers.

## Acquisition and order

The original smoothed analyser supplies byte FFT data for unchanged beat/silence
detection and legacy raw descriptors. The existing unsmoothed bass analyser now
supplies one canonical float FFT read per frame for visual measurements and the
bass driver. No analyser is added. Synthetic byte-only sources retain a documented
fallback: `-100 + byte * 70 / 255` dB.

For spectral output:

1. Average linear power, with overlap-weighted frequency boundaries.
2. Normalize to a 45 dB display range below the shared peak reference. The reference
   rises immediately, falls at 12 dB/s, and has a −65 dB floor. Silence at/below
   −100 dB produces zero. The reference follows audio even while switching modes.
3. Apply any named profile threshold.
4. Apply base Sensitivity, then the selected response curve, once each.
5. Apply the smoothed bass multiplier once, then profile release smoothing.

Sensitivity and bass gain both use direct attenuation below unity and
`value * gain / (1 + (gain - 1) * value)` above unity. This keeps strong bands
ordered rather than clipping them all to one. Disabling bass sensitivity or using
zero Amount immediately selects the independently maintained neutral history.

The bass driver retains its separate 30–180 Hz power measurement, −65 to −25 dB
calibration, selected response curve, Amount calculation, and 40 ms rise/120 ms
fall. Its input never includes Sensitivity or processed output.

## Signals and exceptions

- `levels`: final bass (30–250 Hz), mid (250–2000 Hz), and treble (2000–12000 Hz).
  Modes, backgrounds, and effects share these values.
- `motion`, `motionBands`, `motionEnvelopes`: corresponding outputs before bass
  modulation, for phase and rotation. Visual physics can still respond to final
  intensity. Beat triggers and the original pulse remain independent events.
- `bands`: the selected profile's finished spectral values. Existing fractional
  sampling layouts and band counts are retained; Hz boundaries are clipped to Nyquist.
- `waveform`: signed samples with one uniform scale calculated from peak headroom.
  Sensitivity and bass modulation change its amplitude without distorting its shape.
  Response curves affect its energy envelope rather than individual sample polarity.
- `features`: original bass-byte average, legacy mid/treble averages, and raw
  centroid/flux/contrast measurements. Visual controls cannot feed back into them.
- `accents`: processed sub-bass, bass, mids, presence, and air bands for particles
  and Cascade. `envelopes.aurora` is a weighted energy envelope processed once.
- `beatIntensity`: bass-modulated beat intensity for visual effects.
- `referenceDb`, `bassDriverLevel`, `bassMultiplier`, and `rangeEndHz`: inspection
  values for diagnostics and calibration, not extra gain stages.

Registry definitions' `audio` records are the source of truth for band counts,
release rates, and sampling behavior; `AudioPipeline.PROFILES` is a derived view.
The explicit `sampler` selects the algorithm independently of a mode's ID.
Orbit keeps amplitude-ratio contrast. Prism keeps distinct
bins and its adaptive upper cutoff (fast reopening, hold, slow contraction, no
remapping during silence). Cascade keeps its 0.4 threshold before controls; spatial
exclusion, coupling, ripples, and peak dots remain geometry/physics in the mode.

Fluid modes retain final geometric envelope powers: Waves 0.85, Aurora 0.82, and
Tunnel 0.86. Kaleidoscope retains radial tilt and wedge expansion but samples and
smooths each band only once per frame. These are intentional output-shape effects,
not extra applications of the user's response curve.

Only requested profile histories advance. Common measurements advance every frame.
Requests for the same profile within a frame are cached. Capture recovery resets
pipeline and visual state; mode changes, resize, and settings edits preserve history.
