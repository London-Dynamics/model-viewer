import * as THREE from "three/webgpu";
import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";
import type { AntialiasingMode } from "../../../WaterApp";

/** Tone-mapping operators offered in the UI, keyed by a stable string value. */
const TONE_MAPPING_BY_KEY: Record<string, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  neutral: THREE.NeutralToneMapping,
};

const TONE_MAPPING_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Linear", value: "linear" },
  { label: "Reinhard", value: "reinhard" },
  { label: "Cineon", value: "cineon" },
  { label: "ACES Filmic", value: "aces" },
  { label: "AgX", value: "agx" },
  { label: "Neutral", value: "neutral" },
];

/** Reverse-lookup the string key for a tone-mapping operator (for binding). */
function toneMappingKey(value: THREE.ToneMapping): string {
  return (
    Object.entries(TONE_MAPPING_BY_KEY).find(([, v]) => v === value)?.[0] ??
    "reinhard"
  );
}

export function syncPostProcessingUniforms(ui: UIManager): void {
  const u = ui.postProcessingUniforms;
  const pp = ui.params.postProcessing;
  u.bloom.strength.value = pp.bloom.enabled ? pp.bloom.strength : 0;
  u.bloom.radius.value = pp.bloom.radius;
  u.bloom.threshold.value = pp.bloom.threshold;
  u.filmGrain.intensity.value = pp.filmGrain.enabled ? pp.filmGrain.intensity : 0;
  u.vignette.intensity.value = pp.vignette.enabled ? pp.vignette.intensity : 0;
  u.vignette.smoothness.value = pp.vignette.smoothness;
}

export function createPostProcessingFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Post-Processing", { expanded: false });

  folder.addCheckbox("Enabled", {
    binding: () => ui.params.postProcessing.enabled,
    onChange: (v) => {
      ui.params.postProcessing.enabled = v;
    },
  });

  folder.addSelect("Anti-Aliasing", {
    options: [
      { label: "SMAA", value: "smaa" },
      { label: "FXAA", value: "fxaa" },
      { label: "None", value: "none" },
    ],
    binding: () => ui.params.antialiasing,
    onChange: (v) => {
      ui.params.antialiasing = v as AntialiasingMode;
      ui.app.rebuildPostProcessing();
    },
  });

  const toneFolder = folder.addFolder("Tone Mapping", { expanded: false });

  toneFolder.addSelect("Type", {
    options: TONE_MAPPING_OPTIONS,
    binding: () => toneMappingKey(ui.app.toneMapping),
    onChange: (v) => {
      ui.app.toneMapping = TONE_MAPPING_BY_KEY[v] ?? THREE.ACESFilmicToneMapping;
      // The operator is baked into the output node — rebuild to apply it.
      ui.app.rebuildPostProcessing();
    },
  });

  toneFolder.addSlider("Brightness", {
    min: 0,
    max: 3,
    step: 0.05,
    binding: () => ui.app.toneMappingExposure,
    onChange: (v) => {
      ui.app.toneMappingExposure = v;
    },
  });

  const bloomFolder = folder.addFolder("Bloom", { expanded: false });

  bloomFolder.addCheckbox("Enabled", {
    binding: () => ui.params.postProcessing.bloom.enabled,
    onChange: (v) => {
      ui.params.postProcessing.bloom.enabled = v;
      syncPostProcessingUniforms(ui);
    },
  });

  bloomFolder.addSlider("Strength", {
    min: 0,
    max: 3,
    step: 0.1,
    binding: () => ui.params.postProcessing.bloom.strength,
    onChange: (v) => {
      ui.params.postProcessing.bloom.strength = v;
      syncPostProcessingUniforms(ui);
    },
  });

  bloomFolder.addSlider("Radius", {
    min: 0,
    max: 1,
    step: 0.05,
    binding: () => ui.params.postProcessing.bloom.radius,
    onChange: (v) => {
      ui.params.postProcessing.bloom.radius = v;
      syncPostProcessingUniforms(ui);
    },
  });

  bloomFolder.addSlider("Threshold", {
    min: 0,
    max: 1,
    step: 0.05,
    binding: () => ui.params.postProcessing.bloom.threshold,
    onChange: (v) => {
      ui.params.postProcessing.bloom.threshold = v;
      syncPostProcessingUniforms(ui);
    },
  });

  const filmFolder = folder.addFolder("Film Grain", { expanded: false });

  filmFolder.addCheckbox("Enabled", {
    binding: () => ui.params.postProcessing.filmGrain.enabled,
    onChange: (v) => {
      ui.params.postProcessing.filmGrain.enabled = v;
      syncPostProcessingUniforms(ui);
    },
  });

  filmFolder.addSlider("Intensity", {
    min: 0,
    max: 0.5,
    step: 0.01,
    binding: () => ui.params.postProcessing.filmGrain.intensity,
    onChange: (v) => {
      ui.params.postProcessing.filmGrain.intensity = v;
      syncPostProcessingUniforms(ui);
    },
  });

  const vignetteFolder = folder.addFolder("Vignette", { expanded: false });

  vignetteFolder.addCheckbox("Enabled", {
    binding: () => ui.params.postProcessing.vignette.enabled,
    onChange: (v) => {
      ui.params.postProcessing.vignette.enabled = v;
      syncPostProcessingUniforms(ui);
    },
  });

  vignetteFolder.addSlider("Intensity", {
    min: 0,
    max: 1,
    step: 0.05,
    binding: () => ui.params.postProcessing.vignette.intensity,
    onChange: (v) => {
      ui.params.postProcessing.vignette.intensity = v;
      syncPostProcessingUniforms(ui);
    },
  });

  vignetteFolder.addSlider("Smoothness", {
    min: 0,
    max: 1,
    step: 0.05,
    binding: () => ui.params.postProcessing.vignette.smoothness,
    onChange: (v) => {
      ui.params.postProcessing.vignette.smoothness = v;
      syncPostProcessingUniforms(ui);
    },
  });

  return folder;
}
