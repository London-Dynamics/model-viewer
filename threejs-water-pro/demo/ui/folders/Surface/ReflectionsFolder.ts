import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createReflectionsFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Reflections", { expanded: false });

  const fresnelFolder = folder.addFolder("Fresnel", { expanded: false });

  fresnelFolder.addSlider("IOR", {
    min: 1.0,
    max: 2.0,
    step: 0.01,
    object: ui.water.fresnel,
    key: "iorRatio",
  });

  fresnelFolder.addSlider("Normal Strength", {
    min: 0.0,
    max: 1,
    step: 0.01,
    object: ui.water.fresnel,
    key: "normalStrength",
  });

  fresnelFolder.addSlider("Refraction Strength", {
    min: 0,
    max: 0.5,
    step: 0.01,
    object: ui.water.fresnel,
    key: "refractionStrength",
  });

  fresnelFolder.addSlider("Fade Start (m)", {
    min: 0,
    max: 2000,
    step: 10,
    object: ui.water.fresnel,
    key: "fadeStart",
  });

  fresnelFolder.addSlider("Fade Power", {
    min: 0.1,
    max: 10,
    step: 0.1,
    object: ui.water.fresnel,
    key: "fadePower",
  });

  const ssrFolder = folder.addFolder("Screen-Space Reflections", {
    expanded: false,
  });

  ssrFolder.addCheckbox("Enabled", {
    object: ui.water.ssr,
    key: "enabled",
  });

  ssrFolder.addSlider("Strength", {
    min: 0,
    max: 1,
    step: 0.01,
    object: ui.water.ssr,
    key: "strength",
  });

  ssrFolder.addSlider("Max Distance (m)", {
    min: 10,
    max: 500,
    step: 10,
    object: ui.water.ssr,
    key: "maxDistance",
  });

  ssrFolder.addSlider("Step Count", {
    min: 4,
    max: 64,
    step: 1,
    object: ui.water.ssr,
    key: "stepCount",
  });

  return folder;
}
