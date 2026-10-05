// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createSeaFloorFolder(
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

  const folder = parent.addFolder("Sea Floor", { expanded: false });

  folder.addSlider("Blend Softness", {
    min: 0.05,
    max: 1.0,
    step: 0.05,
    object: ui.params.oceanFloor,
    key: "blendSoftness",
    onChange: syncFloorParams,
  });

  folder.addSlider("Blend Threshold", {
    min: 0.0,
    max: 1.0,
    step: 0.05,
    object: ui.params.oceanFloor,
    key: "blendThreshold",
    onChange: syncFloorParams,
  });

  folder.addSlider("Lacunarity", {
    min: 1.0,
    max: 4.0,
    step: 0.1,
    object: ui.params.oceanFloor,
    key: "lacunarity",
    onChange: syncFloorParams,
  });

  folder.addSelect("Mesh Resolution", {
    object: ui.params.oceanFloor,
    key: "meshResolution",
    options: [
      { label: "16", value: 16 },
      { label: "32", value: 32 },
      { label: "64", value: 64 },
      { label: "128", value: 128 },
    ],
    onChange: async () => {
      await ui.water.recreateOceanFloor(ui.params.oceanFloor);
    },
  });

  folder.addSlider("Persistence", {
    min: 0.1,
    max: 1.0,
    step: 0.05,
    object: ui.params.oceanFloor,
    key: "persistence",
    onChange: syncFloorParams,
  });

  folder.addSlider("Terrain Height (m)", {
    min: 0.0,
    max: 5.0,
    step: 0.5,
    object: ui.params.oceanFloor,
    key: "displacementStrength",
    onChange: syncFloorParams,
  });

  folder.addSlider("Terrain Scale (m)", {
    min: 5,
    max: 100,
    step: 10,
    object: ui.params.oceanFloor,
    key: "displacementScale",
    onChange: syncFloorParams,
  });

  folder.addSlider("Texture Displacement (m)", {
    min: 0.0,
    max: 2.0,
    step: 0.05,
    object: ui.params.oceanFloor,
    key: "textureDisplacementStrength",
    onChange: syncFloorParams,
  });
}
