import type { CameraMode } from "../../../ship/CameraController";
import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createCameraFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder {
  const folder = pane.addFolder("Camera", { expanded: false });

  const modeSelect = folder.addSelect("Mode", {
    binding: () => ui.cameraController.mode,
    options: [
      { label: "Free Camera (1)", value: "freeCamera" },
      { label: "Flight Camera (2)", value: "flightCamera" },
      { label: "Third Person (3)", value: "thirdPerson" },
    ],
    onChange: (v) => {
      ui.cameraController.setMode(v as CameraMode);
    },
  });

  ui.cameraController.onModeChange((mode) => {
    modeSelect.setValueSilent(mode);
  });

  folder.addCheckbox("Camera Tracking", {
    binding: () => ui.water.cameraTracking,
    onChange: (v) => {
      ui.water.cameraTracking = v;
    },
  });

  return folder;
}
