// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createBoatFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Boat", { expanded: false });
  const ship = ui.shipController;

  folder.addCheckbox("Mask Enabled", {
    value: true,
    onChange: (enabled: boolean) => {
      const mask = ui.app.models.shipWaterMask;
      if (!mask) return;
      if (enabled) {
        if (!ui.water.masking.has(mask)) {
          ui.water.masking.add(mask);
        }
      } else {
        ui.water.masking.remove(mask);
      }
    },
  });

  folder.addSlider("Thrust (m/s²)", {
    object: ship,
    key: "thrust",
    min: 0.5,
    max: 10,
    step: 1,
  });

  folder.addSlider("Drag", {
    object: ship,
    key: "drag",
    min: 0.1,
    max: 2,
    step: 0.05,
  });

  folder.addSlider("Max Speed (m/s)", {
    object: ship,
    key: "maxSpeed",
    min: 1,
    max: 15,
    step: 1,
  });

  folder.addSlider("Reverse Max Speed (m/s)", {
    object: ship,
    key: "reverseMaxSpeed",
    min: 1,
    max: 8,
    step: 1,
  });

  folder.addSlider("Rudder Power", {
    object: ship,
    key: "rudderTurn",
    min: 0.1,
    max: 2.0,
    step: 0.05,
  });

  folder.addSlider("Yaw Damping", {
    object: ship,
    key: "yawDamping",
    min: 0.2,
    max: 3.0,
    step: 0.05,
  });

  folder.addSlider("Sway Damping", {
    object: ship,
    key: "swayDamping",
    min: 0.2,
    max: 4.0,
    step: 0.05,
  });

  folder.addSlider("Rudder Rate (rad/s)", {
    object: ship,
    key: "rudderRate",
    min: 0.5,
    max: 3,
    step: 0.1,
  });

  folder.addSlider("Rudder Return (rad/s)", {
    object: ship,
    key: "rudderReturn",
    min: 0.5,
    max: 5,
    step: 0.1,
  });

  folder.addSlider("Throttle Rate", {
    object: ship,
    key: "throttleRate",
    min: 0.2,
    max: 3,
    step: 0.1,
  });

  return folder;
}
