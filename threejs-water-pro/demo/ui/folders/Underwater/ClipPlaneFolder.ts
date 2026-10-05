// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createClipPlaneFolder(
  ui: UIManager,
  parent: Panel | Folder,
  _isWebGL: boolean,
): Folder {
  const folder = parent.addFolder("Clip Plane", { expanded: false });

  folder.addSlider("Distance (m)", {
    min: 0.05,
    max: 10,
    step: 0.05,
    object: ui.water,
    key: "clipPlaneDistance",
  });

  return folder;
}
