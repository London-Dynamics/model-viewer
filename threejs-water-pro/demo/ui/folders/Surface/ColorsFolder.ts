import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createColorsFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Colors", { expanded: false });

  folder.addColor("Water Color", {
    object: ui.water.color,
    key: "waterColor",
  });

  folder.addColor("Absorption Color", {
    object: ui.water.color,
    key: "absorptionColor",
  });

  folder.addColor("Transmission Color", {
    object: ui.water.color,
    key: "transmissionColor",
  });

  return folder;
}
