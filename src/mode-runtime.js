// Shared lifecycle utilities. Modes receive dependencies; this module has no DOM
// or audio-device dependencies and is also used directly by Node tests.
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRuntime = api;
})(globalThis, function () {
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
  function restore(target, initial) {
    if (ArrayBuffer.isView(initial)) {
      if (target?.length === initial.length) {
        target.set(initial);
        return target;
      }
      return initial.slice();
    }
    if (Array.isArray(initial)) {
      if (!Array.isArray(target)) target = [];
      target.length = initial.length;
      for (let i = 0; i < initial.length; i++)
        target[i] = restore(target[i], initial[i]);
      return target;
    }
    if (initial && typeof initial === "object") {
      target ||= {};
      for (const key of Object.keys(target))
        if (!(key in initial)) delete target[key];
      for (const key of Object.keys(initial))
        target[key] = restore(target[key], initial[key]);
      return target;
    }
    // Spectrum-history buffers start null but can be retained after allocation.
    if (initial === null && ArrayBuffer.isView(target)) {
      target.fill(0);
      return target;
    }
    return initial;
  }

  function createFloatSpectrumReader() {
    let spectrum = new Float32Array(0),
      cached = false,
      analyser,
      bytes;
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

  function createController(factories, services) {
    const modes = Object.fromEntries(
      Object.entries(factories).map(([id, factory]) => [id, factory(services)])
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
  return { restore, createRandom, createFloatSpectrumReader, createController };
});
