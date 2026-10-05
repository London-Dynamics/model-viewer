// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createDebugFolder(ui: UIManager, pane: Panel | Folder): Folder {
  const folder = pane.addFolder("Debug", { expanded: false });

  const forceWebGL = localStorage.getItem("forceWebGL") === "true";
  ui.params.debug.forceWebGL = forceWebGL;

  folder.addCheckbox("Force WebGL", {
    value: forceWebGL,
    binding: () => ui.params.debug.forceWebGL,
    onChange: (v) => {
      ui.params.debug.forceWebGL = v;
      localStorage.setItem("forceWebGL", String(v));
      window.location.reload();
    },
  });

  // Fog × transparency verification rig (plan 19). Deliberately not
  // persisted — the grid always starts hidden.
  folder.addCheckbox("Show Transparency Test", {
    value: ui.app.showTransparencyTest,
    onChange: (v) => {
      ui.app.showTransparencyTest = v;
    },
  });

  folder.addSlider("Test Distance (m)", {
    value: 1200,
    min: 20,
    max: 500,
    step: 10,
    onChange: (v) => {
      if (ui.app.fogTestGrid) ui.app.fogTestGrid.distance = v;
    },
  });

  folder.addSlider("Test Height (m)", {
    value: 100,
    min: -20,
    max: 50,
    step: 1,
    onChange: (v) => {
      if (ui.app.fogTestGrid) ui.app.fogTestGrid.height = v;
    },
  });

  folder.addCheckbox("Test Follows Camera", {
    value: true,
    onChange: (v) => {
      if (ui.app.fogTestGrid) ui.app.fogTestGrid.followCameraAzimuth = v;
    },
  });

  return folder;
}
