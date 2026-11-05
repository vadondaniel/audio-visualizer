// Shared lifecycle utilities. Modes receive dependencies; this module has no DOM
// or audio-device dependencies and is also used directly by Node tests.
/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRuntime = api;
})(globalThis, function () {
  /** @param {CanvasRenderingContext2D} ctx
   * @param {import('./visual-contracts').CanvasColor} color
   * @param {number} blur
   * @param {number} intensity */
  function applyGlow(ctx, color, blur, intensity) {
    ctx.shadowBlur = blur * intensity;
    // Canvas ignores non-CSS shadow colors (e.g. gradient stroke styles).
    // Preserve that existing behavior; this assertion performs no conversion.
    ctx.shadowColor =
      ctx.shadowBlur > 0 ? /** @type {string} */ (color) : "transparent";
  }
  /** @param {number} seed
   * @returns {import('./visual-contracts').SeededRandom} */
  function createRandom(seed) {
    let state = seed >>> 0 || 1;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
    random.getState = () => state;
    random.setState = (value) => {
      state = value;
    };
    return random;
  }
  /** @template T
   * @overload
   * @param {T} target
   * @param {T} initial
   * @returns {T} */
  /** @param {unknown} target
   * @param {unknown} initial
   * @returns {unknown} */
  function restore(target, initial) {
    if (ArrayBuffer.isView(initial)) {
      const buffer = /** @type {Uint8Array|Float32Array|Float64Array} */ (
        initial
      );
      const retained = /** @type {typeof buffer|null} */ (target);
      if (retained?.length === buffer.length) {
        retained.set(buffer);
        return target;
      }
      return buffer.slice();
    }
    if (Array.isArray(initial)) {
      if (!Array.isArray(target)) target = [];
      const storage = /** @type {unknown[]} */ (target);
      storage.length = initial.length;
      for (let i = 0; i < initial.length; i++)
        storage[i] = restore(storage[i], initial[i]);
      return target;
    }
    if (initial && typeof initial === "object") {
      target ||= {};
      const storage = /** @type {Record<string,unknown>} */ (target);
      const source = /** @type {Record<string,unknown>} */ (initial);
      for (const key of Object.keys(storage))
        if (!(key in initial)) delete storage[key];
      for (const key of Object.keys(initial))
        storage[key] = restore(storage[key], source[key]);
      return target;
    }
    // Spectrum-history buffers start null but can be retained after allocation.
    if (initial === null && ArrayBuffer.isView(target)) {
      /** @type {Uint8Array|Float32Array|Float64Array} */ (target).fill(0);
      return target;
    }
    return initial;
  }

  /** @returns {{beginFrame:(source:Partial<Pick<AnalyserNode,'getFloatFrequencyData'>>|null,frequencyBytes:import('./visual-contracts').Samples|null)=>void,read:()=>Float32Array,reset:()=>void}} */
  function createFloatSpectrumReader() {
    let spectrum = new Float32Array(0),
      cached = false;
    /** @type {Partial<Pick<AnalyserNode,'getFloatFrequencyData'>>|null} */
    let analyser = null;
    /** @type {import('./visual-contracts').Samples|null} */
    let bytes = null;
    return {
      beginFrame(source, frequencyBytes) {
        analyser = source;
        bytes = frequencyBytes;
        cached = false;
      },
      read() {
        if (!bytes) return spectrum;
        if (!cached) {
          if (spectrum.length !== bytes.length)
            spectrum = new Float32Array(bytes.length);
          if (analyser?.getFloatFrequencyData)
            analyser.getFloatFrequencyData(spectrum);
          else
            for (let i = 0; i < bytes.length; i++)
              spectrum[i] = -100 + (bytes[i] * 70) / 255;
          cached = true;
        }
        return spectrum;
      },
      reset() {
        analyser = null;
        bytes = null;
        cached = false;
        spectrum.fill(-Infinity);
      },
    };
  }

  /** @param {Readonly<Record<string,import('./visual-contracts').ModeFactory>>} factories
   * @param {import('./visual-contracts').HostServices} services
   * @returns {import('./visual-contracts').ModeController} */
  function createController(factories, services) {
    /** @type {Record<string,import('./visual-contracts').Mode>} */
    const modes = Object.fromEntries(
      Object.entries(factories).map(
        /** @returns {[string,import('./visual-contracts').Mode]} */ ([
          id,
          factory,
        ]) => [id, factory(services)]
      )
    );
    return {
      render(id, ctx, frame) {
        const mode = modes[id];
        if (!mode) throw new Error(`Unknown visual mode: ${id}`);
        mode.update(frame);
        if (id === "particles" && frame.beat.justHit) services.consumeBeat?.();
        ctx.save();
        try {
          mode.draw(ctx, frame);
        } finally {
          ctx.restore();
        }
      },
      reset() {
        for (const mode of Object.values(modes)) mode.reset();
      },
    };
  }
  return {
    applyGlow,
    restore,
    createRandom,
    createFloatSpectrumReader,
    createController,
  };
});
