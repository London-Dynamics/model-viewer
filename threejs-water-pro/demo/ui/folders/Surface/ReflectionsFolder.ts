// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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

  fresnelFolder.addSlider("Refraction Strength", {
    min: 0,
    max: 0.5,
    step: 0.01,
    object: ui.water.fresnel,
    key: "refractionStrength",
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
