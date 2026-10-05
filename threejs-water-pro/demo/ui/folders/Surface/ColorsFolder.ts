// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";
import {
  JERLOV_WATER_TYPES,
  type JerlovWaterType,
} from "threejs-water-pro";

function getJerlovType(
  color: { algae: number; silt: number; stain: number },
): JerlovWaterType | "" {
  const match = (
    Object.entries(JERLOV_WATER_TYPES) as [
      JerlovWaterType,
      { algae: number; silt: number; stain: number },
    ][]
  ).find(
    ([, values]) =>
      Math.abs(values.algae - color.algae) < 1e-6 &&
      Math.abs(values.silt - color.silt) < 1e-6 &&
      Math.abs(values.stain - color.stain) < 1e-6,
  );
  return match?.[0] ?? "";
}

export function createColorsFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Colors", { expanded: false });

  folder.addSelect("Color Model", {
    object: ui.water.color,
    key: "mode",
    options: [
      { label: "Physical (Jerlov)", value: "physical" },
      { label: "Custom", value: "custom" },
    ],
    onChange: () => folder.refresh(),
  });

  const physicalFolder = folder.addFolder("Physical (Jerlov)", {
    expanded: true,
    disabled: () => ui.water.color.mode !== "physical",
  });

  const jerlovSelect = physicalFolder.addSelect("Jerlov Type", {
    binding: () => getJerlovType(ui.water.color),
    options: [
      { label: "Custom Values", value: "", disabled: true },
      ...(Object.keys(JERLOV_WATER_TYPES) as JerlovWaterType[]).map(
        (type) => ({ label: type, value: type }),
      ),
    ],
    onChange: (value) => {
      ui.water.color.setJerlovType(value as JerlovWaterType);
      folder.refresh();
    },
  });

  physicalFolder.addSlider("Algae", {
    min: 0,
    max: 2,
    step: 0.01,
    object: ui.water.color,
    key: "algae",
    onChange: () => jerlovSelect.refresh(),
  });

  physicalFolder.addSlider("Silt", {
    min: 0,
    max: 3,
    step: 0.01,
    object: ui.water.color,
    key: "silt",
    onChange: () => jerlovSelect.refresh(),
  });

  physicalFolder.addSlider("Stain", {
    min: 0,
    max: 2,
    step: 0.01,
    object: ui.water.color,
    key: "stain",
    onChange: () => jerlovSelect.refresh(),
  });

  const customFolder = folder.addFolder("Custom", {
    expanded: true,
    disabled: () => ui.water.color.mode !== "custom",
  });

  customFolder.addColor("Water Color", {
    object: ui.water.color,
    key: "waterColor",
  });

  customFolder.addColor("Absorption Color", {
    object: ui.water.color,
    key: "absorptionColor",
  });

  customFolder.addColor("Crest Transmission", {
    object: ui.water.color,
    key: "transmissionColor",
  });

  folder.refresh();
  return folder;
}
