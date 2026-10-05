// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createCausticsFolder(
  ui: UIManager,
  parent: Panel | Folder,
): void {
  const syncCaustics = (): void => {
    ui.water.floor.updateCausticsConfig(ui.params.oceanFloor.caustics);
  };

  const folder = parent.addFolder("Caustics", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: ui.params.oceanFloor.caustics,
    key: "enabled",
    onChange: syncCaustics,
  });

  folder.addSlider("Intensity", {
    min: 0.0,
    max: 2.0,
    step: 0.01,
    object: ui.params.oceanFloor.caustics,
    key: "intensity",
    onChange: syncCaustics,
  });

  folder.addSlider("Scale (m)", {
    min: 2.0,
    max: 50.0,
    step: 1.0,
    object: ui.params.oceanFloor.caustics,
    key: "scale",
    onChange: syncCaustics,
  });

  folder.addSlider("Depth Attenuation", {
    min: 0.0,
    max: 2.0,
    step: 0.1,
    object: ui.params.oceanFloor.caustics,
    key: "depthAttenuation",
    onChange: syncCaustics,
  });

  folder.addSlider("Wave Distortion", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    object: ui.params.oceanFloor.caustics,
    key: "waveDistortion",
    onChange: syncCaustics,
  });
}
