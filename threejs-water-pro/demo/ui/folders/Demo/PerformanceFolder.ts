// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createPerformanceFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Performance", { expanded: false });

  // Sync initial visibility state
  ui.app.shipHUD.setVisible(ui.performanceParams.showMonitor);

  folder.addCheckbox("Show Monitor", {
    value: ui.performanceParams.showMonitor,
    onChange: (v) => {
      ui.performanceParams.showMonitor = v;
      ui.app.shipHUD.setVisible(v);
    },
  });

  folder.addSlider("DPR", {
    value: ui.performanceParams.pixelRatio,
    min: 0.25,
    max: 4,
    step: 0.25,
    onChange: (v) => {
      ui.app.setPixelRatio(v);
    },
  });

  return folder;
}
