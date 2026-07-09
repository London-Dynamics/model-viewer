import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

export function createDistortionFolder(
  ui: UIManager,
  parent: Panel | Folder,
): void {
  const syncDistortion = (): void => {
    ui.water.underwaterDistortion.update(ui.params.postProcessing.underwater);
  };

  const folder = parent.addFolder("Distortion", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: ui.params.postProcessing.underwater,
    key: "distortionEnabled",
    onChange: syncDistortion,
  });

  folder.addSlider("Intensity", {
    min: 0,
    max: 0.1,
    step: 0.001,
    object: ui.params.postProcessing.underwater,
    key: "distortionIntensity",
    onChange: syncDistortion,
  });

  folder.addSlider("Scale", {
    min: 1,
    max: 10,
    step: 0.5,
    object: ui.params.postProcessing.underwater,
    key: "distortionScale",
    onChange: syncDistortion,
  });

  folder.addSlider("Speed", {
    min: 0,
    max: 2,
    step: 0.1,
    object: ui.params.postProcessing.underwater,
    key: "distortionSpeed",
    onChange: syncDistortion,
  });
}
