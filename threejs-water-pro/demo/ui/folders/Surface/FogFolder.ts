// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

/**
 * Atmospheric fog controls — tunes the near fog colour and how quickly the
 * scene fades to it, then to the sky colour, with distance. All knobs are
 * preset-driven and tunable at runtime.
 */
export function createFogFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Fog (Atmospheric)", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: ui.water.fog,
    key: "enabled",
  });

  folder.addColor("Color", {
    object: ui.water.fog,
    key: "color",
  });

  folder.addSlider("Fade Start (m)", {
    min: 0,
    max: 500,
    step: 50,
    object: ui.water.fog,
    key: "fadeStart",
  });

  folder.addSlider("Fade End (m)", {
    min: 10,
    max: 2000,
    step: 50,
    object: ui.water.fog,
    key: "fadeEnd",
  });

  folder.addSlider("Sky Blend Distance (m)", {
    min: 0,
    max: 2000,
    step: 50,
    object: ui.water.fog,
    key: "skyBlendDistance",
  });

  folder.addSlider("Fade Power", {
    min: 0.1,
    max: 5,
    step: 0.1,
    object: ui.water.fog,
    key: "fadePower",
  });

  return folder;
}
