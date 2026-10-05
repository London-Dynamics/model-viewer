// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

/**
 * Push the current sun preset values onto Lighting (which drives the
 * directional light, sparkle, sun shafts, SSS) and refresh the optional
 * sun disk overlay parameters on the active sky.
 */
export function syncSunPosition(ui: UIManager): void {
  const water = ui.water;
  const sky = ui.app.skyManager.sky;
  const params = ui.params.sky.sun;

  water.lighting.sun.update(params);

  sky.applySunOverlay({
    enabled: params.diskEnabled,
    radius: params.diskRadius,
    color: params.diskColor,
    emissiveColor: params.diskEmissiveColor,
    emissiveIntensity: params.diskEmissiveIntensity,
  });
}

/**
 * Creates all sky related controls directly on the parent folder.
 * Called from Controls.ts with the "Sky" folder as parent.
 */
export function createSkyFolder(ui: UIManager, pane: Panel | Folder): void {
  // Scales scene.environment IBL regardless of which sky is active, so it
  // lives outside the HDRI folder below.
  pane.addSlider("Environment Intensity", {
    min: 0,
    max: 3,
    step: 0.01,
    object: ui.water.environment,
    key: "intensity",
  });

  createHDRIControls(ui, pane);
  createSunControls(ui, pane);
}

function createHDRIControls(ui: UIManager, parent: Panel | Folder): void {
  const folder = parent.addFolder("HDRI", { expanded: true });

  folder.addSelect("File", {
    options: ui.app.skyManager.hdriOptions.map((opt) => ({
      label: opt.label,
      value: opt.url,
    })),
    binding: () => ui.params.hdriUrl,
    onChange: (v) => {
      void ui.app.skyManager.setHDRI(v as string);
    },
  });

  folder.addSlider("Brightness", {
    min: 0.1,
    max: 2.0,
    step: 0.1,
    binding: () => ui.app.skyManager.sky.brightness,
    onChange: (v) => {
      ui.app.skyManager.sky.brightness = v;
    },
  });

  folder.addSlider("Reflection Roughness", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    binding: () => ui.app.skyManager.sky.reflectionRoughnessUniform.value,
    onChange: (v) => {
      ui.app.skyManager.sky.reflectionRoughnessUniform.value = v;
    },
  });
}

function createSunControls(ui: UIManager, parent: Panel | Folder): void {
  const folder = parent.addFolder("Sun", { expanded: false });

  folder.addSlider("Azimuth (°)", {
    min: 0,
    max: 360,
    step: 1,
    binding: () => ui.params.sky.sun.azimuth,
    onChange: (v) => {
      ui.params.sky.sun.azimuth = v;
      syncSunPosition(ui);
    },
  });

  folder.addSlider("Elevation (°)", {
    min: 0,
    max: 90,
    step: 1,
    binding: () => ui.params.sky.sun.elevation,
    onChange: (v) => {
      ui.params.sky.sun.elevation = v;
      syncSunPosition(ui);
    },
  });

  folder.addSlider("Intensity", {
    min: 0.0,
    max: 5.0,
    step: 0.1,
    binding: () => ui.params.sky.sun.intensity,
    onChange: (v) => {
      ui.params.sky.sun.intensity = v;
      syncSunPosition(ui);
    },
  });

  folder.addColor("Sunlight Color", {
    binding: () => ui.params.sky.sun.diskColor,
    onChange: (v) => {
      ui.params.sky.sun.diskColor = v;
      syncSunPosition(ui);
    },
  });

  createSunOverlayControls(ui, folder);
  createSparkleControls(ui, folder);
}

function createSunOverlayControls(ui: UIManager, parent: Folder): void {
  const folder = parent.addFolder("Disk Overlay", { expanded: false });

  folder.addCheckbox("Enabled", {
    binding: () => ui.params.sky.sun.diskEnabled,
    onChange: (v) => {
      ui.params.sky.sun.diskEnabled = v;
      syncSunPosition(ui);
    },
  });

  folder.addSlider("Radius", {
    min: 0.001,
    max: 0.05,
    step: 0.001,
    binding: () => ui.params.sky.sun.diskRadius,
    onChange: (v) => {
      ui.params.sky.sun.diskRadius = v;
      syncSunPosition(ui);
    },
  });

  folder.addColor("Emissive Color", {
    binding: () => ui.params.sky.sun.diskEmissiveColor,
    onChange: (v) => {
      ui.params.sky.sun.diskEmissiveColor = v;
      syncSunPosition(ui);
    },
  });

  folder.addSlider("Emissive Intensity", {
    min: 0,
    max: 20,
    step: 0.1,
    binding: () => ui.params.sky.sun.diskEmissiveIntensity,
    onChange: (v) => {
      ui.params.sky.sun.diskEmissiveIntensity = v;
      syncSunPosition(ui);
    },
  });
}

function createSparkleControls(ui: UIManager, parent: Folder): void {
  const folder = parent.addFolder("Sparkle", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: ui.water.sparkle,
    key: "enabled",
  });

  folder.addSlider("Intensity", {
    min: 0.0,
    max: 5.0,
    step: 0.1,
    object: ui.water.sparkle,
    key: "intensity",
  });

  folder.addSlider("Tightness", {
    min: 64,
    max: 2048,
    step: 16,
    object: ui.water.sparkle,
    key: "power",
  });

  folder.addSlider("Min Distance (m)", {
    min: 0,
    max: 100,
    step: 1,
    object: ui.water.sparkle,
    key: "minDistance",
  });

  folder.addSlider("Fade Distance (m)", {
    min: 20,
    max: 500,
    step: 10,
    object: ui.water.sparkle,
    key: "fadeDistance",
  });
}
