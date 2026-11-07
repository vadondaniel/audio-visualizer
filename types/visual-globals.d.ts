// Browser script namespaces only. Application/capture globals deliberately do
// not participate in the checked mode environment.
declare var AudioMath: typeof import("../src/audio-math");
declare var AudioPipeline: typeof import("../src/audio-pipeline");
declare var ModeRegistry: typeof import("../src/mode-registry");
declare var ModeRuntime: typeof import("../src/mode-runtime");
declare var SettingsActions: typeof import("../src/settings-actions");
declare var MiniOverlayMath: typeof import("../src/mini-overlay-math");
declare var OverlayDisplay: typeof import("../src/overlay-display");
declare var SettingsUI: typeof import("../src/settings-ui");
declare var MiniOverlayUI: typeof import("../src/mini-overlay-ui");
declare var TrayControls: typeof import("../src/tray-controls");
declare var rendererReady: Promise<void>;
// Only this composition boundary is visible; legacy UI/capture globals stay out.
declare function createRendererBridge(): import("../src/renderer-entry").Bridge;

declare var SettingsProtocol: typeof import("../src/settings-protocol");
declare var SettingsPanel: typeof import("../src/settings-panel");
declare var SettingsView: typeof import("../src/settings-view");
declare var SettingsClient: typeof import("../src/settings-client");

declare var SettingsMigrations: typeof import("../src/settings-migrations");
