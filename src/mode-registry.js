// Immutable mode metadata and explicit factory registration, shared by browser
// startup, the audio pipeline, settings, benchmarks, and Node tests.
/** @template T
 * @param {typeof globalThis} root
 * @param {()=>T} build */
(function (root, build) {
  const api = build();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModeRegistry = api;
})(globalThis, function () {
  /** @type {ReadonlyArray<import('./visual-contracts').ModeDefinition>} */
  const DEFINITIONS = [
    {
      id: "bars",
      label: "Bars",
      modulePath: "visuals/bars.js",
      audio: { sampler: "bars", count: 96, release: 6.3 },
      media: {
        group: "free",
        defaultPosition: "top",
        autoPlacement: "upper-center",
        overlayCover: true,
      },
    },
    {
      id: "radial",
      label: "Radial",
      modulePath: "visuals/radial.js",
      audio: { sampler: "radial", count: 180, release: 9.75 },
      media: {
        group: "focus",
        defaultPosition: "below",
        autoPlacement: "focus",
        overlayCover: true,
      },
    },
    {
      id: "waveform",
      label: "Waveform",
      modulePath: "visuals/waveform.js",
      audio: { sampler: "waveform", count: 0, release: 10 },
      media: {
        group: "free",
        defaultPosition: "auto",
        autoPlacement: "left-below-center",
        overlayCover: true,
      },
    },
    {
      id: "particles",
      label: "Particles",
      modulePath: "visuals/particles.js",
      audio: { sampler: "particles", count: 110, release: 10 },
      media: {
        group: "free",
        defaultPosition: "auto",
        autoPlacement: "left-mid",
        overlayCover: true,
      },
    },
    {
      id: "kaleidoscope",
      label: "Kaleidoscope",
      modulePath: "visuals/kaleidoscope.js",
      audio: { sampler: "kaleidoscope", count: 28, release: 14.9 },
      media: {
        group: "free",
        defaultPosition: "auto",
        autoPlacement: "high-center",
        overlayCover: true,
      },
    },
    {
      id: "tunnel",
      label: "Tunnel",
      modulePath: "visuals/tunnel.js",
      audio: { sampler: "tunnel", count: 12, release: 8.5 },
      media: {
        group: "free",
        defaultPosition: "auto",
        autoPlacement: "right-upper",
        overlayCover: true,
      },
    },
    {
      id: "waves",
      label: "Waves",
      modulePath: "visuals/waves.js",
      audio: { sampler: "waves", count: 16, release: 6.5 },
      media: {
        group: "free",
        defaultPosition: "auto",
        autoPlacement: "left-bottom",
        overlayCover: true,
      },
    },
    {
      id: "aurora",
      label: "Aurora",
      modulePath: "visuals/aurora.js",
      audio: { sampler: "aurora", count: 24, release: 6.5 },
      media: {
        group: "free",
        defaultPosition: "auto",
        autoPlacement: "right-bottom",
        overlayCover: true,
      },
    },
    {
      id: "cascade",
      label: "Cascade",
      modulePath: "visuals/cascade.js",
      audio: { sampler: "cascade", count: 128, release: 9.6, threshold: 0.4 },
      media: {
        group: "focus",
        defaultPosition: "below",
        autoPlacement: "focus",
        overlayCover: false,
      },
    },
    {
      id: "orbit",
      label: "Orbit",
      modulePath: "visuals/orbit.js",
      audio: { sampler: "orbit", count: 41, release: 8, domain: "amplitude" },
      media: {
        group: "free",
        defaultPosition: "bottom-left",
        autoPlacement: "default",
        overlayCover: true,
      },
    },
    {
      id: "prism",
      label: "Prism",
      modulePath: "visuals/prism.js",
      audio: { sampler: "prism", count: 96, release: 10 },
      media: {
        group: "free",
        defaultPosition: "bottom-left",
        autoPlacement: "default",
        overlayCover: true,
      },
    },
  ];
  /** @param {ReadonlyArray<import('./visual-contracts').ModeDefinition>} definitions
   * @returns {import('./visual-contracts').Registry} */
  function createRegistry(definitions) {
    /** @type {Map<string, import('./visual-contracts').ModeEntry>} */
    const byId = new Map();
    /** @type {Map<string, import('./visual-contracts').ModeFactory>} */
    const factories = new Map();
    const entries = Object.freeze(
      definitions.map((definition, index) => {
        if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || byId.has(definition.id))
          throw Error(`Invalid or duplicate mode ID: ${definition.id}`);
        if (
          !definition.label ||
          !definition.modulePath ||
          !definition.audio ||
          !definition.media
        )
          throw Error(`Incomplete mode definition: ${definition.id}`);
        const { audio, media } = definition;
        if (
          typeof audio.sampler !== "string" ||
          !Number.isInteger(audio.count) ||
          audio.count < 0 ||
          !(audio.release > 0)
        )
          throw Error(`Invalid audio profile: ${definition.id}`);
        if (
          !["free", "focus"].includes(media.group) ||
          typeof media.autoPlacement !== "string" ||
          typeof media.overlayCover !== "boolean"
        )
          throw Error(`Invalid media profile: ${definition.id}`);
        const entry = Object.freeze({
          ...definition,
          index,
          audio: Object.freeze({ ...definition.audio }),
          media: Object.freeze({ ...definition.media }),
        });
        byId.set(entry.id, entry);
        return entry;
      })
    );
    const ids = Object.freeze(entries.map((entry) => entry.id));
    const audioProfiles = Object.freeze(
      Object.fromEntries(entries.map((entry) => [entry.id, entry.audio]))
    );
    /** @type {Promise<void>|null} */
    let loading = null;
    /** @param {string} id
     * @param {import('./visual-contracts').ModeFactory} factory */
    function registerFactory(id, factory) {
      if (!byId.has(id)) throw Error(`Unknown visual mode: ${id}`);
      if (factories.has(id)) throw Error(`Duplicate mode factory: ${id}`);
      if (typeof factory !== "function")
        throw Error(`Invalid mode factory: ${id}`);
      factories.set(id, (services) => {
        const mode = factory(services);
        if (
          !mode ||
          ["update", "draw", "reset"].some(
            (method) => typeof mode[method] !== "function"
          )
        )
          throw Error(`Invalid lifecycle for mode: ${id}`);
        return mode;
      });
    }
    /** @returns {Readonly<Record<string, import('./visual-contracts').ModeFactory>>} */
    function getFactories() {
      return Object.freeze(
        Object.fromEntries(
          entries.map((entry) => {
            const factory = factories.get(entry.id);
            if (!factory) throw Error(`Missing mode factory: ${entry.id}`);
            return [entry.id, factory];
          })
        )
      );
    }
    /** @param {(src:string)=>Promise<void>} loadModule */
    function loadFactories(loadModule) {
      if (!loading)
        loading = (async () => {
          for (const entry of entries) {
            await loadModule(entry.modulePath);
            if (!factories.has(entry.id))
              throw Error(`Module did not register mode: ${entry.id}`);
          }
          getFactories();
        })();
      return loading;
    }
    return Object.freeze({
      entries,
      ids,
      audioProfiles,
      get: (id) => byId.get(id),
      indexOf: (id) => byId.get(id)?.index ?? -1,
      mediaDefaults: () =>
        Object.fromEntries(
          entries.map((entry) => [entry.id, entry.media.defaultPosition])
        ),
      registerFactory,
      getFactories,
      loadFactories,
    });
  }
  return Object.freeze({ ...createRegistry(DEFINITIONS), createRegistry });
});
