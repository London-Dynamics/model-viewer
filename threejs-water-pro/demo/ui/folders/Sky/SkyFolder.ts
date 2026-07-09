import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

/**
 * Push the current sun preset values onto Lighting (which drives the
 * directional light, sparkle, sun shafts, SSS) and refresh the optional
 * sun disk overlay parameters on the active sky.
 */
export function syncSunPosition(ui: UIManager): void {
  const water = ui.water;
  const sky = ui.app.sky;
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
 * Push the current ambient preset values onto Lighting. The HemisphereLight
 * picks them up on the next step.
 */
export function syncAmbient(ui: UIManager): void {
  const ambient = ui.params.lighting.ambient;
  const live = ui.water.lighting.ambient;
  live.skyColor.set(ambient.skyColor);
  live.groundColor.set(ambient.groundColor);
  live.intensity = ambient.intensity;
}

/**
 * Creates all sky related controls directly on the parent folder.
 * Called from Controls.ts with the "Sky" folder as parent.
 */
export function createSkyFolder(ui: UIManager, pane: Panel | Folder): void {
  createHDRIControls(ui, pane);
  createAmbientControls(ui, pane);
  createSunControls(ui, pane);
}

function createHDRIControls(ui: UIManager, parent: Panel | Folder): void {
  const folder = parent.addFolder("HDRI", { expanded: true });

  folder.addSelect("File", {
    options: ui.app.hdriOptions.map((opt) => ({
      label: opt.label,
      value: opt.url,
    })),
    binding: () => ui.params.hdriUrl,
    onChange: (v) => {
      void ui.app.setHDRI(v as string);
    },
  });

  folder.addSlider("Brightness", {
    min: 0.1,
    max: 2.0,
    step: 0.1,
    binding: () => ui.app.sky.brightnessUniform.value,
    onChange: (v) => {
      ui.app.sky.brightnessUniform.value = v;
    },
  });

  folder.addSlider("Reflection Roughness", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    binding: () => ui.app.sky.reflectionRoughnessUniform.value,
    onChange: (v) => {
      ui.app.sky.reflectionRoughnessUniform.value = v;
    },
  });

  folder.addSlider("Reflection Distance Blur", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    binding: () => ui.app.sky.reflectionDistanceBlurUniform.value,
    onChange: (v) => {
      ui.app.sky.reflectionDistanceBlurUniform.value = v;
    },
  });

  folder.addSlider("Reflection Blur Distance", {
    min: 100,
    max: 10000,
    step: 100,
    binding: () => ui.app.sky.reflectionBlurDistanceUniform.value,
    onChange: (v) => {
      ui.app.sky.reflectionBlurDistanceUniform.value = v;
    },
  });
}

function createAmbientControls(ui: UIManager, parent: Panel | Folder): void {
  const folder = parent.addFolder("Ambient", { expanded: false });

  folder.addColor("Sky Color", {
    binding: () => ui.params.lighting.ambient.skyColor,
    onChange: (v) => {
      ui.params.lighting.ambient.skyColor = v;
      syncAmbient(ui);
    },
  });

  folder.addColor("Ground Color", {
    binding: () => ui.params.lighting.ambient.groundColor,
    onChange: (v) => {
      ui.params.lighting.ambient.groundColor = v;
      syncAmbient(ui);
    },
  });

  folder.addSlider("Intensity", {
    min: 0,
    max: 2,
    step: 0.01,
    binding: () => ui.params.lighting.ambient.intensity,
    onChange: (v) => {
      ui.params.lighting.ambient.intensity = v;
      syncAmbient(ui);
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

  folder.addSlider("Min Distance", {
    min: 0,
    max: 100,
    step: 1,
    object: ui.water.sparkle,
    key: "minDistance",
  });

  folder.addSlider("Fade Distance", {
    min: 100,
    max: 3000,
    step: 10,
    object: ui.water.sparkle,
    key: "fadeDistance",
  });
}

