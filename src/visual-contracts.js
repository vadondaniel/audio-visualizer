// Type-only documentation module: referenced by JSDoc imports, never loaded by
// the renderer. Owners reuse these records; consumers must not retain them as history.

/** @typedef {{readonly length: number, readonly [index: number]: number}} Samples */
/** @typedef {Readonly<{bass: number, mid: number, treble: number}>} Levels Normalized 0..1 visual intensity. */
/** @typedef {'linear'|'exponential'|'logarithmic'} ResponseCurve */
/**
 * @typedef {object} AudioSettings
 * @property {number} sensitivity Base gain, applied once by the pipeline.
 * @property {ResponseCurve} valueHandling
 * @property {boolean} bassSensitivityEnabled
 * @property {number} bassSensitivityAmount Fraction 0..1.
 * @property {boolean} smoothingEnabled
 * @property {'mirrored'|'full'} radialMode
 * @property {'bass-to-treble'|'treble-to-bass'} cascadeFrequencyOrder
 * @property {'line'|'filled'|'prism'} [waveformStyle] Selects spectral sampling for Prism; omitted uses waveform samples.
 */
/**
 * @typedef {object} VisualSettings
 * @property {number} theme Theme index.
 * @property {boolean} colorGradientEnabled
 * @property {number} glowIntensity
 * @property {'bottom'|'center'} barsAlignment
 * @property {'mirrored'|'full'} radialMode
 * @property {'line'|'filled'|'prism'} waveformStyle
 * @property {boolean} kaleidoClipEnabled
 * @property {'dark'|'light'|'theme'} cascadeFillStyle
 * @property {number} particleDensity
 * @property {'flow'|'burst'|'vortex'} particleStyle
 */
/** @typedef {Readonly<AudioSettings & VisualSettings>} Settings */
/** @typedef {Readonly<{rawBass:number, legacyMid:number, legacyTreble:number, centroid:number, flux:number, contrast:number}>} Features Raw byte averages are 0..255; descriptors are normalized. */
/**
 * @typedef {object} CommonSignals
 * @property {Levels} levels Final bass/mid/treble intensities, 0..1.
 * @property {Levels} motion Corresponding intensities before bass modulation.
 * @property {Readonly<{subBass:number, bass:number, mids:number, presence:number, air:number}>} accents
 * @property {Features} features Raw-input descriptors, unaffected by visual gain.
 * @property {Samples} waveform Signed samples, -1..1, with uniform gain.
 * @property {number} bassMultiplier Smoothed gain, 0..2.
 * @property {number} bassDriverLevel Independent normalized bass measurement.
 * @property {number} beatIntensity Bass-modulated pulse.
 * @property {number} referenceDb Spectral reference in dB.
 */
/**
 * @typedef {object} ProfileSignals
 * @property {Samples} bands Finished spectral values, 0..1.
 * @property {Samples} motionBands Corresponding values before bass modulation.
 * @property {number} rangeEndHz Adaptive upper frequency boundary in Hz.
 * @property {Readonly<{aurora:number}>} envelopes Finished visual energy envelope.
 * @property {Readonly<{aurora:number}>} motionEnvelopes Envelope before bass modulation.
 */
/** @typedef {Readonly<CommonSignals & ProfileSignals>} Signals Finished borrowed outputs; valid until the pipeline's next update/reset. */
/** @typedef {Readonly<{dtSec:number}>} Timing Clamped elapsed seconds. */
/**
 * @typedef {object} FrameStorage Host-owned construction/reset storage.
 * @property {number} width Canvas pixels.
 * @property {number} height Canvas pixels.
 * @property {number} timestampMs Renderer timestamp in milliseconds.
 * @property {number} elapsedMs Clamped elapsed milliseconds.
 * @property {number} dtSec Corresponding elapsed seconds.
 * @property {number} audioClockMs Beat/history clock in milliseconds.
 * @property {Readonly<VisualSettings>} settings
 * @property {HTMLImageElement|null} mediaArt Loaded, valid artwork or null.
 * @property {Signals|null} signals Null only during initialization/reset.
 * @property {{pulse:number,justHit:boolean}} beat Original unmodulated pulse and pending event.
 */
/** @typedef {Readonly<Omit<FrameStorage, 'signals'|'beat'> & {signals:Signals, beat:Readonly<{pulse:number, justHit:boolean}>}>} Frame Valid only after preparation. No raw analyser or audio controls are available. */
/**
 * @typedef {object} PipelineInput Raw borrowed acquisition data, read only by the pipeline.
 * @property {Samples} frequencyBytes Smoothed analyser FFT bytes, 0..255.
 * @property {Samples} timeBytes Waveform bytes, centered on 128.
 * @property {number} [sampleRate] Hz; defaults to 48000.
 * @property {Samples} [spectrumDb] Canonical unsmoothed FFT in dB, including -Infinity silence.
 * @property {()=>Samples} [readFloatSpectrum] Lazy reader when spectrumDb is absent.
 * @property {number} [beatPulse] Original beat pulse.
 */
/**
 * @typedef {object} Pipeline
 * @property {(input:PipelineInput,settings:Readonly<AudioSettings>,timing:Timing)=>Readonly<CommonSignals>} update Once per frame, before forMode.
 * @property {(id:string)=>Signals} forMode Cached active-profile output.
 * @property {()=>void} reset Clears histories and source references, retaining reusable buffers.
 */
/** @typedef {Readonly<{name:string, monochrome?:'white'|'black', rainbow?:boolean, cycle?:boolean, colorCycle?:boolean, alwaysGradient?:boolean, spread?:number, hues?:readonly number[], colorStops?:ReadonlyArray<Readonly<{position:number,hue:number}>>}>} Theme */
/** @typedef {Readonly<{hueT:number,sizeMul:number,speedMul:number,decayMul:number}>} ParticleBand */
/**
 * @typedef {object} ModeTuning
 * @property {Readonly<{baseYFrac:number,heightScale:number}>} bars
 * @property {Readonly<{baseRFrac:number,lengthScale:number}>} radial
 * @property {Readonly<{radiusFrac:number,spinPerSec:number}>} orbit
 * @property {Readonly<{radiusFrac:number,minLineWidth:number,lineWidthScale:number,contourAlpha:number,spokeAlpha:number,spokeAlphaGain:number,glowBlur:number,glowBlurGain:number}>} prism
 * @property {Readonly<{maxRFrac:number,coreRFrac:number,spinPerSec:number,spinTreblePerSec:number,spinBeatPerSec:number,flashDecayPerSec:number}>} kaleidoscope
 * @property {Readonly<{cap:number}>} particles
 */
/** @typedef {Readonly<ModeTuning>} VisualTuning */
/** @typedef {Readonly<{VISUAL_TUNING:VisualTuning, THEMES:ReadonlyArray<Theme>, PARTICLE_BANDS:ReadonlyArray<ParticleBand>, KALEIDO_BARS:number, FRAME_MS:number, ENERGY_HISTORY_MS:number}>} ModeConstants */
/** @typedef {(()=>number) & {getState:()=>number, setState:(state:number)=>void}} SeededRandom */
/** @typedef {<T>(target:T, initial:T)=>T} Restore Restores owned simulation storage in place where possible. */
/** @typedef {string|CanvasGradient|CanvasPattern} CanvasColor */
/**
 * @typedef {object} Services
 * @property {ModeConstants} constants
 * @property {Readonly<{currentHue:(offset?:number)=>number, themeCssColor:(hue:number,saturation:number,lightness:number,alpha?:number)=>string}>} palette
 * @property {()=>SeededRandom} createRandom
 * @property {(src:string)=>HTMLImageElement} loadImage
 * @property {Restore} restore
 * @property {(ctx:CanvasRenderingContext2D,color:CanvasColor,blur:number,intensity:number)=>void} applyGlow
 */
/**
 * @typedef {object} Mode
 * @property {(frame:Frame)=>void} update Advances only the active simulation.
 * @property {(ctx:CanvasRenderingContext2D,frame:Frame)=>void} draw Requires update; never consumes events or randomness.
 * @property {()=>void} reset Restores initial state, retaining reusable allocations.
 */
/** @typedef {(services:Services)=>Mode} ModeFactory */
/** @typedef {Services & {consumeBeat?:()=>void}} HostServices Only the controller may consume shared beat state. */
/** @typedef {{update:(id:string,frame:Frame)=>void,draw:(id:string,ctx:CanvasRenderingContext2D,frame:Frame)=>void,render:(id:string,ctx:CanvasRenderingContext2D,frame:Frame)=>void,reset:()=>void}} ModeController */
/** @typedef {Readonly<{sampler:string,count:number,release:number,threshold?:number,domain?:'db'|'amplitude'}>} AudioProfile */
/** @typedef {Readonly<{setting:'waveformStyle',profiles:Readonly<Record<string,AudioProfile>>}>} AudioVariants */
/** @typedef {AudioProfile & Readonly<{variants?:AudioVariants}>} AudioDefinition */
/** @typedef {Readonly<{group:'free'|'focus',defaultPosition:string,autoPlacement:string,overlayCover:boolean}>} MediaProfile */
/** @typedef {Readonly<{id:string,label:string,modulePath:string,audio:AudioDefinition,media:MediaProfile}>} ModeDefinition */
/** @typedef {ModeDefinition & Readonly<{index:number}>} ModeEntry */
/**
 * @typedef {object} RegistryAPI
 * @property {ReadonlyArray<ModeEntry>} entries Canonical order, independent of saved preferences.
 * @property {ReadonlyArray<string>} ids
 * @property {Readonly<Record<string,AudioDefinition>>} audioProfiles Base profiles, including variant metadata.
 * @property {(id:string,settings:Readonly<Pick<AudioSettings,'waveformStyle'>>)=>AudioProfile} resolveAudioProfile Resolves a style to an existing immutable profile; throws for unknown IDs.
 * @property {(id:string)=>ModeEntry|undefined} get
 * @property {(id:string)=>number} indexOf Returns -1 for an unknown ID.
 * @property {()=>Record<string,string>} mediaDefaults Fresh mutable preferences.
 * @property {(id:string,factory:ModeFactory)=>void} registerFactory Rejects unknown/duplicate IDs.
 * @property {()=>Readonly<Record<string,ModeFactory>>} getFactories Requires all factories to be registered.
 * @property {(loadModule:(src:string)=>Promise<void>)=>Promise<void>} loadFactories Sequential, cached loading.
 */
/** @typedef {Readonly<RegistryAPI>} Registry */

module.exports = {};
