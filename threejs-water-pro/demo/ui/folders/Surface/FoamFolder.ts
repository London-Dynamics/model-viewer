import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

const FOAM_TEXTURE_OPTIONS = [
  { label: "Foam 1", value: "foam1" },
  { label: "Foam 2", value: "foam2" },
  { label: "Foam 3", value: "foam3" },
  { label: "Foam 4", value: "foam4" },
];

export function createFoamFolder(ui: UIManager, pane: Panel | Folder): Folder {
  const folder = pane.addFolder("Foam", { expanded: false });

  // Shoreline
  const shorelineFolder = folder.addFolder("Shoreline", { expanded: false });

  shorelineFolder.addCheckbox("Enabled", {
    object: ui.water.foam.shoreline,
    key: "enabled",
  });

  shorelineFolder.addColor("Color", {
    object: ui.water.foam.shoreline,
    key: "color",
  });

  shorelineFolder.addSelect("Texture", {
    object: ui.params.foam.shoreline,
    key: "texture",
    options: FOAM_TEXTURE_OPTIONS,
    onChange: () => {
      ui.water.foam.shoreline.update(ui.params.foam.shoreline);
    },
  });

  shorelineFolder.addSlider("Opacity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.shoreline,
    key: "opacity",
  });

  shorelineFolder.addSlider("Size", {
    min: 1,
    max: 500,
    step: 1,
    object: ui.water.foam.shoreline,
    key: "size",
  });

  shorelineFolder.addSlider("Coverage", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    object: ui.water.foam.shoreline,
    key: "coverage",
  });

  shorelineFolder.addSlider("Range", {
    min: 1,
    max: 200,
    step: 1,
    object: ui.water.foam.shoreline,
    key: "range",
  });

  // Surface
  const surfaceFolder = folder.addFolder("Surface", { expanded: false });

  surfaceFolder.addCheckbox("Enabled", {
    object: ui.water.foam.surface,
    key: "enabled",
  });

  surfaceFolder.addColor("Color", {
    object: ui.water.foam.surface,
    key: "color",
  });

  surfaceFolder.addSelect("Texture", {
    object: ui.params.foam.surface,
    key: "texture",
    options: FOAM_TEXTURE_OPTIONS,
    onChange: () => {
      ui.water.foam.surface.update(ui.params.foam.surface);
    },
  });

  surfaceFolder.addSlider("Opacity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.surface,
    key: "opacity",
  });

  surfaceFolder.addSlider("Size", {
    min: 1,
    max: 500,
    step: 1,
    object: ui.water.foam.surface,
    key: "size",
  });

  surfaceFolder.addSlider("Coverage", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    object: ui.water.foam.surface,
    key: "coverage",
  });

  // Wave Crest — two backend-specific folders; the inactive one is
  // disabled so users can't twiddle knobs that do nothing on their GPU.
  const webglLabel = "Wave Crest (WebGL)";
  const webgpuLabel = "Wave Crest (WebGPU)";
  const webglFolder = folder.addFolder(webglLabel, { expanded: false });
  const webgpuFolder = folder.addFolder(webgpuLabel, { expanded: false });

  if (ui.isWebGL) {
    webgpuFolder.disabled = true;
  } else {
    webglFolder.disabled = true;
  }

  // ---- Wave Crest (WebGL): stateless Jacobian + leading-edge path ----
  webglFolder.addCheckbox("Enabled", {
    object: ui.water.foam.waves,
    key: "enabled",
  });

  webglFolder.addColor("Color", {
    object: ui.water.foam.waves,
    key: "color",
  });

  webglFolder.addSelect("Texture", {
    object: ui.params.foam.waves,
    key: "texture",
    options: FOAM_TEXTURE_OPTIONS,
    onChange: () => {
      ui.water.foam.waves.update(ui.params.foam.waves);
    },
  });

  webglFolder.addSlider("Opacity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.waves,
    key: "opacity",
  });

  webglFolder.addSlider("Size", {
    min: 1,
    max: 500,
    step: 1,
    object: ui.water.foam.waves,
    key: "size",
  });

  webglFolder.addSlider("Coverage", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    object: ui.water.foam.waves,
    key: "coverage",
  });

  webglFolder.addSlider("Peak Intensity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.waves,
    key: "peakIntensity",
  });

  webglFolder.addSlider("Crest Coverage", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.waves,
    key: "crestCoverage",
  });

  webglFolder.addSlider("Wind Stretch", {
    min: 0.0,
    max: 0.8,
    step: 0.01,
    object: ui.water.foam.waves,
    key: "windStretch",
  });

  const webglAdvanced = webglFolder.addFolder("Advanced", { expanded: false });

  webglAdvanced.addSlider("Wave Weight", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.waves,
    key: "waveWeight",
  });

  webglAdvanced.addSlider("Ripple Weight", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.waves,
    key: "rippleWeight",
  });

  // ---- Wave Crest (WebGPU): persistent energy buffer ----
  webgpuFolder.addCheckbox("Enabled", {
    object: ui.water.foam.waves,
    key: "enabled",
  });

  webgpuFolder.addColor("Color", {
    object: ui.water.foam.waves,
    key: "color",
  });

  webgpuFolder.addSelect("Texture", {
    object: ui.params.foam.waves,
    key: "texture",
    options: FOAM_TEXTURE_OPTIONS,
    onChange: () => {
      ui.water.foam.waves.update(ui.params.foam.waves);
    },
  });

  webgpuFolder.addSlider("Opacity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.waves,
    key: "opacity",
  });

  webgpuFolder.addSlider("Size", {
    min: 1,
    max: 500,
    step: 1,
    object: ui.water.foam.waves,
    key: "size",
  });

  webgpuFolder.addSlider("Wind Stretch", {
    min: 0.0,
    max: 0.8,
    step: 0.01,
    object: ui.water.foam.waves,
    key: "windStretch",
  });

  const persistence = ui.params.foam.waves.persistence;
  const syncPersistence = () => {
    ui.water.foamAccumulation?.update(persistence);
  };

  webgpuFolder.addSlider("Crest Strength", {
    min: 0.0,
    max: 2.0,
    step: 0.01,
    object: persistence,
    key: "crestStrength",
    onChange: syncPersistence,
  });

  webgpuFolder.addSlider("Windward Strength", {
    min: 0.0,
    max: 2.0,
    step: 0.01,
    object: persistence,
    key: "windwardStrength",
    onChange: syncPersistence,
  });

  webgpuFolder.addSlider("Decay Time", {
    min: 0.0,
    max: 5.0,
    step: 0.01,
    object: persistence,
    key: "decayTime",
    onChange: syncPersistence,
  });

  return folder;
}
