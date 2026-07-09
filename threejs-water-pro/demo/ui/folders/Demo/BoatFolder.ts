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

  folder.addSlider("Thrust", {
    object: ship,
    key: "thrust",
    min: 1,
    max: 50,
    step: 1,
  });

  folder.addSlider("Drag", {
    object: ship,
    key: "drag",
    min: 0.1,
    max: 2,
    step: 0.05,
  });

  folder.addSlider("Max Speed", {
    object: ship,
    key: "maxSpeed",
    min: 10,
    max: 100,
    step: 1,
  });

  folder.addSlider("Reverse Max Speed", {
    object: ship,
    key: "reverseMaxSpeed",
    min: 5,
    max: 50,
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

  folder.addSlider("Rudder Rate", {
    object: ship,
    key: "rudderRate",
    min: 0.5,
    max: 3,
    step: 0.1,
  });

  folder.addSlider("Rudder Return", {
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
