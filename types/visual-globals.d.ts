// Browser script namespaces only. Application/capture globals deliberately do
// not participate in the checked mode environment.
declare var AudioMath: typeof import("../src/audio-math");
declare var AudioPipeline: typeof import("../src/audio-pipeline");
declare var ModeRegistry: typeof import("../src/mode-registry");
declare var ModeRuntime: typeof import("../src/mode-runtime");
