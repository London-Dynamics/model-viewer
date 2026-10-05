// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createSSSFolder(ui: UIManager, pane: Panel | Folder): Folder {
  const folder = pane.addFolder("Subsurface Scattering", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: ui.water.sss,
    key: "enabled",
  });

  folder.addSlider("Intensity", {
    min: 0.0,
    max: 2.0,
    step: 0.01,
    object: ui.water.sss,
    key: "intensity",
  });

  folder.addSlider("Power", {
    min: 0.05,
    max: 3.0,
    step: 0.01,
    object: ui.water.sss,
    key: "power",
  });

  return folder;
}
