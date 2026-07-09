import type { UIManager } from "../../UIManager";
import type { Panel, Folder } from "../../SimpleUI";

/**
 * Builds the "Spray" controls under the Surface panel. Binds directly to
 * the {@link SpraySystem} instance on the water system — setters push values
 * into the live uniform nodes, so no callback plumbing is needed.
 *
 * Per-emitter parameters (sample count, intensity, etc.) are scene-driven
 * — each registered emitter has its own configuration — and are not
 * exposed here. This folder controls only the global tunables that apply
 * to every emitter's particles uniformly.
 *
 * Skipped entirely when the water system has no spray (WebGL backend).
 */
export function createSprayFolder(
  ui: UIManager,
  pane: Panel | Folder,
): Folder | null {
  const spray = ui.water.spray;
  if (!spray) return null;

  const folder = pane.addFolder("Spray", { expanded: false });

  folder.addCheckbox("Enabled", {
    object: spray,
    key: "enabled",
  });

  folder.addSlider("Size (m)", {
    min: 1,
    max: 100,
    step: 0.1,
    object: spray,
    key: "size",
  });

  folder.addSlider("Stretch X", {
    min: 0.25,
    max: 4,
    step: 0.01,
    object: spray,
    key: "stretchX",
  });

  folder.addSlider("Stretch Y", {
    min: 0.25,
    max: 4,
    step: 0.01,
    object: spray,
    key: "stretchY",
  });

  folder.addSlider("Opacity", {
    min: 0,
    max: 1,
    step: 0.05,
    object: spray,
    key: "opacity",
  });

  folder.addSlider("Submersion Depth (m)", {
    min: 0,
    max: 2,
    step: 0.05,
    object: spray,
    key: "submersionDepth",
  });

  folder.addSlider("Bottom Fade Start", {
    min: 0,
    max: 1,
    step: 0.01,
    object: spray,
    key: "bottomFadeStart",
  });

  folder.addSlider("Bottom Fade Stop", {
    min: 0,
    max: 1,
    step: 0.01,
    object: spray,
    key: "bottomFadeStop",
  });

  folder.addSlider("Duration (s)", {
    min: 0.1,
    max: 3,
    step: 0.05,
    object: spray,
    key: "duration",
  });

  folder.addSlider("Fade Out Time (s)", {
    min: 0,
    max: 1,
    step: 0.01,
    object: spray,
    key: "fadeOutTime",
  });

  folder.addSlider("Respawn Time (s)", {
    min: 0,
    max: 5,
    step: 0.05,
    object: spray,
    key: "respawnTime",
  });

  folder.addSlider("Spawn Jitter (s)", {
    min: 0,
    max: 2,
    step: 0.05,
    object: spray,
    key: "spawnJitterTime",
  });

  folder.addSlider("Velocity Threshold (m/s)", {
    min: 0,
    max: 10,
    step: 0.1,
    object: spray,
    key: "velocityThreshold",
  });

  folder.addSlider("Velocity Scale Factor", {
    min: 0,
    max: 2,
    step: 0.05,
    object: spray,
    key: "velocityScaleFactor",
  });

  folder.addSlider("Velocity Height Factor", {
    min: 0,
    max: 2,
    step: 0.05,
    object: spray,
    key: "velocityHeightFactor",
  });

  const visualizer = ui.app.sprayDebugVisualizer;
  if (visualizer) {
    folder.addCheckbox("Show Probes", {
      value: visualizer.isEnabled(),
      onChange: (v: boolean) => visualizer.setEnabled(v),
    });
  }

  return folder;
}
