import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createClipPlaneFolder(
  ui: UIManager,
  parent: Panel | Folder,
  _isWebGL: boolean,
): Folder {
  const folder = parent.addFolder("Clip Plane", { expanded: false });

  folder.addSlider("Distance", {
    min: 0.1,
    max: 100,
    step: 0.1,
    object: ui.water,
    key: "clipPlaneDistance",
  });

  return folder;
}
