// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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
      ui.water.foam.shoreline.loadTexture(ui.params.foam.shoreline.texture);
    },
  });

  shorelineFolder.addSlider("Opacity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.shoreline,
    key: "opacity",
  });

  shorelineFolder.addSlider("Size (m)", {
    min: 1,
    max: 100,
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

  shorelineFolder.addSlider("Range (m)", {
    min: 0.1,
    max: 5,
    step: 0.05,
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
      ui.water.foam.surface.loadTexture(ui.params.foam.surface.texture);
    },
  });

  surfaceFolder.addSlider("Opacity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.surface,
    key: "opacity",
  });

  surfaceFolder.addSlider("Size (m)", {
    min: 1,
    max: 30,
    step: 0.1,
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

  // Wave Crest — persistent foam-energy field, the only wave-crest foam path.
  // Each breaking event injects energy that decays exponentially, producing
  // lingering, streaking whitecaps. Active on quality tiers with wave foam on.
  const waveFolder = folder.addFolder("Wave Crest", { expanded: false });

  waveFolder.addCheckbox("Enabled", {
    object: ui.water.foam.waves,
    key: "enabled",
  });

  waveFolder.addColor("Color", {
    object: ui.water.foam.waves,
    key: "color",
  });

  waveFolder.addSelect("Texture", {
    object: ui.params.foam.waves,
    key: "texture",
    options: FOAM_TEXTURE_OPTIONS,
    onChange: () => {
      ui.water.foam.waves.loadTexture(ui.params.foam.waves.texture);
    },
  });

  waveFolder.addSlider("Opacity", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.water.foam.waves,
    key: "opacity",
  });

  waveFolder.addSlider("Size (m)", {
    min: 1,
    max: 30,
    step: 0.1,
    object: ui.water.foam.waves,
    key: "size",
  });

  waveFolder.addSlider("Wind Stretch", {
    min: 0.0,
    max: 0.8,
    step: 0.01,
    object: ui.water.foam.waves,
    key: "windStretch",
  });

  // Persistence sliders bind straight to the live holder; setters update the
  // shared uniform nodes the foam field reads.
  const persistence = ui.water.foam.waves.persistence;

  waveFolder.addSlider("Crest Strength", {
    min: 0.0,
    max: 2.0,
    step: 0.01,
    object: persistence,
    key: "crestStrength",
  });

  waveFolder.addSlider("Windward Strength", {
    min: 0.0,
    max: 2.0,
    step: 0.01,
    object: persistence,
    key: "windwardStrength",
  });

  waveFolder.addSlider("Decay Time (s)", {
    min: 0.0,
    max: 5.0,
    step: 0.01,
    object: persistence,
    key: "decayTime",
  });

  return folder;
}
