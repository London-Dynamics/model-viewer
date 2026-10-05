// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createTerrainFolder(
  ui: UIManager,
  parent: Panel | Folder,
): void {
  const syncFloorParams = () => {
    const floor = ui.water.floor;
    const params = ui.params.oceanFloor;
    floor.updateDisplacementConfig({
      blendSoftness: params.blendSoftness,
      blendThreshold: params.blendThreshold,
      displacementScale: params.displacementScale,
      displacementStrength: params.displacementStrength,
      lacunarity: params.lacunarity,
      normalScale: params.normalScale,
      persistence: params.persistence,
      textureDisplacementStrength: params.textureDisplacementStrength,
    });
  };

  const folder = parent.addFolder("Terrain", { expanded: false });

  folder.addSlider("Depth (m)", {
    min: 2,
    max: 100,
    step: 1,
    object: ui.params.oceanFloor,
    key: "depth",
    onChange: () => {
      ui.water.color.waterDepth = ui.params.oceanFloor.depth;
      ui.water.floor.setDepth(ui.params.oceanFloor.depth);
      ui.app.scenery.setFloorDepth(ui.params.oceanFloor.depth);
      syncFloorParams();
    },
  });

  folder.addCheckbox("Enabled", {
    object: ui.params.oceanFloor,
    key: "enabled",
    onChange: () => {
      ui.water.floor.setVisible(ui.params.oceanFloor.enabled);
      ui.params.caustics.enabled = ui.params.oceanFloor.enabled;
    },
  });
}
