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

  folder.addCheckbox("Dynamic Resolution", {
    value: ui.performanceParams.dynamicResolution,
    onChange: (v) => {
      ui.performanceParams.dynamicResolution = v;
      if (!v) {
        ui.app.setPixelRatio(1);
      }
    },
  });

  folder.addSlider("Target FPS", {
    value: ui.performanceParams.targetFps,
    min: 30,
    max: 120,
    step: 5,
    onChange: (v) => {
      ui.performanceParams.targetFps = v;
    },
  });

  folder.addSlider("Min Pixel Ratio", {
    value: ui.performanceParams.minPixelRatio,
    min: 0.25,
    max: 4,
    step: 0.25,
    onChange: (v) => {
      ui.performanceParams.minPixelRatio = v;
    },
  });

  folder.addSlider("Max Pixel Ratio", {
    value: ui.performanceParams.maxPixelRatio,
    min: 0.5,
    max: 4,
    step: 0.25,
    onChange: (v) => {
      ui.performanceParams.maxPixelRatio = v;
    },
  });

  return folder;
}
