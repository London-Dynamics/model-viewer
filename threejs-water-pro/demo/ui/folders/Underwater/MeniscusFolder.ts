import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createMeniscusFolder(
  ui: UIManager,
  parent: Panel | Folder,
): Folder {
  const folder = parent.addFolder("Meniscus", { expanded: false });

  folder.addSlider("Highlight Sharpness", {
    min: 1.0,
    max: 10.0,
    step: 0.1,
    object: ui.water.waterline,
    key: "highlightSharpness",
  });

  folder.addSlider("Highlight Strength", {
    min: 0.0,
    max: 2.0,
    step: 0.01,
    object: ui.water.waterline,
    key: "highlightStrength",
  });

  folder.addSlider("Normal Strength", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    object: ui.water.waterline,
    key: "normalStrength",
  });

  folder.addSlider("Smoothness", {
    min: 0.0,
    max: 1.0,
    step: 0.01,
    object: ui.water.waterline,
    key: "smoothness",
  });

  folder.addSlider("Thickness", {
    min: 0.0,
    max: 5.0,
    step: 0.01,
    object: ui.water.waterline,
    key: "thickness",
  });

  return folder;
}
