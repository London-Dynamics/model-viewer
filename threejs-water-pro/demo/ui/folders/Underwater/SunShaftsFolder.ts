// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createSunShaftsFolder(
  ui: UIManager,
  parent: Panel | Folder,
): Folder {
  const folder = parent.addFolder("Sun Shafts", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: ui.water.sunShafts,
    key: "enabled",
  });

  folder.addSlider("Fade In", {
    min: 0,
    max: 1,
    step: 0.05,
    object: ui.water.sunShafts,
    key: "fadeIn",
  });

  folder.addSlider("Falloff", {
    min: 0.5,
    max: 3,
    step: 0.1,
    object: ui.water.sunShafts,
    key: "falloff",
  });

  folder.addSlider("Intensity", {
    min: 0,
    max: 1,
    step: 0.05,
    object: ui.water.sunShafts,
    key: "intensity",
  });

  folder.addSlider("Softness", {
    min: 0,
    max: 1,
    step: 0.05,
    object: ui.water.sunShafts,
    key: "softness",
  });

  return folder;
}
