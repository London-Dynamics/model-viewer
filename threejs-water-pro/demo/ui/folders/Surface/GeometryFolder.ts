// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createGeometryFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Geometry", { expanded: false });

  function getLevelSizes(): string {
    const { baseSize, levels } = ui.params.clipmap;
    const sizes = Array.from(
      { length: levels },
      (_, i) => baseSize * Math.pow(2, i),
    );
    return sizes.join(", ") + "m";
  }

  function getTotalSize(): string {
    const { baseSize, levels } = ui.params.clipmap;
    const outermost = baseSize * Math.pow(2, levels - 1);
    return `${outermost.toLocaleString()}m`;
  }

  const levelSizesDisplay = folder.addDisplay("Level Sizes", {
    value: getLevelSizes(),
  });

  const totalSizeDisplay = folder.addDisplay("Total Size", {
    value: getTotalSize(),
  });

  function updateDisplays(): void {
    levelSizesDisplay.value = getLevelSizes();
    totalSizeDisplay.value = getTotalSize();
  }

  const advanced = folder.addFolder("Advanced", { expanded: false });

  advanced.addSlider("LOD Levels", {
    min: 1,
    max: 6,
    step: 1,
    binding: () => ui.params.clipmap.levels,
    onChange: (v) => {
      ui.params.clipmap.levels = v;
      ui.water.rebuildGeometry(ui.params.clipmap);
      updateDisplays();
    },
  });

  advanced.addSlider("Base Size (m)", {
    min: 50,
    max: 800,
    step: 50,
    binding: () => ui.params.clipmap.baseSize,
    onChange: (v) => {
      ui.params.clipmap.baseSize = v;
      ui.water.rebuildGeometry(ui.params.clipmap);
      updateDisplays();
    },
  });

  return folder;
}
