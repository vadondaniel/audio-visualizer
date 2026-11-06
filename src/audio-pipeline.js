// Audio measurements and control processing live here, never in drawing modes.
/** @template T
 * @param {typeof globalThis} root
 * @param {(math:typeof import('./audio-math'), registry:import('./visual-contracts').Registry)=>T} build */
(function (root, build) {
  if (typeof module === "object" && module.exports)
    module.exports = build(require("./audio-math"), require("./mode-registry"));
  else root.AudioPipeline = build(root.AudioMath, root.ModeRegistry);
})(globalThis, function (math, registry) {
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const BANDS = [
    [30, 250],
    [250, 2000],
    [2000, 12000],
  ];
  const ACCENTS = [
    [28, 90],
    [90, 250],
    [250, 2000],
    [2000, 6000],
    [6000, 16000],
  ];
  const NAMES = ["bass", "mid", "treble"];
  const ACCENT_NAMES = ["subBass", "bass", "mids", "presence", "air"];
  // Profiles describe audio exceptions and sampling, not drawing behavior.
  const PROFILES = registry.audioProfiles;

  /** @param {import('./visual-contracts').Samples} bytes */
  function legacyBass(bytes) {
    return math.bandAverage(bytes, 0, 0.015);
  }
  /** @param {import('./visual-contracts').Samples} data
   * @param {number} sampleRate
   * @param {number} fftSize
   * @param {number} lowHz
   * @param {number} highHz
   * @param {import('./visual-contracts').Samples} [powers] */
  function powerBandDb(data, sampleRate, fftSize, lowHz, highHz, powers) {
    const binHz = sampleRate / fftSize;
    if (!(binHz > 0) || !data.length) return -Infinity;
    const lo = Math.max(0, lowHz),
      hi = Math.min(sampleRate / 2, highHz);
    if (!(hi > lo)) return -Infinity;
    let power = 0,
      weight = 0;
    const first = Math.max(1, Math.floor(lo / binHz - 0.5));
    const last = Math.min(data.length - 1, Math.ceil(hi / binHz + 0.5));
    for (let i = first; i <= last; i++) {
      const overlap = Math.max(
        0,
        Math.min(hi, (i + 0.5) * binHz) - Math.max(lo, (i - 0.5) * binHz)
      );
      weight += overlap;
      if (Number.isFinite(data[i]))
        power += (powers ? powers[i] : 10 ** (data[i] / 10)) * overlap;
    }
    return weight > 0 && power > 0
      ? 10 * Math.log10(power / weight)
      : -Infinity;
  }
  /** @param {number} db
   * @param {number} referenceDb
   * @param {'db'|'amplitude'} [domain] */
  function normalize(db, referenceDb, domain = "db") {
    if (!Number.isFinite(db) || db <= -100) return 0;
    return domain === "amplitude"
      ? Math.min(1, 10 ** ((db - referenceDb) / 20))
      : clamp(1 + (db - referenceDb) / 45);
  }
  /** @param {number} level
   * @param {Readonly<import('./visual-contracts').AudioSettings>} settings */
  function controlled(level, settings) {
    return math.applyValueHandling(
      math.applyBassGain(level, settings.sensitivity),
      settings.valueHandling
    );
  }
  function prismBandEdge(
    index,
    binCount,
    rangeEnd = Math.floor(binCount * 0.5),
    count = 96
  ) {
    const start = Math.floor(binCount * 0.002);
    const end = Math.min(
      Math.floor(binCount * 0.5),
      Math.max(start + count, Math.round(rangeEnd))
    );
    const extra = Math.max(0, end - start - count);
    return Math.min(
      binCount,
      Math.floor(start + index + (extra * (250 ** (index / count) - 1)) / 249)
    );
  }
  /** @param {import('./visual-contracts').Samples} data
   * @param {import('./visual-contracts').Samples} [powers]
   * @param {number} [count] */
  function prismActiveEnd(data, powers, count = 96) {
    const start = Math.floor(data.length * 0.002),
      end = Math.floor(data.length * 0.5);
    let peak = -Infinity;
    for (let i = start; i < end; i++)
      if (Number.isFinite(data[i])) peak = Math.max(peak, data[i]);
    if (peak <= -75) return 0;
    const threshold = Math.max(-80, peak - 18);
    let last = start;
    for (let lo = start; lo < end; lo += 4) {
      const hi = Math.min(end, lo + 4);
      let db;
      if (powers) {
        let sum = 0;
        for (let i = lo; i < hi; i++) sum += powers[i];
        db = sum > 0 ? 10 * Math.log10(sum / (hi - lo)) : -Infinity;
      } else db = math.spectrumBandDb(data, lo, hi);
      if (db >= threshold) last = hi;
    }
    return Math.min(end, Math.max(start + count, Math.ceil(last * 1.1) + 4));
  }

  /** @param {{registry?:import('./visual-contracts').Registry}} [options]
   * @returns {import('./visual-contracts').Pipeline} */
  function create({ registry: sourceRegistry = registry } = {}) {
    const definitions = sourceRegistry.audioProfiles;
    /** @type {import('./visual-contracts').PipelineInput|null} */
    let input = null;
    /** @type {Readonly<import('./visual-contracts').AudioSettings>|null} */
    let settings = null;
    /** @type {import('./visual-contracts').Samples|null} */
    let spectrum = null;
    let referenceDb = -65,
      dt = 0,
      generation = 0;
    let bassMultiplier = 1,
      previousBytes = new Uint8Array(0),
      waveform = new Float32Array(0);
    let fallback = new Float32Array(0),
      powers = new Float64Array(0);
    const levels = { bass: 0, mid: 0, treble: 0 },
      motion = { bass: 0, mid: 0, treble: 0 };
    const accents = { subBass: 0, bass: 0, mids: 0, presence: 0, air: 0 };
    const features = {
      rawBass: 0,
      legacyMid: 0,
      legacyTreble: 0,
      centroid: 0.5,
      flux: 0,
      contrast: 0,
    };
    const common = {
      levels,
      motion,
      accents,
      features,
      waveform,
      bassMultiplier: 1,
      bassDriverLevel: 0,
      beatIntensity: 0,
      referenceDb,
    };
    const commonNeutral = new Float64Array(8),
      commonFinal = new Float64Array(8);
    const normalizedLevels = new Float64Array(3);
    /** @typedef {{neutral:Float64Array,bands:Float64Array,generation:number,rangeEnd:number,rangeHold:number,envelopeNeutral:number,envelopeFinal:number,output:import('./visual-contracts').CommonSignals & {bands:Float64Array,motionBands:Float64Array,rangeEndHz:number,envelopes:{aurora:number},motionEnvelopes:{aurora:number}}}} ProfileState */
    /** @type {Record<string,ProfileState>} */
    const profiles = Object.fromEntries(
      Object.entries(definitions).map(
        /** @returns {[string,ProfileState]} */ ([id, profile]) => [
          id,
          {
            neutral: new Float64Array(profile.count),
            bands: new Float64Array(profile.count),
            generation: -1,
            rangeEnd: 0,
            rangeHold: 0,
            envelopeNeutral: 0,
            envelopeFinal: 0,
            output: {
              ...common,
              bands: new Float64Array(0),
              motionBands: new Float64Array(0),
              rangeEndHz: 0,
              envelopes: { aurora: 0 },
              motionEnvelopes: { aurora: 0 },
            },
          },
        ]
      )
    );
    for (const profile of Object.values(profiles)) {
      profile.output.bands = profile.bands;
      profile.output.motionBands = profile.neutral;
    }

    function reset() {
      input = null;
      settings = null;
      spectrum = null;
      referenceDb = -65;
      bassMultiplier = 1;
      dt = 0;
      generation = 0;
      previousBytes.fill(0);
      waveform.fill(0);
      fallback.fill(-Infinity);
      powers.fill(0);
      commonNeutral.fill(0);
      commonFinal.fill(0);
      normalizedLevels.fill(0);
      Object.assign(levels, { bass: 0, mid: 0, treble: 0 });
      Object.assign(motion, levels);
      for (const name of ACCENT_NAMES) accents[name] = 0;
      Object.assign(features, {
        rawBass: 0,
        legacyMid: 0,
        legacyTreble: 0,
        centroid: 0.5,
        flux: 0,
        contrast: 0,
      });
      Object.assign(common, {
        bassMultiplier: 1,
        bassDriverLevel: 0,
        beatIntensity: 0,
        referenceDb,
      });
      for (const profile of Object.values(profiles)) {
        profile.neutral.fill(0);
        profile.bands.fill(0);
        profile.generation = -1;
        profile.rangeEnd = 0;
        profile.rangeHold = 0;
        profile.envelopeNeutral = 0;
        profile.envelopeFinal = 0;
        profile.output.envelopes.aurora = 0;
        profile.output.motionEnvelopes.aurora = 0;
        Object.assign(profile.output, {
          bassMultiplier: 1,
          bassDriverLevel: 0,
          beatIntensity: 0,
          referenceDb,
          rangeEndHz: 0,
        });
      }
    }
    /** @param {number} target
     * @param {number} current
     * @param {number} rate */
    function filter(target, current, rate) {
      // Only called after update has installed settings, including from forMode.
      return /** @type {Readonly<import('./visual-contracts').AudioSettings>} */ (
        settings
      ).smoothingEnabled
        ? math.smoothTowards(current, target, Math.exp(-rate * dt))
        : target;
    }
    /** @param {import('./visual-contracts').PipelineInput} nextInput
     * @param {Readonly<import('./visual-contracts').AudioSettings>} nextSettings
     * @param {import('./visual-contracts').Timing} timing
     * @returns {Readonly<import('./visual-contracts').CommonSignals>} */
    function update(nextInput, nextSettings, timing) {
      input = nextInput;
      settings = nextSettings;
      dt = Math.min(0.1, Math.max(0, timing.dtSec));
      generation++;
      const bytes = input.frequencyBytes,
        time = input.timeBytes;
      spectrum = input.spectrumDb || input.readFloatSpectrum?.() || null;
      if (!spectrum) {
        if (fallback.length !== bytes.length)
          fallback = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i++)
          fallback[i] = -100 + (bytes[i] * 70) / 255;
        spectrum = fallback;
      }
      const sampleRate = input.sampleRate || 48000,
        fftSize = spectrum.length * 2;
      let peak = -65;
      const lo = Math.max(1, Math.ceil((20 * fftSize) / sampleRate));
      const hi = Math.min(
        spectrum.length,
        Math.ceil((16000 * fftSize) / sampleRate)
      );
      if (powers.length !== spectrum.length) {
        powers = new Float64Array(spectrum.length);
        for (const [id, definition] of Object.entries(definitions)) {
          if (definition.sampler === "prism") {
            profiles[id].rangeEnd = 0;
            profiles[id].rangeHold = 0;
          }
        }
      }
      for (let i = 0; i < spectrum.length; i++) {
        const finite = Number.isFinite(spectrum[i]);
        powers[i] = finite ? 10 ** (spectrum[i] / 10) : 0;
        if (i >= lo && i < hi && finite) peak = Math.max(peak, spectrum[i]);
      }
      referenceDb = Math.max(peak, referenceDb - dt * 12);
      const enabled =
        settings.bassSensitivityEnabled && settings.bassSensitivityAmount > 0;
      const bassDriverLevel = math.bassPowerLevel(
        spectrum,
        sampleRate,
        fftSize
      );
      bassMultiplier = enabled
        ? math.smoothBassSensitivity(
            bassMultiplier,
            math.bassSensitivityTarget(
              bassDriverLevel,
              settings.bassSensitivityAmount,
              settings.valueHandling
            ),
            dt
          )
        : 1;

      for (let i = 0; i < 8; i++) {
        const [low, high] = i < 3 ? BANDS[i] : ACCENTS[i - 3];
        const normalized = normalize(
          powerBandDb(spectrum, sampleRate, fftSize, low, high, powers),
          referenceDb
        );
        if (i < 3) normalizedLevels[i] = normalized;
        const base = controlled(normalized, settings);
        commonNeutral[i] = filter(base, commonNeutral[i], 10);
        commonFinal[i] = enabled
          ? filter(math.applyBassGain(base, bassMultiplier), commonFinal[i], 10)
          : commonNeutral[i];
        if (i < 3) {
          levels[NAMES[i]] = commonFinal[i];
          motion[NAMES[i]] = commonNeutral[i];
        } else accents[ACCENT_NAMES[i - 3]] = commonFinal[i];
      }
      features.rawBass = legacyBass(bytes);
      features.legacyMid = math.bandAverage(bytes, 0.015, 0.1);
      features.legacyTreble = math.bandAverage(bytes, 0.1, 0.5);
      if (previousBytes.length !== bytes.length)
        previousBytes = new Uint8Array(bytes.length);
      let weighted = 0,
        total = 0,
        flux = 0,
        bytePeak = 0;
      for (let i = 1; i < bytes.length; i++) {
        const value = bytes[i] / 255;
        weighted += ((i * sampleRate) / (bytes.length * 2)) * value;
        total += value;
        bytePeak = Math.max(bytePeak, value);
        flux += Math.max(0, value - previousBytes[i] / 255);
        previousBytes[i] = bytes[i];
      }
      const featureRate = 1 - 0.88 ** (dt * 60),
        fluxRate = 1 - 0.72 ** (dt * 60);
      const centroid =
        total > 0 ? weighted / total / (sampleRate / 2) : features.centroid;
      const contrast = clamp(
        (bytePeak - total / Math.max(1, bytes.length - 1)) /
          Math.max(0.08, bytePeak)
      );
      features.centroid += (centroid - features.centroid) * featureRate;
      features.flux +=
        (Math.min(1, flux / Math.max(12, bytes.length * 0.045)) -
          features.flux) *
        fluxRate;
      features.contrast += (contrast - features.contrast) * featureRate;

      if (waveform.length !== time.length)
        waveform = new Float32Array(time.length);
      let waveformPeak = 0;
      for (let i = 0; i < time.length; i++)
        waveformPeak = Math.max(waveformPeak, Math.abs((time[i] - 128) / 128));
      const finalPeak = math.applyBassGain(
        math.applyBassGain(waveformPeak, settings.sensitivity),
        bassMultiplier
      );
      const scale = waveformPeak > 0 ? finalPeak / waveformPeak : 0;
      for (let i = 0; i < time.length; i++)
        waveform[i] = ((time[i] - 128) / 128) * scale;
      Object.assign(common, {
        bassDriverLevel,
        waveform,
        bassMultiplier,
        beatIntensity: math.applyBassGain(input.beatPulse || 0, bassMultiplier),
        referenceDb,
      });
      return common;
    }

    /** @param {string} id
     * @returns {import('./visual-contracts').Signals} */
    function forMode(id) {
      const spec = definitions[id],
        profile = profiles[id];
      if (!spec) throw Error(`Unknown audio profile: ${id}`);
      if (!input || !settings || !spectrum)
        throw Error("Audio pipeline requires update before forMode");
      if (profile.generation === generation) return profile.output;
      profile.generation = generation;
      const sampler =
        spec.sampler === "waveform" && settings.waveformStyle === "prism"
          ? "prism"
          : spec.sampler;
      if (sampler === "aurora") {
        const neutral = controlled(
          normalizedLevels[0] * 0.45 +
            normalizedLevels[1] * 0.35 +
            normalizedLevels[2] * 0.2,
          settings
        );
        profile.envelopeNeutral = filter(
          neutral,
          profile.envelopeNeutral,
          spec.release
        );
        profile.envelopeFinal =
          settings.bassSensitivityEnabled && settings.bassSensitivityAmount > 0
            ? filter(
                math.applyBassGain(neutral, bassMultiplier),
                profile.envelopeFinal,
                spec.release
              )
            : profile.envelopeNeutral;
        profile.output.envelopes.aurora = profile.envelopeFinal;
        profile.output.motionEnvelopes.aurora = profile.envelopeNeutral;
      }

      const n = spectrum.length,
        sampleRate = input.sampleRate || 48000,
        nyquist = sampleRate / 2;
      if (sampler === "prism") {
        const activeEnd = prismActiveEnd(spectrum, powers, spec.count);
        if (!profile.rangeEnd)
          profile.rangeEnd = activeEnd || Math.floor(n * 0.5);
        if (activeEnd > profile.rangeEnd) {
          profile.rangeEnd +=
            (activeEnd - profile.rangeEnd) * (1 - Math.exp(-dt / 0.15));
          profile.rangeHold = 0.5;
        } else {
          profile.rangeHold = Math.max(0, profile.rangeHold - dt);
          if (activeEnd && profile.rangeHold === 0)
            profile.rangeEnd +=
              (activeEnd - profile.rangeEnd) * (1 - Math.exp(-dt / 1.5));
        }
      }
      for (let i = 0; i < (sampler === "waveform" ? 0 : spec.count); i++) {
        let low = 0,
          high = 0;
        if (sampler === "bars")
          low = i * Math.max(1, Math.floor((n * 0.69) / spec.count));
        if (sampler === "radial")
          low = Math.floor(
            (settings.radialMode === "full"
              ? i / spec.count
              : i < spec.count / 2
                ? i / (spec.count / 2)
                : (spec.count - 1 - i) / (spec.count / 2)) *
              n *
              0.5
          );
        if (sampler === "particles")
          low = Math.floor((i / spec.count) * n * 0.42);
        if (sampler === "kaleidoscope") {
          low = n * 0.006 * (0.5 / 0.006) ** (i / spec.count);
          high = n * 0.006 * (0.5 / 0.006) ** ((i + 1) / spec.count);
        }
        if (sampler === "tunnel") {
          low = n * (0.008 + (i / spec.count) ** 1.55 * 0.46);
          high = n * (0.012 + ((i + 1) / spec.count) ** 1.55 * 0.46);
        }
        if (sampler === "waves" || sampler === "aurora") {
          low = n * ((i / spec.count) ** 2 * 0.72 + 0.005);
          high =
            n *
            (((i + 1) / spec.count) ** 2 * 0.72 +
              (sampler === "waves" ? 0.01 : 0.012));
        }
        if (sampler === "orbit") {
          low = Math.floor(0.002 * 180 ** (i / spec.count) * n);
          high = Math.max(
            low + 1,
            Math.floor(0.002 * 180 ** ((i + 1) / spec.count) * n)
          );
        }
        if (sampler === "prism") {
          low = prismBandEdge(i, n, profile.rangeEnd, spec.count);
          high = prismBandEdge(i + 1, n, profile.rangeEnd, spec.count);
        }
        if (sampler === "cascade") {
          const u =
            i < spec.count / 2
              ? i / (spec.count / 2)
              : (spec.count - 1 - i) / (spec.count / 2);
          const active = clamp((u - 0.12) / 0.7),
            t =
              settings.cascadeFrequencyOrder === "treble-to-bass"
                ? 1 - active
                : active;
          low = Math.round(2 * (Math.floor(n * 0.32) / 2) ** t);
        }
        low = Math.min(n - 1, Math.max(1, low));
        high = Math.min(n, Math.max(low + 1, high));
        // Bin-centered intervals preserve single-bin layouts while sharing the
        // same power-domain aggregation and partial-edge weighting.
        const db = powerBandDb(
          spectrum,
          sampleRate,
          n * 2,
          ((low - 0.5) * nyquist) / n,
          ((high - 0.5) * nyquist) / n,
          powers
        );
        let normalized = normalize(db, referenceDb, spec.domain);
        if (spec.threshold)
          normalized = clamp(
            (normalized - spec.threshold) / (1 - spec.threshold)
          );
        const neutral = controlled(normalized, settings);
        const rate = spec.release;
        profile.neutral[i] = filter(neutral, profile.neutral[i], rate);
        profile.bands[i] =
          settings.bassSensitivityEnabled && settings.bassSensitivityAmount > 0
            ? filter(
                math.applyBassGain(neutral, bassMultiplier),
                profile.bands[i],
                rate
              )
            : profile.neutral[i];
      }
      Object.assign(profile.output, common);
      profile.output.rangeEndHz =
        n > 0 ? ((profile.rangeEnd || n * 0.5) * nyquist) / n : 0;
      return profile.output;
    }
    return { update, forMode, reset };
  }
  return {
    create,
    PROFILES,
    powerBandDb,
    normalize,
    controlled,
    legacyBass,
    prismBandEdge,
    prismActiveEnd,
  };
});
